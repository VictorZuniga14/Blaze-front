<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { storeToRefs } from "pinia";
import { useLibraryStore } from "../stores/library";
import { useLaunchStore } from "../stores/launch";
import { useRuntimeStore } from "../stores/runtime";
import type { LaunchType } from "../types/launch";

const route = useRoute();
const router = useRouter();
const library = useLibraryStore();
const launch = useLaunchStore();
const runtimeStore = useRuntimeStore();

const { currentConfig, loadingConfig, savingConfig, configError } =
  storeToRefs(launch);
const { runtimes } = storeToRefs(runtimeStore);

const formError = ref<string | null>(null);

const form = reactive({
  type: "native" as LaunchType,
  executablePath: "",
  runtimeId: "",
  contentPath: "",
  workingDirectory: "",
  arguments: [] as string[],
});

const gameId = computed(() =>
  typeof route.params.id === "string" ? route.params.id : "",
);

const game = computed(() =>
  gameId.value ? library.getGameById(gameId.value) : undefined,
);

function fillForm() {
  if (currentConfig.value) {
    form.type = currentConfig.value.type === "runtime" ? "runtime" : "native";
    form.executablePath = currentConfig.value.executablePath ?? "";
    form.runtimeId = currentConfig.value.runtimeId ?? "";
    form.contentPath = currentConfig.value.contentPath ?? "";
    form.workingDirectory = currentConfig.value.workingDirectory ?? "";
    form.arguments = [...currentConfig.value.arguments];
  } else {
    form.type = "native";
    form.executablePath = "";
    form.runtimeId = "";
    form.contentPath = "";
    form.workingDirectory = "";
    form.arguments = [];
  }
}

async function ensureLoaded() {
  if (!library.ready) {
    await library.loadLibrary();
  }
  await runtimeStore.loadRuntimes();
  if (gameId.value) {
    await launch.loadConfig(gameId.value);
    fillForm();
  }
}

onMounted(() => {
  void ensureLoaded();
});

watch(gameId, () => {
  void ensureLoaded();
});

async function pickExecutable() {
  formError.value = null;
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Ejecutable", extensions: ["exe"] }],
  });
  if (typeof selected === "string") {
    form.executablePath = selected;
  }
}

async function pickContent() {
  formError.value = null;
  const selected = await open({
    multiple: false,
    directory: false,
  });
  if (typeof selected !== "string") return;

  form.contentPath = selected;
  try {
    const exists = await invoke<boolean>("path_check", {
      path: selected,
      kind: "file",
    });
    if (!exists) {
      formError.value = "El archivo de contenido no existe.";
    }
  } catch {
    formError.value = "El archivo de contenido no existe.";
  }
}

async function pickWorkingDirectory() {
  formError.value = null;
  const selected = await open({
    multiple: false,
    directory: true,
  });
  if (typeof selected === "string") {
    form.workingDirectory = selected;
  }
}

function addArgument() {
  form.arguments.push("");
}

function removeArgument(index: number) {
  form.arguments.splice(index, 1);
}

function moveArgumentUp(index: number) {
  if (index <= 0) return;
  const prev = form.arguments[index - 1]!;
  form.arguments[index - 1] = form.arguments[index]!;
  form.arguments[index] = prev;
}

function moveArgumentDown(index: number) {
  if (index >= form.arguments.length - 1) return;
  const next = form.arguments[index + 1]!;
  form.arguments[index + 1] = form.arguments[index]!;
  form.arguments[index] = next;
}

async function save() {
  if (!gameId.value) return;
  formError.value = null;

  if (form.type === "native" && !form.executablePath.trim()) {
    formError.value = "El ejecutable es obligatorio.";
    return;
  }
  if (form.type === "runtime" && !form.runtimeId) {
    formError.value = "Debes seleccionar un runtime.";
    return;
  }
  if (form.type === "runtime" && !form.contentPath.trim()) {
    formError.value = "El archivo de contenido no existe.";
    return;
  }

  try {
    await launch.saveConfig({
      gameId: gameId.value,
      type: form.type,
      executablePath: form.type === "native" ? form.executablePath : null,
      runtimeId: form.type === "runtime" ? form.runtimeId || null : null,
      contentPath: form.type === "runtime" ? form.contentPath || null : null,
      workingDirectory: form.workingDirectory || null,
      arguments: form.arguments,
    });
    await router.push(`/games/${gameId.value}`);
  } catch (err) {
    formError.value =
      err instanceof Error ? err.message : "No se pudo guardar la configuración.";
  }
}

