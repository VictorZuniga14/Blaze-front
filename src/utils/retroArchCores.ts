import {
  platformToRaConsoleKey,
  RA_CONSOLE_LABELS,
  type RaConsoleKey,
} from "./raConsoles";

/**
 * Propuesta (sin implementar): si RetroArch managed ya está instalado pero falta
 * un core nuevo del manifiesto, extraer solo ese `.dll` desde `RetroArch_cores.7z`
 * verificado (misma ruta que `install_cores_into_extract`) sin reinstalar todo el runtime.
 *
 * Cores preferidos por consola (nombre de archivo en `cores/`).
 * El primero existente gana; el resto son fallbacks.
 * PS2 no usa RetroArch en Blaze (PCSX2).
 *
 * El manifiesto managed (`runtimes.manifest.json` → `cores`) instala el
 * primer candidato de cada plataforma (deduplicado).
 */
export const RETROARCH_CORE_CANDIDATES: Record<
  RaConsoleKey,
  readonly string[]
> = {
  nes: ["fceumm_libretro.dll"],
  snes: ["snes9x_libretro.dll"],
  gameboy: ["gambatte_libretro.dll", "mgba_libretro.dll"],
  gbc: ["gambatte_libretro.dll", "mgba_libretro.dll"],
  gba: ["mgba_libretro.dll"],
  genesis: ["genesis_plus_gx_libretro.dll"],
  ps1: [
    "swanstation_libretro.dll",
    "pcsx_rearmed_libretro.dll",
    "mednafen_psx_hw_libretro.dll",
    "mednafen_psx_libretro.dll",
  ],
  n64: ["mupen64plus_next_libretro.dll"],
  psp: ["ppsspp_libretro.dll"],
  ps2: [],
  gamecube: ["dolphin_libretro.dll"],
  wii: ["dolphin_libretro.dll"],
  nds: ["melonds_libretro.dll", "desmume_libretro.dll"],
  /** Switch usa Eden managed, no RetroArch. */
  switch: [],
};

/** DLL que Blaze instala desde RetroArch_cores.7z (primer candidato por plataforma). */
export function defaultManagedRetroArchCoreDlls(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dlls of Object.values(RETROARCH_CORE_CANDIDATES)) {
    const primary = dlls[0];
    if (!primary || seen.has(primary)) continue;
    seen.add(primary);
    out.push(primary);
  }
  return out;
}

/** Directorio padre de un archivo (Windows/POSIX). */
export function parentDir(filePath: string): string {
  const trimmed = filePath.replace(/[/\\]+$/, "");
  const slash = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  if (slash < 0) return trimmed;
  return trimmed.slice(0, slash);
}

/** Une segmentos con el separador del path base. */
export function joinLocalPath(base: string, child: string): string {
  const sep = base.includes("\\") ? "\\" : "/";
  const left = base.replace(/[/\\]+$/, "");
  const right = child.replace(/^[/\\]+/, "");
  return `${left}${sep}${right}`;
}

export function retroArchCoreCandidatesForPlatform(
  platform: string | null | undefined,
): { key: RaConsoleKey; dlls: readonly string[] } | null {
  const key = platformToRaConsoleKey(platform);
  if (!key) return null;
  const dlls = RETROARCH_CORE_CANDIDATES[key];
  if (!dlls.length) return null;
  return { key, dlls };
}

/**
 * Rutas absolutas candidatas a core para un RetroArch + plataforma.
 * Layout: `<dir del exe>/cores/<dll>` — igual para managed
 * (`runtimes/retroarch/<ver>/cores/`) y manual típico.
 * No comprueba existencia en disco.
 */
export type RetroArchCorePickOptions = {
  /** PS1: true → SwanStation; false → pcsx_rearmed (HLE). */
  ps1HasExternalBios?: boolean;
};

export function retroArchCoreDllOrder(
  platform: string | null | undefined,
  options?: RetroArchCorePickOptions,
): readonly string[] {
  const resolved = retroArchCoreCandidatesForPlatform(platform);
  if (!resolved) return [];
  if (resolved.key === "ps1" && options?.ps1HasExternalBios === false) {
    const hle = "pcsx_rearmed_libretro.dll";
    const rest = resolved.dlls.filter((d) => d !== hle);
    return [hle, ...rest];
  }
  return resolved.dlls;
}

export function retroArchCorePathCandidates(
  retroArchExe: string,
  platform: string | null | undefined,
  options?: RetroArchCorePickOptions,
): string[] {
  const dlls = retroArchCoreDllOrder(platform, options);
  if (dlls.length === 0) return [];
  const coresDir = joinLocalPath(parentDir(retroArchExe), "cores");
  return dlls.map((dll) => joinLocalPath(coresDir, dll));
}

export function hasRetroArchCoreFlag(args: readonly string[]): boolean {
  return args.some((a) => a === "-L" || a === "--libretro");
}

/** Args `["-L", corePath]` listos para RetroArch. */
export function retroArchCoreArgs(corePath: string): string[] {
  return ["-L", corePath];
}

export function missingRetroArchCoreMessage(
  platform: string | null | undefined,
  preferredDll?: string,
): string {
  const resolved = retroArchCoreCandidatesForPlatform(platform);
  if (!resolved) {
    return "No se pudo determinar el core de RetroArch para esta plataforma.";
  }
  const label = RA_CONSOLE_LABELS[resolved.key];
  const primary = preferredDll ?? resolved.dlls[0];
  return `Falta el core de RetroArch para ${label} (${primary}). Instalálo desde RetroArch → Online Updater → Core Downloader y volvé a intentar.`;
}

/**
 * Elige el primer DLL de `order` cuya ruta exista.
 * Si ninguno existe → null (caller debe lanzar CoreMissing).
 */
export async function pickFirstExistingCore(
  candidates: readonly string[],
  pathExists: (path: string) => Promise<boolean>,
): Promise<string | null> {
  for (const corePath of candidates) {
    if (await pathExists(corePath)) return corePath;
  }
  return null;
}
