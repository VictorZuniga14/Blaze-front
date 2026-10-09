import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapPool } from "../src/utils/mapPool";

describe("mapPool", () => {
  it("respeta concurrencia y orden", async () => {
    const active = { n: 0, max: 0 };
    const items = [1, 2, 3, 4, 5, 6];
    const out = await mapPool(items, 2, async (item) => {
      active.n += 1;
      active.max = Math.max(active.max, active.n);
      await new Promise((r) => setTimeout(r, 20));
      active.n -= 1;
      return item * 10;
    });
    assert.deepEqual(out, [10, 20, 30, 40, 50, 60]);
    assert.ok(active.max <= 2);
    assert.ok(active.max >= 2);
  });
});
