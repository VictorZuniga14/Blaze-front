import { invoke } from "@tauri-apps/api/core";
import type { Runtime } from "../../types/runtime";
import type {
  IdentifyContentOptions,
  RetroAchievementsAdapter,
  RetroAchievementsIdentification,
  RetroAchievementsState,
} from "./types";

/**
 * Adapter PCSX2: inspector PCSX2.ini + hashing PS2 (rcheevos).
 * La consola es siempre PS2 (el runtime la implica).
 */
export const pcsx2Adapter: RetroAchievementsAdapter = {
  kind: "pcsx2",

  supportsContentIdentification() {
    return true;
  },

  async detectState(runtime: Runtime): Promise<RetroAchievementsState> {
    return invoke<RetroAchievementsState>("inspect_emulator_retroachievements", {
      executablePath: runtime.executablePath,
      runtimeSource: runtime.source,
      runtimeType: runtime.type,
    });
  },

  async identifyContent(
    contentPath: string,
    _options?: IdentifyContentOptions,
  ): Promise<RetroAchievementsIdentification> {
    return invoke<RetroAchievementsIdentification>("identify_ra_content", {
      path: contentPath,
      emulator: "pcsx2",
      consoleKey: null,
      consoleId: null,
    });
  },
};
