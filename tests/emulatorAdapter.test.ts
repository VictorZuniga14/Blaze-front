import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PINNED_PCSX2_VERSION,
  PINNED_RETROARCH_VERSION,
  createFakeAdapter,
  createFakeTransport,
  createLaunchOnlyFakeAdapter,
  resolveCapabilities,
  resolveControlAdapter,
} from "../src/services/emulator";
import type { LaunchConfig } from "../src/types/launch";
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

function launchCfg(gameId = "game-1"): LaunchConfig {
  return {
    id: "lc-1",
    gameId,
    type: "runtime",
    executablePath: null,
    runtimeId: "rt-1",
    contentPath: "C:\\roms\\game.iso",
    workingDirectory: null,
    arguments: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("resolveCapabilities", () => {
  it("RetroArch managed 1.22.2: pause/save/load/status", () => {
    const caps = resolveCapabilities({
      type: "retroarch",
      source: "managed",
      version: PINNED_RETROARCH_VERSION,
    });
    assert.deepEqual(caps, {
      pause: true,
      saveState: true,
      loadState: true,
      status: true,
    });
  });

  it("PCSX2 managed 2.8.2: save/load/status, sin pause", () => {
    const caps = resolveCapabilities({
      type: "pcsx2",
      source: "managed",
      version: PINNED_PCSX2_VERSION,
    });
    assert.deepEqual(caps, {
      pause: false,
      saveState: true,
      loadState: true,
      status: true,
    });
  });

  it("runtime manual: sin IPC", () => {
    const caps = resolveCapabilities({
      type: "retroarch",
      source: "manual",
      version: PINNED_RETROARCH_VERSION,
    });
    assert.deepEqual(caps, {
      pause: false,
      saveState: false,
      loadState: false,
      status: false,
    });
  });

  it("versión distinta a la fijada: sin IPC", () => {
    const caps = resolveCapabilities({
      type: "pcsx2",
      source: "managed",
      version: "1.0.0",
    });
    assert.equal(caps.saveState, false);
    assert.equal(caps.status, false);
  });

  it("tipo desconocido / eden: sin IPC", () => {
    const caps = resolveCapabilities({
      type: "eden",
      source: "managed",
      version: "0.2.1",
    });
    assert.deepEqual(caps, {
      pause: false,
      saveState: false,
      loadState: false,
      status: false,
    });
  });
});

describe("resolveControlAdapter", () => {
  it("managed RetroArch → ipcEnabled", () => {
    const r = resolveControlAdapter(
      runtime({
        id: "ra-1",
        type: "retroarch",
        executablePath: "C:\\ra\\retroarch.exe",
        source: "managed",
        version: PINNED_RETROARCH_VERSION,
      }),
    );
    assert.equal(r.kind, "retroarch");
    assert.equal(r.ipcEnabled, true);
    assert.equal(r.capabilities.pause, true);
  });

  it("manual PCSX2 → solo launch/stop", () => {
    const r = resolveControlAdapter(
      runtime({
        id: "p-1",
        type: "pcsx2",
        executablePath: "C:\\pcsx2\\pcsx2-qt.exe",
        source: "manual",
        version: PINNED_PCSX2_VERSION,
      }),
    );
    assert.equal(r.kind, "pcsx2");
    assert.equal(r.ipcEnabled, false);
  });
});

describe("createFakeTransport", () => {
  it("stdio con replies: delivery confirmed", async () => {
    const t = createFakeTransport({ kind: "stdio", replies: true });
    const r = await t.send({ op: "version" });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.delivery, "confirmed");
      assert.equal(r.payload, "1.22.2");
    }
    assert.equal(t.kind, "stdio");
    assert.equal(t.sent.length, 1);
  });

  it("udp sin replies: delivery sent (no confirmado)", async () => {
    const t = createFakeTransport({ kind: "udp", replies: false });
    const r = await t.send({ op: "save_state" });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.delivery, "sent");
  });

  it("close impide nuevos send", async () => {
    const t = createFakeTransport();
    await t.close();
    const r = await t.send({ op: "get_status" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "not_running");
  });
});

describe("createFakeAdapter", () => {
  it("launch/stop y saveState usan transporte", async () => {
    const transport = createFakeTransport({ kind: "stdio" });
    const adapter = createFakeAdapter({ transport });
    const rt = runtime({
      id: "rt-1",
      type: "retroarch",
      executablePath: "C:\\ra\\retroarch.exe",
      source: "managed",
      version: PINNED_RETROARCH_VERSION,
    });

    const h = await adapter.launch(launchCfg(), rt);
    assert.ok(h.pid > 0);

    const save = await adapter.saveState?.(h, 1);
    assert.equal(save?.ok, true);
    assert.ok(transport.sent.some((c) => c.op === "save_state"));

    const st = await adapter.status?.(h);
    assert.equal(st?.ok, true);
    if (st?.ok) assert.equal(st.status, "running");

    const stopped = await adapter.stop(h);
    assert.equal(stopped.ok, true);
    assert.equal(transport.closed, true);
  });

  it("pause setPaused solo togglea si el estado difiere", async () => {
    const transport = createFakeTransport();
    const adapter = createFakeAdapter({ transport });
    const rt = runtime({
      id: "rt-1",
      type: "retroarch",
      executablePath: "C:\\ra\\retroarch.exe",
      source: "managed",
    });
    const h = await adapter.launch(launchCfg(), rt);

    const a = await adapter.pause?.(h, true);
    assert.equal(a?.ok, true);
    assert.equal(
      transport.sent.filter((c) => c.op === "pause_toggle").length,
      1,
    );

    const b = await adapter.pause?.(h, true);
    assert.equal(b?.ok, true);
    assert.equal(
      transport.sent.filter((c) => c.op === "pause_toggle").length,
      1,
      "no re-toggle si ya paused",
    );

    const c = await adapter.pause?.(h, false);
    assert.equal(c?.ok, true);
    assert.equal(
      transport.sent.filter((c) => c.op === "pause_toggle").length,
      2,
    );
  });

  it("launch-only: saveState unsupported", async () => {
    const adapter = createLaunchOnlyFakeAdapter();
    const rt = runtime({
      id: "m-1",
      type: "retroarch",
      executablePath: "C:\\ra\\retroarch.exe",
      source: "manual",
    });
    const h = await adapter.launch(launchCfg(), rt);
    const r = await adapter.saveState?.(h, 1);
    assert.equal(r?.ok, false);
    if (r && !r.ok) assert.equal(r.code, "unsupported");
  });

  it("pause como toggle cuando status=false", async () => {
    const transport = createFakeTransport({ replies: false });
    const adapter = createFakeAdapter({
      transport,
      capabilities: {
        pause: true,
        saveState: true,
        loadState: true,
        status: false,
      },
      pauseAsToggle: true,
    });
    const rt = runtime({
      id: "rt-1",
      type: "retroarch",
      executablePath: "C:\\ra\\retroarch.exe",
      source: "managed",
    });
    const h = await adapter.launch(launchCfg(), rt);
    await adapter.pause?.(h, true);
    await adapter.pause?.(h, false);
    assert.equal(
      transport.sent.filter((c) => c.op === "pause_toggle").length,
      2,
    );
  });
});
