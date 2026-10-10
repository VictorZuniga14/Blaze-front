<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterView, useRoute, useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { useAuthStore } from "../stores/auth";
import { useLibraryStore } from "../stores/library";
import { useCatalogCoversStore } from "../stores/catalogCovers";
import { usePlayHistoryStore } from "../stores/playHistory";
import { useRaProgressStore } from "../stores/raProgress";
import type { Game } from "../types/game";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const library = useLibraryStore();
const catalogCovers = useCatalogCoversStore();
const raProgress = useRaProgressStore();
const playHistory = usePlayHistoryStore();

const { isDev } = storeToRefs(auth);
const { loading, search, games, selectedGameId } = storeToRefs(library);

const myGamesOpen = ref(true);
const brokenSidebarCovers = ref(new Set<string>());

const sidebarGames = computed(() =>
  games.value
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title, "es", { sensitivity: "base" })),
);

const showingDetail = computed(() => route.name === "game-detail");

function coverOf(game: Game): string | null {
  if (brokenSidebarCovers.value.has(game.id)) return null;
  return catalogCovers.coverForGame(game);
}

function onSidebarCoverError(gameId: string): void {
  const next = new Set(brokenSidebarCovers.value);
  next.add(gameId);
  brokenSidebarCovers.value = next;
}

function openGame(id: string) {
  library.selectGame(id);
  void router.push(`/games/${id}`);
}

function goNew() {
  void router.push("/games/new");
}

watch(
  () => [route.name, route.params.id] as const,
  ([name, id]) => {
    if (name === "game-detail" && typeof id === "string" && id) {
      library.selectGame(id);
      return;
    }
    if (name === "library") {
      library.selectGame(null);
    }
  },
  { immediate: true },
);

watch(
  () => catalogCovers.byCatalogId,
  () => {
    brokenSidebarCovers.value = new Set();
  },
);

onMounted(() => {
  void (async () => {
    // loadLibrary ya refresca portadas del catálogo en paralelo al sync.
    await library.loadLibrary();
    void raProgress.hydrateLibraryCache(
      library.games.map((game) => ({
        id: game.id,
        raGameId: game.retroAchievementsGameId,
      })),
    );
    void playHistory.ensureLoaded();
  })();
});
</script>

<template>
  <div class="library">
    <aside class="library-side">
      <div class="library-side__tools">
        <input
          v-model="search"
          type="search"
          placeholder="Buscar..."
          class="library-side__search"
        />
        <button
          v-if="isDev"
          type="button"
          class="library-side__add"
          title="Agregar juego"
          @click="goNew"
        >
          +
        </button>
      </div>

      <button
        type="button"
        class="library-side__section"
        @click="myGamesOpen = !myGamesOpen"
      >
        {{ myGamesOpen ? "—" : "+" }} MIS JUEGOS
        <span>({{ games.length }})</span>
      </button>

      <ul v-if="myGamesOpen" class="library-side__list">
        <template v-if="loading && sidebarGames.length === 0">
          <li
            v-for="n in 4"
            :key="`skel-${n}`"
            class="library-side__skel"
            aria-hidden="true"
          >
            <span class="library-side__skel-icon" />
            <span class="library-side__skel-line" />
          </li>
        </template>
        <li
          v-else-if="!loading && sidebarGames.length === 0"
          class="library-side__empty"
        >
          Sin juegos
        </li>
        <li v-for="game in sidebarGames" :key="game.id">
          <button
            type="button"
            class="library-side__item"
            :class="{
              'library-side__item--active': selectedGameId === game.id,
              'library-side__item--fav': game.isFavorite,
            }"
            @click="openGame(game.id)"
          >
            <img
              v-if="coverOf(game)"
              class="library-side__icon"
              :src="coverOf(game)!"
              alt=""
              @error="onSidebarCoverError(game.id)"
            />
            <span v-else class="library-side__icon library-side__icon--empty">
              {{ game.title.charAt(0).toUpperCase() }}
            </span>
            <span class="library-side__title">{{ game.title }}</span>
          </button>
        </li>
      </ul>

      <div v-if="isDev" class="library-side__footer">
        <button type="button" @click="router.push('/dev')">Desarrollador</button>
        <button type="button" @click="router.push('/settings')">Configuración</button>
        <button type="button" @click="router.push('/runtimes')">Runtimes</button>
      </div>
    </aside>

    <main class="library-main" :class="{ 'library-main--detail': showingDetail }">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.library {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  min-height: calc(100vh - 80px);
  background: #1b2838;
}

