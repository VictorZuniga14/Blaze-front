import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RA_REFRESH_FAILED,
  achievementUnlockLabel,
  commitGameProgress,
  completionPercentFromCounts,
  decideGameLoad,
  decideGameRefresh,
  exitStatusCopy,
  failGameRefresh,
  forgetGameSlot,
  formatCompletionPercent,
  mergeCachedSlot,
  raCardModel,
  raInspectFailureCheck,
  raLaunchCheck,
  raNativeLaunchCheck,
  shouldRefreshRaAfterExit,
  type RaCounts,
  type RaSlotState,
} from "../src/utils/raLibraryProgress.ts";

const gow: RaCounts = { unlockedAchievements: 0, totalAchievements: 43 };
const partial: RaCounts = { unlockedAchievements: 12, totalAchievements: 43 };
const done: RaCounts = { unlockedAchievements: 43, totalAchievements: 43 };

describe("porcentaje RA", () => {
  it("deriva 12/43 como 27.9% y no como 28%", () => {
    const percent = completionPercentFromCounts(12, 43);
    assert.equal(percent, 27.9);
    assert.equal(formatCompletionPercent(percent), "27.9%");
    assert.notEqual(formatCompletionPercent(percent), "28%");
  });

  it("0/43 es 0% y 43/43 es 100%", () => {
    assert.equal(formatCompletionPercent(completionPercentFromCounts(0, 43)), "0%");
    assert.equal(
      formatCompletionPercent(completionPercentFromCounts(43, 43)),
      "100%",
    );
  });

  it("sin total no inventa un porcentaje", () => {
    assert.equal(completionPercentFromCounts(0, 0), 0);
    assert.equal(completionPercentFromCounts(3, 0), 0);
  });
});

describe("GameCard", () => {
  it("sin mapping no muestra bloque", () => {
    assert.deepEqual(raCardModel({ raGameId: null, slot: null }), { kind: "hidden" });
  });

  it("mapeado sin datos confirmados queda neutro, aunque el total sea 0", () => {
    assert.equal(
      raCardModel({
        raGameId: 2782,
        slot: {
          confirmed: false,
          progress: { unlockedAchievements: 0, totalAchievements: 0 },
        },
      }).kind,
      "neutral",
    );
    assert.equal(raCardModel({ raGameId: 2782, slot: null }).kind, "neutral");
  });

  it("muestra 0%, progreso parcial y 100%", () => {
    const zero = raCardModel({
      raGameId: 2782,
      slot: { confirmed: true, progress: gow },
    });
    const mid = raCardModel({
      raGameId: 2782,
      slot: { confirmed: true, progress: partial },
    });
    const full = raCardModel({
      raGameId: 2782,
      slot: { confirmed: true, progress: done },
    });
    assert.equal(zero.kind, "progress");
    assert.equal(mid.kind, "progress");
    assert.equal(full.kind, "progress");
    if (zero.kind === "progress") assert.equal(zero.percentLabel, "0%");
    if (mid.kind === "progress") {
      assert.equal(mid.unlocked, 12);
      assert.equal(mid.total, 43);
      assert.equal(mid.percentLabel, "27.9%");
    }
    if (full.kind === "progress") assert.equal(full.percentLabel, "100%");
  });

  it("sin logros solo si la respuesta está confirmada", () => {
    assert.equal(
      raCardModel({
        raGameId: 10,
        slot: {
          confirmed: true,
          progress: { unlockedAchievements: 0, totalAchievements: 0 },
        },
      }).kind,
      "no_achievements",
    );
  });
});

