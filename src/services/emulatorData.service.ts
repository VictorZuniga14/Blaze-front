import { invoke } from "@tauri-apps/api/core";

export type EmulatorSetupStatus = {
  pcsx2BiosDir: string;
  pcsx2BiosFound: boolean;
  retroarchSystemDir: string;
};

/** Prepara carpetas managed de PCSX2/RetroArch al arranque. No descarga BIOS. */
export async function initializeBlazeEmulators(): Promise<EmulatorSetupStatus> {
  return invoke<EmulatorSetupStatus>("initialize_emulator_data");
}
