import React, { useEffect, useState } from "react";
import "/src/styles/InfluxStatusPopup.css";
import api from "../api";
import { API_PATHS } from "../constants";

const ACTIVITY_WINDOW_SECONDS = 10;

const InfluxActivityIndicator = () => {
  const [status, setStatus] = useState({
    connected: true,
    error: null,
    dev_mode: false,
    activity: {
      last_write_ok_at: null,
      last_write_error: null,
      last_read_ok_at: null,
      last_read_error: null,
    },
  });

  useEffect(() => {
    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const res = await api.get(API_PATHS.INFLUX_STATUS);
        if (!cancelled) {
          setStatus((prev) => ({ ...prev, ...res.data }));
        }
      } catch {
        if (!cancelled) {
          setStatus((prev) => ({ ...prev, connected: false, error: "Status check failed" }));
        }
      }
    };

    fetchStatus();
    const id = setInterval(fetchStatus, 10000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const { connected, error, dev_mode, activity } = status;

  if (dev_mode) return null;

  const nowSec = Date.now() / 1000;
  const withinWindow = (ts) => typeof ts === "number" && nowSec - ts <= ACTIVITY_WINDOW_SECONDS;

  const recentWrite = withinWindow(activity.last_write_ok_at);
  const recentRead = withinWindow(activity.last_read_ok_at);
  const hasError = !!error || !!activity.last_write_error || !!activity.last_read_error || !connected;

  let className = "influx-activity-indicator";
  if (hasError) className += " influx-activity-error";
  else if (recentWrite || recentRead) className += " influx-activity-active";

  const title = hasError
    ? "Influx error – check configuration or logs."
    : recentWrite || recentRead
    ? "Influx active – recent reads/writes."
    : "Influx idle – connected.";

  return (
    <div className={className} title={title} aria-label={title}>
      {hasError ? (
        <span className="influx-activity-icon influx-activity-icon-error">⦸</span>
      ) : (
        <span className="influx-activity-icon">
          {recentWrite && recentRead ? "⇄" : recentWrite ? "⬆" : recentRead ? "⬇" : "◎"}
        </span>
      )}
    </div>
  );
};

export default InfluxActivityIndicator;

