<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { RouterView, useRoute } from "vue-router";
import { storeToRefs } from "pinia";
import { useAuthStore } from "./stores/auth";
import { useRaSessionSyncStore } from "./stores/raSessionSync";
import { useCatalogDownloadStore } from "./stores/catalogDownload";
import { initializeBlazeEmulators } from "./services/emulatorData.service";
import { ensureDefaultRuntimes } from "./services/ensureRuntime.service";
import {
  checkVendorAssetStatus,
  downloadAndInstallVendorAssets,
  type VendorOnboardingProgress,
} from "./services/vendorOnboarding.service";
import BlazeLoader from "./components/BlazeLoader.vue";
import AppNav from "./components/AppNav.vue";
import WindowChrome from "./components/WindowChrome.vue";
import DownloadProgressHud from "./components/DownloadProgressHud.vue";

type BootPhase = "checking" | "signingIn" | "loading" | "vendorOnboarding" | "ready";

const SIGNING_IN_MS = 2000;
const LOADING_MS = 2000;

const auth = useAuthStore();
const raSync = useRaSessionSyncStore();
const catalogDownloads = useCatalogDownloadStore();
const route = useRoute();
const { user } = storeToRefs(auth);
const { hudJob, hasActiveDownloads } = storeToRefs(catalogDownloads);

const showNav = computed(() => route.name !== "login");

const globalHudTitle = computed(() => {
  const job = hudJob.value;
  if (!job) return "DESCARGANDO";
  if (job.gameTitle) return `${job.hudTitle} · ${job.gameTitle}`;
  return job.hudTitle;
});

/** Evita duplicar el HUD si ya se muestra en el detalle del mismo juego. */
const showGlobalDownloadHud = computed(() => {
  if (!hasActiveDownloads.value || !hudJob.value) return false;
  const jobId = hudJob.value.gameId;
  if (
    typeof route.params.id === "string" &&
    route.params.id === jobId &&
    String(route.path).startsWith("/games/")
  ) {
    return false;
  }
  return true;
});

const phase = ref<BootPhase>("checking");
const vendorProgress = ref<VendorOnboardingProgress | null>(null);
const vendorError = ref<string | null>(null);

const signingName = computed(() => user.value?.username ?? "");

const vendorProgressPercent = computed(() => {
  if (!vendorProgress.value || vendorProgress.value.bytesTotal === 0) return 0;
  return Math.round((vendorProgress.value.bytesDone / vendorProgress.value.bytesTotal) * 100);
});

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

    // Si está autenticado, mostrar progreso de login y chequear vendor assets
    if (auth.isAuthenticated) {
      phase.value = "signingIn";
      await sleep(SIGNING_IN_MS);

      // Chequear si necesitamos descargar vendor assets
      try {
        const vendorStatus = await checkVendorAssetStatus();
        
        if (!vendorStatus.allReady) {
          // Mostrar pantalla de onboarding vendor
          phase.value = "vendorOnboarding";
          
          await downloadAndInstallVendorAssets((p) => {
            vendorProgress.value = p;
          });
          
          // Pequeña pausa para mostrar completado
          await sleep(800);
        }
      } catch (error) {
        console.error("[Blaze] Error en vendor onboarding:", error);
        vendorError.value = error instanceof Error ? error.message : String(error);
        // Continuar de todas formas - el usuario puede hacer onboarding manual después
      }
    } else {
      // Sin sesión, solo loading
      phase.value = "loading";
      await sleep(LOADING_MS);
    }

    // Preparar runtimes (emuladores base)
    try {
      await ensureDefaultRuntimes();
      console.info("[Blaze] Runtimes listos (PCSX2 + RetroArch + Eden)");
    } catch (error) {
      console.error("[Blaze] Error preparando runtimes:", error);
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
    <BlazeLoader label="Iniciando sesión..." />
    <p v-if="signingName" class="session-boot__user">👤 {{ signingName }}</p>
  </div>

  <!-- Descargando vendor assets (BIOS/keys/firmware) -->
  <div v-else-if="phase === 'vendorOnboarding'" class="vendor-onboarding">
    <WindowChrome />
    <BlazeLoader label="Preparando Blaze..." />
    <div class="vendor-progress">
      <p v-if="vendorProgress" class="vendor-progress__asset">
        {{ vendorProgress.assetName }}
      </p>
      <div v-if="vendorProgress && !vendorError" class="vendor-progress-bar">
        <div 
          class="vendor-progress-bar__fill" 
          :style="{ width: vendorProgressPercent + '%' }"
        ></div>
      </div>
      <p v-if="vendorProgress" class="vendor-progress__message">
        {{ vendorProgress.message }}
      </p>
      <p v-if="vendorError" class="vendor-progress__error">
        {{ vendorError }}
      </p>
    </div>
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
    <div
      v-if="showGlobalDownloadHud && hudJob"
      class="global-dl-hud"
      aria-live="polite"
    >
      <DownloadProgressHud
        :title="globalHudTitle"
        :percent="hudJob.percent"
        :detail="hudJob.detail"
      />
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

.vendor-onboarding {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
}

.vendor-progress {
  position: absolute;
  bottom: 20%;
  left: 50%;
  z-index: 2;
  width: 90%;
  max-width: 400px;
  transform: translateX(-50%);
  text-align: center;
}

.vendor-progress__asset {
  margin: 0 0 0.5rem 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: #e2e8f0;
}

.vendor-progress-bar {
  width: 100%;
  height: 6px;
  margin: 1rem 0;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}

.vendor-progress-bar__fill {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6 0%, #06b6d4 100%);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.vendor-progress__message {
  margin: 0.5rem 0 0 0;
  font-size: 0.75rem;
  color: #94a3b8;
}

.vendor-progress__error {
  margin: 1rem 0 0 0;
  padding: 0.5rem;
  border-radius: 4px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  font-size: 0.75rem;
  color: #fca5a5;
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

.global-dl-hud {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 40;
  min-width: 220px;
  max-width: min(320px, calc(100vw - 36px));
  padding: 12px 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  background: rgba(23, 26, 33, 0.94);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
  pointer-events: none;
}
</style>
