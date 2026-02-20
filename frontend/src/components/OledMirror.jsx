import React, { useState, useEffect, useMemo } from "react";
import "/src/styles/OledMirror.css";
import api from "../api";
import { API_PATHS } from "../constants";

const OLED_WIDTH = 128;
const OLED_HEIGHT = 64;

// Local preview renderer - mimics backend rendering for real-time preview
const renderLocalPreview = (pageConfig, settings = {}, textSize = "med", textColor = "white") => {
  if (!pageConfig) return { lines: [], title: "" };
  
  const lines = [];
  const title = pageConfig.title || "";
  
  // Don't add title as a line - it's displayed separately in the UI
  // Render elements only
  for (const element of pageConfig.elements || []) {
    if (element.type !== "text") continue;
    
    let content = element.content || "";
    // Replace placeholders with actual values (simplified for preview)
    content = content.replace("{pH_monitoring_enabled}", 
      settings.pH_monitoring_enabled ? "ON" : "OFF");
    content = content.replace("{low_pH}", 
      settings.pump_settings?.low_pH?.toString() || "N/A");
    content = content.replace("{high_pH}", 
      settings.pump_settings?.high_pH?.toString() || "N/A");
    content = content.replace("{pH_value}", 
      settings.pH_value?.toString() || "N/A");
    content = content.replace("{ppm_500}", 
      settings.ppm_500?.toString() || "N/A");
    content = content.replace("{humidity}", 
      settings.humidity?.toString() || "N/A");
    content = content.replace("{air_temperature_f}", 
      settings.air_temperature_f?.toString() || "N/A");
    content = content.replace("{water_temperature_f}", 
      settings.water_temperature_f?.toString() || "N/A");
    content = content.replace("{last_pump_activated}", 
      settings.last_pump_activation?.pump?.toString() || "None");
    content = content.replace("{last_pump_time}", 
      settings.last_pump_activation?.timestamp || "N/A");
    content = content.replace("{last_ph_check}", 
      settings.last_ph_check || "N/A");
    content = content.replace("{next_ph_check}", 
      settings.next_ph_check || "N/A");
    
    lines.push({
      text: content,
      font_size: element.font_size || 12,
      color: textColor, // Use preview color override
    });
  }
  
  return { lines, title };
};

