<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import GameCard from "../components/GameCard.vue";
import GameCardSkeleton from "../components/GameCardSkeleton.vue";
import { useAuthStore } from "../stores/auth";
import { useLibraryStore } from "../stores/library";
import { usePlayHistoryStore } from "../stores/playHistory";
import type { Game, GameSort } from "../types/game";

const router = useRouter();
const auth = useAuthStore();
const library = useLibraryStore();
const playHistory = usePlayHistoryStore();
const { isDev } = storeToRefs(auth);
const { stats: playStats } = storeToRefs(playHistory);

const { filteredGames, loading, error, sort, favoritesOnly, games } =
  storeToRefs(library);

const recentRow = ref<HTMLElement | null>(null);
const canScrollLeft = ref(false);
const canScrollRight = ref(false);

const sortOptions: { value: GameSort; label: string }[] = [
  { value: "title-asc", label: "Alfabéticamente" },
  { value: "title-desc", label: "Alfabéticamente Z-A" },
  { value: "newest", label: "Más recientes" },
  { value: "oldest", label: "Más antiguos" },
  { value: "favorites-first", label: "Favoritos primero" },
];

const recentGames = computed(() =>
  games.value
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8),
);

const lastPlayedGames = computed(() => {
  const recent = playStats.value?.recent ?? [];
  return recent
    .map((item) => games.value.find((game) => game.id === item.gameId))
    .filter((game): game is Game => game != null);
});

function updateRecentScroll() {
  const el = recentRow.value;
  if (!el) {
    canScrollLeft.value = false;
    canScrollRight.value = false;
    return;
  }
  canScrollLeft.value = el.scrollLeft > 2;
  canScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
}

function scrollRecent(dir: -1 | 1) {
  const el = recentRow.value;
  if (!el) return;
  el.scrollBy({
    left: dir * Math.max(240, el.clientWidth * 0.7),
    behavior: "smooth",
  });
}

watch(recentGames, async () => {
  await nextTick();
  updateRecentScroll();
});

onMounted(() => {
  if (sort.value === "newest") {
    sort.value = "title-asc";
  }
  void nextTick(() => updateRecentScroll());
});

function openGame(id: string) {
  library.selectGame(id);
  void router.push(`/games/${id}`);
}

function goNew() {
  void router.push("/games/new");
}
</script>

