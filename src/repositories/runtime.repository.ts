import { getDatabase } from "./sqlite.repository";
import type { Runtime, RuntimeSource } from "../types/runtime";

type RuntimeRow = {
  id: string;
  name: string;
  type: string;
  executable_path: string;
  source: string | null;
  version: string | null;
  created_at: string;
  updated_at: string;
};

function mapSource(value: string | null | undefined): RuntimeSource | null {
  if (value === "manual" || value === "managed") return value;
  return null;
}

function mapRow(row: RuntimeRow): Runtime {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    executablePath: row.executable_path,
    source: mapSource(row.source),
    version: row.version ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type RuntimeCreateRecord = {
  id: string;
  name: string;
  type: string;
  executablePath: string;
  source?: RuntimeSource | null;
  version?: string | null;
  createdAt: string;
  updatedAt: string;
};

const SELECT_COLS = `id, name, type, executable_path, source, version, created_at, updated_at`;

export const runtimeRepository = {
  async findAll(): Promise<Runtime[]> {
    const db = await getDatabase();
    const rows = await db.select<RuntimeRow[]>(
      `SELECT ${SELECT_COLS}
       FROM runtimes
       ORDER BY name COLLATE NOCASE ASC`,
    );
    return rows.map(mapRow);
  },

  async findById(id: string): Promise<Runtime | null> {
    const db = await getDatabase();
    const rows = await db.select<RuntimeRow[]>(
      `SELECT ${SELECT_COLS}
       FROM runtimes
       WHERE id = $1
       LIMIT 1`,
      [id],
    );
    const row = rows[0];
    return row ? mapRow(row) : null;
  },

  async findManagedByType(type: string): Promise<Runtime | null> {
    const db = await getDatabase();
    const rows = await db.select<RuntimeRow[]>(
      `SELECT ${SELECT_COLS}
       FROM runtimes
       WHERE type = $1 AND source = 'managed'
       LIMIT 1`,
      [type],
    );
    const row = rows[0];
    return row ? mapRow(row) : null;
  },

  async create(record: RuntimeCreateRecord): Promise<Runtime> {
    const db = await getDatabase();
    await db.execute(
      `INSERT INTO runtimes (id, name, type, executable_path, source, version, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        record.id,
        record.name,
        record.type,
        record.executablePath,
        record.source ?? null,
        record.version ?? null,
        record.createdAt,
        record.updatedAt,
      ],
    );
    return {
      id: record.id,
      name: record.name,
      type: record.type,
      executablePath: record.executablePath,
      source: record.source ?? null,
      version: record.version ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  },

  async update(
    id: string,
    fields: {
      name: string;
      type: string;
      executablePath: string;
      source?: RuntimeSource | null;
      version?: string | null;
      updatedAt: string;
    },
  ): Promise<Runtime | null> {
    const db = await getDatabase();
    await db.execute(
      `UPDATE runtimes SET
         name = $1,
         type = $2,
         executable_path = $3,
         source = $4,
         version = $5,
         updated_at = $6
       WHERE id = $7`,
      [
        fields.name,
        fields.type,
        fields.executablePath,
        fields.source ?? null,
        fields.version ?? null,
        fields.updatedAt,
        id,
      ],
    );
    return this.findById(id);
  },

  /**
   * Upsert managed: una sola fila por type (pcsx2/retroarch).
   */
  async upsertManaged(input: {
    type: string;
    name: string;
    executablePath: string;
    version: string;
  }): Promise<Runtime> {
    const existing = await this.findManagedByType(input.type);
    const now = new Date().toISOString();
    if (existing) {
      const updated = await this.update(existing.id, {
        name: input.name,
        type: input.type,
        executablePath: input.executablePath,
        source: "managed",
        version: input.version,
        updatedAt: now,
      });
      if (!updated) throw new Error("No se pudo actualizar el runtime managed.");
      return updated;
    }
    return this.create({
      id: crypto.randomUUID(),
      name: input.name,
      type: input.type,
      executablePath: input.executablePath,
      source: "managed",
      version: input.version,
      createdAt: now,
      updatedAt: now,
    });
  },

  async delete(id: string): Promise<void> {
    const db = await getDatabase();
    await db.execute(`DELETE FROM runtimes WHERE id = $1`, [id]);
  },
};
