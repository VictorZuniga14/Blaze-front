<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { open } from "@tauri-apps/plugin-dialog";
import { storeToRefs } from "pinia";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import DownloadProgressHud from "../components/DownloadProgressHud.vue";
import AchievementsMedalIcon from "../components/icons/AchievementsMedalIcon.vue";
import DownloadIcon from "../components/icons/DownloadIcon.vue";
import FavoriteHeartIcon from "../components/icons/FavoriteHeartIcon.vue";
import PlaytimeClockIcon from "../components/icons/PlaytimeClockIcon.vue";
import RaAchievementsShowcase from "../components/RaAchievementsShowcase.vue";
import RaProgressPanel from "../components/RaProgressPanel.vue";
import { useLibraryStore } from "../stores/library";
import { useLaunchStore } from "../stores/launch";
import { usePlayHistoryStore } from "../stores/playHistory";
import { useRaProgressStore } from "../stores/raProgress";
import { exitStatusCopy, formatRaProgress } from "../utils/raLibraryProgress";
import { formatLastPlayed, formatPlaytime } from "../utils/playStats";
import { gameTagLabels } from "../utils/raBadge";
import { resolveGameBanner } from "../utils/gameBanner";
import { useGameContentStore } from "../stores/gameContent";
import { useCatalogCoversStore } from "../stores/catalogCovers";
import { runLaunchPreparation } from "../services/launchPrep.service";
import { isGameDraft, isGamePublished } from "../types/game";
import { useAuthStore } from "../stores/auth";
import { catalogPublishService } from "../services/catalogPublish.service";
import { catalogApiService } from "../services/catalogApi.service";
import { catalogInstallService } from "../services/catalogInstall.service";
import {
  formatBytes,
  listSwitchExtras,
} from "../services/catalogTransfer.service";
import type { R2OrphanObject } from "../types/catalog";

const route = useRoute();
const router = useRouter();
const library = useLibraryStore();
const catalogCovers = useCatalogCoversStore();
const launch = useLaunchStore();
const raProgress = useRaProgressStore();
const playHistory = usePlayHistoryStore();
const gameContent = useGameContentStore();
const auth = useAuthStore();

const {
  currentConfig,
  loadingConfig,
  status,
  activeGameId,
  lastResult,
  error: launchError,
  isBusy,
} = storeToRefs(launch);
const { postPlayNotice } = storeToRefs(raProgress);
const {
  stats: playStats,
  notice: playNotice,
  loaded: playLoaded,
} = storeToRefs(playHistory);

const {
  content,
  fileExists,
  loading: contentLoading,
  saving: contentSaving,
  error: contentError,
} = storeToRefs(gameContent);

const confirmOpen = ref(false);
const removeContentOpen = ref(false);
const pageError = ref<string | null>(null);
const contentInfo = ref<string | null>(null);
const publishing = ref(false);
const catalogPublishing = ref(false);
const catalogProgress = ref<string | null>(null);
const catalogError = ref<string | null>(null);
const catalogOk = ref<string | null>(null);

const gameId = computed(() =>
  typeof route.params.id === "string" ? route.params.id : "",
);

const game = computed(() =>
  gameId.value ? library.getGameById(gameId.value) : undefined,
);

const isDraft = computed(() => isGameDraft(game.value));
const canPublishToCatalog = computed(
  () =>
    !!game.value &&
    isGamePublished(game.value) &&
    auth.isAuthenticated &&
    auth.isDev,
);
const alreadyInCatalog = computed(() => !!game.value?.catalogRemoteId);
const catalogRemoving = ref(false);
const catalogUnpublishOpen = ref(false);
/** Update/DLC .nsp/.xci junto a la base Switch (se empaquetan al publicar). */
const switchExtrasCount = ref(0);
const r2LinkOpen = ref(false);
const r2LinkLoading = ref(false);
const r2LinkSaving = ref(false);
const r2ContentOptions = ref<R2OrphanObject[]>([]);
const r2SelectedKey = ref<string | null>(null);
const r2SuggestCover = ref<((key: string) => string | null) | null>(null);
const needsCloudRepair = ref(false);
const repairingFromCloud = ref(false);
const cloudRepairTitle = ref("DESCARGANDO");
const cloudRepairPercent = ref(0);
const cloudRepairDetail = ref<string | null>(null);

const coverSrc = computed(() =>
  game.value ? catalogCovers.coverForGame(game.value) : null,
);

const bannerSrc = computed(() => resolveGameBanner(game.value?.title));

const tags = computed(() =>
  gameTagLabels({
    genre: game.value?.genre,
    platform: game.value?.platform,
  }),
);

const raEntry = computed(() =>
  gameId.value ? raProgress.entryFor(gameId.value) : undefined,
);
const raProgressData = computed(() => raEntry.value?.progress ?? null);
const raLoading = computed(
  () => Boolean(raEntry.value?.loading || raEntry.value?.refreshing),
);
const raError = computed(() => raEntry.value?.error ?? null);
/** Dev abre a mano el panel de vincular RA en juegos publicados. */
const raAdminOpen = ref(false);

