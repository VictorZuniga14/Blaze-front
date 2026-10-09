<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { useAuthStore } from "../stores/auth";
import { useLibraryStore } from "../stores/library";
import { useCatalogCoversStore } from "../stores/catalogCovers";
import { catalogApiService } from "../services/catalogApi.service";
import { formatBytes } from "../services/catalogTransfer.service";
import { ApiError } from "../services/api.client";
import type { CatalogGame } from "../types/catalog";
import bannerJuegosAntiguos from "../assets/banner_juegos_antiguos_3840x1240.png";

type CatalogSort = "title-asc" | "title-desc" | "newest";

const router = useRouter();
const auth = useAuthStore();
const library = useLibraryStore();
const catalogCovers = useCatalogCoversStore();
const { isAuthenticated } = storeToRefs(auth);

const games = ref<CatalogGame[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const sort = ref<CatalogSort>("title-asc");
/** Ids cuya portada falló al cargar (mostrar título). */
const brokenCoverIds = ref<Set<string>>(new Set());

const libraryCatalogIds = computed(() => {
  const ids = new Set<string>();
  for (const g of library.games) {
    if (g.catalogRemoteId) ids.add(g.catalogRemoteId);
  }
  return ids;
});

function isInLibrary(catalogId: string): boolean {
  return libraryCatalogIds.value.has(catalogId);
}

function coverSrc(game: CatalogGame): string | null {
  if (!game.coverUrl || brokenCoverIds.value.has(game.id)) return null;
  return game.coverUrl;
}

function onCoverError(gameId: string): void {
  const next = new Set(brokenCoverIds.value);
  next.add(gameId);
  brokenCoverIds.value = next;
}

const sortOptions: { value: CatalogSort; label: string }[] = [
  { value: "title-asc", label: "Alfabéticamente" },
  { value: "title-desc", label: "Alfabéticamente Z-A" },
  { value: "newest", label: "Más recientes" },
];

const sortedGames = computed(() => {
  const list = games.value.slice();
  if (sort.value === "newest") {
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const dir = sort.value === "title-desc" ? -1 : 1;
  return list.sort(
    (a, b) =>
      dir * a.title.localeCompare(b.title, "es", { sensitivity: "base" }),
  );
});

function userFacing(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.message) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

async function load(): Promise<void> {
  if (!isAuthenticated.value) {
    games.value = [];
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    games.value = await catalogApiService.list();
    catalogCovers.ingest(games.value);
    brokenCoverIds.value = new Set();
  } catch (err) {
    error.value = userFacing(err, "No se pudo cargar el catálogo.");
    games.value = [];
  } finally {
    loading.value = false;
  }
}

function openCatalogGame(game: CatalogGame): void {
  void router.push(`/juegos/${game.id}`);
}

onMounted(() => {
  void load();
  if (isAuthenticated.value) void library.loadLibrary();
});
</script>

<template>
  <main class="catalog">
    <section class="catalog-hero" aria-label="Juegos antiguos">
      <img
        :src="bannerJuegosAntiguos"
        alt="Juegos antiguos — PS1, PS2 y clásicos de siempre"
        class="catalog-hero__img"
        width="3840"
        height="1240"
      />
    </section>

    <div class="catalog-body">
      <header class="catalog-head catalog-head--row">
        <h1>
          Juegos disponibles
          <span v-if="isAuthenticated && !loading">({{ sortedGames.length }})</span>
        </h1>
        <div v-if="isAuthenticated && sortedGames.length > 0" class="catalog-toolbar">
          <span class="catalog-toolbar__label">ORDENAR POR</span>
          <select v-model="sort" class="catalog-toolbar__select">
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

      <p class="catalog-sub">
        Agregá a tu biblioteca.
      </p>

      <p v-if="!isAuthenticated" class="catalog-banner catalog-banner--warn">
        Iniciá sesión para ver el catálogo y agregar juegos a tu biblioteca.
      </p>

      <p v-else-if="error" class="catalog-banner catalog-banner--error">
        {{ error }}
      </p>

      <p v-if="loading" class="catalog-muted">Cargando catálogo…</p>

      <section
        v-else-if="isAuthenticated && !loading && sortedGames.length === 0"
        class="catalog-empty"
      >
        <h2>Todavía no hay juegos publicados</h2>
        <p>
          Desde el detalle de un juego de tu biblioteca, usá “Publicar en catálogo”.
        </p>
      </section>

      <div v-else-if="sortedGames.length > 0" class="catalog-grid">
        <button
          v-for="game in sortedGames"
          :key="game.id"
          type="button"
          class="catalog-card"
          :title="game.title"
          @click="openCatalogGame(game)"
        >
          <div class="catalog-card__cover">
            <img
              v-if="coverSrc(game)"
              :src="coverSrc(game)!"
              :alt="game.title"
              class="catalog-card__img"
              @error="onCoverError(game.id)"
            />
            <span v-else class="catalog-card__title">{{ game.title }}</span>
            <span v-if="game.platform" class="catalog-card__platform">
              {{ game.platform }}
            </span>
            <span
              v-if="isInLibrary(game.id)"
              class="catalog-card__badge"
            >
              En biblioteca
            </span>
          </div>
          <div class="catalog-card__meta">
            <p class="catalog-card__name">{{ game.title }}</p>
            <p class="catalog-card__by">
              {{ game.publisherUsername }} ·
              {{ formatBytes(Number(game.fileSizeBytes)) }}
            </p>
          </div>
        </button>
      </div>
    </div>
  </main>
</template>

<style scoped>
.catalog {
  min-height: 100%;
  padding: 0 0 28px;
  background: #1b2838;
}

.catalog-hero {
  width: 100%;
  /* Misma altura; a todo el ancho; cover solo recorta costados */
  aspect-ratio: 2.55 / 1;
  min-height: 300px;
  max-height: 480px;
  overflow: hidden;
  background: #12081c;
}

.catalog-hero__img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center center;
}

.catalog-body {
  box-sizing: border-box;
  width: 100%;
  max-width: 1120px;
  margin-inline: auto;
  padding: 16px 28px 0;
}

.catalog-head {
  margin-bottom: 6px;
}

.catalog-head h1 {
  margin: 0;
  color: #fff;
  font-size: 15px;
  font-weight: 500;
}

.catalog-head h1 span {
  color: #8f98a0;
  font-weight: 400;
}

.catalog-head--row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.catalog-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.catalog-toolbar__label {
  color: #8f98a0;
  font-size: 11px;
  letter-spacing: 0.04em;
}

.catalog-toolbar__select {
  height: 28px;
  padding: 0 8px;
  border: 1px solid rgba(0, 0, 0, 0.4);
  border-radius: 2px;
  background: #1b2838;
  color: #e8eef7;
  font-size: 12px;
  color-scheme: light;
}

.catalog-toolbar__select option {
  background: #ffffff;
  color: #111827;
}

.catalog-sub {
  margin: 0 0 16px;
  color: #8f98a0;
  font-size: 13px;
}

.catalog-banner {
  margin: 0 0 14px;
  padding: 10px 12px;
  border-radius: 2px;
  font-size: 13px;
}

.catalog-banner--warn {
  border: 1px solid rgba(245, 158, 11, 0.35);
  background: rgba(245, 158, 11, 0.12);
  color: #fde68a;
}

.catalog-banner--error {
  border: 1px solid rgba(244, 63, 94, 0.35);
  background: rgba(244, 63, 94, 0.12);
  color: #fecdd3;
}

.catalog-progress {
  margin: 0 0 16px;
  padding: 10px 12px;
  border: 1px solid rgba(102, 192, 244, 0.35);
  background: rgba(102, 192, 244, 0.1);
  color: #c7d5e0;
  font-size: 13px;
}

.catalog-progress__bar {
  margin-top: 8px;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.35);
}

