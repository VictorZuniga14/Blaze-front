/**
 * Catálogo único Blaze ↔ RetroAchievements (IDs oficiales rc_consoles.h).
 * No hardcodear consoleIds fuera de este módulo.
 */
export const RA_CONSOLES = {
  nes: 7,
  snes: 3,
  gameboy: 4,
  gbc: 6,
  gba: 5,
  genesis: 1,
  ps1: 12,
  n64: 2,
  /** Oficial RA / rcheevos: 41 (no 13 — ese es Atari Lynx). */
  psp: 41,
  ps2: 21,
  gamecube: 16,
  wii: 19,
  nds: 18,
} as const;

export type RaConsoleKey = keyof typeof RA_CONSOLES;

export const RA_CONSOLE_LABELS: Record<RaConsoleKey, string> = {
  nes: "NES",
  snes: "SNES",
  gameboy: "Game Boy",
  gbc: "Game Boy Color",
  gba: "Game Boy Advance",
  genesis: "Mega Drive",
  ps1: "PlayStation",
  n64: "Nintendo 64",
  psp: "PlayStation Portable",
  ps2: "PlayStation 2",
  gamecube: "GameCube",
  wii: "Wii",
  nds: "Nintendo DS",
};

/** Consolas con hashing rcheevos habilitado en Blaze. */
export const RA_IDENTIFY_CONSOLE_KEYS: readonly RaConsoleKey[] = [
  "nes",
  "snes",
  "gameboy",
  "gbc",
  "gba",
  "genesis",
  "ps1",
  "n64",
  "psp",
  "ps2",
] as const;

/** Extensiones permitidas por consola (validación; la consola NO se deduce de la extensión). */
export const RA_CONSOLE_EXTENSIONS: Record<RaConsoleKey, readonly string[]> = {
  nes: ["nes", "unf", "fds", "nez"],
  snes: ["smc", "sfc", "fig", "swc"],
  gameboy: ["gb"],
  gbc: ["gbc", "gb"],
  gba: ["gba", "agb", "mb"],
  genesis: ["md", "gen", "smd", "bin"],
  ps1: ["cue", "bin", "iso", "img", "mdf", "pbp"],
  n64: ["n64", "z64", "v64"],
  psp: ["iso", "cso", "pbp"],
  ps2: ["iso", "bin", "cue", "img", "mdf", "nrg"],
  gamecube: ["iso", "gcm", "gcz", "rvz", "wia"],
  wii: ["iso", "wbfs", "rvz", "wia", "gcz"],
  nds: ["nds", "dsi"],
};

/**
 * Aliases de Game.platform → key canónica.
 * Más específicos primero (gba/gbc antes que gb; ps2 antes que ps).
 */
const PLATFORM_ALIASES: Array<{ match: RegExp; key: RaConsoleKey }> = [
  { match: /playstation\s*2|\bps2\b/i, key: "ps2" },
  { match: /playstation\s*portable|\bpsp\b/i, key: "psp" },
  { match: /playstation\s*1|\bps1\b|\bpsx\b|^ps$/i, key: "ps1" },
  { match: /play\s*station(?!\s*[2p])/i, key: "ps1" },
  { match: /\bsnes\b|super\s*nintendo|super\s*famicom/i, key: "snes" },
  { match: /\bn64\b|nintendo\s*64/i, key: "n64" },
  { match: /\bgba\b|game\s*boy\s*advance/i, key: "gba" },
  { match: /\bgbc\b|game\s*boy\s*color/i, key: "gbc" },
  { match: /\bgb\b|game\s*boy(?!\s*(advance|color))/i, key: "gameboy" },
  { match: /\bnes\b|nintendo\s*entertainment|\bfamicom\b/i, key: "nes" },
  { match: /mega\s*drive|genesis|\bsega\s*genesis\b/i, key: "genesis" },
  { match: /gamecube|\bgc\b/i, key: "gamecube" },
  { match: /\bwii\b/i, key: "wii" },
  { match: /\bnds\b|nintendo\s*ds/i, key: "nds" },
];

export type RaRuntimeKind = "pcsx2" | "retroarch";

export type ResolveRaConsoleInput = {
  platform?: string | null;
  /** PCSX2 implica PS2; RetroArch exige platform. */
  runtimeKind?: RaRuntimeKind | null;
};

export type ResolvedRaConsole = {
  key: RaConsoleKey;
  consoleId: number;
  label: string;
};

export function isRaConsoleKey(value: string): value is RaConsoleKey {
  return Object.prototype.hasOwnProperty.call(RA_CONSOLES, value);
}

export function consoleIdForKey(key: RaConsoleKey): number {
  return RA_CONSOLES[key];
}

export function supportsRaIdentify(key: RaConsoleKey): boolean {
  return (RA_IDENTIFY_CONSOLE_KEYS as readonly string[]).includes(key);
}

/** Parsea platform libre → key. Sin default silencioso. */
export function platformToRaConsoleKey(
  platform: string | null | undefined,
): RaConsoleKey | null {
  if (!platform?.trim()) return null;
  const raw = platform.trim();
  const asKey = raw.toLowerCase().replace(/\s+/g, "");
  // keys directas + alias cortos
  if (isRaConsoleKey(asKey)) return asKey;
  if (asKey === "gb") return "gameboy";
  if (asKey === "md" || asKey === "megadrive") return "genesis";
  if (asKey === "playstation") return "ps1";

  for (const entry of PLATFORM_ALIASES) {
    if (entry.match.test(raw)) return entry.key;
  }
  return null;
}

/**
 * Fuente de verdad para identify / search.
 * - PCSX2 → siempre ps2
 * - RetroArch / genérico → Game.platform (no extensión de archivo)
 */
export function resolveRaConsole(
  input: ResolveRaConsoleInput,
): ResolvedRaConsole | null {
  if (input.runtimeKind === "pcsx2") {
    return {
      key: "ps2",
      consoleId: RA_CONSOLES.ps2,
      label: RA_CONSOLE_LABELS.ps2,
    };
  }

  const key = platformToRaConsoleKey(input.platform);
  if (!key) return null;
  return {
    key,
    consoleId: RA_CONSOLES[key],
    label: RA_CONSOLE_LABELS[key],
  };
}

/** Default legado para búsqueda cuando no hay platform (no usar en identify). */
export const DEFAULT_RA_CONSOLE_ID = RA_CONSOLES.ps2;

export function resolveRaConsoleId(
  platform: string | null | undefined,
): number {
  return resolveRaConsole({ platform })?.consoleId ?? DEFAULT_RA_CONSOLE_ID;
}

export function resolveRaConsoleLabel(
  platform: string | null | undefined,
): string {
  return resolveRaConsole({ platform })?.label ?? "PlayStation 2";
}

export function extensionAllowedForConsole(
  key: RaConsoleKey,
  filePath: string,
): boolean {
  const ext = filePath.split(/[/\\]/).pop()?.split(".").pop()?.toLowerCase();
  if (!ext) return false;
  return (RA_CONSOLE_EXTENSIONS[key] as readonly string[]).includes(ext);
}
