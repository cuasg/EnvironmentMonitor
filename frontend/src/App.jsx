import React from "react";
import { Routes, Route } from "react-router-dom";
import Navbar from "./components/Navbar";
import Dashboard from "./pages/Dashboard";
import ControlPanel from "./pages/ControlPanel";

const App = () => {
  return (
    <div>
      <Navbar />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/control-panel" element={<ControlPanel />} />
      </Routes>
    </div>
  );
};

export default App;
