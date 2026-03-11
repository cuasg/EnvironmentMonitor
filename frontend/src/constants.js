/**
 * Shared storage keys and API path constants.
 * Single source of truth to avoid drift and typos.
 */

// LocalStorage / sessionStorage keys
export const STORAGE_KEYS = {
  OLED_PREVIEW: "oled-preview-settings",
  TILE_ORDER: "tileOrder",
  CONTROL_PANEL_TILES: "control-panel-tiles",
  TRENDS_SENSORS: "trends-selected-sensors",
  TRENDS_RANGE: "trends-range",
  NUTRIENT_CALC: "nutrient-calculator",
  THEME: "plant-theme",
  INFLUX_DISMISSED: "influx_status_dismissed",
};

// API paths (for use with api.get/post/put/delete)
export const API_PATHS = {
  SETTINGS: "/settings",
  TRENDS: "/trends",
  OLED_CONFIG: "/oled/config",
  OLED_DISPLAY: "/oled/display",
  INFLUX_STATUS: "/influx/status",
  HEALTH: "/health",
  INFLUX_CONFIG: "/influx/config",
  GROW_LOGS: "/grow-logs",
  GROW_LOGS_EXPORT: "/grow-logs/export",
  ACTIVATE_PUMP: "/activate-pump",
  RESTART_PROGRAM: "/restart-program",
  RESTART_SYSTEM: "/restart-system",
  SHUTDOWN: "/shutdown",
  AUTH_STATUS: "/auth/status",
  AUTH_SETUP: "/auth/setup",
  AUTH_VERIFY: "/auth/verify",
  AUTH_CHANGE_PIN: "/auth/change-pin",
};

export const PIN_SESSION_HEADER = "X-PIN-Session";
