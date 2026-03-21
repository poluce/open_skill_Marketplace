import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";

export async function confirmDanger(message: string, title = "请确认") {
  return confirm(message, {
    title,
    kind: "warning",
  });
}

export async function pickDirectory(title: string) {
  const selected = await open({
    directory: true,
    multiple: false,
    title,
  });

  return typeof selected === "string" ? selected : null;
}

export function openExternalUrl(url: string) {
  return openUrl(url);
}

export function openLocalPath(path: string) {
  return openPath(path);
}

export function copyTextToClipboard(text: string) {
  return writeText(text);
}
