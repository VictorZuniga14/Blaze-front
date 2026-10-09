<script setup lang="ts">
defineProps<{
  label?: string;
  compact?: boolean;
}>();
</script>

<template>
  <div
    class="blaze-loader"
    :class="{ 'blaze-loader--compact': compact }"
    role="status"
    aria-live="polite"
  >
    <div class="blaze-loader__mark" aria-hidden="true">
      <div class="blaze-loader__ring" />
      <div class="blaze-loader__logo">
        <div class="blaze-loader__half blaze-loader__half--cyan">
          <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
            <g transform="translate(43.4 80.9) rotate(-52)">
              <circle cx="0" cy="0" r="13.5" fill="#20C8D8" />
              <path
                d="M 24.5 14.1 A 28.2 28.2 0 1 1 24.5 -14.1"
                fill="none"
                stroke="#20C8D8"
                stroke-width="18"
                stroke-linecap="round"
              />
            </g>
          </svg>
        </div>
        <div class="blaze-loader__half blaze-loader__half--yellow">
          <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
            <g transform="translate(76.4 38.9) rotate(-52)">
              <circle cx="0" cy="0" r="13.5" fill="#F8C030" />
              <path
                d="M -24.5 -14.1 A 28.2 28.2 0 1 1 -24.5 14.1"
                fill="none"
                stroke="#F8C030"
                stroke-width="18"
                stroke-linecap="round"
              />
            </g>
          </svg>
        </div>
      </div>
    </div>

    <p v-if="label" class="blaze-loader__label">{{ label }}</p>
  </div>
</template>

<style scoped>
.blaze-loader {
  display: flex;
  min-height: 100vh;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.1rem;
  background: radial-gradient(ellipse at top, #1a2332 0%, #0b0f14 55%);
  color: #94a3b8;
}

.blaze-loader--compact {
  min-height: 0;
  gap: 0.9rem;
  background: transparent;
  padding: 1rem;
}

.blaze-loader__mark {
  position: relative;
  width: 4.25rem;
  height: 4.25rem;
}

.blaze-loader__ring {
  position: absolute;
  inset: -22%;
  border-radius: 9999px;
  border: 3px solid rgba(148, 163, 184, 0.15);
  border-top-color: #20c8d8;
  border-right-color: rgba(248, 192, 48, 0.55);
  animation: blaze-spin 0.85s linear infinite;
}

.blaze-loader__logo {
  position: relative;
  width: 100%;
  height: 100%;
  filter: drop-shadow(0 0 14px rgba(32, 200, 216, 0.25));
}

.blaze-loader__half {
  position: absolute;
  inset: 0;
  will-change: transform;
}

.blaze-loader__half svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

/* Cada mitad gira sobre SU PROPIO centro (el del círculo del SVG) */
.blaze-loader__half--cyan {
  --dx: -6%;
  --dy: 7.5%;
  transform-origin: 36.17% 67.42%;
  animation: blaze-split-cw 1.9s infinite;
}

.blaze-loader__half--yellow {
  --dx: 6%;
  --dy: -7.5%;
  transform-origin: 63.67% 32.42%;
  animation: blaze-split-ccw 1.9s infinite;
}

.blaze-loader__label {
  margin: 0;
  font-size: 0.72rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #7dd3e8;
  opacity: 0.85;
}

@keyframes blaze-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 0-16%: se separan | 16-66%: giran | 66-84%: se unen | 84-100%: pausa */
@keyframes blaze-split-cw {
  0% {
    transform: translate(0, 0) rotate(0deg) scale(1);
    animation-timing-function: cubic-bezier(0.25, 0.8, 0.3, 1);
  }
  16% {
    transform: translate(var(--dx), var(--dy)) rotate(0deg) scale(0.94);
    animation-timing-function: cubic-bezier(0.55, 0.05, 0.35, 1);
  }
  66% {
    transform: translate(var(--dx), var(--dy)) rotate(360deg) scale(0.94);
    animation-timing-function: cubic-bezier(0.5, 0, 0.2, 1);
  }
  84%,
  100% {
    transform: translate(0, 0) rotate(360deg) scale(1);
  }
}

@keyframes blaze-split-ccw {
  0% {
    transform: translate(0, 0) rotate(0deg) scale(1);
    animation-timing-function: cubic-bezier(0.25, 0.8, 0.3, 1);
  }
  16% {
    transform: translate(var(--dx), var(--dy)) rotate(0deg) scale(0.94);
    animation-timing-function: cubic-bezier(0.55, 0.05, 0.35, 1);
  }
  66% {
    transform: translate(var(--dx), var(--dy)) rotate(-360deg) scale(0.94);
    animation-timing-function: cubic-bezier(0.5, 0, 0.2, 1);
  }
  84%,
  100% {
    transform: translate(0, 0) rotate(-360deg) scale(1);
  }
}

/* Con "reducir animaciones" activo: más lento, pero sigue girando */
@media (prefers-reduced-motion: reduce) {
  .blaze-loader__half--cyan,
  .blaze-loader__half--yellow {
    animation-duration: 3.8s;
  }
  .blaze-loader__ring {
    animation-duration: 2s;
  }
}
</style>