function cancel() {
  if (gameId.value) {
    void router.push(`/games/${gameId.value}`);
  } else {
    void router.push("/");
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl px-6 py-10">
    <button
      type="button"
      class="mb-6 text-sm text-slate-400 hover:text-white"
      @click="cancel"
    >
      ← Volver al juego
    </button>

    <h1 class="mb-2 text-3xl font-semibold text-white">
      Configuración de ejecución
    </h1>
    <p class="mb-8 text-sm text-slate-400">
      {{ game?.title ?? "Juego" }}
    </p>

    <p
      v-if="formError || configError"
      class="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
    >
      {{ formError || configError }}
    </p>

    <div v-if="loadingConfig" class="py-12 text-center text-slate-400">
      Cargando configuración...
    </div>

    <form v-else class="space-y-5" novalidate @submit.prevent="save">
      <fieldset>
        <legend class="mb-2 text-sm text-slate-300">Tipo de ejecución</legend>
        <div class="flex gap-6">
          <label class="flex items-center gap-2 text-sm text-slate-200">
            <input v-model="form.type" type="radio" value="native" class="accent-sky-400" />
            Nativo
          </label>
          <label class="flex items-center gap-2 text-sm text-slate-200">
            <input v-model="form.type" type="radio" value="runtime" class="accent-sky-400" />
            Runtime
          </label>
        </div>
      </fieldset>

      <label v-if="form.type === 'native'" class="block">
        <span class="mb-1 block text-sm text-slate-300">Ejecutable (.exe)</span>
        <div class="flex gap-2">
          <input
            v-model="form.executablePath"
            class="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/50"
            placeholder="C:\...\juego.exe"
          />
          <button
            type="button"
            class="shrink-0 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/5"
            @click="pickExecutable"
          >
            Seleccionar
          </button>
        </div>
      </label>

      <template v-else>
        <label class="block">
          <span class="mb-1 block text-sm text-slate-300">Runtime</span>
          <select
            v-model="form.runtimeId"
            :disabled="runtimes.length === 0"
            class="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/50 disabled:opacity-60 [&_option]:bg-white [&_option]:text-slate-900"
          >
            <option value="" disabled>
              {{
                runtimes.length === 0
                  ? "No hay runtimes registrados"
                  : "Seleccionar runtime..."
              }}
            </option>
            <option v-for="rt in runtimes" :key="rt.id" :value="rt.id">
              {{ rt.name }}
            </option>
          </select>
          <p v-if="runtimes.length === 0" class="mt-2 text-sm text-amber-200/90">
            Primero crea un runtime en
            <button
              type="button"
              class="text-sky-300 underline hover:text-sky-200"
              @click="router.push('/runtimes')"
            >
              Runtimes
            </button>
            (ej. Windows Notepad Test → notepad.exe).
          </p>
        </label>

        <label class="block">
          <span class="mb-1 block text-sm text-slate-300">Contenido</span>
          <div class="flex gap-2">
            <input
              v-model="form.contentPath"
              class="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/50"
              placeholder="C:\Temp\blaze-test.txt"
            />
            <button
              type="button"
              class="shrink-0 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/5"
              @click="pickContent"
            >
              Seleccionar
            </button>
          </div>
        </label>
      </template>

      <label class="block">
        <span class="mb-1 block text-sm text-slate-300">Directorio de trabajo (opcional)</span>
        <div class="flex gap-2">
          <input
            v-model="form.workingDirectory"
            class="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/50"
            placeholder="Dejar vacío"
          />
          <button
            type="button"
            class="shrink-0 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/5"
            @click="pickWorkingDirectory"
          >
            Seleccionar
          </button>
        </div>
      </label>

      <div>
        <span class="mb-2 block text-sm text-slate-300">Argumentos</span>

        <p
          v-if="form.arguments.length === 0"
          class="mb-3 text-sm text-slate-500"
        >
          No hay argumentos configurados.
        </p>

        <div v-else class="mb-3 space-y-2">
          <div
            v-for="(_arg, index) in form.arguments"
            :key="index"
            class="flex gap-2"
          >
            <input
              v-model="form.arguments[index]"
              class="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/50"
              :placeholder="`Argumento ${index + 1}`"
            />
            <button
              type="button"
              :disabled="index === 0"
              class="rounded-lg border border-white/10 px-2.5 py-2 text-sm text-slate-200 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30"
              title="Subir"
              @click="moveArgumentUp(index)"
            >
              ↑
            </button>
            <button
              type="button"
              :disabled="index === form.arguments.length - 1"
              class="rounded-lg border border-white/10 px-2.5 py-2 text-sm text-slate-200 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-30"
              title="Bajar"
              @click="moveArgumentDown(index)"
            >
              ↓
            </button>
            <button
              type="button"
              class="rounded-lg px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/10"
              title="Eliminar"
              @click="removeArgument(index)"
            >
              🗑
            </button>
          </div>
        </div>

        <button
          type="button"
          class="text-sm text-sky-300 hover:text-sky-200"
          @click="addArgument"
        >
          + Agregar argumento
        </button>
      </div>

      <div class="flex justify-end gap-3 pt-4">
        <button
          type="button"
          class="rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
          @click="cancel"
        >
          Cancelar
        </button>
        <button
          type="submit"
          :disabled="savingConfig"
          class="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-60"
        >
          {{ savingConfig ? "Guardando..." : "Guardar" }}
        </button>
      </div>
    </form>
  </div>
</template>
