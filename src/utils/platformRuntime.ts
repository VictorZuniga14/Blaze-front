import { invoke } from "@tauri-apps/api/core";
import type { Runtime } from "../types/runtime";
import {
  platformToRaConsoleKey,
  type RaConsoleKey,
  type RaRuntimeKind,
} from "./raConsoles";
import {
  isEdenRuntime,
  isPcsx2Runtime,
  isRetroArchRuntime,
  resolveRaAdapterKind,
  resolveRuntimeKind,
} from "../services/ra/adapterKind";
import {
  hasRetroArchCoreFlag,
  pickFirstExistingCore,
  retroArchCoreArgs,
  retroArchCoreDllOrder,
  retroArchCorePathCandidates,
} from "./retroArchCores";
import {
  CoreMissingError,
  Ps1BiosRecommended,
} from "../services/ensureRuntimeErrors";
import { RA_CONSOLE_LABELS } from "./raConsoles";

export type ResolveRetroArchLaunchResult = {
  arguments: string[];
  warning: Ps1BiosRecommended | null;
};

async function pathExists(path: string): Promise<boolean> {
  return invoke<boolean>("path_check", { path, kind: "file" });
}

/** Plataforma del catálogo → runtime que Blaze elige solo. */
export function runtimeKindForPlatform(
  platform: string | null | undefined,
): RaRuntimeKind | null {
  const key = platformToRaConsoleKey(platform);
  if (!key) return null;
  if (key === "ps2") return "pcsx2";
  if (key === "switch") return "eden";
  return "retroarch";
}

export function consoleKeyForPlatform(
  platform: string | null | undefined,
): RaConsoleKey | null {
  return platformToRaConsoleKey(platform);
}

export function findRuntimeForPlatform(
  runtimes: Runtime[],
  platform: string | null | undefined,
): Runtime | null {
  const kind = runtimeKindForPlatform(platform);
  if (!kind) return null;

  const matches = runtimes.filter((r) => {
    if (kind === "pcsx2") return isPcsx2Runtime(r);
    if (kind === "eden") return isEdenRuntime(r);
    return isRetroArchRuntime(r);
  });
  // Preferir managed (cores en <exe>/cores/) si hay varios.
  return (
    matches.find((r) => r.source === "managed") ?? matches[0] ?? null
  );
}

export function runtimeMissingMessage(
  platform: string | null | undefined,
): string {
  const kind = runtimeKindForPlatform(platform);
  if (kind === "pcsx2") {
    return "Blaze necesita PCSX2. Agregalo en Runtimes (una sola vez) y volvé a descargar.";
  }
  if (kind === "retroarch") {
    return "Blaze necesita RetroArch. Agregalo en Runtimes (una sola vez) y volvé a descargar.";
  }
  if (kind === "eden") {
    return "Blaze necesita Eden (Switch). Se instala solo la primera vez o agregalo en Runtimes.";
  }
  return "No se pudo determinar el emulador para esta plataforma.";
}

export function describeRuntimeChoice(runtime: Runtime): string {
  const kind = resolveRuntimeKind(runtime);
  if (kind === "pcsx2") return "PCSX2";
  if (kind === "retroarch") return "RetroArch";
  if (kind === "eden") return "Eden";
  const ra = resolveRaAdapterKind(runtime);
  if (ra === "pcsx2") return "PCSX2";
  if (ra === "retroarch") return "RetroArch";
  return runtime.name;
}

/**
 * Args de core RetroArch (`-L …`) según plataforma.
 * Si `existingArgs` ya traen `-L`, se respetan.
 * PCSX2 / sin mapping → `{ arguments: existing, warning: null }`.
 * Si el core elegido es SwanStation sin BIOS PS1 → `Ps1BiosRecommended` (no bloquea).
 */
export async function resolveRetroArchLaunchArguments(
  runtime: Runtime,
  platform: string | null | undefined,
  existingArgs: readonly string[] = [],
): Promise<ResolveRetroArchLaunchResult> {
  if (!isRetroArchRuntime(runtime)) {
    return { arguments: [...existingArgs], warning: null };
  }
  if (hasRetroArchCoreFlag(existingArgs)) {
    return { arguments: [...existingArgs], warning: null };
  }

  let hasPs1Bios = false;
  let coreOptions: { ps1HasExternalBios?: boolean } | undefined;
  const consoleKey = platformToRaConsoleKey(platform);
  if (consoleKey === "ps1") {
    hasPs1Bios = await invoke<boolean>("retroarch_ps1_bios_present");
    coreOptions = { ps1HasExternalBios: hasPs1Bios };
  }

  const dllOrder = retroArchCoreDllOrder(platform, coreOptions);
  const candidates = retroArchCorePathCandidates(
    runtime.executablePath,
    platform,
    coreOptions,
  );
  if (candidates.length === 0) {
    return { arguments: [...existingArgs], warning: null };
  }

  const chosen = await pickFirstExistingCore(candidates, pathExists);
  if (chosen) {
    const dll = chosen.split(/[/\\]/).pop()?.toLowerCase() ?? "";
    const warning =
      consoleKey === "ps1" &&
      !hasPs1Bios &&
      dll === "swanstation_libretro.dll"
        ? new Ps1BiosRecommended()
        : null;
    return {
      arguments: [...retroArchCoreArgs(chosen), ...existingArgs],
      warning,
    };
  }

  const preferred = dllOrder[0] ?? "core";
  const label =
    (consoleKey && RA_CONSOLE_LABELS[consoleKey]) ||
    platform ||
    "esta plataforma";
  throw new CoreMissingError(preferred, String(label));
}
