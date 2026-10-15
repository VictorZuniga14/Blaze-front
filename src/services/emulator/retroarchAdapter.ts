import type {
  EmulatorAdapter,
  EmulatorCapabilities,
  EmulatorStatus,
  ProcessHandle,
  EmulatorControlResult,
} from './types';
import type { LaunchConfig } from '../../types/launch';
import type { Runtime } from '../../types/runtime';
import { invoke } from '@tauri-apps/api/core';
import { createRealTransport } from './realTransport';
import { FULL_RA_CAPABILITIES } from './types';

// Adapter real para RetroArch usando UDP Network Commands

export function createRetroarchAdapter(): EmulatorAdapter {
  const capabilities: EmulatorCapabilities = { ...FULL_RA_CAPABILITIES };
  const handles = new Map<number, { transport: ReturnType<typeof createRealTransport> }>();

  return {
    kind: 'retroarch',
    capabilities,

    async launch(cfg: LaunchConfig, runtime: Runtime): Promise<ProcessHandle> {
      // Preparar argumentos de lanzamiento
      const plan = await invoke<{ arguments: string[]; error?: string; errorCode?: string }>(
        'prepare_runtime_launch',
        {
          runtimeId: runtime.id,
          contentPath: cfg.contentPath,
        }
      );

      if (plan.error) {
        throw new Error(plan.error);
      }

      // Lanzar proceso
      const handle = await invoke<ProcessHandle>('launch_native', {
        executablePath: runtime.executablePath,
        args: plan.arguments,
        gameId: cfg.gameId,
        runtimeId: runtime.id,
      });

      // Crear transport UDP
      const transport = createRealTransport({ kind: 'udp' });
      handles.set(handle.pid, { transport });

      return handle;
    },

    async stop(handle: ProcessHandle): Promise<EmulatorControlResult> {
      const entry = handles.get(handle.pid);
      if (entry) {
        // Enviar comando QUIT via UDP
        await entry.transport.send({ op: 'quit' } as any);
        await entry.transport.close();
        handles.delete(handle.pid);
      }

      try {
        await invoke<void>('process_kill', { pid: handle.pid });
        return { ok: true, delivery: 'confirmed' };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          code: 'not_running',
          message,
        };
      }
    },

    async pause(handle: ProcessHandle, _paused: boolean): Promise<EmulatorControlResult> {
      const entry = handles.get(handle.pid);
      if (!entry) {
        return {
          ok: false,
          code: 'not_running',
          message: 'No hay proceso activo.',
        };
      }

      const result = await entry.transport.send({ op: 'pause_toggle' });
      return result.ok ? { ok: true, delivery: result.delivery } : result;
    },

    async saveState(handle: ProcessHandle, _slot: number): Promise<EmulatorControlResult> {
      const entry = handles.get(handle.pid);
      if (!entry) {
        return {
          ok: false,
          code: 'not_running',
          message: 'No hay proceso activo.',
        };
      }

      // TODO: Implementar selección de slot en RetroArch
      const result = await entry.transport.send({ op: 'save_state' });
      return result.ok ? { ok: true, delivery: result.delivery } : result;
    },

    async loadState(handle: ProcessHandle, _slot: number): Promise<EmulatorControlResult> {
      const entry = handles.get(handle.pid);
      if (!entry) {
        return {
          ok: false,
          code: 'not_running',
          message: 'No hay proceso activo.',
        };
      }

      // TODO: Implementar selección de slot en RetroArch
      const result = await entry.transport.send({ op: 'load_state' });
      return result.ok ? { ok: true, delivery: result.delivery } : result;
    },

    async status(handle: ProcessHandle) {
      const entry = handles.get(handle.pid);
      if (!entry) {
        return {
          ok: false as const,
          code: 'not_running' as const,
          message: 'No hay proceso activo.',
        };
      }

      const result = await entry.transport.send({ op: 'get_status' });

      if (!result.ok) {
        return result;
      }

      // UDP es fire-and-forget, status es tentativo
      const status: EmulatorStatus = result.delivery === 'sent' ? 'running' : 'unknown';

      return {
        ok: true as const,
        status,
        delivery: result.delivery,
      };
    },
  };
}
