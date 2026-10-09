import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatLastPlayed,
  formatPlaytime,
  playCardModel,
  shouldRecordPlaySession,
} from "../src/utils/playStats.ts";

describe("formatPlaytime", () => {
  it("formatea segundos como minutos y horas", () => {
    assert.equal(formatPlaytime(0), "0 min");
    assert.equal(formatPlaytime(65), "1 min");
    assert.equal(formatPlaytime(12 * 60), "12 min");
    assert.equal(formatPlaytime(3600), "1 h");
    assert.equal(formatPlaytime(3900), "1 h 05 min");
    assert.equal(formatPlaytime(4 * 3600 + 32 * 60), "4 h 32 min");
    assert.equal(formatPlaytime(27 * 3600 + 10 * 60), "27 h 10 min");
  });

  it("no muestra duración negativa", () => {
    assert.equal(formatPlaytime(-10), "0 min");
  });
});

describe("GameCard y últimos jugados", () => {
  const now = new Date("2026-10-06T21:00:00");

  it("sin sesiones dice nunca jugado y no muestra 0 h", () => {
    assert.deepEqual(playCardModel(null, now), { kind: "never" });
    assert.deepEqual(
      playCardModel(
        { playCount: 0, totalPlaytimeSeconds: 0, lastPlayedAt: "" },
        now,
      ),
      { kind: "never" },
    );
  });

  it("con sesiones muestra playtime y el día", () => {
    const model = playCardModel(
      {
        playCount: 2,
        totalPlaytimeSeconds: 4 * 3600 + 32 * 60,
        lastPlayedAt: "2026-10-06T18:32:00",
      },
      now,
    );
    assert.equal(model.kind, "played");
    if (model.kind === "played") {
      assert.equal(model.playtimeLabel, "4 h 32 min");
      assert.equal(model.lastPlayedLabel, "Hoy");
    }
  });

  it("el detalle puede incluir la hora y ayer queda separado", () => {
    assert.equal(
      formatLastPlayed("2026-10-06T18:32:00", now, true).startsWith("Hoy,"),
      true,
    );
    assert.equal(formatLastPlayed("2026-10-05T18:32:00", now), "Ayer");
  });
});

describe("cuándo se registra una sesión", () => {
  it("solo si el proceso quedó en marcha", () => {
    assert.equal(shouldRecordPlaySession("RUNNING", 120), true);
    assert.equal(shouldRecordPlaySession("RUNNING", null), false);
    assert.equal(shouldRecordPlaySession("ERROR", 120), false);
    assert.equal(shouldRecordPlaySession("IDLE", null), false);
    assert.equal(shouldRecordPlaySession("STARTING", 4), false);
  });
});
