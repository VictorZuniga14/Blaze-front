/**
 * Contrato del backend Blaze para BIOS, keys y firmware de emuladores.
 * GET /api/vendor/manifest con Bearer devuelve esta estructura.
 * 
 * Referencia: Blaze-back PR #1, rama cursor/vendor-assets-b423
 * 
 * Campos requeridos según contrato:
 * - id: Identificador único del asset
 * - kind: Tipo de asset
 * - name: Nombre descriptivo
 * - fileName: Nombre del archivo físico
 * - fileSizeBytes: Tamaño en bytes (string)
 * - sha256: Hash SHA256 del archivo
 * - downloadUrl: URL presignada de descarga (R2/S3)
 * - expiresAt: Timestamp de expiración de la URL (ISO 8601) - REQUERIDO
 */

export type VendorAssetKind = 
  | "bios_ps2"
  | "bios_ps1"
  | "switch_keys"
  | "switch_firmware"
  | "other";

export interface VendorAsset {
  /** ID único del asset en el backend */
  id: string;
  /** Tipo de asset */
  kind: VendorAssetKind;
  /** Nombre descriptivo del asset (ej: "PS2 BIOS USA v2.30") */
  name: string;
  /** Nombre del archivo (ej: "SCPH1001.bin", "prod.keys") */
  fileName: string;
  /** Tamaño en bytes (string) */
  fileSizeBytes: string;
  /** Hash SHA256 del archivo */
  sha256: string;
  /** URL presignada de descarga (R2/S3) */
  downloadUrl: string;
  /** Timestamp de expiración de la URL (ISO 8601) - REQUERIDO */
  expiresAt: string;
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
