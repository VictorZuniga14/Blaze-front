import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export type UpdateProgress = {
  phase: "checking" | "available" | "downloading" | "installing" | "done" | "idle";
  version?: string;
  /** 0–100 mientras descarga; null si aún no hay tamaño total. */
  percent: number | null;
  downloadedBytes: number;
  totalBytes: number | null;
  detail: string;
};

export type RunUpdaterOptions = {
  onProgress?: (p: UpdateProgress) => void;
  /** Si devuelve true, no se relanza tras instalar. */
  shouldAbort?: () => boolean;
};

function emit(
  onProgress: RunUpdaterOptions["onProgress"],
  progress: UpdateProgress,
): void {
  onProgress?.(progress);
}

/**
 * Cierra el modal de actualización y recién después muestra la app.
 * Orden fijo: updater off → main on (nunca las dos a la vez).
 * El caller debe armar el flag que permite close() (ver UpdaterApp).
 */
export async function handoffToMainWindow(): Promise<void> {
  try {
    const current = getCurrentWindow();
    if (current.label === "updater") {
      await current.close();
    }
  } catch {
    /* ya cerrada */
  }

  try {
    const main = await WebviewWindow.getByLabel("main");
    if (main) {
      await main.unminimize();
      await main.show();
      await main.setFocus();
    }
  } catch (error) {
    console.info("[Blaze] No se pudo mostrar main:", error);
  }
}

/**
 * Flujo de la ventana externa: busca update, descarga con progreso e instala.
 * Sin update / error de red / cancel → `"skipped"` (el UI hace handoff a main).
 * Con update instalado → relaunch (no abre main aquí).
 */
export async function runExternalUpdaterFlow(
  options: RunUpdaterOptions = {},
): Promise<"updated" | "skipped"> {
  const { onProgress, shouldAbort } = options;

  if (import.meta.env.DEV) {
    console.info("[Blaze] Update check omitido (modo dev)");
    return "skipped";
  }

  emit(onProgress, {
    phase: "checking",
    percent: null,
    downloadedBytes: 0,
    totalBytes: null,
    detail: "Buscando actualizaciones…",
  });

  let update: Update | null = null;
  try {
    // Sin tope, `check()` puede colgarse minutos si GitHub/latest.json no responde.
    update = await Promise.race([
      check(),
      new Promise<null>((_, reject) => {
        window.setTimeout(
          () => reject(new Error("Timeout buscando actualizaciones")),
          12_000,
        );
      }),
    ]);
  } catch (error) {
    console.info("[Blaze] Update check omitido:", error);
    return "skipped";
  }

  if (!update) {
    return "skipped";
  }

  if (shouldAbort?.()) {
    await update.close();
    return "skipped";
  }

  emit(onProgress, {
    phase: "available",
    version: update.version,
    percent: 0,
    downloadedBytes: 0,
    totalBytes: null,
    detail: `Actualizando a ${update.version}…`,
  });

  let downloaded = 0;
  let total: number | null = null;

  try {
    await update.downloadAndInstall((event: DownloadEvent) => {
      if (shouldAbort?.()) return;

      switch (event.event) {
        case "Started": {
          total = event.data.contentLength ?? null;
          emit(onProgress, {
            phase: "downloading",
            version: update.version,
            percent: total && total > 0 ? 0 : null,
            downloadedBytes: 0,
            totalBytes: total,
            detail: `Descargando ${update.version}…`,
          });
          break;
        }
        case "Progress": {
          downloaded += event.data.chunkLength;
          const percent =
            total && total > 0
              ? Math.min(99, Math.round((downloaded / total) * 100))
              : null;
          emit(onProgress, {
            phase: "downloading",
            version: update.version,
            percent,
            downloadedBytes: downloaded,
            totalBytes: total,
            detail: "Descargando actualización…",
          });
          break;
        }
        case "Finished": {
          emit(onProgress, {
            phase: "installing",
            version: update.version,
            percent: 100,
            downloadedBytes: downloaded,
            totalBytes: total,
            detail: "Instalando…",
          });
          break;
        }
      }
    });
  } catch (error) {
    if (shouldAbort?.()) {
      return "skipped";
    }
    console.info("[Blaze] Falló la actualización:", error);
    try {
      await update.close();
    } catch {
      /* recurso ya liberado */
    }
    return "skipped";
  }

  if (shouldAbort?.()) {
    return "skipped";
  }

  emit(onProgress, {
    phase: "done",
    version: update.version,
    percent: 100,
    downloadedBytes: downloaded,
    totalBytes: total,
    detail: "Reiniciando Blaze…",
  });

  await relaunch();
  return "updated";
}
