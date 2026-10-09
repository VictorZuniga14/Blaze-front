<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { open } from "@tauri-apps/plugin-dialog";
import { useLibraryStore } from "../stores/library";
import { GAME_LIMITS, type GameWritableFields } from "../types/game";
import { resolveCoverSrc } from "../utils/coverSrc";

const route = useRoute();
const router = useRouter();
const library = useLibraryStore();

const isEdit = computed(() => Boolean(route.params.id));
const formError = ref<string | null>(null);
const saving = ref(false);

const form = reactive({
  title: "",
  description: "",
  developer: "",
  publisher: "",
  genre: "",
  platform: "",
  releaseYear: "" as string | number,
  coverPath: "",
  isFavorite: false,
});

function fillFromGame(id: string) {
  const game = library.getGameById(id);
  if (!game) return false;
  form.title = game.title;
  form.description = game.description ?? "";
  form.developer = game.developer ?? "";
  form.publisher = game.publisher ?? "";
  form.genre = game.genre ?? "";
  form.platform = game.platform ?? "";
  form.releaseYear = game.releaseYear != null ? String(game.releaseYear) : "";
  form.coverPath = game.coverPath ?? "";
  form.isFavorite = game.isFavorite;
  return true;
}

async function ensureLoaded() {
  if (!library.ready) {
    await library.loadLibrary();
  }
}

onMounted(async () => {
  await ensureLoaded();
  if (isEdit.value && typeof route.params.id === "string") {
    library.selectGame(route.params.id);
    if (!fillFromGame(route.params.id)) {
      formError.value = "No se encontró el juego.";
    }
  }
});

watch(
  () => route.params.id,
  async (id) => {
    if (typeof id === "string") {
      await ensureLoaded();
      library.selectGame(id);
      if (!fillFromGame(id)) {
        formError.value = "No se encontró el juego.";
      }
    }
  },
);

const coverPreview = computed(() => resolveCoverSrc(form.coverPath));

async function pickCover() {
  formError.value = null;
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [
      { name: "Imagen", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
    ],
  });
  if (typeof selected === "string") {
    form.coverPath = selected;
  }
}

function toInput(): GameWritableFields {
  const yearRaw =
    form.releaseYear === null || form.releaseYear === undefined
      ? ""
      : String(form.releaseYear).trim();

  return {
    title: form.title,
    description: form.description,
    developer: form.developer,
    publisher: form.publisher,
    genre: form.genre,
    platform: form.platform,
    releaseYear: yearRaw === "" ? null : Number(yearRaw),
    coverPath: form.coverPath,
    isFavorite: form.isFavorite,
  };
}

async function submit() {
  formError.value = null;
  saving.value = true;
  try {
    if (isEdit.value && typeof route.params.id === "string") {
      const updated = await library.updateGame(route.params.id, toInput());
      await router.push(`/games/${updated.id}`);
    } else {
      const created = await library.createGame(toInput());
      await router.push(`/games/${created.id}`);
    }
  } catch (err) {
    formError.value =
      err instanceof Error ? err.message : "No se pudo guardar el juego.";
  } finally {
    saving.value = false;
  }
}

function cancel() {
  if (isEdit.value && typeof route.params.id === "string") {
    void router.push(`/games/${route.params.id}`);
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
      ← Volver
    </button>

    <h1 class="mb-6 text-3xl font-semibold text-white">
      {{ isEdit ? "Editar juego" : "Agregar juego" }}
    </h1>
    <p v-if="!isEdit" class="mb-6 text-sm text-slate-400">
      Se guarda como borrador. Después asociás contenido, ejecución y lo publicás
      con «Guardar juego».
    </p>

    <p
      v-if="formError"
      class="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
    >
      {{ formError }}
    </p>

    <form class="space-y-4" @submit.prevent="submit">
      <label class="block">
        <span class="mb-1 block text-sm text-slate-300">Título *</span>
        <input
          v-model="form.title"
          required
          :maxlength="GAME_LIMITS.title"
          class="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none focus:border-sky-400/50"
        />
      </label>

      <label class="block">
        <span class="mb-1 block text-sm text-slate-300">Descripción</span>
        <textarea
          v-model="form.description"
          rows="4"
          :maxlength="GAME_LIMITS.description"
          class="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none focus:border-sky-400/50"
        />
      </label>

      <div class="grid gap-4 sm:grid-cols-2">
        <label class="block">
          <span class="mb-1 block text-sm text-slate-300">Desarrollador</span>
          <input
            v-model="form.developer"
            :maxlength="GAME_LIMITS.metadata"
            class="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none focus:border-sky-400/50"
          />
        </label>
        <label class="block">
          <span class="mb-1 block text-sm text-slate-300">Publisher</span>
          <input
            v-model="form.publisher"
            :maxlength="GAME_LIMITS.metadata"
            class="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none focus:border-sky-400/50"
          />
        </label>
        <label class="block">
          <span class="mb-1 block text-sm text-slate-300">Género</span>
          <input
            v-model="form.genre"
            :maxlength="GAME_LIMITS.metadata"
            class="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none focus:border-sky-400/50"
          />
        </label>
        <label class="block">
          <span class="mb-1 block text-sm text-slate-300">Plataforma</span>
          <input
            v-model="form.platform"
            :maxlength="GAME_LIMITS.metadata"
            class="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none focus:border-sky-400/50"
          />
        </label>
        <label class="block">
          <span class="mb-1 block text-sm text-slate-300">Año de lanzamiento</span>
          <input
            v-model="form.releaseYear"
            type="number"
            :min="GAME_LIMITS.releaseYearMin"
            :max="GAME_LIMITS.releaseYearMax"
            class="w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none focus:border-sky-400/50"
          />
        </label>
        <label class="block sm:col-span-2">
          <span class="mb-1 block text-sm text-slate-300">Portada</span>
          <div class="flex gap-2">
            <input
              v-model="form.coverPath"
              :maxlength="GAME_LIMITS.coverPath"
              placeholder="Ruta local o URL https://"
              class="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-white outline-none placeholder:text-slate-500 focus:border-sky-400/50"
            />
            <button
              type="button"
              class="shrink-0 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/5"
              @click="pickCover"
            >
              Seleccionar
            </button>
          </div>
          <img
            v-if="coverPreview"
            :src="coverPreview"
            alt="Vista previa portada"
            class="mt-3 h-40 w-28 rounded-lg border border-white/10 object-cover"
            @error="($event.target as HTMLImageElement).style.display = 'none'"
          />
        </label>
      </div>

      <label class="flex items-center gap-2 text-sm text-slate-300">
        <input v-model="form.isFavorite" type="checkbox" class="accent-amber-400" />
        Marcar como favorito
      </label>

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
          :disabled="saving"
          class="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-60"
        >
          {{
            saving
              ? "Guardando..."
              : isEdit
                ? "Guardar"
                : "Guardar borrador"
          }}
        </button>
      </div>
    </form>
  </div>
</template>
