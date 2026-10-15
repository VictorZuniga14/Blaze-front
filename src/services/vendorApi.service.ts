import { apiRequest } from "./api.client";
import { sessionStorage } from "./sessionStorage.service";
import type { VendorManifest, VendorAsset } from "../types/vendor";

/**
 * Adaptador para pruebas locales sin backend.
 * Cuando el backend esté listo, eliminar esta función y usar siempre fetchVendorManifest.
 */
function getMockVendorManifest(): VendorManifest {
  // Mock: URLs ficticias, hashes de ejemplo
  const mockAssets: VendorAsset[] = [
    {
      id: "pcsx2-bios-pack-v1",
      kind: "pcsx2-bios",
      name: "PCSX2 BIOS Pack",
      size: 5_242_880, // ~5MB
      sha256: "0000000000000000000000000000000000000000000000000000000000000000",
      url: "https://example.com/mock/pcsx2-bios.7z",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
    {
      id: "retroarch-ps1-bios-v1",
      kind: "retroarch-ps1-bios",
      name: "RetroArch PS1 BIOS",
      size: 524_288, // 512KB
      sha256: "1111111111111111111111111111111111111111111111111111111111111111",
      url: "https://example.com/mock/ps1-bios.bin",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
    {
      id: "eden-keys-pack-v1",
      kind: "eden-keys",
      name: "Eden Keys",
      size: 1_048_576, // 1MB
      sha256: "2222222222222222222222222222222222222222222222222222222222222222",
      url: "https://example.com/mock/eden-keys.7z",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
    {
      id: "eden-firmware-pack-v1",
      kind: "eden-firmware",
      name: "Eden Firmware",
      size: 10_485_760, // 10MB
      sha256: "3333333333333333333333333333333333333333333333333333333333333333",
      url: "https://example.com/mock/eden-firmware.7z",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
  ];

  return { assets: mockAssets };
}

/**
 * Obtiene el manifiesto de assets vendor desde el backend.
 * Requiere autenticación (Bearer token).
 */
export async function fetchVendorManifest(): Promise<VendorManifest> {
  const token = await sessionStorage.getToken();
  
  // Si no hay token, devolver mock para desarrollo
  if (!token) {
    console.warn("[VendorAPI] Sin token, usando mock local");
    return getMockVendorManifest();
  }

  try {
    return await apiRequest<VendorManifest>("/api/vendor/manifest", { token });
  } catch (error) {
    // Fallback al mock si el backend no está disponible
    console.warn("[VendorAPI] Backend no disponible, usando mock local:", error);
    return getMockVendorManifest();
  }
}

/**
 * Busca un asset por kind en el manifiesto.
 */
export function findAssetByKind(
  manifest: VendorManifest,
  kind: VendorAsset["kind"]
): VendorAsset | null {
  return manifest.assets.find(a => a.kind === kind) ?? null;
}

/**
 * Verifica si una URL de asset ha expirado.
 */
export function isAssetUrlExpired(asset: VendorAsset): boolean {
  return new Date(asset.expiresAt) < new Date();
}
