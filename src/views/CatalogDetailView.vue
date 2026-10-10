<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { useAuthStore } from "../stores/auth";
import { useLibraryStore } from "../stores/library";
import { catalogApiService } from "../services/catalogApi.service";
import { catalogInstallService } from "../services/catalogInstall.service";
import { formatBytes } from "../services/catalogTransfer.service";
import { ApiError } from "../services/api.client";
import { gameTagLabels } from "../utils/raBadge";
import { resolveGameBanner } from "../utils/gameBanner";
import DownloadProgressHud from "../components/DownloadProgressHud.vue";
import AddPlusIcon from "../components/icons/AddPlusIcon.vue";
import DownloadIcon from "../components/icons/DownloadIcon.vue";
import type { CatalogGame } from "../types/catalog";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const library = useLibraryStore();
const { isAuthenticated } = storeToRefs(auth);

const game = ref<CatalogGame | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const busy = ref(false);
const downloadTitle = ref("DESCARGANDO");
const downloadPercent = ref(0);
const downloadDetail = ref<string | null>(null);
const catalogId = computed(() =>
  typeof route.params.id === "string" ? route.params.id : "",
);

const localGame = computed(() => {
  if (!game.value) return null;
  return (
    library.games.find((g) => g.catalogRemoteId === game.value!.id) ?? null
  );
});

const inLibrary = computed(() => !!localGame.value);

const tags = computed(() =>
  gameTagLabels({
    genre: game.value?.genre,
    platform: game.value?.platform,
  }),
);

const bannerSrc = computed(() => resolveGameBanner(game.value?.title));

function userFacing(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.message) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

async function load(): Promise<void> {
  if (!catalogId.value || !isAuthenticated.value) {
    game.value = null;
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    if (!library.ready) await library.loadLibrary();
    game.value = await catalogApiService.get(catalogId.value);
  } catch (err) {
    error.value = userFacing(err, "No se pudo cargar el juego del catálogo.");
    game.value = null;
  } finally {
    loading.value = false;
  }
}

async function primaryAction(): Promise<void> {
  if (!game.value || busy.value) return;
  busy.value = true;
  error.value = null;
  downloadTitle.value = inLibrary.value ? "PREPARANDO" : "AGREGANDO";
  downloadPercent.value = 0;
  downloadDetail.value = null;
  try {
    if (!inLibrary.value) {
      downloadTitle.value = "AGREGANDO";
      const result = await catalogInstallService.addToLibrary(game.value.id);
      await library.loadLibrary();
      await router.push(`/games/${result.game.id}`);
      return;
    }
    downloadTitle.value = "DESCARGANDO";
    await catalogInstallService.repairFromCatalog(
      localGame.value!.id,
      (p) => {
        if (p.phase === "downloading") {
          downloadTitle.value = "DESCARGANDO";
        } else if (p.phase === "installing") {
          downloadTitle.value = "INSTALANDO";
        } else {
          downloadTitle.value = "PREPARANDO";
        }
        if (p.bytesTotal > 0) {
          downloadPercent.value = Math.min(
            100,
            Math.round((p.bytesDone / p.bytesTotal) * 100),
          );
          downloadDetail.value = `${formatBytes(p.bytesDone)} / ${formatBytes(p.bytesTotal)}`;
        } else if (p.phase === "installing") {
          downloadPercent.value = 100;
          downloadDetail.value = p.message;
        }
      },
    );
    await library.loadLibrary();
    await router.push(`/games/${localGame.value!.id}`);
  } catch (err) {
    error.value = userFacing(
      err,
      inLibrary.value
        ? "No se pudo descargar el juego."
        : "No se pudo agregar a la biblioteca.",
    );
  } finally {
    busy.value = false;
    downloadTitle.value = "DESCARGANDO";
    downloadPercent.value = 0;
    downloadDetail.value = null;
  }
}

onMounted(() => {
  void load();
});

watch(catalogId, () => {
  void load();
});
</script>

