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

// Adapter para Eden (Switch emulator v0.2.1)
// Limitación: Sin IPC real, solo gestión de proceso

const EDEN_CAPABILITIES: EmulatorCapabilities = {
  pause: false,     // Eden v0.2.1 no tiene IPC
  saveState: false, // Eden v0.2.1 no tiene IPC
  loadState: false, // Eden v0.2.1 no tiene IPC
  status: true,     // Process check disponible
};

export function createEdenAdapter(): EmulatorAdapter {
  return {
    kind: 'fake', // Eden no tiene control real en v0.2.1
    capabilities: EDEN_CAPABILITIES,

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

      return handle;
    },

    async stop(handle: ProcessHandle): Promise<EmulatorControlResult> {
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

    async status(handle: ProcessHandle) {
      try {
        const isAlive = await invoke<boolean>('process_check_alive', { pid: handle.pid });
        const status: EmulatorStatus = isAlive ? 'running' : 'unknown';

        return {
          ok: true as const,
          status,
          delivery: 'confirmed' as const,
        };
      } catch (error) {
        return {
          ok: false as const,
          code: 'unreachable' as const,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

// Documentación de limitaciones de Eden v0.2.1
export const EDEN_LIMITATIONS = {
  version: '0.2.1',
  ipc: false,

  available: [
    'Process check (running/not running)',
    'Kill process (cerrar juego)',
    'Auto-configuración (keys, firmware, UI)',
  ],

  unavailable: [
    'Pause/resume via IPC',
    'Save/load state via IPC',
    'Hotkey configuration',
    'Controller profile configuration',
    'Audio engine selection',
  ],

  notes: [
    'Eden 0.2.1 no expone una API de control IPC',
    'Solo se puede verificar si el proceso está corriendo',
    'Cerrar el juego requiere matar el proceso',
    'Mejoras futuras dependen de versiones posteriores de Eden',
  ],

  possibleEnhancements: [
    'Gestión de ventana (minimizar, restaurar) via Win32 API',
    'Pause/resume de thread (muy invasivo, no recomendado)',
    'Esperar a que Eden implemente una API de control',
  ],
};
