import { invoke } from "@tauri-apps/api/core";
import { runtimeRepository } from "../repositories/runtime.repository";
import type { Runtime } from "../types/runtime";
import type { Pcsx2RaStatus } from "../types/retroAchievements";

function looksLikePcsx2(runtime: Runtime): boolean {
  const name = runtime.name.toLowerCase();
  const path = runtime.executablePath.toLowerCase();
  return (
    name.includes("pcsx2") ||
    path.includes("pcsx2-qt.exe") ||
    path.includes("pcsx2.exe")
  );
}

export const pcsx2RaService = {
  async findPcsx2Runtime(): Promise<Runtime | null> {
    const runtimes = await runtimeRepository.findAll();
    return runtimes.find(looksLikePcsx2) ?? null;
  },

  async findPcsx2RuntimeById(runtimeId: string | null): Promise<Runtime | null> {
    if (!runtimeId) return null;
    const runtime = await runtimeRepository.findById(runtimeId);
    if (!runtime) return null;
    return looksLikePcsx2(runtime) ? runtime : null;
  },

  async inspect(executablePath: string): Promise<Pcsx2RaStatus> {
    return invoke<Pcsx2RaStatus>("inspect_pcsx2_retroachievements", {
      executablePath,
    });
  },

  async openPcsx2ForConfiguration(executablePath: string): Promise<void> {
    await invoke("open_pcsx2_for_configuration", { executablePath });
  },

  async inspectFromBlazeRuntime(): Promise<{
    runtime: Runtime | null;
    status: Pcsx2RaStatus | null;
  }> {
    const runtime = await this.findPcsx2Runtime();
    if (!runtime) {
      return { runtime: null, status: null };
    }
    const status = await this.inspect(runtime.executablePath);
    return { runtime, status };
  },
};
