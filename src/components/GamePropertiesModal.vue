<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { Game } from "../types/game";
import { runtimeKindForPlatform } from "../utils/platformRuntime";
import {
  languageLabel,
  resolveAvailableLanguages,
} from "../utils/gameLanguages";
import { gameService } from "../services/game.service";
import { launchConfigService } from "../services/launchConfig.service";
import { gameContentService } from "../services/gameContent.service";
import { runtimeRepository } from "../repositories/runtime.repository";
import { formatBytes } from "../services/catalogTransfer.service";
import { invoke } from "@tauri-apps/api/core";
import {
  runtimeConfigService,
  type AudioDeviceInfo,
  type GameControllerInfo,
} from "../services/runtimeConfig.service";
import { useCatalogDownloadStore } from "../stores/catalogDownload";
import { useLibraryStore } from "../stores/library";
import {
  isEdenRuntime,
  isPcsx2Runtime,
  isRetroArchRuntime,
} from "../services/ra/adapterKind";

const props = defineProps<{
  open: boolean;
  game: Game;
}>();

const emit = defineEmits<{
  close: [];
  updated: [];
}>();

type TabId = "general" | "files" | "control";

const tab = ref<TabId>("general");
const saving = ref(false);
const error = ref<string | null>(null);
const okMsg = ref<string | null>(null);

const preferredLanguage = ref<string>("en");
const contentPath = ref<string | null>(null);
const contentSize = ref<number | null>(null);
const runtimeExe = ref<string | null>(null);
const runtimeSource = ref<string | null>(null);
const engineOptions = ref<string[]>(["cubeb", "sdl2", "auto"]);

const audioDevices = ref<AudioDeviceInfo[]>([]);
const controllers = ref<GameControllerInfo[]>([]);
const outputEngine = ref("cubeb");
const outputDevice = ref("auto");
const volume = ref(100);
const fullscreen = ref(true);
const resolutionScale = ref(1);
const scaleOptions = ref<number[]>([1, 2, 3, 4]);

const catalogDownloads = useCatalogDownloadStore();
const library = useLibraryStore();

const runtimeKind = computed(() =>
  runtimeKindForPlatform(props.game.platform),
);

const runtimeLabel = computed(() => {
  if (runtimeKind.value === "pcsx2") return "PCSX2";
  if (runtimeKind.value === "retroarch") return "RetroArch";
  if (runtimeKind.value === "eden") return "Eden";
  return "emulador";
});

const availableLangs = computed(() =>
  resolveAvailableLanguages(props.game.availableLanguages),
);

const languageLocked = computed(() => availableLangs.value.length <= 1);

const tabs = computed(() => {
  const list: Array<{ id: TabId; label: string }> = [
    { id: "general", label: "General" },
    { id: "files", label: "Archivos instalados" },
  ];
  // Audio/video para cualquier runtime (PS2 / PS1 / Switch / etc.).
  if (runtimeKind.value) {
    list.push({ id: "control", label: "Audio y video" });
  }
  return list;
});

function scaleLabel(scale: number): string {
  if (scale <= 1) return "Nativa (1x)";
  return `${scale}x`;
}

async function loadFiles(): Promise<void> {
  contentPath.value = null;
  contentSize.value = null;
  const content = await gameContentService.getByGameId(props.game.id);
  const config = await launchConfigService.getByGameId(props.game.id);
  const path = content?.path?.trim() || config?.contentPath?.trim() || null;
  contentPath.value = path;
  if (path) {
    try {
      contentSize.value = await invoke<number>("path_file_size", { path });
    } catch {
      contentSize.value = null;
    }
  }
}

