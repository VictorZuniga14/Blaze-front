import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { launchConfigService } from "./launchConfig.service";
import { gameRepository } from "../repositories/game.repository";
import { runtimeRepository } from "../repositories/runtime.repository";
import { isEdenRuntime, resolveRuntimeKind } from "./ra/adapterKind";
import { resolveRetroArchLaunchArguments } from "../utils/platformRuntime";
import { runtimeConfigService } from "./runtimeConfig.service";
import { controllerPrefsService } from "./controllerPrefs.service";
import { defaultPreferredLanguage } from "../utils/gameLanguages";
import type {
  ActiveProcess,
  LastProcessResult,
  ProcessExitedEvent,
} from "../types/launch";

async function pathCheck(path: string, kind: "file" | "dir"): Promise<boolean> {
  return invoke<boolean>("path_check", { path, kind });
}

export const launchService = {
  async getActiveProcess(): Promise<ActiveProcess> {
    return invoke<ActiveProcess>("get_active_process");
  },

  async launchGame(
    gameId: string,
    options?: { onSoftWarning?: (message: string) => void },
  ): Promise<{ active: ActiveProcess; softWarning: string | null }> {
    const config = await launchConfigService.getByGameId(gameId);
    if (!config) {
      throw new Error("No hay una configuración de ejecución para este juego.");
    }

    let executablePath: string | null = null;
    let argumentsForLaunch = [...config.arguments];
    let workingDirectory = config.workingDirectory;
    let softWarning: string | null = null;

    if (config.type === "native") {
      executablePath = config.executablePath;
    } else if (config.type === "runtime") {
      if (!config.runtimeId) {
        throw new Error("El runtime configurado ya no está disponible.");
      }
      const runtime = await runtimeRepository.findById(config.runtimeId);
      if (!runtime) {
        throw new Error("El runtime configurado ya no está disponible.");
      }
      executablePath = runtime.executablePath;
      if (isEdenRuntime(runtime)) {
        const slash = Math.max(
          executablePath.lastIndexOf("\\"),
          executablePath.lastIndexOf("/"),
        );
        if (slash > 0) {
          workingDirectory = executablePath.slice(0, slash);
        }
      }

      const contentPath = config.contentPath?.trim() ?? "";
      if (!contentPath) {
        throw new Error("El archivo de contenido no existe.");
      }
      const contentExists = await pathCheck(contentPath, "file");
      if (!contentExists) {
        throw new Error("El archivo de contenido no existe.");
      }

      const game = await gameRepository.findById(gameId);
      const resolved = await resolveRetroArchLaunchArguments(
        runtime,
        game?.platform,
        config.arguments,
      );
      const resolvedArgs = resolved.arguments;
      // Persistir core si el launch_config venía sin `-L` (p. ej. installs viejos).
      if (
        resolvedArgs.length !== config.arguments.length ||
        resolvedArgs.some((a, i) => a !== config.arguments[i])
      ) {
        await launchConfigService.save({
          gameId,
          type: config.type,
          runtimeId: config.runtimeId,
          contentPath: config.contentPath,
          executablePath: config.executablePath,
          workingDirectory: config.workingDirectory,
          arguments: resolvedArgs,
        });
      }

      let startFullscreen = true;
      const runtimeKind = resolveRuntimeKind(runtime);
      if (runtimeKind) {
        try {
          const video = await runtimeConfigService.readVideo({
            executablePath,
            runtimeKind,
            runtimeSource: runtime.source ?? null,
          });
          startFullscreen = video.fullscreen;
        } catch {
          // Si no hay config de video, mantener fullscreen por defecto.
        }
      }

      // Perfil completo (Emulación + mandos) lo aplica Rust en prepare_runtime_launch.
      try {
        const prefs = await controllerPrefsService.get();
        await invoke("save_controller_prefs_file", {
          prefs: {
            layout: prefs.layout,
            preferredDeviceGuid: prefs.preferredDeviceGuid,
          },
        });
      } catch {
        // best-effort
      }

      const preferredLanguage =
        game?.preferredLanguage?.trim() ||
        defaultPreferredLanguage(game?.availableLanguages);
      const launchPlan = await invoke<{
        arguments: string[];
        error: string | null;
        errorCode: string | null;
      }>("prepare_runtime_launch", {
        runtimeSource: runtime.source,
        runtimeType: runtime.type,
        executablePath,
        contentPath,
        baseArguments: resolvedArgs,
        startFullscreen,
        preferredLanguage,
        availableLanguages: game?.availableLanguages ?? [],
      });
      if (launchPlan.error) {
        throw new Error(launchPlan.error);
      }
      argumentsForLaunch = launchPlan.arguments;
      softWarning = resolved.warning?.message ?? null;
    } else {
      throw new Error("Tipo de configuración de ejecución no soportado.");
    }

    if (!executablePath) {
      throw new Error("No se pudo resolver el ejecutable.");
    }

    // Aviso tipado (Ps1BiosRecommended) antes de spawn — no bloquea.
    if (softWarning) {
      options?.onSoftWarning?.(softWarning);
      // Dejar que Vue pinte el aviso antes de crear el proceso.
      await new Promise((r) => setTimeout(r, 0));
    }

    const active = await invoke<ActiveProcess>("launch_native", {
      gameId: config.gameId,
      executablePath,
      workingDirectory,
      arguments: argumentsForLaunch,
    });
    return { active, softWarning };
  },

  async onProcessExited(
    handler: (payload: ProcessExitedEvent) => void,
  ): Promise<UnlistenFn> {
    return listen<ProcessExitedEvent>("process-exited", (event) => {
      handler(event.payload);
    });
  },

  toLastResult(payload: ProcessExitedEvent): LastProcessResult {
    return {
      pid: payload.pid,
      gameId: payload.gameId,
      exitCode: payload.exitCode,
    };
  },
};
