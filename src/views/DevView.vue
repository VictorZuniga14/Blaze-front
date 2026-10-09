<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { open } from "@tauri-apps/plugin-dialog";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";
import { useCatalogCoversStore } from "../stores/catalogCovers";
import { catalogPublishService } from "../services/catalogPublish.service";
import { catalogApiService } from "../services/catalogApi.service";
import { uploadOrphanToR2 } from "../services/catalogOrphanUpload.service";
import { formatBytes } from "../services/catalogTransfer.service";
import { RA_CONSOLE_LABELS, type RaConsoleKey } from "../utils/raConsoles";
import type { R2OrphanObject } from "../types/catalog";

const router = useRouter();
const auth = useAuthStore();
const catalogCovers = useCatalogCoversStore();
const { isDev } = storeToRefs(auth);

const orphans = ref<R2OrphanObject[]>([]);
const loadingOrphans = ref(false);
const uploadBusy = ref(false);
const uploadProgress = ref<string | null>(null);
const linkBusy = ref(false);
const error = ref<string | null>(null);
const ok = ref<string | null>(null);

const linkTitle = ref("");
const linkPlatform = ref<string>("PlayStation 2");
const linkStorageKey = ref<string | null>(null);

const platformOptions = computed(() =>
  (Object.keys(RA_CONSOLE_LABELS) as RaConsoleKey[]).map((key) => ({
    key,
    label: RA_CONSOLE_LABELS[key],
  })),
);

const contentOrphans = computed(() =>
  orphans.value.filter((o) => o.kind === "content"),
);

async function refreshOrphans(): Promise<void> {
  loadingOrphans.value = true;
  error.value = null;
  try {
    orphans.value = await catalogApiService.listR2Orphans();
  } catch (err) {
    error.value =
      err instanceof Error
        ? err.message
        : "No se pudieron listar los archivos de R2.";
    orphans.value = [];
  } finally {
    loadingOrphans.value = false;
  }
}

async function pickAndUpload(): Promise<void> {
  if (uploadBusy.value) return;
  error.value = null;
  ok.value = null;
  const selected = await open({
    multiple: false,
    title: "Elegir ISO / zip / ROM para R2",
  });
  if (typeof selected !== "string" || !selected) return;

  uploadBusy.value = true;
  uploadProgress.value = "Preparando…";
  try {
    const obj = await uploadOrphanToR2(selected, (p) => {
      const pct =
        p.bytesTotal > 0
          ? Math.round((p.bytesDone / p.bytesTotal) * 100)
          : 0;
      uploadProgress.value = `${p.message} ${formatBytes(p.bytesDone)} / ${formatBytes(p.bytesTotal)} (${pct}%)`;
    });
    ok.value = `Subido: ${obj.fileName} (${formatBytes(Number(obj.sizeBytes))})`;
    uploadProgress.value = null;
    linkStorageKey.value = obj.key;
    await refreshOrphans();
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : "No se pudo subir el archivo.";
    uploadProgress.value = null;
  } finally {
    uploadBusy.value = false;
  }
}

async function deleteOrphan(key: string): Promise<void> {
  error.value = null;
  ok.value = null;
  try {
    await catalogApiService.deleteR2Object(key);
    if (linkStorageKey.value === key) linkStorageKey.value = null;
    ok.value = "Archivo eliminado de R2.";
    await refreshOrphans();
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : "No se pudo borrar el archivo.";
  }
}

function suggestCover(contentKey: string): string | null {
  const slash = contentKey.lastIndexOf("/");
  if (slash <= 0) return null;
  const prefix = `${contentKey.slice(0, slash)}/cover/`;
  return (
    orphans.value.find((o) => o.kind === "cover" && o.key.startsWith(prefix))
      ?.key ?? null
  );
}

async function publishFromR2(): Promise<void> {
  if (linkBusy.value || !linkStorageKey.value) return;
  error.value = null;
  ok.value = null;
  linkBusy.value = true;
  try {
    const coverKey = suggestCover(linkStorageKey.value);
    const linked = await catalogPublishService.publishCatalogFromR2({
      title: linkTitle.value,
      platform: linkPlatform.value,
      storageKey: linkStorageKey.value,
      coverStorageKey: coverKey,
    });
    await catalogCovers.refresh();
    await refreshOrphans();
    const raNote = linked.raMessage ? ` RA: ${linked.raMessage}` : "";
    ok.value = `Publicado en Juegos. No se tocó la biblioteca.${raNote}`;
    linkTitle.value = "";
    linkStorageKey.value = null;
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : "No se pudo publicar el juego.";
  } finally {
    linkBusy.value = false;
  }
}

