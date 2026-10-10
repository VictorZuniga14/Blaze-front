import type { Runtime } from "../../types/runtime";
import type { RaAdapterKind } from "./types";
import type { RaRuntimeKind } from "../../utils/raConsoles";

function normalizeType(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function pathLooksLike(runtime: Runtime, needles: string[]): boolean {
  const name = runtime.name.toLowerCase();
  const path = runtime.executablePath.toLowerCase();
  const file = path.split(/[/\\]/).pop() ?? path;
  return needles.some(
    (n) => name.includes(n) || path.includes(n) || file.includes(n),
  );
}

/**
 * Kind de runtime Blaze (incluye Eden). RA solo usa pcsx2|retroarch.
 */
export function resolveRuntimeKind(
  runtime: Runtime | null | undefined,
): RaRuntimeKind | null {
  if (!runtime) return null;

  const typed = normalizeType(runtime.type);
  if (typed === "pcsx2" || typed === "playstation2") return "pcsx2";
  if (typed === "retroarch" || typed === "ra") return "retroarch";
  if (typed === "eden" || typed === "switch" || typed === "nintendoswitch") {
    return "eden";
  }

  if (pathLooksLike(runtime, ["pcsx2"])) return "pcsx2";
  if (pathLooksLike(runtime, ["retroarch"])) return "retroarch";
  if (pathLooksLike(runtime, ["eden"])) return "eden";
  return null;
}

/**
 * Resuelve el kind del adapter desde el Runtime.
 * Preferencia: `runtime.type` estable → heurística de ejecutable.
 * Puro (sin Tauri) para tests unitarios.
 */
export function resolveRaAdapterKind(
  runtime: Runtime | null | undefined,
): RaAdapterKind | null {
  const kind = resolveRuntimeKind(runtime);
  if (kind === "pcsx2" || kind === "retroarch") return kind;
  return null;
}

export function isRaCapableRuntime(runtime: Runtime): boolean {
  return resolveRaAdapterKind(runtime) != null;
}

export function isPcsx2Runtime(runtime: Runtime): boolean {
  return resolveRuntimeKind(runtime) === "pcsx2";
}

export function isRetroArchRuntime(runtime: Runtime): boolean {
  return resolveRuntimeKind(runtime) === "retroarch";
}

export function isEdenRuntime(runtime: Runtime): boolean {
  return resolveRuntimeKind(runtime) === "eden";
}

/** Qué kinds soportan identify (PCSX2 siempre; RetroArch si hay Game.platform). */
export function adapterSupportsContentIdentification(
  kind: RaAdapterKind | null,
): boolean {
  return kind === "pcsx2" || kind === "retroarch";
}