<template>
  <div class="cdetail">
    <button type="button" class="cdetail-back" @click="router.push('/juegos')">
      ← Juegos disponibles
    </button>

    <p v-if="!isAuthenticated" class="banner banner--warn">
      Iniciá sesión para ver el catálogo.
    </p>
    <p v-else-if="error" class="banner banner--error">{{ error }}</p>
    <p v-if="loading" class="muted">Cargando…</p>

    <template v-else-if="game">
      <section class="hero" :class="{ 'hero--has-banner': !!bannerSrc }">
        <img
          v-if="bannerSrc"
          :src="bannerSrc"
          :alt="game.title"
          class="hero__img"
        />
        <div class="hero__fade" />
        <div class="hero__inner">
          <h1>{{ game.title }}</h1>
        </div>
      </section>

      <section class="action-bar">
        <DownloadProgressHud
          v-if="busy && inLibrary"
          :title="downloadTitle"
          :percent="downloadPercent"
          :detail="downloadDetail"
        />
        <button
          v-else
          type="button"
          class="btn-primary"
          :disabled="busy"
          @click="primaryAction"
        >
          <AddPlusIcon
            v-if="!busy && !inLibrary"
            class="btn-primary__icon"
          />
          <DownloadIcon
            v-else-if="!busy && inLibrary"
            class="btn-primary__icon"
          />
          {{
            busy
              ? "Agregando…"
              : inLibrary
                ? "Descargar"
                : "Agregar a biblioteca"
          }}
        </button>
        <button
          v-if="inLibrary && localGame && !busy"
          type="button"
          class="btn-ghost"
          @click="router.push(`/games/${localGame.id}`)"
        >
          Abrir en biblioteca
        </button>
        <p class="meta-line">
          {{ formatBytes(Number(game.fileSizeBytes)) }}
        </p>
      </section>

      <div class="grid">
        <div class="main">
          <p v-if="game.description" class="desc">{{ game.description }}</p>
          <p v-else class="desc desc--empty">Sin descripción.</p>
          <p class="hint">
            {{
              inLibrary
                ? "Este juego ya está en tu biblioteca."
                : "Descargalo para agregarlo a tu biblioteca."
            }}
          </p>
        </div>

        <aside class="side">
          <div class="side-card">
            <dl class="side-meta">
              <div v-if="game.releaseYear">
                <dt>FECHA DE LANZAMIENTO:</dt>
                <dd>{{ game.releaseYear }}</dd>
              </div>
              <div v-if="game.developer">
                <dt>DESARROLLADOR:</dt>
                <dd>{{ game.developer }}</dd>
              </div>
            </dl>
            <div v-if="tags.length" class="side-tags">
              <p class="side-tags__label">Etiquetas</p>
              <div class="side-tags__list">
                <span v-for="tag in tags" :key="tag" class="side-tag">
                  {{ tag }}
                </span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.cdetail {
  min-height: calc(100vh - 80px);
  padding: 12px 18px 36px;
  background: linear-gradient(180deg, #2a475e 0%, #1b2838 160px, #1b2838 100%);
  color: #c7d5e0;
}

.cdetail-back {
  margin-bottom: 10px;
  border: 0;
  background: transparent;
  color: #8f98a0;
  font-size: 13px;
  cursor: pointer;
}

.cdetail-back:hover {
  color: #fff;
}

.banner {
  margin: 0 0 12px;
  padding: 10px 12px;
  border-radius: 3px;
  font-size: 13px;
}

.banner--warn {
  border: 1px solid rgba(245, 158, 11, 0.35);
  background: rgba(245, 158, 11, 0.12);
  color: #fde68a;
}

.banner--error {
  border: 1px solid rgba(244, 63, 94, 0.35);
  background: rgba(244, 63, 94, 0.12);
  color: #fecdd3;
}

.muted {
  color: #8f98a0;
  font-size: 13px;
}

.hero {
  position: relative;
  width: 100%;
  aspect-ratio: 1920 / 620;
  height: auto;
  overflow: hidden;
  border-radius: 4px 4px 0 0;
  background: #171a21;
}

.hero--has-banner {
  background: #171a21;
}

.hero__img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center center;
}

.hero__fade {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(23, 26, 33, 0.05) 0%,
    rgba(23, 26, 33, 0.2) 50%,
    rgba(23, 26, 33, 0.82) 100%
  );
  pointer-events: none;
}

.hero__inner {
  position: relative;
  z-index: 1;
  display: flex;
  height: 100%;
  align-items: flex-end;
  padding: 20px 22px;
}

.hero__inner h1 {
  margin: 0;
  color: #fff;
  font-size: clamp(26px, 4vw, 38px);
  font-weight: 600;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.65);
}

.action-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
  padding: 12px 16px;
  border-radius: 0 0 4px 4px;
  background: rgba(23, 26, 33, 0.92);
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 22px;
  border: 0;
  border-radius: 2px;
  background: #66c0f4;
  color: #171a21;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.btn-primary__icon {
  width: 18px;
  height: 18px;
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-ghost {
  height: 44px;
  padding: 0 14px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 2px;
  background: transparent;
  color: #c7d5e0;
  font-size: 13px;
  cursor: pointer;
}

.meta-line {
  margin: 0 0 0 auto;
  color: #8f98a0;
  font-size: 12px;
}

.grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 18px;
  align-items: start;
}

.desc {
  margin: 0 0 12px;
  color: #c7d5e0;
  font-size: 14px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.desc--empty {
  color: #8f98a0;
}

.hint {
  margin: 0;
  color: #8f98a0;
  font-size: 13px;
}

.side-card {
  overflow: hidden;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.28);
}

.side-meta {
  margin: 0;
  padding: 12px 14px;
}

.side-meta > div {
  margin-bottom: 8px;
}

.side-meta dt {
  color: #8f98a0;
  font-size: 10px;
  letter-spacing: 0.04em;
}

.side-meta dd {
  margin: 2px 0 0;
  color: #66c0f4;
  font-size: 13px;
}

.side-tags {
  padding: 0 14px 14px;
}

.side-tags__label {
  margin: 0 0 8px;
  color: #8f98a0;
  font-size: 11px;
}

.side-tags__list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.side-tag {
  padding: 4px 8px;
  border: 1px solid rgba(102, 192, 244, 0.35);
  border-radius: 2px;
  background: rgba(102, 192, 244, 0.08);
  color: #66c0f4;
  font-size: 11px;
}

@media (max-width: 900px) {
  .grid {
    grid-template-columns: 1fr;
  }

  .meta-line {
    margin-left: 0;
  }
}
</style>
