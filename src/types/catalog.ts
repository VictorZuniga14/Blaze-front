export type CatalogGame = {
  id: string;
  title: string;
  description: string | null;
  platform: string;
  developer: string | null;
  genre: string | null;
  releaseYear: number | null;
  retroAchievementsGameId: number | null;
  fileName: string;
  contentType: string;
  fileSizeBytes: string;
  coverUrl: string | null;
  hasCover: boolean;
  status: "uploading" | "published" | "failed";
  publisherUserId: string;
  publisherUsername: string;
  localSourceGameId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CatalogUploadPlan =
  | {
      mode: "single";
      uploadUrl: string;
      coverUploadUrl: string | null;
      game: CatalogGame;
    }
  | {
      mode: "multipart";
      uploadId: string;
      partSize: number;
      partCount: number;
      coverUploadUrl: string | null;
      game: CatalogGame;
    };

export type CatalogTransferProgress = {
  transferId: string;
  direction: "upload" | "download";
  bytesDone: number;
  bytesTotal: number;
  /** Multipart paralelo: offset del rango en curso. */
  rangeOffset?: number;
  /** Multipart paralelo: bytes hechos dentro del rango. */
  rangeDone?: number;
};

export type R2OrphanObject = {
  key: string;
  fileName: string;
  sizeBytes: string;
  lastModified: string | null;
  kind: "content" | "cover";
};

export type OrphanUploadPlan =
  | {
      mode: "single";
      storageKey: string;
      fileName: string;
      uploadUrl: string;
    }
  | {
      mode: "multipart";
      storageKey: string;
      fileName: string;
      uploadId: string;
      partSize: number;
      partCount: number;
    };