async function loadRuntimeAudio(): Promise<void> {
  runtimeExe.value = null;
  runtimeSource.value = null;
  const kind = runtimeKind.value;
  if (!kind) return;

  const config = await launchConfigService.getByGameId(props.game.id);
  if (config?.runtimeId) {
    const rt = await runtimeRepository.findById(config.runtimeId);
    if (rt?.executablePath) {
      runtimeExe.value = rt.executablePath;
      runtimeSource.value = rt.source ?? null;
    }
  }
  if (!runtimeExe.value) {
    const all = await runtimeRepository.findAll();
    const match = all.find((r) => {
      if (kind === "pcsx2") return isPcsx2Runtime(r);
      if (kind === "eden") return isEdenRuntime(r);
      return isRetroArchRuntime(r);
    });
    if (match) {
      runtimeExe.value = match.executablePath;
      runtimeSource.value = match.source ?? null;
    }
  }
  if (!runtimeExe.value) return;

  try {
    audioDevices.value = await runtimeConfigService.listAudioDevices();
    controllers.value = await runtimeConfigService.listControllers();
    const settings = await runtimeConfigService.readAudio({
      executablePath: runtimeExe.value,
      runtimeKind: kind,
      runtimeSource: runtimeSource.value,
    });
    engineOptions.value =
      settings.engines?.length > 0
        ? settings.engines
        : ["cubeb", "sdl2", "auto"];
    outputEngine.value = settings.outputEngine || engineOptions.value[0]!;
    outputDevice.value = settings.outputDevice || "auto";
    volume.value = settings.volume ?? 100;

    const video = await runtimeConfigService.readVideo({
      executablePath: runtimeExe.value,
      runtimeKind: kind,
      runtimeSource: runtimeSource.value,
    });
    fullscreen.value = video.fullscreen;
    resolutionScale.value = video.resolutionScale || 1;
    scaleOptions.value =
      video.scaleOptions?.length > 0 ? video.scaleOptions : [1, 2, 3, 4];
  } catch (e) {
    error.value =
      e instanceof Error
        ? e.message
        : `No se pudo leer la config de ${runtimeLabel.value}.`;
  }
}

async function loadAll(): Promise<void> {
  error.value = null;
  okMsg.value = null;
  const langs = availableLangs.value;
  preferredLanguage.value =
    props.game.preferredLanguage &&
    langs.includes(props.game.preferredLanguage)
      ? props.game.preferredLanguage
      : langs[0]!;
  await loadFiles();
  await loadRuntimeAudio();
}

watch(
  () => props.open,
  (v) => {
    if (v) {
      tab.value = "general";
      void loadAll();
    }
  },
);

onMounted(() => {
  if (props.open) void loadAll();
});

async function saveLanguage(): Promise<void> {
  if (languageLocked.value) return;
  saving.value = true;
  error.value = null;
  try {
    await gameService.setPreferredLanguage(
      props.game.id,
      preferredLanguage.value,
    );
    await library.loadLibrary();
    okMsg.value = "Idioma guardado.";
    emit("updated");
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : "No se pudo guardar el idioma.";
  } finally {
    saving.value = false;
  }
}

async function saveAudio(): Promise<void> {
  const kind = runtimeKind.value;
  if (!runtimeExe.value || !kind) {
    error.value = `No hay ${runtimeLabel.value} instalado para este juego.`;
    return;
  }
  saving.value = true;
  error.value = null;
  okMsg.value = null;
  try {
    await runtimeConfigService.writeAudio({
      executablePath: runtimeExe.value,
      runtimeKind: kind,
      runtimeSource: runtimeSource.value,
      outputEngine: outputEngine.value,
      outputDevice: outputDevice.value,
      volume: volume.value,
    });
    okMsg.value = `Audio de ${runtimeLabel.value} guardado. Volvé a lanzar el juego.`;
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : "No se pudo guardar el audio.";
  } finally {
    saving.value = false;
  }
}

async function saveVideo(): Promise<void> {
  const kind = runtimeKind.value;
  if (!runtimeExe.value || !kind) {
    error.value = `No hay ${runtimeLabel.value} instalado para este juego.`;
    return;
  }
  saving.value = true;
  error.value = null;
  okMsg.value = null;
  try {
    await runtimeConfigService.writeVideo({
      executablePath: runtimeExe.value,
      runtimeKind: kind,
      runtimeSource: runtimeSource.value,
      fullscreen: fullscreen.value,
      resolutionScale: resolutionScale.value,
    });
    okMsg.value = `Video de ${runtimeLabel.value} guardado. Volvé a lanzar el juego.`;
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : "No se pudo guardar el video.";
  } finally {
    saving.value = false;
  }
}

async function openFolder(): Promise<void> {
  if (!contentPath.value) return;
  try {
    await runtimeConfigService.revealInExplorer(contentPath.value);
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : "No se pudo abrir la carpeta.";
  }
}

function repairCatalog(): void {
  catalogDownloads.startDownload(props.game.id, {
    gameTitle: props.game.title,
  });
  okMsg.value = "Descarga encolada en segundo plano.";
}

