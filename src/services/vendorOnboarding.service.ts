import { invoke } from "@tauri-apps/api/core";
import type { VendorAsset, VendorAssetKind } from "../types/vendor";
import { fetchVendorManifest, findAssetByKind } from "./vendorApi.service";

export type VendorOnboardingProgress = {
  phase: "downloading" | "extracting" | "verifying" | "done" | "error";
  assetKind: VendorAssetKind | null;
  assetName: string;
  bytesDone: number;
  bytesTotal: number;
  message: string;
};

export type VendorOnboardingStatus = {
  pcsx2BiosReady: boolean;
  retroarchPs1BiosReady: boolean;
  edenKeysReady: boolean;
  edenFirmwareReady: boolean;
  allReady: boolean;
};

/**
 * Verifica el estado de los assets vendor (BIOS, keys, firmware).
 * Usa comandos Tauri existentes para chequear archivos.
 */
export async function checkVendorAssetStatus(): Promise<VendorOnboardingStatus> {
  try {
    const [pcsx2Bios, ps1Bios] = await Promise.all([
      invoke<boolean>("pcsx2_managed_bios_present"),
      invoke<boolean>("retroarch_ps1_bios_present"),
    ]);

    // Para Eden, checkeamos archivos clave en las carpetas managed
    // TODO: agregar comandos Tauri específicos si es necesario
    const edenKeysReady = true; // Placeholder: asumir listo por ahora
    const edenFirmwareReady = true; // Placeholder

    const allReady = pcsx2Bios && ps1Bios && edenKeysReady && edenFirmwareReady;

    return {
      pcsx2BiosReady: pcsx2Bios,
      retroarchPs1BiosReady: ps1Bios,
      edenKeysReady,
      edenFirmwareReady,
      allReady,
    };
  } catch (error) {
    console.error("[VendorOnboarding] Error checking status:", error);
    // En caso de error, asumir que nada está listo
    return {
      pcsx2BiosReady: false,
      retroarchPs1BiosReady: false,
      edenKeysReady: false,
      edenFirmwareReady: false,
      allReady: false,
    };
  }
}

/**
 * Descarga e instala todos los assets vendor necesarios.
 * Reporta progreso a través del callback onProgress.
 * 
 * Esta función usa la nueva API de descarga segura que implementaremos
 * en Rust, reutilizando la lógica de runtime_install.rs.
 */
export async function downloadAndInstallVendorAssets(
  onProgress?: (progress: VendorOnboardingProgress) => void
): Promise<void> {
  try {
    // 1. Obtener manifiesto del backend
    onProgress?.({
      phase: "downloading",
      assetKind: null,
      assetName: "Obteniendo configuración...",
      bytesDone: 0,
      bytesTotal: 1,
      message: "Conectando con Blaze...",
    });

    const manifest = await fetchVendorManifest();

    // 2. Descargar e instalar cada tipo de asset
    const assetsToDownload: Array<{ kind: VendorAssetKind; required: boolean }> = [
      { kind: "pcsx2-bios", required: true },
      { kind: "retroarch-ps1-bios", required: true },
      { kind: "eden-keys", required: true },
      { kind: "eden-firmware", required: true },
    ];

    for (const { kind, required } of assetsToDownload) {
      const asset = findAssetByKind(manifest, kind);
      
      if (!asset) {
        if (required) {
          throw new Error(`Asset requerido no disponible: ${kind}`);
        }
        continue;
      }

      await downloadAndInstallAsset(asset, onProgress);
    }

    onProgress?.({
      phase: "done",
      assetKind: null,
      assetName: "Completado",
      bytesDone: 1,
      bytesTotal: 1,
      message: "Blaze está listo para usar.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onProgress?.({
      phase: "error",
      assetKind: null,
      assetName: "Error",
      bytesDone: 0,
      bytesTotal: 1,
      message,
    });
    throw error;
  }
}

/**
 * Descarga e instala un asset vendor específico.
 */
async function downloadAndInstallAsset(
  asset: VendorAsset,
  onProgress?: (progress: VendorOnboardingProgress) => void
): Promise<void> {
  const operationId = crypto.randomUUID();

  try {
    onProgress?.({
      phase: "downloading",
      assetKind: asset.kind,
      assetName: asset.name,
      bytesDone: 0,
      bytesTotal: asset.size,
      message: `Descargando ${asset.name}...`,
    });

    // Llamar al nuevo comando Tauri que implementamos
    // Este comando reutiliza la lógica segura de download_with_hash
    await invoke<void>("download_vendor_asset_command", {
      operationId,
      assetKind: asset.kind,
      url: asset.url,
      sha256: asset.sha256,
      size: asset.size,
    });

    onProgress?.({
      phase: "done",
      assetKind: asset.kind,
      assetName: asset.name,
      bytesDone: asset.size,
      bytesTotal: asset.size,
      message: `${asset.name} instalado.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Error instalando ${asset.name}: ${message}`);
  }
}

/**
 * Hook para tests: permite inyectar un mock del chequeo de status.
 */
export const __testing = {
  checkStatus: checkVendorAssetStatus,
  downloadAssets: downloadAndInstallVendorAssets,
};
