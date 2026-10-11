import { invoke } from "@tauri-apps/api/core";
import { gameRepository } from "../repositories/game.repository";
import { gameContentRepository } from "../repositories/gameContent.repository";
import { launchConfigService } from "./launchConfig.service";
import {
  catalogGamesDir,
  joinPath,
  removePath,
} from "./catalogTransfer.service";
import type { GameContent, GameContentInput } from "../types/gameContent";

async function pathCheck(path: string, kind: "file" | "dir"): Promise<boolean> {
  return invoke<boolean>("path_check", { path, kind });
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Si el archivo vive bajo catalog-games/{id}/, borra toda esa carpeta. */
async function resolveDeleteTarget(filePath: string): Promise<string> {
  const gamesDir = await catalogGamesDir();
  const base = normalizePath(gamesDir);
  const file = normalizePath(filePath);
  if (!file.toLowerCase().startsWith(`${base.toLowerCase()}/`)) {
    return filePath;
  }
  const relative = file.slice(base.length + 1);
  const firstSeg = relative.split("/")[0];
  if (!firstSeg) return filePath;
  return joinPath(gamesDir, firstSeg);
}

export const gameContentService = {
  async getByGameId(gameId: string): Promise<GameContent | null> {
    return gameContentRepository.findByGameId(gameId);
  },

  async pathExists(path: string): Promise<boolean> {
    return pathCheck(path, "file");
  },

  async associate(input: GameContentInput): Promise<GameContent> {
    const gameId = input.gameId?.trim();
    if (!gameId) {
      throw new Error("Falta el identificador del juego.");
    }

    const game = await gameRepository.findById(gameId);
    if (!game) {
      throw new Error("El juego no existe.");
    }

    const path = input.path?.trim() ?? "";
    if (!path) {
      throw new Error("El archivo de contenido no existe.");
    }

    const exists = await pathCheck(path, "file");
    if (!exists) {
      throw new Error("El archivo de contenido no existe.");
    }

    const existing = await gameContentRepository.findByGameId(gameId);
    const now = new Date().toISOString();

    if (existing) {
      const updated = await gameContentRepository.update(gameId, {
        path,
        updatedAt: now,
      });
      if (!updated) {
        throw new Error("No se pudo actualizar el contenido.");
      }
      return updated;
    }

    return gameContentRepository.create({
      id: crypto.randomUUID(),
      gameId,
      path,
      createdAt: now,
      updatedAt: now,
    });
  },

  async remove(gameId: string): Promise<void> {
    const existing = await gameContentRepository.findByGameId(gameId);
    if (!existing) {
      return;
    }
    await gameContentRepository.deleteByGameId(gameId);
  },

  /**
   * Steam-like uninstall: borra archivos locales y limpia asociaciones.
   * Conserva la ficha en biblioteca, favoritos, horas y logros.
   */
  async uninstallLocalFiles(gameId: string): Promise<void> {
    const id = gameId.trim();
    if (!id) throw new Error("Falta el identificador del juego.");

    const game = await gameRepository.findById(id);
    if (!game) throw new Error("El juego no existe.");

    const content = await gameContentRepository.findByGameId(id);
    const launch = await launchConfigService.getByGameId(id);
    const candidates = [
      content?.path?.trim(),
      launch?.type === "runtime" ? launch.contentPath?.trim() : null,
    ].filter((p): p is string => !!p);

    const targets = new Set<string>();
    for (const path of candidates) {
      targets.add(await resolveDeleteTarget(path));
    }

    for (const target of targets) {
      await removePath(target);
    }

    await gameContentRepository.deleteByGameId(id);
    await launchConfigService.clearContentPath(id);
  },
};
