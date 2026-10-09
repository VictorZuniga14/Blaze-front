import { apiRequest } from "./api.client";
import { sessionStorage } from "./sessionStorage.service";
import type {
  RaApiStatus,
  RaCachedProgressResponse,
  RaGameCandidate,
  RaGameProgress,
  RaIdentifyLookup,
  RaUserProfile,
} from "../types/retroAchievements";

async function authToken(): Promise<string | null> {
  return sessionStorage.getToken();
}

export const retroAchievementsApiService = {
  async getStatus(): Promise<RaApiStatus> {
    const token = await authToken();
    return apiRequest<RaApiStatus>("/api/retro-achievements/status", { token });
  },

  async getProfile(refresh = false): Promise<RaUserProfile> {
    const token = await authToken();
    const params = new URLSearchParams();
    if (refresh) params.set("refresh", "1");
    const qs = params.toString();
    return apiRequest<RaUserProfile>(
      `/api/retro-achievements/profile${qs ? `?${qs}` : ""}`,
      { token },
    );
  },

  async getProgress(input: {
    username: string;
    raGameId: number;
    refresh?: boolean;
  }): Promise<RaGameProgress> {
    const token = await authToken();
    const params = new URLSearchParams({
      username: input.username,
      raGameId: String(input.raGameId),
    });
    if (input.refresh) params.set("refresh", "1");
    return apiRequest<RaGameProgress>(
      `/api/retro-achievements/progress?${params.toString()}`,
      { token },
    );
  },

  /** Solo cache de memoria del backend. No dispara la Web API. */
  async getCachedProgress(input: {
    username: string;
    raGameIds: number[];
  }): Promise<RaCachedProgressResponse> {
    const token = await authToken();
    const params = new URLSearchParams({
      username: input.username,
      raGameIds: input.raGameIds.join(","),
    });
    return apiRequest<RaCachedProgressResponse>(
      `/api/retro-achievements/progress/cached?${params.toString()}`,
      { token },
    );
  },

  async search(input: {
    query: string;
    consoleId?: number;
  }): Promise<RaGameCandidate[]> {
    const token = await authToken();
    const params = new URLSearchParams({ q: input.query });
    if (input.consoleId != null) {
      params.set("consoleId", String(input.consoleId));
    }
    const data = await apiRequest<{ results: RaGameCandidate[] }>(
      `/api/retro-achievements/search?${params.toString()}`,
      { token },
    );
    return data.results ?? [];
  },

  /** hash oficial + consola → raGameId (Web API vía backend). */
  async identify(input: {
    console: string;
    hash: string;
  }): Promise<RaIdentifyLookup> {
    const token = await authToken();
    return apiRequest<RaIdentifyLookup>("/api/retro-achievements/identify", {
      method: "POST",
      token,
      body: {
        console: input.console,
        hash: input.hash,
      },
    });
  },
};
