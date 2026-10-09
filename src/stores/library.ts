import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { gameService } from "../services/game.service";
import { catalogApiService } from "../services/catalogApi.service";
import { localDbService } from "../services/localDb.service";
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

  async function loadLibrary(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      if (!ready.value) {
        await localDbService.init();
        ready.value = true;
      }
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
