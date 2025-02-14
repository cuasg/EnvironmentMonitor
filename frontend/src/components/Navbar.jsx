import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "/src/styles/Navbar.css"; // ✅ Move styles to CSS file

const Navbar = () => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const navigate = useNavigate(); // ✅ React Router hook for navigation

  // ✅ Function to reload the page when navigating
  const handleNavigation = (path) => {
    navigate(path); // ✅ Navigate to the new path
    window.location.reload(); // ✅ Force full page reload
  };

  // ✅ Function to confirm system action
  const confirmAction = async (command, message) => {
    const userConfirmed = window.confirm(message);
    if (userConfirmed) {
      await handleSystemCommand(command);
    }
  };

  return (
    <nav className="navbar">
      {/* Left Side: Navigation Links */}
      <div className="nav-left">
        <button className="nav-link" onClick={() => handleNavigation("/")}>Dashboard</button>
        <button className="nav-link" onClick={() => handleNavigation("/control-panel")}>Control Panel</button>
      </div>

      {/* Right Side: System Controls (Hover Dropdown) */}
      <div
        className="nav-right"
        onMouseEnter={() => setDropdownOpen(true)}
        onMouseLeave={() => setDropdownOpen(false)}
      >
        <button className="dropdown-button">
          System Controls ▼
        </button>
        {dropdownOpen && (
          <div className="dropdown-menu">
            <button className="dropdown-item" onClick={() => confirmAction("restart-program", "Are you sure you want to restart the program?")}>
              Restart Program
            </button>
            <button className="dropdown-item" onClick={() => confirmAction("restart-system", "Are you sure you want to restart the Raspberry Pi?")}>
              Restart Pi
            </button>
            <button className="dropdown-item shutdown" onClick={() => confirmAction("shutdown", "Are you sure you want to shut down the system?")}>
              Shutdown
            </button>
          </div>
        )}
      </div>
    </nav>
  );
};

// ✅ Function to send system control commands
const handleSystemCommand = async (command) => {
  try {
    const response = await fetch(`http://10.0.0.207:5000/${command}`, { method: "POST" });
    const data = await response.json();
    alert(data.message);
  } catch (error) {
    alert("Error executing command.");
  }
};

export default Navbar;
