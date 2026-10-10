import { invoke } from "@tauri-apps/api/core";
import { catalogApiService } from "./catalogApi.service";
import {
  CATALOG_UPLOAD_CONCURRENCY,
  catalogGamesDir,
  downloadFile,
  joinPath,
  listenTransferProgress,
  listSwitchExtras,
  packCueBundle,
  packSwitchBundle,
  pathFileSize,
  putFileRange,
  removePath,
} from "./catalogTransfer.service";
import { mapPool } from "../utils/mapPool";
import { launchConfigService } from "./launchConfig.service";
import { gameRepository } from "../repositories/game.repository";
import { runtimeRepository } from "../repositories/runtime.repository";
import { gameService } from "./game.service";
import { raIdentifyService, pickTitleFallbackCandidate } from "./raIdentify.service";
import { retroAchievementsApiService } from "./retroAchievementsApi.service";
import { isGamePublished } from "../types/game";
import type { CatalogGame } from "../types/catalog";
import type { RaIdentifyResult } from "./raIdentify.service";
import { resolveRaAdapterKind } from "./ra/adapterKind";
import {
  RA_CONSOLE_LABELS,
  resolveRaConsole,
  type RaConsoleKey,
} from "../utils/raConsoles";
import { runtimeKindForPlatform } from "../utils/platformRuntime";

function fileNameFromPath(path: string): string {
  return path.split(/[/\\]/).pop() || "game.bin";
}

function guessContentType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "zip") return "application/zip";
  return "application/octet-stream";
}

function guessCoverContentType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "image/jpeg";
}

async function pathExists(path: string): Promise<boolean> {
  return invoke<boolean>("path_check", { path, kind: "file" });
}

/** Fallback suave por extensión cuando no hay platform (solo catálogo). */
function platformFromContentExt(contentPath: string): RaConsoleKey | null {
  const ext = contentPath.split(/[/\\]/).pop()?.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  if (ext === "iso" || ext === "bin" || ext === "cue") return "ps2";
  if (ext === "nes") return "nes";
  if (ext === "smc" || ext === "sfc") return "snes";
  if (ext === "gba") return "gba";
  if (ext === "gb") return "gameboy";
  if (ext === "gbc") return "gbc";
  if (ext === "n64" || ext === "z64" || ext === "v64") return "n64";
  if (ext === "cso" || ext === "pbp") return "psp";
  if (ext === "nsp" || ext === "xci") return "switch";
  return null;
}

async function resolveCatalogPlatform(input: {
  gameId: string;
  platform: string | null;
  runtimeId: string | null;
  contentPath: string;
}): Promise<string> {
  if (input.platform?.trim() && runtimeKindForPlatform(input.platform)) {
    return input.platform.trim();
  }

  let inferredKey: RaConsoleKey | null = null;
  if (input.runtimeId) {
    const runtime = await runtimeRepository.findById(input.runtimeId);
    const kind = resolveRaAdapterKind(runtime);
    if (kind === "pcsx2") inferredKey = "ps2";
    if (!inferredKey && runtime?.type?.toLowerCase() === "eden") {
      inferredKey = "switch";
    }
  }
  if (!inferredKey) {
    inferredKey = platformFromContentExt(input.contentPath);
  }
  if (!inferredKey || !runtimeKindForPlatform(RA_CONSOLE_LABELS[inferredKey])) {
    throw new Error(
      "El juego necesita plataforma (ej. PlayStation 2 o Nintendo Switch). Editá el juego y guardala, o usá un runtime PCSX2/RetroArch/Eden.",
    );
  }

  const platform = RA_CONSOLE_LABELS[inferredKey];
  // Persistir para que Biblioteca / RA no queden sin platform.
  const existing = await gameRepository.findById(input.gameId);
  if (existing && !existing.platform?.trim()) {
    await gameService.updateGame(input.gameId, {
      title: existing.title,
      description: existing.description,
      developer: existing.developer,
      publisher: existing.publisher,
      genre: existing.genre,
      platform,
      releaseYear: existing.releaseYear,
      coverPath: existing.coverPath,
      isFavorite: existing.isFavorite,
      retroAchievementsGameId: existing.retroAchievementsGameId,
    });
  }
  return platform;
}

export type CatalogPublishProgress = {
  phase: "preparing" | "uploading" | "finalizing";
  bytesDone: number;
  bytesTotal: number;
  message: string;
};

/**
 * Publica un juego local ya "published" al catálogo (R2 vía URLs firmadas).
 * Si hay portada local, también la sube.
 */