function close(): void {
  emit("close");
}
</script>

<template>
  <div
    v-if="open"
    class="props-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Propiedades del juego"
    @click.self="close"
  >
    <div class="props-modal">
      <header class="props-modal__head">
        <h2 class="props-modal__title">{{ game.title }}</h2>
        <button type="button" class="props-modal__close" @click="close">
          ✕
        </button>
      </header>

      <div class="props-modal__body">
        <nav class="props-nav">
          <button
            v-for="t in tabs"
            :key="t.id"
            type="button"
            class="props-nav__item"
            :class="{ 'props-nav__item--active': tab === t.id }"
            @click="tab = t.id"
          >
            {{ t.label }}
          </button>
        </nav>

        <div class="props-panel">
          <p v-if="error" class="props-banner props-banner--error">{{ error }}</p>
          <p v-else-if="okMsg" class="props-banner props-banner--ok">{{ okMsg }}</p>

          <template v-if="tab === 'general'">
            <dl class="props-dl">
              <div>
                <dt>Título</dt>
                <dd>{{ game.title }}</dd>
              </div>
              <div v-if="game.platform">
                <dt>Plataforma</dt>
                <dd>{{ game.platform }}</dd>
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

            <label class="props-field">
              <span>Idioma</span>
              <select
                v-model="preferredLanguage"
                class="props-select"
                :disabled="languageLocked || saving"
              >
                <option
                  v-for="code in availableLangs"
                  :key="code"
                  :value="code"
                >
                  {{ languageLabel(code) }}
                </option>
              </select>
              <span v-if="languageLocked" class="props-hint">
                Este juego solo declara un idioma.
              </span>
            </label>
            <button
              v-if="!languageLocked"
              type="button"
              class="props-btn"
              :disabled="saving"
              @click="saveLanguage"
            >
              Guardar idioma
            </button>
          </template>

          <template v-else-if="tab === 'files'">
            <dl class="props-dl">
              <div>
                <dt>Ruta</dt>
                <dd class="props-path">
                  {{ contentPath || "Sin archivo local (pendiente de descarga)." }}
                </dd>
              </div>
              <div v-if="contentSize != null">
                <dt>Tamaño</dt>
                <dd>{{ formatBytes(contentSize) }}</dd>
              </div>
            </dl>
            <div class="props-actions">
              <button
                type="button"
                class="props-btn"
                :disabled="!contentPath"
                @click="openFolder"
              >
                Abrir carpeta
              </button>
              <button
                v-if="game.catalogRemoteId"
                type="button"
                class="props-btn props-btn--sky"
                @click="repairCatalog"
              >
                Reparar / Descargar de nuevo
              </button>
            </div>
          </template>

          <template v-else-if="tab === 'control'">
            <p class="props-hint" style="margin-bottom: 12px">
              Emulador: <strong>{{ runtimeLabel }}</strong>
            </p>
            <p v-if="!runtimeExe" class="props-hint">
              Instalá / descargá el juego primero para configurar
              {{ runtimeLabel }}.
            </p>
            <template v-else>
              <label class="props-field">
                <span>Motor de audio</span>
                <select v-model="outputEngine" class="props-select" :disabled="saving">
                  <option
                    v-for="eng in engineOptions"
                    :key="eng"
                    :value="eng"
                  >
                    {{ eng }}
                  </option>
                </select>
              </label>
              <label class="props-field">
                <span>Dispositivo de salida</span>
                <select v-model="outputDevice" class="props-select" :disabled="saving">
                  <option
                    v-for="d in audioDevices"
                    :key="d.id"
                    :value="d.id"
                  >
                    {{ d.name }}
                  </option>
                </select>
              </label>
              <label class="props-field">
                <span>Volumen ({{ volume }}%)</span>
                <input
                  v-model.number="volume"
                  type="range"
                  min="0"
                  max="100"
                  class="props-range"
                  :disabled="saving"
                />
              </label>

              <div class="props-actions">
                <button
                  type="button"
                  class="props-btn props-btn--sky"
                  :disabled="saving"
                  @click="saveAudio"
                >
                  Guardar audio
                </button>
              </div>

              <hr class="props-sep" />

              <label class="props-check">
                <input
                  v-model="fullscreen"
                  type="checkbox"
                  :disabled="saving"
                />
                <span>Pantalla completa al jugar</span>
              </label>
              <label class="props-field">
                <span>Resolución interna</span>
                <select
                  v-model.number="resolutionScale"
                  class="props-select"
                  :disabled="saving"
                >
                  <option
                    v-for="s in scaleOptions"
                    :key="s"
                    :value="s"
                  >
                    {{ scaleLabel(s) }}
                  </option>
                </select>
              </label>

              <div class="props-controllers">
                <p class="props-controllers__label">Mandos detectados</p>
                <ul>
                  <li v-for="c in controllers" :key="c.id">{{ c.name }}</li>
                </ul>
                <p class="props-hint">
                  Conectá el mando antes de jugar. Audio y video se aplican al
                  relanzar el juego.
                </p>
              </div>

              <div class="props-actions">
                <button
                  type="button"
                  class="props-btn props-btn--sky"
                  :disabled="saving"
                  @click="saveVideo"
                >
                  Guardar video
                </button>
              </div>
            </template>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.props-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.65);
}

