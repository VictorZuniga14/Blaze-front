<script setup lang="ts">
/** Placeholder tipo Steam: banner + barra de acción + bloque de texto. */
</script>

<template>
  <div class="dskel" aria-hidden="true">
    <div class="dskel__hero" />
    <div class="dskel__bar">
      <div class="dskel__btn" />
      <div class="dskel__chip" />
    </div>
    <div class="dskel__body">
      <div class="dskel__line" />
      <div class="dskel__line" />
      <div class="dskel__line dskel__line--short" />
    </div>
  </div>
</template>

<style scoped>
.dskel {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.dskel__hero {
  width: 100%;
  min-height: 220px;
  aspect-ratio: 2.55 / 1;
  max-height: 360px;
  background: linear-gradient(
    110deg,
    #171a21 0%,
    #2a475e 42%,
    #171a21 88%
  );
  background-size: 200% 100%;
  animation: dskel-shimmer 1.25s ease-in-out infinite;
}

.dskel__bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 28px;
  background: #1b2838;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.dskel__btn {
  width: 160px;
  height: 40px;
  border-radius: 3px;
  background: rgba(102, 192, 244, 0.22);
  animation: dskel-pulse 1.25s ease-in-out infinite;
}

.dskel__chip {
  width: 72px;
  height: 14px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.1);
  animation: dskel-pulse 1.25s ease-in-out infinite;
}

.dskel__body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 20px 28px 28px;
  max-width: 720px;
}

.dskel__line {
  height: 12px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.08);
  animation: dskel-pulse 1.25s ease-in-out infinite;
}

.dskel__line--short {
  width: 45%;
}

@keyframes dskel-shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}

@keyframes dskel-pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}
</style>
