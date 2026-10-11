<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import SettingsGearIcon from "./icons/SettingsGearIcon.vue";

const props = defineProps<{
  isFavorite: boolean;
  canUninstall: boolean;
}>();

const emit = defineEmits<{
  toggleFavorite: [];
  uninstall: [];
  properties: [];
}>();

const open = ref(false);
const manageOpen = ref(false);
const addToOpen = ref(false);
const rootEl = ref<HTMLElement | null>(null);

const favoriteLabel = computed(() =>
  props.isFavorite ? "Quitar de Favoritos" : "Agregar a Favoritos",
);

function closeAll(): void {
  open.value = false;
  manageOpen.value = false;
  addToOpen.value = false;
}

function toggle(): void {
  if (open.value) closeAll();
  else open.value = true;
}

function onFavorite(): void {
  emit("toggleFavorite");
  closeAll();
}

function onProperties(): void {
  emit("properties");
  closeAll();
}

function onUninstall(): void {
  if (!props.canUninstall) return;
  emit("uninstall");
  closeAll();
}

function onDocumentClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (rootEl.value && !rootEl.value.contains(target)) closeAll();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") closeAll();
}

watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onKeydown);
  } else {
    document.removeEventListener("click", onDocumentClick);
    document.removeEventListener("keydown", onKeydown);
    manageOpen.value = false;
    addToOpen.value = false;
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("click", onDocumentClick);
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div ref="rootEl" class="cfg-menu">
    <button
      type="button"
      class="tool-btn"
      title="Configuración"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click.stop="toggle"
    >
      <SettingsGearIcon />
    </button>

    <div v-if="open" class="cfg-menu__panel" role="menu">
      <button
        type="button"
        class="cfg-menu__item"
        role="menuitem"
        @click="onFavorite"
      >
        {{ favoriteLabel }}
      </button>

      <div
        class="cfg-menu__item cfg-menu__item--sub"
        @mouseenter="addToOpen = true"
        @mouseleave="addToOpen = false"
      >
        <button
          type="button"
          class="cfg-menu__item-btn"
          role="menuitem"
          aria-haspopup="true"
          :aria-expanded="addToOpen"
          disabled
        >
          <span>Agregar a</span>
          <span class="cfg-menu__chevron" aria-hidden="true">›</span>
        </button>
        <div v-if="addToOpen" class="cfg-menu__submenu" role="menu">
          <p class="cfg-menu__empty">Sin listas aún</p>
        </div>
      </div>

      <div
        class="cfg-menu__item cfg-menu__item--sub"
        @mouseenter="manageOpen = true"
        @mouseleave="manageOpen = false"
      >
        <button
          type="button"
          class="cfg-menu__item-btn"
          role="menuitem"
          aria-haspopup="true"
          :aria-expanded="manageOpen"
        >
          <span>Administrar</span>
          <span class="cfg-menu__chevron" aria-hidden="true">›</span>
        </button>
        <div v-if="manageOpen" class="cfg-menu__submenu" role="menu">
          <button
            type="button"
            class="cfg-menu__item"
            role="menuitem"
            :disabled="!canUninstall"
            @click="onUninstall"
          >
            Desinstalar
          </button>
        </div>
      </div>

      <div class="cfg-menu__sep" role="separator" />

      <button
        type="button"
        class="cfg-menu__item"
        role="menuitem"
        @click="onProperties"
      >
        Propiedades...
      </button>
    </div>
  </div>
</template>

<style scoped>
.cfg-menu {
  position: relative;
}

.tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 2px;
  background: rgba(23, 26, 33, 0.65);
  color: #c6d4df;
  cursor: pointer;
}

.tool-btn:hover {
  border-color: rgba(255, 255, 255, 0.22);
  background: rgba(35, 40, 50, 0.9);
  color: #fff;
}

.cfg-menu__panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 40;
  min-width: 220px;
  padding: 6px 0;
  background: #1b2838;
  border: 1px solid #000;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
}

.cfg-menu__item,
.cfg-menu__item-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 16px;
  border: 0;
  background: transparent;
  color: #dcdedf;
  font-family: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}

.cfg-menu__item:hover:not(:disabled),
.cfg-menu__item-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

.cfg-menu__item:disabled,
.cfg-menu__item-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.cfg-menu__item--sub {
  position: relative;
  padding: 0;
}

.cfg-menu__chevron {
  margin-left: 16px;
  font-size: 16px;
  line-height: 1;
  opacity: 0.75;
}

.cfg-menu__submenu {
  position: absolute;
  top: -6px;
  left: calc(100% + 2px);
  z-index: 41;
  min-width: 180px;
  padding: 6px 0;
  background: #1b2838;
  border: 1px solid #000;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
}

.cfg-menu__empty {
  margin: 0;
  padding: 8px 16px;
  color: #8f98a0;
  font-size: 13px;
}

.cfg-menu__sep {
  height: 1px;
  margin: 6px 0;
  background: rgba(255, 255, 255, 0.08);
}
</style>
