import axios from "axios";
import { API_PATHS, PIN_SESSION_HEADER } from "./constants";

// Use same host and protocol as the page (works for Tailscale and HTTPS)
const API_HOST = typeof window !== "undefined" ? window.location.hostname : "localhost";
const protocol = typeof window !== "undefined" && window.location.protocol === "https:" ? "https:" : "http:";
const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
const API_BASE_URL = `${protocol}//${API_HOST}:5000`;
const WS_URL = `${wsProtocol}//${API_HOST}:5000/ws/settings`;

export { API_BASE_URL };

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// ✅ 401 on protected requests: dispatch event so AuthContext can clear session
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && error.config?.headers?.[PIN_SESSION_HEADER]) {
      window.dispatchEvent(new CustomEvent("auth:session-expired"));
    }
    return Promise.reject(error);
  }
);

// ✅ WebSocket Handling
let socket = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;
const reconnectBaseDelay = 5000; // Start with 5 seconds
let onSettingsUpdate = () => {};

// ✅ Establish WebSocket Connection (reused across page navigations; callback updated for active page)
export const connectWebSocket = (callback) => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    onSettingsUpdate = callback;
    return;
  }

  onSettingsUpdate = callback;
  console.log("🔗 Connecting to WebSocket...");
  socket = new WebSocket(WS_URL);

  socket.onopen = () => {
    console.log("✅ WebSocket Connected!");
    reconnectAttempts = 0;
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.message === "ping") return; // ✅ Ignore ping messages
      console.log("📡 Live Update Received:", data);
      onSettingsUpdate(data);
    } catch (error) {
      console.error("❌ WebSocket Message Parsing Error:", error);
    }
  };

  socket.onclose = (event) => {
    console.warn("⚠ WebSocket Disconnected. Reason:", event.reason);
    if (reconnectAttempts < maxReconnectAttempts) {
      const delay = Math.min(reconnectBaseDelay * (reconnectAttempts + 1), 60000);
      console.warn(`🔄 Reconnecting in ${delay / 1000} seconds...`);
      setTimeout(() => connectWebSocket(callback), delay);
      reconnectAttempts++;
    } else {
      console.error("❌ Max WebSocket reconnect attempts reached. Manual restart required.");
    }
  };

  socket.onerror = (error) => {
    console.error("❌ WebSocket Error:", error);
    socket.close();
  };
};

window.addEventListener("beforeunload", () => {
  if (socket) {
    socket.close();
  }
});

export const closeWebSocket = () => {
  if (socket) {
    console.log("🔌 Closing WebSocket...");
    socket.close();
  }
};

// ✅ Fetch Settings from Backend
export const getSettings = async () => {
  try {
    const response = await api.get(API_PATHS.SETTINGS);
    return response.data;
  } catch (error) {
    console.error("❌ Error fetching settings:", error);
    return null;
  }
};

// ✅ Auth (PIN) API
export const getAuthStatus = async (sessionToken = null) => {
  try {
    const headers = sessionToken ? { [PIN_SESSION_HEADER]: sessionToken } : {};
    const response = await api.get(API_PATHS.AUTH_STATUS, { headers });
    return response.data;
  } catch (error) {
    console.error("❌ Error fetching auth status:", error);
    return { pinConfigured: false, authenticated: false };
  }
};

export const setupPin = async (pin) => {
  const response = await api.post(API_PATHS.AUTH_SETUP, { pin: String(pin) });
  return response.data;
};

export const verifyPin = async (pin) => {
  const response = await api.post(API_PATHS.AUTH_VERIFY, { pin: String(pin) });
  return response.data;
};

export const changePin = async (currentPin, newPin, sessionToken) => {
  const headers = sessionToken ? { [PIN_SESSION_HEADER]: sessionToken } : {};
  await api.post(API_PATHS.AUTH_CHANGE_PIN, { currentPin: String(currentPin), newPin: String(newPin) }, { headers });
};

// ✅ Update Settings in Backend (pass sessionToken for protected updates: pump_settings, sensor_intervals, pH_monitoring_enabled)
export const updateSettings = async (updatedData, sessionToken = null) => {
  try {
    const headers = sessionToken ? { [PIN_SESSION_HEADER]: sessionToken } : {};
    await api.post(API_PATHS.SETTINGS, updatedData, { headers });
    console.log("✅ Settings updated!");
  } catch (error) {
    console.error("❌ Error updating settings:", error);
    throw error;
  }
};

