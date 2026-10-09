<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { useAuthStore } from "../stores/auth";
import { useAppStore } from "../stores/app";
import { raAvatarUrl } from "../utils/raAvatar";
import WindowControls from "./WindowControls.vue";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const appStore = useAppStore();
const { user, isDev } = storeToRefs(auth);
const { appName } = storeToRefs(appStore);

/** Stub: azul solo con anuncios/notificaciones pendientes. */
const hasAnnouncement = ref(false);
const hasNotification = ref(false);

const menuOpen = ref(false);
const avatarBroken = ref(false);

const libraryNames = new Set([
  "library",
  "settings",
  "runtimes",
  "game-new",
  "game-edit",
  "game-launch",
  "game-detail",
]);

const section = computed(() => {
  if (route.name === "games") return "games";
  if (route.name === "dev") return "dev";
  if (typeof route.name === "string" && libraryNames.has(route.name)) {
    return "library";
  }
  return "";
});

const displayName = computed(() => user.value?.username ?? "");

const avatarSrc = computed(() =>
  displayName.value ? raAvatarUrl(displayName.value) : "",
);

const avatarLetter = computed(() => {
  const name = displayName.value.trim();
  return name ? name.charAt(0).toUpperCase() : "?";
});

watch(displayName, () => {
  avatarBroken.value = false;
});

function closeMenu() {
  menuOpen.value = false;
}

function toggleMenu() {
  menuOpen.value = !menuOpen.value;
}

function goBack() {
  if (window.history.length > 1) router.back();
}

function goForward() {
  router.forward();
}

function onDocumentClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Node)) return;
  const root = document.getElementById("steam-account-menu");
  if (root && !root.contains(target)) closeMenu();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") closeMenu();
}

watch(menuOpen, (open) => {
  if (open) {
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onKeydown);
  } else {
    document.removeEventListener("click", onDocumentClick);
    document.removeEventListener("keydown", onKeydown);
  }
});

watch(
  () => route.fullPath,
  () => {
    closeMenu();
  },
);

onBeforeUnmount(() => {
  document.removeEventListener("click", onDocumentClick);
  document.removeEventListener("keydown", onKeydown);
});

async function logout() {
  closeMenu();
  await auth.logout();
  await router.push("/login");
}
</script>

<template>
  <header class="steam-nav">
    <div class="steam-nav__menubar" data-tauri-drag-region>
      <div class="steam-nav__menu-left">
        <RouterLink to="/" class="steam-nav__brand-link" title="Inicio">
          <img
            class="steam-nav__logo"
            src="/blaze-icon.png"
            width="16"
            height="16"
            alt=""
            aria-hidden="true"
          />
          <span class="steam-nav__menu-item steam-nav__menu-item--brand">{{ appName }}</span>
        </RouterLink>
        <RouterLink
          to="/amigos"
          class="steam-nav__menu-item"
          :class="{ 'steam-nav__menu-item--active': route.name === 'friends' }"
        >
          Amigos
        </RouterLink>
        <button type="button" class="steam-nav__menu-item">Ayuda</button>
        <RouterLink
          v-if="isDev"
          to="/dev"
          class="steam-nav__menu-item"
          :class="{ 'steam-nav__menu-item--active': section === 'dev' }"
        >
          Desarrollador
        </RouterLink>
      </div>
      <WindowControls />
    </div>

    <div class="steam-nav__super">
      <div class="steam-nav__history">
        <button type="button" class="steam-nav__hist-btn" aria-label="Atrás" @click="goBack">
          ‹
        </button>
        <button type="button" class="steam-nav__hist-btn" aria-label="Adelante" @click="goForward">
          ›
        </button>
      </div>

      <nav class="steam-nav__tabs" aria-label="Principal">
        <RouterLink
          to="/juegos"
          class="steam-nav__tab"
          :class="{ 'steam-nav__tab--active': section === 'games' }"
        >
          Juegos
        </RouterLink>
        <RouterLink
          to="/"
          class="steam-nav__tab"
          :class="{ 'steam-nav__tab--active': section === 'library' }"
        >
          Biblioteca
        </RouterLink>
      </nav>

      <div class="steam-nav__right">
        <button
          type="button"
          class="steam-nav__icon"
          :class="{ 'steam-nav__icon--notify': hasAnnouncement }"
          aria-label="Anuncios"
          title="Anuncios"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
            <path
              d="M3 10v4a1 1 0 0 0 1 1h2.2l3.5 3.2a.8.8 0 0 0 1.3-.6V6.4a.8.8 0 0 0-1.3-.6L6.2 9H4a1 1 0 0 0-1 1zm14.1-.7a4.5 4.5 0 0 1 0 5.4l1.4 1.1a6.3 6.3 0 0 0 0-7.6l-1.4 1.1zm2.5-3a8.8 8.8 0 0 1 0 11.4l1.5 1.1a10.7 10.7 0 0 0 0-13.6l-1.5 1.1z"
            />
          </svg>
        </button>
        <button
          type="button"
          class="steam-nav__icon"
          :class="{ 'steam-nav__icon--notify': hasNotification }"
          aria-label="Notificaciones"
          title="Notificaciones"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
            <path
              d="M12 22a2.2 2.2 0 0 0 2.2-2.2h-4.4A2.2 2.2 0 0 0 12 22zm6-6.2V11a6 6 0 1 0-12 0v4.8L4 17.8V19h16v-1.2l-2-1.8z"
            />
          </svg>
        </button>

        <div v-if="user" id="steam-account-menu" class="steam-nav__persona-wrap">
          <button
            type="button"
            class="steam-nav__persona"
            :aria-expanded="menuOpen"
            aria-haspopup="menu"
            @click.stop="toggleMenu"
          >
            <img
              v-if="avatarSrc && !avatarBroken"
              class="steam-nav__avatar"
              :src="avatarSrc"
              :alt="displayName"
              @error="avatarBroken = true"
            />
            <span v-else class="steam-nav__avatar steam-nav__avatar--fallback">
              {{ avatarLetter }}
            </span>
            <span class="steam-nav__persona-name">
              {{ displayName }}
              <span class="steam-nav__caret" aria-hidden="true" />
            </span>
          </button>

          <div v-if="menuOpen" class="steam-nav__dropdown" role="menu">
            <p class="steam-nav__dropdown-name">{{ displayName }}</p>
            <RouterLink to="/perfil" class="steam-nav__dropdown-item" role="menuitem">
              Perfil
            </RouterLink>
            <button
              type="button"
              class="steam-nav__dropdown-item steam-nav__dropdown-item--button"
              role="menuitem"
              @click="logout"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>
    </div>
  </header>
