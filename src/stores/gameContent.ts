import { defineStore } from "pinia";
import { ref } from "vue";
import { gameContentService } from "../services/gameContent.service";
import type { GameContent } from "../types/gameContent";

function userFacingError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export const useGameContentStore = defineStore("gameContent", () => {
  const content = ref<GameContent | null>(null);
  const fileExists = ref(true);
  const loading = ref(false);
  const saving = ref(false);
  const error = ref<string | null>(null);

  async function loadContent(gameId: string): Promise<void> {
    loading.value = true;
    error.value = null;
    fileExists.value = true;
    try {
      content.value = await gameContentService.getByGameId(gameId);
      if (content.value) {
        fileExists.value = await gameContentService.pathExists(content.value.path);
      }
    } catch (err) {
      error.value = userFacingError(err, "No se pudo cargar el contenido.");
      content.value = null;
    } finally {
      loading.value = false;
    }
  }

  async function associateContent(gameId: string, path: string): Promise<GameContent> {
    saving.value = true;
    error.value = null;
    try {
      const saved = await gameContentService.associate({ gameId, path });
      content.value = saved;
      fileExists.value = true;
      return saved;
    } catch (err) {
      const message = userFacingError(err, "No se pudo asociar el contenido.");
      error.value = message;
      throw new Error(message);
    } finally {
      saving.value = false;
    }
  }

  async function removeContent(gameId: string): Promise<void> {
    saving.value = true;
    error.value = null;
    try {
      await gameContentService.remove(gameId);
      content.value = null;
      fileExists.value = true;
    } catch (err) {
      const message = userFacingError(err, "No se pudo quitar el contenido.");
      error.value = message;
      throw new Error(message);
    } finally {
      saving.value = false;
    }
  }

  function clear(): void {
    content.value = null;
    fileExists.value = true;
    loading.value = false;
    saving.value = false;
    error.value = null;
  }

  return {
    content,
    fileExists,
    loading,
    saving,
    error,
    loadContent,
    associateContent,
    removeContent,
    clear,
  };
});
