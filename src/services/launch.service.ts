import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { launchConfigService } from "./launchConfig.service";
import { gameRepository } from "../repositories/game.repository";
import { runtimeRepository } from "../repositories/runtime.repository";
import { resolveRetroArchLaunchArguments } from "../utils/platformRuntime";
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

  async launchGame(gameId: string): Promise<ActiveProcess> {
    const config = await launchConfigService.getByGameId(gameId);
    if (!config) {
      throw new Error("No hay una configuración de ejecución para este juego.");
    }

    let executablePath: string | null = null;
    let argumentsForLaunch = [...config.arguments];

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

      const contentPath = config.contentPath?.trim() ?? "";
      if (!contentPath) {
        throw new Error("El archivo de contenido no existe.");
      }
      const contentExists = await pathCheck(contentPath, "file");
      if (!contentExists) {
        throw new Error("El archivo de contenido no existe.");
      }

      const game = await gameRepository.findById(gameId);
      const resolvedArgs = await resolveRetroArchLaunchArguments(
        runtime,
        game?.platform,
        config.arguments,
      );
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
        startFullscreen: true,
      });
      if (launchPlan.error) {
        throw new Error(launchPlan.error);
      }
      argumentsForLaunch = launchPlan.arguments;
    } else {
      throw new Error("Tipo de configuración de ejecución no soportado.");
    }

    if (!executablePath) {
      throw new Error("No se pudo resolver el ejecutable.");
    }

    return invoke<ActiveProcess>("launch_native", {
      gameId: config.gameId,
      executablePath,
      workingDirectory: config.workingDirectory,
      arguments: argumentsForLaunch,
    });
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
