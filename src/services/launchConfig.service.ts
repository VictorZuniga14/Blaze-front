import { invoke } from "@tauri-apps/api/core";
import { gameRepository } from "../repositories/game.repository";
import { launchConfigRepository } from "../repositories/launchConfig.repository";
import { runtimeRepository } from "../repositories/runtime.repository";
import type { LaunchConfig, LaunchConfigInput, LaunchType } from "../types/launch";

async function pathCheck(path: string, kind: "file" | "dir"): Promise<boolean> {
  return invoke<boolean>("path_check", { path, kind });
}

function normalizeOptionalPath(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

async function validateInput(input: LaunchConfigInput): Promise<{
  gameId: string;
  type: LaunchType;
  executablePath: string | null;
  runtimeId: string | null;
  contentPath: string | null;
  workingDirectory: string | null;
  arguments: string[];
}> {
  const gameId = input.gameId?.trim();
  if (!gameId) {
    throw new Error("Falta el identificador del juego.");
  }

  const game = await gameRepository.findById(gameId);
  if (!game) {
    throw new Error("El juego no existe.");
  }

  const type: LaunchType = input.type === "runtime" ? "runtime" : "native";
  const workingDirectory = normalizeOptionalPath(input.workingDirectory);
  if (workingDirectory) {
    const dirExists = await pathCheck(workingDirectory, "dir");
    if (!dirExists) {
      throw new Error("El directorio de trabajo configurado no existe.");
    }
  }

  const args = (input.arguments ?? []).filter(
    (argument) => argument.trim().length > 0,
  );

  if (type === "native") {
    const executablePath = input.executablePath?.trim() ?? "";
    if (!executablePath) {
      throw new Error("El ejecutable es obligatorio.");
    }
    const exeExists = await pathCheck(executablePath, "file");
    if (!exeExists) {
      throw new Error("El ejecutable configurado no existe.");
    }
    return {
      gameId,
      type,
      executablePath,
      runtimeId: null,
      contentPath: null,
      workingDirectory,
      arguments: args,
    };
  }

  const runtimeId = input.runtimeId?.trim() ?? "";
  if (!runtimeId) {
    throw new Error("Debes seleccionar un runtime.");
  }
  const runtime = await runtimeRepository.findById(runtimeId);
  if (!runtime) {
    throw new Error("El runtime seleccionado no existe.");
  }

  const contentPath = normalizeOptionalPath(input.contentPath);
  if (!contentPath) {
    throw new Error("El archivo de contenido no existe.");
  }
  const contentExists = await pathCheck(contentPath, "file");
  if (!contentExists) {
    throw new Error("El archivo de contenido no existe.");
  }

  return {
    gameId,
    type,
    executablePath: null,
    runtimeId,
    contentPath,
    workingDirectory,
    arguments: args,
  };
}

export const launchConfigService = {
  async getByGameId(gameId: string): Promise<LaunchConfig | null> {
    return launchConfigRepository.findByGameId(gameId);
  },

  async save(input: LaunchConfigInput): Promise<LaunchConfig> {
    const fields = await validateInput(input);
    const existing = await launchConfigRepository.findByGameId(fields.gameId);
    const now = new Date().toISOString();

    if (existing) {
      const updated = await launchConfigRepository.update(fields.gameId, {
        type: fields.type,
        executablePath: fields.executablePath,
        runtimeId: fields.runtimeId,
        contentPath: fields.contentPath,
        workingDirectory: fields.workingDirectory,
        arguments: fields.arguments,
        updatedAt: now,
      });
      if (!updated) {
        throw new Error("No se pudo actualizar la configuración.");
      }
      return updated;
    }

    return launchConfigRepository.create({
      id: crypto.randomUUID(),
      gameId: fields.gameId,
      type: fields.type,
      executablePath: fields.executablePath,
      runtimeId: fields.runtimeId,
      contentPath: fields.contentPath,
      workingDirectory: fields.workingDirectory,
      arguments: fields.arguments,
      createdAt: now,
      updatedAt: now,
    });
  },

  async deleteByGameId(gameId: string): Promise<void> {
    await launchConfigRepository.deleteByGameId(gameId);
  },
};
