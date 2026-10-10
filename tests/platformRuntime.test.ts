import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findRuntimeForPlatform,
  runtimeKindForPlatform,
} from "../src/utils/platformRuntime";
import type { Runtime } from "../src/types/runtime";

function runtime(
  partial: Partial<Runtime> & Pick<Runtime, "id" | "type" | "executablePath">,
): Runtime {
  return {
    name: partial.name ?? partial.type,
    source: partial.source ?? null,
    version: partial.version ?? null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("platformRuntime Eden", () => {
  it("Nintendo Switch → eden", () => {
    assert.equal(runtimeKindForPlatform("Nintendo Switch"), "eden");
    assert.equal(runtimeKindForPlatform("Switch"), "eden");
  });

  it("findRuntimeForPlatform elige Eden managed", () => {
    const runtimes = [
      runtime({
        id: "1",
        type: "retroarch",
        executablePath: "C:\\ra\\retroarch.exe",
        source: "managed",
      }),
      runtime({
        id: "2",
        type: "eden",
        name: "Eden",
        executablePath: "C:\\eden\\eden.exe",
        source: "managed",
      }),
    ];
    const found = findRuntimeForPlatform(runtimes, "Nintendo Switch");
    assert.equal(found?.id, "2");
    assert.equal(found?.type, "eden");
  });
});
