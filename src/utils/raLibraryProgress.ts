/**
 * Progreso RA de la biblioteca.
 * El porcentaje sale siempre de desbloqueados / total (una sola fórmula).
 * Esos conteos alcanzan para filtros futuros (con logros, 100%, no completados);
 * esta fase no los muestra.
 */

export const RA_REFRESH_FAILED =
  "No fue posible actualizar RetroAchievements.";

export type RaCounts = {
  unlockedAchievements: number;
  totalAchievements: number;
};

export type RaSlotState<TProgress> = {
  raGameId: number;
  progress: TProgress | null;
  confirmed: boolean;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  uiState: string;
};

export type RaCardModel =
  | { kind: "hidden" }
  | { kind: "neutral" }
  | { kind: "no_achievements" }
  | {
      kind: "progress";
      unlocked: number;
      total: number;
      percent: number;
      percentLabel: string;
      barWidth: string;
    };

export type RaLoadDecision = "use-cache" | "busy" | "start";
export type RaRefreshDecision = "busy" | "start";

export function completionPercentFromCounts(
  unlocked: number,
  total: number,
): number {
  if (!Number.isFinite(unlocked) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  const safeUnlocked = Math.max(0, unlocked);
  const raw = (safeUnlocked / total) * 100;
  const capped = Math.min(100, raw);
  return Math.round(capped * 10) / 10;
}

export function formatCompletionPercent(percent: number): string {
  if (!Number.isFinite(percent)) return "0%";
  const rounded = Math.round(percent * 10) / 10;
  if (Number.isInteger(rounded)) return `${rounded}%`;
  return `${rounded.toFixed(1)}%`;
}

export function formatRaProgress(unlocked: number, total: number): {
  unlocked: number;
  total: number;
  percent: number;
  percentLabel: string;
  barWidth: string;
  summary: string;
} {
  const percent = completionPercentFromCounts(unlocked, total);
  return {
    unlocked,
    total,
    percent,
    percentLabel: formatCompletionPercent(percent),
    barWidth: `${percent}%`,
    summary: `${unlocked} / ${total}`,
  };
}

export function raCardModel(input: {
  raGameId: number | null;
  slot: { confirmed: boolean; progress: RaCounts | null } | null;
}): RaCardModel {
  if (input.raGameId == null || input.raGameId <= 0) return { kind: "hidden" };
  const progress = input.slot?.confirmed ? input.slot.progress : null;
  if (!progress) return { kind: "neutral" };
  if (progress.totalAchievements <= 0) return { kind: "no_achievements" };
  const view = formatRaProgress(
    progress.unlockedAchievements,
    progress.totalAchievements,
  );
  return {
    kind: "progress",
    unlocked: view.unlocked,
    total: view.total,
    percent: view.percent,
    percentLabel: view.percentLabel,
    barWidth: view.barWidth,
  };
}

export function decideGameLoad<T>(
  slots: Record<string, RaSlotState<T>>,
  gameId: string,
  raGameId: number,
): { slots: Record<string, RaSlotState<T>>; decision: RaLoadDecision } {
  const current = slots[gameId];
  if (current && current.raGameId === raGameId) {
    if (current.refreshing || current.loading) {
      return { slots, decision: "busy" };
    }
    if (current.confirmed && current.progress) {
      return { slots, decision: "use-cache" };
    }
  }
  return {
    decision: "start",
    slots: {
      ...slots,
      [gameId]: {
        raGameId,
        progress: null,
        confirmed: false,
        loading: true,
        refreshing: false,
        error: null,
        uiState: "loading",
      },
    },
  };
}

export function decideGameRefresh<T>(
  slots: Record<string, RaSlotState<T>>,
  gameId: string,
  raGameId: number,
): { slots: Record<string, RaSlotState<T>>; decision: RaRefreshDecision } {
  const current = slots[gameId];
  if (current?.refreshing && current.raGameId === raGameId) {
    return { slots, decision: "busy" };
  }
  const idChanged = current != null && current.raGameId !== raGameId;
  const progress = idChanged ? null : (current?.progress ?? null);
  return {
    decision: "start",
    slots: {
      ...slots,
      [gameId]: {
        raGameId,
        progress,
        confirmed: idChanged ? false : (current?.confirmed ?? false),
        loading: progress == null,
        refreshing: true,
        error: null,
        uiState: progress ? "available" : "loading",
      },
    },
  };
}

export function commitGameProgress<TProgress extends RaCounts>(
  slots: Record<string, RaSlotState<TProgress>>,
  gameId: string,
  raGameId: number,
  progress: TProgress,
): Record<string, RaSlotState<TProgress>> {
  return {
    ...slots,
    [gameId]: {
      raGameId,
      progress,
      confirmed: true,
      loading: false,
      refreshing: false,
      error: null,
      uiState: "available",
    },
  };
}

export function failGameRefresh<T>(
  slots: Record<string, RaSlotState<T>>,
  gameId: string,
  raGameId: number,
  message: string,
  uiStateIfEmpty: string,
): Record<string, RaSlotState<T>> {
  const current = slots[gameId];
  const progress = current?.progress ?? null;
  return {
    ...slots,
    [gameId]: {
      raGameId,
      progress,
      confirmed: current?.confirmed ?? false,
      loading: false,
      refreshing: false,
      error: message,
      uiState: progress ? "available" : uiStateIfEmpty,
    },
  };
}

/** No pisa un slot ya confirmado, en carga o en refresh. Ignora cache miss. */
export function mergeCachedSlot<TProgress extends RaCounts>(
  slots: Record<string, RaSlotState<TProgress>>,
  gameId: string,
  raGameId: number,
  progress: TProgress | null,
): Record<string, RaSlotState<TProgress>> {
  const current = slots[gameId];
  if (current?.confirmed || current?.refreshing || current?.loading) return slots;
  if (!progress) return slots;
  return commitGameProgress(slots, gameId, raGameId, progress);
}

export function forgetGameSlot<T>(
  slots: Record<string, RaSlotState<T>>,
  gameId: string,
): Record<string, RaSlotState<T>> {
  if (!(gameId in slots)) return slots;
  const next = { ...slots };
  delete next[gameId];
  return next;
}

export function shouldRefreshRaAfterExit(
  raGameId: number | null | undefined,
): boolean {
  return typeof raGameId === "number" && Number.isInteger(raGameId) && raGameId > 0;
}

export function formatRaTimestamp(value: string): string {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function achievementUnlockLabel(unlockedAt: string | null): string | null {
  if (!unlockedAt) return null;
  return `Desbloqueado: ${formatRaTimestamp(unlockedAt)}`;
}

export function exitStatusCopy(
  exitCode: number | null,
  raRefreshFailed: boolean,
): { primary: string; raNotice: string | null } {
  const clean = exitCode === 0 || exitCode === null;
  if (clean && raRefreshFailed) {
    return {
      primary: "Juego cerrado correctamente.",
      raNotice: RA_REFRESH_FAILED,
    };
  }
  if (clean) {
    return { primary: "El juego terminó correctamente.", raNotice: null };
  }
  return {
    primary: `El juego terminó con código ${exitCode}.`,
    raNotice: raRefreshFailed ? RA_REFRESH_FAILED : null,
  };
}

export type RaLaunchCheck = { state: "ok" | "warn"; detail: string };

/** El chequeo de RA en el loader nunca es un error de lanzamiento. */
export function raLaunchCheck(input: {
  status: string;
  username: string | null;
  emulatorKind: string;
  runtimeName: string;
}): RaLaunchCheck {
  const kind =
    input.emulatorKind === "pcsx2"
      ? "PCSX2"
      : input.emulatorKind === "retroarch"
        ? "RetroArch"
        : input.runtimeName;

  if (input.status === "ready") {
    return {
      state: "ok",
      detail: input.username ? `${kind} · ${input.username}` : `${kind} · Conectado`,
    };
  }
  if (input.status === "disabled") {
    return {
      state: "warn",
      detail: input.username
        ? `${kind} · ${input.username} (logros desactivados)`
        : `${kind} · credenciales presentes, logros desactivados`,
    };
  }
  if (input.status === "unsupported") {
    return {
      state: "warn",
      detail: "Emulador sin detector RA — el juego puede iniciarse igual",
    };
  }
  return {
    state: "warn",
    detail: `${kind} · No configurado — se puede jugar sin logros`,
  };
}

export function raNativeLaunchCheck(): RaLaunchCheck {
  return {
    state: "warn",
    detail: "RA se configura en el emulador (PCSX2 / RetroArch)",
  };
}

export function raInspectFailureCheck(): RaLaunchCheck {
  return {
    state: "warn",
    detail: "No se pudo leer el estado — se continúa igual",
  };
}