/**
 * Draft: panel de mapping visible.
 * Publicado: solo Dev, y solo si lo abre (“Gestionar RetroAchievements”).
 * Usuario normal: nunca ve el panel de mapping.
 */
const showRaMapping = computed(
  () => isDraft.value || (auth.isDev && raAdminOpen.value),
);

const barRa = computed(() => {
  const p = raProgressData.value;
  if (!p || p.totalAchievements <= 0) return null;
  return formatRaProgress(p.unlockedAchievements, p.totalAchievements);
});

const deleteTitle = computed(() => {
  const name = game.value?.title ?? "este juego";
  return `¿Eliminar "${name}"?`;
});

const playLabel = computed(() => {
  if (status.value === "STARTING" && activeGameId.value === gameId.value) {
    return "Iniciando...";
  }
  if (status.value === "RUNNING" && activeGameId.value === gameId.value) {
    return "Jugando...";
  }
  if (isBusy.value && activeGameId.value !== gameId.value) {
    return "Otro juego en ejecución";
  }
  return "JUGAR";
});

const playDisabled = computed(() => {
  if (isDraft.value) return true;
  if (!currentConfig.value) return true;
  if (status.value === "STARTING" || status.value === "RUNNING") return true;
  return false;
});

const endedMessage = computed(() => {
  if (!lastResult.value || lastResult.value.gameId !== gameId.value) {
    return null;
  }
  const raFailed = postPlayNotice.value?.gameId === gameId.value;
  return exitStatusCopy(lastResult.value.exitCode, raFailed);
});

const gamePlay = computed(() => {
  if (!gameId.value || !playStats.value) return null;
  return (
    playStats.value.games.find((item) => item.gameId === gameId.value) ?? null
  );
});

async function ensureLoaded() {
  pageError.value = null;
  contentInfo.value = null;
  needsCloudRepair.value = false;
  cloudRepairTitle.value = "DESCARGANDO";
  cloudRepairPercent.value = 0;
  cloudRepairDetail.value = null;
  if (!library.ready) {
    await library.loadLibrary();
  }
  await launch.syncActiveProcess();
  void playHistory.ensureLoaded();
  if (gameId.value) {
    library.selectGame(gameId.value);
    await Promise.all([
      launch.loadConfig(gameId.value),
      gameContent.loadContent(gameId.value),
    ]);
    const loaded = library.getGameById(gameId.value);
    if (!loaded) {
      pageError.value = "No se encontró el juego.";
    } else {
      if (loaded.catalogRemoteId) {
        try {
          needsCloudRepair.value = await catalogInstallService.needsCloudRepair(
            gameId.value,
          );
        } catch {
          needsCloudRepair.value = !fileExists.value;
        }
      }
      if (loaded.retroAchievementsGameId) {
        void raProgress.loadForGame({
          gameId: gameId.value,
          raGameId: loaded.retroAchievementsGameId,
          platform: loaded.platform,
        });
      }
      // Portada en Juegos: sincronizar ID RA local → catálogo (si faltaba).
      if (
        auth.isDev &&
        loaded.catalogRemoteId &&
        loaded.retroAchievementsGameId
      ) {
        void catalogApiService
          .update(loaded.catalogRemoteId, {
            retroAchievementsGameId: loaded.retroAchievementsGameId,
          })
          .then((catalogGame) => {
            catalogCovers.ingest([catalogGame], { merge: true });
          })
          .catch(() => {
            /* best-effort */
          });
      }
    }
  } else {
    gameContent.clear();
  }
}

async function restoreFromCatalog() {
  if (!gameId.value || repairingFromCloud.value) return;
  pageError.value = null;
  contentInfo.value = null;
  repairingFromCloud.value = true;
  cloudRepairTitle.value = "PREPARANDO";
  cloudRepairPercent.value = 0;
  cloudRepairDetail.value = null;
  try {
    const result = await catalogInstallService.repairFromCatalog(
      gameId.value,
      (p) => {
        if (p.phase === "downloading") {
          cloudRepairTitle.value = "DESCARGANDO";
        } else if (p.phase === "installing") {
          cloudRepairTitle.value = "INSTALANDO";
        } else {
          cloudRepairTitle.value = "PREPARANDO";
        }
        if (p.bytesTotal > 0) {
          cloudRepairPercent.value = Math.min(
            100,
            Math.round((p.bytesDone / p.bytesTotal) * 100),
          );
          cloudRepairDetail.value = `${formatBytes(p.bytesDone)} / ${formatBytes(p.bytesTotal)}`;
        } else if (p.phase === "installing") {
          cloudRepairPercent.value = 100;
          cloudRepairDetail.value = p.message;
        }
      },
    );
    await library.loadLibrary();
    await Promise.all([
      launch.loadConfig(gameId.value),
      gameContent.loadContent(gameId.value),
    ]);
    needsCloudRepair.value = false;
    contentInfo.value = `Descargado desde el catálogo · runtime ${result.runtimeName}`;
  } catch (err) {
    const raw =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : null;
    pageError.value = raw?.trim()
      ? raw
      : "No se pudo restaurar desde el catálogo.";
  } finally {
    repairingFromCloud.value = false;
    cloudRepairTitle.value = "DESCARGANDO";
    cloudRepairPercent.value = 0;
    cloudRepairDetail.value = null;
  }
}

