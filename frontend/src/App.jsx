import React, { useState, useCallback, lazy, Suspense } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Navbar from "./components/Navbar";
import InfluxStatusPopup from "./components/InfluxStatusPopup";
import PinSetup from "./components/PinSetup";
import PinModal from "./components/PinModal";
import Toast from "./components/Toast";
import { useAuth } from "./context/AuthContext";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Trends = lazy(() => import("./pages/Trends"));
const NutrientCalculator = lazy(() => import("./pages/NutrientCalculator"));
const GrowLog = lazy(() => import("./pages/GrowLog"));
const ControlPanel = lazy(() => import("./pages/ControlPanel"));
const Health = lazy(() => import("./pages/Health"));

const KioskWrapper = ({ children }) => {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  return (
    <div className="kiosk-wrapper">
      {children}
      <button
        type="button"
        className="kiosk-fullscreen-btn"
        onClick={toggleFullscreen}
        title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      >
        {isFullscreen ? "✕" : "⛶"}
      </button>
    </div>
  );
};

const App = () => {
  const { pinConfigured } = useAuth();
  const location = useLocation();
  const isKiosk = location.pathname.startsWith("/kiosk");

  if (pinConfigured === null) {
    return (
      <div className="app-loading" role="status" aria-live="polite">
        <div className="app-loading-spinner" aria-hidden />
        <span className="app-loading-text">Loading…</span>
      </div>
    );
  }

  if (pinConfigured === false) {
    return <PinSetup />;
  }

  return (
    <div className={`app ${isKiosk ? "app-kiosk" : ""}`}>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <InfluxStatusPopup />
      <PinModal />
      <Toast />
      {!isKiosk && <Navbar />}
      <main id="main-content" className="app-main" tabIndex={-1}>
        <Suspense fallback={<div className="app-loading"><div className="app-loading-spinner" aria-hidden /><span className="app-loading-text">Loading…</span></div>}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/trends" element={<Trends />} />
          <Route path="/nutrient-calculator" element={<NutrientCalculator />} />
          <Route path="/grow-log" element={<GrowLog />} />
          <Route path="/control-panel" element={<ControlPanel />} />
          <Route path="/health" element={<Health />} />
          <Route path="/kiosk" element={<KioskWrapper><Dashboard /></KioskWrapper>} />
          <Route path="/kiosk/dashboard" element={<KioskWrapper><Dashboard /></KioskWrapper>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </main>
    </div>
  );
};

export default App;
