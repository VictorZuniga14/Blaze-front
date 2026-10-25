import { invoke } from "@tauri-apps/api/core";
import { catalogApiService } from "./catalogApi.service";
import { libraryApiService } from "./libraryApi.service";
import {
  catalogGamesDir,
  downloadFile,
  extractCatalogZip,
  installEdenTitleNsps,
  joinPath,
  listenTransferProgress,
  removePath,
} from "./catalogTransfer.service";
import { gameService } from "./game.service";
import { gameContentService } from "./gameContent.service";
import { launchConfigService } from "./launchConfig.service";
import { gameRepository } from "../repositories/game.repository";
import { runtimeRepository } from "../repositories/runtime.repository";
import type { CatalogGame } from "../types/catalog";
import type { Game } from "../types/game";
import { ensureRuntime } from "./ensureRuntime.service";
import { EnsureRuntimeError } from "./ensureRuntimeErrors";
import {
  resolveRetroArchLaunchArguments,
  runtimeKindForPlatform,
} from "../utils/platformRuntime";
import {
  defaultPreferredLanguage,
  resolveAvailableLanguages,
} from "../utils/gameLanguages";

export type CatalogInstallProgress = {
  phase:
    | "resolving"
    | "preparing_runtime"
    | "downloading"
    | "installing"
    | "waiting_bios";
  bytesDone: number;
  bytesTotal: number;
  message: string;
  /** Id de operación Rust para cancelar la instalación del emulador. */
  runtimeOperationId?: string | null;
};

/** PS2: runtime listo pero falta BIOS del usuario. */
export class CatalogInstallNeedsPcsx2BiosError extends Error {
  constructor() {
    super(
      "Importá una BIOS de PS2 de tu propia consola para continuar con la descarga.",
    );
    this.name = "CatalogInstallNeedsPcsx2BiosError";
  }
}

export type CatalogInstallResult = {
  game: Game;
  catalog: CatalogGame;
  runtimeName: string;
};

async function pathExists(path: string): Promise<boolean> {
  return invoke<boolean>("path_check", { path, kind: "file" });
}

/** Fracción del total del paquete reservada a la bajada HTTP cuando hay post-trabajo (zip). */
const PACKAGE_DOWNLOAD_SHARE = 0.55;
/** Dentro del tramo post-bajada, cuánto ocupa el unzip antes del install DLC. */
const PACKAGE_EXTRACT_OF_POST = 0.35;

const DL_MSG = "Descargando desde el catálogo…";

function emitDownloadProgress(
  onProgress: ((p: CatalogInstallProgress) => void) | undefined,
  bytesDone: number,
  bytesTotal: number,
  message = DL_MSG,
): void {
  onProgress?.({
    phase: "downloading",
    bytesDone: Math.max(0, Math.min(bytesDone, bytesTotal || bytesDone)),
    bytesTotal,
    message,
  });
}

/** Mapea progreso de una etapa al total fijo del paquete (una sola barra). */
function mapPackageProgress(
  packageTotal: number,
  rangeStart: number,
  rangeEnd: number,
  stageDone: number,
  stageTotal: number,
): number {
  if (packageTotal <= 0) {
    return stageDone;
  }
  const span = Math.max(0, rangeEnd - rangeStart);
  if (stageTotal <= 0 || span <= 0) {
    return rangeStart;
  }
  const ratio = Math.min(1, Math.max(0, stageDone / stageTotal));
  return Math.min(packageTotal, Math.floor(rangeStart + ratio * span));
}

