import { apiRequest } from "./api.client";
import { sessionStorage } from "./sessionStorage.service";
import type { PlaySessionStart, PlayStats } from "../types/playHistory";

async function authToken(): Promise<string | null> {
  return sessionStorage.getToken();
}

export const playHistoryService = {
  async start(gameId: string): Promise<PlaySessionStart> {
    const token = await authToken();
    return apiRequest<PlaySessionStart>("/api/play-sessions", {
      method: "POST",
      token,
      body: { gameId },
    });
  },

  async finish(sessionId: string): Promise<void> {
    const token = await authToken();
    await apiRequest(`/api/play-sessions/${encodeURIComponent(sessionId)}/finish`, {
      method: "POST",
      token,
    });
  },

  async abandonOpen(): Promise<void> {
    const token = await authToken();
    await apiRequest("/api/play-sessions/abandon-open", {
      method: "POST",
      token,
    });
  },

  async deleteForGame(gameId: string): Promise<void> {
    const token = await authToken();
    const params = new URLSearchParams({ gameId });
    await apiRequest(`/api/play-sessions?${params.toString()}`, {
      method: "DELETE",
      token,
    });
  },

  async getStats(): Promise<PlayStats> {
    const token = await authToken();
    return apiRequest<PlayStats>("/api/play-sessions/stats", { token });
  },
};
