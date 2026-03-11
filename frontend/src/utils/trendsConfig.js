/**
 * Shared config for Trends page and Dashboard trends chart.
 * Sensors selection is persisted in localStorage (TRENDS_SENSORS).
 * Time range is persisted in localStorage (TRENDS_RANGE).
 */

import { STORAGE_KEYS } from "../constants";

export const RANGES = [
  { value: "3h", label: "3 hours" },
  { value: "6h", label: "6 hours" },
  { value: "12h", label: "12 hours" },
  { value: "24h", label: "24 hours" },
  { value: "72h", label: "72 hours" },
  { value: "7d", label: "1 week" },
];

export const SENSOR_LABELS = {
  pH_value: "pH",
  ppm_500: "PPM (500)",
  light_digital: "Light (digital)",
  humidity: "Humidity %",
  air_temperature_f: "Air °F",
  water_temperature_f: "Water °F",
};

export const SENSORS_HIDDEN = ["ph_voltage", "tds_voltage", "light_analog_voltage"];

export const LINE_COLORS = [
  "#0d9488",
  "#8b5cf6",
  "#f59e0b",
  "#ef4444",
  "#06b6d4",
  "#ec4899",
  "#22c55e",
  "#6366f1",
  "#f97316",
];

const VALID_RANGE_VALUES = RANGES.map((r) => r.value);
const DEFAULT_RANGE = "24h";

export function loadTrendsRange() {
  try {
    const s = localStorage.getItem(STORAGE_KEYS.TRENDS_RANGE);
    if (s && VALID_RANGE_VALUES.includes(s)) return s;
  } catch (_) {}
  return DEFAULT_RANGE;
}

export function saveTrendsRange(value) {
  try {
    if (value && VALID_RANGE_VALUES.includes(value)) {
      localStorage.setItem(STORAGE_KEYS.TRENDS_RANGE, value);
    }
  } catch (_) {}
}

export function formatTrendTime(value) {
  if (!value) return "";
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;

    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    // When the point is more than 24 hours old, include the day so it is
    // easier to see when something happened on longer ranges.
    if (diffHours > 24) {
      return d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    }

    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return value;
  }
}

export function computePhYAxisDomain(data, lowThreshold, highThreshold, isPhOnly) {
  if (!isPhOnly || lowThreshold == null || highThreshold == null) {
    return ["auto", "auto"];
  }

  let dataMin = Infinity;
  let dataMax = -Infinity;

  (data || []).forEach((row) => {
    const v = row?.pH_value;
    if (typeof v === "number" && !Number.isNaN(v)) {
      if (v < dataMin) dataMin = v;
      if (v > dataMax) dataMax = v;
    }
  });

  if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) {
    dataMin = lowThreshold;
    dataMax = highThreshold;
  }

  let minDomain = Math.min(dataMin, lowThreshold) - 2;
  let maxDomain = Math.max(dataMax, highThreshold) + 2;

  if (minDomain < 0) minDomain = 0;
  if (maxDomain <= minDomain) maxDomain = minDomain + 1;

  return [minDomain, maxDomain];
}

export function formatYAxisValue(value) {
  if (value == null || Number.isNaN(value)) return "";
  const n = typeof value === "number" ? value : parseFloat(value);
  if (Number.isNaN(n)) return "";
  return n.toFixed(1);
}
