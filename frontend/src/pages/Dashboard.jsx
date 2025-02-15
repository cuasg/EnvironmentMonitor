import React, { useState, useEffect } from "react";
import { DndContext, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import "/src/styles/Dashboard.css";
import api, { getSettings, updateSettings, connectWebSocket } from "../api";
import { parse, format } from "date-fns";

const Tile = ({ id, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} {...attributes} className="tile" style={style}>
      {children}
    </div>
  );
};

const Dashboard = () => {
  const [tiles, setTiles] = useState([
    { id: "ph", name: "pH Sensor" },
    { id: "tds", name: "TDS Sensor" },
    { id: "light", name: "Light Sensor" },
    { id: "env", name: "Environment" },
    { id: "history", name: "pH History" },
  ]);

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
    last_pump: { pump: "None", timestamp: "N/A" },
    low_pH: 5.7,
    high_pH: 6.3,
  });

  const [phMonitoring, setPhMonitoring] = useState(false);

  const LIGHT_THRESHOLDS = {
    LOW: 2.8,
    MED: 0.31,
    HIGH: 0.0,
  };

  useEffect(() => {
    async function fetchData() {
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
            pump: data.last_pump_activation?.pump || "None",
            timestamp: formatTimestamp(data.last_pump_activation?.timestamp),
          },
          low_pH: formatNumber(data.pump_settings?.low_pH, 1),
          high_pH: formatNumber(data.pump_settings?.high_pH, 1),
        });

        setPhMonitoring(data.pH_monitoring_enabled);
      }
    }

    fetchData();
    connectWebSocket(updateSensorData);
  }, []);

  const updateSensorData = (data) => {
    setSensorData((prevState) => ({
      ...prevState,
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
        pump: data.last_pump_activation?.pump || "None",
        timestamp: formatTimestamp(data.last_pump_activation?.timestamp),
      },
      low_pH: formatNumber(data.pump_settings?.low_pH, 1),
      high_pH: formatNumber(data.pump_settings?.high_pH, 1),
    }));
  };

  const determineLightStatus = (voltage) => {
    if (voltage >= 2.5) return { label: "LOW", color: "red" };
    if (voltage >= 0.31) return { label: "MED", color: "yellow" };
    return { label: "HIGH", color: "green" }; 
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp || timestamp === "N/A") return "N/A";
  
    try {
      // Try to parse the date normally
      let date = new Date(timestamp);
  
      // If date is invalid (common in Safari), manually extract time from string
      if (isNaN(date.getTime())) {
        console.warn("⚠ Invalid Date Detected, falling back to string parsing:", timestamp);
        
        // Extracts time from a format like "2025-02-14 08:45 PM"
        const timeMatch = timestamp.match(/(\d{1,2}:\d{2} (AM|PM))/);
        return timeMatch ? timeMatch[0] : timestamp; // Return extracted time or raw string if no match
      }
  
      // Format only hour and minute, 12-hour format
      return date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    } catch (error) {
      console.error("❌ Error formatting timestamp:", error);
      return timestamp; // Fallback: Display raw string
    }
  };
  
  

  const formatNumber = (num, decimals = 2) => {
    if (num == null || isNaN(num)) return "N/A";
    return parseFloat(num.toFixed(decimals)).toString();
  };


  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (active.id !== over.id) {
      const oldIndex = tiles.findIndex((tile) => tile.id === active.id);
      const newIndex = tiles.findIndex((tile) => tile.id === over.id);
      const newOrder = arrayMove(tiles, oldIndex, newIndex);
      setTiles(newOrder);
      localStorage.setItem("tileOrder", JSON.stringify(newOrder));
    }
  };

  useEffect(() => {
    const savedOrder = localStorage.getItem("tileOrder");
    if (savedOrder) setTiles(JSON.parse(savedOrder));
  }, []);

  const togglePhMonitoring = async (event) => {
    event.stopPropagation();
    event.preventDefault();

    const newState = !phMonitoring;
    setPhMonitoring(newState);

    try {
      await updateSettings({ pH_monitoring_enabled: newState });
      console.log("✅ pH Monitoring Updated:", newState);

      const updatedData = await getSettings();
      if (updatedData) {
        setPhMonitoring(updatedData.pH_monitoring_enabled);
      }
    } catch (error) {
      console.error("❌ Error updating pH monitoring state:", error);
    }
  };


  console.log("Next Check Raw:", sensorData.next_ph_check);
  console.log("Last Check Raw:", sensorData.last_ph_check);
  console.log("Last Pump Raw:", sensorData.last_pump.timestamp);


  const formatDate = (timeString) => {
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

      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={tiles} strategy={verticalListSortingStrategy}>
          <div className="tiles-container">
            {tiles.map((tile) => (
              <Tile key={tile.id} id={tile.id}>
                {tile.id === "ph" && (
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

                {tile.id === "tds" && (
                  <>
                    <h3>TDS Sensor</h3>
                    <p>Voltage: {sensorData.tds_voltage}V</p>
                    <p>PPM (500 scale): {sensorData.ppm_500}</p>
                  </>
                )}

                {tile.id === "light" && (
                  <>
                    <h3>Light Sensor</h3>
                    <p className="light-sensor">
                      Intensity:{" "}
                      <span className={`light-intensity ${sensorData.light_status.label.toLowerCase()}`}>
                        {sensorData.light_status.label}
                      </span>
                    </p>
                    <p>Voltage: {sensorData.light_voltage}V</p>

                  </>
                )}

                {tile.id === "env" && (
                  <>
                    <h3>Environment</h3>
                    <p>Humidity: {sensorData.humidity}%</p>
                    <p>Air Temp: {sensorData.air_temp}°F</p>
                    <p>Water Temp: {sensorData.water_temp}°F</p>
                  </>
                )}

                {tile.id === "history" && (
                  <>
                    <h3>pH History</h3>
                    <p>Next Check: {formatTimestamp(sensorData.next_ph_check)}</p>
                    <p>Last Check: {formatTimestamp(sensorData.last_ph_check)}</p>
                    <p>
                      Last Pump: {sensorData.last_pump.pump}{" "}
                      {sensorData.last_pump.timestamp && sensorData.last_pump.timestamp !== "N/A" && 
                        `(${formatTimestamp(sensorData.last_pump.timestamp)})`}
                    </p>

                  </>
                )}
              </Tile>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
};

export default Dashboard;
