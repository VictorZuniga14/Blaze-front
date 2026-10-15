/**
 * Contrato del backend Blaze para BIOS, keys y firmware de emuladores.
 * GET /api/vendor/manifest con Bearer devuelve esta estructura.
 */

export type VendorAssetKind = 
  | "pcsx2-bios"
  | "retroarch-ps1-bios"
  | "eden-keys"
  | "eden-firmware";

export interface VendorAsset {
  /** ID único del asset (p.ej. "pcsx2-bios-pack-v1") */
  id: string;
  /** Tipo de asset */
  kind: VendorAssetKind;
  /** Nombre descriptivo para UI */
  name: string;
  /** Tamaño en bytes */
  size: number;
  /** Hash SHA256 del archivo */
  sha256: string;
  /** URL presignada temporal (S3/storage) */
  url: string;
  /** Timestamp de expiración de la URL (ISO 8601) */
  expiresAt: string;
}

export interface VendorManifest {
  assets: VendorAsset[];
}
