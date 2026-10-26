<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { open } from "@tauri-apps/plugin-dialog";
import { usePcsx2RaStore } from "../stores/pcsx2Ra";
import { useAuthStore } from "../stores/auth";
import { retroAchievementsApiService } from "../services/retroAchievementsApi.service";
import {
  isPcsx2Runtime,
  isRetroArchRuntime,
} from "../services/raEmulator.service";
import {
  importEdenFirmwareZip,
  initializeBlazeEmulators,
  openManagedEdenKeysFolder,
  openManagedPcsx2BiosFolder,
  type EmulatorSetupStatus,
} from "../services/emulatorData.service";
import {
  controllerPrefsService,
  type ControllerLayout,
} from "../services/controllerPrefs.service";
import {
  runtimeConfigService,
  type GameControllerInfo,
} from "../services/runtimeConfig.service";
import {
  emulationPrefsService,
  type EmulationKindPrefs,
  type EmulationPrefsMap,
  type EmulationRuntimeKind,
} from "../services/emulationPrefs.service";
import {
  getEmulatorConfigCapabilities,
  RENDERER_OPTIONS,
  type EmulatorConfigCapabilities,
} from "../services/emulatorConfigService";

const router = useRouter();
const ra = usePcsx2RaStore();
const auth = useAuthStore();
const { entries, status, loading, opening, error, indicator } = storeToRefs(ra);
const { user } = storeToRefs(auth);

const apiConfigured = ref<boolean | null>(null);
const apiStatusError = ref<string | null>(null);
const emuSetup = ref<EmulatorSetupStatus | null>(null);
const emuBusy = ref(false);
const emuMessage = ref<string | null>(null);

const controllers = ref<GameControllerInfo[]>([]);
const controllersBusy = ref(false);
const controllerLayout = ref<ControllerLayout>("auto");
const preferredGuid = ref<string>("");
const controllerMsg = ref<string | null>(null);
const controllerErr = ref<string | null>(null);
const testPadBusy = ref(false);

const emuKind = ref<EmulationRuntimeKind>("pcsx2");
const emuForm = ref<EmulationKindPrefs>({
  fullscreen: true,
  resolutionScale: 2,
  renderer: "d3d11",
  vsync: true,
  audioEngine: "xaudio2",
  volume: 80,
});
const emuCaps = ref<EmulatorConfigCapabilities | null>(null);
const emuAll = ref<EmulationPrefsMap | null>(null);
const emuSaveMsg = ref<string | null>(null);
const emuSaveErr = ref<string | null>(null);
const emuSaveBusy = ref(false);

const rendererOptions = computed(() => RENDERER_OPTIONS[emuKind.value] ?? []);

const scaleOptions = computed(() => {
  const max = emuCaps.value?.maxResolutionScale ?? 4;
  return Array.from({ length: max }, (_, i) => i + 1);
});

const audioEngineOptions = computed(() => {
  if (emuKind.value === "pcsx2") {
    return [
      { value: "xaudio2", label: "XAudio2" },
      { value: "wasapi", label: "WASAPI" },
      { value: "auto", label: "Auto" },
    ];
  }
  if (emuKind.value === "retroarch") {
    return [
      { value: "wasapi", label: "WASAPI" },
      { value: "xaudio2", label: "XAudio" },
      { value: "auto", label: "Auto" },
    ];
  }
  return [{ value: "auto", label: "Sistema (Eden)" }];
});

onMounted(() => {
  void ra.refresh();
  void loadApiStatus();
  void loadEmuSetup();
  void loadControllersSection();
  void loadEmulationSection();
});

async function loadControllersSection() {
  controllersBusy.value = true;
  controllerErr.value = null;
  try {
    const prefs = await controllerPrefsService.get();
    controllerLayout.value = prefs.layout;
    preferredGuid.value = prefs.preferredDeviceGuid ?? "";
    controllers.value = await runtimeConfigService.listControllers();
  } catch (e) {
    controllerErr.value =
      e instanceof Error ? e.message : "No se pudieron listar los mandos.";
    controllers.value = [];
  } finally {
    controllersBusy.value = false;
  }
}

async function saveControllerPrefs() {
  controllerMsg.value = null;
  controllerErr.value = null;
  try {
    await controllerPrefsService.set({
      layout: controllerLayout.value,
      preferredDeviceGuid: preferredGuid.value.trim() || null,
    });
    controllerMsg.value = "Preferencias de mando guardadas.";
    await loadControllersSection();
  } catch (e) {
    controllerErr.value =
      e instanceof Error ? e.message : "No se pudieron guardar las preferencias.";
  }
}

