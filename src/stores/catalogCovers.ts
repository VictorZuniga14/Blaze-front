import { defineStore } from "pinia";
import { ref } from "vue";
import { catalogApiService } from "../services/catalogApi.service";
import type { CatalogGame } from "../types/catalog";
import type { Game } from "../types/game";
import { resolveCoverSrc } from "../utils/coverSrc";

/**
 * Portadas del catálogo (API) indexadas por id remoto.
 * La biblioteca las reutiliza para verse igual que en Juegos.
 */
export const useCatalogCoversStore = defineStore("catalogCovers", () => {
  const byCatalogId = ref<Record<string, string>>({});
  const loaded = ref(false);

  function ingest(
    games: CatalogGame[],
    opts?: { merge?: boolean },
  ): void {
    const next: Record<string, string> = opts?.merge
      ? { ...byCatalogId.value }
      : {};
    for (const game of games) {
      if (game.coverUrl?.trim()) {
        next[game.id] = game.coverUrl.trim();
      } else if (opts?.merge) {
        delete next[game.id];
      }
    }
    byCatalogId.value = next;
    loaded.value = true;
  }

  function setCover(catalogId: string, coverUrl: string | null): void {
    const id = catalogId.trim();
    if (!id) return;
    const next = { ...byCatalogId.value };
    const url = coverUrl?.trim();
    if (url) next[id] = url;
    else delete next[id];
    byCatalogId.value = next;
  }

  async function refresh(): Promise<void> {
    try {
      const games = await catalogApiService.list();
      ingest(games);
    } catch {
      // Sin sesión o API caída: se mantiene el mapa previo / fallback local.
    }
  }

  /**
   * Preferí coverUrl del catálogo; si no hay (sin portada R2 / RA en BD),
   * usá coverPath local (p. ej. imageIcon de RA guardado al vincular).
   */
  function coverForGame(game: Game): string | null {
    const remoteId = game.catalogRemoteId?.trim();
    if (remoteId) {
      const fromApi = byCatalogId.value[remoteId];
      if (fromApi) return fromApi;
    }
    return resolveCoverSrc(game.coverPath);
  }

  return {
    byCatalogId,
    loaded,
    ingest,
    setCover,
    refresh,
    coverForGame,
  };
});
