import { getDatabase } from "./sqlite.repository";
import type { GameContent } from "../types/gameContent";

type GameContentRow = {
  id: string;
  game_id: string;
  path: string;
  created_at: string;
  updated_at: string;
};

function mapRow(row: GameContentRow): GameContent {
  return {
    id: row.id,
    gameId: row.game_id,
    path: row.path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type GameContentCreateRecord = {
  id: string;
  gameId: string;
  path: string;
  createdAt: string;
  updatedAt: string;
};

export const gameContentRepository = {
  async findByGameId(gameId: string): Promise<GameContent | null> {
    const db = await getDatabase();
    const rows = await db.select<GameContentRow[]>(
      `SELECT id, game_id, path, created_at, updated_at
       FROM game_contents
       WHERE game_id = $1
       LIMIT 1`,
      [gameId],
    );
    const row = rows[0];
    return row ? mapRow(row) : null;
  },

  async create(record: GameContentCreateRecord): Promise<GameContent> {
    const db = await getDatabase();
    await db.execute(
      `INSERT INTO game_contents (id, game_id, path, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        record.id,
        record.gameId,
        record.path,
        record.createdAt,
        record.updatedAt,
      ],
    );
    return { ...record };
  },

  async update(
    gameId: string,
    fields: { path: string; updatedAt: string },
  ): Promise<GameContent | null> {
    const db = await getDatabase();
    await db.execute(
      `UPDATE game_contents SET path = $1, updated_at = $2 WHERE game_id = $3`,
      [fields.path, fields.updatedAt, gameId],
    );
    return this.findByGameId(gameId);
  },

  async deleteByGameId(gameId: string): Promise<void> {
    const db = await getDatabase();
    await db.execute(`DELETE FROM game_contents WHERE game_id = $1`, [gameId]);
  },
};
