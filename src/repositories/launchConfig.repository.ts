import { getDatabase } from "./sqlite.repository";
import type { LaunchConfig, LaunchType } from "../types/launch";

type LaunchConfigRow = {
  id: string;
  game_id: string;
  type: string;
  executable_path: string;
  runtime_id: string | null;
  content_path: string | null;
  working_directory: string | null;
  arguments: string;
  created_at: string;
  updated_at: string;
};

function parseArguments(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("La configuración de argumentos está corrupta.");
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error("La configuración de argumentos está corrupta.");
  }
  return parsed;
}

function pathFromDb(value: string | null | undefined): string | null {
  if (value == null || value.trim() === "") return null;
  return value;
}

function pathToDb(value: string | null | undefined): string {
  if (value == null || value.trim() === "") return "";
  return value;
}

function nullablePathFromDb(value: string | null | undefined): string | null {
  if (value == null || value.trim() === "") return null;
  return value;
}

function mapRow(row: LaunchConfigRow): LaunchConfig {
  return {
    id: row.id,
    gameId: row.game_id,
    type: row.type as LaunchType,
    executablePath: pathFromDb(row.executable_path),
    runtimeId: row.runtime_id,
    contentPath: nullablePathFromDb(row.content_path),
    workingDirectory: row.working_directory,
    arguments: parseArguments(row.arguments),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type LaunchConfigCreateRecord = {
  id: string;
  gameId: string;
  type: LaunchType;
  executablePath: string | null;
  runtimeId: string | null;
  contentPath: string | null;
  workingDirectory: string | null;
  arguments: string[];
  createdAt: string;
  updatedAt: string;
};

export const launchConfigRepository = {
  async findByGameId(gameId: string): Promise<LaunchConfig | null> {
    const db = await getDatabase();
    const rows = await db.select<LaunchConfigRow[]>(
      `SELECT id, game_id, type, executable_path, runtime_id, content_path,
              working_directory, arguments, created_at, updated_at
       FROM launch_configs
       WHERE game_id = $1
       LIMIT 1`,
      [gameId],
    );
    const row = rows[0];
    return row ? mapRow(row) : null;
  },

  async countByRuntimeId(runtimeId: string): Promise<number> {
    const db = await getDatabase();
    const rows = await db.select<{ count: number }[]>(
      `SELECT COUNT(*) as count FROM launch_configs WHERE runtime_id = $1`,
      [runtimeId],
    );
    return Number(rows[0]?.count ?? 0);
  },

  async create(record: LaunchConfigCreateRecord): Promise<LaunchConfig> {
    const db = await getDatabase();
    await db.execute(
      `INSERT INTO launch_configs (
         id, game_id, type, executable_path, runtime_id, content_path,
         working_directory, arguments, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        record.id,
        record.gameId,
        record.type,
        pathToDb(record.executablePath),
        record.runtimeId,
        record.contentPath,
        record.workingDirectory,
        JSON.stringify(record.arguments),
        record.createdAt,
        record.updatedAt,
      ],
    );
    return { ...record };
  },

  async update(
    gameId: string,
    fields: {
      type: LaunchType;
      executablePath: string | null;
      runtimeId: string | null;
      contentPath: string | null;
      workingDirectory: string | null;
      arguments: string[];
      updatedAt: string;
    },
  ): Promise<LaunchConfig | null> {
    const db = await getDatabase();
    await db.execute(
      `UPDATE launch_configs SET
         type = $1,
         executable_path = $2,
         runtime_id = $3,
         content_path = $4,
         working_directory = $5,
         arguments = $6,
         updated_at = $7
       WHERE game_id = $8`,
      [
        fields.type,
        pathToDb(fields.executablePath),
        fields.runtimeId,
        fields.contentPath,
        fields.workingDirectory,
        JSON.stringify(fields.arguments),
        fields.updatedAt,
        gameId,
      ],
    );
    return this.findByGameId(gameId);
  },

  async deleteByGameId(gameId: string): Promise<void> {
    const db = await getDatabase();
    await db.execute(`DELETE FROM launch_configs WHERE game_id = $1`, [gameId]);
  },
};
