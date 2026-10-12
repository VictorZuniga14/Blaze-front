<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{
  /** 0–100 */
  percent: number;
  /** Ej. DESCARGANDO */
  title?: string;
  /** Línea extra opcional (MB / GB). */
  detail?: string | null;
  /** Mostrar Cancelar (instalación de emulador). */
  showCancel?: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
}>();

const confirmCancel = ref(false);

function onCancelClick() {
  if (props.percent > 10) {
    confirmCancel.value = true;
    return;
  }
  emit("cancel");
}

function confirmYes() {
  confirmCancel.value = false;
  emit("cancel");
}

function confirmNo() {
  confirmCancel.value = false;
}
</script>

<template>
  <div class="dl-hud" role="status" aria-live="polite">
    <p class="dl-hud__title">{{ title || "DESCARGANDO" }}</p>
    <p class="dl-hud__pct">
      Completado un {{ Math.min(100, Math.max(0, Math.round(percent))) }} %
    </p>
    <p v-if="detail" class="dl-hud__detail">{{ detail }}</p>
    <div class="dl-hud__track">
      <div
        class="dl-hud__fill"
        :style="{
          width: `${Math.min(100, Math.max(0, percent))}%`,
        }"
      />
    </div>
    <div v-if="showCancel" class="dl-hud__actions">
      <button
        v-if="!confirmCancel"
        type="button"
        class="dl-hud__cancel"
        @click="onCancelClick"
      >
        Cancelar
      </button>
      <div v-else class="dl-hud__confirm">
        <span>¿Cancelar la descarga del emulador?</span>
        <button type="button" class="dl-hud__cancel" @click="confirmYes">Sí</button>
        <button type="button" class="dl-hud__keep" @click="confirmNo">No</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dl-hud {
  min-width: min(220px, 100%);
  max-width: 280px;
  padding: 2px 0 0;
}

.dl-hud__title {
  margin: 0;
  color: #c7d5e0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.dl-hud__pct {
  margin: 2px 0 0;
  color: #8f98a0;
  font-size: 12px;
}

.dl-hud__detail {
  margin: 2px 0 0;
  color: #67c1f5;
  font-size: 11px;
}

.dl-hud__track {
  margin-top: 8px;
  height: 4px;
  overflow: hidden;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.45);
}

.dl-hud__fill {
  height: 100%;
  border-radius: 2px;
  background: #1a9fff;
  box-shadow: 0 0 6px rgba(26, 159, 255, 0.55);
  transition: width 0.2s ease-out;
}

.dl-hud__actions {
  margin-top: 8px;
}

.dl-hud__cancel,
.dl-hud__keep {
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 3px;
  border: 1px solid rgba(148, 163, 184, 0.45);
  background: transparent;
  color: #cbd5e1;
  cursor: pointer;
}

.dl-hud__confirm {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  font-size: 11px;
  color: #fbbf24;
}

.dl-hud__keep {
  border-color: rgba(26, 159, 255, 0.5);
  color: #67c1f5;
}
</style>
