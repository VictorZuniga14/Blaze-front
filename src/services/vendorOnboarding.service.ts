import { invoke } from "@tauri-apps/api/core";
import type { VendorAsset, VendorAssetKind } from "../types/vendor";
import { fetchVendorManifest, findAssetsByKind, getAssetSizeBytes } from "./vendorApi.service";
import { mapBackendKindToInternal } from "../types/vendor";

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
 * Usa comandos Tauri existentes para chequear archivos REALES (no placeholders).
 */
export async function checkVendorAssetStatus(): Promise<VendorOnboardingStatus> {
  try {
    const [pcsx2Bios, ps1Bios, edenKeys, edenFirmware] = await Promise.all([
      invoke<boolean>("pcsx2_managed_bios_present"),
      invoke<boolean>("retroarch_ps1_bios_present"),
      invoke<boolean>("eden_keys_present"),
      invoke<boolean>("eden_firmware_present"),
    ]);

    const allReady = pcsx2Bios && ps1Bios && edenKeys && edenFirmware;

    return {
      pcsx2BiosReady: pcsx2Bios,
      retroarchPs1BiosReady: ps1Bios,
      edenKeysReady: edenKeys,
      edenFirmwareReady: edenFirmware,
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
 * Usa la API de descarga segura (vendor_download.rs) que reutiliza
 * la lógica de runtime_install.rs con verificación SHA256.
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
      { kind: "bios_ps2", required: true },
      { kind: "bios_ps1", required: true },
      { kind: "switch_keys", required: true },
      { kind: "switch_firmware", required: true },
    ];

    for (const { kind, required } of assetsToDownload) {
      const assets = findAssetsByKind(manifest, kind);
      
      if (assets.length === 0) {
        if (required) {
          throw new Error(`Asset requerido no disponible en el manifiesto: ${kind}`);
        }
        continue;
      }

      // Descargar e instalar TODOS los assets de este kind
      for (const asset of assets) {
        await downloadAndInstallAsset(asset, onProgress);
      }
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
  const internalKind = mapBackendKindToInternal(asset.kind);
  const sizeBytes = getAssetSizeBytes(asset);
  
  // Nombre descriptivo para UI
  const displayName = {
    "bios_ps2": "BIOS de PlayStation 2",
    "bios_ps1": "BIOS de PlayStation 1",
    "switch_keys": "Keys de Nintendo Switch",
    "switch_firmware": "Firmware de Nintendo Switch",
    "other": asset.fileName,
  }[asset.kind] || asset.fileName;

  try {
    onProgress?.({
      phase: "downloading",
      assetKind: asset.kind,
      assetName: displayName,
      bytesDone: 0,
      bytesTotal: sizeBytes,
      message: `Descargando ${displayName}...`,
    });

    // Llamar al comando Tauri que implementamos
    await invoke<void>("download_vendor_asset_command", {
      operationId,
      assetKind: internalKind,
      url: asset.downloadUrl,
      fileName: asset.fileName,
      sha256: asset.sha256,
      sizeBytes: asset.fileSizeBytes,
    });

    onProgress?.({
      phase: "done",
      assetKind: asset.kind,
      assetName: displayName,
      bytesDone: sizeBytes,
      bytesTotal: sizeBytes,
      message: `${displayName} instalado.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Error instalando ${displayName}: ${message}`);
  }
}

/**
 * Hook para tests: permite inyectar un mock del chequeo de status.
 */
export const __testing = {
  checkStatus: checkVendorAssetStatus,
  downloadAssets: downloadAndInstallVendorAssets,
};
