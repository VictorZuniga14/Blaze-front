import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { gameService } from "../services/game.service";
import { catalogApiService } from "../services/catalogApi.service";
import { catalogInstallService } from "../services/catalogInstall.service";
import { libraryApiService } from "../services/libraryApi.service";
import { localDbService } from "../services/localDb.service";
import { sessionStorage } from "../services/sessionStorage.service";
import { usePlayHistoryStore } from "./playHistory";
import { useCatalogCoversStore } from "./catalogCovers";
import type { Game, GameSort, GameWritableFields } from "../types/game";
import { gamePublishService } from "../services/gamePublish.service";

function userFacingError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

export const useLibraryStore = defineStore("library", () => {
  const games = ref<Game[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const search = ref("");
  const sort = ref<GameSort>("newest");
  const favoritesOnly = ref(false);
  const selectedGameId = ref<string | null>(null);
  const ready = ref(false);

  const filteredGames = computed(() => {
    const query = search.value.trim().toLowerCase();
    let list = games.value.slice();

    if (favoritesOnly.value) {
      list = list.filter((game) => game.isFavorite);
    }

    if (query) {
      list = list.filter((game) => game.title.toLowerCase().includes(query));
    }

    switch (sort.value) {
      case "title-asc":
        list.sort((a, b) => a.title.localeCompare(b.title, "es", { sensitivity: "base" }));
        break;
      case "title-desc":
        list.sort((a, b) => b.title.localeCompare(a.title, "es", { sensitivity: "base" }));
        break;
      case "oldest":
        list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        break;
      case "favorites-first":
        list.sort((a, b) => {
          if (a.isFavorite === b.isFavorite) {
            return b.createdAt.localeCompare(a.createdAt);
          }
          return a.isFavorite ? -1 : 1;
        });
        break;
      case "newest":
      default:
        list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        break;
    }

    return list;
  });

  /**
   * Pull de biblioteca cloud (fuente de verdad para fichas de catálogo).
   * Crea locales faltantes sin ROM; elimina locales con catalogRemoteId que ya no están en el servidor.
   */
  async function syncCloudLibrary(): Promise<void> {
    const token = await sessionStorage.getToken();
    if (!token) return;

    let remote;
    try {
      remote = await libraryApiService.list();
    } catch (err) {
      console.warn("[library] Sync cloud falló:", err);
      return;
    }

    const remoteIds = new Set(remote.map((e) => e.catalogGameId));

    for (const entry of remote) {
      try {
        await catalogInstallService.addToLibrary(entry.catalogGameId, {
          syncCloud: false,
          allowExisting: true,
        });
      } catch (err) {
        console.warn(
          "[library] No se pudo materializar ficha",
          entry.catalogGameId,
          err,
        );
      }
    }

    const locals = await gameService.listGames();
    for (const game of locals) {
      const remoteId = game.catalogRemoteId?.trim();
      if (!remoteId) continue;
      if (remoteIds.has(remoteId)) continue;
      try {
        await usePlayHistoryStore().deleteGameHistory(game.id);
        await gameService.deleteGame(game.id);
      } catch (err) {
        console.warn("[library] No se pudo quitar ficha local huérfana:", err);
      }
    }
  }

  async function loadLibrary(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      if (!ready.value) {
        await localDbService.init();
        ready.value = true;
      }
      // Primero lo local (portadas/cards al toque); el sync cloud después.
      games.value = await gameService.listGames();
      loading.value = false;

      const covers = useCatalogCoversStore();
      await Promise.all([syncCloudLibrary(), covers.refresh()]);
      games.value = await gameService.listGames();
    } catch (err) {
      error.value = userFacingError(
        err,
        "No se pudo cargar la biblioteca. Revisa que Blaze esté corriendo en modo desktop.",
      );
    } finally {
      loading.value = false;
    }
  }

  async function createGame(input: GameWritableFields): Promise<Game> {
    error.value = null;
    try {
      const created = await gameService.createGame(input);
      games.value = [created, ...games.value.filter((g) => g.id !== created.id)];
      selectedGameId.value = created.id;
      return created;
    } catch (err) {
      const message = userFacingError(err, "No se pudo crear el juego.");
      error.value = message;
      throw new Error(message);
    }
  }

  async function updateGame(id: string, input: GameWritableFields): Promise<Game> {
    error.value = null;
    try {
      const updated = await gameService.updateGame(id, input);
      games.value = games.value.map((game) => (game.id === id ? updated : game));
      selectedGameId.value = updated.id;
      return updated;
    } catch (err) {
      const message = userFacingError(err, "No se pudo actualizar el juego.");
      error.value = message;
      throw new Error(message);
    }
  }

  async function deleteGame(id: string): Promise<void> {
    error.value = null;
    try {
      const current =
        games.value.find((game) => game.id === id) ??
        (await gameService.getGame(id));
      if (current?.catalogRemoteId?.trim()) {
        await libraryApiService.remove(current.catalogRemoteId);
      }
      await usePlayHistoryStore().deleteGameHistory(id);
      await gameService.deleteGame(id);
      games.value = games.value.filter((game) => game.id !== id);
      if (selectedGameId.value === id) {
        selectedGameId.value = null;
      }
    } catch (err) {
      const message = userFacingError(err, "No se pudo eliminar el juego.");
      error.value = message;
      throw new Error(message);
    }
  }

  async function toggleFavorite(id: string): Promise<void> {
    const current = games.value.find((game) => game.id === id);
    if (!current) {
      error.value = "El juego no existe.";
      return;
    }
    error.value = null;
    try {
      const updated = await gameService.setFavorite(id, !current.isFavorite);
      games.value = games.value.map((game) => (game.id === id ? updated : game));
    } catch (err) {
      error.value = userFacingError(err, "No se pudo actualizar el favorito.");
    }
  }

  async function setRetroAchievementsGameId(
    id: string,
    raGameId: number | null,
    options?: { coverUrl?: string | null },
  ): Promise<void> {
    error.value = null;
    try {
      let updated = await gameService.setRetroAchievementsGameId(id, raGameId);
      if (options?.coverUrl) {
        updated = await gameService.applyCoverIfEmpty(id, options.coverUrl);
      }
      // Sync ID RA al catálogo para portadas en Juegos (fallback media RA).
      if (updated.catalogRemoteId) {
        const covers = useCatalogCoversStore();
        try {
          const catalogGame = await catalogApiService.update(
            updated.catalogRemoteId,
            { retroAchievementsGameId: raGameId },
          );
          covers.ingest([catalogGame], { merge: true });
        } catch {
          // La biblioteca local ya quedó; el catálogo se puede refrescar después.
        }
        if (options?.coverUrl?.trim()) {
          covers.setCover(updated.catalogRemoteId, options.coverUrl);
        }
      }
      games.value = games.value.map((game) => (game.id === id ? updated : game));
    } catch (err) {
      const message = userFacingError(
        err,
        "No se pudo guardar el vínculo con RetroAchievements.",
      );
      error.value = message;
      throw new Error(message);
    }
  }

  async function publishGame(id: string): Promise<{
    game: Game;
    identifyMessage: string | null;
  }> {
    error.value = null;
    try {
      const result = await gamePublishService.publish(id);
      games.value = games.value.map((game) =>
        game.id === id ? result.game : game,
      );
      selectedGameId.value = result.game.id;
      return {
        game: result.game,
        identifyMessage: result.identifyMessage,
      };
    } catch (err) {
      const message = userFacingError(err, "No se pudo guardar el juego.");
      error.value = message;
      throw new Error(message);
    }
  }

  function selectGame(id: string | null): void {
    selectedGameId.value = id;
  }

  function getGameById(id: string): Game | undefined {
    return games.value.find((game) => game.id === id);
  }

  return {
    games,
    loading,
    error,
    search,
    sort,
    favoritesOnly,
    selectedGameId,
    ready,
    filteredGames,
    loadLibrary,
    createGame,
    updateGame,
    deleteGame,
    publishGame,
    toggleFavorite,
    setRetroAchievementsGameId,
    selectGame,
    getGameById,
  };
});
