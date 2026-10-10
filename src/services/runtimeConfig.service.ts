import { invoke } from "@tauri-apps/api/core";

export type AudioDeviceInfo = { id: string; name: string };
export type GameControllerInfo = { id: string; name: string };
export type RuntimeAudioSettings = {
  runtimeKind: string;
  outputEngine: string;
  outputDevice: string;
  volume: number;
  engines: string[];
};

export type RuntimeVideoSettings = {
  runtimeKind: string;
  fullscreen: boolean;
  resolutionScale: number;
  scaleOptions: number[];
};

export const runtimeConfigService = {
  listAudioDevices(): Promise<AudioDeviceInfo[]> {
    return invoke("list_audio_output_devices");
  },

  listControllers(): Promise<GameControllerInfo[]> {
    return invoke("list_game_controllers");
  },

  readAudio(input: {
    executablePath: string;
    runtimeKind: string;
    runtimeSource?: string | null;
  }): Promise<RuntimeAudioSettings> {
    return invoke("read_runtime_audio_settings", {
      executablePath: input.executablePath,
      runtimeKind: input.runtimeKind,
      runtimeSource: input.runtimeSource ?? null,
    });
  },

  writeAudio(input: {
    executablePath: string;
    runtimeKind: string;
    runtimeSource?: string | null;
    outputEngine: string;
    outputDevice: string;
    volume: number;
  }): Promise<void> {
    return invoke("write_runtime_audio_settings", {
      executablePath: input.executablePath,
      runtimeKind: input.runtimeKind,
      runtimeSource: input.runtimeSource ?? null,
      outputEngine: input.outputEngine,
      outputDevice: input.outputDevice,
      volume: input.volume,
    });
  },

  readVideo(input: {
    executablePath: string;
    runtimeKind: string;
    runtimeSource?: string | null;
  }): Promise<RuntimeVideoSettings> {
    return invoke("read_runtime_video_settings", {
      executablePath: input.executablePath,
      runtimeKind: input.runtimeKind,
      runtimeSource: input.runtimeSource ?? null,
    });
  },

  writeVideo(input: {
    executablePath: string;
    runtimeKind: string;
    runtimeSource?: string | null;
    fullscreen: boolean;
    resolutionScale: number;
  }): Promise<void> {
    return invoke("write_runtime_video_settings", {
      executablePath: input.executablePath,
      runtimeKind: input.runtimeKind,
      runtimeSource: input.runtimeSource ?? null,
      fullscreen: input.fullscreen,
      resolutionScale: input.resolutionScale,
    });
  },

  openEmulatorUi(input: {
    executablePath: string;
    runtimeKind: string;
    runtimeSource?: string | null;
  }): Promise<void> {
    return invoke("launch_runtime_config_ui", {
      executablePath: input.executablePath,
      runtimeKind: input.runtimeKind,
      runtimeSource: input.runtimeSource ?? null,
    });
  },

  revealInExplorer(path: string): Promise<void> {
    return invoke("reveal_path_in_explorer", { path });
  },
};
