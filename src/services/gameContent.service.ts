import { invoke } from "@tauri-apps/api/core";
import { gameRepository } from "../repositories/game.repository";
import { gameContentRepository } from "../repositories/gameContent.repository";
import type { GameContent, GameContentInput } from "../types/gameContent";

async function pathCheck(path: string, kind: "file" | "dir"): Promise<boolean> {
  return invoke<boolean>("path_check", { path, kind });
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
};
