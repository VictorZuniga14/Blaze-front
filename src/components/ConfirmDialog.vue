<script setup lang="ts">
defineProps<{
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
    role="dialog"
    aria-modal="true"
  >
    <div class="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-xl">
      <h2 class="mb-2 text-lg font-semibold text-white">{{ title }}</h2>
      <p class="mb-6 text-sm text-slate-300">{{ message }}</p>
      <div class="flex justify-end gap-3">
        <button
          type="button"
          class="rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
          @click="emit('cancel')"
        >
          {{ cancelLabel ?? "Cancelar" }}
        </button>
        <button
          type="button"
          class="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500"
          @click="emit('confirm')"
        >
          {{ confirmLabel ?? "Eliminar" }}
        </button>
      </div>
    </div>
  </div>
</template>
