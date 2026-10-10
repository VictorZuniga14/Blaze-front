<script setup lang="ts">
import { computed } from "vue";
import type { RaAchievement, RaGameProgress } from "../types/retroAchievements";
import { formatRaProgress } from "../utils/raLibraryProgress";
import { raBadgeUrl } from "../utils/raBadge";
import AchievementsMedalIcon from "./icons/AchievementsMedalIcon.vue";

const props = defineProps<{
  progress: RaGameProgress | null;
  loading?: boolean;
  error?: string | null;
}>();

const emit = defineEmits<{
  refresh: [];
}>();

const MAX_ICONS = 8;

const completion = computed(() => {
  const p = props.progress;
  if (!p || p.totalAchievements <= 0) return null;
  return formatRaProgress(p.unlockedAchievements, p.totalAchievements);
});

const unlocked = computed(() =>
  (props.progress?.achievements ?? []).filter((a) => a.unlocked),
);

const locked = computed(() =>
  (props.progress?.achievements ?? []).filter((a) => !a.unlocked),
);

const featured = computed((): RaAchievement | null => {
  const list = unlocked.value;
  if (!list.length) return locked.value[0] ?? null;
  return list[list.length - 1] ?? null;
});

const unlockedPreview = computed(() => unlocked.value.slice(0, MAX_ICONS));
const lockedPreview = computed(() => locked.value.slice(0, MAX_ICONS));
const unlockedExtra = computed(() =>
  Math.max(0, unlocked.value.length - MAX_ICONS),
);
const lockedExtra = computed(() => Math.max(0, locked.value.length - MAX_ICONS));

function badgeSrc(ach: RaAchievement): string | null {
  return raBadgeUrl(ach.badgeName, ach.unlocked);
}
</script>

<template>
  <section class="ra-show">
    <header class="ra-show__head">
      <div class="ra-show__title-block">
        <AchievementsMedalIcon class="ra-show__medal" />
        <div class="ra-show__title-text">
          <h2>LOGROS</h2>
          <div v-if="completion" class="ra-show__progress-row">
            <span class="ra-show__count">{{ completion.summary }}</span>
            <div class="ra-show__bar ra-show__bar--inline">
              <div :style="{ width: completion.barWidth }" />
            </div>
          </div>
          <p v-else-if="progress" class="ra-show__muted">Sin set de logros</p>
        </div>
      </div>
      <button
        v-if="progress"
        type="button"
        class="ra-show__refresh"
        :disabled="loading"
        @click="emit('refresh')"
      >
        {{ loading ? "Actualizando…" : "Actualizar" }}
      </button>
    </header>

    <div
      v-if="loading && !progress"
      class="ra-show__skel"
      aria-hidden="true"
    >
      <div v-for="n in 4" :key="n" class="ra-show__skel-item">
        <div class="ra-show__skel-badge" />
        <div class="ra-show__skel-lines">
          <div class="ra-show__skel-line" />
          <div class="ra-show__skel-line ra-show__skel-line--short" />
        </div>
      </div>
    </div>
    <p v-else-if="error && !progress" class="ra-show__warn">{{ error }}</p>
    <p v-else-if="!progress" class="ra-show__muted">
      Todavía no hay progreso de logros para este juego.
    </p>

    <template v-else>
      <div v-if="featured" class="ra-show__featured">
        <img
          v-if="badgeSrc(featured)"
          :src="badgeSrc(featured)!"
          :alt="featured.title"
          class="ra-show__badge"
          :class="{ 'ra-show__badge--lock': !featured.unlocked }"
        />
        <div class="ra-show__featured-text">
          <p class="ra-show__featured-title">{{ featured.title }}</p>
          <p class="ra-show__featured-desc">{{ featured.description }}</p>
        </div>
      </div>

      <template v-if="unlockedPreview.length">
        <div class="ra-show__row">
          <img
            v-for="ach in unlockedPreview"
            :key="ach.id"
            :src="badgeSrc(ach) || undefined"
            :alt="ach.title"
            :title="ach.title"
            class="ra-show__icon"
          />
          <span v-if="unlockedExtra > 0" class="ra-show__more">+{{ unlockedExtra }}</span>
        </div>
      </template>

      <template v-if="lockedPreview.length">
        <h3 class="ra-show__sub">Logros bloqueados</h3>
        <div class="ra-show__row">
          <img
            v-for="ach in lockedPreview"
            :key="ach.id"
            :src="badgeSrc(ach) || undefined"
            :alt="ach.title"
            :title="ach.title"
            class="ra-show__icon ra-show__icon--lock"
          />
          <span v-if="lockedExtra > 0" class="ra-show__more">+{{ lockedExtra }}</span>
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.ra-show {
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.28);
  padding: 16px 18px 18px;
}

