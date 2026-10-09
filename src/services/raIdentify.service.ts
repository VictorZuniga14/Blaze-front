import { invoke } from "@tauri-apps/api/core";
import { launchConfigService } from "./launchConfig.service";
import { runtimeRepository } from "../repositories/runtime.repository";
import { gameService } from "./game.service";
import { retroAchievementsApiService } from "./retroAchievementsApi.service";
import {
  resolveRaAdapter,
  resolveRaAdapterKind,
} from "./ra";
import type { RetroAchievementsIdentification } from "./ra";
import {
  resolveRaConsole,
  supportsRaIdentify,
} from "../utils/raConsoles";
import type { Game } from "../types/game";
import type { RaGameCandidate } from "../types/retroAchievements";

export type RaIdentifyUiState =
  | "idle"
  | "analyzing"
  | "looking_up"
  | "identified"
  | "not_found"
  | "conflict"
  | "unsupported"
  | "error";

export type RaIdentifyResult = {
  state: RaIdentifyUiState;
  hash?: string;
  platform?: string;
  emulator?: string;
  raGameId?: number;
  title?: string | null;
  consoleName?: string | null;
  existingRaGameId?: number | null;
  message: string;
  game?: Game;
};

async function pathCheck(path: string, kind: "file" | "dir"): Promise<boolean> {
  return invoke<boolean>("path_check", { path, kind });
}

/** Tauri suele rechazar con string; no siempre con Error. */
function errMessage(err: unknown, fallback: string): string {
  if (typeof err === "string" && err.trim()) return err;
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}

/** Regla de persistencia: no sobrescribe mapping distinto sin confirmación. */
export function decidePersistRaGameId(input: {
  existingRaGameId: number | null;
  identifiedRaGameId: number;
  overwriteExisting: boolean;
}): "save" | "skip_same" | "conflict" {
  const { existingRaGameId, identifiedRaGameId, overwriteExisting } = input;
  if (existingRaGameId == null) return "save";
  if (existingRaGameId === identifiedRaGameId) return "skip_same";
  if (overwriteExisting) return "save";
  return "conflict";
}

function normalizeRaTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Un solo candidato o un único match de título → auto-vínculo. */
export function pickTitleFallbackCandidate(
  list: RaGameCandidate[],
  gameTitle: string,
): RaGameCandidate | null {
  if (list.length === 0) return null;
  if (list.length === 1) return list[0]!;

  const needle = normalizeRaTitle(gameTitle);
  const exact = list.filter((c) => normalizeRaTitle(c.title) === needle);
  if (exact.length === 1) return exact[0]!;

  const loose = list.filter((c) => {
    const t = normalizeRaTitle(c.title);
    return t.includes(needle) || needle.includes(t);
  });
  if (loose.length === 1) return loose[0]!;
  return null;
}

/**
 * Orquesta: Runtime + Game.platform → adapter → hash → backend identify → raGameId.
 */
