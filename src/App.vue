<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { RouterView, useRoute } from "vue-router";
import { storeToRefs } from "pinia";
import { useAuthStore } from "./stores/auth";
import { useRaSessionSyncStore } from "./stores/raSessionSync";
import { initializeBlazeEmulators } from "./services/emulatorData.service";
import { ensureDefaultRuntimes } from "./services/ensureRuntime.service";
import BlazeLoader from "./components/BlazeLoader.vue";
import AppNav from "./components/AppNav.vue";
import WindowChrome from "./components/WindowChrome.vue";

type BootPhase = "checking" | "signingIn" | "loading" | "ready";

const SIGNING_IN_MS = 5000;
const LOADING_MS = 5000;

const auth = useAuthStore();
const raSync = useRaSessionSyncStore();
const route = useRoute();
const { user } = storeToRefs(auth);

const showNav = computed(() => route.name !== "login");

const phase = ref<BootPhase>("checking");

const signingName = computed(() => user.value?.username ?? "");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const onVis = () => {
  raSync.setVisible(document.visibilityState === "visible");
};

const onFocus = () => {
  raSync.onFocus();
};

let unlistenFocus: (() => void) | undefined;

onMounted(() => {
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("focus", onFocus);
  raSync.setVisible(document.visibilityState === "visible");

  void (async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      unlistenFocus = await getCurrentWindow().onFocusChanged(
        ({ payload: focused }) => {
          if (focused) raSync.onFocus();
        },
      );
    } catch {
      /* vite en navegador / fuera de Tauri */
    }

    try {
      const status = await initializeBlazeEmulators();
      console.info("[Blaze] Emuladores inicializados:", status);
    } catch (error) {
      console.error("[Blaze] Error inicializando emuladores:", error);
    }

    await auth.initialize();

    phase.value = auth.isAuthenticated ? "signingIn" : "loading";
    try {
      await ensureDefaultRuntimes();
      console.info("[Blaze] Runtimes listos (PCSX2 + RetroArch)");
    } catch (error) {
      console.error("[Blaze] Error preparando runtimes:", error);
    }

    if (auth.isAuthenticated) {
      await sleep(SIGNING_IN_MS);
    } else {
      await sleep(LOADING_MS);
    }

    phase.value = "ready";
  })();
});

onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", onVis);
  window.removeEventListener("focus", onFocus);
  unlistenFocus?.();
});
</script>

<template>
  <!-- Mientras chequea token (muy corto) -->
  <template v-if="phase === 'checking'">
    <WindowChrome />
    <BlazeLoader label="Cargando" />
  </template>

  <!-- Con sesión -->
  <div v-else-if="phase === 'signingIn'" class="session-boot">
    <WindowChrome />
    <BlazeLoader label="Preparando Blaze..." />
    <p v-if="signingName" class="session-boot__user">👤 {{ signingName }}</p>
  </div>

  <!-- Sin sesión → luego login -->
  <template v-else-if="phase === 'loading'">
    <WindowChrome />
    <BlazeLoader label="Preparando emuladores..." />
  </template>

  <div v-else class="app-shell">
    <AppNav v-if="showNav" />
    <WindowChrome v-else />
    <div class="app-shell__main">
      <RouterView />
    </div>
  </div>
</template>

<style scoped>
.session-boot {
  position: relative;
}

.session-boot__user {
  position: absolute;
  bottom: 18%;
  left: 50%;
  z-index: 2;
  margin: 0;
  transform: translateX(-50%);
  font-size: 1rem;
  color: #e8eef5;
  letter-spacing: 0.02em;
  pointer-events: none;
}

/* Nav fija arriba; el scroll vive solo en el contenido (no pasa del header). */
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.app-shell__main {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
</style>