onMounted(() => {
  void ensureLoaded();
});

watch(gameId, () => {
  void ensureLoaded();
});

function goEdit() {
  if (gameId.value) {
    void router.push(`/games/${gameId.value}/edit`);
  }
}

function goLaunchConfig() {
  if (gameId.value) {
    void router.push(`/games/${gameId.value}/launch`);
  }
}

async function refreshRa() {
  if (!gameId.value || !game.value?.retroAchievementsGameId) return;
  await raProgress.loadForGame({
    gameId: gameId.value,
    raGameId: game.value.retroAchievementsGameId,
    platform: game.value.platform,
    refresh: true,
  });
}

async function play() {
  if (!gameId.value) return;
  pageError.value = null;

  // Prep en silencio: sin overlay; si falla, solo pageError.
  const prep = await runLaunchPreparation(gameId.value, () => {});
  if (!prep.ok) {
    pageError.value = prep.error;
    return;
  }

  await launch.play(gameId.value);
  if (launchError.value) {
    pageError.value = launchError.value;
  }
}

async function pickContentFile() {
  if (!gameId.value) return;
  pageError.value = null;
  contentInfo.value = null;
  const selected = await open({
    multiple: false,
    directory: false,
  });
  if (typeof selected !== "string") return;
  try {
    await gameContent.associateContent(gameId.value, selected);
  } catch (err) {
    pageError.value =
      err instanceof Error ? err.message : "No se pudo asociar el contenido.";
  }
}

async function confirmRemoveContent() {
  if (!gameId.value) return;
  try {
    await gameContent.removeContent(gameId.value);
    removeContentOpen.value = false;
    contentInfo.value =
      "Contenido desasociado. El archivo en disco no se modificó.";
  } catch (err) {
    pageError.value =
      err instanceof Error ? err.message : "No se pudo quitar el contenido.";
    removeContentOpen.value = false;
  }
}

async function useAsLaunchContent() {
  if (!gameId.value || !content.value) return;
  pageError.value = null;
  contentInfo.value = null;

  if (!fileExists.value) {
    pageError.value = "El archivo de contenido no existe.";
    return;
  }

  const config = currentConfig.value;
  if (!config || config.type !== "runtime") {
    pageError.value =
      "Configura primero la ejecución como Runtime para usar este contenido.";
    return;
  }

  try {
    await launch.saveConfig({
      gameId: gameId.value,
      type: "runtime",
      runtimeId: config.runtimeId,
      contentPath: content.value.path,
      workingDirectory: config.workingDirectory,
      arguments: config.arguments,
      executablePath: null,
    });
    contentInfo.value = "Contenido aplicado a la configuración de lanzamiento.";
  } catch (err) {
    pageError.value =
      err instanceof Error
        ? err.message
        : "No se pudo aplicar el contenido al lanzamiento.";
  }
}

async function refreshSwitchExtrasHint() {
  switchExtrasCount.value = 0;
  const path = content.value?.path?.trim();
  if (!path || !/\.(nsp|xci)$/i.test(path)) return;
  try {
    const extras = await listSwitchExtras(path);
    switchExtrasCount.value = extras.length;
  } catch {
    switchExtrasCount.value = 0;
  }
}

watch(
  () => content.value?.path,
  () => {
    void refreshSwitchExtrasHint();
  },
  { immediate: true },
);

async function publishToCatalog() {
  if (!gameId.value || catalogPublishing.value) return;
  catalogError.value = null;
  catalogOk.value = null;
  const wasInCatalog = alreadyInCatalog.value;
  catalogPublishing.value = true;
  catalogProgress.value = "Preparando…";
  try {
    await catalogPublishService.publishLocalGame(gameId.value, (p) => {
      const pct =
        p.bytesTotal > 0
          ? Math.round((p.bytesDone / p.bytesTotal) * 100)
          : 0;
      catalogProgress.value = `${p.message} ${formatBytes(p.bytesDone)} / ${formatBytes(p.bytesTotal)} (${pct}%)`;
    });
    await library.loadLibrary();
    await catalogCovers.refresh();
    catalogOk.value = wasInCatalog
      ? "Catálogo actualizado (incluye portada si había)."
      : "Publicado en el catálogo. Tus amigos ya pueden descargarlo.";
    catalogProgress.value = null;
  } catch (err) {
    const raw =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : null;
    catalogError.value = raw?.trim()
      ? raw
      : "No se pudo publicar en el catálogo.";
    catalogProgress.value = null;
  } finally {
    catalogPublishing.value = false;
  }
}

async function openLinkFromR2() {
  if (!gameId.value || catalogPublishing.value || r2LinkLoading.value) return;
  catalogError.value = null;
  catalogOk.value = null;
  r2LinkOpen.value = true;
  r2LinkLoading.value = true;
  r2SelectedKey.value = null;
  r2ContentOptions.value = [];
  try {
    const listed = await catalogPublishService.listLinkableR2Content();
    r2ContentOptions.value = listed.content;
    r2SuggestCover.value = listed.suggestCoverFor;
  } catch (err) {
    r2LinkOpen.value = false;
    catalogError.value =
      err instanceof Error
        ? err.message
        : "No se pudieron listar los archivos de R2.";
  } finally {
    r2LinkLoading.value = false;
  }
}

