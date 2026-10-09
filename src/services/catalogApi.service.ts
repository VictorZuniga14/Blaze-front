import { apiRequest } from "./api.client";
import { sessionStorage } from "./sessionStorage.service";
import type {
  CatalogGame,
  CatalogUploadPlan,
  OrphanUploadPlan,
  R2OrphanObject,
} from "../types/catalog";

async function tokenOrThrow(): Promise<string> {
  const token = await sessionStorage.getToken();
  if (!token) {
    throw new Error("Tenés que iniciar sesión para usar el catálogo.");
  }
  return token;
}

export const catalogApiService = {
  async list(): Promise<CatalogGame[]> {
    const token = await tokenOrThrow();
    const result = await apiRequest<{ games: CatalogGame[] }>(
      "/api/catalog/games",
      { token },
    );
    return result.games;
  },

  async get(id: string): Promise<CatalogGame> {
    const token = await tokenOrThrow();
    const result = await apiRequest<{ game: CatalogGame }>(
      `/api/catalog/games/${encodeURIComponent(id)}`,
      { token },
    );
    return result.game;
  },

  async startPublish(body: {
    localSourceGameId: string;
    title: string;
    description?: string | null;
    platform: string;
    developer?: string | null;
    genre?: string | null;
    releaseYear?: number | null;
    retroAchievementsGameId?: number | null;
    fileName: string;
    contentType?: string;
    fileSizeBytes: number;
    coverFileName?: string | null;
    coverContentType?: string | null;
    coverFileSizeBytes?: number | null;
  }): Promise<CatalogUploadPlan> {
    const token = await tokenOrThrow();
    return apiRequest<CatalogUploadPlan>("/api/catalog/games", {
      method: "POST",
      token,
      body,
    });
  },

  async partUrl(
    gameId: string,
    partNumber: number,
  ): Promise<{ uploadUrl: string; partNumber: number }> {
    const token = await tokenOrThrow();
    return apiRequest(
      `/api/catalog/games/${encodeURIComponent(gameId)}/parts/${partNumber}`,
      { token },
    );
  },

  async complete(
    gameId: string,
    parts?: Array<{ partNumber: number; etag: string }>,
  ): Promise<CatalogGame> {
    const token = await tokenOrThrow();
    const result = await apiRequest<{ game: CatalogGame }>(
      `/api/catalog/games/${encodeURIComponent(gameId)}/complete`,
      {
        method: "POST",
        token,
        body: parts ? { parts } : {},
      },
    );
    return result.game;
  },

  async downloadUrl(
    gameId: string,
  ): Promise<{ url: string; fileName: string; fileSizeBytes: string }> {
    const token = await tokenOrThrow();
    return apiRequest(
      `/api/catalog/games/${encodeURIComponent(gameId)}/download`,
      { token },
    );
  },

  async coverUrl(
    gameId: string,
  ): Promise<{ url: string; fileName: string }> {
    const token = await tokenOrThrow();
    return apiRequest(
      `/api/catalog/games/${encodeURIComponent(gameId)}/cover`,
      { token },
    );
  },

  async remove(gameId: string): Promise<void> {
    const token = await tokenOrThrow();
    await apiRequest(`/api/catalog/games/${encodeURIComponent(gameId)}`, {
      method: "DELETE",
      token,
    });
  },

  async listR2Orphans(): Promise<R2OrphanObject[]> {
    const token = await tokenOrThrow();
    const result = await apiRequest<{ objects: R2OrphanObject[] }>(
      "/api/catalog/r2-objects",
      { token },
    );
    return result.objects;
  },

  async update(
    gameId: string,
    body: { retroAchievementsGameId?: number | null },
  ): Promise<CatalogGame> {
    const token = await tokenOrThrow();
    const result = await apiRequest<{ game: CatalogGame }>(
      `/api/catalog/games/${encodeURIComponent(gameId)}`,
      { method: "PATCH", token, body },
    );
    return result.game;
  },

  async linkFromR2(body: {
    localSourceGameId?: string | null;
    storageKey: string;
    coverStorageKey?: string | null;
    title: string;
    description?: string | null;
    platform: string;
    developer?: string | null;
    genre?: string | null;
    releaseYear?: number | null;
    retroAchievementsGameId?: number | null;
  }): Promise<CatalogGame> {
    const token = await tokenOrThrow();
    const result = await apiRequest<{ game: CatalogGame }>(
      "/api/catalog/games/link-r2",
      { method: "POST", token, body },
    );
    return result.game;
  },

  async startOrphanUpload(body: {
    fileName: string;
    contentType?: string;
    fileSizeBytes: number;
  }): Promise<OrphanUploadPlan> {
    const token = await tokenOrThrow();
    return apiRequest<OrphanUploadPlan>("/api/catalog/r2-uploads", {
      method: "POST",
      token,
      body,
    });
  },

  async orphanPartUrl(
    storageKey: string,
    partNumber: number,
  ): Promise<{ uploadUrl: string; partNumber: number }> {
    const token = await tokenOrThrow();
    const q = new URLSearchParams({ key: storageKey });
    return apiRequest(
      `/api/catalog/r2-uploads/parts/${partNumber}?${q.toString()}`,
      { token },
    );
  },

  async completeOrphanUpload(
    storageKey: string,
    parts?: Array<{ partNumber: number; etag: string }>,
  ): Promise<R2OrphanObject> {
    const token = await tokenOrThrow();
    const result = await apiRequest<{ object: R2OrphanObject }>(
      "/api/catalog/r2-uploads/complete",
      {
        method: "POST",
        token,
        body: parts ? { storageKey, parts } : { storageKey },
      },
    );
    return result.object;
  },

  async deleteR2Object(storageKey: string): Promise<void> {
    const token = await tokenOrThrow();
    const q = new URLSearchParams({ key: storageKey });
    await apiRequest(`/api/catalog/r2-objects?${q.toString()}`, {
      method: "DELETE",
      token,
    });
  },
};
