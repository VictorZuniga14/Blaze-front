import type { EmulatorRaStatus } from "../../types/retroAchievements";
import type { Runtime } from "../../types/runtime";
import type { RaConsoleKey } from "../../utils/raConsoles";

/** Identificador estable del adapter RA (no el nombre visible del runtime). */
export type RaAdapterKind = "pcsx2" | "retroarch";

/** Key canónica del catálogo RA (ver `raConsoles.ts`). */
export type RaContentPlatform = RaConsoleKey;

/** Estado/configuración del emulador (login RA local). Distinto de identification. */
export type RetroAchievementsState = EmulatorRaStatus;

/** Resultado local de hashing (antes del lookup en backend). */
export type RetroAchievementsIdentification = {
  emulator: RaAdapterKind;
  platform: RaContentPlatform;
  consoleId: number;
  hash: string;
  contentPath: string;
};

export type IdentifyContentOptions = {
  /** Game.platform — obligatorio para RetroArch. */
  platform?: string | null;
};

/**
 * Contrato mínimo de adapter.
 * - detectState: config RA del emulador (read-only)
 * - identifyContent: hash oficial del contenido (offline)
 */
export interface RetroAchievementsAdapter {
  readonly kind: RaAdapterKind;
  detectState(runtime: Runtime): Promise<RetroAchievementsState>;
  identifyContent(
    contentPath: string,
    options?: IdentifyContentOptions,
  ): Promise<RetroAchievementsIdentification>;
  supportsContentIdentification(): boolean;
}
