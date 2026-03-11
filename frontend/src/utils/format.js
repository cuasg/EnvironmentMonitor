/**
 * Shared formatting utilities for Dashboard and Control Panel.
 */

export function formatNumber(num, decimals = 2) {
  if (num == null || num === "N/A" || (typeof num === "number" && isNaN(num))) return "N/A";
  const n = typeof num === "number" ? num : parseFloat(num);
  if (isNaN(n)) return "N/A";
  return parseFloat(n.toFixed(decimals)).toString();
}

const TIME_OPTS_12H = {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
};

export function formatTimestamp(timestamp) {
  if (!timestamp || timestamp === "N/A") return "N/A";
  try {
    let date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      const timeMatch = timestamp.match(/(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM))/i);
      return timeMatch ? timeMatch[0] : timestamp;
    }
    return date.toLocaleTimeString("en-US", TIME_OPTS_12H);
  } catch {
    return timestamp;
  }
}

/** Full date and time with seconds (e.g. "2/18/2026, 3:12:45 PM"). Handles "YYYY-MM-DD HH:mm:ss" format. */
export function formatDateTime(timestamp) {
  if (!timestamp || timestamp === "N/A") return "N/A";
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return timestamp;
    return date.toLocaleString("en-US", {
      month: "numeric",
      day: "numeric",
      year: "numeric",
      ...TIME_OPTS_12H,
    });
  } catch {
    return timestamp;
  }
}

/** Date + time in MM/DD/YYYY format with seconds (e.g. "02/18/2026 3:12:45 PM"). */
export function formatTimestampWithDate(timestamp) {
  if (!timestamp || timestamp === "N/A") return "N/A";
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      const backendMatch = String(timestamp).match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM))/i);
      if (backendMatch) return `${backendMatch[2]}/${backendMatch[3]}/${backendMatch[1]} ${backendMatch[4].trim()}`;
      return timestamp;
    }
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const yyyy = date.getFullYear();
    const time = date.toLocaleTimeString("en-US", TIME_OPTS_12H);
    return `${mm}/${dd}/${yyyy} ${time}`;
  } catch {
    return timestamp;
  }
}

/** Returns { label: "LOW"|"MED"|"HIGH", color: string } for light sensor voltage. */
export function determineLightStatus(voltage) {
  if (voltage >= 2.5) return { label: "LOW", color: "red" };
  if (voltage >= 0.31) return { label: "MED", color: "yellow" };
  return { label: "HIGH", color: "green" };
}
