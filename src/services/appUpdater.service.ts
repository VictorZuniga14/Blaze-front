import { ask } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/** Busca update en GitHub Releases (latest.json) y ofrece instalarlo. */
export async function checkAndPromptAppUpdate(): Promise<void> {
  try {
    const update = await check();
    if (!update) return;

    const ok = await ask(
      `Hay una nueva versión de Blaze (${update.version}).\n\n¿Descargar e instalar ahora? La app se reiniciará.`,
      {
        title: "Actualización disponible",
        kind: "info",
        okLabel: "Actualizar",
        cancelLabel: "Después",
      },
    );
    if (!ok) return;

    await update.downloadAndInstall();
    await relaunch();
  } catch (error) {
    // Repo privado / sin red / sin latest.json firmado: no molestar al usuario.
    console.info("[Blaze] Update check omitido:", error);
  }
}
