import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/** Busca update en GitHub Releases e instala sin preguntar. */
export async function checkAndPromptAppUpdate(): Promise<void> {
  // En `tauri:dev` el updater baja el .exe de Release y corre el instalador NSIS
  // (esa ventana "Blaze Setup"), lo que mata el proceso de desarrollo.
  if (import.meta.env.DEV) {
    console.info("[Blaze] Update check omitido (modo dev)");
    return;
  }

  try {
    const update = await check();
    if (!update) return;

    console.info(`[Blaze] Actualizando a ${update.version}...`);
    await update.downloadAndInstall();
    await relaunch();
  } catch (error) {
    // Sin red / sin latest.json firmado: no molestar al usuario.
    console.info("[Blaze] Update check omitido:", error);
  }
}
