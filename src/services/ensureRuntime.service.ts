import { invoke } from "@tauri-apps/api/core";
import { runtimeRepository } from "../repositories/runtime.repository";
import {
  findRuntimeForPlatform,
  runtimeKindForPlatform,
} from "../utils/platformRuntime";
import type {
  InstalledRuntimeInfo,
  Runtime,
  RuntimeManifestInfo,
} from "../types/runtime";

export type EnsureRuntimeProgress = {
  operationId: string;
  phase: string;
  bytesDone: number;
  bytesTotal: number;
  message: string;
};

type InstallDeps = {
  pathExists: (path: string) => Promise<boolean>;
  listRuntimes: () => Promise<Runtime[]>;
  installRuntime: (
    id: string,
    operationId: string,
  ) => Promise<InstalledRuntimeInfo>;
  upsertManaged: (input: {
    type: string;
    name: string;
    executablePath: string;
    version: string;
  }) => Promise<Runtime>;
  /** Versión pinneada en el manifiesto embebido (p. ej. "2.8.2"). */
  manifestVersion: (id: string) => Promise<string | null>;
};

const inFlight = new Map<string, Promise<Runtime>>();

async function defaultPathExists(path: string): Promise<boolean> {
  return invoke<boolean>("path_check", { path, kind: "file" });
}

async function defaultInstall(
  id: string,
  operationId: string,
): Promise<InstalledRuntimeInfo> {
  return invoke<InstalledRuntimeInfo>("install_runtime", {
    id,
    operationId,
  });
}

async function defaultManifestVersion(id: string): Promise<string | null> {
  const list = await invoke<RuntimeManifestInfo[]>("runtime_manifest_list");
  return list.find((e) => e.id === id)?.version ?? null;
}

function displayName(kind: "pcsx2" | "retroarch"): string {
  return kind === "pcsx2" ? "PCSX2" : "RetroArch";
}

function needsManagedUpdate(
  found: Runtime,
  targetVersion: string | null,
): boolean {
  if (found.source !== "managed") return false;
  if (!targetVersion) return false;
  return (found.version ?? "") !== targetVersion;
}

/**
 * Asegura un runtime usable para la plataforma.
 * - Reutiliza exe existente (manual o managed al día).
 * - Si el managed está desactualizado vs el manifiesto, descarga la versión nueva
 *   a AppData/runtimes/ (sin volver a copiar el bundle del instalador).
 * - Single-flight por runtime id.
 */
export async function ensureRuntime(
  platform: string | null | undefined,
  deps?: Partial<InstallDeps>,
): Promise<Runtime> {
  const kind = runtimeKindForPlatform(platform);
  if (!kind) {
    throw new Error("No se pudo determinar el emulador para esta plataforma.");
  }

  const existingFlight = inFlight.get(kind);
  if (existingFlight) return existingFlight;

  const d: InstallDeps = {
    pathExists: deps?.pathExists ?? defaultPathExists,
    listRuntimes: deps?.listRuntimes ?? (() => runtimeRepository.findAll()),
    installRuntime: deps?.installRuntime ?? defaultInstall,
    upsertManaged:
      deps?.upsertManaged ??
      ((input) => runtimeRepository.upsertManaged(input)),
    manifestVersion: deps?.manifestVersion ?? defaultManifestVersion,
  };

  const promise = (async () => {
    const runtimes = await d.listRuntimes();
    const found = findRuntimeForPlatform(runtimes, platform);
    const targetVersion = await d.manifestVersion(kind);

    if (
      found &&
      (await d.pathExists(found.executablePath)) &&
      !needsManagedUpdate(found, targetVersion)
    ) {
      return found;
    }

    // Fila managed sin exe, o versión vieja → instalar desde red (o bundle si aplica).
    const operationId = crypto.randomUUID();
    const installed = await d.installRuntime(kind, operationId);
    return d.upsertManaged({
      type: kind,
      name: displayName(kind),
      executablePath: installed.executablePath,
      version: installed.version,
    });
  })();

  inFlight.set(kind, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(kind);
  }
}

/**
 * Instala/registra PCSX2 y RetroArch (desde el bundle del instalador o por red).
 * Idempotente: si ya están listos y al día con el manifiesto, no copia ni descarga.
 */
export async function ensureDefaultRuntimes(
  deps?: Partial<InstallDeps>,
): Promise<void> {
  // Una plataforma por runtime cubre pcsx2 + retroarch.
  const platforms = ["PlayStation 2", "NES"] as const;
  const errors: string[] = [];
  for (const platform of platforms) {
    try {
      await ensureRuntime(platform, deps);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${platform}: ${msg}`);
    }
  }
  if (errors.length === platforms.length) {
    throw new Error(errors.join(" | "));
  }
}

/** Solo tests: limpia el map de single-flight. */
export function __resetEnsureRuntimeFlightsForTests(): void {
  inFlight.clear();
}
