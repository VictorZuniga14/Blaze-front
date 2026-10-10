import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RA_CONSOLES,
  platformToRaConsoleKey,
  resolveRaConsole,
  supportsRaIdentify,
} from "../src/utils/raConsoles";
import { runtimeKindForPlatform } from "../src/utils/platformRuntime";

describe("raConsoles", () => {
  it("IDs oficiales clave", () => {
    assert.equal(RA_CONSOLES.ps2, 21);
    assert.equal(RA_CONSOLES.psp, 41);
    assert.equal(RA_CONSOLES.snes, 3);
    assert.equal(RA_CONSOLES.nes, 7);
    assert.equal(RA_CONSOLES.gba, 5);
    assert.equal(RA_CONSOLES.ps1, 12);
  });

  it("PCSX2 fuerza ps2 aunque platform diga otra cosa", () => {
    const r = resolveRaConsole({
      platform: "SNES",
      runtimeKind: "pcsx2",
    });
    assert.equal(r?.key, "ps2");
    assert.equal(r?.consoleId, 21);
  });

  it("RetroArch usa Game.platform", () => {
    assert.equal(
      resolveRaConsole({ platform: "Game Boy Advance", runtimeKind: "retroarch" })
        ?.key,
      "gba",
    );
    assert.equal(
      resolveRaConsole({ platform: "Nintendo 64", runtimeKind: "retroarch" })
        ?.consoleId,
      2,
    );
  });

  it("sin platform en RetroArch → null (sin default PS2)", () => {
    assert.equal(
      resolveRaConsole({ platform: null, runtimeKind: "retroarch" }),
      null,
    );
  });

  it("aliases gbc antes que gb", () => {
    assert.equal(platformToRaConsoleKey("Game Boy Color"), "gbc");
    assert.equal(platformToRaConsoleKey("Game Boy"), "gameboy");
    assert.equal(platformToRaConsoleKey("GBC"), "gbc");
  });

  it("identify soportado para catálogo fase actual", () => {
    assert.equal(supportsRaIdentify("snes"), true);
    assert.equal(supportsRaIdentify("psp"), true);
    assert.equal(supportsRaIdentify("gamecube"), false);
    assert.equal(supportsRaIdentify("switch"), false);
  });

  it("Nintendo Switch → Eden", () => {
    assert.equal(platformToRaConsoleKey("Nintendo Switch"), "switch");
    assert.equal(runtimeKindForPlatform("Nintendo Switch"), "eden");
    assert.equal(RA_CONSOLES.switch, 53);
  });
});
