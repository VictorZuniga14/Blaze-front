/**
 * Transport real hacia emuladores usando comandos Tauri.
 * Implementa PINE (PCSX2), UDP (RetroArch) y process check (Eden).
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  AllowlistedCommand,
  EmulatorTransport,
  TransportKind,
  TransportResult,
} from "./transport";

export type RealTransportOptions = {
  kind: TransportKind;
  /** Slot PINE para PCSX2 (default: 0) */
  slot?: number;
};

/**
 * Transport real que usa comandos Tauri para comunicarse con emuladores.
 */
export function createRealTransport(
  options: RealTransportOptions
): EmulatorTransport {
  const { kind, slot } = options;
  let closed = false;

  return {
    kind,

    async send(command: AllowlistedCommand): Promise<TransportResult> {
      if (closed) {
        return {
          ok: false,
          code: "not_running",
          message: "Transport cerrado.",
        };
      }

      try {
        const result = await invoke<TransportResult>(
          "emulator_transport_send",
          {
            kind,
            command,
            slot: kind === "tcp" ? slot ?? 0 : undefined,
          }
        );
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          code: "unreachable",
          message,
        };
      }
    },

    async close(): Promise<void> {
      closed = true;
    },
  };
}

/**
 * Probe para verificar si RetroArch está escuchando comandos UDP.
 */
export async function probeRetroArchTransport(): Promise<boolean> {
  try {
    return await invoke<boolean>("emulator_transport_probe_retroarch");
  } catch {
    return false;
  }
}

/**
 * Verifica si un proceso (Eden) está activo.
 */
export async function checkProcessAlive(pid: number): Promise<boolean> {
  try {
    return await invoke<boolean>("emulator_transport_check_process", { pid });
  } catch {
    return false;
  }
}
