import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultManagedRetroArchCoreDlls,
  hasRetroArchCoreFlag,
  joinLocalPath,
  parentDir,
  retroArchCoreArgs,
  retroArchCoreCandidatesForPlatform,
  pickFirstExistingCore,
  retroArchCoreDllOrder,
  retroArchCorePathCandidates,
} from "../src/utils/retroArchCores";
import { CoreMissingError } from "../src/services/ensureRuntimeErrors";

describe("retroArchCores", () => {
  it("PS1 → SwanStation primero por defecto", () => {
    const r = retroArchCoreCandidatesForPlatform("PlayStation");
    assert.ok(r);
    assert.equal(r.key, "ps1");
    assert.equal(r.dlls[0], "swanstation_libretro.dll");
  });

  it("PS1 sin BIOS externa → pcsx_rearmed (HLE) primero", () => {
    const order = retroArchCoreDllOrder("PlayStation", { ps1HasExternalBios: false });
    assert.equal(order[0], "pcsx_rearmed_libretro.dll");
  });

  it("PS1 con BIOS en system → SwanStation primero", () => {
    const order = retroArchCoreDllOrder("PlayStation", { ps1HasExternalBios: true });
    assert.equal(order[0], "swanstation_libretro.dll");
  });

  it("instalación vieja sin pcsx_rearmed y sin BIOS → cae a swanstation si existe", async () => {
    const order = retroArchCoreDllOrder("PlayStation", { ps1HasExternalBios: false });
    assert.equal(order[0], "pcsx_rearmed_libretro.dll");
    const paths = order.map(
      (dll) => `C:\\runtimes\\retroarch\\1.22.2\\cores\\${dll}`,
    );
    const chosen = await pickFirstExistingCore(paths, async (p) =>
      p.endsWith("swanstation_libretro.dll"),
    );
    assert.ok(chosen?.endsWith("swanstation_libretro.dll"));
  });

  it("sin ningún core PS1 → CoreMissing nombra la DLL preferida", async () => {
    const order = retroArchCoreDllOrder("PlayStation", { ps1HasExternalBios: false });
    const paths = order.map(
      (dll) => `C:\\runtimes\\retroarch\\1.22.2\\cores\\${dll}`,
    );
    const chosen = await pickFirstExistingCore(paths, async () => false);
    assert.equal(chosen, null);
    const err = new CoreMissingError(order[0]!, "PlayStation");
    assert.equal(err.code, "core_missing");
    assert.equal(err.dll, "pcsx_rearmed_libretro.dll");
    assert.ok(err.message.includes("pcsx_rearmed_libretro.dll"));
  });

  it("con BIOS y ambos cores → SwanStation", async () => {
    const order = retroArchCoreDllOrder("PlayStation", { ps1HasExternalBios: true });
    const paths = order.map(
      (dll) => `C:\\runtimes\\retroarch\\1.22.2\\cores\\${dll}`,
    );
    const chosen = await pickFirstExistingCore(paths, async () => true);
    assert.ok(chosen?.endsWith("swanstation_libretro.dll"));
  });

  it("SwanStation sin BIOS → Ps1BiosRecommended (no bloquea)", async () => {
    const { Ps1BiosRecommended } = await import(
      "../src/services/ensureRuntimeErrors"
    );
    const warn = new Ps1BiosRecommended();
    assert.equal(warn.code, "ps1_bios_recommended");
    assert.ok(warn.message.toLowerCase().includes("swanstation") || warn.message.includes("BIOS"));
  });

  it("NES / SNES usan cores que ya tenés en Blaze", () => {
    assert.equal(
      retroArchCoreCandidatesForPlatform("NES")?.dlls[0],
      "fceumm_libretro.dll",
    );
    assert.equal(
      retroArchCoreCandidatesForPlatform("SNES")?.dlls[0],
      "snes9x_libretro.dll",
    );
  });

  it("PS2 no pide core RetroArch", () => {
    assert.equal(retroArchCoreCandidatesForPlatform("PlayStation 2"), null);
  });

  it("arma ruta cores relativa al exe (manual y managed)", () => {
    const paths = retroArchCorePathCandidates(
      "C:\\RetroArch-Win64\\retroarch.exe",
      "PlayStation",
    );
    assert.equal(
      paths[0],
      "C:\\RetroArch-Win64\\cores\\swanstation_libretro.dll",
    );
    const managed = retroArchCorePathCandidates(
      "C:\\Users\\x\\AppData\\Roaming\\Blaze\\runtimes\\retroarch\\1.22.2\\retroarch.exe",
      "NES",
    );
    assert.equal(
      managed[0],
      "C:\\Users\\x\\AppData\\Roaming\\Blaze\\runtimes\\retroarch\\1.22.2\\cores\\fceumm_libretro.dll",
    );
  });

  it("default managed cores = primer candidato por plataforma", () => {
    const dlls = defaultManagedRetroArchCoreDlls();
    assert.deepEqual(dlls, [
      "fceumm_libretro.dll",
      "snes9x_libretro.dll",
      "gambatte_libretro.dll",
      "mgba_libretro.dll",
      "genesis_plus_gx_libretro.dll",
      "swanstation_libretro.dll",
      "mupen64plus_next_libretro.dll",
      "ppsspp_libretro.dll",
      "dolphin_libretro.dll",
      "melonds_libretro.dll",
    ]);
  });

  it("helpers de path y args", () => {
    assert.equal(parentDir("C:\\RetroArch-Win64\\retroarch.exe"), "C:\\RetroArch-Win64");
    assert.equal(
      joinLocalPath("C:\\RetroArch-Win64", "cores"),
      "C:\\RetroArch-Win64\\cores",
    );
    assert.deepEqual(retroArchCoreArgs("C:\\cores\\x.dll"), ["-L", "C:\\cores\\x.dll"]);
    assert.equal(hasRetroArchCoreFlag(["-L", "x.dll"]), true);
    assert.equal(hasRetroArchCoreFlag([]), false);
  });
});