.ra-show__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.ra-show__title-block {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.ra-show__medal {
  width: 36px;
  height: 36px;
  color: #c7d5e0;
}

.ra-show__title-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.ra-show__title-text h2 {
  margin: 0;
  color: #8f98a0;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.06em;
}

.ra-show__progress-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 160px;
}

.ra-show__count {
  color: #c7d5e0;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
}

.ra-show__refresh {
  border: 0;
  background: transparent;
  color: #66c0f4;
  font-size: 12px;
  cursor: pointer;
}

.ra-show__refresh:disabled {
  opacity: 0.5;
  cursor: default;
}

.ra-show__muted {
  margin: 0;
  color: #8f98a0;
  font-size: 13px;
}

.ra-show__skel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ra-show__skel-item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ra-show__skel-badge {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 2px;
  background: linear-gradient(110deg, #171a21 0%, #2a475e 45%, #171a21 90%);
  background-size: 200% 100%;
  animation: ra-skel-shimmer 1.25s ease-in-out infinite;
}

.ra-show__skel-lines {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
}

.ra-show__skel-line {
  height: 10px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.08);
  animation: ra-skel-pulse 1.25s ease-in-out infinite;
}

.ra-show__skel-line--short {
  width: 50%;
}

@keyframes ra-skel-shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}

@keyframes ra-skel-pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}

.ra-show__warn {
  margin: 0;
  color: #fde68a;
  font-size: 13px;
}

.ra-show__bar {
  height: 10px;
  margin-bottom: 14px;
  overflow: hidden;
  border-radius: 2px;
  background: #0e141b;
}

.ra-show__bar--inline {
  flex: 1;
  height: 4px;
  margin: 0;
  min-width: 64px;
}

.ra-show__bar > div {
  height: 100%;
  background: #66c0f4;
  transition: width 0.25s ease;
}

.ra-show__featured {
  display: flex;
  gap: 12px;
  margin-bottom: 14px;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.ra-show__badge {
  width: 64px;
  height: 64px;
  flex-shrink: 0;
  border-radius: 4px;
  border: 2px solid #c9a227;
  object-fit: cover;
  background: #171a21;
}

.ra-show__badge--lock {
  border-color: rgba(255, 255, 255, 0.15);
  filter: grayscale(0.85) brightness(0.75);
}

.ra-show__featured-title {
  margin: 0 0 4px;
  color: #fff;
  font-size: 15px;
  font-weight: 500;
}

.ra-show__featured-desc {
  margin: 0;
  color: #8f98a0;
  font-size: 12px;
  line-height: 1.4;
}

.ra-show__sub {
  margin: 12px 0 8px;
  color: #8f98a0;
  font-size: 12px;
  font-weight: 500;
}

.ra-show__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.ra-show__icon {
  width: 48px;
  height: 48px;
  border-radius: 3px;
  object-fit: cover;
  background: #171a21;
}

.ra-show__icon--lock {
  filter: grayscale(1) brightness(0.65);
}

.ra-show__more {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.45);
  color: #c7d5e0;
  font-size: 12px;
  font-weight: 600;
}
</style>
