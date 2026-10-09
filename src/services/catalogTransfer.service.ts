import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { CatalogTransferProgress } from "../types/catalog";

type RustProgress = {
  transferId: string;
  direction: string;
  bytesDone: number;
  bytesTotal: number;
  rangeOffset?: number | null;
  rangeDone?: number | null;
};

/** Partes multipart en paralelo (subida a R2). */
export const CATALOG_UPLOAD_CONCURRENCY = 4;

export async function pathFileSize(path: string): Promise<number> {
  return invoke<number>("path_file_size", { path });
}

export async function catalogGamesDir(): Promise<string> {
  return invoke<string>("catalog_games_dir");
}

export async function joinPath(base: string, child: string): Promise<string> {
  return invoke<string>("join_path", { base, child });
}

/** Empaqueta .cue + bins referenciados en un zip para el catálogo. */
export async function packCueBundle(
  cuePath: string,
  destZip: string,
): Promise<string> {
  return invoke<string>("pack_cue_bundle", { cuePath, destZip });
}

/** Extrae zip del catálogo; devuelve ruta al .cue (o primer archivo). */
export async function extractZipArchive(
  zipPath: string,
  destDir: string,
): Promise<string> {
  return invoke<string>("extract_zip_archive", { zipPath, destDir });
}

export async function removePath(path: string): Promise<void> {
  await invoke("remove_path", { path });
}

export async function putFileRange(input: {
  transferId: string;
  url: string;
  path: string;
  contentType: string;
  offset: number;
  length: number;
  bytesDoneBase: number;
  bytesTotal: number;
}): Promise<string> {
  return invoke<string>("http_put_file_range", {
    transferId: input.transferId,
    url: input.url,
    path: input.path,
    contentType: input.contentType,
    offset: input.offset,
    length: input.length,
    bytesDoneBase: input.bytesDoneBase,
    bytesTotal: input.bytesTotal,
  });
}

export async function downloadFile(input: {
  transferId: string;
  url: string;
  destPath: string;
  bytesTotal: number;
}): Promise<void> {
  await invoke("http_download_file", {
    transferId: input.transferId,
    url: input.url,
    destPath: input.destPath,
    bytesTotal: input.bytesTotal,
  });
}

export async function listenTransferProgress(
  transferId: string,
  onProgress: (p: CatalogTransferProgress) => void,
): Promise<UnlistenFn> {
  /** Agrega progreso de varios PUT en paralelo por offset de rango. */
  const rangeDone = new Map<number, number>();
  return listen<RustProgress>("catalog-transfer-progress", (event) => {
    if (event.payload.transferId !== transferId) return;
    const payload = event.payload;
    let bytesDone = payload.bytesDone;
    const rangeOffset = payload.rangeOffset;
    const rangeBytes = payload.rangeDone;
    if (
      rangeOffset != null &&
      rangeBytes != null &&
      Number.isFinite(rangeOffset) &&
      Number.isFinite(rangeBytes)
    ) {
      rangeDone.set(rangeOffset, rangeBytes);
      bytesDone = 0;
      for (const value of rangeDone.values()) bytesDone += value;
    }
    onProgress({
      transferId: payload.transferId,
      direction: payload.direction === "download" ? "download" : "upload",
      bytesDone,
      bytesTotal: payload.bytesTotal,
      rangeOffset: rangeOffset ?? undefined,
      rangeDone: rangeBytes ?? undefined,
    });
  });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}
