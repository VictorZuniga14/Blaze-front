import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
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

type SecureDownloadProgressEvent = {
  operationId: string;
  bytesDone: number;
  bytesTotal: number;
};

const BLAZE_LABEL = "Descargando Blaze…";

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
    onProgress?.({
      phase: "downloading",
      assetKind: null,
      assetName: "Blaze",
      bytesDone: 0,
      bytesTotal: 1,
      message: BLAZE_LABEL,
    });

    const manifest = await fetchVendorManifest();

    const assetsToDownload: Array<{ kind: VendorAssetKind; required: boolean }> = [
      { kind: "bios_ps2", required: true },
      { kind: "bios_ps1", required: true },
      { kind: "switch_keys", required: true },
      { kind: "switch_firmware", required: true },
    ];

    const pending: VendorAsset[] = [];
    for (const { kind, required } of assetsToDownload) {
      const assets = findAssetsByKind(manifest, kind);
      if (assets.length === 0) {
        if (required) {
          throw new Error(`Asset requerido no disponible en el manifiesto: ${kind}`);
        }
        continue;
      }
      pending.push(...assets);
    }

    const totalBytes = pending.reduce((sum, a) => sum + getAssetSizeBytes(a), 0);
    let bytesBefore = 0;

    for (const asset of pending) {
      const size = getAssetSizeBytes(asset);
      await downloadAndInstallAsset(asset, bytesBefore, totalBytes || 1, onProgress);
      bytesBefore += size;
    }

    onProgress?.({
      phase: "done",
      assetKind: null,
      assetName: "Blaze",
      bytesDone: totalBytes || 1,
      bytesTotal: totalBytes || 1,
      message: "Blaze está listo.",
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
 * La UI solo muestra "Descargando Blaze…" (sin nombres de BIOS/firmware).
 */
async function downloadAndInstallAsset(
  asset: VendorAsset,
  bytesBefore: number,
  totalBytes: number,
  onProgress?: (progress: VendorOnboardingProgress) => void
): Promise<void> {
  const operationId = crypto.randomUUID();
  const internalKind = mapBackendKindToInternal(asset.kind);
  const sizeBytes = getAssetSizeBytes(asset);

  const report = (
    phase: VendorOnboardingProgress["phase"],
    doneInAsset: number,
    message: string,
  ) => {
    onProgress?.({
      phase,
      assetKind: asset.kind,
      assetName: "Blaze",
      bytesDone: Math.min(bytesBefore + doneInAsset, totalBytes),
      bytesTotal: totalBytes,
      message,
    });
  };

  let unlisten: UnlistenFn | undefined;
  try {
    report("downloading", 0, BLAZE_LABEL);

    unlisten = await listen<SecureDownloadProgressEvent>(
      "secure-download-progress",
      (event) => {
        const p = event.payload;
        if (p.operationId !== operationId) return;
        report("downloading", p.bytesDone, BLAZE_LABEL);
      },
    );

    await invoke<void>("download_vendor_asset_command", {
      operationId,
      assetKind: internalKind,
      url: asset.downloadUrl,
      fileName: asset.fileName,
      sha256: asset.sha256,
      sizeBytes: asset.fileSizeBytes,
    });

    report("done", sizeBytes, BLAZE_LABEL);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Error descargando Blaze: ${message}`);
  } finally {
    unlisten?.();
  }
}

/**
 * Hook para tests: permite inyectar un mock del chequeo de status.
 */
export const __testing = {
  checkStatus: checkVendorAssetStatus,
  downloadAssets: downloadAndInstallVendorAssets,
};
