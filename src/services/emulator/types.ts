import type { LaunchConfig } from "../../types/launch";
import type { Runtime, RuntimeSource } from "../../types/runtime";

/** Motores con control IPC previsto (etapa 1–3). Eden/Switch fuera de alcance. */
export type EmulatorControlKind = "pcsx2" | "retroarch";

export type EmulatorCapabilities = {
  pause: boolean;
  saveState: boolean;
  loadState: boolean;
  status: boolean;
};

export type EmulatorStatus = "running" | "paused" | "unknown";

export type ProcessHandle = {
  pid: number;
  gameId: string;
  runtimeId: string | null;
  kind: EmulatorControlKind | "unknown";
};

/** Errores tipados de control (allowlist; la UI no manda strings arbitrarios). */
export type EmulatorControlErrorCode =
  | "unsupported"
  | "not_running"
  | "timeout"
  | "unreachable"
  | "port_in_use";

export type EmulatorControlOk = {
  ok: true;
  /** UDP (y similares) sin ack: comando enviado, no confirmado por el emulador. */
  delivery: "confirmed" | "sent";
};

export type EmulatorControlErr = {
  ok: false;
  code: EmulatorControlErrorCode;
  message: string;
};

export type EmulatorControlResult = EmulatorControlOk | EmulatorControlErr;

/**
 * Contrato común de control de emulador (procesos separados + IPC).
 * `launch`/`stop` siempre; el resto según `capabilities`.
 */
export interface EmulatorAdapter {
  readonly kind: EmulatorControlKind | "fake";
  readonly capabilities: EmulatorCapabilities;

  launch(cfg: LaunchConfig, runtime: Runtime): Promise<ProcessHandle>;
  stop(handle: ProcessHandle): Promise<EmulatorControlResult>;

  /** Preferir setPaused(bool). Si solo hay toggle, el adapter puede ignorar el bool. */
  pause?(
    handle: ProcessHandle,
    paused: boolean,
  ): Promise<EmulatorControlResult>;
  saveState?(
    handle: ProcessHandle,
    slot: number,
  ): Promise<EmulatorControlResult>;
  loadState?(
    handle: ProcessHandle,
    slot: number,
  ): Promise<EmulatorControlResult>;
  status?(handle: ProcessHandle): Promise<
    | { ok: true; status: EmulatorStatus; delivery: "confirmed" | "sent" }
    | EmulatorControlErr
  >;
}

export type ResolveCapabilitiesInput = {
  type: string;
  source?: RuntimeSource | null;
  /** Versión fijada del runtime managed; null/manual → sin IPC. */
  version?: string | null;
};

export const EMPTY_CAPABILITIES: EmulatorCapabilities = {
  pause: false,
  saveState: false,
  loadState: false,
  status: false,
};

export const FULL_RA_CAPABILITIES: EmulatorCapabilities = {
  pause: true,
  saveState: true,
  loadState: true,
  status: true,
};

export const PCSX2_MANAGED_CAPABILITIES: EmulatorCapabilities = {
  pause: false,
  saveState: true,
  loadState: true,
  status: true,
};
