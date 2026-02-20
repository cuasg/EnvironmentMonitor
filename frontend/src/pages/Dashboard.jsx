import React, { useState, useEffect, useCallback, useRef } from "react";
import { DndContext, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import "/src/styles/Dashboard.css";
import api, { getSettings, updateSettings, connectWebSocket, getTrends, activatePump as apiActivatePump } from "../api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { formatNumber, formatTimestamp, formatTimestampWithDate, determineLightStatus } from "../utils/format";
import { loadOledPreviewSettings, saveOledPreviewSettings } from "../utils/oledPreview";
import { RANGES, SENSOR_LABELS, LINE_COLORS, formatTrendTime, SENSORS_HIDDEN, loadTrendsRange, saveTrendsRange } from "../utils/trendsConfig";
import { STORAGE_KEYS, API_PATHS } from "../constants";
import OledMirror from "../components/OledMirror";

const DASHBOARD_GRAPH_ID = "graph";

function loadPersistedTrendsSensors() {
  try {
    const s = localStorage.getItem(STORAGE_KEYS.TRENDS_SENSORS);
    if (!s) return [];
    const a = JSON.parse(s);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

const defaultDashboardOrder = [
  { id: "ph", name: "pH Sensor" },
  { id: "tds", name: "Pump Control" },
  { id: "light", name: "Light Sensor" },
  { id: "env", name: "Environment" },
  { id: "history", name: "pH History" },
  { id: "oled", name: "OLED Display" },
  { id: DASHBOARD_GRAPH_ID, name: "Trends" },
];

const Tile = ({ id, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className="tile" style={style}>
      {children}
    </div>
  );
};

const SortableGraph = ({ trendsRange, setTrendsRange, chartData, loading, error, selectedSensors, phThresholdLow, phThresholdHigh }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: DASHBOARD_GRAPH_ID });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const displayData = (chartData || []).map((row) => ({ ...row, time: row.time }));

  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className="tile tile-dashboard-graph" style={style}>
      <div className="dashboard-graph-header">
        <h3>Sensor Trends</h3>
        <div className="dashboard-graph-range">
          <span className="dashboard-graph-range-label">Range:</span>
          <select
            value={trendsRange}
            onChange={(e) => setTrendsRange(e.target.value)}
            className="dashboard-graph-range-select"
            onClick={(e) => e.stopPropagation()}
          >
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="dashboard-graph-inner">
        {loading && <div className="dashboard-graph-loading">Loading…</div>}
        {error && <div className="dashboard-graph-error">{error}</div>}
        {!loading && !error && selectedSensors.length === 0 && (
          <div className="dashboard-graph-empty">Select sensors on the Trends page to show the chart here.</div>
        )}
        {!loading && !error && selectedSensors.length > 0 && (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={displayData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="time"
                tickFormatter={formatTrendTime}
                stroke="var(--text-muted)"
                tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              />
              <YAxis
                stroke="var(--text-muted)"
                tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                domain={["auto", "auto"]}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--bg-card)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                }}
                labelStyle={{ color: "var(--text)" }}
                labelFormatter={formatTrendTime}
                formatter={(value) => [value?.toFixed(2) ?? value, null]}
              />
              <Legend
                wrapperStyle={{ paddingTop: 6 }}
                formatter={(value) => SENSOR_LABELS[value] ?? value}
                iconType="line"
                iconSize={10}
              />
              {selectedSensors.includes("pH_value") && phThresholdLow != null && (
                <ReferenceLine y={phThresholdLow} stroke="red" strokeDasharray="4 4" strokeOpacity={0.8} />
              )}
              {selectedSensors.includes("pH_value") && phThresholdHigh != null && (
                <ReferenceLine y={phThresholdHigh} stroke="red" strokeDasharray="4 4" strokeOpacity={0.8} />
              )}
              {selectedSensors.map((sensor, i) => (
                <Line
                  key={sensor}
                  type="monotone"
                  dataKey={sensor}
                  name={sensor}
                  stroke={LINE_COLORS[i % LINE_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

const LightGauge = ({ level }) => {
  const idx = level === "LOW" ? 0 : level === "MED" ? 1 : 2;
  return (
    <div className="light-gauge" role="img" aria-label={`Light intensity: ${level}`}>
      <div className="light-gauge-track">
        <div className="light-gauge-segment light-gauge-low" />
        <div className="light-gauge-segment light-gauge-med" />
        <div className="light-gauge-segment light-gauge-high" />
      </div>
      <div className="light-gauge-needle-wrap">
        <div className="light-gauge-needle" style={{ "--gauge-index": idx }} />
      </div>
      <div className="light-gauge-labels">
        <span>Low</span>
        <span>Med</span>
        <span>High</span>
      </div>
    </div>
  );
};

const Dashboard = () => {
  const [tiles, setTiles] = useState(defaultDashboardOrder);

  const [sensorData, setSensorData] = useState({
    ph_value: "N/A",
    ph_voltage: "N/A",
    ppm_500: "N/A",
    tds_voltage: "N/A",
    light_voltage: "N/A",
    light_status: { label: "LOW", color: "red" },
    humidity: "N/A",
    air_temp: "N/A",
    water_temp: "N/A",
    last_ph_check: "N/A",
    next_ph_check: "N/A",
    last_pump: { pump: "None", timestampRaw: "N/A" },
    low_pH: 5.7,
    high_pH: 6.3,
    pump_duration: 5,
  });

  const [phMonitoring, setPhMonitoring] = useState(false);
  const [pumpRunning, setPumpRunning] = useState(false);
  const [pumpCountdown, setPumpCountdown] = useState(0);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState(null);
  const [dashboardRetry, setDashboardRetry] = useState(0);
  const [oledPreviewSettings, setOledPreviewSettings] = useState(loadOledPreviewSettings);
  const { runWithPin, runWithPinAlways } = useAuth();
  const { showToast } = useToast();
  const [oledConfig, setOledConfig] = useState({ pages: [] });
  const [settingsForOled, setSettingsForOled] = useState(null);

  const [trendsRange, setTrendsRange] = useState(loadTrendsRange);
  const [trendsData, setTrendsData] = useState([]);
  const [trendsLoading, setTrendsLoading] = useState(false);
  const [trendsError, setTrendsError] = useState(null);
  const [selectedTrendsSensors, setSelectedTrendsSensors] = useState(loadPersistedTrendsSensors);
  const [phThresholdLow, setPhThresholdLow] = useState(null);
  const [phThresholdHigh, setPhThresholdHigh] = useState(null);

  useEffect(() => {
    async function fetchData() {
      setDashboardLoading(true);
      setDashboardError(null);
      try {
        const data = await getSettings();
        if (data) {
          setSensorData({
            ph_value: formatNumber(data.pH_value),
            ph_voltage: formatNumber(data.ph_voltage),
            ppm_500: formatNumber(data.ppm_500),
            tds_voltage: formatNumber(data.tds_voltage),
            light_voltage: formatNumber(data.light_sensor?.analog_voltage),
            light_status: determineLightStatus(data.light_sensor?.analog_voltage || 0),
            humidity: formatNumber(data.humidity),
            air_temp: formatNumber(data.air_temperature_f),
            water_temp: formatNumber(data.water_temperature_f),
            last_ph_check: formatTimestamp(data.last_ph_check),
            next_ph_check: formatTimestamp(data.next_ph_check),
            last_pump: {
              pump: data.last_pump_activation?.pump ?? "None",
              timestampRaw: data.last_pump_activation?.timestamp ?? "N/A",
            },
            low_pH: formatNumber(data.pump_settings?.low_pH, 1),
            high_pH: formatNumber(data.pump_settings?.high_pH, 1),
            pump_duration: parseInt(data.pump_settings?.pump_duration ?? 5, 10),
          });
          setSettingsForOled(data);
          setPhMonitoring(data.pH_monitoring_enabled);
        }
      } catch (err) {
        setDashboardError("Could not load dashboard data.");
      } finally {
        setDashboardLoading(false);
      }
    }

    fetchData();
    connectWebSocket(updateSensorData);
  }, [dashboardRetry]);

  useEffect(() => {
    api.get(API_PATHS.OLED_CONFIG).then((res) => {
      const config = res.data || { pages: [] };
      setOledConfig(Array.isArray(config.pages) ? config : { pages: config.pages || [] });
    }).catch(() => setOledConfig({ pages: [] }));
  }, []);

  const oledEnabledPages = oledConfig.pages?.filter((p) => p.enabled !== false) || [];

  useEffect(() => {
    let cancelled = false;
    setTrendsLoading(true);
    setTrendsError(null);
    const sensors = loadPersistedTrendsSensors();
    getTrends(trendsRange, sensors)
      .then((res) => {
        if (cancelled) return;
        const allSensors = res.sensors || [];
        const available = allSensors.filter((s) => !SENSORS_HIDDEN.includes(s));
        setSelectedTrendsSensors((prev) =>
          sensors.length ? sensors.filter((s) => available.includes(s)) : prev
        );
        setTrendsData(Array.isArray(res.data) ? res.data : []);
      })
      .catch((err) => {
        if (!cancelled) setTrendsError(err.message || "Could not load trends.");
      })
      .finally(() => {
        if (!cancelled) setTrendsLoading(false);
      });
    return () => { cancelled = true; };
  }, [trendsRange]);

  useEffect(() => {
    saveTrendsRange(trendsRange);
  }, [trendsRange]);

  useEffect(() => {
    getSettings().then((data) => {
      if (!data?.pump_settings) return;
      const low = parseFloat(data.pump_settings.low_pH);
      const high = parseFloat(data.pump_settings.high_pH);
      if (!Number.isNaN(low)) setPhThresholdLow(low);
      if (!Number.isNaN(high)) setPhThresholdHigh(high);
    });
  }, []);

  const lastSensorSignatureRef = useRef("");
  const lastOledUpdateRef = useRef(0);
  const WS_THROTTLE_MS = 2000;

  const updateSensorData = useCallback((data) => {
    const phVal = formatNumber(data.pH_value);
    const ppm = formatNumber(data.ppm_500);
    const hum = formatNumber(data.humidity);
    const air = formatNumber(data.air_temperature_f);
    const water = formatNumber(data.water_temperature_f);
    const lightVolt = formatNumber(data.light_sensor?.analog_voltage);
    const signature = [phVal, ppm, hum, air, water, lightVolt, data.last_pump_activation?.timestamp].join("|");
    if (signature === lastSensorSignatureRef.current) return;
    lastSensorSignatureRef.current = signature;

    setSensorData((prev) => ({
      ...prev,
      ph_value: phVal,
      ph_voltage: formatNumber(data.ph_voltage),
      ppm_500: ppm,
      tds_voltage: formatNumber(data.tds_voltage),
      light_voltage: lightVolt,
      light_status: determineLightStatus(data.light_sensor?.analog_voltage ?? 0),
      humidity: hum,
      air_temp: air,
      water_temp: water,
      last_ph_check: formatTimestamp(data.last_ph_check),
      next_ph_check: formatTimestamp(data.next_ph_check),
      last_pump: {
        pump: data.last_pump_activation?.pump ?? "None",
        timestampRaw: data.last_pump_activation?.timestamp ?? "N/A",
      },
      low_pH: formatNumber(data.pump_settings?.low_pH, 1),
      high_pH: formatNumber(data.pump_settings?.high_pH, 1),
      pump_duration: data.pump_settings?.pump_duration != null
        ? parseInt(data.pump_settings.pump_duration, 10) : prev.pump_duration,
    }));

    const now = Date.now();
    if (now - lastOledUpdateRef.current >= WS_THROTTLE_MS) {
      lastOledUpdateRef.current = now;
      setSettingsForOled((prev) => (prev ? { ...prev, ...data } : prev));
    }
  }, []);


  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tiles.findIndex((t) => t.id === active.id);
    const newIndex = tiles.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const newOrder = arrayMove(tiles, oldIndex, newIndex);
    setTiles(newOrder);
    localStorage.setItem(STORAGE_KEYS.TILE_ORDER, JSON.stringify(newOrder));
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.TILE_ORDER);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return;
      const hasGraph = parsed.some((t) => t.id === DASHBOARD_GRAPH_ID);
      const order = hasGraph ? parsed : [...parsed, { id: DASHBOARD_GRAPH_ID, name: "Trends" }];
      setTiles(order);
    } catch (_) {}
  }, []);

  const togglePhMonitoring = (event) => {
    event.stopPropagation();
    event.preventDefault();
    const newState = !phMonitoring;
    runWithPin(async (token) => {
      try {
        await updateSettings({ pH_monitoring_enabled: newState }, token);
        setPhMonitoring(newState);
        const updatedData = await getSettings();
        if (updatedData) setPhMonitoring(!!updatedData.pH_monitoring_enabled);
      } catch (error) {
        showToast(error.response?.data?.error || "Error updating pH monitoring.", "error");
      }
    });
  };

  const activatePump = (pumpType) => {
    if (pumpRunning) return;
    const duration = typeof sensorData.pump_duration === "number" ? sensorData.pump_duration : 5;
    runWithPinAlways(async (token) => {
      setPumpRunning(true);
      setPumpCountdown(duration);
      try {
        await apiActivatePump(pumpType, duration, token);
      } catch (error) {
        showToast(error.response?.data?.error || "Error activating pump.", "error");
        setPumpRunning(false);
        return;
      }
      let remaining = duration;
      const timer = setInterval(() => {
        remaining -= 1;
        setPumpCountdown(remaining);
        if (remaining <= 0) {
          clearInterval(timer);
          setPumpRunning(false);
        }
      }, 1000);
    });
  };

  const _formatDateUnused = (timeString) => {
    if (!timeString || timeString === "N/A") return "N/A"; // Handle missing values
  
    // ✅ Get today’s date
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1; // JS months are 0-based
    const day = today.getDate();
  
    // ✅ Convert timeString into Safari-friendly format: "YYYY/MM/DD HH:MM:SS AM/PM"
    const fullDateTime = `${year}/${month}/${day} ${timeString}`;
  
    // ✅ Create Date Object
    const date = new Date(fullDateTime);
  
    // ✅ Validate Date
    if (isNaN(date.getTime())) return "Invalid Date";
  
    // ✅ Format as "Feb 13, 8:30 PM"
    return date.toLocaleString("en-US", {
      month: "short", // "Feb"
      day: "numeric", // "13"
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  return (
    <div className="dashboard">
      <h1 className="dashboard-title">Hydroponics Monitoring Dashboard</h1>

      {dashboardLoading && (
        <div className="dashboard-loading" aria-live="polite">
          Loading…
        </div>
      )}
      {dashboardError && !dashboardLoading && (
        <div className="dashboard-error">
          <p>{dashboardError}</p>
          <button type="button" className="dashboard-retry-btn" onClick={() => setDashboardRetry((r) => r + 1)}>
            Try again
          </button>
        </div>
      )}
      {!dashboardLoading && !dashboardError && (
      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={tiles.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <div className="tiles-container">
            {tiles.map((item) =>
              item.id === DASHBOARD_GRAPH_ID ? (
                <SortableGraph
                  key={DASHBOARD_GRAPH_ID}
                  trendsRange={trendsRange}
                  setTrendsRange={setTrendsRange}
                  chartData={trendsData}
                  loading={trendsLoading}
                  error={trendsError}
                  selectedSensors={selectedTrendsSensors}
                  phThresholdLow={phThresholdLow}
                  phThresholdHigh={phThresholdHigh}
                />
              ) : (
              <Tile key={item.id} id={item.id}>
                {item.id === "ph" && (
                  <>
                    <h3>pH Sensor</h3>
                    <p>Voltage: {sensorData.ph_voltage}V</p>
                    <p>pH: {sensorData.ph_value}</p>
                    <p>Range: {sensorData.low_pH} - {sensorData.high_pH}</p>
                    <div className="ph-controls">
                      <label>Auto pH:</label>
                      <div
                        className={`toggle-switch ${phMonitoring ? "on" : "off"}`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={togglePhMonitoring}
                      >
                        <div className="toggle-thumb"></div>
                      </div>
                    </div>
                  </>
                )}

                {item.id === "tds" && (
                  <>
                    <h3>Pump Control</h3>
                    <div
                      className="tile-pump-control"
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <label className="tile-pump-duration-label">Duration (sec)</label>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        className="tile-pump-duration"
                        value={sensorData.pump_duration}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (!Number.isNaN(v) && v >= 1 && v <= 30) {
                            setSensorData((prev) => ({ ...prev, pump_duration: v }));
                          }
                        }}
                        onBlur={() => {
                          const v = sensorData.pump_duration;
                          if (v < 1 || v > 30) return;
                          runWithPin(async (token) => {
                            try {
                              await updateSettings({
                                pump_settings: { pump_duration: v },
                              }, token);
                              showToast("Pump duration saved.", "success");
                            } catch (err) {
                              showToast(err.response?.data?.error || "Failed to save duration.", "error");
                            }
                          });
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                      />
                      <div className="tile-pump-buttons">
                        <button
                          type="button"
                          className="tile-pump-up"
                          onClick={(e) => { e.stopPropagation(); activatePump(1); }}
                          onPointerDown={(e) => e.stopPropagation()}
                          disabled={pumpRunning}
                        >
                          {pumpRunning && pumpCountdown > 0 ? `UP (${pumpCountdown}s)` : "Pump UP"}
                        </button>
                        <button
                          type="button"
                          className="tile-pump-down"
                          onClick={(e) => { e.stopPropagation(); activatePump(2); }}
                          onPointerDown={(e) => e.stopPropagation()}
                          disabled={pumpRunning}
                        >
                          {pumpRunning && pumpCountdown > 0 ? `DOWN (${pumpCountdown}s)` : "Pump DOWN"}
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {item.id === "light" && (
                  <>
                    <h3>Light Sensor</h3>
                    <LightGauge level={sensorData.light_status.label} />
                    <p className="light-sensor">
                      <span className={`light-intensity ${sensorData.light_status.label.toLowerCase()}`}>
                        {sensorData.light_status.label}
                      </span>
                    </p>
                    <p>Voltage: {sensorData.light_voltage}V</p>
                  </>
                )}

                {item.id === "env" && (
                  <>
                    <h3>Environment</h3>
                    <p>PPM (500): {sensorData.ppm_500}</p>
                    <p>Humidity: {sensorData.humidity}%</p>
                    <p>Air Temp: {sensorData.air_temp}°F</p>
                    <p>Water Temp: {sensorData.water_temp}°F</p>
                  </>
                )}

                {item.id === "history" && (
                  <>
                    <h3>pH History</h3>
                    <p>Next Check: {formatTimestamp(sensorData.next_ph_check)}</p>
                    <p>Last Check: {formatTimestamp(sensorData.last_ph_check)}</p>
                    <p>
                      Last Pump:{" "}
                      {sensorData.last_pump.pump === "up" && <span className="pump-up">Up</span>}
                      {sensorData.last_pump.pump === "down" && <span className="pump-down">Down</span>}
                      {sensorData.last_pump.pump !== "up" && sensorData.last_pump.pump !== "down" && sensorData.last_pump.pump}
                      {" "}
                      {sensorData.last_pump.timestampRaw && sensorData.last_pump.timestampRaw !== "N/A" &&
                        formatTimestampWithDate(sensorData.last_pump.timestampRaw)}
                    </p>
                  </>
                )}

                {item.id === "oled" && (
                  <>
                    <h3>OLED Display</h3>
                    <div className="tile-oled-wrap">
                      <OledMirror
                        refreshInterval={2000}
                        compact={true}
                        previewPages={oledEnabledPages}
                        previewInterval={settingsForOled?.oled_page_interval_seconds ?? 10}
                        previewSettings={settingsForOled}
                        textSize={oledPreviewSettings.textSize}
                        textColor={oledPreviewSettings.textColor}
                      />
                      <div className="tile-oled-controls">
                        <label>
                          Text Size:
                          <select
                            value={oledPreviewSettings.textSize}
                            onChange={(e) => {
                              const newSettings = { ...oledPreviewSettings, textSize: e.target.value };
                              setOledPreviewSettings(newSettings);
                              saveOledPreviewSettings(newSettings);
                            }}
                            className="tile-oled-select"
                          >
                            <option value="small">Small</option>
                            <option value="med">Medium</option>
                            <option value="large">Large</option>
                          </select>
                        </label>
                        <label>
                          Color:
                          <select
                            value={oledPreviewSettings.textColor}
                            onChange={(e) => {
                              const newSettings = { ...oledPreviewSettings, textColor: e.target.value };
                              setOledPreviewSettings(newSettings);
                              saveOledPreviewSettings(newSettings);
                            }}
                            className="tile-oled-select"
                          >
                            <option value="white">White</option>
                            <option value="#00ff00">Green</option>
                            <option value="#0080ff">Blue</option>
                            <option value="#ff0000">Red</option>
                            <option value="#ffff00">Yellow</option>
                            <option value="#ff00ff">Magenta</option>
                            <option value="#00ffff">Cyan</option>
                          </select>
                        </label>
                      </div>
                    </div>
                  </>
                )}
              </Tile>
              )
            )}
          </div>
        </SortableContext>
      </DndContext>
      )}
    </div>
  );
};

export default Dashboard;
