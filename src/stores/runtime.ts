import { defineStore } from "pinia";
import { ref } from "vue";
import { runtimeService } from "../services/runtime.service";
import type { Runtime, RuntimeInput } from "../types/runtime";

function userFacingError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export const useRuntimeStore = defineStore("runtime", () => {
  const runtimes = ref<Runtime[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function loadRuntimes(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      runtimes.value = await runtimeService.list();
    } catch (err) {
      error.value = userFacingError(err, "No se pudieron cargar los runtimes.");
    } finally {
      loading.value = false;
    }
  }

  async function createRuntime(input: RuntimeInput): Promise<Runtime> {
    error.value = null;
    try {
      const created = await runtimeService.create(input);
      runtimes.value = [...runtimes.value, created].sort((a, b) =>
        a.name.localeCompare(b.name, "es", { sensitivity: "base" }),
      );
      return created;
    } catch (err) {
      const message = userFacingError(err, "No se pudo crear el runtime.");
      error.value = message;
      throw new Error(message);
    }
  }

  async function updateRuntime(id: string, input: RuntimeInput): Promise<Runtime> {
    error.value = null;
    try {
      const updated = await runtimeService.update(id, input);
      runtimes.value = runtimes.value
        .map((r) => (r.id === id ? updated : r))
        .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
      return updated;
    } catch (err) {
      const message = userFacingError(err, "No se pudo actualizar el runtime.");
      error.value = message;
      throw new Error(message);
    }
  }

  async function deleteRuntime(id: string): Promise<void> {
    error.value = null;
    try {
      await runtimeService.delete(id);
      runtimes.value = runtimes.value.filter((r) => r.id !== id);
    } catch (err) {
      const message = userFacingError(err, "No se pudo eliminar el runtime.");
      error.value = message;
      throw new Error(message);
    }
  }

  return {
    runtimes,
    loading,
    error,
    loadRuntimes,
    createRuntime,
    updateRuntime,
    deleteRuntime,
  };
});