export const raIdentifyService = {
  async resolveContentPath(gameId: string): Promise<string | null> {
    const config = await launchConfigService.getByGameId(gameId);
    const fromLaunch = config?.contentPath?.trim() || null;
    if (fromLaunch && (await pathCheck(fromLaunch, "file"))) {
      return fromLaunch;
    }
    return null;
  },

  async canAutoIdentify(gameId: string): Promise<{
    ok: boolean;
    reason?: string;
  }> {
    const game = await gameService.getGame(gameId);
    const config = await launchConfigService.getByGameId(gameId);
    if (!config || config.type !== "runtime" || !config.runtimeId) {
      return {
        ok: false,
        reason: "Configurá ejecución tipo Runtime (PCSX2 / RetroArch) con contenido.",
      };
    }
    const runtime = await runtimeRepository.findById(config.runtimeId);
    const adapter = resolveRaAdapter(runtime);
    const kind = resolveRaAdapterKind(runtime);
    if (!adapter || !kind) {
      return {
        ok: false,
        reason: "El runtime no tiene adapter RA (PCSX2 / RetroArch).",
      };
    }
    if (!adapter.supportsContentIdentification()) {
      return {
        ok: false,
        reason:
          "Este emulador aún no soporta identificación automática. Usá mapping manual.",
      };
    }

    const resolved = resolveRaConsole({
      platform: game?.platform,
      runtimeKind: kind,
    });
    if (!resolved) {
      return {
        ok: false,
        reason:
          "Indicá la plataforma del juego (ej. SNES, GBA, PS1). Necesaria para RetroArch.",
      };
    }
    if (!supportsRaIdentify(resolved.key)) {
      return {
        ok: false,
        reason: `Identificación automática aún no soportada para ${resolved.label}. Usá mapping manual.`,
      };
    }

    const contentPath = await this.resolveContentPath(gameId);
    if (!contentPath) {
      return { ok: false, reason: "No hay archivo de contenido asociado." };
    }
    return { ok: true };
  },

  async identifyGame(input: {
    gameId: string;
    /** Si true, reemplaza un raGameId distinto ya guardado. */
    overwriteExisting?: boolean;
  }): Promise<RaIdentifyResult> {
    const game = await gameService.getGame(input.gameId);
    if (!game) {
      return { state: "error", message: "El juego no existe." };
    }

    const config = await launchConfigService.getByGameId(input.gameId);
    if (!config || config.type !== "runtime" || !config.runtimeId) {
      return {
        state: "unsupported",
        message: "Se necesita LaunchConfig tipo runtime con contenido.",
      };
    }

    const runtime = await runtimeRepository.findById(config.runtimeId);
    const adapter = resolveRaAdapter(runtime);
    const kind = resolveRaAdapterKind(runtime);
    if (!adapter || !kind) {
      return {
        state: "unsupported",
        message: "Runtime sin adapter RA.",
      };
    }
    if (!adapter.supportsContentIdentification()) {
      return {
        state: "unsupported",
        message:
          "Identificación automática no disponible para este emulador. Usá mapping manual.",
      };
    }

    const resolved = resolveRaConsole({
      platform: game.platform,
      runtimeKind: kind,
    });
    if (!resolved) {
      return {
        state: "unsupported",
        message:
          "Indicá la plataforma del juego antes de identificar (ej. SNES, GBA). No se usa solo la extensión del archivo.",
      };
    }
    if (!supportsRaIdentify(resolved.key)) {
      return {
        state: "unsupported",
        message: `Identificación automática aún no soportada para ${resolved.label}. Usá mapping manual.`,
      };
    }

    const contentPath = await this.resolveContentPath(input.gameId);
    if (!contentPath) {
      return {
        state: "error",
        message: "No se encontró el archivo de contenido.",
      };
    }

    let local: RetroAchievementsIdentification;
    try {
      local = await adapter.identifyContent(contentPath, {
        platform: game.platform,
      });
    } catch (err) {
      return {
        state: "error",
        message: errMessage(err, "No se pudo analizar el contenido."),
      };
    }

    let lookup;
    try {
      lookup = await retroAchievementsApiService.identify({
        console: local.platform,
        hash: local.hash,
      });
    } catch (err) {
      return {
        state: "error",
        hash: local.hash,
        platform: local.platform,
        emulator: local.emulator,
        message: errMessage(err, "No se pudo consultar RetroAchievements."),
      };
    }

    if (!lookup.found || !lookup.raGameId) {
      return {
        state: "not_found",
        hash: local.hash,
        platform: local.platform,
        emulator: local.emulator,
        message:
          lookup.message ??
          "Tu dump no coincide con ningún hash registrado en RetroAchievements (el juego puede existir igual).",
      };
    }

    const existing = game.retroAchievementsGameId;
    const persist = decidePersistRaGameId({
      existingRaGameId: existing,
      identifiedRaGameId: lookup.raGameId,
      overwriteExisting: Boolean(input.overwriteExisting),
    });

    if (persist === "conflict") {
      return {
        state: "conflict",
        hash: local.hash,
        platform: local.platform,
        emulator: local.emulator,
        raGameId: lookup.raGameId,
        title: lookup.title,
        consoleName: lookup.consoleName,
        existingRaGameId: existing,
        message: `Ya hay un mapping manual (#${existing}). El hash apunta a #${lookup.raGameId}${
          lookup.title ? ` (${lookup.title})` : ""
        }. Confirmá para reemplazar.`,
      };
    }

    if (persist === "skip_same") {
      const withCover = await gameService.applyCoverIfEmpty(
        input.gameId,
        lookup.imageIcon,
      );
      return {
        state: "identified",
        hash: local.hash,
        platform: local.platform,
        emulator: local.emulator,
        raGameId: lookup.raGameId,
        title: lookup.title,
        consoleName: lookup.consoleName,
        game: withCover,
        message: `Ya vinculado: ${lookup.title ?? `RA #${lookup.raGameId}`}`,
      };
    }

    let updated = await gameService.setRetroAchievementsGameId(
      input.gameId,
      lookup.raGameId,
    );
    updated = await gameService.applyCoverIfEmpty(
      input.gameId,
      lookup.imageIcon,
    );

    return {
      state: "identified",
      hash: local.hash,
      platform: local.platform,
      emulator: local.emulator,
      raGameId: lookup.raGameId,
      title: lookup.title,
      consoleName: lookup.consoleName,
      game: updated,
      message: `Juego identificado: ${lookup.title ?? `RA #${lookup.raGameId}`}`,
    };
  },

  /**
   * Hash primero; si no hay match, búsqueda global por título y auto-vínculo
   * cuando el candidato es claro.
   */
  async identifyGameWithTitleFallback(input: {
    gameId: string;
    overwriteExisting?: boolean;
  }): Promise<RaIdentifyResult> {
    const primary = await this.identifyGame(input);
    if (primary.state === "identified" || primary.state === "conflict") {
      return primary;
    }
    // Sin ROM local / runtime (flujo Dev→R2) también probamos por título.
    const canTryTitle =
      primary.state === "not_found" ||
      primary.state === "error" ||
      primary.state === "unsupported";
    if (!canTryTitle) {
      return primary;
    }

    const game = await gameService.getGame(input.gameId);
    if (!game) {
      return primary;
    }

    let candidates: RaGameCandidate[] = [];
    try {
      const preferred = resolveRaConsole({ platform: game.platform });
      if (preferred) {
        candidates = await retroAchievementsApiService.search({
          query: game.title,
          consoleId: preferred.consoleId,
        });
      }
      if (candidates.length === 0) {
        candidates = await retroAchievementsApiService.search({
          query: game.title,
        });
      }
    } catch {
      return {
        ...primary,
        message:
          primary.message ||
          "Sin match por hash. Tampoco se pudo buscar por título.",
      };
    }

    const pick = pickTitleFallbackCandidate(candidates, game.title);
    if (!pick) {
      return {
        state: "not_found",
        hash: primary.hash,
        platform: primary.platform,
        emulator: primary.emulator,
        message:
          candidates.length > 0
            ? `Hay varios candidatos por título (${candidates.length}). Vinculá manualmente en RetroAchievements.`
            : "Sin match por hash ni por título en RA. Podés vincular el ID después.",
      };
    }

    const persist = decidePersistRaGameId({
      existingRaGameId: game.retroAchievementsGameId,
      identifiedRaGameId: pick.raGameId,
      overwriteExisting: Boolean(input.overwriteExisting),
    });
    if (persist === "conflict") {
      return {
        state: "conflict",
        raGameId: pick.raGameId,
        title: pick.title,
        consoleName: pick.consoleName,
        existingRaGameId: game.retroAchievementsGameId,
        message: `Ya hay un mapping (#${game.retroAchievementsGameId}). Por título: #${pick.raGameId} (${pick.title}).`,
      };
    }

    let updated =
      persist === "skip_same"
        ? game
        : await gameService.setRetroAchievementsGameId(
            input.gameId,
            pick.raGameId,
          );
    updated = await gameService.applyCoverIfEmpty(
      input.gameId,
      pick.imageIcon,
    );

    const noAchievements =
      pick.numAchievements <= 0
        ? " Este juego no contiene logros para mostrar."
        : "";

    return {
      state: "identified",
      raGameId: pick.raGameId,
      title: pick.title,
      consoleName: pick.consoleName,
      game: updated,
      message: `Vinculado por título: ${pick.title} (#${pick.raGameId}).${noAchievements}`,
    };
  },
};
