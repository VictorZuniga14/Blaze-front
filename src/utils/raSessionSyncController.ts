export type RaSyncReason = "focus" | "tick" | "settle" | "exit";

export type RaSyncSession = { gameId: string; raGameId: number };

export const RA_SYNC_MIN_GAP_MS: Record<RaSyncReason, number> = {
  focus: 10_000,
  tick: 30_000,
  settle: 0,
  exit: 0,
};

export const RA_SYNC_SETTLE_DELAYS_MS = [8_000, 20_000] as const;
export const RA_SYNC_TICK_MS = 40_000;
export const RA_SYNC_POST_EXIT_MS = 10_000;
export const RA_SYNC_BACKOFF_TICK_MS = 120_000;

export type RaSessionSyncDeps = {
  refreshSilent: (gameId: string) => Promise<void>;
  unlockedCount: (gameId: string) => number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearSchedule?: (id: ReturnType<typeof setTimeout>) => void;
};

/**
 * Un solo estado (session + visible → active) y un solo ejecutor run(reason).
 * Extraído del store Pinia para poder testear con fake timers.
 */
export function createRaSessionSyncController(deps: RaSessionSyncDeps) {
  const now = deps.now ?? (() => Date.now());
  const schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const clearSchedule = deps.clearSchedule ?? ((id) => clearTimeout(id));

  let session: RaSyncSession | null = null;
  let visible = true;
  let inFlight = false;
  let queued: { reason: RaSyncReason; gameId: string } | null = null;
  /** Negativo para que el primer run no choque con MIN_GAP (now=0 en tests). */
  let lastRunAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let exitTimer: ReturnType<typeof setTimeout> | null = null;
  let epoch = 0;
  let failures = 0;

  function isActive(): boolean {
    return !!session && visible;
  }

  function tickDelay(): number {
    return failures >= 3 ? RA_SYNC_BACKOFF_TICK_MS : RA_SYNC_TICK_MS;
  }

  function stopLoop(): void {
    epoch++;
    if (timer) {
      clearSchedule(timer);
      timer = null;
    }
  }

  async function run(
    reason: RaSyncReason,
    gameId: string,
  ): Promise<boolean> {
    if (now() - lastRunAt < RA_SYNC_MIN_GAP_MS[reason]) return false;
    if (inFlight) {
      queued = { reason, gameId };
      return false;
    }
    inFlight = true;
    try {
      const before = deps.unlockedCount(gameId);
      await deps.refreshSilent(gameId);
      failures = 0;
      return deps.unlockedCount(gameId) !== before;
    } catch {
      failures++;
      return false;
    } finally {
      lastRunAt = now();
      inFlight = false;
      if (queued) {
        const q = queued;
        queued = null;
        void run(q.reason, q.gameId);
      }
    }
  }

  async function kick(): Promise<void> {
    stopLoop();
    const myEpoch = epoch;
    const s = session;
    if (!s) return;

    let changed = await run("focus", s.gameId);
    let step = 0;

    const next = (): void => {
      if (myEpoch !== epoch || !isActive()) return;
      const settling = !changed && step < RA_SYNC_SETTLE_DELAYS_MS.length;
      const delay = settling ? RA_SYNC_SETTLE_DELAYS_MS[step]! : tickDelay();
      const reason: RaSyncReason = settling ? "settle" : "tick";
      timer = schedule(() => {
        void (async () => {
          if (myEpoch !== epoch || !isActive()) return;
          if (settling) step++;
          if (await run(reason, s.gameId)) changed = true;
          next();
        })();
      }, delay);
    };
    next();
  }

  function onActiveChanged(wasActive: boolean, nowActive: boolean): void {
    if (nowActive && !wasActive) void kick();
    else if (!nowActive && wasActive) stopLoop();
  }

  function startSession(gameId: string, raGameId: number): Promise<void> {
    if (exitTimer) {
      clearSchedule(exitTimer);
      exitTimer = null;
    }
    const wasActive = isActive();
    session = { gameId, raGameId };
    const nowActive = isActive();
    if (nowActive) return kick(); // incluye cambio de juego sin pasar por inactive
    if (wasActive) stopLoop();
    return Promise.resolve();
  }

  async function endSession(): Promise<void> {
    const s = session;
    stopLoop();
    session = null;
    if (!s) return;
    await run("exit", s.gameId);
    exitTimer = schedule(() => {
      void run("settle", s.gameId);
    }, RA_SYNC_POST_EXIT_MS);
  }

  function setVisible(v: boolean): void {
    const wasActive = isActive();
    visible = v;
    onActiveChanged(wasActive, isActive());
  }

  function onFocus(): void {
    if (isActive()) void kick();
  }

  function getState() {
    return {
      session,
      visible,
      active: isActive(),
      failures,
      lastRunAt,
      inFlight,
      hasTimer: timer != null,
      hasExitTimer: exitTimer != null,
      epoch,
    };
  }

  /** Para tests: invalida timers sin tocar session. */
  function dispose(): void {
    stopLoop();
    if (exitTimer) {
      clearSchedule(exitTimer);
      exitTimer = null;
    }
  }

  return {
    startSession,
    endSession,
    setVisible,
    onFocus,
    run,
    kick,
    getState,
    dispose,
    isActive,
  };
}

export type RaSessionSyncController = ReturnType<
  typeof createRaSessionSyncController
>;