async function downloadCatalogPayload(
  catalog: CatalogGame,
  onProgress?: (p: CatalogInstallProgress) => void,
): Promise<{
  destPath: string;
  coverLocalPath: string | null;
  installPaths: string[];
  /** Tamaño del paquete en catálogo (total fijo del HUD). */
  packageTotal: number;
  /** Bytes de HUD al terminar esta función (antes del install DLC si aplica). */
  hudBytesDone: number;
}> {
  const dl = await catalogApiService.downloadUrl(catalog.id);
  const packageTotal = Number(dl.fileSizeBytes) || 0;
  const isZip = /\.zip$/i.test(dl.fileName);
  /** Sin zip: la bajada es el 100%. Con zip: ~55% y el resto es unzip(+DLC). */
  const downloadShare = isZip ? PACKAGE_DOWNLOAD_SHARE : 1;
  const downloadEnd =
    packageTotal > 0 ? Math.floor(packageTotal * downloadShare) : 0;
  const transferId = crypto.randomUUID();
  const baseDir = await catalogGamesDir();
  const gameDir = await joinPath(baseDir, catalog.id);
  const destPath = await joinPath(gameDir, dl.fileName);

  const unlisten = await listenTransferProgress(transferId, (p) => {
    const stageTotal = p.bytesTotal > 0 ? p.bytesTotal : packageTotal;
    const displayDone =
      packageTotal > 0 && downloadShare < 1
        ? mapPackageProgress(
            packageTotal,
            0,
            downloadEnd,
            p.bytesDone,
            stageTotal,
          )
        : p.bytesDone;
    const displayTotal = packageTotal > 0 ? packageTotal : p.bytesTotal;
    emitDownloadProgress(onProgress, displayDone, displayTotal);
  });

  let coverLocalPath: string | null = null;
  let hudBytesDone = 0;
  try {
    emitDownloadProgress(onProgress, 0, packageTotal);
    await downloadFile({
      transferId,
      url: dl.url,
      destPath,
      bytesTotal: packageTotal,
    });
    hudBytesDone =
      packageTotal > 0 && downloadShare < 1 ? downloadEnd : packageTotal;
    emitDownloadProgress(onProgress, hudBytesDone, packageTotal);

    if (catalog.hasCover) {
      try {
        const cover = await catalogApiService.coverUrl(catalog.id);
        coverLocalPath = await joinPath(gameDir, cover.fileName);
        await downloadFile({
          transferId: `${transferId}-cover`,
          url: cover.url,
          destPath: coverLocalPath,
          bytesTotal: 0,
        });
      } catch {
        coverLocalPath = null;
      }
    } else if (catalog.coverUrl) {
      coverLocalPath = catalog.coverUrl;
    }
  } finally {
    unlisten();
  }

  let playablePath = destPath;
  let installPaths: string[] = [];
  if (isZip) {
    const extractTransferId = crypto.randomUUID();
    const postStart = downloadEnd;
    const postEnd = packageTotal > 0 ? packageTotal : 0;
    // Si hay DLC el unzip solo llega ~a un tramo; si no, el unzip llena hasta 100%.
    // Anticipamos tramo corto; si no hay installPaths, al terminar empujamos a 100%.
    const extractEndGuess =
      packageTotal > 0
        ? Math.floor(
            postStart + (postEnd - postStart) * PACKAGE_EXTRACT_OF_POST,
          )
        : postStart;

    const unlistenExtract = await listenTransferProgress(
      extractTransferId,
      (p) => {
        const stageTotal = p.bytesTotal > 0 ? p.bytesTotal : 1;
        const displayDone = mapPackageProgress(
          packageTotal,
          postStart,
          extractEndGuess,
          p.bytesDone,
          stageTotal,
        );
        hudBytesDone = displayDone;
        emitDownloadProgress(onProgress, displayDone, packageTotal);
      },
    );
    try {
      emitDownloadProgress(onProgress, postStart, packageTotal);
      const extracted = await extractCatalogZip(
        destPath,
        gameDir,
        extractTransferId,
      );
      playablePath = extracted.primaryPath;
      installPaths = extracted.installPaths;
      if (installPaths.length === 0) {
        hudBytesDone = packageTotal;
        emitDownloadProgress(onProgress, packageTotal, packageTotal);
      } else {
        hudBytesDone = extractEndGuess;
        emitDownloadProgress(onProgress, extractEndGuess, packageTotal);
      }
    } finally {
      unlistenExtract();
    }
    try {
      await removePath(destPath);
    } catch {
      // best-effort: dejar el zip no rompe el juego
    }
  }

  return {
    destPath: playablePath,
    coverLocalPath,
    installPaths,
    packageTotal,
    hudBytesDone,
  };
}

