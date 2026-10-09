<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useRaProgressStore } from "../stores/raProgress";
import { useLibraryStore } from "../stores/library";
import {
  raIdentifyService,
  type RaIdentifyResult,
} from "../services/raIdentify.service";
import {
  achievementUnlockLabel,
  formatRaProgress,
} from "../utils/raLibraryProgress";

const props = defineProps<{
  gameId: string;
  raGameId: number | null;
  gameTitle: string;
  platform?: string | null;
}>();

const ra = useRaProgressStore();
const library = useLibraryStore();
const { searching, candidates, searchError, raUsername, raReady, raSource } =
  storeToRefs(ra);

const mapInput = ref("");
const searchQuery = ref("");
const mappingBusy = ref(false);
const mappingMessage = ref<string | null>(null);
const identifyBusy = ref(false);
const identifyHint = ref<string | null>(null);
const canIdentify = ref(false);
const lastIdentify = ref<RaIdentifyResult | null>(null);
/** Texto de progreso mientras corre identify / fallback por título. */
const identifyStatus = ref<string | null>(null);

const entry = computed(() => ra.entryFor(props.gameId));
const progress = computed(() => entry.value?.progress ?? null);
const uiState = computed(() => {
  if (!props.raGameId) return "not_mapped" as const;
  return entry.value?.uiState ?? "idle";
});
const slotError = computed(() => entry.value?.error ?? null);
const refreshing = computed(() => entry.value?.refreshing ?? false);
const initialLoading = computed(
  () => Boolean(entry.value?.loading) && !progress.value,
);

const completion = computed(() => {
  const current = progress.value;
  if (!current || current.totalAchievements <= 0) return null;
  return formatRaProgress(
    current.unlockedAchievements,
    current.totalAchievements,
  );
});

const hardcore = computed(() => {
  const current = progress.value;
  if (!current || current.totalAchievements <= 0) return null;
  return formatRaProgress(
    current.unlockedAchievementsHardcore,
    current.totalAchievements,
  );
});

const showProgress = computed(
  () => uiState.value === "available" && progress.value != null,
);

watch(
  () => [props.gameId, props.raGameId, props.platform] as const,
  ([, raId]) => {
    mappingMessage.value = null;
    mapInput.value = raId ? String(raId) : "";
    // No autocompletar con el título del juego (mods/nombres largos no ayudan en RA).
    searchQuery.value = "";
    void ra.loadForGame({
      gameId: props.gameId,
      raGameId: raId,
      platform: props.platform,
    });
  },
  { immediate: true },
);

async function refresh() {
  if (refreshing.value) return;
  await ra.loadForGame({
    gameId: props.gameId,
    raGameId: props.raGameId,
    platform: props.platform,
    refresh: true,
  });
}

async function linkId(id: number, coverUrl?: string | null) {
  mappingBusy.value = true;
  mappingMessage.value = null;
  try {
    await library.setRetroAchievementsGameId(props.gameId, id, { coverUrl });
    ra.clearCandidates();
    mappingMessage.value = `Vinculado a RA #${id}`;
    await ra.loadForGame({
      gameId: props.gameId,
      raGameId: id,
      platform: props.platform,
      refresh: true,
    });
    const progress = ra.progressByGameId[props.gameId]?.progress;
    if (progress?.imageIcon) {
      await library.setRetroAchievementsGameId(props.gameId, id, {
        coverUrl: progress.imageIcon,
      });
    }
  } catch (err) {
    mappingMessage.value =
      err instanceof Error ? err.message : "No se pudo vincular.";
  } finally {
    mappingBusy.value = false;
  }
}

async function saveManualId() {
  const n = Number(mapInput.value.trim());
  if (!Number.isInteger(n) || n <= 0) {
    mappingMessage.value = "Ingresá un ID numérico válido de RetroAchievements.";
    return;
  }
  await linkId(n);
}

async function unlink() {
  mappingBusy.value = true;
  mappingMessage.value = null;
  try {
    await library.setRetroAchievementsGameId(props.gameId, null);
    mapInput.value = "";
    ra.forgetGame(props.gameId);
    mappingMessage.value = "Vínculo eliminado.";
  } catch (err) {
    mappingMessage.value =
      err instanceof Error ? err.message : "No se pudo desvincular.";
  } finally {
    mappingBusy.value = false;
  }
}

async function runSearch() {
  const q = searchQuery.value.trim() || props.gameTitle;
  await ra.searchCandidates(q, props.platform, { broadenIfEmpty: true });
}

