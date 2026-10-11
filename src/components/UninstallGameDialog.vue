<script setup lang="ts">
defineProps<{
  open: boolean;
  gameTitle: string;
  busy?: boolean;
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();
</script>

<template>
  <div
    v-if="open"
    class="uninstall-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="uninstall-title"
    @click.self="!busy && emit('cancel')"
  >
    <div class="uninstall-dialog">
      <div class="uninstall-dialog__top">
        <h2 id="uninstall-title" class="uninstall-dialog__title">Desinstalar</h2>
        <button
          type="button"
          class="uninstall-dialog__close"
          :disabled="busy"
          aria-label="Cerrar"
          @click="emit('cancel')"
        >
          ×
        </button>
      </div>
      <p class="uninstall-dialog__body">
        ¿Quieres desinstalar {{ gameTitle }} de este dispositivo? Permanecerá en
        tu biblioteca, pero para volver a jugarlo en un futuro, tendrás que
        descargar de nuevo todo su contenido.
      </p>
      <div class="uninstall-dialog__actions">
        <button
          type="button"
          class="uninstall-dialog__btn uninstall-dialog__btn--primary"
          :disabled="busy"
          @click="emit('confirm')"
        >
          {{ busy ? "Desinstalando…" : "Desinstalar" }}
        </button>
        <button
          type="button"
          class="uninstall-dialog__btn uninstall-dialog__btn--ghost"
          :disabled="busy"
          @click="emit('cancel')"
        >
          Cancelar
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.uninstall-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.55);
}

.uninstall-dialog {
  width: 100%;
  max-width: 480px;
  border: 1px solid #3d4450;
  border-top: 2px solid #66c0f4;
  background: #2a475e;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
}

.uninstall-dialog__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 0;
}

.uninstall-dialog__title {
  margin: 0;
  color: #fff;
  font-size: 16px;
  font-weight: 700;
}

.uninstall-dialog__close {
  border: 0;
  background: transparent;
  color: #c6d4df;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.uninstall-dialog__close:hover:not(:disabled) {
  color: #fff;
}

.uninstall-dialog__close:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.uninstall-dialog__body {
  margin: 0;
  padding: 14px 16px 20px;
  color: #c6d4df;
  font-size: 14px;
  line-height: 1.45;
}

.uninstall-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 16px 16px;
}

.uninstall-dialog__btn {
  min-width: 110px;
  height: 36px;
  padding: 0 16px;
  border: 0;
  border-radius: 2px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.uninstall-dialog__btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.uninstall-dialog__btn--primary {
  background: #66c0f4;
  color: #171a21;
}

.uninstall-dialog__btn--primary:hover:not(:disabled) {
  filter: brightness(1.06);
}

.uninstall-dialog__btn--ghost {
  background: #323e4c;
  color: #fff;
}

.uninstall-dialog__btn--ghost:hover:not(:disabled) {
  background: #3d4a5a;
}
</style>
