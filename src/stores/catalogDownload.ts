import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  catalogInstallService,
  type CatalogInstallProgress,
} from "../services/catalogInstall.service";
import { formatBytes } from "../services/catalogTransfer.service";
import { useLibraryStore } from "./library";

export type CatalogDownloadStatus =
  | "queued"
  | "downloading"
  | "installing"
  | "done"
  | "error";

export type CatalogDownloadJob = {
  gameId: string;
  gameTitle: string | null;
  status: CatalogDownloadStatus;
  hudTitle: string;
  percent: number;
  detail: string | null;
  message: string;
  error: string | null;
  updatedAt: number;
};

function progressToHud(p: CatalogInstallProgress): {
  status: CatalogDownloadStatus;
  hudTitle: string;
  percent: number;
  detail: string | null;
} {
  let status: CatalogDownloadStatus = "downloading";
  let hudTitle = "PREPARANDO";
  if (p.phase === "downloading") {
    status = "downloading";
    hudTitle = "DESCARGANDO";
  } else if (p.phase === "installing") {
    status = "installing";
    hudTitle = "INSTALANDO";
  } else {
    status = "downloading";
    hudTitle = "PREPARANDO";
  }

  let percent = 0;
  let detail: string | null = null;
  if (p.bytesTotal > 0) {
    percent = Math.min(100, Math.round((p.bytesDone / p.bytesTotal) * 100));
    detail = `${formatBytes(p.bytesDone)} / ${formatBytes(p.bytesTotal)}`;
  } else if (p.phase === "installing") {
    percent = 100;
    detail = p.message;
  }

  return { status, hudTitle, percent, detail };
}

export const useCatalogDownloadStore = defineStore("catalogDownload", () => {
  const jobs = ref<Record<string, CatalogDownloadJob>>({});
  const queue = ref<string[]>([]);
  const runningGameId = ref<string | null>(null);
  let pumping = false;

  const activeJobs = computed(() =>
    Object.values(jobs.value).filter(
      (j) =>
        j.status === "queued" ||
        j.status === "downloading" ||
        j.status === "installing",
    ),
  );

  /** Job visible en el HUD global (el que está corriendo, o el primero en cola). */
  const hudJob = computed(() => {
    if (runningGameId.value && jobs.value[runningGameId.value]) {
      return jobs.value[runningGameId.value];
    }
    return activeJobs.value[0] ?? null;
  });

  const hasActiveDownloads = computed(() => activeJobs.value.length > 0);

  function jobFor(gameId: string | null | undefined): CatalogDownloadJob | null {
    if (!gameId) return null;
    return jobs.value[gameId] ?? null;
  }

  function isActive(gameId: string | null | undefined): boolean {
    const job = jobFor(gameId);
    if (!job) return false;
    return (
      job.status === "queued" ||
      job.status === "downloading" ||
      job.status === "installing"
    );
  }

  function patchJob(gameId: string, patch: Partial<CatalogDownloadJob>): void {
    const prev = jobs.value[gameId];
    if (!prev) return;
    jobs.value = {
      ...jobs.value,
      [gameId]: { ...prev, ...patch, updatedAt: Date.now() },
    };
  }

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.value.length > 0) {
        const gameId = queue.value[0];
        if (!gameId) break;
        runningGameId.value = gameId;
        patchJob(gameId, {
          status: "downloading",
          hudTitle: "PREPARANDO",
          percent: 0,
          detail: null,
          message: "Consultando catálogo…",
          error: null,
        });

        try {
          await catalogInstallService.repairFromCatalog(gameId, (p) => {
            const hud = progressToHud(p);
            patchJob(gameId, {
              status: hud.status,
              hudTitle: hud.hudTitle,
              percent: hud.percent,
              detail: hud.detail,
              message: p.message,
              error: null,
            });
          });
          patchJob(gameId, {
            status: "done",
            hudTitle: "LISTO",
            percent: 100,
            detail: null,
            message: "Descarga completa",
            error: null,
          });
          try {
            await useLibraryStore().loadLibrary();
          } catch {
            /* la ficha ya está; el listado se refresca al volver */
          }
        } catch (err) {
          const raw =
            err instanceof Error
              ? err.message
              : typeof err === "string"
                ? err
                : null;
          patchJob(gameId, {
            status: "error",
            hudTitle: "ERROR",
            percent: 0,
            detail: null,
            message: raw?.trim() || "No se pudo descargar el juego.",
            error: raw?.trim() || "No se pudo descargar el juego.",
          });
        } finally {
          queue.value = queue.value.filter((id) => id !== gameId);
          runningGameId.value = null;
        }
      }
    } finally {
      pumping = false;
    }
  }

  /**
   * Encola descarga/reparación desde catálogo. Sobrevive a cambios de ruta.
   * Una a la vez (FIFO); mismo gameId no se encola dos veces si ya está activo.
   */
  function startDownload(
    gameId: string,
    options?: { gameTitle?: string | null },
  ): void {
    const id = gameId.trim();
    if (!id) return;
    if (isActive(id)) return;

    jobs.value = {
      ...jobs.value,
      [id]: {
        gameId: id,
        gameTitle: options?.gameTitle ?? jobs.value[id]?.gameTitle ?? null,
        status: "queued",
        hudTitle: "EN COLA",
        percent: 0,
        detail: null,
        message: "En cola…",
        error: null,
        updatedAt: Date.now(),
      },
    };
    if (!queue.value.includes(id)) {
      queue.value = [...queue.value, id];
    }
    void pump();
  }

  function clearJob(gameId: string): void {
    if (isActive(gameId)) return;
    const next = { ...jobs.value };
    delete next[gameId];
    jobs.value = next;
  }

  return {
    jobs,
    activeJobs,
    hudJob,
    hasActiveDownloads,
    runningGameId,
    jobFor,
    isActive,
    startDownload,
    clearJob,
  };
});
