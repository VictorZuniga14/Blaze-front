import { apiRequest } from "./api.client";
import { sessionStorage } from "./sessionStorage.service";
import type { CatalogGame } from "../types/catalog";

export type CloudLibraryEntry = {
  catalogGameId: string;
  createdAt: string;
  game: CatalogGame;
};

async function tokenOrNull(): Promise<string | null> {
  return sessionStorage.getToken();
}

async function tokenOrThrow(): Promise<string> {
  const token = await tokenOrNull();
  if (!token) {
    throw new Error("Tenés que iniciar sesión para sincronizar la biblioteca.");
  }
  return token;
}

export const libraryApiService = {
  async list(): Promise<CloudLibraryEntry[]> {
    const token = await tokenOrThrow();
    const result = await apiRequest<{ entries: CloudLibraryEntry[] }>(
      "/api/library",
      { token },
    );
    return result.entries ?? [];
  },

  /** Best-effort: no tira si no hay sesión (push opcional). */
  async add(catalogGameId: string): Promise<CloudLibraryEntry | null> {
    const token = await tokenOrNull();
    if (!token) return null;
    const result = await apiRequest<{ entry: CloudLibraryEntry }>(
      "/api/library",
      {
        method: "POST",
        token,
        body: { catalogGameId },
      },
    );
    return result.entry;
  },

  /** Best-effort remove; 404/red no rompen el borrado local. */
  async remove(catalogGameId: string): Promise<void> {
    const token = await tokenOrNull();
    if (!token) return;
    try {
      await apiRequest<{ deleted: boolean }>(
        `/api/library/${encodeURIComponent(catalogGameId)}`,
        { method: "DELETE", token },
      );
    } catch (err) {
      console.warn("[library] No se pudo quitar de la nube:", err);
    }
  },
};
