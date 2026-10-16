import type { Runtime } from "../../types/runtime";
import { resolveCapabilities, controlKindFromType } from "./capabilities";
import type { EmulatorCapabilities, EmulatorControlKind, EmulatorAdapter } from "./types";
import { createPcsx2Adapter } from "./pcsx2Adapter";
import { createRetroarchAdapter } from "./retroarchAdapter";
import { createEdenAdapter } from "./edenAdapter";
import { createFakeAdapter } from "./fakeAdapter";

export type ControlAdapterResolution = {
  kind: EmulatorControlKind | null;
  capabilities: EmulatorCapabilities;
  /** true si source=managed y versión fijada con IPC. */
  ipcEnabled: boolean;
  /** Adapter real o fake según configuración. */
  adapter: EmulatorAdapter | null;
};

/**
 * Elige kind + capabilities + adapter a partir del Runtime.
 * 
 * Si source=managed e IPC habilitado:
 * - PCSX2: Adapter real con PINE
 * - RetroArch: Adapter real con UDP
 * - Eden: Adapter real con process management
 * 
 * Si source=manual o sin IPC:
 * - Fake adapter (para tests)
 */
export function resolveControlAdapter(
  runtime: Runtime | null | undefined,
): ControlAdapterResolution {
  if (!runtime) {
    return {
      kind: null,
      capabilities: {
        pause: false,
        saveState: false,
        loadState: false,
        status: false,
      },
      ipcEnabled: false,
      adapter: null,
    };
  }

  const kind = controlKindFromType(runtime.type);
  const capabilities = resolveCapabilities({
    type: runtime.type,
    source: runtime.source,
    version: runtime.version,
  });
  const ipcEnabled =
    capabilities.pause ||
    capabilities.saveState ||
    capabilities.loadState ||
    capabilities.status;

  // Decidir adapter
  let adapter: EmulatorAdapter | null = null;

  if (runtime.source === 'managed' && ipcEnabled) {
    // Usar adapters reales
    switch (runtime.type) {
      case 'pcsx2':
        adapter = createPcsx2Adapter();
        break;
      case 'retroarch_snes':
      case 'retroarch_ps1':
        adapter = createRetroarchAdapter();
        break;
      case 'eden':
        adapter = createEdenAdapter();
        break;
      default:
        console.warn(`Tipo de runtime no soportado para adapter real: ${runtime.type}`);
        adapter = createFakeAdapter();
    }
  } else {
    // Usar fake adapter (manual o sin IPC)
    adapter = createFakeAdapter();
  }

  return { kind, capabilities, ipcEnabled, adapter };
}
