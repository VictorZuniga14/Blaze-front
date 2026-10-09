import { apiRequest } from "./api.client";
import { sessionStorage } from "./sessionStorage.service";
import type { AuthResponse, LoginInput, PublicUser } from "../types/auth";

export const authService = {
  async login(input: LoginInput): Promise<AuthResponse> {
    const result = await apiRequest<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: input,
    });
    await sessionStorage.setToken(result.token);
    return result;
  },

  async logout(): Promise<void> {
    const token = await sessionStorage.getToken();
    try {
      if (token) {
        await apiRequest<{ ok: boolean }>("/api/auth/logout", {
          method: "POST",
          token,
        });
      }
    } finally {
      await sessionStorage.clearToken();
    }
  },

  async getCurrentUser(): Promise<PublicUser | null> {
    const token = await sessionStorage.getToken();
    if (!token) return null;
    try {
      const result = await apiRequest<{ user: PublicUser }>("/api/auth/me", {
        token,
      });
      return result.user;
    } catch {
      await sessionStorage.clearToken();
      return null;
    }
  },
};
