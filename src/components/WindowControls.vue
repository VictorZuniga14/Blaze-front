<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";

const maximized = ref(false);
let unlistenResize: (() => void) | undefined;

async function syncMaximized() {
  try {
    maximized.value = await getCurrentWindow().isMaximized();
  } catch {
    maximized.value = false;
  }
}

async function minimize() {
  try {
    await getCurrentWindow().minimize();
  } catch {
    // navegador / sin Tauri
  }
}

async function toggleMaximize() {
  try {
    const win = getCurrentWindow();
    if (await win.isMaximized()) {
      await win.unmaximize();
    } else {
      await win.maximize();
    }
    await syncMaximized();
  } catch {
    // navegador / sin Tauri
  }
}

async function closeWindow() {
  try {
    await getCurrentWindow().close();
  } catch {
    // navegador / sin Tauri
  }
}

onMounted(async () => {
  await syncMaximized();
  try {
    unlistenResize = await getCurrentWindow().onResized(() => {
      void syncMaximized();
    });
  } catch {
    // sin Tauri
  }
});

onUnmounted(() => {
  unlistenResize?.();
});
</script>

<template>
  <div class="win-controls">
    <button type="button" class="win-controls__btn" aria-label="Minimizar" @click="minimize">
      <svg class="win-controls__icon" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M1 5h8" />
      </svg>
    </button>
    <button
      type="button"
      class="win-controls__btn"
      :aria-label="maximized ? 'Restaurar' : 'Maximizar'"
      @click="toggleMaximize"
    >
      <!-- Restore (maximized) -->
      <svg
        v-if="maximized"
        class="win-controls__icon"
        viewBox="0 0 10 10"
        aria-hidden="true"
      >
        <path d="M3 1.5h5.5V7" />
        <rect x="1.5" y="3" width="5.5" height="5.5" />
      </svg>
      <!-- Maximize -->
      <svg v-else class="win-controls__icon" viewBox="0 0 10 10" aria-hidden="true">
        <rect x="1.5" y="1.5" width="7" height="7" />
      </svg>
    </button>
    <button
      type="button"
      class="win-controls__btn win-controls__btn--close"
      aria-label="Cerrar (queda en bandeja)"
      title="Cerrar (queda en bandeja)"
      @click="closeWindow"
    >
      <svg class="win-controls__icon" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M2 2l6 6M8 2L2 8" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.win-controls {
  display: flex;
  align-items: stretch;
  margin-left: auto;
  height: 100%;
  -webkit-app-region: no-drag;
}

.win-controls__btn {
  display: grid;
  place-items: center;
  width: 46px;
  height: 100%;
  min-height: 28px;
  border: 0;
  padding: 0;
  background: transparent;
  color: #c7c5c2;
  cursor: pointer;
}

.win-controls__icon {
  width: 10px;
  height: 10px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1;
  stroke-linecap: square;
  stroke-linejoin: miter;
  shape-rendering: geometricPrecision;
}

.win-controls__btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.win-controls__btn--close:hover {
  background: #e81123;
  color: #fff;
}
</style>
