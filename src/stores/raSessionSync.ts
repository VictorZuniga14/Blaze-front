import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  createRaSessionSyncController,
  type RaSyncSession,
} from "../utils/raSessionSyncController";
import { useRaProgressStore } from "./raProgress";

/**
 * Sync de progreso RA mientras hay sesión de juego:
 * active = session && visible → un solo run() + timer encadenado.
 */
export const useRaSessionSyncStore = defineStore("raSessionSync", () => {
  const ra = useRaProgressStore();

  const session = ref<RaSyncSession | null>(null);
  const visible = ref(
    typeof document === "undefined"
      ? true
      : document.visibilityState === "visible",
  );
  const active = computed(() => !!session.value && visible.value);

  const controller = createRaSessionSyncController({
    refreshSilent: (gameId) => ra.refreshSilent(gameId),
    unlockedCount: (gameId) => ra.unlockedCount(gameId),
  });

  function syncRefsFromController(): void {
    const state = controller.getState();
    session.value = state.session;
    visible.value = state.visible;
  }

  function startSession(gameId: string, raGameId: number): void {
    controller.startSession(gameId, raGameId);
    syncRefsFromController();
  }

  async function endSession(): Promise<void> {
    await controller.endSession();
    syncRefsFromController();
  }

  function setVisible(v: boolean): void {
    controller.setVisible(v);
    syncRefsFromController();
  }

  function onFocus(): void {
    controller.onFocus();
  }

  return {
    session,
    visible,
    active,
    startSession,
    endSession,
    setVisible,
    onFocus,
  };
});
