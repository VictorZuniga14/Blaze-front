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
import { listenRuntimeInstallProgress } from "./runtimeInstallProgress.service";
import {
  EnsureRuntimeError,
  ensureRuntimeErrorFromInvokeMessage,
} from "./ensureRuntimeErrors";

export type EnsureRuntimeProgress = {
  operationId: string;
  phase: string;
  bytesDone: number;
  bytesTotal: number;
  message: string;
  /** Presente cuando phase === "cores_outdated". */
  missingCores?: string[];
};

export type RuntimeCoresStatus = {
  id: string;
  version: string;
  status: "ok" | "cores_outdated" | string;
  missingCores: string[];
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
  manifestVersion: (id: string) => Promise<string | null>;
};

const inFlight = new Map<string, Promise<Runtime>>();

/** Tras instalar, reintentos si el exe desaparece (p. ej. antivirus). */
const MAX_POST_INSTALL_EXE_ATTEMPTS = 3;

async function defaultPathExists(path: string): Promise<boolean> {
  return invoke<boolean>("path_check", { path, kind: "file" });
}

async function defaultInstall(
  id: string,
  operationId: string,
): Promise<InstalledRuntimeInfo> {
  try {
    return await invoke<InstalledRuntimeInfo>("install_runtime", {
      id,
      operationId,
    });
  } catch (err) {
    const msg =
      typeof err === "string"
        ? err
        : err instanceof Error
          ? err.message
          : String(err);
    throw ensureRuntimeErrorFromInvokeMessage(msg);
  }
}

async function defaultManifestVersion(id: string): Promise<string | null> {
  const list = await invoke<RuntimeManifestInfo[]>("runtime_manifest_list");
  return list.find((e) => e.id === id)?.version ?? null;
}

function displayName(kind: "pcsx2" | "retroarch" | "eden"): string {
  if (kind === "pcsx2") return "PCSX2";
  if (kind === "eden") return "Eden";
  return "RetroArch";
}

function needsManagedUpdate(
  found: Runtime,
  targetVersion: string | null,
): boolean {
  if (found.source !== "managed") return false;
  if (!targetVersion) return false;
  return (found.version ?? "") !== targetVersion;
}

export type EnsureRuntimeOptions = {
  deps?: Partial<InstallDeps>;
  onProgress?: (p: EnsureRuntimeProgress) => void;
};

function normalizeEnsureOptions(
  options?: EnsureRuntimeOptions | Partial<InstallDeps>,
): EnsureRuntimeOptions {
  if (!options) return {};
  if ("onProgress" in options || "deps" in options) {
    return options as EnsureRuntimeOptions;
  }
  return { deps: options as Partial<InstallDeps> };
}

async function installManagedRuntime(
  kind: "pcsx2" | "retroarch" | "eden",
  d: InstallDeps,
  onProgress?: (p: EnsureRuntimeProgress) => void,
): Promise<Runtime> {
  let lastErr: EnsureRuntimeError | null = null;

  for (let attempt = 0; attempt < MAX_POST_INSTALL_EXE_ATTEMPTS; attempt++) {
    const operationId = crypto.randomUUID();
    let unlisten: () => void = () => {};
    try {
      unlisten = await listenRuntimeInstallProgress(operationId, (p) => {
        onProgress?.({
          operationId: p.operationId,
          phase: p.phase,
          bytesDone: p.bytesDone,
          bytesTotal: p.bytesTotal,
          message: p.message,
        });
      });
    } catch {
      /* fuera de Tauri (tests node) */
    }

    try {
      const installed = await d.installRuntime(kind, operationId);
      if (await d.pathExists(installed.executablePath)) {
        return d.upsertManaged({
          type: kind,
          name: displayName(kind),
          executablePath: installed.executablePath,
          version: installed.version,
        });
      }
      lastErr = new EnsureRuntimeError(
        "antivirus",
        "El emulador se instaló pero el ejecutable no está en disco. Windows Defender u otro antivirus pudo ponerlo en cuarentena. Revisá la protección en tiempo real e intentá de nuevo.",
        attempt + 1 < MAX_POST_INSTALL_EXE_ATTEMPTS,
      );
    } catch (err) {
      if (err instanceof EnsureRuntimeError) {
        lastErr = err;
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        lastErr = ensureRuntimeErrorFromInvokeMessage(msg);
      }
      if (!lastErr.retryable) break;
    } finally {
      unlisten();
    }
  }

  throw (
    lastErr ??
    new EnsureRuntimeError(
      "unknown",
      "No se pudo instalar el emulador. Intentá de nuevo.",
      true,
    )
  );
}

