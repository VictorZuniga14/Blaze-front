import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectGameRegion,
  regionLanguageWarning,
} from "../src/utils/gameRegion";

describe("detectGameRegion", () => {
  it("lee tags Redump/No-Intro", () => {
    assert.equal(detectGameRegion("God of War (USA).iso"), "ntsc-u");
    assert.equal(detectGameRegion("God of War (Europe) (En,Fr,De,Es,It).iso"), "pal");
    assert.equal(detectGameRegion("Tekken 5 [PAL].iso"), "pal");
    assert.equal(detectGameRegion("Gran Turismo 4 (Japan).iso"), "ntsc-j");
  });

  it("ignora palabras fuera de tags y respeta el orden de fuentes", () => {
    assert.equal(detectGameRegion("Europe Racing.iso"), null);
    assert.equal(detectGameRegion(null, "God of War (USA)"), "ntsc-u");
    assert.equal(detectGameRegion("gow (Spain).iso", "God of War (USA)"), "pal");
    assert.equal(detectGameRegion(undefined, ""), null);
  });
});

describe("regionLanguageWarning", () => {
  it("avisa NTSC-U con idioma distinto de inglés", () => {
    assert.ok(regionLanguageWarning("ntsc-u", "es"));
    assert.equal(regionLanguageWarning("ntsc-u", "en"), null);
  });

  it("PAL o región desconocida no avisan", () => {
    assert.equal(regionLanguageWarning("pal", "es"), null);
    assert.equal(regionLanguageWarning(null, "es"), null);
  });
});