async function confirmLinkFromR2() {
  if (!gameId.value || !r2SelectedKey.value || r2LinkSaving.value) return;
  r2LinkSaving.value = true;
  catalogError.value = null;
  catalogOk.value = null;
  try {
    const coverKey = r2SuggestCover.value?.(r2SelectedKey.value) ?? null;
    const linked = await catalogPublishService.linkLocalGameFromR2(
      gameId.value,
      r2SelectedKey.value,
      coverKey,
    );
    await library.loadLibrary();
    await catalogCovers.refresh();
    r2LinkOpen.value = false;
    const raNote =
      linked.ra?.state === "identified"
        ? ` ${linked.ra.message}`
        : linked.ra?.message
          ? ` ${linked.ra.message}`
          : "";
    catalogOk.value = `Vinculado a R2 sin re-subir.${raNote}`;
  } catch (err) {
    catalogError.value =
      err instanceof Error
        ? err.message
        : "No se pudo vincular el archivo de R2.";
  } finally {
    r2LinkSaving.value = false;
  }
}

async function confirmRemoveFromCatalog() {
  catalogUnpublishOpen.value = false;
  if (!gameId.value || catalogRemoving.value) return;
  catalogError.value = null;
  catalogOk.value = null;
  catalogRemoving.value = true;
  try {
    await catalogPublishService.removeFromCatalog(gameId.value);
    await library.loadLibrary();
    await catalogCovers.refresh();
    catalogOk.value = "Se quitó del catálogo. Ya no aparece en Juegos.";
  } catch (err) {
    catalogError.value =
      err instanceof Error
        ? err.message
        : "No se pudo quitar del catálogo.";
  } finally {
    catalogRemoving.value = false;
  }
}

async function publishGame() {
  if (!gameId.value || publishing.value) return;
  pageError.value = null;
  contentInfo.value = null;
  publishing.value = true;
  try {
    const result = await library.publishGame(gameId.value);
    await Promise.all([
      launch.loadConfig(gameId.value),
      gameContent.loadContent(gameId.value),
    ]);
    if (result.game.retroAchievementsGameId) {
      await raProgress.loadForGame({
        gameId: gameId.value,
        raGameId: result.game.retroAchievementsGameId,
        platform: result.game.platform,
        refresh: true,
      });
    }
    contentInfo.value =
      result.identifyMessage ?? "Juego guardado y listo para jugar.";
  } catch (err) {
    pageError.value =
      err instanceof Error ? err.message : "No se pudo guardar el juego.";
  } finally {
    publishing.value = false;
  }
}

async function confirmDelete() {
  if (!gameId.value) return;
  try {
    await library.deleteGame(gameId.value);
    confirmOpen.value = false;
    gameContent.clear();
    await router.push({ name: "library" });
  } catch (err) {
    pageError.value =
      err instanceof Error ? err.message : "No se pudo eliminar el juego.";
    confirmOpen.value = false;
  }
}
</script>

