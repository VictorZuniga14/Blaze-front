<script setup lang="ts">
import type { LaunchCheckItem } from "../types/retroAchievements";
import BlazeLoader from "./BlazeLoader.vue";

defineProps<{
  checks: LaunchCheckItem[];
  title?: string;
}>();

function icon(state: LaunchCheckItem["state"]): string {
  switch (state) {
    case "ok":
      return "✓";
    case "warn":
      return "○";
    case "error":
      return "✕";
    case "running":
      return "…";
    default:
      return "·";
  }
}

function rowClass(state: LaunchCheckItem["state"]): string {
  switch (state) {
    case "ok":
      return "text-emerald-300";
    case "warn":
      return "text-amber-300";
    case "error":
      return "text-rose-300";
    case "running":
      return "text-sky-300";
    default:
      return "text-slate-500";
  }
}
</script>

<template>
  <div class="launch-checklist" role="status" aria-live="polite">
    <BlazeLoader compact label="" />
    <h2 class="launch-checklist__title">
      {{ title ?? "Preparando juego..." }}
    </h2>
    <ul class="launch-checklist__list">
      <li
        v-for="check in checks"
        :key="check.id"
        class="launch-checklist__row"
        :class="rowClass(check.state)"
      >
        <span class="launch-checklist__icon" aria-hidden="true">{{
          icon(check.state)
        }}</span>
        <div class="min-w-0 flex-1">
          <p class="launch-checklist__label">{{ check.label }}</p>
          <p v-if="check.detail" class="launch-checklist__detail">
            {{ check.detail }}
          </p>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.launch-checklist {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  background: radial-gradient(ellipse at top, #1a2332 0%, #0b0f14 55%);
  padding: 1.5rem;
}

.launch-checklist__title {
  margin: 0;
  font-size: 0.85rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #7dd3e8;
}

.launch-checklist__list {
  margin: 0;
  padding: 0;
  list-style: none;
  width: min(420px, 100%);
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.launch-checklist__row {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  font-size: 0.9rem;
}

.launch-checklist__icon {
  width: 1.1rem;
  flex-shrink: 0;
  text-align: center;
  font-weight: 600;
}

.launch-checklist__label {
  margin: 0;
  font-weight: 500;
}

.launch-checklist__detail {
  margin: 0.1rem 0 0;
  font-size: 0.75rem;
  opacity: 0.75;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
