import { invoke } from "@tauri-apps/api/core";
import { runtimeRepository } from "../repositories/runtime.repository";
import type { Runtime } from "../types/runtime";
import type { EmulatorRaStatus } from "../types/retroAchievements";
import {
  isPcsx2Runtime,
  isRaCapableRuntime,
  isRetroArchRuntime,
  resolveRaAdapter,
} from "./ra";

export { isPcsx2Runtime, isRaCapableRuntime, isRetroArchRuntime };

function rankStatus(status: EmulatorRaStatus): number {
  switch (status.status) {
    case "ready":
      return 4;
    case "disabled":
      return 3;
    case "not_configured":
      return 2;
    case "unsupported":
      return 1;
    default:
      return 0;
  }
}

export const raEmulatorService = {
  async inspect(executablePath: string): Promise<EmulatorRaStatus> {
    // Fallback directo al inspector unificado (también usado por adapters).
    return invoke<EmulatorRaStatus>("inspect_emulator_retroachievements", {
      executablePath,
    });
  },

  async inspectViaAdapter(runtime: Runtime): Promise<EmulatorRaStatus> {
    const adapter = resolveRaAdapter(runtime);
    if (!adapter) {
      return this.inspect(runtime.executablePath);
    }
    return adapter.detectState(runtime);
  },

  async openForConfiguration(executablePath: string): Promise<void> {
    await invoke("open_emulator_for_configuration", { executablePath });
  },

  async listRaCapableRuntimes(): Promise<Runtime[]> {
    const runtimes = await runtimeRepository.findAll();
    return runtimes.filter(isRaCapableRuntime);
  },

  /** Mejor estado entre todos los runtimes RA-capable de Blaze. */
  async inspectBestFromBlazeRuntimes(): Promise<{
    runtime: Runtime | null;
    status: EmulatorRaStatus | null;
    all: Array<{ runtime: Runtime; status: EmulatorRaStatus }>;
  }> {
    const capable = await this.listRaCapableRuntimes();
    if (capable.length === 0) {
      return { runtime: null, status: null, all: [] };
    }

    const all: Array<{ runtime: Runtime; status: EmulatorRaStatus }> = [];
    for (const runtime of capable) {
      try {
        const status = await this.inspectViaAdapter(runtime);
        all.push({ runtime, status });
      } catch {
        // skip failed inspect
      }
    }

    all.sort((a, b) => rankStatus(b.status) - rankStatus(a.status));
    const best = all[0] ?? null;
    return {
      runtime: best?.runtime ?? null,
      status: best?.status ?? null,
      all,
    };
  },

  /** Prefiere el runtime del juego; si no hay username, cae al mejor global. */
  async resolveUsernameForProgress(
    preferredExecutablePath: string | null,
  ): Promise<{ username: string | null; source: EmulatorRaStatus | null }> {
    if (preferredExecutablePath) {
      try {
        const preferred = await this.inspect(preferredExecutablePath);
        if (preferred.username) {
          return { username: preferred.username, source: preferred };
        }
      } catch {
        // fall through
      }
    }
    const best = await this.inspectBestFromBlazeRuntimes();
    return {
      username: best.status?.username ?? null,
      source: best.status,
    };
  },
};
