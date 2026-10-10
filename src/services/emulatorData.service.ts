import { invoke } from "@tauri-apps/api/core";

export type EmulatorSetupStatus = {
  pcsx2BiosDir: string;
  pcsx2BiosFound: boolean;
  retroarchSystemDir: string;
  edenKeysDir: string;
  edenKeysFound: boolean;
  edenFirmwareFound: boolean;
};

/** Prepara carpetas managed de PCSX2/RetroArch/Eden al arranque. No descarga dumps. */
export async function initializeBlazeEmulators(): Promise<EmulatorSetupStatus> {
  return invoke<EmulatorSetupStatus>("initialize_emulator_data");
}

export async function openManagedPcsx2BiosFolder(): Promise<string> {
  return invoke<string>("open_managed_pcsx2_bios_folder");
}

export async function openManagedEdenKeysFolder(): Promise<string> {
  return invoke<string>("open_managed_eden_keys_folder");
}

export async function importEdenFirmwareZip(zipPath: string): Promise<string> {
  return invoke<string>("import_eden_firmware_zip", { zipPath });
}
