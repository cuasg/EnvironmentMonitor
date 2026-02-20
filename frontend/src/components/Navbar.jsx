import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import "/src/styles/Navbar.css";
import { getSettings, updateSettings, restartProgram, restartPi, shutdownPi } from "../api";
import { STORAGE_KEYS } from "../constants";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import ConfirmModal from "./ConfirmModal";

const DROPDOWN_CLOSE_DELAY_MS = 180;

const NAV_MENU_BREAKPOINT = 768;

const Navbar = () => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmActionState, setConfirmActionState] = useState(null);
  const [devMode, setDevMode] = useState(false);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem(STORAGE_KEYS.THEME) === "dark");
  const closeTimeoutRef = React.useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { runWithPin } = useAuth();
  const { showToast } = useToast();

  const closeMenu = () => setMenuOpen(false);

  const navPaths = [
    { path: "/", label: "Dashboard" },
    { path: "/trends", label: "Trends" },
    { path: "/nutrient-calculator", label: "Nutrient Calculator" },
    { path: "/grow-log", label: "Grow Log" },
    { path: "/health", label: "Health" },
    { path: "/control-panel", label: "Control Panel" },
  ];

  const openDropdown = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setDropdownOpen(true);
  };

  const closeDropdown = () => {
    closeTimeoutRef.current = setTimeout(() => setDropdownOpen(false), DROPDOWN_CLOSE_DELAY_MS);
  };

  const keepDropdownOpen = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    async function load() {
      const data = await getSettings();
      if (data && typeof data.dev_mode === "boolean") {
        setDevMode(data.dev_mode);
      }
    }
    load();
  }, []);

  useEffect(() => {
    const theme = darkMode ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEYS.THEME, theme);
  }, [darkMode]);

  useEffect(() => {
    if (!menuOpen) return;
    const onResize = () => {
      if (window.innerWidth > NAV_MENU_BREAKPOINT) {
        setMenuOpen(false);
        setDropdownOpen(false);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [menuOpen]);

  const handleNavigation = (path) => {
    closeMenu();
    navigate(path);
  };

  const openConfirm = (command) => {
    closeMenu();
    setConfirmActionState(command);
  };
  const closeConfirm = () => setConfirmActionState(null);

  const runConfirmedAction = () => {
    const command = confirmActionState;
    closeConfirm();
    runWithPin(async (sessionToken) => {
      try {
        if (command === "restart-program") await restartProgram(sessionToken);
        else if (command === "restart-system") await restartPi(sessionToken);
        else if (command === "shutdown") await shutdownPi(sessionToken);
        else return;
        showToast("Command sent successfully.", "success");
      } catch (err) {
        showToast(err.response?.data?.error || "Error executing command.", "error");
      }
    });
  };

  const confirmConfig = {
    "restart-program": { title: "Restart Program", message: "Are you sure you want to restart the program?", confirmLabel: "Restart" },
    "restart-system": { title: "Restart Raspberry Pi", message: "Are you sure you want to restart the Raspberry Pi?", confirmLabel: "Restart" },
    shutdown: { title: "Shut Down", message: "Are you sure you want to shut down the system?", confirmLabel: "Shutdown", variant: "danger" },
  };

  const toggleDevMode = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    const newState = !devMode;
    try {
      await updateSettings({ dev_mode: newState });
      setDevMode(newState);
      showToast(`Development mode ${newState ? "on" : "off"}.`, "info");
    } catch (err) {
      showToast("Failed to toggle dev mode.", "error");
    }
  };

  const toggleDarkMode = (e) => {
    e.stopPropagation();
    e.preventDefault();
    setDarkMode((prev) => !prev);
  };

  return (
    <nav className="navbar" role="navigation" aria-label="Main">
      <button
        type="button"
        className="navbar-toggle"
        onClick={() => setMenuOpen((prev) => !prev)}
        aria-expanded={menuOpen}
        aria-controls="navbar-menu"
        aria-label={menuOpen ? "Close menu" : "Open menu"}
      >
        <span className="navbar-toggle-icon" aria-hidden>{menuOpen ? "✕" : "☰"}</span>
      </button>

      <div
        id="navbar-menu"
        className={`navbar-menu ${menuOpen ? "navbar-menu-open" : ""}`}
      >
        <div className="nav-left">
          {navPaths.map(({ path, label }) => {
            const isActive = location.pathname === path;
            return (
              <button
                key={path}
                type="button"
                className={`nav-link ${isActive ? "nav-link-active" : ""}`}
                onClick={() => handleNavigation(path)}
                aria-current={isActive ? "page" : undefined}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div
          className="nav-right"
          onMouseEnter={openDropdown}
          onMouseLeave={closeDropdown}
        >
          <button type="button" className="dropdown-button" onClick={() => setDropdownOpen((prev) => !prev)}>
            System Controls ▼
          </button>
          {dropdownOpen && (
            <div
              className="dropdown-menu"
              onMouseEnter={keepDropdownOpen}
              onMouseLeave={closeDropdown}
            >
              <button type="button" className="dropdown-item dropdown-item-indicator" onClick={toggleDevMode}>
                Development Mode <strong className={devMode ? "indicator-on" : "indicator-off"}>{devMode ? "On" : "Off"}</strong>
              </button>
              <button type="button" className="dropdown-item dropdown-item-indicator" onClick={toggleDarkMode}>
                Dark Mode <strong className={darkMode ? "indicator-on" : "indicator-off"}>{darkMode ? "On" : "Off"}</strong>
              </button>
              <button type="button" className="dropdown-item" onClick={() => openConfirm("restart-program")}>
                Restart Program
              </button>
              <button type="button" className="dropdown-item" onClick={() => openConfirm("restart-system")}>
                Restart Pi
              </button>
              <button type="button" className="dropdown-item shutdown" onClick={() => openConfirm("shutdown")}>
                Shutdown
              </button>
            </div>
          )}
        </div>
      </div>

      {confirmActionState && confirmConfig[confirmActionState] && (
        <ConfirmModal
          title={confirmConfig[confirmActionState].title}
          message={confirmConfig[confirmActionState].message}
          confirmLabel={confirmConfig[confirmActionState].confirmLabel}
          cancelLabel="Cancel"
          variant={confirmConfig[confirmActionState].variant || "default"}
          onConfirm={runConfirmedAction}
          onCancel={closeConfirm}
        />
      )}
    </nav>
  );
};

export default Navbar;
