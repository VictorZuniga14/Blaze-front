<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import BlazeLoader from "../components/BlazeLoader.vue";
import {
  downloadAndInstallVendorAssets,
  type VendorOnboardingProgress,
} from "../services/vendorOnboarding.service";

const router = useRouter();

const progress = ref<VendorOnboardingProgress>({
  phase: "downloading",
  assetKind: null,
  assetName: "Blaze",
  bytesDone: 0,
  bytesTotal: 1,
  message: "Descargando Blaze…",
});

const error = ref<string | null>(null);
const isComplete = ref(false);

const progressPercent = computed(() => {
  if (progress.value.bytesTotal === 0) return 0;
  return Math.round((progress.value.bytesDone / progress.value.bytesTotal) * 100);
});

const progressBarWidth = computed(() => `${progressPercent.value}%`);

async function runOnboarding(): Promise<void> {
  try {
    await downloadAndInstallVendorAssets((p) => {
      progress.value = p;
    });
    
    isComplete.value = true;
    
    // Pequeña pausa para mostrar el "Completado" antes de continuar
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // Redirigir a la biblioteca (home de la app)
    await router.push("/");
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    progress.value = {
      phase: "error",
      assetKind: null,
      assetName: "Error",
      bytesDone: 0,
      bytesTotal: 1,
      message: error.value,
    };
  }
}

onMounted(() => {
  void runOnboarding();
});

async function retry(): Promise<void> {
  error.value = null;
  isComplete.value = false;
  progress.value = {
    phase: "downloading",
    assetKind: null,
    assetName: "Blaze",
    bytesDone: 0,
    bytesTotal: 1,
    message: "Descargando Blaze…",
  };
  await runOnboarding();
}
</script>

<template>
  <div class="onboarding-screen">
    <div class="onboarding-content">
      <!-- Loader animado -->
      <div v-if="!error" class="loader-container">
        <BlazeLoader :label="isComplete ? 'Listo' : 'Descargando Blaze…'" />
      </div>

      <!-- Información de progreso -->
      <div class="progress-info">
        <p class="progress-message">{{ progress.message }}</p>
        
        <!-- Barra de progreso -->
        <div v-if="!error && !isComplete" class="progress-bar-container">
          <div class="progress-bar" :style="{ width: progressBarWidth }"></div>
        </div>
        
        <p v-if="!error && !isComplete" class="progress-percent">
          {{ progressPercent }}%
        </p>
      </div>

      <!-- Error -->
      <div v-if="error" class="error-container">
        <div class="error-icon">⚠️</div>
        <h2 class="error-title">No se pudo completar la preparación</h2>
        <p class="error-message">{{ error }}</p>
        <button class="retry-button" @click="retry">
          Reintentar
        </button>
      </div>

      <!-- Nota informativa -->
      <div v-if="!error && !isComplete" class="info-note">
        <p>
          Blaze está descargando los componentes necesarios para los emuladores.
          Este proceso solo ocurre la primera vez.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.onboarding-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 2rem;
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
}

.onboarding-content {
  max-width: 500px;
  width: 100%;
  text-align: center;
}

.loader-container {
  margin-bottom: 2rem;
}

.progress-info {
  margin-bottom: 2rem;
}

.progress-asset {
  margin: 0 0 0.5rem 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: #e2e8f0;
}

.progress-message {
  margin: 0 0 1rem 0;
  font-size: 0.875rem;
  color: #94a3b8;
}

.progress-bar-container {
  width: 100%;
  height: 8px;
  margin: 1rem 0 0.5rem 0;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6 0%, #06b6d4 100%);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.progress-percent {
  margin: 0.5rem 0 0 0;
  font-size: 0.875rem;
  font-weight: 500;
  color: #64748b;
}

.info-note {
  padding: 1rem;
  border-radius: 8px;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.2);
}

.info-note p {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.5;
  color: #cbd5e1;
}

.error-container {
  padding: 2rem;
  border-radius: 12px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
}

.error-icon {
  font-size: 3rem;
  margin-bottom: 1rem;
}

.error-title {
  margin: 0 0 1rem 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: #fecaca;
}

.error-message {
  margin: 0 0 1.5rem 0;
  font-size: 0.875rem;
  line-height: 1.5;
  color: #fca5a5;
}

.retry-button {
  padding: 0.75rem 2rem;
  border: none;
  border-radius: 8px;
  background: #ef4444;
  color: white;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.retry-button:hover {
  background: #dc2626;
}

.retry-button:active {
  transform: scale(0.98);
}
</style>
