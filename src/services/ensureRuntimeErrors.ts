export type EnsureRuntimeErrorCode =
  | "network"
  | "hash"
  | "disk"
  | "extract"
  | "cancelled"
  | "antivirus"
  | "core_missing"
  | "cores_outdated"
  | "unknown";

export class EnsureRuntimeError extends Error {
  readonly code: EnsureRuntimeErrorCode;
  readonly retryable: boolean;
  readonly dll?: string;
  readonly missingCores?: string[];

  constructor(
    code: EnsureRuntimeErrorCode,
    message: string,
    retryable = true,
    extra?: { dll?: string; missingCores?: string[] },
  ) {
    super(message);
    this.name = "EnsureRuntimeError";
    this.code = code;
    this.retryable = retryable;
    this.dll = extra?.dll;
    this.missingCores = extra?.missingCores;
  }
}

export class CoreMissingError extends EnsureRuntimeError {
  constructor(dll: string, platformLabel: string) {
    super(
      "core_missing",
      `Falta el core de RetroArch para ${platformLabel} (${dll}). Actualizá Blaze o instalá el core desde RetroArch → Online Updater → Core Downloader.`,
      true,
      { dll },
    );
    this.name = "CoreMissingError";
  }
}

/** Aviso no bloqueante: SwanStation sin BIOS PS1 en system/. */
export class Ps1BiosRecommended {
  readonly code = "ps1_bios_recommended" as const;
  readonly message: string;

  constructor() {
    this.message =
      "Vas a usar SwanStation sin una BIOS PS1 (scph*.bin de 512 KiB) en la carpeta system. Podés importar una de tu consola para mejor compatibilidad; el juego igual se puede lanzar.";
  }
}

/** Mapea el texto de `install_runtime` (Rust) a un error tipado para la UI. */
export function ensureRuntimeErrorFromInvokeMessage(raw: string): EnsureRuntimeError {
  const m = raw.trim();
  const lower = m.toLowerCase();
  if (lower.includes("instalación cancelada") || lower.includes("cancelada")) {
    return new EnsureRuntimeError("cancelled", m, true);
  }
  if (
    lower.includes("sin conexión") ||
    lower.includes("error de red") ||
    lower.includes("network")
  ) {
    return new EnsureRuntimeError("network", m, true);
  }
  if (lower.includes("hash") || lower.includes("no coincide")) {
    return new EnsureRuntimeError("hash", m, false);
  }
  if (lower.includes("espacio insuficiente") || lower.includes("espacio libre")) {
    return new EnsureRuntimeError("disk", m, true);
  }
  if (lower.includes("error al extraer") || lower.includes("extracción")) {
    return new EnsureRuntimeError("extract", m, true);
  }
  if (lower.includes("antivirus") || lower.includes("cuarentena")) {
    return new EnsureRuntimeError("antivirus", m, false);
  }
  if (lower.includes("falta el core")) {
    return new EnsureRuntimeError("core_missing", m, true);
  }
  return new EnsureRuntimeError("unknown", m, true);
}
