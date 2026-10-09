<script setup lang="ts">
defineProps<{
  /** 0–100 */
  percent: number;
  /** Ej. DESCARGANDO */
  title?: string;
  /** Línea extra opcional (MB / GB). */
  detail?: string | null;
}>();
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
</style>