async function refreshIdentifyAvailability() {
  const check = await raIdentifyService.canAutoIdentify(props.gameId);
  canIdentify.value = check.ok;
  identifyHint.value = check.ok ? null : (check.reason ?? null);
}

function normalizeRaTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Un solo resultado, o un único match de título → auto; si hay ambigüedad, lista. */
function pickTitleFallbackCandidate() {
  const list = candidates.value;
  if (list.length === 0) return null;
  if (list.length === 1) return list[0]!;

  const needle = normalizeRaTitle(props.gameTitle);
  const exact = list.filter((c) => normalizeRaTitle(c.title) === needle);
  if (exact.length === 1) return exact[0]!;

  const loose = list.filter((c) => {
    const t = normalizeRaTitle(c.title);
    return t.includes(needle) || needle.includes(t);
  });
  if (loose.length === 1) return loose[0]!;
  return null;
}

async function runTitleFallback(_hashMessage: string): Promise<void> {
  const title = props.gameTitle.trim();
  searchQuery.value = title || searchQuery.value;
  identifyStatus.value = "Hash del dump no registrado. Buscando el juego por título...";
  lastIdentify.value = {
    state: "not_found",
    message: identifyStatus.value,
  };
  mappingMessage.value = identifyStatus.value;

  await ra.searchCandidates(title || props.gameTitle, props.platform, {
    broadenIfEmpty: true,
  });
  const pick = pickTitleFallbackCandidate();

  if (pick) {
    identifyStatus.value = `Vinculando por título: ${pick.title}...`;
    await library.setRetroAchievementsGameId(props.gameId, pick.raGameId, {
      coverUrl: pick.imageIcon,
    });
    ra.clearCandidates();
    const consoleHint = pick.consoleName ? ` · ${pick.consoleName}` : "";
    lastIdentify.value = {
      state: "identified",
      raGameId: pick.raGameId,
      title: pick.title,
      message: `Vinculado por título: ${pick.title} (#${pick.raGameId}${consoleHint}). El dump no estaba en los hashes de RA; los logros in-game pueden no contar.`,
    };
    mappingMessage.value = lastIdentify.value.message;
    await ra.loadForGame({
      gameId: props.gameId,
      raGameId: pick.raGameId,
      platform: props.platform,
      refresh: true,
    });
    identifyStatus.value = null;
    return;
  }

  const n = candidates.value.length;
  const message =
    n > 0
      ? `Hay varios candidatos por título (${n}). Elegí el correcto con Usar (mirá la consola de cada uno).`
      : "Sin match por hash ni por título en RA. Probá otro nombre, el ID (ej. 337) o revisá el runtime (PCSX2 solo hashea PS2).";
  lastIdentify.value = { state: "not_found", message };
  mappingMessage.value = message;
  identifyStatus.value = null;
}

async function runIdentify(overwriteExisting = false) {
  if (identifyBusy.value) return;
  identifyBusy.value = true;
  mappingMessage.value = null;
  identifyStatus.value = "Analizando contenido (hash)...";
  lastIdentify.value = {
    state: "analyzing",
    message: identifyStatus.value,
  };
  try {
    const result = await raIdentifyService.identifyGame({
      gameId: props.gameId,
      overwriteExisting,
    });
    lastIdentify.value = result;
    mappingMessage.value = result.message;

    if (result.state === "identified" && result.raGameId) {
      await library.setRetroAchievementsGameId(props.gameId, result.raGameId);
      await ra.loadForGame({
        gameId: props.gameId,
        raGameId: result.raGameId,
        platform: props.platform,
        refresh: true,
      });
      return;
    }

    // Hash primero; si no hay mapping, fallback por título (auto si no hay ambigüedad).
    if (result.state === "not_found" || result.state === "error") {
      await runTitleFallback(result.message);
    }
  } catch (err) {
    const message =
      typeof err === "string" && err.trim()
        ? err
        : err instanceof Error && err.message.trim()
          ? err.message
          : "No se pudo identificar el contenido.";
    try {
      await runTitleFallback(message);
    } catch {
      lastIdentify.value = { state: "error", message };
      mappingMessage.value = message;
    }
  } finally {
    identifyBusy.value = false;
    identifyStatus.value = null;
  }
}

onMounted(() => {
  void refreshIdentifyAvailability();
});

watch(
  () => [props.gameId, props.platform] as const,
  () => {
    lastIdentify.value = null;
    identifyStatus.value = null;
    void refreshIdentifyAvailability();
  },
);
</script>

