<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { open } from "@tauri-apps/plugin-dialog";
import { storeToRefs } from "pinia";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import { useRuntimeStore } from "../stores/runtime";
import type { Runtime } from "../types/runtime";

const router = useRouter();
const runtimeStore = useRuntimeStore();

const { runtimes, loading, error } = storeToRefs(runtimeStore);

const formError = ref<string | null>(null);
const saving = ref(false);
const editingId = ref<string | null>(null);
const showForm = ref(false);
const deleteTarget = ref<Runtime | null>(null);

const form = reactive({
  name: "",
  executablePath: "",
});

const formTitle = computed(() =>
  editingId.value ? "Editar runtime" : "Nuevo runtime",
);

onMounted(() => {
  void runtimeStore.loadRuntimes();
});

function resetForm() {
  editingId.value = null;
  form.name = "";
  form.executablePath = "";
  formError.value = null;
  showForm.value = false;
}

function openCreate() {
  editingId.value = null;
  form.name = "";
  form.executablePath = "";
  formError.value = null;
  showForm.value = true;
}

function openEdit(runtime: Runtime) {
  editingId.value = runtime.id;
  form.name = runtime.name;
  form.executablePath = runtime.executablePath;
  formError.value = null;
  showForm.value = true;
}

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

async function save() {
  saving.value = true;
  formError.value = null;
  try {
    const exeLower = form.executablePath.toLowerCase();
    const inferredType = exeLower.includes("eden")
      ? "eden"
      : exeLower.includes("pcsx2")
        ? "pcsx2"
        : exeLower.includes("retroarch")
          ? "retroarch"
          : "generic";
    const input = {
      name: form.name,
      type: inferredType,
      executablePath: form.executablePath,
    };
    if (editingId.value) {
      await runtimeStore.updateRuntime(editingId.value, input);
    } else {
      await runtimeStore.createRuntime(input);
    }
    resetForm();
  } catch (err) {
    formError.value =
      err instanceof Error ? err.message : "No se pudo guardar el runtime.";
  } finally {
    saving.value = false;
  }
}

function askDelete(runtime: Runtime) {
  deleteTarget.value = runtime;
}

async function confirmDelete() {
  if (!deleteTarget.value) return;
  const id = deleteTarget.value.id;
  deleteTarget.value = null;
  try {
    await runtimeStore.deleteRuntime(id);
    if (editingId.value === id) {
      resetForm();
    }
  } catch {
    // error ya en store
  }
}

function cancelDelete() {
  deleteTarget.value = null;
}

function goLibrary() {
  void router.push("/");
}
</script>

<template>
  <div class="mx-auto max-w-3xl px-6 py-10">
    <button
      type="button"
      class="mb-6 text-sm text-slate-400 hover:text-white"
      @click="goLibrary"
    >
      ← Volver a la biblioteca
    </button>

    <div class="mb-8 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-3xl font-semibold text-white">Runtimes</h1>
        <p class="mt-1 text-sm text-slate-400">
          Registra ejecutables reutilizables y asócialos a juegos.
        </p>
      </div>
      <button
        type="button"
        class="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400"
        @click="openCreate"
      >
        + Nuevo runtime
      </button>
    </div>

    <p
      v-if="error"
      class="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
    >
      {{ error }}
    </p>

    <div
      v-if="showForm"
      class="mb-8 rounded-xl border border-white/10 bg-slate-900/50 p-5"
    >
      <h2 class="mb-4 text-lg font-medium text-white">{{ formTitle }}</h2>
      <p
        v-if="formError"
        class="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
      >
        {{ formError }}
      </p>
      <form class="space-y-4" @submit.prevent="save">
        <label class="block">
          <span class="mb-1 block text-sm text-slate-300">Nombre</span>
          <input
            v-model="form.name"
            required
            maxlength="200"
            class="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/50"
            placeholder="Windows Notepad Test"
          />
        </label>
        <label class="block">
          <span class="mb-1 block text-sm text-slate-300">Ejecutable (.exe)</span>
          <div class="flex gap-2">
            <input
              v-model="form.executablePath"
              required
              class="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-400/50"
              placeholder="C:\Windows\System32\notepad.exe"
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
        <div class="flex justify-end gap-3 pt-2">
          <button
            type="button"
            class="rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
            @click="resetForm"
          >
            Cancelar
          </button>
          <button
            type="submit"
            :disabled="saving"
            class="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-60"
          >
            {{ saving ? "Guardando..." : "Guardar" }}
          </button>
        </div>
      </form>
    </div>

    <div v-if="loading" class="py-12 text-center text-slate-400">
      Cargando runtimes...
    </div>

    <div
      v-else-if="runtimes.length === 0"
      class="rounded-xl border border-dashed border-white/15 px-6 py-12 text-center text-slate-400"
    >
      No hay runtimes todavía. Crea uno para asociarlo a un juego.
    </div>

    <ul v-else class="space-y-3">
      <li
        v-for="runtime in runtimes"
        :key="runtime.id"
        class="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-slate-900/40 px-4 py-3"
      >
        <div class="min-w-0 flex-1">
          <p class="font-medium text-white">{{ runtime.name }}</p>
          <p class="truncate text-xs text-slate-400">{{ runtime.executablePath }}</p>
        </div>
        <button
          type="button"
          class="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/5"
          @click="openEdit(runtime)"
        >
          Editar
        </button>
        <button
          type="button"
          class="rounded-lg px-3 py-1.5 text-sm text-rose-300 hover:bg-rose-500/10"
          @click="askDelete(runtime)"
        >
          Eliminar
        </button>
      </li>
    </ul>

    <ConfirmDialog
      :open="!!deleteTarget"
      title="Eliminar runtime"
      :message="
        deleteTarget
          ? `¿Eliminar «${deleteTarget.name}»? No se puede si está asociado a un juego.`
          : ''
      "
      confirm-label="Eliminar"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    />
  </div>
</template>
