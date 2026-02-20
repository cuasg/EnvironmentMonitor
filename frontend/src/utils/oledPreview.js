/**
 * Shared OLED preview settings (text size, color) persisted to localStorage.
 * Used by Dashboard and Control Panel so both previews stay in sync.
 */

import { STORAGE_KEYS } from "../constants";

const DEFAULT = { textSize: "med", textColor: "white" };

export function loadOledPreviewSettings() {
  try {
    const s = localStorage.getItem(STORAGE_KEYS.OLED_PREVIEW);
    if (s) {
      const data = JSON.parse(s);
      return {
        textSize: data.textSize || DEFAULT.textSize,
        textColor: data.textColor || DEFAULT.textColor,
      };
    }
  } catch {}
  return { ...DEFAULT };
}

export function saveOledPreviewSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEYS.OLED_PREVIEW, JSON.stringify(settings));
  } catch (e) {
    console.warn("Could not save OLED preview settings", e);
  }
}