<template>
  <section class="rounded-2xl border border-white/10 bg-slate-900/40 p-5">
    <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-lg font-medium text-white">RetroAchievements</h2>
        <p class="mt-1 text-xs text-slate-400">
          Progreso vía Web API · logros en juego vía PCSX2 / RetroArch
        </p>
      </div>
      <button
        v-if="raGameId"
        type="button"
        class="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50"
        :disabled="refreshing || initialLoading"
        @click="refresh"
      >
        {{ refreshing ? "Actualizando..." : "Actualizar" }}
      </button>
    </div>

    <p v-if="raUsername" class="mb-3 text-xs text-slate-400">
      Usuario RA
      <span v-if="raSource"> ({{ raSource.emulatorKind }})</span>:
      <span class="text-slate-200">{{ raUsername }}</span>
      <span v-if="raReady" class="text-emerald-400"> · conectado</span>
    </p>

    <div
      v-if="uiState === 'not_mapped' || !raGameId"
      class="mb-4 rounded-lg border border-white/10 bg-black/20 p-4"
    >
      <p class="mb-3 text-sm text-slate-300">
        Este juego todavía no está vinculado a RetroAchievements.
      </p>

      <div
        v-if="canIdentify || identifyBusy || lastIdentify"
        class="mb-4 rounded-lg border border-sky-500/20 bg-sky-500/5 p-3"
      >
        <p class="mb-2 text-sm text-slate-200">Identificación automática</p>
        <p
          v-if="identifyBusy && identifyStatus"
          class="mb-2 text-xs text-sky-200"
        >
          {{ identifyStatus }}
        </p>
        <p
          v-else-if="lastIdentify?.state === 'identified'"
          class="mb-2 text-xs text-emerald-300"
        >
          ✓ Juego identificado
          <span v-if="lastIdentify.title"> · {{ lastIdentify.title }}</span>
        </p>
        <p
          v-else-if="lastIdentify?.state === 'conflict'"
          class="mb-2 text-xs text-amber-200"
        >
          {{ lastIdentify.message }}
        </p>
        <p
          v-else-if="lastIdentify && lastIdentify.state !== 'idle'"
          class="mb-2 text-xs text-slate-400"
        >
          {{ lastIdentify.message }}
        </p>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="rounded-lg bg-emerald-500/90 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
            :disabled="identifyBusy || !canIdentify"
            @click="runIdentify(false)"
          >
            {{ identifyBusy ? "Identificando..." : "Identificar contenido" }}
          </button>
          <button
            v-if="lastIdentify?.state === 'conflict'"
            type="button"
            class="rounded-lg border border-amber-400/40 px-3 py-2 text-sm text-amber-100 hover:bg-amber-500/10 disabled:opacity-50"
            :disabled="identifyBusy"
            @click="runIdentify(true)"
          >
            Reemplazar mapping
          </button>
        </div>
        <p v-if="identifyHint && !canIdentify" class="mt-2 text-xs text-slate-500">
          {{ identifyHint }}
        </p>
      </div>

      <p class="mb-3 text-xs text-slate-500">
        Si el hash no matchea, se busca por nombre en RA (todas las consolas) y
        se vincula solo si el candidato es claro. Si hay varios, elegís vos.
      </p>
      <div class="mb-3 flex flex-wrap gap-2">
        <input
          v-model="mapInput"
          type="text"
          inputmode="numeric"
          placeholder="ID RA (ej. 2771)"
          class="min-w-[140px] flex-1 rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/50"
        />
        <button
          type="button"
          class="rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-50"
          :disabled="mappingBusy"
          @click="saveManualId"
        >
          Vincular ID
        </button>
      </div>
      <div class="mb-2 flex flex-wrap gap-2">
        <input
          v-model="searchQuery"
          type="search"
          placeholder="Buscar candidatos PS2..."
          class="min-w-[180px] flex-1 rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/50"
        />
        <button
          type="button"
          class="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50"
          :disabled="searching"
          @click="runSearch"
        >
          {{ searching ? "Buscando..." : "Buscar" }}
        </button>
      </div>
      <p v-if="searchError" class="mt-2 text-xs text-rose-300">{{ searchError }}</p>
      <ul v-if="candidates.length" class="mt-3 max-h-48 space-y-2 overflow-y-auto">
        <li
          v-for="c in candidates"
          :key="c.raGameId"
          class="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-slate-950/50 px-3 py-2 text-sm"
        >
          <div class="min-w-0">
            <p class="truncate text-slate-200">{{ c.title }}</p>
            <p class="text-xs text-slate-500">
              #{{ c.raGameId }}
              <span v-if="c.consoleName"> · {{ c.consoleName }}</span>
              ·
              {{
                c.numAchievements > 0
                  ? `${c.numAchievements} logros`
                  : "sin logros"
              }}
            </p>
          </div>
          <button
            type="button"
            class="shrink-0 rounded-md bg-emerald-500/90 px-2 py-1 text-xs font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
            :disabled="mappingBusy"
            @click="linkId(c.raGameId, c.imageIcon)"
          >
            Usar
          </button>
        </li>
      </ul>
    </div>

    <p v-if="mappingMessage" class="mb-3 text-xs text-sky-300">
      {{ mappingMessage }}
    </p>

    <div v-if="initialLoading" class="py-6 text-center text-sm text-slate-400">
      Consultando RetroAchievements...
    </div>

    <div
      v-else-if="slotError && !progress"
      class="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
    >
      {{ slotError }}
      <p v-if="uiState === 'api_not_configured'" class="mt-2 text-xs text-amber-200/80">
        Configurá <code class="text-amber-100">RETROACHIEVEMENTS_API_KEY</code> en
        <code class="text-amber-100">back/.env</code>.
      </p>
    </div>

    <template v-else-if="showProgress && progress">
      <p
        v-if="slotError"
        class="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
      >
        {{ slotError }}
      </p>

      <div class="mb-4">
        <p class="text-base font-medium text-white">{{ progress.title }}</p>
        <p v-if="progress.consoleName" class="text-xs text-slate-500">
          {{ progress.consoleName }} · ID {{ progress.raGameId }}
          <span v-if="progress.cached"> · cache</span>
        </p>

        <template v-if="completion">
          <p class="mt-3 text-sm text-slate-200">
            {{ completion.summary }} desbloqueados
          </p>
          <p class="mt-1 text-sm text-slate-300">{{ completion.percentLabel }}</p>
          <div class="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              class="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all"
              :style="{ width: completion.barWidth }"
            />
          </div>
          <p v-if="hardcore" class="mt-2 text-xs text-slate-400">
            Hardcore: {{ hardcore.percentLabel }}
            ({{ progress.unlockedAchievementsHardcore }} /
            {{ progress.totalAchievements }})
          </p>
        </template>
        <p v-else class="mt-3 text-sm text-slate-300">
          Este juego no contiene logros para mostrar.
        </p>
        <p v-if="!completion" class="mt-1 text-xs text-slate-500">
          Está en RetroAchievements, pero todavía no hay set de logros.
        </p>
      </div>

      <div class="mb-3 flex justify-end">
        <button
          type="button"
          class="text-xs text-slate-500 hover:text-rose-300"
          :disabled="mappingBusy"
          @click="unlink"
        >
          Quitar vínculo
        </button>
      </div>

      <template v-if="progress.achievements.length">
        <h3 class="mb-2 text-sm font-medium uppercase tracking-wider text-slate-400">
          Logros
        </h3>
        <ul class="max-h-80 space-y-2 overflow-y-auto">
          <li
            v-for="ach in progress.achievements"
            :key="ach.id"
            class="rounded-lg border px-3 py-2"
            :class="
              ach.unlocked
                ? 'border-emerald-500/25 bg-emerald-500/5'
                : 'border-white/5 bg-black/20'
            "
          >
            <div class="flex items-start gap-2">
              <span
                class="mt-0.5 text-sm"
                :class="ach.unlocked ? 'text-emerald-400' : 'text-slate-500'"
              >{{ ach.unlocked ? "✓" : "🔒" }}</span>
              <div class="min-w-0 flex-1">
                <p
                  class="text-sm font-medium"
                  :class="ach.unlocked ? 'text-emerald-100' : 'text-slate-300'"
                >
                  {{ ach.title }}
                </p>
                <p class="text-xs text-slate-500">{{ ach.description }}</p>
                <p class="mt-1 text-xs text-slate-400">{{ ach.points }} pts</p>
                <p
                  v-if="ach.unlocked && achievementUnlockLabel(ach.unlockedAt)"
                  class="text-xs text-emerald-200/80"
                >
                  {{ achievementUnlockLabel(ach.unlockedAt) }}
                </p>
              </div>
            </div>
          </li>
        </ul>
      </template>
    </template>
  </section>
</template>
