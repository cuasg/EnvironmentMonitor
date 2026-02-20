import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "/src/styles/InfluxStatusPopup.css";
import api from "../api";
import { STORAGE_KEYS, API_PATHS } from "../constants";

const InfluxStatusPopup = () => {
  const navigate = useNavigate();
  const [showPopup, setShowPopup] = useState(false);
  const [status, setStatus] = useState({ connected: true, error: null });
  const [dismissed, setDismissed] = useState(() =>
    sessionStorage.getItem(STORAGE_KEYS.INFLUX_DISMISSED) === "true"
  );

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const response = await api.get(API_PATHS.INFLUX_STATUS);
        setStatus(response.data);
        if (!response.data.connected && !dismissed) {
          setShowPopup(true);
        }
      } catch (error) {
        console.error("Failed to check InfluxDB status:", error);
        setStatus({ connected: false, error: "Failed to check connection status" });
        if (!dismissed) {
          setShowPopup(true);
        }
      }
    };

    checkStatus();
  }, [dismissed]);

  const handleDismiss = () => {
    setShowPopup(false);
    setDismissed(true);
    sessionStorage.setItem(STORAGE_KEYS.INFLUX_DISMISSED, "true");
  };

  const goToControlPanel = () => {
    handleDismiss();
    navigate("/control-panel");
  };

  if (!showPopup || status.connected) {
    return null;
  }

  return (
    <div className="influx-status-popup-overlay">
      <div className="influx-status-popup">
        <div className="influx-status-popup-header">
          <h3>⚠️ InfluxDB Connection Issue</h3>
          <button type="button" onClick={handleDismiss} className="influx-status-popup-close">×</button>
        </div>
        <div className="influx-status-popup-content">
          <p>The application cannot connect to InfluxDB. Trends and sensor logging features will be unavailable.</p>
          {status.error && (
            <div className="influx-status-popup-error">
              <strong>Error:</strong> {status.error}
            </div>
          )}
          <p className="influx-status-popup-help">
            Configure InfluxDB in <strong>Control Panel → InfluxDB Configuration</strong>, or set{" "}
            <code>INFLUX_URL</code> and <code>INFLUX_TOKEN</code> in your environment.
          </p>
        </div>
        <div className="influx-status-popup-footer">
          <button type="button" onClick={goToControlPanel} className="influx-status-popup-configure">
            Open Control Panel
          </button>
          <button type="button" onClick={handleDismiss} className="influx-status-popup-dismiss">
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};

export default InfluxStatusPopup;
