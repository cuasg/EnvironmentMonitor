import MultiRangeSlider from "multi-range-slider-react";
import React, { useState, useEffect, useCallback } from "react";
import { DndContext, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import "/src/styles/ControlPanel.css";
import api, { getSettings, updateSettings, connectWebSocket, activatePump as apiActivatePump, changePin, verifyPin, getInfluxConfig, saveInfluxConfig } from "../api";
import { formatNumber } from "../utils/format";
import { useAuth, PIN_LENGTH } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import OledEditor from "../components/OledEditor";
import { STORAGE_KEYS } from "../constants";

const defaultControlPanelTiles = [
  { id: "phCalibration" },
  { id: "phRegulation" },
  { id: "oled" },
  { id: "influx" },
  { id: "devSim" },
  { id: "pumpManual" },
  { id: "changePin" },
];

const Tile = ({ id, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} {...attributes} className="section-tile" style={style}>
      <button
        type="button"
        className="section-tile-handle"
        {...listeners}
        aria-label="Reorder section"
      >
        ⋮⋮
      </button>
      {children}
    </div>
  );
};

const ControlPanel = () => {
  const [settings, setSettings] = useState({
    ph_voltage: "N/A",
    ph_value: "N/A",
    ph4_voltage: "N/A",
    ph7_voltage: "N/A",
    ph10_voltage: "N/A",
    low_pH: 5.7,
    high_pH: 6.3,
    pump_duration: 5,
    stabilization_time: 30,
    ph_check_interval: 600,
    sensor_update_interval: 5,
    ph_min_samples: 10,
    dev_mode: false,
    dev_ph_min: 5.8,
    dev_ph_max: 6.5,
  });

  const [lastSaved, setLastSaved] = useState(null);

  const [pumpRunning, setPumpRunning] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const { runWithPin, runWithPinAlways, isAuthenticated, sessionToken, pinConfigured } = useAuth();
  const { showToast } = useToast();
  const [changePinCurrent, setChangePinCurrent] = useState("");
  const [changePinNew, setChangePinNew] = useState("");
  const [changePinConfirm, setChangePinConfirm] = useState("");
  const [changePinError, setChangePinError] = useState("");
  const [changePinSuccess, setChangePinSuccess] = useState(false);

  const [influxConfig, setInfluxConfig] = useState({ url: "", org: "HomeSensors", bucket: "plantMonitor", tokenMasked: "", configured: false });
  const [influxToken, setInfluxToken] = useState("");
  const [influxSaveStatus, setInfluxSaveStatus] = useState(null);

  const [controlPanelLoading, setControlPanelLoading] = useState(true);
  const [controlPanelError, setControlPanelError] = useState(null);
  const [controlPanelRetry, setControlPanelRetry] = useState(0);

  const [tiles, setTiles] = useState(defaultControlPanelTiles);

  useEffect(() => {
    async function fetchData() {
      setControlPanelLoading(true);
      setControlPanelError(null);
      try {
        const [data, influx] = await Promise.all([getSettings(), getInfluxConfig()]);
        if (influx) setInfluxConfig(influx);
        if (data) {
          const cal2 = data.ph_calibration?.calibration_points?.["2-point"];
          const cal3 = data.ph_calibration?.calibration_points?.["3-point"];
          const pump = data.pump_settings;
          const intervals = data.sensor_intervals;
          const ph4 = cal2?.ph4_voltage ?? "N/A";
          const ph7 = cal2?.ph7_voltage ?? "N/A";
          const ph10 = cal3?.ph10_voltage ?? "N/A";
          setSettings((prev) => ({
            ...prev,
            ph_voltage: formatNumber(data.ph_voltage),
            ph_value: formatNumber(data.pH_value),
            ph4_voltage: ph4,
            ph7_voltage: ph7,
            ph10_voltage: ph10,
            low_pH: parseFloat(pump?.low_pH ?? 5.7),
            high_pH: parseFloat(pump?.high_pH ?? 6.3),
            pump_duration: parseInt(pump?.pump_duration ?? 5, 10),
            stabilization_time: parseInt(pump?.stabilization_time ?? 30, 10),
            ph_check_interval: parseInt(intervals?.ph_check_interval ?? 600, 10),
            sensor_update_interval: parseInt(intervals?.sensor_update_interval ?? 5, 10),
            ph_min_samples: parseInt(intervals?.ph_min_samples ?? 10, 10),
            dev_mode: !!data.dev_mode,
            dev_ph_min: typeof data.dev_ph_min === "number" ? data.dev_ph_min : 5.8,
            dev_ph_max: typeof data.dev_ph_max === "number" ? data.dev_ph_max : 6.5,
          }));
          setLastSaved({
            calibration: { ph4_voltage: ph4, ph7_voltage: ph7, ph10_voltage: ph10 },
            regulation: {
              low_pH: parseFloat(pump?.low_pH ?? 5.7),
              high_pH: parseFloat(pump?.high_pH ?? 6.3),
              pump_duration: parseInt(pump?.pump_duration ?? 5, 10),
              stabilization_time: parseInt(pump?.stabilization_time ?? 30, 10),
              ph_check_interval: parseInt(intervals?.ph_check_interval ?? 600, 10),
              sensor_update_interval: parseInt(intervals?.sensor_update_interval ?? 5, 10),
              ph_min_samples: parseInt(intervals?.ph_min_samples ?? 10, 10),
            },
          });
        }
      } catch (err) {
        setControlPanelError("Could not load control panel data.");
      } finally {
        setControlPanelLoading(false);
      }
    }
    fetchData();
    connectWebSocket(updateSensorData);
  }, [controlPanelRetry]);

  const updateSensorData = useCallback((data) => {
    setSettings((prev) => ({
      ...prev,
      ph_voltage: formatNumber(data.ph_voltage),
      ph_value: formatNumber(data.pH_value),
    }));
  }, []);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setSettings((prev) => {
      if (name === "ph4_voltage" || name === "ph7_voltage" || name === "ph10_voltage") {
        return {
          ...prev,
          [name]: value === "" ? "N/A" : parseFloat(value) || "N/A",
        };
    }
    if (name === "ph_min_samples") {
      const n = parseInt(value, 10);
      if (Number.isNaN(n)) {
        return prev;
      }
      return {
        ...prev,
        ph_min_samples: n,
      };
    }
    if (name === "dev_ph_min" || name === "dev_ph_max") {
      return {
        ...prev,
        [name]: value,
      };
      }
      return {
        ...prev,
        [name]: name.includes("pH") ? parseFloat(value) : parseInt(value, 10),
      };
    });
  };

  const val = (v) => (v === "N/A" || v == null ? "N/A" : Number(v));

  const isCalibrationDirty =
    lastSaved &&
    (val(settings.ph4_voltage) !== val(lastSaved.calibration.ph4_voltage) ||
      val(settings.ph7_voltage) !== val(lastSaved.calibration.ph7_voltage) ||
      val(settings.ph10_voltage) !== val(lastSaved.calibration.ph10_voltage));

  const isRegulationDirty =
    lastSaved &&
    (settings.low_pH !== lastSaved.regulation.low_pH ||
      settings.high_pH !== lastSaved.regulation.high_pH ||
      settings.pump_duration !== lastSaved.regulation.pump_duration ||
      settings.stabilization_time !== lastSaved.regulation.stabilization_time ||
      settings.ph_check_interval !== lastSaved.regulation.ph_check_interval ||
      settings.sensor_update_interval !== lastSaved.regulation.sensor_update_interval ||
      settings.ph_min_samples !== lastSaved.regulation.ph_min_samples);

  const pushToConfig = () => {
    runWithPin(async (token) => {
      try {
        await updateSettings(
          {
            ph_calibration: {
              calibration_points: {
                "2-point": {
                  ph4_voltage: settings.ph4_voltage !== "N/A" ? parseFloat(settings.ph4_voltage) : null,
                  ph7_voltage: settings.ph7_voltage !== "N/A" ? parseFloat(settings.ph7_voltage) : null,
                },
                "3-point": {
                  ph4_voltage: settings.ph4_voltage !== "N/A" ? parseFloat(settings.ph4_voltage) : null,
                  ph7_voltage: settings.ph7_voltage !== "N/A" ? parseFloat(settings.ph7_voltage) : null,
                  ph10_voltage: settings.ph10_voltage !== "N/A" ? parseFloat(settings.ph10_voltage) : null,
                },
              },
            },
          },
          token
        );
        setLastSaved((prev) => ({
          ...prev,
          calibration: {
            ph4_voltage: settings.ph4_voltage,
            ph7_voltage: settings.ph7_voltage,
            ph10_voltage: settings.ph10_voltage,
          },
        }));
        showToast("Calibration saved.", "success");
      } catch (error) {
        showToast(error.response?.data?.error || "Error updating settings.", "error");
        console.error(error);
      }
    });
  };

  const savePhRegulationSettings = () => {
    runWithPin(async (token) => {
      try {
        await updateSettings({
          pump_settings: {
            low_pH: parseFloat(settings.low_pH),
            high_pH: parseFloat(settings.high_pH),
            pump_duration: parseInt(settings.pump_duration),
            stabilization_time: parseInt(settings.stabilization_time),
          },
          sensor_intervals: {
            ph_check_interval: parseInt(settings.ph_check_interval),
            sensor_update_interval: parseInt(settings.sensor_update_interval),
            ph_min_samples: parseInt(settings.ph_min_samples),
          },
        }, token);
        setLastSaved((prev) => ({
          ...prev,
          regulation: {
            low_pH: settings.low_pH,
            high_pH: settings.high_pH,
            pump_duration: settings.pump_duration,
            stabilization_time: settings.stabilization_time,
            ph_check_interval: settings.ph_check_interval,
            sensor_update_interval: settings.sensor_update_interval,
            ph_min_samples: settings.ph_min_samples,
          },
        }));
        showToast("Settings saved.", "success");
      } catch (error) {
        showToast(error.response?.data?.error || "Error updating settings.", "error");
        console.error(error);
      }
    });
  };

  const activatePump = (pumpType) => {
    if (pumpRunning) return;
    runWithPinAlways(async (token) => {
      const duration = settings.pump_duration;
      try {
        await apiActivatePump(pumpType, duration, token);
        // Start countdown only after server has started the pump so timer and pump run in sync
        setPumpRunning(true);
        setCountdown(duration);
        let remainingTime = duration;
        const timer = setInterval(() => {
          remainingTime -= 1;
          setCountdown(remainingTime);
          if (remainingTime <= 0) {
            clearInterval(timer);
            setPumpRunning(false);
          }
        }, 1000);
      } catch (error) {
        showToast(error.response?.data?.error || "Error activating pump.", "error");
        setPumpRunning(false);
        setCountdown(0);
      }
    });
  };

  const saveInfluxConfigHandler = () => {
    setInfluxSaveStatus(null);
    runWithPin(async (sessionToken) => {
      try {
        await saveInfluxConfig({
          url: (influxConfig.url || "").trim(),
          org: (influxConfig.org || "").trim() || "HomeSensors",
          bucket: (influxConfig.bucket || "").trim() || "plantMonitor",
          token: influxToken.trim() || undefined,
        }, sessionToken);
        setInfluxToken("");
        const updated = await getInfluxConfig();
        setInfluxConfig(updated);
        setInfluxSaveStatus("saved");
        showToast("InfluxDB config saved.", "success");
      } catch (error) {
        const msg = error.response?.data?.error || "Save failed";
        setInfluxSaveStatus(msg);
        showToast(msg, "error");
      }
    });
  };

  const handleChangePin = async (e) => {
    e.preventDefault();
    setChangePinError("");
    setChangePinSuccess(false);
    if (changePinCurrent.length !== PIN_LENGTH || !/^\d+$/.test(changePinCurrent)) {
      setChangePinError("Current PIN must be 4 digits");
      return;
    }
    if (changePinNew !== changePinConfirm) {
      setChangePinError("New PINs do not match");
      return;
    }
    if (changePinNew.length !== PIN_LENGTH || !/^\d+$/.test(changePinNew)) {
      setChangePinError("New PIN must be 4 digits");
      return;
    }
    try {
      let token = sessionToken;
      if (!token) {
        const data = await verifyPin(changePinCurrent);
        token = data?.token ?? null;
        if (!token) {
          setChangePinError("Wrong current PIN");
          return;
        }
      }
      await changePin(changePinCurrent, changePinNew, token);
      setChangePinSuccess(true);
      setChangePinCurrent("");
      setChangePinNew("");
      setChangePinConfirm("");
    } catch (err) {
      setChangePinError(err.response?.data?.error || "Failed to change PIN");
    }
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tiles.findIndex((t) => t.id === active.id);
    const newIndex = tiles.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const newOrder = arrayMove(tiles, oldIndex, newIndex);
    setTiles(newOrder);
    localStorage.setItem(STORAGE_KEYS.CONTROL_PANEL_TILES, JSON.stringify(newOrder));
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.CONTROL_PANEL_TILES);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return;
      const defaultIds = defaultControlPanelTiles.map((t) => t.id);
      const savedIds = parsed.map((t) => t.id).filter((id) => defaultIds.includes(id));
      const base = savedIds
        .map((id) => defaultControlPanelTiles.find((t) => t.id === id))
        .filter(Boolean);
      const missing = defaultControlPanelTiles.filter((t) => !savedIds.includes(t.id));
      const order = [...base, ...missing];
      setTiles(order);
    } catch {
      // ignore bad saved data
    }
  }, []);

  return (
    <div className="control-panel">
      <h1>Control Panel</h1>

      {controlPanelLoading && (
        <div className="control-panel-loading" aria-live="polite">
          Loading…
        </div>
      )}
      {controlPanelError && !controlPanelLoading && (
        <div className="control-panel-error">
          <p>{controlPanelError}</p>
          <button type="button" className="control-panel-retry-btn" onClick={() => setControlPanelRetry((r) => r + 1)}>
            Try again
          </button>
        </div>
      )}
      {!controlPanelLoading && !controlPanelError && (
      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={tiles.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <div className="control-panel-tiles">
          {tiles.map((tile) => (
            <Tile key={tile.id} id={tile.id}>
              {tile.id === "phCalibration" && (
              <div className="section">
        <h2>pH Calibration</h2>
        <p>Current Voltage: {settings.ph_voltage}V | pH: {settings.ph_value}</p>
        <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginTop: "var(--space-xs)" }}>
          Tip: Use the current voltage reading above to set calibration values.
        </p>
        <label>pH 4 Voltage:</label>
        <input
          type="number"
          step="0.001"
          name="ph4_voltage"
          value={settings.ph4_voltage === "N/A" ? "" : settings.ph4_voltage}
          onChange={handleChange}
          placeholder={settings.ph_voltage !== "N/A" ? `Current: ${settings.ph_voltage}` : "N/A"}
        />
        <label>pH 7 Voltage:</label>
        <input
          type="number"
          step="0.001"
          name="ph7_voltage"
          value={settings.ph7_voltage === "N/A" ? "" : settings.ph7_voltage}
          onChange={handleChange}
          placeholder={settings.ph_voltage !== "N/A" ? `Current: ${settings.ph_voltage}` : "N/A"}
        />
        <label>pH 10 Voltage:</label>
        <input
          type="number"
          step="0.001"
          name="ph10_voltage"
          value={settings.ph10_voltage === "N/A" ? "" : settings.ph10_voltage}
          onChange={handleChange}
          placeholder={settings.ph_voltage !== "N/A" ? `Current: ${settings.ph_voltage}` : "N/A"}
        />
        {isCalibrationDirty && (
          <button className="save-settings-button" onClick={pushToConfig}>Save</button>
        )}
      </div>
              )}
  
              {tile.id === "phRegulation" && (
      <div className="section">
        <h2>pH Regulation Settings</h2>
  
        {/* ✅ Dual Range Slider for pH */}
        <label>pH Range:</label>
        <MultiRangeSlider
          min={4}
          max={10}
          step={0.1}
          ruler={false}
          barLeftColor="lightgray"
          barInnerColor="blue"
          barRightColor="lightgray"
          minValue={settings.low_pH}
          maxValue={settings.high_pH}
          onInput={(e) => setSettings({ 
            ...settings, 
            low_pH: parseFloat(e.minValue), 
            high_pH: parseFloat(e.maxValue) 
          })}
        />
        <p>Range: {settings.low_pH} - {settings.high_pH}</p>
  
        <label>Pump Duration (sec):</label>
        <input type="number" name="pump_duration" value={settings.pump_duration} onChange={handleChange} />
  
        <label>Stabilization Time (sec):</label>
        <input type="number" name="stabilization_time" value={settings.stabilization_time} onChange={handleChange} />
  
        <label>pH Check Interval (sec):</label>
        <input type="number" name="ph_check_interval" value={settings.ph_check_interval} onChange={handleChange} />
  
        <label>Sensor Update Interval (sec):</label>
        <input type="number" name="sensor_update_interval" value={settings.sensor_update_interval} onChange={handleChange} />

        <label>Min samples for pH average:</label>
        <input
          type="number"
          name="ph_min_samples"
          min={1}
          max={500}
          value={settings.ph_min_samples}
          onChange={handleChange}
        />
  
        {isRegulationDirty && (
          <button className="save-settings-button" onClick={savePhRegulationSettings}>Save</button>
        )}
      </div>
              )}
  
              {tile.id === "oled" && (
      <div className="section oled-section">
        <h2>OLED Display Configuration</h2>
        <OledEditor />
      </div>
              )}
  
              {tile.id === "influx" && (
      <div className="section">
        <h2>InfluxDB Configuration</h2>
        <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "var(--space-sm)" }}>
          Configure your InfluxDB instance for trends and sensor logging. Saving requires your PIN.
        </p>
        <label>URL</label>
        <input
          type="url"
          value={influxConfig.url || ""}
          onChange={(e) => setInfluxConfig((c) => ({ ...c, url: e.target.value }))}
          placeholder="http://localhost:8086"
        />
        <label>Token {influxConfig.tokenMasked && <span style={{ fontWeight: "normal", color: "var(--text-muted)" }}>(current: {influxConfig.tokenMasked})</span>}</label>
        <input
          type="password"
          value={influxToken}
          onChange={(e) => setInfluxToken(e.target.value)}
          placeholder="Leave blank to keep current token"
          autoComplete="off"
        />
        <label>Organization</label>
        <input
          type="text"
          value={influxConfig.org || ""}
          onChange={(e) => setInfluxConfig((c) => ({ ...c, org: e.target.value }))}
          placeholder="HomeSensors"
        />
        <label>Bucket</label>
        <input
          type="text"
          value={influxConfig.bucket || ""}
          onChange={(e) => setInfluxConfig((c) => ({ ...c, bucket: e.target.value }))}
          placeholder="plantMonitor"
        />
        {influxSaveStatus && (
          <p style={{ marginTop: "var(--space-sm)", fontSize: "0.875rem", color: influxSaveStatus === "saved" ? "var(--accent)" : "#ef4444" }}>
            {influxSaveStatus === "saved" ? "✓ InfluxDB config saved." : influxSaveStatus}
          </p>
        )}
        <button type="button" className="save-settings-button" onClick={saveInfluxConfigHandler}>
          Save InfluxDB Config
        </button>
      </div>
              )}
  
              {tile.id === "devSim" && settings.dev_mode && (
        <div className="section">
          <h2>Dev Mode Simulation</h2>
          <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: "var(--space-sm)" }}>
            Simulated pH readings will stay within this range while dev mode is ON. This lets you test pH monitoring
            behavior around your thresholds without using real sensors. Influx logging is skipped in dev mode.
          </p>
          <label>Simulated pH minimum:</label>
          <input
            type="number"
            name="dev_ph_min"
            step="0.01"
            min={1}
            max={14}
            value={settings.dev_ph_min}
            onChange={handleChange}
          />
          <label>Simulated pH maximum:</label>
          <input
            type="number"
            name="dev_ph_max"
            step="0.01"
            min={1}
            max={14}
            value={settings.dev_ph_max}
            onChange={handleChange}
          />
          <button
            className="save-settings-button"
            onClick={() => {
              runWithPin(async (token) => {
                try {
                  await updateSettings(
                    {
                      dev_ph_min: parseFloat(settings.dev_ph_min),
                      dev_ph_max: parseFloat(settings.dev_ph_max),
                    },
                    token
                  );
                  showToast("Dev mode pH range saved.", "success");
                } catch (error) {
                  showToast(error.response?.data?.error || "Error updating dev pH range.", "error");
                }
              });
            }}
          >
            Save Dev pH Range
          </button>
        </div>
              )}
  
              {tile.id === "pumpManual" && (
      <div className="section">
        <h2>Manual Pump Control</h2>
        <label>Pump Run Duration (sec):</label>
        <input type="number" min="1" max="30" name="pump_duration" value={settings.pump_duration} onChange={handleChange} />
  
        <div className="pump-buttons">
          <button className="pump-up-button" onClick={() => activatePump(1)} disabled={pumpRunning}>
            {pumpRunning && countdown > 0 ? `Pump UP Running (${countdown}s)` : "Pump UP"}
          </button>
          <button className="pump-down-button" onClick={() => activatePump(2)} disabled={pumpRunning}>
            {pumpRunning && countdown > 0 ? `Pump DOWN Running (${countdown}s)` : "Pump DOWN"}
          </button>
        </div>
      </div>
              )}
  
              {tile.id === "changePin" && pinConfigured && (
        <div className="section">
          <h2>Change PIN</h2>
          <form onSubmit={handleChangePin}>
            <label>Current PIN</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={PIN_LENGTH}
              value={changePinCurrent}
              onChange={(e) => setChangePinCurrent(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
              placeholder="••••"
            />
            <label>New PIN</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={PIN_LENGTH}
              value={changePinNew}
              onChange={(e) => setChangePinNew(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
              placeholder="••••"
            />
            <label>Confirm new PIN</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={PIN_LENGTH}
              value={changePinConfirm}
              onChange={(e) => setChangePinConfirm(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
              placeholder="••••"
            />
            {changePinError && <p style={{ color: "#ef4444", fontSize: "0.875rem" }}>{changePinError}</p>}
            {changePinSuccess && <p style={{ color: "var(--accent)", fontSize: "0.875rem" }}>PIN changed successfully.</p>}
            <button type="submit" className="save-settings-button">Change PIN</button>
          </form>
        </div>
              )}
            </Tile>
          ))}
          </div>
        </SortableContext>
      </DndContext>
      )}
    </div>
  );
};

export default ControlPanel;
  