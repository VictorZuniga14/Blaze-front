<script setup lang="ts">
withDefaults(
  defineProps<{
    /** Cantidad de placeholders. */
    count?: number;
  }>(),
  { count: 4 },
);
</script>

<template>
  <div class="skel-grid" aria-hidden="true">
    <div v-for="n in count" :key="n" class="skel-card">
      <div class="skel-card__cover" />
      <div class="skel-card__meta">
        <div class="skel-card__line" />
        <div class="skel-card__line skel-card__line--short" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.skel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 14px;
}

.skel-card {
  overflow: hidden;
  border-radius: 6px;
  background: rgba(23, 26, 33, 0.85);
}

.skel-card__cover {
  aspect-ratio: 3 / 4;
  background: linear-gradient(
    110deg,
    #1b2838 0%,
    #2a475e 45%,
    #1b2838 90%
  );
  background-size: 200% 100%;
  animation: skel-shimmer 1.25s ease-in-out infinite;
}

.skel-card__meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 8px 10px;
  background: rgba(15, 18, 24, 0.7);
}

.skel-card__line {
  height: 8px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.08);
  animation: skel-pulse 1.25s ease-in-out infinite;
}

.skel-card__line--short {
  width: 55%;
}

@keyframes skel-shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}

@keyframes skel-pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}
</style>
