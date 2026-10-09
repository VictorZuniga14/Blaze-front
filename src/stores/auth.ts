import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { authService } from "../services/auth.service";
import { ApiError } from "../services/api.client";
import { applyManagedRaCredentials } from "../services/raCredentials.service";
import type { LoginInput, PublicUser } from "../types/auth";

function userFacingError(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export const useAuthStore = defineStore("auth", () => {
  const user = ref<PublicUser | null>(null);
  const isLoading = ref(false);
  const initialized = ref(false);
  const error = ref<string | null>(null);

  const isAuthenticated = computed(() => user.value != null);
  const isDev = computed(() => user.value?.role === "dev");

  async function initialize(): Promise<void> {
    if (initialized.value) return;
    isLoading.value = true;
    error.value = null;
    try {
      user.value = await authService.getCurrentUser();
    } catch {
      user.value = null;
    } finally {
      isLoading.value = false;
      initialized.value = true;
    }
  }

  async function login(input: LoginInput): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      const result = await authService.login(input);
      user.value = result.user;
      // Login Blaze = login RA → configurar emuladores managed (no se guarda la pass en Blaze).
      try {
        const applied = await applyManagedRaCredentials(
          input.username.trim(),
          input.password,
        );
        console.info("[Blaze] RA aplicado a emuladores:", applied);
      } catch (applyErr) {
        console.error("[Blaze] No se pudo aplicar RA a emuladores:", applyErr);
      }
    } catch (err) {
      const message = userFacingError(err, "No se pudo iniciar sesión.");
      error.value = message;
      throw new Error(message);
    } finally {
      isLoading.value = false;
    }
  }

  async function logout(): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
      await authService.logout();
    } catch {
      // local clear already in service finally
    } finally {
      user.value = null;
      isLoading.value = false;
    }
  }

  return {
    user,
    isAuthenticated,
    isDev,
    isLoading,
    initialized,
    error,
    initialize,
    login,
    logout,
  };
});