<template>
  <div class="detail">
    <p
      v-if="pageError || library.error || launchError || contentError"
      class="detail-banner detail-banner--error"
    >
      {{ pageError || library.error || launchError || contentError }}
    </p>
    <p v-if="contentInfo" class="detail-banner detail-banner--info">
      {{ contentInfo }}
    </p>
    <p v-if="endedMessage" class="detail-banner detail-banner--ok">
      {{ endedMessage.primary }}
      <span v-if="endedMessage.raNotice" class="detail-banner__sub">
        {{ endedMessage.raNotice }}
      </span>
    </p>
    <p v-if="playNotice" class="detail-banner detail-banner--warn">
      {{ playNotice }}
    </p>

    <div
      v-if="library.loading || loadingConfig || contentLoading"
      class="detail-loading"
    >
      Cargando...
    </div>

    <template v-else-if="game">
      <!-- Hero + barra de acción (vista biblioteca publicada) -->
      <template v-if="!isDraft">
        <section class="hero" :class="{ 'hero--has-banner': !!bannerSrc }">
          <img
            v-if="bannerSrc"
            :src="bannerSrc"
            :alt="game.title"
            class="hero__img"
          />
          <div class="hero__fade" />
          <div class="hero__inner">
            <h1 class="hero__title">{{ game.title }}</h1>
          </div>
        </section>

        <section class="action-bar">
          <!-- Orden Steam: botón | descarga | cloud | sesión | tiempo | logros -->
          <div class="action-bar__left">
            <button
              v-if="needsCloudRepair || repairingFromCloud"
              type="button"
              class="btn-download"
              :disabled="repairingFromCloud"
              @click="restoreFromCatalog"
            >
              <DownloadIcon class="btn-download__icon" />
              {{ content ? "Descargar de nuevo" : "Descargar" }}
            </button>
            <button
              v-else
              type="button"
              class="btn-play"
              :disabled="playDisabled"
              @click="play"
            >
              <span class="btn-play__icon">▶</span>
              {{ playLabel }}
            </button>
          </div>

          <div class="action-bar__stats">
            <DownloadProgressHud
              v-if="repairingFromCloud"
              class="stat stat--download"
              :title="cloudRepairTitle"
              :percent="cloudRepairPercent"
              :detail="cloudRepairDetail"
            />
            <div
              v-if="game?.catalogRemoteId || needsCloudRepair || repairingFromCloud"
              class="stat stat--icon"
            >
              <span class="stat__cloud" aria-hidden="true">☁</span>
              <div class="stat__ra-body">
                <span class="stat__label">ESTADO DE CLOUD</span>
                <span class="stat__value">
                  {{
                    repairingFromCloud
                      ? "Sincronizando…"
                      : needsCloudRepair
                        ? "Pendiente"
                        : "Actualizado"
                  }}
                </span>
              </div>
            </div>
            <div class="stat">
              <span class="stat__label">ÚLTIMA SESIÓN</span>
              <span class="stat__value">
                {{
                  gamePlay
                    ? formatLastPlayed(gamePlay.lastPlayedAt, new Date(), true)
                    : playLoaded
                      ? "—"
                      : "…"
                }}
              </span>
            </div>
            <div class="stat stat--icon">
              <PlaytimeClockIcon class="stat__medal" />
              <div class="stat__ra-body">
                <span class="stat__label">TIEMPO DE JUEGO</span>
                <span class="stat__value">
                  {{
                    gamePlay
                      ? formatPlaytime(gamePlay.totalPlaytimeSeconds)
                      : playLoaded
                        ? "0 min"
                        : "…"
                  }}
                </span>
              </div>
            </div>
            <div v-if="barRa" class="stat stat--ra">
              <AchievementsMedalIcon class="stat__medal" />
              <div class="stat__ra-body">
                <span class="stat__label">LOGROS</span>
                <div class="stat__ra-row">
                  <span class="stat__value">{{ barRa.summary }}</span>
                  <div class="stat__bar">
                    <div :style="{ width: barRa.barWidth }" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="action-bar__tools">
            <button
              v-if="auth.isDev"
              type="button"
              class="tool-btn"
              title="Editar"
              @click="goEdit"
            >
              ✎
            </button>
            <button
              v-if="auth.isDev"
              type="button"
              class="tool-btn"
              title="Ejecución"
              @click="goLaunchConfig"
            >
              ⚙
            </button>
            <button
              type="button"
              class="tool-btn"
              :title="game.isFavorite ? 'Quitar favorito' : 'Favorito'"
              @click="library.toggleFavorite(game.id)"
            >
              <FavoriteHeartIcon :filled="game.isFavorite" />
            </button>
          </div>
        </section>

        <p v-if="game.description" class="detail-desc">
          {{ game.description }}
        </p>
        <p v-else class="detail-desc detail-desc--empty">Sin descripción.</p>

        <div class="detail-grid">
          <div class="detail-main">
            <RaAchievementsShowcase
              class="detail-ra"
              :progress="raProgressData"
              :loading="raLoading"
              :error="raError"
              @refresh="refreshRa"
            />

            <div v-if="showRaMapping" class="detail-map">
              <RaProgressPanel
                :game-id="game.id"
                :ra-game-id="game.retroAchievementsGameId"
                :game-title="game.title"
                :platform="game.platform"
              />
            </div>
          </div>

          <aside class="detail-side">
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
                <div v-if="game.publisher">
                  <dt>EDITOR:</dt>
                  <dd>{{ game.publisher }}</dd>
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

            <div class="side-actions">
              <button type="button" class="side-link" @click="confirmOpen = true">
                Eliminar de la biblioteca
              </button>
              <button
                v-if="auth.isDev && !isDraft"
                type="button"
                class="side-link"
                @click="raAdminOpen = !raAdminOpen"
              >
                {{
                  raAdminOpen
                    ? "Ocultar RetroAchievements (dev)"
                    : "Gestionar RetroAchievements (dev)"
                }}
              </button>
              <template v-if="canPublishToCatalog">
                <button
                  v-if="alreadyInCatalog"
                  type="button"
                  class="side-link"
                  :disabled="catalogPublishing || catalogRemoving"
                  @click="catalogUnpublishOpen = true"
                >
                  {{ catalogRemoving ? "Quitando…" : "Quitar del catálogo" }}
                </button>
                <button
                  type="button"
                  class="side-btn"
                  :disabled="catalogPublishing || catalogRemoving || r2LinkSaving"
                  @click="publishToCatalog"
                >
                  {{
                    catalogPublishing
                      ? "Subiendo…"
                      : alreadyInCatalog
                        ? "Actualizar en catálogo"
                        : "Publicar en catálogo"
                  }}
                </button>
                <p
                  v-if="switchExtrasCount > 0"
                  class="side-note"
                >
                  Al publicar se incluirán {{ switchExtrasCount }} update/DLC
                  de la misma carpeta.
                </p>
                <button
                  type="button"
                  class="side-link"
                  :disabled="catalogPublishing || catalogRemoving || r2LinkSaving"
                  @click="openLinkFromR2"
                >
                  Usar archivo ya en R2…
                </button>
              </template>
              <p v-if="catalogProgress" class="side-note">{{ catalogProgress }}</p>
              <p v-if="catalogError" class="side-note side-note--err">
                {{ catalogError }}
              </p>
              <p v-if="catalogOk" class="side-note side-note--ok">
                {{ catalogOk }}
              </p>
            </div>
          </aside>
        </div>
      </template>

      <!-- Flujo crear / borrador: contenido + ejecución -->
      <template v-else>
        <div class="draft">
          <div class="draft__cover">
            <img
              v-if="coverSrc"
              :src="coverSrc"
              :alt="game.title"
              @error="($event.target as HTMLImageElement).style.display = 'none'"
            />
            <span v-else>Sin portada</span>
          </div>
          <div class="draft__body">
            <div class="draft__title-row">
              <h1>{{ game.title }}</h1>
              <span class="draft-badge">Borrador</span>
            </div>
            <dl class="draft-meta">
              <div v-if="game.platform">
                <dt>Plataforma</dt>
                <dd>{{ game.platform }}</dd>
              </div>
              <div v-if="game.genre">
                <dt>Género</dt>
                <dd>{{ game.genre }}</dd>
              </div>
              <div v-if="game.developer">
                <dt>Desarrollador</dt>
                <dd>{{ game.developer }}</dd>
              </div>
              <div v-if="game.releaseYear">
                <dt>Año</dt>
                <dd>{{ game.releaseYear }}</dd>
              </div>
            </dl>
            <p v-if="game.description" class="draft-desc">{{ game.description }}</p>

            <section class="manage-card">
              <h2>Contenido</h2>
              <template v-if="!content">
                <p class="manage-muted">No hay contenido asociado.</p>
                <button
                  type="button"
                  class="btn-outline"
                  :disabled="contentSaving"
                  @click="pickContentFile"
                >
                  Seleccionar archivo
                </button>
              </template>
              <template v-else>
                <p v-if="!fileExists" class="manage-warn">⚠ Archivo no encontrado</p>
                <p class="manage-path">{{ content.path }}</p>
                <div class="manage-row">
                  <button
                    type="button"
                    class="btn-outline"
                    :disabled="contentSaving"
                    @click="pickContentFile"
                  >
                    Cambiar archivo
                  </button>
                  <button
                    type="button"
                    class="btn-outline btn-outline--danger"
                    :disabled="contentSaving"
                    @click="removeContentOpen = true"
                  >
                    Quitar contenido
                  </button>
                  <button
                    type="button"
                    class="btn-outline btn-outline--sky"
                    :disabled="contentSaving || !fileExists"
                    @click="useAsLaunchContent"
                  >
                    Usar como contenido de lanzamiento
                  </button>
                </div>
              </template>
            </section>

            <section class="manage-card">
              <h2>Ejecución</h2>
              <template v-if="!currentConfig">
                <p class="manage-muted">
                  Este juego todavía no está configurado para ejecutarse.
                </p>
                <button type="button" class="btn-play btn-play--sm" @click="goLaunchConfig">
                  Configurar ejecución
                </button>
              </template>
              <template v-else>
                <p class="manage-kicker">
                  {{
                    currentConfig.type === "runtime"
                      ? "EJECUCIÓN RUNTIME"
                      : "EJECUCIÓN NATIVA"
                  }}
                </p>
                <p class="manage-path">
                  {{
                    currentConfig.type === "runtime"
                      ? currentConfig.contentPath || "Sin contentPath"
                      : currentConfig.executablePath
                  }}
                </p>
                <button type="button" class="btn-outline" @click="goLaunchConfig">
                  Editar ejecución
                </button>
              </template>
            </section>

            <RaProgressPanel
              :game-id="game.id"
              :ra-game-id="game.retroAchievementsGameId"
              :game-title="game.title"
              :platform="game.platform"
            />

            <p class="draft-hint">
              Cuando el contenido y la ejecución estén listos, guardá el juego para
              publicarlo. Se intentará vincular RetroAchievements automáticamente.
            </p>

            <div class="draft-actions">
              <button type="button" class="btn-outline" @click="goEdit">Editar</button>
              <button
                type="button"
                class="btn-outline btn-outline--danger"
                @click="confirmOpen = true"
              >
                Eliminar
              </button>
              <button
                type="button"
                class="btn-play btn-play--sm"
                :disabled="publishing"
                @click="publishGame"
              >
                {{ publishing ? "Guardando..." : "Guardar juego" }}
              </button>
            </div>
          </div>
        </div>
      </template>
    </template>

    <ConfirmDialog
      :open="confirmOpen"
      :title="deleteTitle"
      message="Esta acción eliminará el juego de tu biblioteca local. No se borrarán archivos del disco."
      @cancel="confirmOpen = false"
      @confirm="confirmDelete"
    />

    <ConfirmDialog
      :open="removeContentOpen"
      title="Quitar contenido"
      message="¿Quieres quitar el contenido asociado a este juego?"
      confirm-label="Quitar"
      @cancel="removeContentOpen = false"
      @confirm="confirmRemoveContent"
    />

    <ConfirmDialog
      :open="catalogUnpublishOpen"
      title="¿Quitar del catálogo?"
      message="Se elimina del listado Juegos y de R2. Tu biblioteca local no se toca."
      confirm-label="Quitar del catálogo"
      @cancel="catalogUnpublishOpen = false"
      @confirm="confirmRemoveFromCatalog"
    />

    <div
      v-if="r2LinkOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      role="dialog"
      aria-modal="true"
    >
      <div
        class="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-xl"
      >
        <h2 class="mb-1 text-lg font-semibold text-white">
          Usar archivo ya en R2
        </h2>
        <p class="mb-4 text-sm text-slate-300">
          Elegí un ISO/zip huérfano (subido antes). No se vuelve a subir; después
          descargás cuando quieras jugar.
        </p>
        <div v-if="r2LinkLoading" class="py-8 text-center text-sm text-slate-400">
          Buscando en R2…
        </div>
        <div
          v-else-if="r2ContentOptions.length === 0"
          class="py-8 text-center text-sm text-slate-400"
        >
          No hay archivos huérfanos en R2 (o ya están todos vinculados).
        </div>
        <ul
          v-else
          class="mb-4 min-h-0 flex-1 space-y-1 overflow-y-auto rounded-lg border border-white/10 p-2"
        >
          <li v-for="obj in r2ContentOptions" :key="obj.key">
            <label
              class="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-sm hover:bg-white/5"
              :class="
                r2SelectedKey === obj.key ? 'bg-sky-500/15 text-sky-100' : 'text-slate-200'
              "
            >
              <input
                v-model="r2SelectedKey"
                type="radio"
                class="mt-1"
                :value="obj.key"
                name="r2-content"
              />
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium">{{ obj.fileName }}</span>
                <span class="block truncate text-xs text-slate-500">
                  {{ formatBytes(Number(obj.sizeBytes)) }} · {{ obj.key }}
                </span>
              </span>
            </label>
          </li>
        </ul>
        <div class="flex justify-end gap-3">
          <button
            type="button"
            class="rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
            :disabled="r2LinkSaving"
            @click="r2LinkOpen = false"
          >
            Cancelar
          </button>
          <button
            type="button"
            class="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            :disabled="!r2SelectedKey || r2LinkSaving || r2LinkLoading"
            @click="confirmLinkFromR2"
          >
            {{ r2LinkSaving ? "Vinculando…" : "Vincular sin subir" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.detail {
  min-height: 100%;
  padding: 0 0 36px;
  background: linear-gradient(180deg, #2a475e 0%, #1b2838 160px, #1b2838 100%);
  color: #c7d5e0;
}

.detail > .detail-banner,
.detail > .detail-loading,
.detail > .detail-desc,
.detail > .detail-grid,
.detail > .draft {
  margin-left: 18px;
  margin-right: 18px;
}

.detail > .detail-banner:first-child,
.detail > .detail-loading {
  margin-top: 12px;
}

.detail > .hero {
  margin-left: 0;
  margin-right: 0;
  border-radius: 0;
}

.detail > .action-bar {
  margin-left: 0;
  margin-right: 0;
  border-radius: 0;
}

.detail-banner {
  margin: 0 0 12px;
  padding: 10px 12px;
  border-radius: 3px;
  font-size: 13px;
}

.detail-banner--error {
  border: 1px solid rgba(244, 63, 94, 0.35);
  background: rgba(244, 63, 94, 0.12);
  color: #fecdd3;
}

.detail-banner--info {
  border: 1px solid rgba(102, 192, 244, 0.35);
  background: rgba(102, 192, 244, 0.1);
  color: #c7d5e0;
}

.detail-banner--ok {
  border: 1px solid rgba(16, 185, 129, 0.35);
  background: rgba(16, 185, 129, 0.1);
  color: #a7f3d0;
}

.detail-banner--warn {
  border: 1px solid rgba(245, 158, 11, 0.35);
  background: rgba(245, 158, 11, 0.12);
  color: #fde68a;
}

.detail-banner__sub {
  display: block;
  margin-top: 4px;
  color: #fde68a;
}

.detail-loading {
  padding: 48px 0;
  text-align: center;
  color: #8f98a0;
}

.hero {
  position: relative;
  width: 100%;
  /* Misma proporción que banner_crash_1920x620 → se ve Crash entero */
  aspect-ratio: 1920 / 620;
  height: auto;
  overflow: hidden;
  border-radius: 0;
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
  gap: 16px;
  padding: 22px 24px;
}

.hero__title {
  margin: 0;
  color: #fff;
  font-size: clamp(28px, 3.2vw, 42px);
  font-weight: 600;
  line-height: 1.1;
  text-shadow: 0 2px 16px rgba(0, 0, 0, 0.75);
}

.action-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  margin-bottom: 18px;
  padding: 12px 16px;
  border-radius: 0 0 4px 4px;
  background: rgba(23, 26, 33, 0.92);
}

.action-bar__left {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.action-bar__hint {
  margin: 0;
  color: #8f98a0;
  font-size: 12px;
}

.btn-play {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 120px;
  height: 44px;
  padding: 0 22px;
  border: 0;
  border-radius: 2px;
  background: #5c7e10;
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
}

.btn-play:hover:not(:disabled) {
  filter: brightness(1.08);
}

.btn-play:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.btn-play--sm {
  height: 36px;
  min-width: 0;
  font-size: 13px;
}

.btn-play__icon {
  font-size: 12px;
}

.btn-download {
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

.btn-download__icon {
  width: 18px;
  height: 18px;
}

.btn-download:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.action-bar__stats {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  gap: 18px 28px;
  min-width: 200px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 90px;
}

.stat__label {
  color: #8f98a0;
  font-size: 10px;
  letter-spacing: 0.05em;
}

.stat__value {
  color: #c7d5e0;
  font-size: 13px;
}

.stat--icon,
.stat--ra {
  flex-direction: row;
  align-items: center;
  gap: 10px;
}

.stat--download {
  min-width: 180px;
  max-width: 260px;
}

.stat__cloud {
  font-size: 22px;
  line-height: 1;
  color: #c7d5e0;
}

.stat--ra {
  min-width: 160px;
}

.stat__medal {
  width: 28px;
  height: 28px;
  color: #c7d5e0;
}

.stat__ra-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.stat__ra-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stat__bar {
  flex: 1;
  height: 4px;
  min-width: 48px;
  overflow: hidden;
  border-radius: 2px;
  background: #0e141b;
}

.stat__bar > div {
  height: 100%;
  background: #66c0f4;
}

.action-bar__tools {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.06);
  color: #c7d5e0;
  font-size: 16px;
  cursor: pointer;
}

.tool-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}

.detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 18px;
  align-items: start;
}

.detail-desc {
  margin: 0 0 16px;
  color: #c7d5e0;
  font-size: 14px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.detail-desc--empty {
  color: #8f98a0;
}

.detail-ra {
  margin: 0 0 16px;
}

.detail-map {
  margin-top: 12px;
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
  display: grid;
  gap: 2px;
  margin-bottom: 8px;
}

.side-meta dt {
  color: #8f98a0;
  font-size: 10px;
  letter-spacing: 0.04em;
}

.side-meta dd {
  margin: 0;
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

.side-actions {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}

.side-link {
  border: 0;
  background: transparent;
  color: #8f98a0;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.side-link:hover {
  color: #fff;
}

.side-btn {
  height: 34px;
  border: 0;
  border-radius: 2px;
  background: #66c0f4;
  color: #171a21;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.side-btn:disabled,
.side-link:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.side-note {
  margin: 0;
  color: #8f98a0;
  font-size: 12px;
}

.side-note--err {
  color: #fecdd3;
}

.side-note--ok {
  color: #a7f3d0;
}

/* Draft / create */
.draft {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
}

.draft__cover {
  position: relative;
  width: 180px;
  height: 240px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 6px;
  background: #171a21;
  color: #8f98a0;
  font-size: 12px;
}

.draft__cover img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.draft__body {
  flex: 1;
  min-width: 260px;
}

.draft__title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.draft__title-row h1 {
  margin: 0;
  color: #fff;
  font-size: 28px;
}

.draft-badge {
  padding: 2px 8px;
  border: 1px solid rgba(245, 158, 11, 0.4);
  border-radius: 4px;
  background: rgba(245, 158, 11, 0.15);
  color: #fde68a;
  font-size: 11px;
  text-transform: uppercase;
}

.draft-meta {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
  margin: 0 0 12px;
}

.draft-meta dt {
  color: #8f98a0;
  font-size: 11px;
}

.draft-meta dd {
  margin: 0;
  color: #c7d5e0;
  font-size: 13px;
}

.draft-desc {
  margin: 0 0 16px;
  color: #c7d5e0;
  font-size: 14px;
  white-space: pre-wrap;
}

.manage-card {
  margin-bottom: 14px;
  padding: 14px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.28);
}

.manage-card h2 {
  margin: 0 0 10px;
  color: #fff;
  font-size: 15px;
  font-weight: 500;
}

.manage-muted {
  margin: 0 0 10px;
  color: #8f98a0;
  font-size: 13px;
}

.manage-warn {
  margin: 0 0 6px;
  color: #fde68a;
  font-size: 13px;
}

.manage-path {
  margin: 0 0 10px;
  color: #c7d5e0;
  font-size: 13px;
  word-break: break-all;
}

.manage-kicker {
  margin: 0 0 6px;
  color: #8f98a0;
  font-size: 11px;
  letter-spacing: 0.05em;
}

.manage-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.btn-outline {
  height: 34px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  background: transparent;
  color: #e8eef7;
  font-size: 13px;
  cursor: pointer;
}

.btn-outline:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
}

.btn-outline:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.btn-outline--danger {
  border-color: rgba(244, 63, 94, 0.45);
  color: #fda4af;
}

.btn-outline--sky {
  border-color: rgba(102, 192, 244, 0.45);
  color: #66c0f4;
}

.draft-hint {
  margin: 12px 0;
  color: #8f98a0;
  font-size: 13px;
}

.draft-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

@media (max-width: 900px) {
  .detail-grid {
    grid-template-columns: 1fr;
  }

  .action-bar__tools {
    margin-left: 0;
  }
}
</style>