// ✅ Manual pump activation (requires sessionToken when PIN is configured)
export const activatePump = async (pumpNumber, duration, sessionToken = null) => {
  const headers = sessionToken ? { [PIN_SESSION_HEADER]: sessionToken } : {};
  const response = await api.post(API_PATHS.ACTIVATE_PUMP, { pump: pumpNumber, duration }, { headers });
  return response.data;
};

// ✅ Restart Program (pass sessionToken when PIN is configured)
export const restartProgram = async (sessionToken = null) => {
  const headers = sessionToken ? { [PIN_SESSION_HEADER]: sessionToken } : {};
  const response = await api.post(API_PATHS.RESTART_PROGRAM, {}, { headers });
  return response.data;
};

// ✅ Restart Raspberry Pi (pass sessionToken when PIN is configured)
export const restartPi = async (sessionToken = null) => {
  const headers = sessionToken ? { [PIN_SESSION_HEADER]: sessionToken } : {};
  const response = await api.post(API_PATHS.RESTART_SYSTEM, {}, { headers });
  return response.data;
};

// ✅ Shutdown Raspberry Pi (pass sessionToken when PIN is configured)
export const shutdownPi = async (sessionToken = null) => {
  const headers = sessionToken ? { [PIN_SESSION_HEADER]: sessionToken } : {};
  const response = await api.post(API_PATHS.SHUTDOWN, {}, { headers });
  return response.data;
};

// ✅ InfluxDB config (GET = no auth; save = PIN when configured)
export const getInfluxConfig = async () => {
  try {
    const response = await api.get(API_PATHS.INFLUX_CONFIG);
    return response.data;
  } catch (error) {
    console.error("❌ Error fetching InfluxDB config:", error);
    return { url: "", org: "HomeSensors", bucket: "plantMonitor", tokenMasked: "", configured: false };
  }
};

export const saveInfluxConfig = async (config, sessionToken = null) => {
  const headers = sessionToken ? { [PIN_SESSION_HEADER]: sessionToken } : {};
  await api.post(API_PATHS.INFLUX_CONFIG, config, { headers });
};

// ✅ Trends (InfluxDB sensor history)
export const getTrends = async (range, sensors) => {
  try {
    const params = new URLSearchParams({ range: range || "24h" });
    if (sensors && sensors.length) params.set("sensors", sensors.join(","));
    const response = await api.get(`${API_PATHS.TRENDS}?${params.toString()}`);
    return response.data;
  } catch (error) {
    console.error("❌ Error fetching trends:", error);
    return { data: [], sensors: [] };
  }
};

// ✅ Grow Logs API
export const getGrowLogs = async () => {
  try {
    const response = await api.get(API_PATHS.GROW_LOGS);
    return response.data;
  } catch (error) {
    console.error("❌ Error fetching grow logs:", error);
    return { grows: [] };
  }
};

export const createGrow = async (growData) => {
  try {
    const response = await api.post(API_PATHS.GROW_LOGS, growData);
    return response.data;
  } catch (error) {
    console.error("❌ Error creating grow:", error);
    throw error;
  }
};

export const updateGrow = async (growId, growData) => {
  try {
    await api.put(`${API_PATHS.GROW_LOGS}/${growId}`, growData);
  } catch (error) {
    console.error("❌ Error updating grow:", error);
    throw error;
  }
};

export const deleteGrow = async (growId) => {
  try {
    await api.delete(`${API_PATHS.GROW_LOGS}/${growId}`);
  } catch (error) {
    console.error("❌ Error deleting grow:", error);
    throw error;
  }
};

export const addGrowEntry = async (growId, entryData) => {
  try {
    const response = await api.post(`${API_PATHS.GROW_LOGS}/${growId}/entries`, entryData);
    return response.data;
  } catch (error) {
    console.error("❌ Error adding grow entry:", error);
    throw error;
  }
};

export const updateGrowEntry = async (growId, entryId, entryData) => {
  try {
    await api.put(`${API_PATHS.GROW_LOGS}/${growId}/entries/${entryId}`, entryData);
  } catch (error) {
    console.error("❌ Error updating grow entry:", error);
    throw error;
  }
};

export const deleteGrowEntry = async (growId, entryId) => {
  try {
    await api.delete(`${API_PATHS.GROW_LOGS}/${growId}/entries/${entryId}`);
  } catch (error) {
    console.error("❌ Error deleting grow entry:", error);
    throw error;
  }
};

// ✅ Default Export
export default api;
