import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  isPcsx2Runtime,
  isRetroArchRuntime,
  raEmulatorService,
} from "../services/raEmulator.service";
import type { EmulatorRaStatus } from "../types/retroAchievements";
import type { Runtime } from "../types/runtime";

function userFacingError(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export type RaRuntimeEntry = {
  runtime: Runtime;
  status: EmulatorRaStatus;
};

export const usePcsx2RaStore = defineStore("pcsx2Ra", () => {
  const entries = ref<RaRuntimeEntry[]>([]);
  const runtime = ref<Runtime | null>(null);
  const status = ref<EmulatorRaStatus | null>(null);
  const loading = ref(false);
  const opening = ref(false);
  const error = ref<string | null>(null);

  const indicator = computed(() => {
    const code = status.value?.status;
    if (entries.value.length === 0) {
      return { color: "slate", label: "Sin Runtime PCSX2/RetroArch" };
    }
    if (!status.value) return { color: "slate", label: "Sin datos" };
    switch (code) {
      case "ready":
        return { color: "emerald", label: status.value.statusLabel };
      case "disabled":
        return { color: "amber", label: status.value.statusLabel };
      case "not_configured":
        return { color: "rose", label: status.value.statusLabel };
      default:
        return { color: "slate", label: status.value.statusLabel };
    }
  });

  async function refresh(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const result = await raEmulatorService.inspectBestFromBlazeRuntimes();
      entries.value = result.all;
      runtime.value = result.runtime;
      status.value = result.status;
      if (!result.runtime) {
        error.value =
          "No hay Runtime PCSX2 ni RetroArch en Blaze. Configuralos en Runtimes.";
      }
    } catch (err) {
      error.value = userFacingError(
        err,
        "No se pudo consultar el estado de RetroAchievements.",
      );
      status.value = null;
      entries.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function openEmulator(runtimeToOpen?: Runtime | null): Promise<void> {
    const target = runtimeToOpen ?? runtime.value;
    if (!target) {
      error.value = "No hay un emulador RA configurado.";
      return;
    }
    opening.value = true;
    error.value = null;
    try {
      await raEmulatorService.openForConfiguration(target.executablePath);
    } catch (err) {
      error.value = userFacingError(err, "No se pudo abrir el emulador.");
    } finally {
      opening.value = false;
    }
  }

  async function openPcsx2(): Promise<void> {
    const pcsx2 = entries.value.find((e) => isPcsx2Runtime(e.runtime));
    await openEmulator(pcsx2?.runtime ?? null);
  }

  async function openRetroArch(): Promise<void> {
    const ra = entries.value.find((e) => isRetroArchRuntime(e.runtime));
    await openEmulator(ra?.runtime ?? null);
  }

  return {
    entries,
    runtime,
    status,
    loading,
    opening,
    error,
    indicator,
    refresh,
    openEmulator,
    openPcsx2,
    openRetroArch,
  };
});
