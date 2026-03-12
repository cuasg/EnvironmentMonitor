import React, { useState, useEffect } from "react";
import "/src/styles/Health.css";
import api from "../api";
import { API_PATHS } from "../constants";

const HEALTH_LABELS = {
  api: "API",
  influx: "InfluxDB",
  sensors_recent: "Sensors (recent)",
  settings_file: "Settings file",
  grow_logs_file: "Grow logs file",
  ph_checks: "pH checks log",
};

const Health = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedKey, setExpandedKey] = useState(null);

  const fetchHealth = async () => {
    try {
      const res = await api.get(API_PATHS.HEALTH);
      setData(res.data);
      setError(null);
    } catch (err) {
      setData(null);
      setError(err.message || "Failed to load health status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !data) {
    return (
      <div className="health-page">
        <h1 className="health-title">System Health</h1>
        <p className="health-loading">Loading…</p>
      </div>
    );
  }

  const getOk = (key, value) => {
    if (key === "api") return value === "ok";
    if (key === "ph_checks" && Array.isArray(value)) return value.length > 0;
    if (typeof value === "object" && value !== null && "ok" in value) return value.ok;
    return false;
  };

  const getDetail = (key, value) => {
    if (key === "api") return value === "ok" ? "Reachable" : null;
    if (key === "ph_checks" && Array.isArray(value)) {
      if (!value.length) return "No pH checks recorded yet";
      const last = value[value.length - 1];
      const ts = last.timestamp || "";
      const reason = last.reason || "unknown";
      return `${value.length} pH checks logged; last at ${ts} (${reason})`;
    }
    if (typeof value !== "object" || value === null) return null;
    const err = value.error || value.details;
    if (err) return err;
    if (key === "sensors_recent") {
      if (value.ok === false && (value.sensors_unavailable_reason || value.details))
        return value.sensors_unavailable_reason || value.details;
      if (value.last_ph_check) return `Last pH check: ${value.last_ph_check}`;
    }
    return null;
  };

  return (
    <div className="health-page">
      <h1 className="health-title">System Health</h1>
      {error && <p className="health-error">{error}</p>}
      <div className="health-list" role="list">
        {data &&
          Object.entries(data).map(([key, value]) => {
            const ok = getOk(key, value);
            const detail = getDetail(key, value);
            const isPhChecks = key === "ph_checks";
            const isExpanded = isPhChecks && expandedKey === key;

            return (
              <React.Fragment key={key}>
                <div
                  className={`health-row ${isPhChecks ? "health-row-clickable" : ""}`}
                  role="listitem"
                  onClick={
                    isPhChecks
                      ? () => setExpandedKey(isExpanded ? null : key)
                      : undefined
                  }
                >
                  <span
                    className={`health-indicator ${ok ? "ok" : "error"}`}
                    aria-label={`${HEALTH_LABELS[key] || key}: ${ok ? "OK" : "Error"}`}
                    title={detail || (ok ? "OK" : "Error")}
                  />
                  <span className="health-label">
                    {HEALTH_LABELS[key] || key}
                    {isPhChecks && (
                      <span className="health-label-extra">
                        {isExpanded ? " (click to collapse)" : " (click to expand)"}
                      </span>
                    )}
                  </span>
                  {detail && <span className="health-detail">{detail}</span>}
                </div>
                {isPhChecks && isExpanded && Array.isArray(value) && value.length > 0 && (
                  <div className="health-ph-checks-detail">
                    <table>
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Avg pH</th>
                          <th>Samples</th>
                          <th>Reason</th>
                          <th>Readings (first 5)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...value]
                          .slice()
                          .reverse()
                          .map((entry, idx) => {
                            const readings = Array.isArray(entry.readings) ? entry.readings : [];
                            const preview = readings.slice(0, 5).join(", ");
                            const suffix = readings.length > 5 ? "…" : "";
                            return (
                              <tr key={entry.timestamp || idx}>
                                <td>{entry.timestamp}</td>
                                <td>{entry.avg_ph_value != null ? entry.avg_ph_value : "—"}</td>
                                <td>
                                  {entry.samples_available}/{entry.samples_required}
                                </td>
                                <td>{entry.reason || "unknown"}</td>
                                <td>
                                  {preview}
                                  {suffix}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                )}
              </React.Fragment>
            );
          })}
      </div>
      <button type="button" className="health-refresh" onClick={fetchHealth}>
        Refresh
      </button>
    </div>
  );
};

export default Health;
