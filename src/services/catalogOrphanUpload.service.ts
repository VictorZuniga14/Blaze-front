import { catalogApiService } from "./catalogApi.service";
import {
  CATALOG_UPLOAD_CONCURRENCY,
  listenTransferProgress,
  pathFileSize,
  putFileRange,
} from "./catalogTransfer.service";
import { mapPool } from "../utils/mapPool";
import type { R2OrphanObject } from "../types/catalog";

function fileNameFromPath(path: string): string {
  return path.split(/[/\\]/).pop() || "game.bin";
}

function guessContentType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "zip") return "application/zip";
  if (ext === "iso") return "application/x-iso9660-image";
  return "application/octet-stream";
}

export type OrphanUploadProgress = {
  bytesDone: number;
  bytesTotal: number;
  message: string;
};

/** Sube un archivo local a R2 sin crear juego en el catálogo. */
export async function uploadOrphanToR2(
  localPath: string,
  onProgress?: (p: OrphanUploadProgress) => void,
): Promise<R2OrphanObject> {
  const fileName = fileNameFromPath(localPath);
  const contentType = guessContentType(fileName);
  const fileSizeBytes = await pathFileSize(localPath);
  const transferId = crypto.randomUUID();

  onProgress?.({
    bytesDone: 0,
    bytesTotal: fileSizeBytes,
    message: "Preparando subida a R2…",
  });

  const plan = await catalogApiService.startOrphanUpload({
    fileName,
    contentType,
    fileSizeBytes,
  });

  const unlisten = await listenTransferProgress(transferId, (p) => {
    onProgress?.({
      bytesDone: p.bytesDone,
      bytesTotal: p.bytesTotal,
      message: "Subiendo a R2…",
    });
  });

  try {
    if (plan.mode === "single") {
      await putFileRange({
        transferId,
        url: plan.uploadUrl,
        path: localPath,
        contentType,
        offset: 0,
        length: fileSizeBytes,
        bytesDoneBase: 0,
        bytesTotal: fileSizeBytes,
      });
      onProgress?.({
        bytesDone: fileSizeBytes,
        bytesTotal: fileSizeBytes,
        message: "Confirmando…",
      });
      return catalogApiService.completeOrphanUpload(plan.storageKey);
    }

    const partIndexes = Array.from({ length: plan.partCount }, (_, i) => i);
    const parts = await mapPool(
      partIndexes,
      CATALOG_UPLOAD_CONCURRENCY,
      async (i) => {
        const partNumber = i + 1;
        const offset = i * plan.partSize;
        const length = Math.min(plan.partSize, fileSizeBytes - offset);
        const { uploadUrl } = await catalogApiService.orphanPartUrl(
          plan.storageKey,
          partNumber,
        );
        const etag = await putFileRange({
          transferId,
          url: uploadUrl,
          path: localPath,
          contentType,
          offset,
          length,
          bytesDoneBase: offset,
          bytesTotal: fileSizeBytes,
        });
        if (!etag) {
          throw new Error(`La parte ${partNumber} no devolvió ETag.`);
        }
        return { partNumber, etag };
      },
    );

    onProgress?.({
      bytesDone: fileSizeBytes,
      bytesTotal: fileSizeBytes,
      message: "Confirmando…",
    });
    return catalogApiService.completeOrphanUpload(plan.storageKey, parts);
  } finally {
    unlisten();
  }
}