</template>

<style scoped>
.steam-nav {
  position: relative;
  z-index: 40;
  flex-shrink: 0;
  background: #171a21;
  box-shadow: 0 0 10px rgba(0, 0, 0, 0.6);
  user-select: none;
}

.steam-nav__menubar {
  display: flex;
  align-items: center;
  height: 28px;
  padding: 0 0 0 10px;
  background: #171a21;
}

.steam-nav__menu-left {
  display: flex;
  align-items: center;
  gap: 0;
}

.steam-nav__brand-link {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  cursor: pointer;
}

.steam-nav__brand-link:hover .steam-nav__menu-item--brand {
  color: #ffffff;
}

.steam-nav__logo {
  display: block;
  width: 16px;
  height: 16px;
  margin-right: 4px;
  object-fit: contain;
}

.steam-nav__menu-item {
  border: 0;
  background: transparent;
  padding: 3px 7px;
  color: #b8b6b4;
  font-family: "Segoe UI", Tahoma, sans-serif;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.2;
  cursor: default;
  text-decoration: none;
}

a.steam-nav__menu-item {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
}

.steam-nav__menu-item--brand {
  color: #c7d5e0;
}

.steam-nav__menu-item:hover,
.steam-nav__menu-item--active {
  color: #ffffff;
}

.steam-nav__super {
  display: flex;
  align-items: flex-end;
  min-height: 54px;
  padding: 0 14px 0 6px;
  background: #171a21;
}

.steam-nav__history {
  display: flex;
  align-items: center;
  gap: 0;
  align-self: center;
  margin: 0 10px 0 2px;
}

.steam-nav__hist-btn {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 2px;
  background: transparent;
  color: #8f98a0;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.steam-nav__hist-btn:hover {
  color: #ffffff;
}

.steam-nav__tabs {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  min-width: 0;
}

.steam-nav__tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  height: 36px;
  padding: 0 12px 10px;
  border: 0;
  background: transparent;
  color: #dcdedf;
  font-family: "Segoe UI", Tahoma, sans-serif;
  font-size: 16px;
  font-weight: 400;
  letter-spacing: 0.01em;
  line-height: 1;
  text-decoration: none;
  text-transform: uppercase;
  white-space: nowrap;
  cursor: pointer;
}

.steam-nav__tab--button {
  font: inherit;
  text-transform: uppercase;
}

.steam-nav__tab:hover {
  color: #ffffff;
}

.steam-nav__tab--active {
  color: #ffffff;
}

.steam-nav__tab--active::after {
  content: "";
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 0;
  height: 3px;
  background: #1a9fff;
}

.steam-nav__right {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  align-self: center;
  padding-bottom: 10px;
}

.steam-nav__icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 2px;
  background: #2a475e;
  color: #c7d5e0;
  font-size: 15px;
  cursor: pointer;
}

.steam-nav__icon:hover {
  background: #3d6a8a;
  color: #ffffff;
}

.steam-nav__icon--notify {
  background: #1a9fff;
  color: #ffffff;
}

.steam-nav__icon--notify:hover {
  background: #3db0ff;
  color: #ffffff;
}

.steam-nav__persona-wrap {
  position: relative;
  margin-left: 4px;
}

.steam-nav__persona {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 6px 2px 2px;
  border: 0;
  border-radius: 2px;
  background: transparent;
  color: #e5e5e5;
  cursor: pointer;
}

.steam-nav__persona:hover {
  background: rgba(255, 255, 255, 0.04);
}

.steam-nav__avatar {
  display: block;
  width: 32px;
  height: 32px;
  border-radius: 2px;
  object-fit: cover;
  background: #1b2838;
}

.steam-nav__avatar--fallback {
  display: grid;
  place-items: center;
  border-radius: 2px;
  background: #1a9fff;
  color: #ffffff;
  font-size: 14px;
  font-weight: 700;
}

.steam-nav__persona-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 140px;
  overflow: hidden;
  color: #ffffff;
  font-family: "Segoe UI", Tahoma, sans-serif;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.steam-nav__caret {
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid #8f98a0;
}

.steam-nav__dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 50;
  min-width: 220px;
  padding: 8px 0 6px;
  background: #1b2838;
  border: 1px solid #000;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
}

.steam-nav__dropdown-name {
  margin: 0;
  padding: 6px 16px 10px;
  color: #ffffff;
  font-size: 15px;
  font-weight: 700;
  text-transform: uppercase;
}

.steam-nav__dropdown-item {
  display: block;
  width: 100%;
  padding: 8px 16px;
  border: 0;
  background: transparent;
  color: #dcdedf;
  font-family: inherit;
  font-size: 14px;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}

.steam-nav__dropdown-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #ffffff;
}

.steam-nav__dropdown-item--button {
  margin-top: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
</style>
