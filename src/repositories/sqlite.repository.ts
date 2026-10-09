import Database from "@tauri-apps/plugin-sql";

const DB_URL = "sqlite:blaze.db";

let dbPromise: Promise<Database> | null = null;

export function getDatabase(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load(DB_URL);
  }
  return dbPromise;
}

type ColumnInfo = { name: string };

/**
 * Acceso base a SQLite vía tauri-plugin-sql.
 */
export const sqliteRepository = {
  async ping(): Promise<{ ok: true; result: number }> {
    const db = await getDatabase();
    const rows = await db.select<{ value: number }[]>("SELECT 1 AS value");
    const value = rows[0]?.value;

    if (value !== 1) {
      throw new Error("SQLite smoke test falló: resultado inesperado");
    }

    return { ok: true, result: value };
  },

  async ensureSchema(): Promise<void> {
    const db = await getDatabase();
    await db.execute("PRAGMA foreign_keys = ON");
    await db.execute(`
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        developer TEXT,
        publisher TEXT,
        genre TEXT,
        platform TEXT,
        release_year INTEGER,
        cover_path TEXT,
        is_favorite INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS launch_configs (
        id TEXT PRIMARY KEY NOT NULL,
        game_id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        executable_path TEXT NOT NULL,
        working_directory TEXT,
        arguments TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS runtimes (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        executable_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS game_contents (
        id TEXT PRIMARY KEY NOT NULL,
        game_id TEXT NOT NULL UNIQUE,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
      )
    `);

    const columns = await db.select<ColumnInfo[]>(
      "PRAGMA table_info(launch_configs)",
    );
    const hasRuntimeId = columns.some((col) => col.name === "runtime_id");
    if (!hasRuntimeId) {
      await db.execute(
        "ALTER TABLE launch_configs ADD COLUMN runtime_id TEXT",
      );
    }
    const hasContentPath = columns.some((col) => col.name === "content_path");
    if (!hasContentPath) {
      await db.execute(
        "ALTER TABLE launch_configs ADD COLUMN content_path TEXT",
      );
    }

    const gameColumns = await db.select<ColumnInfo[]>(
      "PRAGMA table_info(games)",
    );
    const hasRaGameId = gameColumns.some(
      (col) => col.name === "retro_achievements_game_id",
    );
    if (!hasRaGameId) {
      await db.execute(
        "ALTER TABLE games ADD COLUMN retro_achievements_game_id INTEGER",
      );
    }
    // Juegos existentes → published; los nuevos se crean como draft.
    const hasStatus = gameColumns.some((col) => col.name === "status");
    if (!hasStatus) {
      await db.execute(
        "ALTER TABLE games ADD COLUMN status TEXT NOT NULL DEFAULT 'published'",
      );
    }
    const hasCatalogRemoteId = gameColumns.some(
      (col) => col.name === "catalog_remote_id",
    );
    if (!hasCatalogRemoteId) {
      await db.execute(
        "ALTER TABLE games ADD COLUMN catalog_remote_id TEXT",
      );
    }

    const runtimeColumns = await db.select<ColumnInfo[]>(
      "PRAGMA table_info(runtimes)",
    );
    if (!runtimeColumns.some((col) => col.name === "source")) {
      await db.execute("ALTER TABLE runtimes ADD COLUMN source TEXT");
    }
    if (!runtimeColumns.some((col) => col.name === "version")) {
      await db.execute("ALTER TABLE runtimes ADD COLUMN version TEXT");
    }
  },
};