describe("store de progreso", () => {
  it("guarda varios juegos y actualiza solo uno", () => {
    let slots: Record<string, RaSlotState<RaCounts>> = {};
    slots = commitGameProgress(slots, "gow", 2782, gow);
    slots = commitGameProgress(slots, "crash", 100, {
      unlockedAchievements: 12,
      totalAchievements: 40,
    });
    slots = commitGameProgress(slots, "gow", 2782, {
      unlockedAchievements: 5,
      totalAchievements: 43,
    });
    assert.equal(slots.gow?.progress?.unlockedAchievements, 5);
    assert.equal(slots.crash?.progress?.unlockedAchievements, 12);
    assert.equal(slots.crash?.progress?.totalAchievements, 40);
  });

  it("un refresh fallido conserva el progreso anterior", () => {
    let slots: Record<string, RaSlotState<RaCounts>> = {};
    slots = commitGameProgress(slots, "gow", 2782, partial);
    slots = failGameRefresh(slots, "gow", 2782, RA_REFRESH_FAILED, "api_error");
    assert.equal(slots.gow?.progress?.unlockedAchievements, 12);
    assert.equal(slots.gow?.progress?.totalAchievements, 43);
    assert.equal(slots.gow?.error, RA_REFRESH_FAILED);
    assert.equal(slots.gow?.refreshing, false);
    assert.equal(slots.gow?.confirmed, true);
  });

  it("no inicia un segundo refresh del mismo juego", () => {
    const first = decideGameRefresh({}, "gow", 2782);
    assert.equal(first.decision, "start");
    const second = decideGameRefresh(first.slots, "gow", 2782);
    assert.equal(second.decision, "busy");
  });

  it("otro juego puede refrescarse mientras uno está en curso", () => {
    const first = decideGameRefresh({}, "gow", 2782);
    const other = decideGameRefresh(first.slots, "crash", 100);
    assert.equal(other.decision, "start");
    assert.equal(other.slots.gow?.refreshing, true);
    assert.equal(other.slots.crash?.refreshing, true);
  });

  it("si ya hay progreso confirmado no vuelve a pedir", () => {
    const slots = commitGameProgress({}, "gow", 2782, gow);
    const decision = decideGameLoad(slots, "gow", 2782);
    assert.equal(decision.decision, "use-cache");
  });

  it("la cache no pisa un refresh en curso ni un miss", () => {
    const refreshing = decideGameRefresh(
      commitGameProgress({}, "gow", 2782, gow),
      "gow",
      2782,
    );
    const kept = mergeCachedSlot(refreshing.slots, "gow", 2782, partial);
    assert.equal(kept.gow?.progress?.unlockedAchievements, 0);
    assert.equal(kept.gow?.refreshing, true);

    const missed = mergeCachedSlot({}, "black", 50, null);
    assert.equal(missed.black, undefined);
  });

  it("olvidar un juego no borra el resto", () => {
    let slots = commitGameProgress({}, "gow", 2782, gow);
    slots = commitGameProgress(slots, "crash", 100, partial);
    slots = forgetGameSlot(slots, "gow");
    assert.equal(slots.gow, undefined);
    assert.equal(slots.crash?.raGameId, 100);
  });
});

describe("detalle y cierre", () => {
  it("arma la etiqueta de desbloqueo y omite pendientes", () => {
    assert.equal(achievementUnlockLabel(null), null);
    const label = achievementUnlockLabel("2024-01-02 15:04:00");
    assert.ok(label?.startsWith("Desbloqueado:"));
    assert.equal(achievementUnlockLabel("fecha-rara"), "Desbloqueado: fecha-rara");
  });

  it("un fallo de RA después de cerrar no convierte el cierre en error", () => {
    const failed = exitStatusCopy(0, true);
    assert.equal(failed.primary, "Juego cerrado correctamente.");
    assert.equal(failed.raNotice, RA_REFRESH_FAILED);
    const ok = exitStatusCopy(null, false);
    assert.equal(ok.primary, "El juego terminó correctamente.");
    assert.equal(ok.raNotice, null);
  });
});

describe("loader", () => {
  it("RA listo, desactivado, caído o no configurado no bloquea", () => {
    const statuses = [
      "ready",
      "disabled",
      "unsupported",
      "not_configured",
      "unavailable",
    ];
    for (const status of statuses) {
      const check = raLaunchCheck({
        status,
        username: status === "ready" ? "ElTunaSs14" : null,
        emulatorKind: "pcsx2",
        runtimeName: "PCSX2",
      });
      assert.notEqual(check.state, "error");
    }
    assert.equal(raNativeLaunchCheck().state, "warn");
    assert.equal(raInspectFailureCheck().state, "warn");
  });

  it("refresca después de jugar solo si hay mapping", () => {
    assert.equal(shouldRefreshRaAfterExit(2782), true);
    assert.equal(shouldRefreshRaAfterExit(null), false);
    assert.equal(shouldRefreshRaAfterExit(0), false);
    assert.equal(shouldRefreshRaAfterExit(undefined), false);
  });
});
