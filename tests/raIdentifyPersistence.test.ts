import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decidePersistRaGameId } from "../src/services/raIdentify.service";

describe("persistencia raGameId", () => {
  it("guarda cuando no hay mapping", () => {
    assert.equal(
      decidePersistRaGameId({
        existingRaGameId: null,
        identifiedRaGameId: 2782,
        overwriteExisting: false,
      }),
      "save",
    );
  });

  it("no sobrescribe mapping distinto sin confirmación", () => {
    assert.equal(
      decidePersistRaGameId({
        existingRaGameId: 100,
        identifiedRaGameId: 2782,
        overwriteExisting: false,
      }),
      "conflict",
    );
  });

  it("permite reemplazo con confirmación", () => {
    assert.equal(
      decidePersistRaGameId({
        existingRaGameId: 100,
        identifiedRaGameId: 2782,
        overwriteExisting: true,
      }),
      "save",
    );
  });

  it("no reescribe si el ID es el mismo", () => {
    assert.equal(
      decidePersistRaGameId({
        existingRaGameId: 2782,
        identifiedRaGameId: 2782,
        overwriteExisting: false,
      }),
      "skip_same",
    );
  });
});
