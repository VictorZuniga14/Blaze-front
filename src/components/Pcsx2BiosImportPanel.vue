<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";

const emit = defineEmits<{
  imported: [];
}>();

const busy = ref(false);
const error = ref<string | null>(null);
const dragOver = ref(false);

let unlistenDrag: (() => void) | undefined;

/**
 * En Tauri v2 con dragDropEnabled (default), el drop HTML5 no entrega rutas.
 * Hay que usar getCurrentWebview().onDragDropEvent (solo en app empaquetada / tauri dev).
 */
async function importPath(path: string | null) {
  const trimmed = path?.trim();
  if (!trimmed) return;
  busy.value = true;
  error.value = null;
  try {
    await invoke("import_pcsx2_bios", { path: trimmed });
    emit("imported");
  } catch (err) {
    error.value =
      typeof err === "string"
        ? err
        : err instanceof Error
          ? err.message
          : "No se pudo importar la BIOS.";
  } finally {
    busy.value = false;
  }
}

async function pickFile() {
  const selected = await open({
    multiple: false,
    filters: [{ name: "BIOS PS2", extensions: ["bin", "BIN"] }],
  });
  if (typeof selected === "string") {
    await importPath(selected);
  }
}

async function openFolder() {
  try {
    await invoke("open_managed_pcsx2_bios_folder");
  } catch (err) {
    error.value =
      typeof err === "string"
        ? err
        : err instanceof Error
          ? err.message
          : "No se pudo abrir la carpeta.";
  }
}

onMounted(async () => {
  try {
    unlistenDrag = await getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === "enter" || payload.type === "over") {
        dragOver.value = true;
        return;
      }
      if (payload.type === "leave") {
        dragOver.value = false;
        return;
      }
      if (payload.type === "drop") {
        dragOver.value = false;
        const path = payload.paths.find((p) => /\.bin$/i.test(p)) ?? payload.paths[0];
        if (path) void importPath(path);
      }
    });
  } catch {
    // Fuera de Tauri (p. ej. vite solo): queda el selector de archivo.
  }
});

onUnmounted(() => {
  unlistenDrag?.();
});
</script>

<template>
  <div class="bios-panel">
    <p class="bios-panel__lead">
      Necesitás una BIOS de <strong>tu propia consola</strong> (una sola vez). Importala
      aquí para continuar con la descarga.
    </p>
    <div
      class="bios-panel__drop"
      :class="{ 'bios-panel__drop--over': dragOver }"
    >
      <p>Arrastrá tu archivo .bin aquí</p>
      <button type="button" class="bios-panel__btn" :disabled="busy" @click="pickFile">
        Elegir archivo…
      </button>
    </div>
    <button type="button" class="bios-panel__link" :disabled="busy" @click="openFolder">
      Abrir carpeta BIOS PCSX2
    </button>
    <p v-if="error" class="bios-panel__error">{{ error }}</p>
  </div>
</template>

<style scoped>
.bios-panel {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 193, 7, 0.35);
  max-width: 320px;
}

.bios-panel__lead {
  margin: 0 0 8px;
  font-size: 12px;
  color: #e2e8f0;
  line-height: 1.4;
}

.bios-panel__drop {
  padding: 12px;
  border: 1px dashed rgba(148, 163, 184, 0.5);
  border-radius: 6px;
  text-align: center;
  font-size: 12px;
  color: #94a3b8;
}

.bios-panel__drop--over {
  border-color: #1a9fff;
  background: rgba(26, 159, 255, 0.08);
}

.bios-panel__btn {
  margin-top: 8px;
  padding: 6px 12px;
  font-size: 12px;
  border-radius: 4px;
  border: none;
  background: #1a9fff;
  color: #fff;
  cursor: pointer;
}

.bios-panel__btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.bios-panel__link {
  margin-top: 8px;
  padding: 0;
  border: none;
  background: none;
  color: #67c1f5;
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
}

.bios-panel__error {
  margin: 8px 0 0;
  font-size: 12px;
  color: #f87171;
}
</style>
