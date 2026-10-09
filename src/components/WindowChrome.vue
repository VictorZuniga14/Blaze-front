<script setup lang="ts">
import WindowControls from "./WindowControls.vue";
</script>

<template>
  <div class="window-chrome" data-tauri-drag-region>
    <WindowControls />
  </div>
</template>

<style scoped>
.window-chrome {
  display: flex;
  align-items: center;
  height: 28px;
  padding-left: 10px;
  background: #171a21;
}
</style>
