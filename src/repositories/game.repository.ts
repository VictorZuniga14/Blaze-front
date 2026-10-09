import { getDatabase } from "./sqlite.repository";
import type { Game, GameStatus } from "../types/game";

type GameRow = {
  id: string;
  title: string;
  description: string | null;
  developer: string | null;
  publisher: string | null;
  genre: string | null;
  platform: string | null;
  release_year: number | null;
  cover_path: string | null;
  is_favorite: number;
  status: string | null;
  retro_achievements_game_id: number | null;
  catalog_remote_id: string | null;
  created_at: string;
  updated_at: string;
};

function normalizeStatus(value: string | null | undefined): GameStatus {
  return value === "draft" ? "draft" : "published";
}

function mapRow(row: GameRow): Game {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    developer: row.developer,
    publisher: row.publisher,
    genre: row.genre,
    platform: row.platform,
    releaseYear: row.release_year,
    coverPath: row.cover_path,
    isFavorite: row.is_favorite === 1,
    status: normalizeStatus(row.status),
    retroAchievementsGameId: row.retro_achievements_game_id ?? null,
    catalogRemoteId: row.catalog_remote_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLS = `id, title, description, developer, publisher, genre, platform,
              release_year, cover_path, is_favorite, status, retro_achievements_game_id,
              catalog_remote_id, created_at, updated_at`;

export const gameRepository = {
  async findAll(): Promise<Game[]> {
    const db = await getDatabase();
    const rows = await db.select<GameRow[]>(
      `SELECT ${SELECT_COLS}
       FROM games
       ORDER BY created_at DESC`,
    );
    return rows.map(mapRow);
  },

  async findById(id: string): Promise<Game | null> {
    const db = await getDatabase();
    const rows = await db.select<GameRow[]>(
      `SELECT ${SELECT_COLS}
       FROM games
       WHERE id = $1
       LIMIT 1`,
      [id],
    );
    const row = rows[0];
    return row ? mapRow(row) : null;
  },

  async create(game: Game): Promise<Game> {
    const db = await getDatabase();
    await db.execute(
      `INSERT INTO games (
         id, title, description, developer, publisher, genre, platform,
         release_year, cover_path, is_favorite, status, retro_achievements_game_id,
         catalog_remote_id, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        game.id,
        game.title,
        game.description,
        game.developer,
        game.publisher,
        game.genre,
        game.platform,
        game.releaseYear,
        game.coverPath,
        game.isFavorite ? 1 : 0,
        game.status,
        game.retroAchievementsGameId,
        game.catalogRemoteId,
        game.createdAt,
        game.updatedAt,
      ],
    );
    return game;
  },

  async update(game: Game): Promise<Game> {
    const db = await getDatabase();
    await db.execute(
      `UPDATE games SET
         title = $1,
         description = $2,
         developer = $3,
         publisher = $4,
         genre = $5,
         platform = $6,
         release_year = $7,
         cover_path = $8,
         is_favorite = $9,
         status = $10,
         retro_achievements_game_id = $11,
         catalog_remote_id = $12,
         updated_at = $13
       WHERE id = $14`,
      [
        game.title,
        game.description,
        game.developer,
        game.publisher,
        game.genre,
        game.platform,
        game.releaseYear,
        game.coverPath,
        game.isFavorite ? 1 : 0,
        game.status,
        game.retroAchievementsGameId,
        game.catalogRemoteId,
        game.updatedAt,
        game.id,
      ],
    );
    return game;
  },

  async delete(id: string): Promise<void> {
    const db = await getDatabase();
    await db.execute(`DELETE FROM games WHERE id = $1`, [id]);
  },

  async setFavorite(id: string, isFavorite: boolean, updatedAt: string): Promise<void> {
    const db = await getDatabase();
    await db.execute(
      `UPDATE games SET is_favorite = $1, updated_at = $2 WHERE id = $3`,
      [isFavorite ? 1 : 0, updatedAt, id],
    );
  },

  async setStatus(id: string, status: GameStatus, updatedAt: string): Promise<void> {
    const db = await getDatabase();
    await db.execute(
      `UPDATE games SET status = $1, updated_at = $2 WHERE id = $3`,
      [status, updatedAt, id],
    );
  },

  async setRetroAchievementsGameId(
    id: string,
    raGameId: number | null,
    updatedAt: string,
  ): Promise<void> {
    const db = await getDatabase();
    await db.execute(
      `UPDATE games SET retro_achievements_game_id = $1, updated_at = $2 WHERE id = $3`,
      [raGameId, updatedAt, id],
    );
  },

  async setCoverPath(
    id: string,
    coverPath: string | null,
    updatedAt: string,
  ): Promise<void> {
    const db = await getDatabase();
    await db.execute(
      `UPDATE games SET cover_path = $1, updated_at = $2 WHERE id = $3`,
      [coverPath, updatedAt, id],
    );
  },

  async setCatalogRemoteId(
    id: string,
    catalogRemoteId: string | null,
    updatedAt: string,
  ): Promise<void> {
    const db = await getDatabase();
    await db.execute(
      `UPDATE games SET catalog_remote_id = $1, updated_at = $2 WHERE id = $3`,
      [catalogRemoteId, updatedAt, id],
    );
  },

  async findByCatalogRemoteId(catalogRemoteId: string): Promise<Game | null> {
    const db = await getDatabase();
    const rows = await db.select<GameRow[]>(
      `SELECT ${SELECT_COLS}
       FROM games
       WHERE catalog_remote_id = $1
       LIMIT 1`,
      [catalogRemoteId],
    );
    const row = rows[0];
    return row ? mapRow(row) : null;
  },
};
