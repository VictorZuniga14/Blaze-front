import { invoke } from "@tauri-apps/api/core";
import { catalogApiService } from "./catalogApi.service";
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
import { resolveRetroArchLaunchArguments } from "../utils/platformRuntime";

export type CatalogInstallProgress = {
  phase: "resolving" | "downloading" | "installing";
  bytesDone: number;
  bytesTotal: number;
  message: string;
};

export type CatalogInstallResult = {
  game: Game;
  catalog: CatalogGame;
  runtimeName: string;
};

async function pathExists(path: string): Promise<boolean> {
  return invoke<boolean>("path_check", { path, kind: "file" });
}

async function downloadCatalogPayload(
  catalog: CatalogGame,
  onProgress?: (p: CatalogInstallProgress) => void,
): Promise<{
  destPath: string;
  coverLocalPath: string | null;
  installPaths: string[];
}> {
  const dl = await catalogApiService.downloadUrl(catalog.id);
  const bytesTotal = Number(dl.fileSizeBytes) || 0;
  const transferId = crypto.randomUUID();
  const baseDir = await catalogGamesDir();
  const gameDir = await joinPath(baseDir, catalog.id);
  const destPath = await joinPath(gameDir, dl.fileName);

  const unlisten = await listenTransferProgress(transferId, (p) => {
    onProgress?.({
      phase: "downloading",
      bytesDone: p.bytesDone,
      bytesTotal: p.bytesTotal,
      message: "Descargando desde el catálogo…",
    });
  });

  let coverLocalPath: string | null = null;
  try {
    onProgress?.({
      phase: "downloading",
      bytesDone: 0,
      bytesTotal,
      message: "Descargando desde el catálogo…",
    });
    await downloadFile({
      transferId,
      url: dl.url,
      destPath,
      bytesTotal,
    });

    if (catalog.hasCover) {
      try {
        const cover = await catalogApiService.coverUrl(catalog.id);
        coverLocalPath = await joinPath(gameDir, cover.fileName);
        onProgress?.({
          phase: "downloading",
          bytesDone: bytesTotal,
          bytesTotal,
          message: "Descargando portada…",
        });
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
  if (/\.zip$/i.test(destPath)) {
    onProgress?.({
      phase: "installing",
      bytesDone: bytesTotal,
      bytesTotal,
      message: "Descomprimiendo paquete del catálogo…",
    });
    const extracted = await extractCatalogZip(destPath, gameDir);
    playablePath = extracted.primaryPath;
    installPaths = extracted.installPaths;
    try {
      await removePath(destPath);
    } catch {
      // best-effort: dejar el zip no rompe el juego
    }
  }

  return { destPath: playablePath, coverLocalPath, installPaths };
}

/**
 * Catálogo → biblioteca (solo ficha). La descarga del ROM es otro paso.
 */
export const catalogInstallService = {
  async addToLibrary(catalogGameId: string): Promise<{
    game: Game;
    catalog: CatalogGame;
  }> {
    const catalog = await catalogApiService.get(catalogGameId);
    const existing = await gameRepository.findByCatalogRemoteId(catalog.id);
    if (existing) {
      throw new Error(
        "Este juego ya está en tu biblioteca. Abrilo desde Biblioteca.",
      );
    }

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
    });

    const updatedAt = new Date().toISOString();
    await gameRepository.setStatus(game.id, "published", updatedAt);
    await gameRepository.setCatalogRemoteId(game.id, catalog.id, updatedAt);

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
    onProgress?.({
      phase: "resolving",
      bytesDone: 0,
      bytesTotal: 0,
      message: "Preparando emulador…",
    });
    const runtime = await ensureRuntime(platform);

    const { destPath, coverLocalPath, installPaths } =
      await downloadCatalogPayload(catalog, onProgress);

    if (installPaths.length > 0) {
      onProgress?.({
        phase: "installing",
        bytesDone: 0,
        bytesTotal: 0,
        message: `Instalando ${installPaths.length} update/DLC en Eden…`,
      });
      try {
        await installEdenTitleNsps(runtime.executablePath, installPaths);
      } catch (e) {
        console.warn("[catalog] Eden install update/DLC:", e);
      }
    }

    onProgress?.({
      phase: "installing",
      bytesDone: 0,
      bytesTotal: 0,
      message: "Actualizando rutas locales…",
    });

    await gameContentService.associate({ gameId, path: destPath });
    const argumentsForLaunch = await resolveRetroArchLaunchArguments(
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
      arguments: argumentsForLaunch,
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
