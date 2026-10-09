import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickTitleFallbackCandidate } from "../src/services/raIdentify.service";
import type { RaGameCandidate } from "../src/types/retroAchievements";

function cand(
  partial: Pick<RaGameCandidate, "raGameId" | "title">,
): RaGameCandidate {
  return {
    raGameId: partial.raGameId,
    title: partial.title,
    consoleId: 3,
    consoleName: "SNES",
    numAchievements: 10,
    imageIcon: null,
  };
}

describe("pickTitleFallbackCandidate", () => {
  it("auto con un solo resultado", () => {
    const pick = pickTitleFallbackCandidate(
      [cand({ raGameId: 337, title: "Donkey Kong Country" })],
      "Donkey Kong Country",
    );
    assert.equal(pick?.raGameId, 337);
  });

  it("exacto único entre varios", () => {
    const pick = pickTitleFallbackCandidate(
      [
        cand({ raGameId: 1, title: "Donkey Kong Country 2" }),
        cand({ raGameId: 337, title: "Donkey Kong Country" }),
        cand({ raGameId: 3, title: "Donkey Kong Land" }),
      ],
      "Donkey Kong Country",
    );
    assert.equal(pick?.raGameId, 337);
  });

  it("ambigüedad → null", () => {
    const pick = pickTitleFallbackCandidate(
      [
        cand({ raGameId: 1, title: "Donkey Kong" }),
        cand({ raGameId: 2, title: "Donkey Kong" }),
      ],
      "Donkey Kong",
    );
    assert.equal(pick, null);
  });
});
