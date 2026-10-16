import { apiRequest } from "./api.client";
import { sessionStorage } from "./sessionStorage.service";
import type { VendorManifest, VendorAsset, VendorAssetKind } from "../types/vendor";

/**
 * Obtiene el manifiesto de assets vendor desde el backend.
 * Requiere autenticación (Bearer token).
 * 
 * Contrato real del backend (Blaze-back PR #1, cursor/vendor-assets-b423):
 * GET /api/vendor/manifest → { items: [...] }
 */
export async function fetchVendorManifest(): Promise<VendorManifest> {
  const token = await sessionStorage.getToken();
  
  if (!token) {
    throw new Error("Sin token de autenticación. No se puede obtener el manifiesto vendor.");
  }

  try {
    const manifest = await apiRequest<VendorManifest>("/api/vendor/manifest", { token });
    
    // Validar que tenga la estructura correcta
    if (!manifest || !Array.isArray(manifest.items)) {
      throw new Error("Respuesta del backend inválida: se esperaba { items: [...] }");
    }
    
    return manifest;
  } catch (error) {
    console.error("[VendorAPI] Error al obtener manifiesto:", error);
    throw error;
  }
}

/**
 * Busca todos los assets de un kind en el manifiesto.
 * IMPORTANTE: Puede haber múltiples assets del mismo kind (ej: múltiples BIOS, keys, firmware).
 */
export function findAssetsByKind(
  manifest: VendorManifest,
  kind: VendorAssetKind
): VendorAsset[] {
  return manifest.items.filter(a => a.kind === kind);
}

/**
 * Busca el primer asset de un kind en el manifiesto.
 * @deprecated Usar findAssetsByKind para soportar múltiples assets del mismo kind.
 */
export function findAssetByKind(
  manifest: VendorManifest,
  kind: VendorAssetKind
): VendorAsset | null {
  return manifest.items.find(a => a.kind === kind) ?? null;
}

/**
 * Verifica si una URL de asset ha expirado.
 */
export function isAssetUrlExpired(asset: VendorAsset): boolean {
  if (!asset.expiresAt) {
    return false; // Sin expiración
  }
  return new Date(asset.expiresAt) < new Date();
}

/**
 * Obtiene el tamaño en bytes como número.
 */
export function getAssetSizeBytes(asset: VendorAsset): number {
  return parseInt(asset.fileSizeBytes, 10);
}
