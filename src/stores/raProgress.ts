import { defineStore } from "pinia";
import { ref } from "vue";
import { ApiError } from "../services/api.client";
import { retroAchievementsApiService } from "../services/retroAchievementsApi.service";
import { raEmulatorService } from "../services/raEmulator.service";
import { launchConfigService } from "../services/launchConfig.service";
import { runtimeRepository } from "../repositories/runtime.repository";
import {
  RA_REFRESH_FAILED,
  commitGameProgress,
  decideGameLoad,
  decideGameRefresh,
  failGameRefresh,
  forgetGameSlot,
  mergeCachedSlot,
  raCardModel,
  shouldRefreshRaAfterExit,
  type RaCardModel,
  type RaSlotState,
} from "../utils/raLibraryProgress";
import { useAuthStore } from "./auth";
import { useLibraryStore } from "./library";
import type {
  EmulatorRaStatus,
  RaGameCandidate,
  RaGameProgress,
  RaProgressUiState,
} from "../types/retroAchievements";
import { resolveRaConsole } from "../utils/raConsoles";

function userFacingError(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function emptyUiState(error: unknown, message: string): RaProgressUiState {
  if (error instanceof ApiError && error.status === 404) return "not_found";
  if (
    error instanceof ApiError &&
    (error.status === 503 || message.includes("Web API Key"))
  ) {
    return "api_not_configured";
  }
  return "api_error";
}

export const useRaProgressStore = defineStore("raProgress", () => {
  /** Cuenta / configuración del emulador. No es el progreso de un juego. */
  const apiConfigured = ref<boolean | null>(null);
  const raUsername = ref<string | null>(null);
  const raReady = ref(false);
  const raSource = ref<EmulatorRaStatus | null>(null);

  /** Progreso por id de juego de Blaze. */
  const progressByGameId = ref<Record<string, RaSlotState<RaGameProgress>>>({});

  const searching = ref(false);
  const searchError = ref<string | null>(null);
  const candidates = ref<RaGameCandidate[]>([]);
  const postPlayNotice = ref<{ gameId: string; message: string } | null>(null);

  const loadTokens = new Map<string, number>();
  let hydrateGen = 0;

  function nextToken(gameId: string): number {
    const token = (loadTokens.get(gameId) ?? 0) + 1;
    loadTokens.set(gameId, token);
    return token;
  }

  function isCurrent(gameId: string, token: number): boolean {
    return loadTokens.get(gameId) === token;
  }

  async function refreshRaContext(gameId?: string): Promise<void> {
    const auth = useAuthStore();
    const blazeUser = auth.user?.username?.trim() || null;
    try {
      let preferredExe: string | null = null;
      if (gameId) {
        const config = await launchConfigService.getByGameId(gameId);
        if (config?.type === "runtime" && config.runtimeId) {
          const runtime = await runtimeRepository.findById(config.runtimeId);
          preferredExe = runtime?.executablePath ?? null;
        }
      }
      const resolved =
        await raEmulatorService.resolveUsernameForProgress(preferredExe);
      // Preferir usuario del emulador; si aún no está escrito, usar sesión Blaze (mismo login RA).
      raUsername.value = resolved.username ?? blazeUser;
      raSource.value = resolved.source;
      raReady.value =
        resolved.source?.status === "ready" ||
        (!!blazeUser && !resolved.username);
    } catch {
      raUsername.value = blazeUser;
      raSource.value = null;
      raReady.value = !!blazeUser;
    }
  }

  async function refreshApiStatus(): Promise<void> {
    try {
      const status = await retroAchievementsApiService.getStatus();
      apiConfigured.value = status.apiConfigured;
    } catch {
      apiConfigured.value = null;
    }
  }

  function entryFor(gameId: string): RaSlotState<RaGameProgress> | null {
    return progressByGameId.value[gameId] ?? null;
  }

  function cardModel(gameId: string, raGameId: number | null): RaCardModel {
    return raCardModel({
      raGameId,
      slot: progressByGameId.value[gameId] ?? null,
    });
  }

  function forgetGame(gameId: string): void {
    progressByGameId.value = forgetGameSlot(progressByGameId.value, gameId);
  }

  function clearPostPlayNotice(): void {
    postPlayNotice.value = null;
  }

  async function loadForGame(input: {
    gameId?: string;
    raGameId: number | null;
    platform?: string | null;
    refresh?: boolean;
  }): Promise<boolean> {
    const gameId = input.gameId ?? "";
    if (!gameId) return false;

    if (!input.raGameId) {
      forgetGame(gameId);
      return true;
    }

    if (input.refresh) {
      const decision = decideGameRefresh(
        progressByGameId.value,
        gameId,
        input.raGameId,
      );
      if (decision.decision === "busy") return false;
      progressByGameId.value = decision.slots;
    } else {
      const decision = decideGameLoad(
        progressByGameId.value,
        gameId,
        input.raGameId,
      );
      if (decision.decision === "use-cache") return true;
      if (decision.decision === "busy") return false;
      progressByGameId.value = decision.slots;
    }

    const token = nextToken(gameId);

    try {
      await Promise.all([
        refreshRaContext(input.gameId),
        refreshApiStatus(),
      ]);
      if (!isCurrent(gameId, token)) return false;

      if (apiConfigured.value === false) {
        progressByGameId.value = failGameRefresh(
          progressByGameId.value,
          gameId,
          input.raGameId,
          "RetroAchievements no está configurado en el servidor (falta Web API Key).",
          "api_not_configured",
        );
        return false;
      }

      if (!raUsername.value) {
        progressByGameId.value = failGameRefresh(
          progressByGameId.value,
          gameId,
          input.raGameId,
          "RetroAchievements no está configurado en PCSX2 ni RetroArch. Podés jugar igual; el login de logros se hace en el emulador.",
          "not_configured",
        );
        return false;
      }

      const data = await retroAchievementsApiService.getProgress({
        username: raUsername.value,
        raGameId: input.raGameId,
        refresh: input.refresh,
      });
      if (!isCurrent(gameId, token)) return false;
      progressByGameId.value = commitGameProgress(
        progressByGameId.value,
        gameId,
        input.raGameId,
        data,
      );
      return true;
    } catch (err) {
      if (!isCurrent(gameId, token)) return false;
      const specific = userFacingError(
        err,
        "No fue posible consultar RetroAchievements.",
      );
      const message = input.refresh ? RA_REFRESH_FAILED : specific;
      progressByGameId.value = failGameRefresh(
        progressByGameId.value,
        gameId,
        input.raGameId,
        message,
        emptyUiState(err, specific),
      );
      return false;
    }
  }

  /**
   * Al abrir la biblioteca: una lectura de la cache del backend.
   * No consulta RetroAchievements por cada juego.
   */
  async function hydrateLibraryCache(
    games: Array<{ id: string; raGameId: number | null }>,
  ): Promise<void> {
    const gen = ++hydrateGen;
    const mapped = games.filter(
      (game): game is { id: string; raGameId: number } =>
        typeof game.raGameId === "number" && game.raGameId > 0,
    );
    if (mapped.length === 0) return;

    try {
      await refreshRaContext();
      if (gen !== hydrateGen || !raUsername.value) return;

      const ids = [
        ...new Set(
          mapped
            .filter((game) => {
              const slot = progressByGameId.value[game.id];
              return !slot?.confirmed && !slot?.loading && !slot?.refreshing;
            })
            .map((game) => game.raGameId),
        ),
      ];
      if (ids.length === 0) return;

      const data = await retroAchievementsApiService.getCachedProgress({
        username: raUsername.value,
        raGameIds: ids,
      });
      if (gen !== hydrateGen) return;

      let next = progressByGameId.value;
      for (const game of mapped) {
        const item = data.items?.find((row) => row.raGameId === game.raGameId);
        next = mergeCachedSlot(
          next,
          game.id,
          game.raGameId,
          item?.progress ?? null,
        );
      }
      progressByGameId.value = next;
    } catch {
      // La biblioteca sigue usable si la cache o el backend no responden.
    }
  }

  /**
   * Después de que el proceso del juego terminó (camino legacy / manual).
   * La sesión Alt+Tab usa refreshSilent vía raSessionSync.endSession.
   */
  async function refreshAfterExit(gameId: string): Promise<void> {
    try {
      const game = useLibraryStore().getGameById(gameId);
      const raGameId = game?.retroAchievementsGameId ?? null;
      if (!shouldRefreshRaAfterExit(raGameId)) return;
      postPlayNotice.value = null;
      const ok = await loadForGame({
        gameId,
        raGameId,
        platform: game?.platform,
        refresh: true,
      });
      if (!ok && progressByGameId.value[gameId]?.error === RA_REFRESH_FAILED) {
        postPlayNotice.value = { gameId, message: RA_REFRESH_FAILED };
      }
    } catch {
      postPlayNotice.value = { gameId, message: RA_REFRESH_FAILED };
    }
  }

  /** Conteo desbloqueado del slot (sin tocar loading). */
  function unlockedCount(gameId: string): number {
    return progressByGameId.value[gameId]?.progress?.unlockedAchievements ?? 0;
  }

  /**
   * Refresh forzado sin flags loading/refreshing.
   * Solo hace commit si la API responde; si falla, conserva datos viejos y relanza.
   */
  async function refreshSilent(gameId: string): Promise<void> {
    const game = useLibraryStore().getGameById(gameId);
    const raGameId = game?.retroAchievementsGameId ?? null;
    if (
      typeof raGameId !== "number" ||
      !Number.isInteger(raGameId) ||
      raGameId <= 0
    ) {
      throw new Error("Juego sin mapping RA.");
    }

    await Promise.all([refreshRaContext(gameId), refreshApiStatus()]);

    if (apiConfigured.value === false) {
      throw new Error("RetroAchievements no está configurado en el servidor.");
    }
    if (!raUsername.value) {
      throw new Error("RetroAchievements no está configurado en el emulador.");
    }

    const data = await retroAchievementsApiService.getProgress({
      username: raUsername.value,
      raGameId,
      refresh: true,
    });
    progressByGameId.value = commitGameProgress(
      progressByGameId.value,
      gameId,
      raGameId,
      data,
    );
  }

  /**
   * Búsqueda por título.
   * Si hay platform, primero acota a esa consola (menos 429);
   * si no hay hits, amplía a global.
   */
  async function searchCandidates(
    query: string,
    platform?: string | null,
    _options?: { broadenIfEmpty?: boolean },
  ): Promise<void> {
    searching.value = true;
    searchError.value = null;
    try {
      const preferred = resolveRaConsole({ platform });
      let results: RaGameCandidate[] = [];

      if (preferred) {
        results = await retroAchievementsApiService.search({
          query,
          consoleId: preferred.consoleId,
        });
      }

      if (results.length === 0) {
        results = await retroAchievementsApiService.search({ query });
      }

      candidates.value = results;
    } catch (err) {
      candidates.value = [];
      searchError.value = userFacingError(
        err,
        "No se pudieron buscar candidatos en RetroAchievements.",
      );
    } finally {
      searching.value = false;
    }
  }

  function clearCandidates(): void {
    candidates.value = [];
  }

  function reset(): void {
    progressByGameId.value = {};
    searchError.value = null;
    candidates.value = [];
    postPlayNotice.value = null;
  }

  return {
    apiConfigured,
    raUsername,
    raReady,
    raSource,
    progressByGameId,
    searching,
    searchError,
    candidates,
    postPlayNotice,
    entryFor,
    cardModel,
    loadForGame,
    hydrateLibraryCache,
    refreshAfterExit,
    refreshSilent,
    unlockedCount,
    searchCandidates,
    clearCandidates,
    forgetGame,
    clearPostPlayNotice,
    reset,
    refreshRaContext,
    refreshApiStatus,
  };
});
