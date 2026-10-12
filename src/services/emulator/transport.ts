/**
 * Transporte hacia el emulador. Los adapters no usan sockets crudos:
 * hablan con `EmulatorTransport` (Udp / Tcp / Stdio).
 *
 * En etapas 2–3 la implementación real vive en Rust (comandos Tauri).
 * Etapa 1: contrato + fake in-memory.
 */

export type TransportKind = "udp" | "tcp" | "stdio";

/** Comandos allowlist (no strings arbitrarios desde la UI). */
export type AllowlistedCommand =
  | { op: "version" }
  | { op: "get_status" }
  | { op: "pause_toggle" }
  | { op: "save_state" }
  | { op: "load_state" }
  | { op: "pine_save_state"; slot: number }
  | { op: "pine_load_state"; slot: number }
  | { op: "pine_status" };

export type TransportDelivery = "confirmed" | "sent";

export type TransportOk = {
  ok: true;
  delivery: TransportDelivery;
  /** Payload crudo opcional (p. ej. texto GET_STATUS / VERSION). */
  payload?: string;
};

export type TransportErr = {
  ok: false;
  code:
    | "unsupported"
    | "not_running"
    | "timeout"
    | "unreachable"
    | "port_in_use";
  message: string;
};

export type TransportResult = TransportOk | TransportErr;

export interface EmulatorTransport {
  readonly kind: TransportKind;
  send(command: AllowlistedCommand): Promise<TransportResult>;
  close(): Promise<void>;
}

/** Fake in-memory para tests (etapa 1). */
export type FakeTransportOptions = {
  kind?: TransportKind;
  /** Si true, send responde confirmed con payload; si false, solo "sent". */
  replies?: boolean;
  /** Simula fallo en send. */
  failWith?: TransportErr;
  onSend?: (command: AllowlistedCommand) => void;
};

export function createFakeTransport(
  options: FakeTransportOptions = {},
): EmulatorTransport & { sent: AllowlistedCommand[]; closed: boolean } {
  const sent: AllowlistedCommand[] = [];
  let closed = false;
  const kind = options.kind ?? "stdio";
  const replies = options.replies ?? true;

  return {
    kind,
    get sent() {
      return sent;
    },
    get closed() {
      return closed;
    },
    async send(command) {
      if (closed) {
        return {
          ok: false,
          code: "not_running",
          message: "Transporte cerrado.",
        };
      }
      if (options.failWith) {
        return options.failWith;
      }
      sent.push(command);
      options.onSend?.(command);
      if (!replies) {
        return { ok: true, delivery: "sent" };
      }
      if (command.op === "get_status" || command.op === "pine_status") {
        return {
          ok: true,
          delivery: "confirmed",
          payload: "GET_STATUS PLAYING test,game,crc32=0",
        };
      }
      if (command.op === "version") {
        return { ok: true, delivery: "confirmed", payload: "1.22.2" };
      }
      return { ok: true, delivery: "confirmed" };
    },
    async close() {
      closed = true;
    },
  };
}
