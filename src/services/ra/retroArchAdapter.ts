import { invoke } from "@tauri-apps/api/core";
import type { Runtime } from "../../types/runtime";
import {
  resolveRaConsole,
  supportsRaIdentify,
} from "../../utils/raConsoles";
import type {
  IdentifyContentOptions,
  RetroAchievementsAdapter,
  RetroAchievementsIdentification,
  RetroAchievementsState,
} from "./types";

/**
 * Adapter RetroArch: cheevos en retroarch.cfg + hashing por Game.platform.
 * No deduce consola por extensión (.iso es ambiguo).
 */
export const retroArchAdapter: RetroAchievementsAdapter = {
  kind: "retroarch",

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
    options?: IdentifyContentOptions,
  ): Promise<RetroAchievementsIdentification> {
    const resolved = resolveRaConsole({
      platform: options?.platform,
      runtimeKind: "retroarch",
    });
    if (!resolved) {
      throw new Error(
        "Indicá la plataforma del juego (ej. SNES, GBA). RetroArch no puede deducirla solo del archivo.",
      );
    }
    if (!supportsRaIdentify(resolved.key)) {
      throw new Error(
        `Identificación automática aún no soportada para ${resolved.label}. Usá mapping manual.`,
      );
    }

    return invoke<RetroAchievementsIdentification>("identify_ra_content", {
      path: contentPath,
      emulator: "retroarch",
      consoleKey: resolved.key,
      consoleId: resolved.consoleId,
    });
  },
};
