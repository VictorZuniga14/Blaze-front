/**
 * Contrato del backend Blaze para BIOS, keys y firmware de emuladores.
 * GET /api/vendor/manifest con Bearer devuelve esta estructura.
 * 
 * Referencia: Blaze-back PR #1, rama cursor/vendor-assets-b423
 */

export type VendorAssetKind = 
  | "bios_ps2"
  | "bios_ps1"
  | "switch_keys"
  | "switch_firmware"
  | "other";

export interface VendorAsset {
  /** Tipo de asset */
  kind: VendorAssetKind;
  /** URL presignada de descarga (R2/S3) */
  downloadUrl: string;
  /** Tamaño en bytes (string) */
  fileSizeBytes: string;
  /** Nombre del archivo (ej: "SCPH1001.bin", "prod.keys") */
  fileName: string;
  /** Hash SHA256 del archivo */
  sha256: string;
  /** Timestamp de expiración de la URL (ISO 8601) */
  expiresAt?: string;
}

export interface VendorManifest {
  items: VendorAsset[];
}

// Mapeo de kinds del backend a tipos internos
export type InternalAssetKind = 
  | "pcsx2-bios"
  | "retroarch-ps1-bios"
  | "eden-keys"
  | "eden-firmware"
  | "other";

export function mapBackendKindToInternal(kind: VendorAssetKind): InternalAssetKind {
  switch (kind) {
    case "bios_ps2":
      return "pcsx2-bios";
    case "bios_ps1":
      return "retroarch-ps1-bios";
    case "switch_keys":
      return "eden-keys";
    case "switch_firmware":
      return "eden-firmware";
    case "other":
      return "other";
  }
}