async function testPreferredPad() {
  testPadBusy.value = true;
  controllerMsg.value = null;
  controllerErr.value = null;
  try {
    controllerMsg.value = "Mové un stick o apretá un botón (4 s)…";
    const ok = await controllerPrefsService.testPad(
      preferredGuid.value.trim() || null,
    );
    controllerMsg.value = ok
      ? "Mando OK: Blaze recibió input."
      : "Sin input. Reconectá el USB o cerrá Steam Input.";
  } catch (e) {
    controllerErr.value =
      e instanceof Error ? e.message : "No se pudo probar el mando.";
  } finally {
    testPadBusy.value = false;
  }
}

function controllerKindLabel(kind: string | undefined): string {
  if (kind === "playstation") return "PlayStation";
  if (kind === "xbox") return "Xbox";
  return "";
}

function controllerPlayerLabel(c: GameControllerInfo): string {
  if (c.id === "none" || !c.player) return c.name;
  const kind = controllerKindLabel(c.kind);
  return kind
    ? `Player ${c.player} — ${c.name} · ${kind}`
    : `Player ${c.player} — ${c.name}`;
}

async function loadEmulationSection() {
  emuSaveErr.value = null;
  try {
    const all = await emulationPrefsService.get();
    emuAll.value = all;
    await selectEmuKind(emuKind.value);
  } catch (e) {
    emuSaveErr.value =
      e instanceof Error ? e.message : "No se pudo cargar Emulación.";
  }
}

async function selectEmuKind(kind: EmulationRuntimeKind) {
  emuKind.value = kind;
  emuSaveMsg.value = null;
  try {
    emuCaps.value = await getEmulatorConfigCapabilities(kind);
  } catch {
    emuCaps.value = null;
  }
  if (!emuAll.value) {
    emuAll.value = await emulationPrefsService.get();
  }
  const map = emuAll.value;
  if (!map) return;
  emuForm.value = { ...map[kind] };
}

async function saveEmulationPrefs() {
  emuSaveBusy.value = true;
  emuSaveMsg.value = null;
  emuSaveErr.value = null;
  try {
    const all = emuAll.value ?? (await emulationPrefsService.get());
    all[emuKind.value] = { ...emuForm.value };
    emuAll.value = all;
    await emulationPrefsService.set(all);
    emuSaveMsg.value =
      "Emulación guardada. Se aplica al jugar (y ya a configs managed).";
  } catch (e) {
    emuSaveErr.value =
      e instanceof Error ? e.message : "No se pudo guardar Emulación.";
  } finally {
    emuSaveBusy.value = false;
  }
}

async function loadEmuSetup() {
  try {
    emuSetup.value = await initializeBlazeEmulators();
  } catch {
    emuSetup.value = null;
  }
}

async function openEdenKeys() {
  emuBusy.value = true;
  emuMessage.value = null;
  try {
    const dir = await openManagedEdenKeysFolder();
    emuMessage.value = `Carpeta keys: ${dir}`;
    await loadEmuSetup();
  } catch (e) {
    emuMessage.value = e instanceof Error ? e.message : String(e);
  } finally {
    emuBusy.value = false;
  }
}

async function openPcsx2Bios() {
  emuBusy.value = true;
  emuMessage.value = null;
  try {
    const dir = await openManagedPcsx2BiosFolder();
    emuMessage.value = `Carpeta BIOS: ${dir}`;
    await loadEmuSetup();
  } catch (e) {
    emuMessage.value = e instanceof Error ? e.message : String(e);
  } finally {
    emuBusy.value = false;
  }
}

async function pickEdenFirmware() {
  emuBusy.value = true;
  emuMessage.value = null;
  try {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Firmware Switch", extensions: ["zip"] }],
    });
    if (!selected || Array.isArray(selected)) {
      return;
    }
    emuMessage.value =
      "Importando firmware (puede tardar 1–2 min, no cierres Blaze)…";
    const dest = await importEdenFirmwareZip(selected);
    emuMessage.value = dest;
    await loadEmuSetup();
  } catch (e) {
    emuMessage.value = e instanceof Error ? e.message : String(e);
  } finally {
    emuBusy.value = false;
  }
}

async function loadApiStatus() {
  apiStatusError.value = null;
  try {
    const s = await retroAchievementsApiService.getStatus();
    apiConfigured.value = s.apiConfigured;
  } catch {
    apiConfigured.value = null;
    apiStatusError.value =
      "No se pudo consultar el estado de la Web API (¿backend en marcha?).";
  }
}

async function refresh() {
  await Promise.all([ra.refresh(), loadApiStatus()]);
}