<template>
  <div class="home">
    <p v-if="error" class="home-error">{{ error }}</p>

    <div v-if="!loading && games.length === 0" class="home-empty">
      <h2>Tu biblioteca está vacía</h2>
      <p v-if="isDev">Agregá un juego o publicá uno desde el panel Dev.</p>
      <p v-else>Andá a Juegos y agregá títulos del catálogo a tu biblioteca.</p>
      <button
        v-if="isDev"
        type="button"
        class="home-btn"
        @click="goNew"
      >
        + Agregar juego
      </button>
      <button
        v-else
        type="button"
        class="home-btn"
        @click="router.push('/juegos')"
      >
        Ir a Juegos
      </button>
    </div>

    <template v-else>
      <section v-if="lastPlayedGames.length" class="home-recent">
        <header class="home-head">
          <h2>Últimos jugados</h2>
        </header>
        <div class="home-recent__row">
          <GameCard
            v-for="game in lastPlayedGames"
            :key="`played-${game.id}`"
            :game="game"
            cover-only
            class="home-recent__card"
            @open="openGame(game.id)"
            @toggle-favorite="library.toggleFavorite(game.id)"
          />
        </div>
      </section>

      <section v-if="recentGames.length" class="home-recent">
        <header class="home-head home-head--row">
          <h2>Juegos recientes</h2>
          <div class="home-recent__nav">
            <button
              type="button"
              class="home-recent__arrow"
              :disabled="!canScrollLeft"
              aria-label="Anterior"
              @click="scrollRecent(-1)"
            >
              ‹
            </button>
            <button
              type="button"
              class="home-recent__arrow"
              :disabled="!canScrollRight"
              aria-label="Siguiente"
              @click="scrollRecent(1)"
            >
              ›
            </button>
          </div>
        </header>
        <div
          ref="recentRow"
          class="home-recent__row"
          @scroll="updateRecentScroll"
        >
          <GameCard
            v-for="game in recentGames"
            :key="`recent-${game.id}`"
            :game="game"
            cover-only
            class="home-recent__card"
            @open="openGame(game.id)"
            @toggle-favorite="library.toggleFavorite(game.id)"
          />
        </div>
      </section>

      <section class="home-all">
        <header class="home-head home-head--row">
          <h2>
            Todos los juegos
            <span>({{ filteredGames.length }})</span>
          </h2>
          <div class="home-toolbar">
            <label class="home-toolbar__fav">
              <input v-model="favoritesOnly" type="checkbox" />
              Solo favoritos
            </label>
            <span class="home-toolbar__label">ORDENAR POR</span>
            <select v-model="sort" class="home-toolbar__select">
              <option
                v-for="option in sortOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </div>
        </header>

        <GameCardSkeleton v-if="loading && games.length === 0" :count="6" />
        <div
          v-else-if="!loading && filteredGames.length === 0"
          class="home-muted"
        >
          No hay juegos que coincidan con tu búsqueda o filtros.
        </div>
        <div v-else class="home-grid">
          <GameCard
            v-for="game in filteredGames"
            :key="game.id"
            :game="game"
            cover-only
            @open="openGame(game.id)"
            @toggle-favorite="library.toggleFavorite(game.id)"
          />
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.home-error {
  margin: 0 0 14px;
  padding: 10px 12px;
  border: 1px solid rgba(244, 63, 94, 0.35);
  background: rgba(244, 63, 94, 0.12);
  color: #fecdd3;
  font-size: 13px;
}

.home-empty {
  display: grid;
  place-items: center;
  gap: 8px;
  min-height: 50vh;
  color: #c7d5e0;
  text-align: center;
}

.home-empty h2 {
  margin: 0;
  color: #fff;
  font-size: 24px;
}

.home-empty p {
  margin: 0 0 8px;
  color: #8f98a0;
}

.home-btn {
  height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 2px;
  background: #66c0f4;
  color: #171a21;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.home-head {
  margin-bottom: 12px;
}

.home-head h2 {
  margin: 0;
  color: #fff;
  font-size: 15px;
  font-weight: 500;
}

.home-head h2 span {
  color: #8f98a0;
  font-weight: 400;
}

.home-head--row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.home-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.home-toolbar__label {
  color: #8f98a0;
  font-size: 11px;
  letter-spacing: 0.04em;
}

.home-toolbar__select {
  height: 28px;
  padding: 0 8px;
  border: 1px solid rgba(0, 0, 0, 0.4);
  border-radius: 2px;
  background: #1b2838;
  color: #e8eef7;
  font-size: 12px;
  color-scheme: light;
}

.home-toolbar__select option {
  background: #ffffff;
  color: #111827;
}

.home-toolbar__fav {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #8f98a0;
  font-size: 12px;
}

.home-recent {
  margin-bottom: 22px;
}

.home-recent__nav {
  display: flex;
  align-items: center;
  gap: 2px;
}

.home-recent__arrow {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 2px;
  background: transparent;
  color: #c7d5e0;
  font-size: 26px;
  line-height: 1;
  cursor: pointer;
}

.home-recent__arrow:hover:not(:disabled) {
  color: #fff;
  background: rgba(255, 255, 255, 0.06);
}

.home-recent__arrow:disabled {
  color: #4b5563;
  cursor: default;
}

.home-recent__row {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 120px;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 2px;
  scrollbar-width: none;
}

.home-recent__row::-webkit-scrollbar {
  display: none;
}

.home-recent__card {
  width: 120px;
}

.home-all {
  margin-top: 4px;
}

.home-muted {
  padding: 12px 0;
  color: #8f98a0;
  font-size: 13px;
}

.home-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 1200px) {
  .home-grid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .home-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
