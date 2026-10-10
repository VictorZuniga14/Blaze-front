import { invoke } from "@tauri-apps/api/core";

export type AudioDeviceInfo = { id: string; name: string };
export type GameControllerInfo = { id: string; name: string };
export type EdenAudioSettings = {
  outputEngine: string;
  outputDevice: string;
  volume: number;
};

export const edenConfigService = {
  listAudioDevices(): Promise<AudioDeviceInfo[]> {
    return invoke("list_audio_output_devices");
  },

  listControllers(): Promise<GameControllerInfo[]> {
    return invoke("list_game_controllers");
  },

  readAudio(executablePath: string): Promise<EdenAudioSettings> {
    return invoke("read_eden_audio_settings", { executablePath });
  },

  writeAudio(
    executablePath: string,
    settings: {
      outputEngine: string;
      outputDevice: string;
      volume: number;
    },
  ): Promise<void> {
    return invoke("write_eden_audio_settings", {
      executablePath,
      outputEngine: settings.outputEngine,
      outputDevice: settings.outputDevice,
      volume: settings.volume,
    });
  },

  openEdenUi(executablePath: string): Promise<void> {
    return invoke("launch_eden_config_ui", { executablePath });
  },

  revealInExplorer(path: string): Promise<void> {
    return invoke("reveal_path_in_explorer", { path });
  },
};
