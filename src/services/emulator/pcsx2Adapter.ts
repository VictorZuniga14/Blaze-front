/**
 * Adapter real para PCSX2 usando PINE (TCP socket protocol).
 * Spec: https://github.com/PCSX2/pcsx2/blob/master/pcsx2/IPC.h
 */

import type { LaunchConfig } from "../../types/launch";
import type { Runtime } from "../../types/runtime";
import { invoke } from "@tauri-apps/api/core";
import { createRealTransport } from "./realTransport";
import type {
  EmulatorAdapter,
  EmulatorCapabilities,
  EmulatorControlResult,
  EmulatorStatus,
  ProcessHandle,
} from "./types";
import { PCSX2_MANAGED_CAPABILITIES } from "./types";

const PINE_SLOT = 0; // Slot PINE por defecto

export function createPcsx2Adapter(): EmulatorAdapter {
  const capabilities: EmulatorCapabilities = { ...PCSX2_MANAGED_CAPABILITIES };
  const handles = new Map<number, { transport: ReturnType<typeof createRealTransport> }>();

  return {
    kind: "pcsx2",
    capabilities,

    async launch(cfg: LaunchConfig, runtime: Runtime): Promise<ProcessHandle> {
      // Preparar argumentos de lanzamiento con PINE habilitado
      const plan = await invoke<{ arguments: string[]; error?: string; errorCode?: string }>(
        "prepare_runtime_launch",
        {
          runtimeId: runtime.id,
          contentPath: cfg.contentPath,
        }
      );

      if (plan.error) {
        throw new Error(plan.error);
      }

      // Agregar argumentos PINE si no están
      const args = [...plan.arguments];
      if (!args.some(a => a.includes("-pine"))) {
        args.push(`-pine=${PINE_SLOT}`);
      }

      // Lanzar proceso
      const handle = await invoke<ProcessHandle>("launch_native", {
        executablePath: runtime.executablePath,
        args,
        gameId: cfg.gameId,
        runtimeId: runtime.id,
      });

      // Crear transport PINE
      const transport = createRealTransport({
        kind: "tcp",
        slot: PINE_SLOT,
      });

      handles.set(handle.pid, { transport });

      return handle;
    },

    async stop(handle: ProcessHandle): Promise<EmulatorControlResult> {
      const entry = handles.get(handle.pid);
      if (entry) {
        await entry.transport.close();
        handles.delete(handle.pid);
      }

      try {
        // Terminar proceso
        await invoke<void>("process_kill", { pid: handle.pid });
        return { ok: true, delivery: "confirmed" };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          code: "not_running",
          message,
        };
      }
    },

    async saveState(handle: ProcessHandle, slot: number): Promise<EmulatorControlResult> {
      const entry = handles.get(handle.pid);
      if (!entry) {
        return {
          ok: false,
          code: "not_running",
          message: "No hay proceso activo.",
        };
      }

      const result = await entry.transport.send({
        op: "pine_save_state",
        slot,
      });

      return result.ok
        ? { ok: true, delivery: result.delivery }
        : result;
    },

    async loadState(handle: ProcessHandle, slot: number): Promise<EmulatorControlResult> {
      const entry = handles.get(handle.pid);
      if (!entry) {
        return {
          ok: false,
          code: "not_running",
          message: "No hay proceso activo.",
        };
      }

      const result = await entry.transport.send({
        op: "pine_load_state",
        slot,
      });

      return result.ok
        ? { ok: true, delivery: result.delivery }
        : result;
    },

    async status(handle: ProcessHandle) {
      const entry = handles.get(handle.pid);
      if (!entry) {
        return {
          ok: false as const,
          code: "not_running" as const,
          message: "No hay proceso activo.",
        };
      }

      const result = await entry.transport.send({ op: "pine_status" });

      if (!result.ok) {
        return result;
      }

      // Parsear respuesta PINE (simplificado)
      const status: EmulatorStatus = 
        result.payload?.includes("PLAYING") ? "running" : "unknown";

      return {
        ok: true as const,
        status,
        delivery: result.delivery,
      };
    },
  };
}
