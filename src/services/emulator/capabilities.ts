import {
  EMPTY_CAPABILITIES,
  FULL_RA_CAPABILITIES,
  PCSX2_MANAGED_CAPABILITIES,
  type EmulatorCapabilities,
  type EmulatorControlKind,
  type ResolveCapabilitiesInput,
} from "./types";

/** Versiones fijadas en `runtimes.manifest.json` (control IPC documentado). */
export const PINNED_RETROARCH_VERSION = "1.22.2";
export const PINNED_PCSX2_VERSION = "2.8.2";

function normalizeType(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function controlKindFromType(
  type: string | null | undefined,
): EmulatorControlKind | null {
  const t = normalizeType(type);
  if (t === "pcsx2" || t === "playstation2") return "pcsx2";
  if (t === "retroarch" || t === "ra") return "retroarch";
  return null;
}

/**
 * Capabilities por tipo + source + versión fijada.
 * Manual / desconocido / versión distinta: solo launch/stop (todo false).
 *
 * RetroArch: status=true en contrato teórico (stdio responde).
 * Tras `ra_stdin_probe`, si no hay respuestas, el adapter managed bajará status.
 */
export function resolveCapabilities(
  input: ResolveCapabilitiesInput,
): EmulatorCapabilities {
  const kind = controlKindFromType(input.type);
  if (!kind) return { ...EMPTY_CAPABILITIES };

  const source = (input.source ?? "manual").toLowerCase();
  if (source !== "managed") {
    return { ...EMPTY_CAPABILITIES };
  }

  const version = (input.version ?? "").trim();

  if (kind === "retroarch") {
    if (version !== PINNED_RETROARCH_VERSION) {
      return { ...EMPTY_CAPABILITIES };
    }
    return { ...FULL_RA_CAPABILITIES };
  }

  if (kind === "pcsx2") {
    if (version !== PINNED_PCSX2_VERSION) {
      return { ...EMPTY_CAPABILITIES };
    }
    return { ...PCSX2_MANAGED_CAPABILITIES };
  }

  return { ...EMPTY_CAPABILITIES };
}

/** Mensaje UI cuando el control IPC se degradó (puerto / unreachable / etc.). */
export function degradedControlMessage(
  code: "port_in_use" | "unreachable" | "timeout" | "unsupported",
): string {
  switch (code) {
    case "port_in_use":
      return "El puerto de control está ocupado. El juego sigue, pero sin controles desde Blaze.";
    case "unreachable":
      return "No se pudo conectar al control del emulador. El juego sigue sin controles desde Blaze.";
    case "timeout":
      return "El emulador no respondió a tiempo. El juego sigue sin controles desde Blaze.";
    case "unsupported":
      return "Este runtime no admite control desde Blaze (solo lanzar/cerrar).";
  }
}