/**
 * Asegura un runtime usable para la plataforma.
 * - Reutiliza exe existente (manual o managed al día).
 * - Si el managed está desactualizado vs el manifiesto, descarga la versión nueva
 *   a AppData/runtimes/ (sin volver a copiar el bundle del instalador).
 * - Single-flight por runtime id (TS; Rust también serializa `install_runtime`).
 */
export async function ensureRuntime(
  platform: string | null | undefined,
  options?: EnsureRuntimeOptions | Partial<InstallDeps>,
): Promise<Runtime> {
  const kind = runtimeKindForPlatform(platform);
  if (!kind) {
    throw new Error("No se pudo determinar el emulador para esta plataforma.");
  }

  const existingFlight = inFlight.get(kind);
  if (existingFlight) return existingFlight;

  const normalized = normalizeEnsureOptions(options);

  const d: InstallDeps = {
    pathExists: normalized.deps?.pathExists ?? defaultPathExists,
    listRuntimes: normalized.deps?.listRuntimes ?? (() => runtimeRepository.findAll()),
    installRuntime: normalized.deps?.installRuntime ?? defaultInstall,
    upsertManaged:
      normalized.deps?.upsertManaged ??
      ((input) => runtimeRepository.upsertManaged(input)),
    manifestVersion: normalized.deps?.manifestVersion ?? defaultManifestVersion,
  };

  const onProgress = normalized.onProgress;

  const promise = (async () => {
    const runtimes = await d.listRuntimes();
    const found = findRuntimeForPlatform(runtimes, platform);
    const targetVersion = await d.manifestVersion(kind);

    if (
      found &&
      (await d.pathExists(found.executablePath)) &&
      !needsManagedUpdate(found, targetVersion)
    ) {
      if (kind === "retroarch") {
        try {
          const coresStatus = await invoke<RuntimeCoresStatus>(
            "runtime_cores_status",
            { id: "retroarch" },
          );
          if (
            coresStatus.status === "cores_outdated" &&
            coresStatus.missingCores.length > 0
          ) {
            // Solo detección: no reparamos aquí. La UI puede mostrar el aviso.
            // Propuesta (sin implementar): re-descargar RetroArch_cores.7z (hash del
            // manifiesto) y extraer selectivamente solo missingCores a cores/, luego
            // actualizar .installed.json.cores — sin reinstalar el runtime entero.
            onProgress?.({
              operationId: "",
              phase: "cores_outdated",
              bytesDone: 0,
              bytesTotal: 0,
              message: `Faltan cores de RetroArch: ${coresStatus.missingCores.join(", ")}.`,
              missingCores: coresStatus.missingCores,
            });
          }
        } catch {
          /* sin Tauri / marker viejo: no bloquear */
        }
      }
      return found;
    }

    onProgress?.({
      operationId: "",
      phase: "starting",
      bytesDone: 0,
      bytesTotal: 0,
      message:
        kind === "pcsx2"
          ? "Preparando PCSX2… (necesitás una BIOS de tu propia consola; se importa una sola vez)"
          : "Preparando emulador…",
    });

    return installManagedRuntime(kind, d, onProgress);
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
  options?: EnsureRuntimeOptions,
): Promise<void> {
  const platforms = ["PlayStation 2", "NES", "Nintendo Switch"] as const;
  const errors: string[] = [];
  for (const platform of platforms) {
    try {
      await ensureRuntime(platform, options);
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
