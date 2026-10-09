import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * Convierte coverPath guardado (ruta local, file:// o http/https) a un src usable en <img>.
 */
export function resolveCoverSrc(
  coverPath: string | null | undefined,
): string | null {
  if (coverPath == null) return null;
  const raw = coverPath.trim();
  if (!raw) return null;

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  let path = raw;
  if (/^file:\/\//i.test(path)) {
    path = decodeURIComponent(path.replace(/^file:\/\//i, ""));
    if (/^\/[A-Za-z]:/.test(path)) {
      path = path.slice(1);
    }
  }

  try {
    return convertFileSrc(path);
  } catch {
    return null;
  }
}