.library-side {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid rgba(0, 0, 0, 0.45);
  background: #171a21;
}

.library-side__tools {
  display: flex;
  gap: 6px;
  padding: 10px 10px 8px;
}

.library-side__search {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid #000;
  border-radius: 2px;
  background: #316282;
  color: #fff;
  font-size: 12px;
  outline: none;
}

.library-side__search::placeholder {
  color: rgba(255, 255, 255, 0.55);
}

.library-side__add {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 2px;
  background: #66c0f4;
  color: #171a21;
  font-size: 18px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
}

.library-side__section {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 12px;
  border: 0;
  background: transparent;
  color: #8f98a0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-align: left;
  cursor: pointer;
}

.library-side__section span {
  color: #62707c;
  font-weight: 500;
}

.library-side__section:hover {
  color: #c6d4df;
}

.library-side__list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 0 0 8px;
  overflow: auto;
  list-style: none;
}

.library-side__empty {
  padding: 12px;
  color: #8f98a0;
  font-size: 13px;
}

.library-side__skel {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 12px 5px 14px;
}

.library-side__skel-icon {
  width: 28px;
  height: 38px;
  flex-shrink: 0;
  border-radius: 2px;
  background: linear-gradient(110deg, #1b2838 0%, #2a475e 45%, #1b2838 90%);
  background-size: 200% 100%;
  animation: library-skel 1.25s ease-in-out infinite;
}

.library-side__skel-line {
  height: 10px;
  flex: 1;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.08);
  animation: library-skel-pulse 1.25s ease-in-out infinite;
}

@keyframes library-skel {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}

@keyframes library-skel-pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 1;
  }
}

.library-side__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 5px 12px 5px 14px;
  border: 0;
  background: transparent;
  color: #8f98a0;
  text-align: left;
  cursor: pointer;
}

.library-side__item:hover {
  background: rgba(255, 255, 255, 0.04);
  color: #c7d5e0;
}

.library-side__item--active,
.library-side__item--fav {
  color: #fff;
}

.library-side__item--active {
  background: rgba(102, 192, 244, 0.12);
}

.library-side__icon {
  width: 28px;
  height: 38px;
  border-radius: 2px;
  object-fit: cover;
  object-position: top center;
  background: #2a475e;
  flex-shrink: 0;
}

.library-side__icon--empty {
  display: grid;
  place-items: center;
  color: #c7d5e0;
  font-size: 11px;
  font-weight: 700;
}

.library-side__title {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.library-side__footer {
  display: flex;
  gap: 8px;
  padding: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.library-side__footer button {
  flex: 1;
  height: 28px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  background: transparent;
  color: #c7d5e0;
  font-size: 11px;
  cursor: pointer;
}

.library-side__footer button:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
}

.library-main {
  min-width: 0;
  padding: 16px 18px 28px;
  overflow: auto;
  background: linear-gradient(180deg, #2a475e 0%, #1b2838 180px, #1b2838 100%);
}

.library-main--detail {
  padding: 0;
  background: #1b2838;
}

@media (max-width: 900px) {
  .library {
    grid-template-columns: 1fr;
  }

  .library-side {
    max-height: 280px;
    border-right: 0;
    border-bottom: 1px solid rgba(0, 0, 0, 0.45);
  }
}
</style>
