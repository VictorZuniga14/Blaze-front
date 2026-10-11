import type { LaunchConfig } from "../../types/launch";
import type { Runtime } from "../../types/runtime";
import type { EmulatorTransport } from "./transport";
import type {
  EmulatorAdapter,
  EmulatorCapabilities,
  EmulatorControlResult,
  EmulatorStatus,
  ProcessHandle,
} from "./types";
import { EMPTY_CAPABILITIES } from "./types";

export type FakeAdapterOptions = {
  capabilities?: EmulatorCapabilities;
  transport?: EmulatorTransport;
  /** PID base para handles. */
  nextPid?: number;
  /** Si true, pause usa toggle sin consultar status. */
  pauseAsToggle?: boolean;
};

/**
 * Adapter in-memory para tests (etapa 1).
 * No spawnea procesos reales; usa un transporte fake opcional.
 */
export function createFakeAdapter(
  options: FakeAdapterOptions = {},
): EmulatorAdapter & {
  handles: ProcessHandle[];
  lastPaused: boolean | null;
  states: Map<number, EmulatorStatus>;
} {
  const capabilities = options.capabilities ?? {
    pause: true,
    saveState: true,
    loadState: true,
    status: true,
  };
  let nextPid = options.nextPid ?? 1000;
  const handles: ProcessHandle[] = [];
  const states = new Map<number, EmulatorStatus>();
  let lastPaused: boolean | null = null;
  const transport = options.transport;
  const pauseAsToggle = options.pauseAsToggle ?? false;

  function requireCapability(
    key: keyof EmulatorCapabilities,
  ): EmulatorControlResult | null {
    if (!capabilities[key]) {
      return {
        ok: false,
        code: "unsupported",
        message: `Capability ${key} no disponible.`,
      };
    }
    return null;
  }

  const adapter: EmulatorAdapter & {
    handles: ProcessHandle[];
    lastPaused: boolean | null;
    states: Map<number, EmulatorStatus>;
  } = {
    kind: "fake",
    capabilities,
    handles,
    get lastPaused() {
      return lastPaused;
    },
    states,

    async launch(cfg: LaunchConfig, runtime: Runtime): Promise<ProcessHandle> {
      const pid = nextPid++;
      const handle: ProcessHandle = {
        pid,
        gameId: cfg.gameId,
        runtimeId: runtime.id,
        kind: "unknown",
      };
      handles.push(handle);
      states.set(pid, "running");
      return handle;
    },

    async stop(handle: ProcessHandle): Promise<EmulatorControlResult> {
      if (!states.has(handle.pid)) {
        return {
          ok: false,
          code: "not_running",
          message: "No hay proceso activo.",
        };
      }
      states.delete(handle.pid);
      await transport?.close();
      return { ok: true, delivery: "confirmed" };
    },

    async pause(
      handle: ProcessHandle,
      paused: boolean,
    ): Promise<EmulatorControlResult> {
      const denied = requireCapability("pause");
      if (denied) return denied;
      if (!states.has(handle.pid)) {
        return {
          ok: false,
          code: "not_running",
          message: "No hay proceso activo.",
        };
      }

      if (pauseAsToggle || !capabilities.status) {
        const cur = states.get(handle.pid) ?? "unknown";
        const next: EmulatorStatus = cur === "paused" ? "running" : "paused";
        states.set(handle.pid, next);
        lastPaused = next === "paused";
        await transport?.send({ op: "pause_toggle" });
        return { ok: true, delivery: "sent" };
      }

      const cur = states.get(handle.pid) ?? "running";
      const want: EmulatorStatus = paused ? "paused" : "running";
      if (cur !== want) {
        await transport?.send({ op: "pause_toggle" });
        states.set(handle.pid, want);
      }
      lastPaused = paused;
      return { ok: true, delivery: "confirmed" };
    },

    async saveState(
      handle: ProcessHandle,
      _slot: number,
    ): Promise<EmulatorControlResult> {
      const denied = requireCapability("saveState");
      if (denied) return denied;
      if (!states.has(handle.pid)) {
        return {
          ok: false,
          code: "not_running",
          message: "No hay proceso activo.",
        };
      }
      const r = await transport?.send({ op: "save_state" });
      if (r && !r.ok) return r;
      return { ok: true, delivery: r?.ok ? r.delivery : "confirmed" };
    },

    async loadState(
      handle: ProcessHandle,
      _slot: number,
    ): Promise<EmulatorControlResult> {
      const denied = requireCapability("loadState");
      if (denied) return denied;
      if (!states.has(handle.pid)) {
        return {
          ok: false,
          code: "not_running",
          message: "No hay proceso activo.",
        };
      }
      const r = await transport?.send({ op: "load_state" });
      if (r && !r.ok) return r;
      return { ok: true, delivery: r?.ok ? r.delivery : "confirmed" };
    },

    async status(handle: ProcessHandle) {
      if (!capabilities.status) {
        return {
          ok: false as const,
          code: "unsupported" as const,
          message: "Capability status no disponible.",
        };
      }
      if (!states.has(handle.pid)) {
        return {
          ok: false as const,
          code: "not_running" as const,
          message: "No hay proceso activo.",
        };
      }
      await transport?.send({ op: "get_status" });
      return {
        ok: true as const,
        status: states.get(handle.pid) ?? "unknown",
        delivery: "confirmed" as const,
      };
    },
  };

  return adapter;
}

/** Adapter mínimo: solo launch/stop (runtimes manuales). */
export function createLaunchOnlyFakeAdapter() {
  return createFakeAdapter({ capabilities: { ...EMPTY_CAPABILITIES } });
}
