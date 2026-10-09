import { invoke } from "@tauri-apps/api/core";

export type ApplyRaCredentialsResult = {
  retroarch: boolean;
  pcsx2: boolean;
};

/**
 * Escribe usuario/contraseña RA en RetroArch + PCSX2 managed (AppData).
 * Llamar solo en el momento del login (la contraseña no se persiste en Blaze).
 */
export async function applyManagedRaCredentials(
  username: string,
  password: string,
): Promise<ApplyRaCredentialsResult> {
  return invoke<ApplyRaCredentialsResult>("apply_managed_ra_credentials", {
    username,
    password,
  });
}
