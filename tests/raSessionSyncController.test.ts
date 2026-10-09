import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RA_SYNC_POST_EXIT_MS,
  RA_SYNC_SETTLE_DELAYS_MS,
  RA_SYNC_TICK_MS,
  createRaSessionSyncController,
} from "../src/utils/raSessionSyncController.ts";

type Timer = { id: number; at: number; fn: () => void };

function createClock() {
  let now = 0;
  let nextId = 1;
  const timers: Timer[] = [];

  return {
    now: () => now,
    schedule(fn: () => void, ms: number) {
      const id = nextId++;
      timers.push({ id, at: now + ms, fn });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearSchedule(id: ReturnType<typeof setTimeout>) {
      const n = id as unknown as number;
      const i = timers.findIndex((t) => t.id === n);
      if (i >= 0) timers.splice(i, 1);
    },
    async advance(ms: number) {
      const target = now + ms;
      while (true) {
        const due = timers
          .filter((t) => t.at <= target)
          .sort((a, b) => a.at - b.at || a.id - b.id);
        if (due.length === 0) {
          now = target;
          await Promise.resolve();
          return;
        }
        const next = due[0]!;
        now = next.at;
        const i = timers.findIndex((t) => t.id === next.id);
        if (i >= 0) timers.splice(i, 1);
        next.fn();
        await Promise.resolve();
        await Promise.resolve();
      }
    },
    pendingCount: () => timers.length,
  };
}

describe("raSessionSyncController", () => {
  it("foco sin cambio → settle 8s y 20s → tick 40s", async () => {
    const clock = createClock();
    let unlocked = 0;
    const calls: string[] = [];
    const ctrl = createRaSessionSyncController({
      now: clock.now,
      schedule: clock.schedule,
      clearSchedule: clock.clearSchedule,
      unlockedCount: () => unlocked,
      async refreshSilent() {
        calls.push(`t=${clock.now()}`);
      },
    });

    ctrl.setVisible(true);
    await ctrl.startSession("g1", 99);
    assert.equal(calls.length, 1);
    assert.equal(calls[0], "t=0");

    await clock.advance(RA_SYNC_SETTLE_DELAYS_MS[0]);
    assert.equal(calls.length, 2);

    await clock.advance(RA_SYNC_SETTLE_DELAYS_MS[1]);
    assert.equal(calls.length, 3);

    await clock.advance(RA_SYNC_TICK_MS);
    assert.equal(calls.length, 4);

    ctrl.dispose();
  });

  it("foco con cambio → salta al tick sin settle", async () => {
    const clock = createClock();
    let unlocked = 0;
    const calls: number[] = [];
    const ctrl = createRaSessionSyncController({
      now: clock.now,
      schedule: clock.schedule,
      clearSchedule: clock.clearSchedule,
      unlockedCount: () => unlocked,
      async refreshSilent() {
        calls.push(clock.now());
        unlocked = 1;
      },
    });

    ctrl.setVisible(true);
    await ctrl.startSession("g1", 99);
    assert.equal(calls.length, 1);

    await clock.advance(RA_SYNC_TICK_MS);
    assert.equal(calls.length, 2);
    assert.equal(calls[1], RA_SYNC_TICK_MS);
    assert.ok(!calls.includes(RA_SYNC_SETTLE_DELAYS_MS[0]));

    ctrl.dispose();
  });

  it("active pasa a false → no queda timer vivo", async () => {
    const clock = createClock();
    const ctrl = createRaSessionSyncController({
      now: clock.now,
      schedule: clock.schedule,
      clearSchedule: clock.clearSchedule,
      unlockedCount: () => 0,
      async refreshSilent() {},
    });

    ctrl.setVisible(true);
    await ctrl.startSession("g1", 99);
    assert.ok(clock.pendingCount() >= 1);

    ctrl.setVisible(false);
    assert.equal(clock.pendingCount(), 0);
    assert.equal(ctrl.getState().hasTimer, false);

    ctrl.dispose();
  });

  it("endSession → exit inmediato + settle a los 10s", async () => {
    const clock = createClock();
    const calls: number[] = [];
    const ctrl = createRaSessionSyncController({
      now: clock.now,
      schedule: clock.schedule,
      clearSchedule: clock.clearSchedule,
      unlockedCount: () => 0,
      async refreshSilent() {
        calls.push(clock.now());
      },
    });

    ctrl.setVisible(true);
    await ctrl.startSession("g1", 99);
    const afterStart = calls.length;

    await ctrl.endSession();
    assert.equal(calls.length, afterStart + 1);

    await clock.advance(RA_SYNC_POST_EXIT_MS);
    assert.equal(calls.length, afterStart + 2);
    assert.equal(calls[calls.length - 1], RA_SYNC_POST_EXIT_MS);

    ctrl.dispose();
  });

  it("dos eventos de foco seguidos → un solo request", async () => {
    const clock = createClock();
    let release: (() => void) | null = null;
    let calls = 0;
    const ctrl = createRaSessionSyncController({
      now: clock.now,
      schedule: clock.schedule,
      clearSchedule: clock.clearSchedule,
      unlockedCount: () => 0,
      async refreshSilent() {
        calls++;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    });

    ctrl.setVisible(true);
    const started = ctrl.startSession("g1", 99);
    await Promise.resolve();
    assert.equal(calls, 1);

    ctrl.onFocus();
    await Promise.resolve();
    assert.equal(calls, 1);

    release?.();
    await started;
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(calls, 1);

    ctrl.dispose();
  });
});