.props-modal {
  display: flex;
  flex-direction: column;
  width: min(720px, 100%);
  max-height: min(560px, 90vh);
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  background: #1b2838;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
  color: #c7d5e0;
}

.props-modal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: #171a21;
}

.props-modal__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #fff;
}

.props-modal__close {
  border: 0;
  background: transparent;
  color: #8f98a0;
  font-size: 16px;
  cursor: pointer;
}

.props-modal__close:hover {
  color: #fff;
}

.props-modal__body {
  display: grid;
  grid-template-columns: 180px 1fr;
  min-height: 0;
  flex: 1;
}

.props-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 8px;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(0, 0, 0, 0.2);
}

.props-nav__item {
  padding: 8px 10px;
  border: 0;
  border-radius: 2px;
  background: transparent;
  color: #8f98a0;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.props-nav__item:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.04);
}

.props-nav__item--active {
  color: #fff;
  background: rgba(102, 192, 244, 0.15);
}

.props-panel {
  overflow: auto;
  padding: 16px 18px 20px;
}

.props-banner {
  margin: 0 0 12px;
  padding: 8px 10px;
  border-radius: 3px;
  font-size: 12px;
}

.props-banner--error {
  background: rgba(244, 63, 94, 0.15);
  color: #fecdd3;
}

.props-banner--ok {
  background: rgba(26, 159, 255, 0.12);
  color: #67c1f5;
}

.props-dl {
  margin: 0 0 16px;
}

.props-dl > div {
  margin-bottom: 10px;
}

.props-dl dt {
  margin: 0;
  color: #8f98a0;
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.props-dl dd {
  margin: 2px 0 0;
  color: #c7d5e0;
  font-size: 13px;
}

.props-path {
  word-break: break-all;
  font-size: 12px;
  color: #8f98a0;
}

.props-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  font-size: 12px;
  color: #8f98a0;
}

.props-sep {
  margin: 16px 0;
  border: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.props-check {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  font-size: 13px;
  color: #c7d5e0;
  cursor: pointer;
}

.props-check input {
  width: 16px;
  height: 16px;
  accent-color: #66c0f4;
}

.props-select {
  height: 36px;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 2px;
  background: #171a21;
  color: #c7d5e0;
  font-size: 13px;
}

.props-select:disabled {
  opacity: 0.7;
}

.props-range {
  width: 100%;
}

.props-hint {
  margin: 4px 0 0;
  color: #8f98a0;
  font-size: 12px;
  line-height: 1.4;
}

.props-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.props-btn {
  height: 36px;
  padding: 0 14px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 2px;
  background: transparent;
  color: #c7d5e0;
  font-size: 13px;
  cursor: pointer;
}

.props-btn:hover:not(:disabled) {
  border-color: #67c1f5;
  color: #fff;
}

.props-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.props-btn--sky {
  border: 0;
  background: #66c0f4;
  color: #171a21;
  font-weight: 600;
}

.props-controllers {
  margin: 12px 0;
  padding: 10px 12px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.25);
}

.props-controllers__label {
  margin: 0 0 6px;
  color: #8f98a0;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.props-controllers ul {
  margin: 0;
  padding-left: 18px;
  color: #c7d5e0;
  font-size: 13px;
}

@media (max-width: 640px) {
  .props-modal__body {
    grid-template-columns: 1fr;
  }

  .props-nav {
    flex-direction: row;
    flex-wrap: wrap;
    border-right: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
}
</style>
