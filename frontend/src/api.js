import axios from "axios";

const API_BASE_URL = "http://10.0.0.207:5000"; // Backend API
const WS_URL = "ws://10.0.0.207:5000/ws/settings"; // WebSocket URL

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// ✅ WebSocket Handling
let socket = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;
const reconnectBaseDelay = 5000; // Start with 5 seconds
let onSettingsUpdate = () => {};

// ✅ Establish WebSocket Connection
export const connectWebSocket = (callback) => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    console.warn("⚠ WebSocket already connected.");
    return;
  }

  onSettingsUpdate = callback; // Assign UI update function
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
    const response = await api.get("/settings");
    return response.data;
  } catch (error) {
    console.error("❌ Error fetching settings:", error);
    return null;
  }
};

// ✅ Update Settings in Backend
export const updateSettings = async (updatedData) => {
  try {
    await api.post("/settings", updatedData);
    console.log("✅ Settings updated!");
  } catch (error) {
    console.error("❌ Error updating settings:", error);
  }
};

// ✅ Restart Program
export const restartProgram = async () => {
  try {
    await api.post("/restart-program");
    console.log("✅ Program Restarted!");
  } catch (error) {
    console.error("❌ Error restarting program:", error);
  }
};

// ✅ Restart Raspberry Pi
export const restartPi = async () => {
  try {
    await api.post("/restart-system");
    console.log("✅ Raspberry Pi Restarted!");
  } catch (error) {
    console.error("❌ Error restarting system:", error);
  }
};

// ✅ Shutdown Raspberry Pi
export const shutdownPi = async () => {
  try {
    await api.post("/shutdown");
    console.log("✅ System Shutting Down!");
  } catch (error) {
    console.error("❌ Error shutting down system:", error);
  }
};

// ✅ Default Export
export default api;
