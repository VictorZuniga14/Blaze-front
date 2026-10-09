import { invoke } from "@tauri-apps/api/core";
import { gameRepository } from "../repositories/game.repository";
import { launchConfigService } from "./launchConfig.service";
import { gameService } from "./game.service";
import { raIdentifyService } from "./raIdentify.service";
import type { Game } from "../types/game";
import type { LaunchConfig } from "../types/launch";

async function pathCheck(path: string, kind: "file" | "dir"): Promise<boolean> {
  return invoke<boolean>("path_check", { path, kind });
}

export type PublishValidation = {
  ok: boolean;
  errors: string[];
};

/** Reglas para pasar de borrador → publicado. */
export async function validateGameReadyToPublish(
  gameId: string,
): Promise<PublishValidation> {
  const errors: string[] = [];
  const game = await gameRepository.findById(gameId);
  if (!game) {
    return { ok: false, errors: ["El juego no existe."] };
  }

  const config = await launchConfigService.getByGameId(gameId);
  if (!config) {
    errors.push("Configurá la ejecución del juego.");
    return { ok: false, errors };
  }

  if (config.type === "runtime") {
    if (!config.runtimeId) {
      errors.push("Seleccioná un runtime (PCSX2 / RetroArch).");
    }
    if (!config.contentPath?.trim()) {
      errors.push("Asociá el archivo de contenido (ISO/ROM).");
    } else {
      const exists = await pathCheck(config.contentPath, "file");
      if (!exists) {
        errors.push("El archivo de contenido ya no existe en disco.");
      }
    }
  } else {
    if (!config.executablePath?.trim()) {
      errors.push("Configurá el ejecutable nativo.");
    } else {
      const exists = await pathCheck(config.executablePath, "file");
      if (!exists) {
        errors.push("El ejecutable configurado ya no existe.");
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export type PublishResult = {
  game: Game;
  config: LaunchConfig;
  identifyMessage: string | null;
};

/**
 * Valida launch + contenido, publica el juego e intenta identify RA
 * (hash → fallback título). No bloquea la publicación si RA falla.
 */
export const gamePublishService = {
  async publish(gameId: string): Promise<PublishResult> {
    const existing = await gameRepository.findById(gameId);
    if (!existing) {
      throw new Error("El juego no existe.");
    }

    const validation = await validateGameReadyToPublish(gameId);
    if (!validation.ok) {
      throw new Error(validation.errors.join(" "));
    }

    const config = await launchConfigService.getByGameId(gameId);
    if (!config) {
      throw new Error("Configurá la ejecución del juego.");
    }

    const updatedAt = new Date().toISOString();
    await gameRepository.setStatus(gameId, "published", updatedAt);
    let game: Game = {
      ...existing,
      status: "published",
      updatedAt,
    };

    let identifyMessage: string | null = null;
    if (!game.retroAchievementsGameId) {
      try {
        const identified = await raIdentifyService.identifyGameWithTitleFallback({
          gameId,
        });
        if (identified.game) {
          game = identified.game;
        } else {
          const fresh = await gameService.getGame(gameId);
          if (fresh) game = fresh;
        }
        if (identified.state === "identified") {
          identifyMessage = identified.message;
        } else if (identified.state === "conflict") {
          identifyMessage = identified.message;
        } else if (
          identified.state === "not_found" ||
          identified.state === "error" ||
          identified.state === "unsupported"
        ) {
          identifyMessage = identified.message;
        }
      } catch {
        identifyMessage =
          "Juego publicado. RetroAchievements se puede vincular después.";
      }
    }

    return { game, config, identifyMessage };
  },
};
