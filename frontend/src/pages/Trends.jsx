import React, { useState, useEffect, useCallback } from "react";
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
import "/src/styles/Trends.css";
import { getTrends, getSettings } from "../api";
import { STORAGE_KEYS } from "../constants";
import { RANGES, SENSOR_LABELS, LINE_COLORS, formatTrendTime, SENSORS_HIDDEN, loadTrendsRange, saveTrendsRange, computePhYAxisDomain } from "../utils/trendsConfig";

function loadPersistedSensors() {
  try {
    const s = localStorage.getItem(STORAGE_KEYS.TRENDS_SENSORS);
    if (!s) return [];
    const a = JSON.parse(s);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

const Trends = () => {
  const [range, setRange] = useState(loadTrendsRange);
  const [availableSensors, setAvailableSensors] = useState([]);
  const [selectedSensors, setSelectedSensors] = useState(loadPersistedSensors);
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [phThresholdLow, setPhThresholdLow] = useState(null);
  const [phThresholdHigh, setPhThresholdHigh] = useState(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.TRENDS_SENSORS, JSON.stringify(selectedSensors));
  }, [selectedSensors]);

  useEffect(() => {
    saveTrendsRange(range);
  }, [range]);

  const fetchTrends = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getTrends(range, selectedSensors);
    const allSensors = res.sensors || [];
    const sensors = allSensors.filter((s) => !SENSORS_HIDDEN.includes(s));
    setAvailableSensors(sensors);
    setSelectedSensors((prev) =>
      sensors.length ? prev.filter((s) => sensors.includes(s) && !SENSORS_HIDDEN.includes(s)) : prev
    );
    setChartData(Array.isArray(res.data) ? res.data : []);
    setLoading(false);
  }, [range, selectedSensors.join(",")]);

  useEffect(() => {
    fetchTrends();
  }, [fetchTrends]);

  useEffect(() => {
    getSettings().then((data) => {
      if (!data?.pump_settings) return;
      const low = parseFloat(data.pump_settings.low_pH);
      const high = parseFloat(data.pump_settings.high_pH);
      if (!Number.isNaN(low)) setPhThresholdLow(low);
      if (!Number.isNaN(high)) setPhThresholdHigh(high);
    });
  }, []);

  const selectAll = () => setSelectedSensors([...availableSensors]);
  const deselectAll = () => setSelectedSensors([]);

  const toggleSensor = (sensor) => {
    setSelectedSensors((prev) =>
      prev.includes(sensor) ? prev.filter((s) => s !== sensor) : [...prev, sensor]
    );
  };

  const displayData = (chartData || []).map((row) => ({ ...row, time: row.time }));

  const isPhOnly =
    selectedSensors.length === 1 && selectedSensors[0] === "pH_value";

  const yAxisDomain = computePhYAxisDomain(
    displayData,
    phThresholdLow,
    phThresholdHigh,
    isPhOnly
  );

  return (
    <div className="trends-page">
      <h1 className="trends-title">Trends</h1>

      <div className="trends-controls">
        <div className="trends-range">
          <span className="trends-label">Time range</span>
          <div className="trends-range-buttons">
            {RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                className={`trends-range-btn ${range === r.value ? "active" : ""}`}
                onClick={() => setRange(r.value)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="trends-sensors">
          <div className="trends-sensors-header">
            <span className="trends-label">Sensors</span>
            <div className="trends-sensor-actions">
              <button type="button" className="trends-action-btn" onClick={selectAll}>
                Select all
              </button>
              <button type="button" className="trends-action-btn" onClick={deselectAll}>
                Deselect all
              </button>
            </div>
          </div>
          <div className="trends-sensors-list">
            {(availableSensors.length ? availableSensors : []).map((sensor) => (
              <label key={sensor} className="trends-sensor-item">
                <input
                  type="checkbox"
                  checked={selectedSensors.includes(sensor)}
                  onChange={() => toggleSensor(sensor)}
                />
                <span>{SENSOR_LABELS[sensor] ?? sensor}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="trends-chart-wrap">
        {loading && <div className="trends-loading">Loading…</div>}
        {error && <div className="trends-error">{error}</div>}
        {!loading && !error && selectedSensors.length === 0 && (
          <div className="trends-empty">Select one or more sensors to display the chart.</div>
        )}
        {!loading && !error && selectedSensors.length > 0 && (
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={displayData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="time"
                tickFormatter={formatTrendTime}
                stroke="var(--text-muted)"
                tick={{ fill: "var(--text-muted)", fontSize: 12 }}
              />
              <YAxis
                stroke="var(--text-muted)"
                tick={{ fill: "var(--text-muted)", fontSize: 12 }}
                domain={yAxisDomain}
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
                wrapperStyle={{ paddingTop: 8 }}
                formatter={(value) => SENSOR_LABELS[value] ?? value}
                iconType="line"
                iconSize={10}
              />
              {selectedSensors.includes("pH_value") && phThresholdLow != null && (
                <ReferenceLine
                  y={phThresholdLow}
                  stroke="red"
                  strokeDasharray="4 4"
                  strokeOpacity={0.8}
                />
              )}
              {selectedSensors.includes("pH_value") && phThresholdHigh != null && (
                <ReferenceLine
                  y={phThresholdHigh}
                  stroke="red"
                  strokeDasharray="4 4"
                  strokeOpacity={0.8}
                />
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

export default Trends;