const OledMirror = ({ 
  refreshInterval = 2000, 
  compact = false, 
  previewConfig = null, 
  previewSettings = null,
  previewPages = null, // Array of all pages for cycling
  previewInterval = null, // Interval for cycling preview pages
  textSize = "med", // "small", "med", "large"
  textColor = "white" // "white", "green", "blue", "red", etc.
}) => {
  // Use compact mode for both dashboard and control panel - exact 128x64 scaled
  const SCALE = 1.5; // Same scale for both
  const [displayState, setDisplayState] = useState({
    page_id: null,
    page_title: "",
    lines: [],
    pixel_data: null,
  });
  const [currentSettings, setCurrentSettings] = useState(null);
  const [previewPageIndex, setPreviewPageIndex] = useState(0);

  // Fetch current settings once for preview
  useEffect(() => {
    if ((previewConfig || previewPages) && !previewSettings) {
      api.get(API_PATHS.SETTINGS).then((res) => {
        setCurrentSettings(res.data);
      }).catch(() => {
        setCurrentSettings({});
      });
    }
  }, [previewConfig, previewPages, previewSettings]);

  // Use local preview if previewConfig or previewPages is provided
  // If previewPages is provided, cycle through pages
  const currentPreviewPage = previewPages && previewPages.length > 0 
    ? previewPages[previewPageIndex % previewPages.length]
    : previewConfig;
  
  // Reset index if previewPages changes
  useEffect(() => {
    if (previewPages && previewPages.length > 0) {
      setPreviewPageIndex(0);
    }
  }, [previewPages?.length]); // Only reset when page count changes
  
  const previewConfigKey = currentPreviewPage ? JSON.stringify(currentPreviewPage) : null;
  const localPreview = useMemo(() => {
    if (currentPreviewPage) {
      const settings = previewSettings || currentSettings || {};
      const rendered = renderLocalPreview(currentPreviewPage, settings, textSize, textColor);
      return {
        page_id: currentPreviewPage.id,
        page_title: rendered.title,
        lines: rendered.lines.map(l => l.text),
        pixel_data: null, // Local preview uses fallback
      };
    }
    return null;
  }, [previewConfigKey, previewSettings, currentSettings, textSize, textColor, previewPageIndex]);
  
  // Cycle through preview pages if previewPages is provided
  useEffect(() => {
    if (previewPages && previewPages.length > 0 && previewInterval) {
      const intervalMs = previewInterval * 1000;
      console.log(`🔄 Starting preview cycle: ${previewPages.length} pages, ${previewInterval}s interval`);
      const timer = setInterval(() => {
        setPreviewPageIndex((prev) => {
          const next = (prev + 1) % previewPages.length;
          console.log(`🔄 Cycling to page ${next}: ${previewPages[next]?.id || 'unknown'}`);
          return next;
        });
      }, intervalMs);
      return () => {
        console.log('🔄 Stopping preview cycle');
        clearInterval(timer);
      };
    } else if (previewPages && previewPages.length === 1) {
      // Single page - just show it
      setPreviewPageIndex(0);
    }
  }, [previewPages, previewInterval]);

  // Update display state when localPreview changes (for real-time preview)
  useEffect(() => {
    if (localPreview) {
      setDisplayState(localPreview);
    }
  }, [localPreview]);

  // Fetch from backend when not using local preview
  useEffect(() => {
    // Skip backend fetching if using local preview
    if (localPreview) {
      return;
    }

    const fetchDisplay = async () => {
      try {
        const response = await api.get(API_PATHS.OLED_DISPLAY);
        const data = response.data || {};
        setDisplayState({
          page_id: data.page_id || null,
          page_title: data.page_title || "",
          lines: data.lines || [],
          pixel_data: data.pixel_data || null,
        });
      } catch (error) {
        console.error("Failed to fetch OLED display:", error);
        setDisplayState({
          page_id: null,
          page_title: "",
          lines: [],
          pixel_data: null,
        });
      }
    };

    fetchDisplay();
    const interval = setInterval(fetchDisplay, refreshInterval);
    return () => clearInterval(interval);
  }, [refreshInterval, localPreview]);

  // Map text size to CSS class
  const sizeClass = `oled-mirror-${textSize}`;
  const colorStyle = { color: textColor === "white" ? "#fff" : textColor };
  
  return (
    <div className={`oled-mirror ${compact ? "oled-mirror-compact" : ""}`}>
      {!compact && <div className="oled-mirror-label">OLED Display Preview</div>}
      <div
        className={`oled-mirror-screen ${sizeClass}`}
        style={{
          width: `${OLED_WIDTH * SCALE}px`,
          height: `${OLED_HEIGHT * SCALE}px`,
          maxWidth: "100%",
        }}
      >
        {/* Always use fallback (title + lines) to match Control Panel; never Pillow/pixel_data image */}
        <div className="oled-mirror-fallback" style={colorStyle}>
          {displayState.page_title && (
            <div className="oled-mirror-title">{displayState.page_title}</div>
          )}
          {displayState.lines && displayState.lines.length > 0 ? (
            displayState.lines.map((line, i) => (
              <div key={i} className="oled-mirror-line">
                {line || " "}
              </div>
            ))
          ) : (
            <div className="oled-mirror-line">No data available</div>
          )}
        </div>
      </div>
      {!compact && (
        <div className="oled-mirror-info">
          {displayState.page_id ? `Page: ${displayState.page_id}` : "No display data"}
        </div>
      )}
    </div>
  );
};

export default OledMirror;
