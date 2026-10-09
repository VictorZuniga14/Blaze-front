import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { launchConfigService } from "../services/launchConfig.service";
import { launchService } from "../services/launch.service";
import { useLibraryStore } from "./library";
import { useRaProgressStore } from "./raProgress";
import { useRaSessionSyncStore } from "./raSessionSync";
import { usePlayHistoryStore } from "./playHistory";
import { shouldRecordPlaySession } from "../utils/playStats";
import type {
  LaunchConfig,
  LaunchConfigInput,
  LastProcessResult,
  ProcessStatus,
} from "../types/launch";

function userFacingError(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export const useLaunchStore = defineStore("launch", () => {
  const currentConfig = ref<LaunchConfig | null>(null);
  const loadingConfig = ref(false);
  const savingConfig = ref(false);
  const configError = ref<string | null>(null);

  const status = ref<ProcessStatus>("IDLE");
  const activePid = ref<number | null>(null);
  const activeGameId = ref<string | null>(null);
  const lastResult = ref<LastProcessResult | null>(null);
  const error = ref<string | null>(null);

  let listening = false;

  const isBusy = computed(
    () => status.value === "STARTING" || status.value === "RUNNING",
  );

  async function ensureListener(): Promise<void> {
    if (listening) return;
    listening = true;
    await launchService.onProcessExited((payload) => {
      status.value = "EXITED";
      lastResult.value = launchService.toLastResult(payload);
      activePid.value = null;
      activeGameId.value = null;
      status.value = "IDLE";
      void (async () => {
        try {
          await usePlayHistoryStore().finishOpenSession();
        } catch {
          // El cierre del proceso ya quedó en IDLE.
        }
        // No await: RA no debe dejar la UI en “jugando”.
        void useRaSessionSyncStore().endSession();
      })();
    });
  }

  function maybeStartRaSession(gameId: string | null): void {
    if (!gameId) return;
    const game = useLibraryStore().getGameById(gameId);
    const raGameId = game?.retroAchievementsGameId ?? null;
    if (typeof raGameId === "number" && Number.isInteger(raGameId) && raGameId > 0) {
      useRaSessionSyncStore().startSession(gameId, raGameId);
    }
  }

  async function syncActiveProcess(): Promise<void> {
    await ensureListener();
    try {
      const active = await launchService.getActiveProcess();
      status.value = active.status;
      activePid.value = active.pid;
      activeGameId.value = active.gameId;
      if (active.status === "RUNNING" || active.status === "STARTING") {
        maybeStartRaSession(active.gameId);
      }
    } catch {
      // ignore sync errors in UI
    }
  }

  async function loadConfig(gameId: string): Promise<void> {
    loadingConfig.value = true;
    configError.value = null;
    try {
      currentConfig.value = await launchConfigService.getByGameId(gameId);
    } catch (err) {
      configError.value = userFacingError(
        err,
        "No se pudo cargar la configuración de ejecución.",
      );
      currentConfig.value = null;
    } finally {
      loadingConfig.value = false;
    }
  }

  async function saveConfig(input: LaunchConfigInput): Promise<LaunchConfig> {
    savingConfig.value = true;
    configError.value = null;
    try {
      const saved = await launchConfigService.save(input);
      currentConfig.value = saved;
      return saved;
    } catch (err) {
      const message = userFacingError(
        err,
        "No se pudo guardar la configuración.",
      );
      configError.value = message;
      throw new Error(message);
    } finally {
      savingConfig.value = false;
    }
  }

  async function play(gameId: string): Promise<void> {
    error.value = null;
    lastResult.value = null;
    useRaProgressStore().clearPostPlayNotice();
    await ensureListener();

    if (isBusy.value && activeGameId.value !== gameId) {
      error.value = "Ya hay otro juego en ejecución.";
      return;
    }
    if (isBusy.value && activeGameId.value === gameId) {
      return;
    }

    status.value = "STARTING";
    activeGameId.value = gameId;

    try {
      const active = await launchService.launchGame(gameId);
      status.value = active.status;
      activePid.value = active.pid;
      activeGameId.value = active.gameId;
      if (
        shouldRecordPlaySession(active.status, active.pid) &&
        active.gameId
      ) {
        void usePlayHistoryStore().startSession(active.gameId);
      }
      if (active.status === "RUNNING" || active.status === "STARTING") {
        maybeStartRaSession(active.gameId);
      }
    } catch (err) {
      status.value = "ERROR";
      error.value = userFacingError(err, "No se pudo iniciar el juego.");
      activePid.value = null;
      activeGameId.value = null;
      status.value = "IDLE";
    }
  }

  function clearLastResult(): void {
    lastResult.value = null;
  }

  return {
    currentConfig,
    loadingConfig,
    savingConfig,
    configError,
    status,
    activePid,
    activeGameId,
    lastResult,
    error,
    isBusy,
    loadConfig,
    saveConfig,
    play,
    syncActiveProcess,
    clearLastResult,
  };
});
