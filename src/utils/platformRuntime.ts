import { invoke } from "@tauri-apps/api/core";
import type { Runtime } from "../types/runtime";
import {
  platformToRaConsoleKey,
  type RaConsoleKey,
  type RaRuntimeKind,
} from "./raConsoles";
import {
  isPcsx2Runtime,
  isRetroArchRuntime,
  resolveRaAdapterKind,
} from "../services/ra/adapterKind";
import {
  hasRetroArchCoreFlag,
  missingRetroArchCoreMessage,
  retroArchCoreArgs,
  retroArchCorePathCandidates,
} from "./retroArchCores";

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
  return "No se pudo determinar el emulador para esta plataforma.";
}

export function describeRuntimeChoice(runtime: Runtime): string {
  const kind = resolveRaAdapterKind(runtime);
  if (kind === "pcsx2") return "PCSX2";
  if (kind === "retroarch") return "RetroArch";
  return runtime.name;
}

/**
 * Args de core RetroArch (`-L …`) según plataforma.
 * Si `existingArgs` ya traen `-L`, se respetan.
 * PCSX2 / sin mapping → `[]`.
 */
export async function resolveRetroArchLaunchArguments(
  runtime: Runtime,
  platform: string | null | undefined,
  existingArgs: readonly string[] = [],
): Promise<string[]> {
  if (!isRetroArchRuntime(runtime)) return [...existingArgs];
  if (hasRetroArchCoreFlag(existingArgs)) return [...existingArgs];

  const candidates = retroArchCorePathCandidates(
    runtime.executablePath,
    platform,
  );
  if (candidates.length === 0) return [...existingArgs];

  for (const corePath of candidates) {
    if (await pathExists(corePath)) {
      return [...retroArchCoreArgs(corePath), ...existingArgs];
    }
  }

  throw new Error(missingRetroArchCoreMessage(platform));
}