function kindLabel(kind: string): string {
  if (kind === "pcsx2") return "PCSX2";
  if (kind === "retroarch") return "RetroArch";
  if (kind === "eden") return "Eden";
  return kind;
}

function dotClass(color: string): string {
  switch (color) {
    case "emerald":
      return "bg-emerald-400";
    case "amber":
      return "bg-amber-400";
    case "rose":
      return "bg-rose-400";
    default:
      return "bg-slate-500";
  }
}

function entryDot(statusCode: string): string {
  switch (statusCode) {
    case "ready":
      return "bg-emerald-400";
    case "disabled":
      return "bg-amber-400";
    case "not_configured":
      return "bg-rose-400";
    default:
      return "bg-slate-500";
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl px-6 py-10">
    <button
      type="button"
      class="mb-6 text-sm text-slate-400 hover:text-white"
      @click="router.push('/')"
    >
      ← Biblioteca
    </button>

    <h1 class="mb-2 text-3xl font-semibold text-white">Configuración</h1>
    <p class="mb-8 text-sm text-slate-400">
      La sesión de Blaze es tu cuenta de RetroAchievements. Los logros dentro
      del juego siguen pidiendo login en el emulador (una vez).
    </p>

    <section class="mb-6 rounded-2xl border border-white/10 bg-slate-900/50 p-6">
      <h2 class="mb-1 text-lg font-medium text-white">Blaze</h2>
      <p class="mb-4 text-sm text-slate-400">Sesión de la aplicación.</p>
      <p v-if="user" class="text-sm text-slate-200">
        Conectado como:
        <span class="font-medium text-white">{{ user.username }}</span>
        <span v-if="user.email" class="text-slate-500"> ({{ user.email }})</span>
      </p>
      <p v-else class="text-sm text-slate-400">Sin sesión.</p>
    </section>

    <section class="mb-6 rounded-2xl border border-white/10 bg-slate-900/50 p-6">
      <h2 class="mb-1 text-lg font-medium text-white">Emulación</h2>
      <p class="mb-4 text-sm text-slate-400">
        Fuente de verdad al jugar. Se escribe en el emulador antes de cada
        partida — sin abrir su ventana.
      </p>
      <p v-if="emuSaveErr" class="mb-3 text-sm text-rose-300">{{ emuSaveErr }}</p>
      <p v-if="emuSaveMsg" class="mb-3 text-sm text-emerald-300">{{ emuSaveMsg }}</p>

      <div class="mb-4 flex flex-wrap gap-2">
        <button
          v-for="k in (['pcsx2', 'retroarch', 'eden'] as const)"
          :key="k"
          type="button"
          class="rounded-lg px-3 py-1.5 text-sm"
          :class="
            emuKind === k
              ? 'bg-sky-500 text-slate-950'
              : 'border border-white/10 text-slate-200 hover:bg-white/5'
          "
          @click="selectEmuKind(k)"
        >
          {{ kindLabel(k) }}
        </button>
      </div>

      <label class="mb-3 flex items-center gap-2 text-sm text-slate-300">
        <input v-model="emuForm.fullscreen" type="checkbox" class="rounded" />
        Pantalla completa al jugar
      </label>

      <label class="mb-3 block text-sm text-slate-300">
        Escala
        <select
          v-model.number="emuForm.resolutionScale"
          class="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
        >
          <option v-for="s in scaleOptions" :key="s" :value="s">
            {{ s === 1 ? "Nativa (1x)" : `${s}x` }}
          </option>
        </select>
      </label>

      <label class="mb-3 block text-sm text-slate-300">
        Renderer
        <select
          v-model="emuForm.renderer"
          class="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
        >
          <option
            v-for="opt in rendererOptions"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </option>
        </select>
      </label>

      <label class="mb-3 flex items-center gap-2 text-sm text-slate-300">
        <input v-model="emuForm.vsync" type="checkbox" class="rounded" />
        VSync
      </label>

      <label
        v-if="emuKind !== 'eden'"
        class="mb-3 block text-sm text-slate-300"
      >
        Audio
        <select
          v-model="emuForm.audioEngine"
          class="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
        >
          <option
            v-for="opt in audioEngineOptions"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </option>
        </select>
      </label>

      <label class="mb-4 block text-sm text-slate-300">
        Volumen ({{ emuForm.volume }})
        <input
          v-model.number="emuForm.volume"
          type="range"
          min="0"
          max="100"
          class="mt-1 w-full"
        />
      </label>

      <button
        type="button"
        class="rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-50"
        :disabled="emuSaveBusy"
        @click="saveEmulationPrefs"
      >
        {{ emuSaveBusy ? "Guardando…" : "Guardar emulación" }}
      </button>
    </section>

    <section class="mb-6 rounded-2xl border border-white/10 bg-slate-900/50 p-6">
      <h2 class="mb-1 text-lg font-medium text-white">Mandos</h2>
      <p class="mb-4 text-sm text-slate-400">
        Si hay 1 mando → Player 1; si hay 2 → Player 1 y Player 2 (y así).
        Se aplica solo al jugar en PCSX2, RetroArch y Eden.
      </p>
      <p v-if="controllerErr" class="mb-3 text-sm text-rose-300">{{ controllerErr }}</p>
      <p v-if="controllerMsg" class="mb-3 text-sm text-emerald-300">{{ controllerMsg }}</p>

      <div class="mb-4">
        <p class="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          Jugadores detectados
          <span v-if="controllers.filter((x) => x.id !== 'none').length" class="normal-case text-slate-400">
            ({{ controllers.filter((x) => x.id !== 'none').length }})
          </span>
        </p>
        <ul
          v-if="controllers.length"
          class="mb-2 space-y-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-200"
        >
          <li v-for="c in controllers" :key="c.id">
            {{ controllerPlayerLabel(c) }}
          </li>
        </ul>
        <button
          type="button"
          class="text-xs text-sky-300 hover:text-sky-200 disabled:opacity-50"
          :disabled="controllersBusy"
          @click="loadControllersSection"
        >
          {{ controllersBusy ? "Buscando…" : "Actualizar lista" }}
        </button>
        <p class="mt-2 text-xs text-slate-500">
          Si no aparece el PS4/PS5, cerrá Steam (Steam Input) y reconectá el USB.
        </p>
      </div>

      <label class="mb-3 block text-sm text-slate-300">
        Layout preferido
        <select
          v-model="controllerLayout"
          class="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
        >
          <option value="auto">Automático</option>
          <option value="playstation">PlayStation</option>
          <option value="xbox">Xbox</option>
        </select>
      </label>

      <label class="mb-4 block text-sm text-slate-300">
        Mando principal (Player 1)
        <select
          v-model="preferredGuid"
          class="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white"
        >
          <option value="">Primero detectado</option>
          <option
            v-for="c in controllers.filter((x) => x.id !== 'none')"
            :key="c.id"
            :value="c.guid || c.id"
          >
            {{ controllerPlayerLabel(c) }}
          </option>
        </select>
      </label>

      <div class="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          class="rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-sky-400"
          @click="saveControllerPrefs"
        >
          Guardar mandos
        </button>
        <button
          type="button"
          class="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50"
          :disabled="testPadBusy"
          @click="testPreferredPad"
        >
          {{ testPadBusy ? "Escuchando…" : "Probar mando" }}
        </button>
      </div>
    </section>

    <section class="mb-6 rounded-2xl border border-white/10 bg-slate-900/50 p-6">
      <h2 class="mb-1 text-lg font-medium text-white">Emuladores (datos)</h2>
      <p class="mb-4 text-sm text-slate-400">
        BIOS PS2, keys y firmware Switch vienen con el instalador. Las carpetas
        de abajo son solo por si hace falta revisar o reemplazar a mano.
      </p>
      <ul class="mb-4 space-y-2 text-sm text-slate-300">
        <li>
          PCSX2 BIOS:
          <span :class="emuSetup?.pcsx2BiosFound ? 'text-emerald-400' : 'text-amber-300'">
            {{ emuSetup?.pcsx2BiosFound ? "lista" : "faltante" }}
          </span>
        </li>
        <li>
          Eden keys (prod.keys):
          <span :class="emuSetup?.edenKeysFound ? 'text-emerald-400' : 'text-amber-300'">
            {{ emuSetup?.edenKeysFound ? "lista" : "faltante" }}
          </span>
        </li>
        <li>
          Eden firmware:
          <span
            :class="emuSetup?.edenFirmwareFound ? 'text-emerald-400' : 'text-amber-300'"
          >
            {{ emuSetup?.edenFirmwareFound ? "instalado" : "faltante" }}
          </span>
        </li>
      </ul>
      <p v-if="emuMessage" class="mb-3 text-xs text-slate-400">{{ emuMessage }}</p>
      <div class="flex flex-wrap gap-3">
        <button
          type="button"
          class="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50"
          :disabled="emuBusy"
          @click="openPcsx2Bios"
        >
          Abrir carpeta BIOS PCSX2
        </button>
        <button
          type="button"
          class="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50"
          :disabled="emuBusy"
          @click="openEdenKeys"
        >
          Abrir carpeta keys Eden
        </button>
        <button
          type="button"
          class="rounded-lg bg-violet-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-50"
          :disabled="emuBusy"
          @click="pickEdenFirmware"
        >
          Importar firmware Switch (.zip)
        </button>
      </div>
    </section>

    <section class="rounded-2xl border border-white/10 bg-slate-900/50 p-6">
      <div class="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 class="text-lg font-medium text-white">RetroAchievements</h2>
          <p class="mt-1 text-sm text-slate-400">
            Login en el emulador · progreso vía Web API (backend local)
          </p>
        </div>
        <button
          type="button"
          class="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50"
          :disabled="loading"
          @click="refresh"
        >
          Actualizar
        </button>
      </div>

      <p
        v-if="error"
        class="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
      >
        {{ error }}
      </p>

      <div v-if="loading && entries.length === 0" class="py-8 text-center text-slate-400">
        Consultando emuladores...
      </div>

      <template v-else>
        <div class="mb-4 flex items-center gap-3">
          <span
            class="inline-block h-2.5 w-2.5 rounded-full"
            :class="dotClass(indicator.color)"
          />
          <div>
            <p class="text-sm text-slate-300">Mejor estado detectado</p>
            <p class="text-base font-medium text-white">{{ indicator.label }}</p>
          </div>
        </div>

        <ul v-if="entries.length" class="mb-6 space-y-3">
          <li
            v-for="entry in entries"
            :key="entry.runtime.id"
            class="rounded-lg border border-white/10 bg-black/20 px-4 py-3"
          >
            <div class="mb-2 flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <span
                  class="inline-block h-2 w-2 rounded-full"
                  :class="entryDot(entry.status.status)"
                />
                <p class="text-sm font-medium text-white">
                  {{ entry.runtime.name }}
                  <span class="text-xs font-normal text-slate-500">
                    ({{ kindLabel(entry.status.emulatorKind) }})
                  </span>
                </p>
              </div>
              <button
                type="button"
                class="text-xs text-sky-300 hover:text-sky-200 disabled:opacity-50"
                :disabled="opening"
                @click="ra.openEmulator(entry.runtime)"
              >
                Abrir
              </button>
            </div>
            <p class="text-xs text-slate-400">{{ entry.status.statusLabel }}</p>
            <p v-if="entry.status.username" class="text-xs text-slate-300">
              Usuario: {{ entry.status.username }}
            </p>
            <p class="truncate text-xs text-slate-600">
              {{ entry.runtime.executablePath }}
            </p>
          </li>
        </ul>

        <dl class="mb-6 grid gap-3 text-sm text-slate-300">
          <div v-if="status?.username">
            <dt class="text-slate-500">Usuario RA (activo)</dt>
            <dd class="text-white">{{ status.username }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">Web API (backend)</dt>
            <dd>
              <template v-if="apiConfigured === true">Configurada</template>
              <template v-else-if="apiConfigured === false">
                Sin API Key en el servidor
              </template>
              <template v-else>Desconocido</template>
            </dd>
          </div>
        </dl>

        <p v-if="apiStatusError" class="mb-4 text-xs text-amber-200/90">
          {{ apiStatusError }}
        </p>

        <div
          class="mb-6 rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-400"
        >
          <p class="mb-2 font-medium text-slate-300">Cómo configurar</p>
          <ol class="list-decimal space-y-1 pl-4">
            <li>
              Login RA en <strong class="text-slate-300">PCSX2</strong> (Logros) y/o
              <strong class="text-slate-300">RetroArch</strong> (Ajustes → Logros).
            </li>
            <li>
              Web API Key solo en
              <code class="text-slate-300">back/.env</code>
              (<code class="text-slate-300">RETROACHIEVEMENTS_API_KEY</code>).
            </li>
            <li>En cada juego, vinculá el ID oficial de RetroAchievements.</li>
          </ol>
        </div>

        <div class="flex flex-wrap gap-3">
          <button
            type="button"
            class="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-50"
            :disabled="opening || !entries.some((e) => isPcsx2Runtime(e.runtime))"
            @click="ra.openPcsx2()"
          >
            Abrir PCSX2
          </button>
          <button
            type="button"
            class="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
            :disabled="
              opening || !entries.some((e) => isRetroArchRuntime(e.runtime))
            "
            @click="ra.openRetroArch()"
          >
            Abrir RetroArch
          </button>
          <button
            type="button"
            class="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/5"
            @click="router.push('/runtimes')"
          >
            Ir a Runtimes
          </button>
        </div>
      </template>
    </section>
  </div>
</template>
