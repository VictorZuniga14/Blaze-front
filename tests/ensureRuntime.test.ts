import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  __resetEnsureRuntimeFlightsForTests,
  ensureRuntime,
} from "../src/services/ensureRuntime.service";
import type { InstalledRuntimeInfo, Runtime } from "../src/types/runtime";

function runtime(partial: Partial<Runtime> & Pick<Runtime, "id" | "type" | "executablePath">): Runtime {
  return {
    name: partial.name ?? partial.type,
    source: partial.source ?? null,
    version: partial.version ?? null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("ensureRuntime", () => {
  beforeEach(() => {
    __resetEnsureRuntimeFlightsForTests();
  });

  it("reusa runtime existente con exe válido (no instala)", async () => {
    let installs = 0;
    const existing = runtime({
      id: "local-1",
      type: "pcsx2",
      name: "PCSX2",
      executablePath: "C:\\emu\\pcsx2-qt.exe",
      source: "manual",
    });

    const result = await ensureRuntime("PlayStation 2", {
      pathExists: async () => true,
      listRuntimes: async () => [existing],
      manifestVersion: async () => "2.8.2",
      installRuntime: async () => {
        installs += 1;
        throw new Error("no debería instalar");
      },
      upsertManaged: async () => {
        throw new Error("no debería upsert");
      },
    });

    assert.equal(result.id, "local-1");
    assert.equal(installs, 0);
  });

  it("single-flight: dos llamadas concurrentes instalan una sola vez", async () => {
    let installs = 0;
    let resolveInstall!: (v: InstalledRuntimeInfo) => void;
    const installGate = new Promise<InstalledRuntimeInfo>((resolve) => {
      resolveInstall = resolve;
    });

    const deps = {
      pathExists: async () => false,
      listRuntimes: async () => [] as Runtime[],
      manifestVersion: async () => "2.8.2",
      installRuntime: async (id: string) => {
        installs += 1;
        assert.equal(id, "pcsx2");
        return installGate;
      },
      upsertManaged: async (input: {
        type: string;
        name: string;
        executablePath: string;
        version: string;
      }) =>
        runtime({
          id: "managed-1",
          type: input.type,
          name: input.name,
          executablePath: input.executablePath,
          source: "managed",
          version: input.version,
        }),
    };

    const p1 = ensureRuntime("PlayStation 2", deps);
    const p2 = ensureRuntime("PlayStation 2", deps);

    resolveInstall({
      id: "pcsx2",
      version: "2.8.2",
      executablePath: "C:\\AppData\\Blaze\\runtimes\\pcsx2\\2.8.2\\pcsx2-qt.exe",
      rootPath: "C:\\AppData\\Blaze\\runtimes\\pcsx2\\2.8.2",
    });

    const [a, b] = await Promise.all([p1, p2]);
    assert.equal(installs, 1);
    assert.equal(a.id, b.id);
    assert.equal(a.source, "managed");
    assert.equal(a.version, "2.8.2");
  });

  it("si el exe managed falta, reinstala", async () => {
    let installs = 0;
    const broken = runtime({
      id: "managed-old",
      type: "retroarch",
      name: "RetroArch",
      executablePath: "C:\\missing\\retroarch.exe",
      source: "managed",
      version: "1.21.0",
    });

    const result = await ensureRuntime("SNES", {
      pathExists: async (p) => p.includes("1.22.2"),
      listRuntimes: async () => [broken],
      manifestVersion: async () => "1.22.2",
      installRuntime: async () => {
        installs += 1;
        return {
          id: "retroarch",
          version: "1.22.2",
          executablePath:
            "C:\\AppData\\Blaze\\runtimes\\retroarch\\1.22.2\\retroarch.exe",
          rootPath: "C:\\AppData\\Blaze\\runtimes\\retroarch\\1.22.2",
        };
      },
      upsertManaged: async (input) =>
        runtime({
          id: "managed-old",
          type: input.type,
          name: input.name,
          executablePath: input.executablePath,
          source: "managed",
          version: input.version,
        }),
    });

    assert.equal(installs, 1);
    assert.equal(result.version, "1.22.2");
    assert.ok(result.executablePath.includes("1.22.2"));
  });

  it("si managed está desactualizado vs manifiesto, actualiza por red", async () => {
    let installs = 0;
    const stale = runtime({
      id: "managed-ra",
      type: "retroarch",
      name: "RetroArch",
      executablePath: "C:\\AppData\\runtimes\\retroarch\\1.21.0\\retroarch.exe",
      source: "managed",
      version: "1.21.0",
    });

    const result = await ensureRuntime("NES", {
      pathExists: async () => true,
      listRuntimes: async () => [stale],
      manifestVersion: async () => "1.22.2",
      installRuntime: async () => {
        installs += 1;
        return {
          id: "retroarch",
          version: "1.22.2",
          executablePath:
            "C:\\AppData\\runtimes\\retroarch\\1.22.2\\retroarch.exe",
          rootPath: "C:\\AppData\\runtimes\\retroarch\\1.22.2",
        };
      },
      upsertManaged: async (input) =>
        runtime({
          id: "managed-ra",
          type: input.type,
          name: input.name,
          executablePath: input.executablePath,
          source: "managed",
          version: input.version,
        }),
    });

    assert.equal(installs, 1);
    assert.equal(result.version, "1.22.2");
  });

  it("managed al día con el manifiesto: no reinstala", async () => {
    let installs = 0;
    const current = runtime({
      id: "managed-pcsx2",
      type: "pcsx2",
      name: "PCSX2",
      executablePath: "C:\\AppData\\runtimes\\pcsx2\\2.8.2\\pcsx2-qt.exe",
      source: "managed",
      version: "2.8.2",
    });

    const result = await ensureRuntime("PlayStation 2", {
      pathExists: async () => true,
      listRuntimes: async () => [current],
      manifestVersion: async () => "2.8.2",
      installRuntime: async () => {
        installs += 1;
        throw new Error("no debería instalar");
      },
      upsertManaged: async () => {
        throw new Error("no debería upsert");
      },
    });

    assert.equal(result.id, "managed-pcsx2");
    assert.equal(installs, 0);
  });
});
