export type GameStatus = "draft" | "published";

export type Game = {
  id: string;
  title: string;
  description: string | null;
  developer: string | null;
  publisher: string | null;
  genre: string | null;
  platform: string | null;
  releaseYear: number | null;
  coverPath: string | null;
  isFavorite: boolean;
  /** draft = metadata; published = listo para jugar. */
  status: GameStatus;
  /** ID oficial en RetroAchievements (mapping explícito). */
  retroAchievementsGameId: number | null;
  /** Id en el catálogo Blaze (servidor), si vino de descarga o se publicó. */
  catalogRemoteId: string | null;
  /** Idiomas que declara el juego (códigos: en, es, …). Vacío → se trata como solo en. */
  availableLanguages: string[];
  /** Preferencia del usuario; null = usar el primero disponible. */
  preferredLanguage: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Campos editables al crear o actualizar (sin id ni timestamps). */
export type GameWritableFields = {
  title: string;
  description?: string | null;
  developer?: string | null;
  publisher?: string | null;
  genre?: string | null;
  platform?: string | null;
  releaseYear?: number | null;
  coverPath?: string | null;
  isFavorite?: boolean;
  status?: GameStatus;
  retroAchievementsGameId?: number | null;
  availableLanguages?: string[] | null;
  preferredLanguage?: string | null;
};

export type GameSort =
  | "title-asc"
  | "title-desc"
  | "newest"
  | "oldest"
  | "favorites-first";

export const GAME_LIMITS = {
  title: 200,
  description: 2000,
  metadata: 200,
  /** Rutas locales o URLs firmadas de R2 (pueden pasar largo 200). */
  coverPath: 2048,
  releaseYearMin: 1,
  releaseYearMax: 9999,
} as const;

export function isGameDraft(game: Pick<Game, "status"> | null | undefined): boolean {
  return game?.status === "draft";
}

export function isGamePublished(game: Pick<Game, "status"> | null | undefined): boolean {
  return game?.status === "published";
}
