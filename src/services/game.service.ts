import { gameRepository } from "../repositories/game.repository";
import {
  GAME_LIMITS,
  type Game,
  type GameWritableFields,
} from "../types/game";

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function assertMaxLength(label: string, value: string | null, max: number): void {
  if (value != null && value.length > max) {
    throw new Error(`${label} no puede superar ${max} caracteres.`);
  }
}

function validateWritable(input: GameWritableFields): {
  title: string;
  description: string | null;
  developer: string | null;
  publisher: string | null;
  genre: string | null;
  platform: string | null;
  releaseYear: number | null;
  coverPath: string | null;
  isFavorite: boolean;
  /** undefined = no cambiar al actualizar */
  retroAchievementsGameId: number | null | undefined;
  availableLanguages?: string[] | null;
  preferredLanguage?: string | null;
} {
  const title = input.title?.trim() ?? "";
  if (!title) {
    throw new Error("El título es obligatorio.");
  }
  assertMaxLength("El título", title, GAME_LIMITS.title);

  const description = normalizeOptionalText(input.description);
  assertMaxLength("La descripción", description, GAME_LIMITS.description);

  const developer = normalizeOptionalText(input.developer);
  const publisher = normalizeOptionalText(input.publisher);
  const genre = normalizeOptionalText(input.genre);
  const platform = normalizeOptionalText(input.platform);
  const coverPath = normalizeOptionalText(input.coverPath);

  assertMaxLength("El desarrollador", developer, GAME_LIMITS.metadata);
  assertMaxLength("El publisher", publisher, GAME_LIMITS.metadata);
  assertMaxLength("El género", genre, GAME_LIMITS.metadata);
  assertMaxLength("La plataforma", platform, GAME_LIMITS.metadata);
  assertMaxLength("La ruta de portada", coverPath, GAME_LIMITS.coverPath);

  let releaseYear: number | null = null;
  if (input.releaseYear != null) {
    const year = input.releaseYear;
    if (!Number.isInteger(year) || year < GAME_LIMITS.releaseYearMin || year > GAME_LIMITS.releaseYearMax) {
      throw new Error(
        `El año debe ser un entero entre ${GAME_LIMITS.releaseYearMin} y ${GAME_LIMITS.releaseYearMax}.`,
      );
    }
    releaseYear = year;
  }

  let retroAchievementsGameId: number | null | undefined = undefined;
  if ("retroAchievementsGameId" in input) {
    if (input.retroAchievementsGameId == null) {
      retroAchievementsGameId = null;
    } else {
      const id = input.retroAchievementsGameId;
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error(
          "El ID de RetroAchievements debe ser un entero positivo.",
        );
      }
      retroAchievementsGameId = id;
    }
  }

  return {
    title,
    description,
    developer,
    publisher,
    genre,
    platform,
    releaseYear,
    coverPath,
    isFavorite: Boolean(input.isFavorite),
    retroAchievementsGameId,
    availableLanguages: input.availableLanguages,
    preferredLanguage: input.preferredLanguage,
  };
}