function suggestCoverKey(
  contentKey: string,
  orphans: Awaited<ReturnType<typeof catalogApiService.listR2Orphans>>,
): string | null {
  const slash = contentKey.lastIndexOf("/");
  if (slash <= 0) return null;
  const prefix = `${contentKey.slice(0, slash)}/cover/`;
  const cover = orphans.find(
    (o) => o.kind === "cover" && o.key.startsWith(prefix),
  );
  return cover?.key ?? null;
}

export const catalogPublishService = {
  async removeFromCatalog(gameId: string): Promise<void> {
    const game = await gameRepository.findById(gameId);
    if (!game?.catalogRemoteId) {
      throw new Error("Este juego no está en el catálogo.");
    }
    await catalogApiService.remove(game.catalogRemoteId);
    await gameRepository.setCatalogRemoteId(
      gameId,
      null,
      new Date().toISOString(),
    );
  },

  /**
   * Publica en el catálogo apuntando a un ISO/zip ya existente en R2 (sin re-subir).
   */
  async linkLocalGameFromR2(
    gameId: string,
    storageKey: string,
    coverStorageKey?: string | null,
  ): Promise<{ catalog: CatalogGame; ra: RaIdentifyResult | null }> {
    const game = await gameRepository.findById(gameId);
    if (!game) throw new Error("El juego no existe.");
    if (!isGamePublished(game)) {
      throw new Error(
        "Primero guardá el juego (publicado local) antes de vincularlo al catálogo.",
      );
    }
    const platform = game.platform?.trim();
    if (!platform) {
      throw new Error(
        "El juego necesita plataforma (ej. PlayStation 2) antes de vincular R2.",
      );
    }

    let ra: RaIdentifyResult | null = null;
    let raGameId = game.retroAchievementsGameId;
    if (!raGameId) {
      try {
        ra = await raIdentifyService.identifyGameWithTitleFallback({ gameId });
        if (ra.state === "identified" && ra.raGameId) {
          raGameId = ra.raGameId;
        }
      } catch {
        ra = null;
      }
    }

    let published = await catalogApiService.linkFromR2({
      localSourceGameId: gameId,
      storageKey,
      coverStorageKey: coverStorageKey ?? null,
      title: game.title,
      description: game.description,
      platform,
      developer: game.developer,
      genre: game.genre,
      releaseYear: game.releaseYear,
      retroAchievementsGameId: raGameId,
    });

    await gameRepository.setCatalogRemoteId(
      gameId,
      published.id,
      new Date().toISOString(),
    );

    if (raGameId && published.retroAchievementsGameId !== raGameId) {
      try {
        published = await catalogApiService.update(published.id, {
          retroAchievementsGameId: raGameId,
        });
      } catch {
        // best-effort
      }
    }

    return { catalog: published, ra };
  },

  /**
   * Publica en el catálogo (Juegos) desde R2 sin tocar la biblioteca local.
   */
  async publishCatalogFromR2(input: {
    title: string;
    platform: string;
    storageKey: string;
    coverStorageKey?: string | null;
  }): Promise<{ catalog: CatalogGame; raMessage: string | null }> {
    const title = input.title.trim();
    const platform = input.platform.trim();
    if (!title) throw new Error("Poné un título para el juego.");
    if (!platform) throw new Error("Elegí una plataforma.");

    let raGameId: number | null = null;
    let raMessage: string | null = null;
    try {
      let candidates = [] as Awaited<
        ReturnType<typeof retroAchievementsApiService.search>
      >;
      const preferred = resolveRaConsole({ platform });
      if (preferred) {
        candidates = await retroAchievementsApiService.search({
          query: title,
          consoleId: preferred.consoleId,
        });
      }
      if (candidates.length === 0) {
        candidates = await retroAchievementsApiService.search({ query: title });
      }
      const pick = pickTitleFallbackCandidate(candidates, title);
      if (pick) {
        raGameId = pick.raGameId;
        raMessage = `vinculado a RA #${pick.raGameId}`;
      }
    } catch {
      raMessage = null;
    }

    const catalog = await catalogApiService.linkFromR2({
      storageKey: input.storageKey,
      coverStorageKey: input.coverStorageKey ?? null,
      title,
      platform,
      retroAchievementsGameId: raGameId,
    });

    return { catalog, raMessage };
  },

  async listLinkableR2Content(): Promise<{
    content: Awaited<ReturnType<typeof catalogApiService.listR2Orphans>>;
    covers: Awaited<ReturnType<typeof catalogApiService.listR2Orphans>>;
    suggestCoverFor: (contentKey: string) => string | null;
  }> {
    const orphans = await catalogApiService.listR2Orphans();
    const content = orphans.filter((o) => o.kind === "content");
    const covers = orphans.filter((o) => o.kind === "cover");
    return {
      content,
      covers,
      suggestCoverFor: (contentKey: string) =>
        suggestCoverKey(contentKey, orphans),
    };
  },

  /**
   * Publica (o reemplaza) en el catálogo. Si ya estaba, lo quita de R2/DB y vuelve a subir.
   */
  async publishLocalGame(
    gameId: string,
    onProgress?: (p: CatalogPublishProgress) => void,
  ): Promise<CatalogGame> {
    const game = await gameRepository.findById(gameId);
    if (!game) throw new Error("El juego no existe.");
    if (!isGamePublished(game)) {
      throw new Error(
        "Primero guardá el juego (publicado local) antes de subirlo al catálogo.",
      );
    }

    if (game.catalogRemoteId) {
      onProgress?.({
        phase: "preparing",
        bytesDone: 0,
        bytesTotal: 0,
        message: "Reemplazando publicación anterior…",
      });
      try {
        await catalogApiService.remove(game.catalogRemoteId);
      } catch {
        // Si ya no existe en el server, seguimos limpiando el vínculo local.
      }
      await gameRepository.setCatalogRemoteId(
        gameId,
        null,
        new Date().toISOString(),
      );
    }
    const config = await launchConfigService.getByGameId(gameId);
    const contentPath = config?.contentPath?.trim();
    if (!config || !contentPath) {
      throw new Error("Falta el archivo de contenido (ISO/ROM) para subir.");
    }

    const platform = await resolveCatalogPlatform({
      gameId,
      platform: game.platform,
      runtimeId: config.runtimeId,
      contentPath,
    });

    const transferId = crypto.randomUUID();
    let uploadPath = contentPath;
    let tempZipToDelete: string | null = null;
    const isCue = /\.cue$/i.test(contentPath);
    const isSwitch =
      runtimeKindForPlatform(platform) === "eden" ||
      /\.nsp$/i.test(contentPath) ||
      /\.xci$/i.test(contentPath);
    if (isCue) {
      onProgress?.({
        phase: "preparing",
        bytesDone: 0,
        bytesTotal: 0,
        message: "Empaquetando .cue + .bin para el catálogo…",
      });
      const baseDir = await catalogGamesDir();
      const packsDir = await joinPath(baseDir, "_packs");
      const baseName = fileNameFromPath(contentPath).replace(/\.cue$/i, "");
      const destZip = await joinPath(packsDir, `${baseName}.zip`);
      uploadPath = await packCueBundle(contentPath, destZip);
      tempZipToDelete = uploadPath;
    } else if (isSwitch) {
      const extras = await listSwitchExtras(contentPath);
      if (extras.length > 0) {
        onProgress?.({
          phase: "preparing",
          bytesDone: 0,
          bytesTotal: 0,
          message: `Empaquetando Switch + ${extras.length} update/DLC (puede tardar)…`,
        });
        const baseDir = await catalogGamesDir();
        const packsDir = await joinPath(baseDir, "_packs");
        const baseName = fileNameFromPath(contentPath).replace(
          /\.(nsp|xci)$/i,
          "",
        );
        const destZip = await joinPath(packsDir, `${baseName}.switch.zip`);
        const packTransferId = `${transferId}-pack`;
        const unlistenPack = await listenTransferProgress(packTransferId, (p) => {
          onProgress?.({
            phase: "preparing",
            bytesDone: p.bytesDone,
            bytesTotal: p.bytesTotal,
            message: `Empaquetando Switch + ${extras.length} update/DLC…`,
          });
        });
        try {
          uploadPath = await packSwitchBundle(
            contentPath,
            extras,
            destZip,
            packTransferId,
          );
        } finally {
          unlistenPack();
        }
        tempZipToDelete = uploadPath;
      }
    }

    const fileSizeBytes = await pathFileSize(uploadPath);
    const fileName = fileNameFromPath(uploadPath);
    const contentType = guessContentType(fileName);
    let coverPath: string | null = game.coverPath?.trim() || null;
    let coverFileName: string | null = null;
    let coverContentType: string | null = null;
    let coverFileSizeBytes: number | null = null;
    if (coverPath && /^https?:\/\//i.test(coverPath)) {
      try {
        onProgress?.({
          phase: "preparing",
          bytesDone: 0,
          bytesTotal: 0,
          message: "Descargando portada…",
        });
        const baseDir = await catalogGamesDir();
        const coversDir = await joinPath(baseDir, "_covers");
        const ext =
          coverPath.split("?")[0]?.split(".").pop()?.toLowerCase() || "png";
        const safeExt = ["png", "jpg", "jpeg", "webp", "gif"].includes(ext)
          ? ext
          : "png";
        const dest = await joinPath(coversDir, `${gameId}.${safeExt}`);
        await downloadFile({
          transferId: `${transferId}-cover-dl`,
          url: coverPath,
          destPath: dest,
          bytesTotal: 0,
        });
        coverPath = dest;
      } catch {
        coverPath = null;
      }
    }
    if (coverPath) {
      const exists = await pathExists(coverPath);
      if (!exists) {
        coverPath = null;
      } else {
        coverFileName = fileNameFromPath(coverPath);
        coverContentType = guessCoverContentType(coverFileName);
        coverFileSizeBytes = await pathFileSize(coverPath);
      }
    }

    onProgress?.({
      phase: "preparing",
      bytesDone: 0,
      bytesTotal: fileSizeBytes,
      message: "Preparando subida…",
    });

    const plan = await catalogApiService.startPublish({
      localSourceGameId: gameId,
      title: game.title,
      description: game.description,
      platform,
      developer: game.developer,
      genre: game.genre,
      releaseYear: game.releaseYear,
      retroAchievementsGameId: game.retroAchievementsGameId,
      fileName,
      contentType,
      fileSizeBytes,
      coverFileName,
      coverContentType,
      coverFileSizeBytes,
    });

    const unlisten = await listenTransferProgress(transferId, (p) => {
      onProgress?.({
        phase: "uploading",
        bytesDone: p.bytesDone,
        bytesTotal: p.bytesTotal,
        message: "Subiendo al catálogo…",
      });
    });

    try {
      if (
        plan.coverUploadUrl &&
        coverPath &&
        coverContentType &&
        coverFileSizeBytes != null
      ) {
        onProgress?.({
          phase: "uploading",
          bytesDone: 0,
          bytesTotal: coverFileSizeBytes,
          message: "Subiendo portada…",
        });
        await putFileRange({
          transferId,
          url: plan.coverUploadUrl,
          path: coverPath,
          contentType: coverContentType,
          offset: 0,
          length: coverFileSizeBytes,
          bytesDoneBase: 0,
          bytesTotal: coverFileSizeBytes,
        });
      }

      if (plan.mode === "single") {
        await putFileRange({
          transferId,
          url: plan.uploadUrl,
          path: uploadPath,
          contentType,
          offset: 0,
          length: fileSizeBytes,
          bytesDoneBase: 0,
          bytesTotal: fileSizeBytes,
        });
        onProgress?.({
          phase: "finalizing",
          bytesDone: fileSizeBytes,
          bytesTotal: fileSizeBytes,
          message: "Confirmando publicación…",
        });
        const published = await catalogApiService.complete(plan.game.id);
        await gameRepository.setCatalogRemoteId(
          gameId,
          published.id,
          new Date().toISOString(),
        );
        return published;
      }

      const partIndexes = Array.from({ length: plan.partCount }, (_, i) => i);
      const parts = await mapPool(
        partIndexes,
        CATALOG_UPLOAD_CONCURRENCY,
        async (i) => {
          const partNumber = i + 1;
          const offset = i * plan.partSize;
          const length = Math.min(plan.partSize, fileSizeBytes - offset);
          const { uploadUrl } = await catalogApiService.partUrl(
            plan.game.id,
            partNumber,
          );
          const etag = await putFileRange({
            transferId,
            url: uploadUrl,
            path: uploadPath,
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
        phase: "finalizing",
        bytesDone: fileSizeBytes,
        bytesTotal: fileSizeBytes,
        message: "Confirmando publicación…",
      });
      const published = await catalogApiService.complete(plan.game.id, parts);
      await gameRepository.setCatalogRemoteId(
        gameId,
        published.id,
        new Date().toISOString(),
      );
      return published;
    } finally {
      unlisten();
      if (tempZipToDelete) {
        try {
          await removePath(tempZipToDelete);
        } catch {
          // best-effort
        }
      }
    }
  },
};
