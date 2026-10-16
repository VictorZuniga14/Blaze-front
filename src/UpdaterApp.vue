<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import {
  handoffToMainWindow,
  runExternalUpdaterFlow,
  type UpdateProgress,
} from "./services/appUpdater.service";

const progress = ref<UpdateProgress>({
  phase: "checking",
  percent: null,
  downloadedBytes: 0,
  totalBytes: null,
  detail: "Iniciando…",
});

const cancelled = ref(false);
const busy = ref(true);
let unlistenClose: (() => void) | undefined;
/** Permite que close()/hide() del handoff no sea bloqueado por onCloseRequested. */
let allowWindowClose = false;
let handoffPromise: Promise<void> | null = null;

const canCancel = computed(
  () =>
    !cancelled.value &&
    progress.value.phase !== "installing" &&
    progress.value.phase !== "done",
);

const barWidth = computed(() => {
  if (progress.value.phase === "checking") return 15;
  if (progress.value.percent == null) {
    return progress.value.phase === "downloading" ? 40 : 8;
  }
  return Math.max(2, progress.value.percent);
});

const indeterminate = computed(
  () =>
    progress.value.percent == null &&
    (progress.value.phase === "checking" ||
      progress.value.phase === "downloading"),
);

async function handoffOnce(): Promise<void> {
  allowWindowClose = true;
  busy.value = false;
  if (!handoffPromise) {
    handoffPromise = handoffToMainWindow().catch((error) => {
      console.info("[Blaze] Handoff updater→main:", error);
      // Permitir reintentar si falló.
      handoffPromise = null;
    });
  }
  await handoffPromise;
}

async function cancel(): Promise<void> {
  if (!canCancel.value) return;
  cancelled.value = true;
  progress.value = {
    ...progress.value,
    phase: "idle",
    detail: "Cancelado",
  };
  await handoffOnce();
}

onMounted(() => {
  void (async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      unlistenClose = await getCurrentWindow().onCloseRequested(async (event) => {
        // Cierre programático tras handoff: no bloquear.
        if (allowWindowClose) return;

        if (
          progress.value.phase === "installing" ||
          progress.value.phase === "done"
        ) {
          event.preventDefault();
          return;
        }
        // X del usuario: mismo handoff que Cancelar.
        cancelled.value = true;
        event.preventDefault();
        await handoffOnce();
      });
    } catch {
      /* fuera de Tauri */
    }

    const result = await runExternalUpdaterFlow({
      shouldAbort: () => cancelled.value,
      onProgress: (p) => {
        if (!cancelled.value) progress.value = p;
      },
    });

    // Sin update / error / cancel: cerrar modal y recién abrir la app.
    // Con update instalado → relaunch (no handoff).
    if (result === "skipped") {
      await handoffOnce();
    }
  })();
});

onBeforeUnmount(() => {
  unlistenClose?.();
});
</script>

<template>
  <div class="updater">
    <div class="updater__body">
      <p class="updater__title">{{ progress.detail }}</p>
      <p v-if="progress.version" class="updater__meta">
        Blaze → {{ progress.version }}
      </p>

      <div
        class="updater__track"
        :class="{ 'updater__track--indeterminate': indeterminate }"
        role="progressbar"
        :aria-valuenow="progress.percent ?? undefined"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div
          class="updater__fill"
          :style="{ width: indeterminate ? undefined : `${barWidth}%` }"
        />
      </div>
    </div>

    <div class="updater__actions">
      <button
        type="button"
        class="updater__cancel"
        :disabled="!canCancel"
        @click="cancel"
      >
        Cancelar
      </button>
    </div>
  </div>
</template>

<style scoped>
.updater {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 100%;
  padding: 18px 20px 14px;
  background: #20242a;
  color: #dfe4ea;
  font-family: "Segoe UI", system-ui, sans-serif;
  user-select: none;
}

.updater__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.updater__title {
  margin: 0;
  font-size: 13px;
  font-weight: 400;
  line-height: 1.35;
  color: #e8edf3;
}

.updater__meta {
  margin: 0;
  font-size: 11px;
  color: #9aa5b4;
}

.updater__track {
  position: relative;
  margin-top: 10px;
  height: 18px;
  overflow: hidden;
  border: 1px solid #3a424e;
  border-radius: 2px;
  background: #15191f;
}

.updater__fill {
  height: 100%;
  background: linear-gradient(180deg, #5a9fd4 0%, #3b7eb0 100%);
  transition: width 0.12s linear;
}

.updater__track--indeterminate .updater__fill {
  position: absolute;
  top: 0;
  left: 0;
  width: 36%;
  animation: updater-slide 1.1s ease-in-out infinite;
}

@keyframes updater-slide {
  0% {
    transform: translateX(-120%);
  }
  100% {
    transform: translateX(320%);
  }
}

.updater__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.updater__cancel {
  min-width: 88px;
  height: 28px;
  padding: 0 14px;
  border: 1px solid #4a5563;
  border-radius: 2px;
  background: #2a3038;
  color: #e8edf3;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.updater__cancel:hover:not(:disabled) {
  background: #343b45;
  border-color: #5b6776;
}

.updater__cancel:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
