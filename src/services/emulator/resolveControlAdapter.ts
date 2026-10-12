import type { Runtime } from "../../types/runtime";
import { resolveCapabilities, controlKindFromType } from "./capabilities";
import type { EmulatorCapabilities, EmulatorControlKind } from "./types";

export type ControlAdapterResolution = {
  kind: EmulatorControlKind | null;
  capabilities: EmulatorCapabilities;
  /** true si source=managed y versión fijada con IPC. */
  ipcEnabled: boolean;
};

/**
 * Elige kind + capabilities a partir del Runtime (sin spawnear).
 * Los adapters reales (RA stdin / PCSX2 PINE) se enganchan en etapas 2–3.
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

  return { kind, capabilities, ipcEnabled };
}
