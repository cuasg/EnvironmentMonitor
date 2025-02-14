import MultiRangeSlider from "multi-range-slider-react";
import React, { useState, useEffect } from "react";
import "/src/styles/ControlPanel.css";
import api, { getSettings, updateSettings, connectWebSocket } from "../api";

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
  });

  const [pumpRunning, setPumpRunning] = useState(false);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    async function fetchData() {
      const data = await getSettings();
      if (data) {
        setSettings({
          ...settings,
          ph_voltage: formatNumber(data.ph_voltage),
          ph_value: formatNumber(data.pH_value),
          ph4_voltage: data.ph_calibration?.calibration_points["2-point"]?.ph4_voltage ?? "N/A",
          ph7_voltage: data.ph_calibration?.calibration_points["2-point"]?.ph7_voltage ?? "N/A",
          ph10_voltage: data.ph_calibration?.calibration_points["3-point"]?.ph10_voltage ?? "N/A",
          low_pH: parseFloat(data.pump_settings?.low_pH ?? 5.7),
          high_pH: parseFloat(data.pump_settings?.high_pH ?? 6.3),
          pump_duration: parseInt(data.pump_settings?.pump_duration ?? 5),
          stabilization_time: parseInt(data.pump_settings?.stabilization_time ?? 30),
          ph_check_interval: parseInt(data.sensor_intervals?.ph_check_interval ?? 600),
          sensor_update_interval: parseInt(data.sensor_intervals?.sensor_update_interval ?? 5),
        });
      }
    }

    fetchData();
    connectWebSocket(updateSensorData);
  }, []);

  const updateSensorData = (data) => {
    setSettings((prev) => ({
      ...prev,
      ph_voltage: formatNumber(data.ph_voltage),
      ph_value: formatNumber(data.pH_value),
    }));
  };

  const formatNumber = (value) => {
    if (value === "N/A" || value === null || value === undefined) return "N/A";
    return parseFloat(value).toFixed(value % 1 === 0 ? 0 : 2);
  };

  const commitCalibration = (type) => {
    setSettings((prev) => ({
      ...prev,
      [`${type}_voltage`]: prev.ph_voltage !== "N/A" ? parseFloat(prev.ph_voltage) : "N/A",
    }));
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    setSettings((prev) => ({
      ...prev,
      [name]: name.includes("pH") ? parseFloat(value) : parseInt(value, 10),
    }));
  };

  const pushToConfig = async () => {
    try {
      await updateSettings({
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
      });
      alert("✅ Calibration Settings Updated Successfully!");
    } catch (error) {
      alert("❌ Error updating settings.");
      console.error(error);
    }
  };

  const savePhRegulationSettings = async () => {
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
        },
      });
      alert("✅ pH Regulation Settings Updated Successfully!");
    } catch (error) {
      alert("❌ Error updating pH regulation settings.");
      console.error(error);
    }
  };
  const activatePump = async (pumpType) => {
    if (pumpRunning) return;
  
    setPumpRunning(true);
    setCountdown(settings.pump_duration);
  
    try {
      await api.post("/activate-pump", { pump: pumpType, duration: settings.pump_duration });
      console.log(`✅ Pump ${pumpType === 1 ? "UP" : "DOWN"} activated for ${settings.pump_duration} seconds`);
    } catch (error) {
      console.error(`❌ Error activating pump ${pumpType}:`, error);
    }
  
    let remainingTime = settings.pump_duration;
    const timer = setInterval(() => {
      remainingTime -= 1;
      setCountdown(remainingTime);
      if (remainingTime <= 0) {
        clearInterval(timer);
        setPumpRunning(false);
      }
    }, 1000);
  };
  
  return (
    <div className="control-panel">
      <h1>Control Panel</h1>
  
      {/* 🔹 pH Calibration Section */}
      <div className="section">
        <h2>pH Calibration</h2>
        <p>Current Voltage: {settings.ph_voltage}V | pH: {settings.ph_value}</p>
        <div className="calibration-row">
          <label>pH 4 Voltage:</label>
          <input type="text" value={settings.ph4_voltage} readOnly />
          <button className="commit-button" onClick={() => commitCalibration("ph4")}>Commit</button>
        </div>
        <div className="calibration-row">
          <label>pH 7 Voltage:</label>
          <input type="text" value={settings.ph7_voltage} readOnly />
          <button className="commit-button" onClick={() => commitCalibration("ph7")}>Commit</button>
        </div>
        <div className="calibration-row">
          <label>pH 10 Voltage:</label>
          <input type="text" value={settings.ph10_voltage} readOnly />
          <button className="commit-button" onClick={() => commitCalibration("ph10")}>Commit</button>
        </div>
        <button className="push-config-button" onClick={pushToConfig}>Push to Config</button>
      </div>
  
      {/* 🔹 pH Regulation Settings */}
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
  
        <button className="save-settings-button" onClick={savePhRegulationSettings}>Save Settings</button>
      </div>
  
      {/* 🔹 Manual Pump Control */}
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
    </div>
  );
  };
  
  export default ControlPanel;
  