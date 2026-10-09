import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from "vue-router";
import LibraryView from "../views/LibraryView.vue";
import LibraryHomeView from "../views/LibraryHomeView.vue";
import GamesView from "../views/GamesView.vue";
import CatalogDetailView from "../views/CatalogDetailView.vue";
import GameFormView from "../views/GameFormView.vue";
import GameDetailView from "../views/GameDetailView.vue";
import LaunchConfigView from "../views/LaunchConfigView.vue";
import RuntimesView from "../views/RuntimesView.vue";
import LoginView from "../views/LoginView.vue";
import SettingsView from "../views/SettingsView.vue";
import ProfileView from "../views/ProfileView.vue";
import FriendsView from "../views/FriendsView.vue";
import AchievementsView from "../views/AchievementsView.vue";
import DevView from "../views/DevView.vue";
import { useAuthStore } from "../stores/auth";

const routes: RouteRecordRaw[] = [
  {
    path: "/login",
    name: "login",
    component: LoginView,
    meta: { public: true, guestOnly: true },
  },
  {
    path: "/juegos",
    name: "games",
    component: GamesView,
  },
  {
    path: "/juegos/:id",
    name: "catalog-detail",
    component: CatalogDetailView,
  },
  {
    path: "/perfil",
    name: "profile",
    component: ProfileView,
  },
  {
    path: "/amigos",
    name: "friends",
    component: FriendsView,
  },
  {
    path: "/logros",
    name: "achievements",
    component: AchievementsView,
  },
  {
    path: "/settings",
    name: "settings",
    component: SettingsView,
    meta: { requiresDev: true },
  },
  {
    path: "/runtimes",
    name: "runtimes",
    component: RuntimesView,
    meta: { requiresDev: true },
  },
  {
    path: "/dev",
    name: "dev",
    component: DevView,
    meta: { requiresDev: true },
  },
  {
    path: "/games/new",
    name: "game-new",
    component: GameFormView,
    meta: { requiresDev: true },
  },
  {
    path: "/games/:id/edit",
    name: "game-edit",
    component: GameFormView,
    meta: { requiresDev: true },
  },
  {
    path: "/games/:id/launch",
    name: "game-launch",
    component: LaunchConfigView,
  },
  {
    path: "/",
    component: LibraryView,
    children: [
      {
        path: "",
        name: "library",
        component: LibraryHomeView,
      },
      {
        path: "games/:id",
        name: "game-detail",
        component: GameDetailView,
      },
    ],
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.initialized) {
    await auth.initialize();
  }

  const isPublic = to.meta.public === true;
  const guestOnly = to.meta.guestOnly === true;

  if (!isPublic && !auth.isAuthenticated) {
    return { name: "login", query: { redirect: to.fullPath } };
  }

  if (guestOnly && auth.isAuthenticated) {
    return { name: "library" };
  }

  if (to.meta.requiresDev === true && !auth.isDev) {
    return { name: "library" };
  }

  return true;
});