export const gameService = {
  async listGames(): Promise<Game[]> {
    return gameRepository.findAll();
  },

  async getGame(id: string): Promise<Game | null> {
    return gameRepository.findById(id);
  },

  async createGame(input: GameWritableFields): Promise<Game> {
    const fields = validateWritable(input);
    const now = new Date().toISOString();
    const game: Game = {
      id: crypto.randomUUID(),
      title: fields.title,
      description: fields.description,
      developer: fields.developer,
      publisher: fields.publisher,
      genre: fields.genre,
      platform: fields.platform,
      releaseYear: fields.releaseYear,
      coverPath: fields.coverPath,
      isFavorite: fields.isFavorite,
      /** Alta = borrador hasta "Guardar juego" en el detalle. */
      status: "draft",
      retroAchievementsGameId: fields.retroAchievementsGameId ?? null,
      catalogRemoteId: null,
      availableLanguages: fields.availableLanguages?.length
        ? fields.availableLanguages
        : ["en"],
      preferredLanguage: fields.preferredLanguage ?? null,
      createdAt: now,
      updatedAt: now,
    };
    return gameRepository.create(game);
  },

  async updateGame(id: string, input: GameWritableFields): Promise<Game> {
    const existing = await gameRepository.findById(id);
    if (!existing) {
      throw new Error("El juego no existe.");
    }

    const fields = validateWritable(input);
    const updated: Game = {
      ...existing,
      title: fields.title,
      description: fields.description,
      developer: fields.developer,
      publisher: fields.publisher,
      genre: fields.genre,
      platform: fields.platform,
      releaseYear: fields.releaseYear,
      coverPath: fields.coverPath,
      isFavorite: fields.isFavorite,
      status: existing.status,
      retroAchievementsGameId:
        fields.retroAchievementsGameId === undefined
          ? existing.retroAchievementsGameId
          : fields.retroAchievementsGameId,
      catalogRemoteId: existing.catalogRemoteId,
      availableLanguages:
        fields.availableLanguages?.length
          ? fields.availableLanguages
          : existing.availableLanguages,
      preferredLanguage:
        fields.preferredLanguage === undefined
          ? existing.preferredLanguage
          : fields.preferredLanguage,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    return gameRepository.update(updated);
  },

  async setPreferredLanguage(
    id: string,
    preferredLanguage: string | null,
  ): Promise<Game> {
    const existing = await gameRepository.findById(id);
    if (!existing) {
      throw new Error("El juego no existe.");
    }
    const updatedAt = new Date().toISOString();
    await gameRepository.setLanguages(
      id,
      existing.availableLanguages,
      preferredLanguage,
      updatedAt,
    );
    const fresh = await gameRepository.findById(id);
    if (!fresh) throw new Error("El juego no existe.");
    return fresh;
  },

  async deleteGame(id: string): Promise<void> {
    const existing = await gameRepository.findById(id);
    if (!existing) {
      throw new Error("El juego no existe.");
    }
    await gameRepository.delete(id);
  },

  async setFavorite(id: string, isFavorite: boolean): Promise<Game> {
    const existing = await gameRepository.findById(id);
    if (!existing) {
      throw new Error("El juego no existe.");
    }
    const updatedAt = new Date().toISOString();
    await gameRepository.setFavorite(id, isFavorite, updatedAt);
    return {
      ...existing,
      isFavorite,
      updatedAt,
    };
  },

  async setRetroAchievementsGameId(
    id: string,
    raGameId: number | null,
  ): Promise<Game> {
    const existing = await gameRepository.findById(id);
    if (!existing) {
      throw new Error("El juego no existe.");
    }
    if (raGameId != null && (!Number.isInteger(raGameId) || raGameId <= 0)) {
      throw new Error(
        "El ID de RetroAchievements debe ser un entero positivo.",
      );
    }
    const updatedAt = new Date().toISOString();
    await gameRepository.setRetroAchievementsGameId(id, raGameId, updatedAt);
    return {
      ...existing,
      retroAchievementsGameId: raGameId,
      updatedAt,
    };
  },

  /** Si no hay portada, guarda una URL/ruta (p. ej. imageIcon de RA). */
  async applyCoverIfEmpty(
    id: string,
    coverPath: string | null | undefined,
  ): Promise<Game> {
    const existing = await gameRepository.findById(id);
    if (!existing) {
      throw new Error("El juego no existe.");
    }
    const next = coverPath?.trim() || null;
    if (!next || existing.coverPath?.trim()) {
      return existing;
    }
    const updatedAt = new Date().toISOString();
    await gameRepository.setCoverPath(id, next, updatedAt);
    return {
      ...existing,
      coverPath: next,
      updatedAt,
    };
  },
};
