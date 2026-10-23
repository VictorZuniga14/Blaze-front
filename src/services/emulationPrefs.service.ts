import { invoke } from "@tauri-apps/api/core";
import {
  getDefaultEmulatorConfig,
  type EmulatorConfig,
} from "./emulatorConfigService";

export type EmulationRuntimeKind = "pcsx2" | "retroarch" | "eden";

export type EmulationKindPrefs = {
  fullscreen: boolean;
  resolutionScale: number;
  renderer: string;
  vsync: boolean;
  audioEngine: string;
  volume: number;
};

export type EmulationPrefsFile = {
  pcsx2?: EmulationKindPrefs | null;
  retroarch?: EmulationKindPrefs | null;
  eden?: EmulationKindPrefs | null;
};

function fromConfig(cfg: EmulatorConfig): EmulationKindPrefs {
  return {
    fullscreen: cfg.fullscreen,
    resolutionScale: cfg.resolutionScale,
    renderer: cfg.renderer,
    vsync: cfg.vsync,
    audioEngine: cfg.audioEngine,
    volume: cfg.volume,
  };
}

function normalizeKind(
  raw: EmulationKindPrefs | null | undefined,
  fallback: EmulationKindPrefs,
): EmulationKindPrefs {
  if (!raw) return { ...fallback };
  return {
    fullscreen: Boolean(raw.fullscreen),
    resolutionScale: Math.max(1, Number(raw.resolutionScale) || fallback.resolutionScale),
    renderer: (raw.renderer || fallback.renderer).trim() || fallback.renderer,
    vsync: Boolean(raw.vsync),
    audioEngine: (raw.audioEngine || fallback.audioEngine).trim() || fallback.audioEngine,
    volume: Math.min(100, Math.max(0, Number(raw.volume) ?? fallback.volume)),
  };
}

export const emulationPrefsService = {
  async defaults(): Promise<EmulationPrefsFile> {
    try {
      return await invoke<EmulationPrefsFile>("default_emulation_prefs");
    } catch {
      const [pcsx2, retroarch, eden] = await Promise.all([
        getDefaultEmulatorConfig("pcsx2"),
        getDefaultEmulatorConfig("retroarch"),
        getDefaultEmulatorConfig("eden"),
      ]);
      return {
        pcsx2: fromConfig(pcsx2),
        retroarch: fromConfig(retroarch),
        eden: fromConfig(eden),
      };
    }
  },

  async get(): Promise<Required<EmulationPrefsFile>> {
    const defaults = await this.defaults();
    let stored: EmulationPrefsFile = {};
    try {
      stored = await invoke<EmulationPrefsFile>("load_emulation_prefs_cmd");
    } catch {
      stored = {};
    }
    return {
      pcsx2: normalizeKind(stored.pcsx2, defaults.pcsx2!),
      retroarch: normalizeKind(stored.retroarch, defaults.retroarch!),
      eden: normalizeKind(stored.eden, defaults.eden!),
    };
  },

  async set(prefs: Required<EmulationPrefsFile>): Promise<void> {
    await invoke("save_emulation_prefs", { prefs });
  },
};
