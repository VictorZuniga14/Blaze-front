<script setup lang="ts">
import { computed } from "vue";
import type { Game } from "../types/game";
import { useCatalogCoversStore } from "../stores/catalogCovers";
import { usePlayHistoryStore } from "../stores/playHistory";
import { useRaProgressStore } from "../stores/raProgress";
import { playCardModel } from "../utils/playStats";

const props = withDefaults(
  defineProps<{
    game: Game;
    /** Solo portada, estilo grilla Steam. */
    coverOnly?: boolean;
  }>(),
  { coverOnly: false },
);

const emit = defineEmits<{
  open: [];
  toggleFavorite: [];
}>();

const ra = useRaProgressStore();
const playHistory = usePlayHistoryStore();
const catalogCovers = useCatalogCoversStore();
const coverSrc = computed(() => catalogCovers.coverForGame(props.game));
const raModel = computed(() =>
  ra.cardModel(props.game.id, props.game.retroAchievementsGameId),
);
const playModel = computed(() => playCardModel(playHistory.statsFor(props.game.id)));
</script>

<template>
  <article
    class="group flex cursor-pointer flex-col overflow-hidden transition"
    :class="
      coverOnly
        ? 'rounded-md bg-slate-900/70 hover:brightness-110'
        : 'rounded-xl border border-white/10 bg-slate-900/70 hover:border-sky-400/40 hover:bg-slate-900'
    "
    :title="game.title"
    @click="emit('open')"
  >
    <div
      class="relative flex aspect-[3/4] items-center justify-center bg-gradient-to-b from-slate-800 to-slate-950"
    >
      <img
        v-if="coverSrc"
        :src="coverSrc"
        :alt="game.title"
        class="absolute inset-0 h-full w-full object-cover object-top"
        @error="($event.target as HTMLImageElement).style.display = 'none'"
      />
      <span
        v-if="!coverSrc"
        class="px-3 text-center text-xs font-medium uppercase tracking-wider text-slate-500"
      >
        {{ game.title }}
      </span>
      <span
        v-if="game.status === 'draft'"
        class="absolute left-2 top-2 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-950"
      >
        Borrador
      </span>
      <button
        v-if="!coverOnly"
        type="button"
        class="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-1 text-sm text-amber-300 backdrop-blur transition hover:bg-black/70"
        :aria-label="game.isFavorite ? 'Quitar de favoritos' : 'Marcar favorito'"
        @click.stop="emit('toggleFavorite')"
      >
        {{ game.isFavorite ? "★" : "☆" }}
      </button>
    </div>
    <div class="border-t border-white/5 bg-slate-950/70 px-2 py-1.5">
      <template v-if="playModel.kind === 'played'">
        <p class="text-[10px] leading-tight text-slate-400">
          Último juego: {{ playModel.lastPlayedLabel }}
        </p>
        <p class="mt-0.5 text-[11px] leading-none text-slate-100">
          ⏱ {{ playModel.playtimeLabel }}
        </p>
      </template>
      <p v-else class="text-[10px] leading-none text-slate-500">Nunca jugado</p>
    </div>
    <div
      v-if="raModel.kind !== 'hidden'"
      class="border-t border-white/5 bg-slate-950/80 px-2 py-1.5"
    >
      <template v-if="raModel.kind === 'progress'">
        <div class="flex items-center justify-between gap-1 text-[11px] leading-none text-slate-100">
          <span>🏆 {{ raModel.unlocked }} / {{ raModel.total }}</span>
          <span>{{ raModel.percentLabel }}</span>
        </div>
        <div class="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
          <div
            class="h-full rounded-full"
            :class="raModel.percent >= 100 ? 'bg-emerald-400' : 'bg-sky-400'"
            :style="{ width: raModel.barWidth }"
          />
        </div>
      </template>
      <p
        v-else-if="raModel.kind === 'no_achievements'"
        class="text-[11px] leading-none text-slate-400"
        title="Vinculado a RA, pero este juego no tiene set de logros"
      >
        Sin logros para mostrar
      </p>
      <p v-else class="text-[11px] leading-none text-slate-500" title="Progreso no disponible">
        Sin datos
      </p>
    </div>
    <div v-if="!coverOnly" class="flex flex-1 flex-col gap-1 p-3">
      <h3 class="line-clamp-2 text-sm font-semibold text-white">
        {{ game.title }}
      </h3>
      <p class="text-xs text-slate-400">
        <span v-if="game.platform">{{ game.platform }}</span>
        <span v-if="game.platform && game.genre"> · </span>
        <span v-if="game.genre">{{ game.genre }}</span>
        <span v-if="!game.platform && !game.genre">Sin metadata</span>
      </p>
    </div>
  </article>
</template>