.catalog-progress__bar > div {
  height: 100%;
  background: #66c0f4;
  transition: width 0.2s ease;
}

.catalog-progress__pct {
  margin: 6px 0 0;
  color: #8f98a0;
  font-size: 11px;
}

.catalog-muted {
  color: #8f98a0;
  font-size: 13px;
}

.catalog-empty {
  display: grid;
  place-items: center;
  gap: 8px;
  min-height: 40vh;
  text-align: center;
  color: #c7d5e0;
}

.catalog-empty h2 {
  margin: 0;
  color: #fff;
  font-size: 22px;
}

.catalog-empty p {
  margin: 0;
  color: #8f98a0;
  font-size: 13px;
}

.catalog-grid {
  display: grid;
  /* Cards fijas: con pocos juegos no se estiran a todo el ancho. */
  grid-template-columns: repeat(auto-fill, minmax(148px, 160px));
  gap: 12px;
  justify-content: start;
}

.catalog-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 0;
  border-radius: 6px;
  padding: 0;
  background: rgba(23, 26, 33, 0.7);
  text-align: left;
  cursor: pointer;
  transition: filter 0.15s ease, transform 0.15s ease;
}

.catalog-card:hover {
  filter: brightness(1.08);
  transform: translateY(-2px);
}

.catalog-card:focus-visible {
  outline: 2px solid #66c0f4;
  outline-offset: 2px;
}

.catalog-card__cover {
  position: relative;
  display: flex;
  aspect-ratio: 3 / 4;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: linear-gradient(180deg, #2a475e 0%, #171a21 100%);
  padding: 0;
}

.catalog-card__img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
}

.catalog-card__title {
  position: relative;
  z-index: 1;
  padding: 12px;
  color: #c7d5e0;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
  text-align: center;
  text-wrap: balance;
}

.catalog-card__platform {
  position: absolute;
  left: 6px;
  top: 6px;
  max-width: calc(100% - 12px);
  overflow: hidden;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.55);
  color: #66c0f4;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.04em;
  line-height: 1.2;
  padding: 3px 5px;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.catalog-card__badge {
  position: absolute;
  right: 6px;
  bottom: 6px;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.7);
  color: #66c0f4;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.03em;
  padding: 3px 6px;
  text-transform: uppercase;
}

.catalog-card__meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(23, 26, 33, 0.85);
  padding: 8px;
}

.catalog-card__name {
  margin: 0;
  color: #e8eef7;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.catalog-card__by {
  margin: 0;
  color: #8f98a0;
  font-size: 10px;
  line-height: 1.3;
}

@media (max-width: 900px) {
  .catalog-grid {
    grid-template-columns: repeat(auto-fill, minmax(132px, 148px));
  }
}
</style>
