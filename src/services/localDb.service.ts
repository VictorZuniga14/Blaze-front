import { sqliteRepository } from "../repositories/sqlite.repository";

/**
 * Inicialización de la base local.
 * La UI usa este service; no habla con SQLite ni con Tauri directamente.
 */
export const localDbService = {
  async init(): Promise<void> {
    await sqliteRepository.ping();
    await sqliteRepository.ensureSchema();
  },

  /** Conservado por compatibilidad con smoke de Fase 0. */
  async verifyConnection(): Promise<{ ok: true; result: number }> {
    return sqliteRepository.ping();
  },
};
