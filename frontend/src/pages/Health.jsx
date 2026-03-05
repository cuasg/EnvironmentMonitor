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
};

const Health = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
    if (typeof value === "object" && value !== null && "ok" in value) return value.ok;
    return false;
  };

  const getDetail = (key, value) => {
    if (key === "api") return value === "ok" ? "Reachable" : null;
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
            return (
              <div key={key} className="health-row" role="listitem">
                <span
                  className={`health-indicator ${ok ? "ok" : "error"}`}
                  aria-label={`${HEALTH_LABELS[key] || key}: ${ok ? "OK" : "Error"}`}
                  title={detail || (ok ? "OK" : "Error")}
                />
                <span className="health-label">{HEALTH_LABELS[key] || key}</span>
                {detail && <span className="health-detail">{detail}</span>}
              </div>
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
