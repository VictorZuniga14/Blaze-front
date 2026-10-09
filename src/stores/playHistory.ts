import { defineStore } from "pinia";
import { ref } from "vue";
import { launchService } from "../services/launch.service";
import { playHistoryService } from "../services/playHistory.service";
import type { GamePlayAggregate, PlayStats } from "../types/playHistory";

export const usePlayHistoryStore = defineStore("playHistory", () => {
  const stats = ref<PlayStats | null>(null);
  const loaded = ref(false);
  const loadFailed = ref(false);
  const notice = ref<string | null>(null);

  let openSessionId: string | null = null;
  let starting: Promise<string | null> | null = null;
  let loadPromise: Promise<void> | null = null;

  function statsFor(gameId: string): GamePlayAggregate | null {
    return stats.value?.games.find((game) => game.gameId === gameId) ?? null;
  }

  async function refresh(): Promise<void> {
    stats.value = await playHistoryService.getStats();
    loaded.value = true;
  }

  async function loadFresh(): Promise<void> {
    let running = false;
    try {
      const active = await launchService.getActiveProcess();
      running = active.status === "RUNNING" || active.status === "STARTING";
    } catch {
      running = false;
    }
    if (!running) {
      try {
        await playHistoryService.abandonOpen();
      } catch {
        // Sin backend no se inventa un cierre.
      }
    }
    await refresh();
  }

  async function ensureLoaded(): Promise<void> {
    if (loaded.value) return;
    if (!loadPromise) {
      loadFailed.value = false;
      loadPromise = loadFresh()
        .then(() => {
          loadFailed.value = false;
        })
        .catch(() => {
          loadFailed.value = true;
          if (!notice.value) {
            notice.value = "No se pudo cargar la actividad.";
          }
        })
        .finally(() => {
          loadPromise = null;
        });
    }
    await loadPromise;
  }

  async function startSession(gameId: string): Promise<void> {
    notice.value = null;
    const task = (async () => {
      try {
        const session = await playHistoryService.start(gameId);
        openSessionId = session.id;
        return session.id;
      } catch {
        notice.value = "No se pudo registrar la sesión de juego.";
        return null;
      }
    })();
    starting = task;
    await task;
  }

  async function finishOpenSession(): Promise<void> {
    const pending = starting;
    const id = openSessionId ?? (pending ? await pending : null);
    starting = null;
    openSessionId = null;
    if (!id) return;
    try {
      await playHistoryService.finish(id);
      await refresh();
    } catch {
      notice.value = "No se pudo guardar el tiempo de esta sesión.";
      try {
        await playHistoryService.abandonOpen();
      } catch {
        // La sesión queda abierta y no suma tiempo.
      }
    }
  }

  async function deleteGameHistory(gameId: string): Promise<void> {
    await playHistoryService.deleteForGame(gameId);
    try {
      await refresh();
    } catch {
      if (stats.value) {
        const games = stats.value.games.filter((game) => game.gameId !== gameId);
        const recent = stats.value.recent.filter((game) => game.gameId !== gameId);
        const totalPlaytimeSeconds = games.reduce(
          (sum, game) => sum + game.totalPlaytimeSeconds,
          0,
        );
        const sessionCount = games.reduce((sum, game) => sum + game.playCount, 0);
        stats.value = {
          ...stats.value,
          games,
          recent,
          totalPlaytimeSeconds,
          sessionCount,
          playedGameCount: games.length,
          lastPlayed: recent[0]
            ? { gameId: recent[0].gameId, lastPlayedAt: recent[0].lastPlayedAt }
            : null,
          mostPlayed: games[0]
            ? {
                gameId: games[0].gameId,
                totalPlaytimeSeconds: games[0].totalPlaytimeSeconds,
              }
            : null,
        };
      }
    }
  }

  return {
    stats,
    loaded,
    loadFailed,
    notice,
    statsFor,
    ensureLoaded,
    startSession,
    finishOpenSession,
    deleteGameHistory,
  };
});