onMounted(() => {
  if (!isDev.value) {
    void router.replace("/");
    return;
  }
  void refreshOrphans();
});
</script>

<template>
  <main class="dev">
    <header class="dev-hero">
      <p class="dev-kicker">Solo desarrolladores</p>
      <h1 class="dev-title">Panel Dev</h1>
      <p class="dev-lead">
        Subí ISOs a R2, vinculalos a un juego del catálogo y gestioná lo que ven
        tus amigos — sin mezclarlo con la biblioteca del usuario normal.
      </p>
    </header>

    <p v-if="error" class="dev-banner dev-banner--err">{{ error }}</p>
    <p v-if="ok" class="dev-banner dev-banner--ok">{{ ok }}</p>

    <div class="dev-grid">
      <section class="dev-card">
        <div class="dev-card__head">
          <span class="dev-step">1</span>
          <div>
            <h2>Subir a R2</h2>
            <p>Sin crear juego. El archivo queda listo para asignar después.</p>
          </div>
        </div>
        <button
          type="button"
          class="dev-btn"
          :disabled="uploadBusy"
          @click="pickAndUpload"
        >
          {{ uploadBusy ? "Subiendo…" : "Elegir archivo e subir" }}
        </button>
        <p v-if="uploadProgress" class="dev-muted">{{ uploadProgress }}</p>
      </section>

      <section class="dev-card">
        <div class="dev-card__head">
          <span class="dev-step">2</span>
          <div>
            <h2>Archivos en R2 (sin juego)</h2>
            <p>Huérfanos: subidos o legacy aún no vinculados al catálogo.</p>
          </div>
        </div>
        <div class="dev-card__tools">
          <button
            type="button"
            class="dev-btn dev-btn--ghost"
            :disabled="loadingOrphans"
            @click="refreshOrphans"
          >
            {{ loadingOrphans ? "Cargando…" : "Actualizar lista" }}
          </button>
        </div>
        <ul v-if="contentOrphans.length" class="dev-list">
          <li v-for="obj in contentOrphans" :key="obj.key" class="dev-list__item">
            <button
              type="button"
              class="dev-list__pick"
              :class="{ 'dev-list__pick--on': linkStorageKey === obj.key }"
              @click="linkStorageKey = obj.key"
            >
              <span class="dev-list__name">{{ obj.fileName }}</span>
              <span class="dev-list__meta">
                {{ formatBytes(Number(obj.sizeBytes)) }}
              </span>
            </button>
            <button
              type="button"
              class="dev-list__del"
              title="Borrar de R2"
              @click="deleteOrphan(obj.key)"
            >
              Borrar
            </button>
          </li>
        </ul>
        <p v-else-if="!loadingOrphans" class="dev-muted">
          No hay archivos huérfanos. Subí uno en el paso 1.
        </p>
      </section>

      <section class="dev-card dev-card--wide">
        <div class="dev-card__head">
          <span class="dev-step">3</span>
          <div>
            <h2>Publicar en catálogo</h2>
            <p>
              Solo se publica en <strong>Juegos</strong>. La biblioteca no se
              toca: tus amigos lo ven en el catálogo y lo bajan si quieren.
            </p>
          </div>
        </div>

        <div class="dev-form">
          <label class="dev-field">
            <span>Archivo R2</span>
            <select v-model="linkStorageKey" class="dev-input">
              <option :value="null" disabled>Elegí un archivo…</option>
              <option
                v-for="obj in contentOrphans"
                :key="obj.key"
                :value="obj.key"
              >
                {{ obj.fileName }} ({{ formatBytes(Number(obj.sizeBytes)) }})
              </option>
            </select>
          </label>

          <label class="dev-field">
            <span>Título</span>
            <input
              v-model="linkTitle"
              type="text"
              class="dev-input"
              placeholder="Ej. God of War"
            />
          </label>

          <label class="dev-field">
            <span>Plataforma</span>
            <select v-model="linkPlatform" class="dev-input">
              <option
                v-for="opt in platformOptions"
                :key="opt.key"
                :value="opt.label"
              >
                {{ opt.label }}
              </option>
            </select>
          </label>
        </div>

        <button
          type="button"
          class="dev-btn"
          :disabled="linkBusy || !linkStorageKey"
          @click="publishFromR2"
        >
          {{ linkBusy ? "Publicando…" : "Publicar sin re-subir" }}
        </button>
      </section>

      <section class="dev-card">
        <div class="dev-card__head">
          <span class="dev-step">·</span>
          <div>
            <h2>Atajos</h2>
            <p>Herramientas que el usuario normal no ve en la biblioteca.</p>
          </div>
        </div>
        <div class="dev-links">
          <RouterLink to="/games/new" class="dev-link">+ Crear juego local</RouterLink>
          <RouterLink to="/runtimes" class="dev-link">Runtimes</RouterLink>
          <RouterLink to="/settings" class="dev-link">Configuración</RouterLink>
          <RouterLink to="/juegos" class="dev-link">Ver catálogo</RouterLink>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.dev {
  min-height: calc(100vh - 80px);
  padding: 28px 32px 48px;
  background:
    radial-gradient(900px 420px at 10% -10%, rgba(102, 192, 244, 0.12), transparent 55%),
    linear-gradient(180deg, #1b2838 0%, #171a21 45%, #0e1419 100%);
  color: #c7d5e0;
}

.dev-hero {
  max-width: 720px;
  margin-bottom: 28px;
}

.dev-kicker {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #66c0f4;
}

.dev-title {
  margin: 0 0 10px;
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #fff;
}

.dev-lead {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.5;
  color: #8f98a0;
}

.dev-banner {
  margin: 0 0 18px;
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 0.875rem;
}

.dev-banner--err {
  background: rgba(231, 76, 60, 0.15);
  color: #ffb4a9;
  border: 1px solid rgba(231, 76, 60, 0.35);
}

.dev-banner--ok {
  background: rgba(90, 180, 120, 0.12);
  color: #b6e3c4;
  border: 1px solid rgba(90, 180, 120, 0.35);
}

.dev-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}