/**
 * Catálogo → biblioteca (solo ficha). La descarga del ROM es otro paso.
 */
export const catalogInstallService = {
  /**
   * Crea la ficha local si no existe. `syncCloud` (default true) hace push a /api/library.
   * El sync pull usa syncCloud: false (ya está en el servidor).
   */
  async addToLibrary(
    catalogGameId: string,
    options?: { syncCloud?: boolean; allowExisting?: boolean },
  ): Promise<{
    game: Game;
    catalog: CatalogGame;
  }> {
    const syncCloud = options?.syncCloud !== false;
    const allowExisting = options?.allowExisting === true;

    const catalog = await catalogApiService.get(catalogGameId);
    const existing = await gameRepository.findByCatalogRemoteId(catalog.id);
    if (existing) {
      if (allowExisting) {
        if (syncCloud) {
          const pushed = await libraryApiService.add(catalog.id);
          if (!pushed) {
            throw new Error(
              "Tenés que iniciar sesión para sincronizar la biblioteca.",
            );
          }
        }
        return { game: existing, catalog };
      }
      throw new Error(
        "Este juego ya está en tu biblioteca. Abrilo desde Biblioteca.",
      );
    }

    // Push cloud antes de crear local para no perder la ficha en el próximo sync SoT.
    if (syncCloud) {
      const pushed = await libraryApiService.add(catalog.id);
      if (!pushed) {
        throw new Error(
          "Tenés que iniciar sesión para sincronizar la biblioteca.",
        );
      }
    }

    const langs = resolveAvailableLanguages(catalog.availableLanguages);
    const preferredLang = defaultPreferredLanguage(langs);
    const game = await gameService.createGame({
      title: catalog.title,
      description: catalog.description,
      developer: catalog.developer,
      genre: catalog.genre,
      platform: catalog.platform,
      releaseYear: catalog.releaseYear,
      retroAchievementsGameId: catalog.retroAchievementsGameId,
      coverPath: catalog.coverUrl,
      status: "published",
      availableLanguages: langs,
      preferredLanguage: preferredLang,
    });

    const updatedAt = new Date().toISOString();
    await gameRepository.setStatus(game.id, "published", updatedAt);
    await gameRepository.setCatalogRemoteId(game.id, catalog.id, updatedAt);
    await gameRepository.setLanguages(game.id, langs, preferredLang, updatedAt);

    const fresh = await gameRepository.findById(game.id);
    if (!fresh) throw new Error("No se pudo agregar el juego a la biblioteca.");

    return { game: fresh, catalog };
  },

  /**
   * @deprecated Preferí addToLibrary + repairFromCatalog (Descargar en biblioteca).
   * Se mantiene por si algún flujo viejo lo llama.
   */
  async install(
    catalogGameId: string,
    onProgress?: (p: CatalogInstallProgress) => void,
  ): Promise<CatalogInstallResult> {
    const added = await this.addToLibrary(catalogGameId);
    return this.repairFromCatalog(added.game.id, onProgress);
  },

  /**
   * Si el juego está en el catálogo y el archivo local faltó o quedó viejo,
   * vuelve a bajar desde R2 y reasigna contenido + runtime local por platform.
   */
  async repairFromCatalog(
    gameId: string,
    onProgress?: (p: CatalogInstallProgress) => void,
  ): Promise<CatalogInstallResult> {
    onProgress?.({
      phase: "resolving",
      bytesDone: 0,
      bytesTotal: 0,
      message: "Consultando catálogo…",
    });

    const game = await gameRepository.findById(gameId);
    if (!game?.catalogRemoteId) {
      throw new Error("Este juego no está vinculado al catálogo en la nube.");
    }

    const catalog = await catalogApiService.get(game.catalogRemoteId);
    const platform = catalog.platform || game.platform;
    let lastRuntimeOpId: string | null = null;
    let runtime;
    try {
      runtime = await ensureRuntime(platform, {
        onProgress: (p) => {
          if (p.operationId) lastRuntimeOpId = p.operationId;
          onProgress?.({
            phase: "preparing_runtime",
            bytesDone: p.bytesDone,
            bytesTotal: p.bytesTotal,
            message: p.message || "Preparando emulador…",
            runtimeOperationId: p.operationId || lastRuntimeOpId,
          });
        },
      });
    } catch (err) {
      if (err instanceof EnsureRuntimeError) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new EnsureRuntimeError("unknown", msg, true);
    }

    if (runtimeKindForPlatform(platform) === "pcsx2") {
      const hasBios = await invoke<boolean>("pcsx2_managed_bios_present");
      if (!hasBios) {
        onProgress?.({
          phase: "waiting_bios",
          bytesDone: 0,
          bytesTotal: 0,
          message:
            "Necesitás una BIOS de PS2 de tu propia consola (una sola vez). Importala abajo para continuar.",
          runtimeOperationId: lastRuntimeOpId,
        });
        throw new CatalogInstallNeedsPcsx2BiosError();
      }
    }

    onProgress?.({
      phase: "downloading",
      bytesDone: 0,
      bytesTotal: 0,
      message: "Descargando juego…",
    });

    const {
      destPath,
      coverLocalPath,
      installPaths,
      packageTotal,
      hudBytesDone: afterPayloadHud,
    } = await downloadCatalogPayload(catalog, onProgress);

    if (installPaths.length > 0) {
      const installTransferId = crypto.randomUUID();
      const installStart =
        packageTotal > 0 ? Math.min(afterPayloadHud, packageTotal) : 0;
      const installEnd = packageTotal > 0 ? packageTotal : 0;
      const unlistenInstall = await listenTransferProgress(
        installTransferId,
        (p) => {
          const stageTotal = p.bytesTotal > 0 ? p.bytesTotal : 1;
          const displayDone =
            packageTotal > 0
              ? mapPackageProgress(
                  packageTotal,
                  installStart,
                  installEnd,
                  p.bytesDone,
                  stageTotal,
                )
              : p.bytesDone;
          emitDownloadProgress(
            onProgress,
            displayDone,
            packageTotal > 0 ? packageTotal : p.bytesTotal,
          );
        },
      );
      try {
        emitDownloadProgress(onProgress, installStart, packageTotal);
        await installEdenTitleNsps(
          runtime.executablePath,
          installPaths,
          installTransferId,
        );
        if (packageTotal > 0) {
          emitDownloadProgress(onProgress, packageTotal, packageTotal);
        }
      } finally {
        unlistenInstall();
      }
    }

    if (packageTotal > 0) {
      emitDownloadProgress(onProgress, packageTotal, packageTotal);
    }

    await gameContentService.associate({ gameId, path: destPath });
    const resolvedLaunch = await resolveRetroArchLaunchArguments(
      runtime,
      platform,
      [],
    );
    await launchConfigService.save({
      gameId,
      type: "runtime",
      runtimeId: runtime.id,
      contentPath: destPath,
      executablePath: null,
      workingDirectory: null,
      arguments: resolvedLaunch.arguments,
    });

    if (coverLocalPath && !game.coverPath?.trim()) {
      await gameService.applyCoverIfEmpty(gameId, coverLocalPath);
    }

    const fresh = await gameRepository.findById(gameId);
    if (!fresh) throw new Error("No se pudo actualizar el juego local.");

    return {
      game: fresh,
      catalog,
      runtimeName: runtime.name,
    };
  },

  /** true si hace falta bajar/reparar desde la nube. */
  async needsCloudRepair(gameId: string): Promise<boolean> {
    const game = await gameRepository.findById(gameId);
    if (!game?.catalogRemoteId) return false;

    const content = await gameContentService.getByGameId(gameId);
    if (!content?.path?.trim()) return true;
    if (!(await pathExists(content.path))) return true;

    const config = await launchConfigService.getByGameId(gameId);
    if (!config || config.type !== "runtime") return true;
    if (!config.contentPath?.trim()) return true;
    if (!(await pathExists(config.contentPath))) return true;
    if (!config.runtimeId) return true;

    const runtime = await runtimeRepository.findById(config.runtimeId);
    if (!runtime) return true;
    if (!(await pathExists(runtime.executablePath))) return true;

    return false;
  },
};
