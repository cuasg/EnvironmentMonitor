/**
 * Shared formatting utilities for Dashboard and Control Panel.
 */

export function formatNumber(num, decimals = 2) {
  if (num == null || num === "N/A" || (typeof num === "number" && isNaN(num))) return "N/A";
  const n = typeof num === "number" ? num : parseFloat(num);
  if (isNaN(n)) return "N/A";
  return parseFloat(n.toFixed(decimals)).toString();
}

export function formatTimestamp(timestamp) {
  if (!timestamp || timestamp === "N/A") return "N/A";
  try {
    let date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      const timeMatch = timestamp.match(/(\d{1,2}:\d{2} (AM|PM))/);
      return timeMatch ? timeMatch[0] : timestamp;
    }
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return timestamp;
  }
}

/** Full date and time via toLocaleString (e.g. "2/18/2026, 3:12:00 PM"). Handles "YYYY-MM-DD HH:mm" format. */
export function formatDateTime(timestamp) {
  if (!timestamp || timestamp === "N/A") return "N/A";
  try {
    const normalized = typeof timestamp === "string" ? timestamp.replace(" ", "T") : timestamp;
    const date = new Date(normalized);
    return isNaN(date.getTime()) ? timestamp : date.toLocaleString();
  } catch {
    return timestamp;
  }
}

/** Date + time in MM/DD/YYYY format (e.g. "02/18/2026 3:12 PM"). */
export function formatTimestampWithDate(timestamp) {
  if (!timestamp || timestamp === "N/A") return "N/A";
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return timestamp;
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const yyyy = date.getFullYear();
    const time = date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
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