.dev-card {
  padding: 20px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(23, 26, 33, 0.85);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
}

.dev-card--wide {
  grid-column: 1 / -1;
}

.dev-card__head {
  display: flex;
  gap: 14px;
  margin-bottom: 16px;
}

.dev-card__head h2 {
  margin: 0 0 4px;
  font-size: 1.1rem;
  color: #fff;
}

.dev-card__head p {
  margin: 0;
  font-size: 0.85rem;
  color: #8f98a0;
  line-height: 1.4;
}

.dev-step {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: #66c0f4;
  color: #0e1419;
  font-size: 0.85rem;
  font-weight: 800;
}

.dev-card__tools {
  margin-bottom: 12px;
}

.dev-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 0 16px;
  border: none;
  border-radius: 8px;
  background: #66c0f4;
  color: #0e1419;
  font-size: 0.875rem;
  font-weight: 700;
  cursor: pointer;
}

.dev-btn:hover:not(:disabled) {
  filter: brightness(1.06);
}

.dev-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.dev-btn--ghost {
  background: transparent;
  color: #66c0f4;
  border: 1px solid rgba(102, 192, 244, 0.45);
}

.dev-muted {
  margin: 12px 0 0;
  font-size: 0.8rem;
  color: #8f98a0;
}

.dev-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 280px;
  overflow: auto;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
}

.dev-list__item {
  display: flex;
  gap: 8px;
  align-items: stretch;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.dev-list__item:last-child {
  border-bottom: none;
}

.dev-list__pick {
  flex: 1;
  min-width: 0;
  text-align: left;
  padding: 10px 12px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.dev-list__pick:hover,
.dev-list__pick--on {
  background: rgba(102, 192, 244, 0.1);
}

.dev-list__name {
  display: block;
  font-size: 0.85rem;
  color: #e8eef2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dev-list__meta {
  display: block;
  margin-top: 2px;
  font-size: 0.75rem;
  color: #8f98a0;
}

.dev-list__del {
  border: none;
  background: transparent;
  color: #c45c5c;
  font-size: 0.75rem;
  padding: 0 12px;
  cursor: pointer;
}

.dev-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.dev-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #8f98a0;
}

.dev-input {
  min-height: 40px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #0e1419;
  color: #e8eef2;
  font-size: 0.875rem;
  font-weight: 400;
  letter-spacing: normal;
  text-transform: none;
}

.dev-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.dev-link {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #c7d5e0;
  text-decoration: none;
  font-size: 0.85rem;
}

.dev-link:hover {
  border-color: rgba(102, 192, 244, 0.5);
  color: #fff;
}

@media (max-width: 900px) {
  .dev-grid,
  .dev-form {
    grid-template-columns: 1fr;
  }

  .dev-card--wide {
    grid-column: auto;
  }
}
</style>
