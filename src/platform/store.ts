import { LazyStore } from "@tauri-apps/plugin-store";

const APP_STORE_FILE = "app-state.json";
const SIDEBAR_COLLAPSED_KEY = "ui.sidebarCollapsed";
const LEGACY_SIDEBAR_COLLAPSED_KEY = "skill-marketplace.sidebar-collapsed";

const appStore = new LazyStore(APP_STORE_FILE);

export async function loadSidebarCollapsedPreference() {
  const storedValue = await appStore.get<boolean>(SIDEBAR_COLLAPSED_KEY);
  if (typeof storedValue === "boolean") {
    return storedValue;
  }

  if (typeof window === "undefined") {
    return false;
  }

  try {
    const legacyValue = window.localStorage.getItem(LEGACY_SIDEBAR_COLLAPSED_KEY);
    if (legacyValue === "true" || legacyValue === "false") {
      const migratedValue = legacyValue === "true";
      await setSidebarCollapsedPreference(migratedValue);
      window.localStorage.removeItem(LEGACY_SIDEBAR_COLLAPSED_KEY);
      return migratedValue;
    }
  } catch {
    // Ignore legacy localStorage read failures and fall back to default.
  }

  return false;
}

export async function setSidebarCollapsedPreference(value: boolean) {
  await appStore.set(SIDEBAR_COLLAPSED_KEY, value);
  await appStore.save();
}
