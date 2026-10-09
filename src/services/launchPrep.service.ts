import { invoke } from "@tauri-apps/api/core";
import { useAuthStore } from "../stores/auth";
import { launchConfigService } from "./launchConfig.service";
import { raEmulatorService } from "./raEmulator.service";
import { gameService } from "./game.service";
import { resolveRaAdapter } from "./ra";
import { runtimeRepository } from "../repositories/runtime.repository";
import type { LaunchCheckItem } from "../types/retroAchievements";
import {
  raInspectFailureCheck,
  raLaunchCheck,
  raNativeLaunchCheck,
} from "../utils/raLibraryProgress";

async function pathCheck(path: string, kind: "file" | "dir"): Promise<boolean> {
  return invoke<boolean>("path_check", { path, kind });
}

export type PrepResult =
  | { ok: true; checks: LaunchCheckItem[] }
  | { ok: false; checks: LaunchCheckItem[]; error: string };

/**
 * Checklist real previo al lanzamiento.
 * RetroAchievements es opcional: warn, nunca bloquea.
 */
export async function runLaunchPreparation(
  gameId: string,
  onUpdate: (checks: LaunchCheckItem[]) => void,
): Promise<PrepResult> {
  const checks: LaunchCheckItem[] = [
    { id: "CHECKING_USER", label: "Usuario Blaze", state: "pending" },
    { id: "CHECKING_RUNTIME", label: "Runtime", state: "pending" },
    { id: "CHECKING_CONTENT", label: "Contenido", state: "pending" },
    { id: "CHECKING_EMULATOR", label: "Emulador", state: "pending" },
    {
      id: "CHECKING_RETROACHIEVEMENTS",
      label: "RetroAchievements",
      state: "pending",
    },
    {
      id: "IDENTIFY_CONTENT",
      label: "Identificar RA",
      state: "pending",
    },
    { id: "LAUNCHING", label: "Iniciando", state: "pending" },
  ];

  const bump = () => onUpdate(checks.map((c) => ({ ...c })));

  const set = (
    id: LaunchCheckItem["id"],
    state: LaunchCheckItem["state"],
    detail?: string,
  ) => {
    const item = checks.find((c) => c.id === id);
    if (!item) return;
    item.state = state;
    item.detail = detail;
    bump();
  };

  set("CHECKING_USER", "running");
  const auth = useAuthStore();
  if (!auth.isAuthenticated || !auth.user) {
    set("CHECKING_USER", "error", "No hay sesión de Blaze.");
    return { ok: false, checks, error: "Debes iniciar sesión en Blaze." };
  }
  set("CHECKING_USER", "ok", auth.user.username);

  const config = await launchConfigService.getByGameId(gameId);
  if (!config) {
    set("CHECKING_RUNTIME", "error", "Sin LaunchConfig");
    return {
      ok: false,
      checks,
      error: "No hay una configuración de ejecución para este juego.",
    };
  }

  let executablePath: string | null = null;

  set("CHECKING_RUNTIME", "running");

  if (config.type === "native") {
    executablePath = config.executablePath;
    if (!executablePath) {
      set("CHECKING_RUNTIME", "error", "Sin ejecutable");
      return { ok: false, checks, error: "No se pudo resolver el ejecutable." };
    }
    const exists = await pathCheck(executablePath, "file");
    if (!exists) {
      set("CHECKING_RUNTIME", "error", "Ejecutable no encontrado");
      return {
        ok: false,
        checks,
        error: "El ejecutable configurado ya no existe.",
      };
    }
    set("CHECKING_RUNTIME", "ok", "Nativo");
    set("CHECKING_CONTENT", "ok", "No aplica (nativo)");
    set("CHECKING_EMULATOR", "ok", "Nativo");
    const nativeRa = raNativeLaunchCheck();
    set("CHECKING_RETROACHIEVEMENTS", nativeRa.state, nativeRa.detail);
    set("IDENTIFY_CONTENT", "ok", "No aplica (nativo)");
    set("LAUNCHING", "running");
    return { ok: true, checks };
  }

  if (config.type !== "runtime" || !config.runtimeId) {
    set("CHECKING_RUNTIME", "error", "Runtime inválido");
    return {
      ok: false,
      checks,
      error: "El runtime configurado ya no está disponible.",
    };
  }

  const runtime = await runtimeRepository.findById(config.runtimeId);
  if (!runtime) {
    set("CHECKING_RUNTIME", "error", "Runtime no encontrado");
    return {
      ok: false,
      checks,
      error: "El runtime configurado ya no está disponible.",
    };
  }

  executablePath = runtime.executablePath;
  const runtimeExists = await pathCheck(executablePath, "file");
  if (!runtimeExists) {
    set("CHECKING_RUNTIME", "error", "Ejecutable no encontrado");
    return {
      ok: false,
      checks,
      error: "El ejecutable del runtime ya no existe.",
    };
  }
  set("CHECKING_RUNTIME", "ok", runtime.name);

  set("CHECKING_CONTENT", "running");
  const contentPath = config.contentPath?.trim() ?? "";
  if (!contentPath) {
    set("CHECKING_CONTENT", "error", "Sin contenido");
    return { ok: false, checks, error: "El archivo de contenido no existe." };
  }
  const contentExists = await pathCheck(contentPath, "file");
  if (!contentExists) {
    set("CHECKING_CONTENT", "error", "Archivo no encontrado");
    return { ok: false, checks, error: "El archivo de contenido no existe." };
  }
  set("CHECKING_CONTENT", "ok", contentPath.split(/[/\\]/).pop() ?? contentPath);

  set("CHECKING_EMULATOR", "running");
  set("CHECKING_EMULATOR", "ok", runtime.name);

  set("CHECKING_RETROACHIEVEMENTS", "running");
  try {
    const ra = await raEmulatorService.inspectViaAdapter(runtime);
    const check = raLaunchCheck({
      status: ra.status,
      username: ra.username,
      emulatorKind: ra.emulatorKind,
      runtimeName: runtime.name,
    });
    set("CHECKING_RETROACHIEVEMENTS", check.state, check.detail);
  } catch {
    const failed = raInspectFailureCheck();
    set("CHECKING_RETROACHIEVEMENTS", failed.state, failed.detail);
  }

  // Identificación: opcional. No hashea en el loader (puede ser lento); nunca bloquea.
  set("IDENTIFY_CONTENT", "running");
  try {
    const game = await gameService.getGame(gameId);
    if (game?.retroAchievementsGameId) {
      set(
        "IDENTIFY_CONTENT",
        "ok",
        `Mapping #${game.retroAchievementsGameId}`,
      );
    } else {
      const adapter = resolveRaAdapter(runtime);
      if (adapter?.supportsContentIdentification()) {
        set(
          "IDENTIFY_CONTENT",
          "warn",
          "Sin mapping — Identificar contenido en el detalle (PCSX2/RetroArch)",
        );
      } else {
        set(
          "IDENTIFY_CONTENT",
          "warn",
          "Sin auto-ID — mapping manual disponible",
        );
      }
    }
  } catch {
    set("IDENTIFY_CONTENT", "warn", "Identificación omitida — se continúa");
  }

  set("LAUNCHING", "running");
  return { ok: true, checks };
}
