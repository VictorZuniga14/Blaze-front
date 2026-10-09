import { invoke } from "@tauri-apps/api/core";
import { launchConfigRepository } from "../repositories/launchConfig.repository";
import { runtimeRepository } from "../repositories/runtime.repository";
import type { Runtime, RuntimeInput } from "../types/runtime";

async function pathCheck(path: string, kind: "file" | "dir"): Promise<boolean> {
  return invoke<boolean>("path_check", { path, kind });
}

async function validateInput(input: RuntimeInput): Promise<{
  name: string;
  type: string;
  executablePath: string;
}> {
  const name = input.name?.trim() ?? "";
  if (!name) {
    throw new Error("El nombre del runtime es obligatorio.");
  }
  if (name.length > 200) {
    throw new Error("El nombre no puede superar 200 caracteres.");
  }

  const type = (input.type?.trim() || "generic").slice(0, 100);
  const executablePath = input.executablePath?.trim() ?? "";
  if (!executablePath) {
    throw new Error("El ejecutable del runtime es obligatorio.");
  }

  const exists = await pathCheck(executablePath, "file");
  if (!exists) {
    throw new Error("El ejecutable del runtime no existe.");
  }

  return { name, type, executablePath };
}

export const runtimeService = {
  async list(): Promise<Runtime[]> {
    return runtimeRepository.findAll();
  },

  async getById(id: string): Promise<Runtime | null> {
    return runtimeRepository.findById(id);
  },

  async create(input: RuntimeInput): Promise<Runtime> {
    const fields = await validateInput(input);
    const now = new Date().toISOString();
    return runtimeRepository.create({
      id: crypto.randomUUID(),
      name: fields.name,
      type: fields.type,
      executablePath: fields.executablePath,
      source: input.source ?? "manual",
      version: input.version ?? null,
      createdAt: now,
      updatedAt: now,
    });
  },

  async update(id: string, input: RuntimeInput): Promise<Runtime> {
    const existing = await runtimeRepository.findById(id);
    if (!existing) {
      throw new Error("El runtime no existe.");
    }
    const fields = await validateInput(input);
    const updated = await runtimeRepository.update(id, {
      name: fields.name,
      type: fields.type,
      executablePath: fields.executablePath,
      source: input.source ?? existing.source ?? "manual",
      version: input.version ?? existing.version ?? null,
      updatedAt: new Date().toISOString(),
    });
    if (!updated) {
      throw new Error("No se pudo actualizar el runtime.");
    }
    return updated;
  },

  async delete(id: string): Promise<void> {
    const existing = await runtimeRepository.findById(id);
    if (!existing) {
      throw new Error("El runtime no existe.");
    }
    const used = await launchConfigRepository.countByRuntimeId(id);
    if (used > 0) {
      throw new Error(
        "No puedes eliminar este runtime porque está asociado a uno o más juegos.",
      );
    }
    await runtimeRepository.delete(id);
  },
};
