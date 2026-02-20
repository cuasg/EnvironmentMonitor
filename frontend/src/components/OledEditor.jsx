import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import "/src/styles/OledEditor.css";
import api, { getSettings, updateSettings } from "../api";
import { loadOledPreviewSettings, saveOledPreviewSettings } from "../utils/oledPreview";
import { API_PATHS } from "../constants";
import { useToast } from "../context/ToastContext";
import OledMirror from "./OledMirror";

const AVAILABLE_VARIABLES = [
  { label: "pH Monitoring", value: "{pH_monitoring_enabled}" },
  { label: "Low pH", value: "{low_pH}" },
  { label: "High pH", value: "{high_pH}" },
  { label: "pH Value", value: "{pH_value}" },
  { label: "PPM (500)", value: "{ppm_500}" },
  { label: "Humidity", value: "{humidity}" },
  { label: "Air Temp (°F)", value: "{air_temperature_f}" },
  { label: "Water Temp (°F)", value: "{water_temperature_f}" },
  { label: "Last Pump", value: "{last_pump_activated}" },
  { label: "Last Pump Time", value: "{last_pump_time}" },
  { label: "Last pH Check", value: "{last_ph_check}" },
  { label: "Next pH Check", value: "{next_ph_check}" },
];

const VARIABLE_DROP_ZONE_ID = "variable-drop-zone";

const DraggableVariableChip = ({ variable, onAdd }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `var-${variable.value}`,
    data: { type: "variable", value: variable.value, label: variable.label },
  });
  return (
    <span
      ref={setNodeRef}
      className={`oled-variable-tag ${isDragging ? "oled-variable-tag-dragging" : ""}`}
      title={`${variable.label} — drag or click to add`}
      {...listeners}
      {...attributes}
      onClick={() => onAdd(variable.value)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onAdd(variable.value);
        }
      }}
    >
      {variable.label}
    </span>
  );
};

const VariableDropZone = ({ children }) => {
  const { setNodeRef, isOver } = useDroppable({ id: VARIABLE_DROP_ZONE_ID });
  return (
    <div
      ref={setNodeRef}
      className={`oled-variable-drop-zone ${isOver ? "oled-variable-drop-zone-over" : ""}`}
    >
      {children}
    </div>
  );
};

const SortableElement = ({ id, element, onUpdate, onDelete }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="oled-element-item">
      <div className="oled-element-handle" {...attributes} {...listeners}>
        ⋮⋮
      </div>
      <input
        type="text"
        value={element.content || ""}
        onChange={(e) => onUpdate({ ...element, content: e.target.value })}
        placeholder="Text or edit variable"
        className="oled-element-input"
      />
      <div className="oled-element-controls">
        <select
          value={element.font_size || 12}
          onChange={(e) => onUpdate({ ...element, font_size: parseInt(e.target.value) })}
          className="oled-element-select"
          title="Font Size"
        >
          <option value={10}>10px</option>
          <option value={12}>12px</option>
          <option value={14}>14px</option>
        </select>
        <select
          value={element.color || "white"}
          onChange={(e) => onUpdate({ ...element, color: e.target.value })}
          className="oled-element-select"
          title="Color"
        >
          <option value="white">White</option>
          <option value="black">Black</option>
        </select>
      </div>
      <button type="button" onClick={onDelete} className="oled-element-delete" title="Delete">×</button>
    </div>
  );
};

const OledEditor = () => {
  const { showToast } = useToast();
  const [config, setConfig] = useState({ pages: [] });
  const [selectedPageIndex, setSelectedPageIndex] = useState(0);
  const [lastSaved, setLastSaved] = useState(null);
  const [loading, setLoading] = useState(true);
  const [previewSettings, setPreviewSettings] = useState(null);
  const [globalInterval, setGlobalInterval] = useState(10);
  const [previewTextSize, setPreviewTextSize] = useState(() => loadOledPreviewSettings().textSize);
  const [previewTextColor, setPreviewTextColor] = useState(() => loadOledPreviewSettings().textColor);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );
  const variableDropJustHappenedRef = useRef(false);

  const currentPage = config.pages[selectedPageIndex] || null;
  // Check if config or global interval has changed
  const savedInterval = previewSettings?.oled_page_interval_seconds || 10;
  const isDirty = lastSaved !== JSON.stringify(config) || globalInterval !== savedInterval;
  
  // Memoize enabled pages for preview cycling
  const enabledPages = useMemo(() => config.pages.filter(p => p.enabled !== false), [config.pages]);

  // Navigation guard for unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = "You have unsaved changes. Are you sure you want to leave?";
        return e.returnValue;
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  // Load settings for preview and global interval
  useEffect(() => {
    getSettings().then((settings) => {
      setPreviewSettings(settings);
      setGlobalInterval(settings.oled_page_interval_seconds || 10);
    }).catch(() => {
      setPreviewSettings({});
      setGlobalInterval(10);
    });
  }, []);

  useEffect(() => {
    async function load() {
      try {
        // Try dedicated endpoint first, fallback to settings
        let oledConfig = { pages: [] };
        try {
          const response = await api.get(API_PATHS.OLED_CONFIG);
          oledConfig = response.data || { pages: [] };
        } catch {
          // Fallback: load from settings
          const settings = await getSettings();
          oledConfig = settings.oled_config || { pages: [] };
        }
        
        // Ensure we have at least default pages if empty
        if (!oledConfig.pages || oledConfig.pages.length === 0) {
          oledConfig = {
            pages: [
              {
                id: "system_status",
                title: "SYSTEM STATUS",
                interval_seconds: 10,
                enabled: true,
                elements: [
                  { type: "text", content: "pH Mon: {pH_monitoring_enabled}", font_size: 12, color: "white" },
                  { type: "text", content: "Range: {low_pH}-{high_pH}", font_size: 12, color: "white" },
                ],
              },
              {
                id: "sensor_data",
                title: "SENSORS",
                interval_seconds: 10,
                enabled: true,
                elements: [
                  { type: "text", content: "pH: {pH_value}  PPM: {ppm_500}", font_size: 12, color: "white" },
                  { type: "text", content: "Hum: {humidity}%  Air: {air_temperature_f}F", font_size: 12, color: "white" },
                  { type: "text", content: "Water: {water_temperature_f}F", font_size: 12, color: "white" },
                ],
              },
              {
                id: "pump_status",
                title: "PUMP STATUS",
                interval_seconds: 10,
                enabled: true,
                elements: [
                  { type: "text", content: "Last: {last_pump_activated}", font_size: 12, color: "white" },
                  { type: "text", content: "Time: {last_pump_time}", font_size: 12, color: "white" },
                ],
              },
              {
                id: "ph_check_times",
                title: "pH CHECK TIMES",
                interval_seconds: 10,
                enabled: true,
                elements: [
                  { type: "text", content: "Last: {last_ph_check}", font_size: 12, color: "white" },
                  { type: "text", content: "Next: {next_ph_check}", font_size: 12, color: "white" },
                ],
              },
            ],
          };
        }
        
        setConfig(oledConfig);
        setLastSaved(JSON.stringify(oledConfig));
        setLoading(false);
      } catch (error) {
        console.error("Failed to load OLED config:", error);
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over) return;

    if (active.data?.current?.type === "variable") {
      if (over.id === VARIABLE_DROP_ZONE_ID) {
        const value = active.data.current.value;
        if (value && currentPage) {
          addElement(value);
          variableDropJustHappenedRef.current = true;
          setTimeout(() => { variableDropJustHappenedRef.current = false; }, 100);
        }
      }
      return;
    }

    if (active.id === over.id) return;
    const oldIndex = currentPage?.elements?.findIndex((e, i) => `element-${i}` === active.id) ?? -1;
    const newIndex = currentPage?.elements?.findIndex((e, i) => `element-${i}` === over.id) ?? -1;

    if (oldIndex !== -1 && newIndex !== -1) {
      const newPages = [...config.pages];
      newPages[selectedPageIndex] = {
        ...currentPage,
        elements: arrayMove(currentPage.elements, oldIndex, newIndex),
      };
      setConfig({ pages: newPages });
    }
  };

  const addElement = (initialContent = "") => {
    if (!currentPage) return;
    const newPages = [...config.pages];
    newPages[selectedPageIndex] = {
      ...currentPage,
      elements: [...(currentPage.elements || []), { type: "text", content: initialContent, font_size: 12, color: "white" }],
    };
    setConfig({ pages: newPages });
  };

  const updateElement = (index, element) => {
    const newPages = [...config.pages];
    newPages[selectedPageIndex] = {
      ...currentPage,
      elements: currentPage.elements.map((e, i) => (i === index ? element : e)),
    };
    setConfig({ pages: newPages });
  };

  const deleteElement = (index) => {
    const newPages = [...config.pages];
    newPages[selectedPageIndex] = {
      ...currentPage,
      elements: currentPage.elements.filter((_, i) => i !== index),
    };
    setConfig({ pages: newPages });
  };

  const updatePage = (field, value) => {
    const newPages = [...config.pages];
    newPages[selectedPageIndex] = { ...currentPage, [field]: value };
    setConfig({ pages: newPages });
  };

  const addPage = () => {
    const newPage = {
      id: `page_${Date.now()}`,
      title: "NEW PAGE",
      interval_seconds: 10,
      enabled: true,
      elements: [],
    };
    setConfig({ pages: [...config.pages, newPage] });
    setSelectedPageIndex(config.pages.length);
  };

  const deletePage = () => {
    if (config.pages.length <= 1) return;
    const newPages = config.pages.filter((_, i) => i !== selectedPageIndex);
    setConfig({ pages: newPages });
    setSelectedPageIndex(Math.max(0, selectedPageIndex - 1));
  };

  const saveConfig = async () => {
    try {
      // Save OLED config
      await api.post(API_PATHS.OLED_CONFIG, config);
      // Save global interval setting
      await updateSettings({ oled_page_interval_seconds: globalInterval });
      setLastSaved(JSON.stringify(config));
      // Refresh settings for preview
      const settings = await getSettings();
      setPreviewSettings(settings);
      showToast("OLED config saved.", "success");
    } catch (error) {
      showToast("Error saving OLED config.", "error");
      console.error(error);
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="oled-editor">
      <div className="oled-editor-left">
        <div className="oled-editor-header">
          <h3>OLED Pages</h3>
          <button type="button" onClick={addPage} className="oled-btn-add">+ Add Page</button>
        </div>

        <div className="oled-pages-list">
          {config.pages.map((page, i) => (
            <div
              key={page.id || i}
              className={`oled-page-item ${i === selectedPageIndex ? "active" : ""}`}
              onClick={() => {
                if (isDirty && i !== selectedPageIndex) {
                  const confirm = window.confirm(
                    "You have unsaved changes. Are you sure you want to switch pages? Your changes will be lost if you don't save."
                  );
                  if (!confirm) return;
                }
                setSelectedPageIndex(i);
              }}
            >
              <input
                type="text"
                value={page.title || ""}
                onChange={(e) => {
                  const newPages = [...config.pages];
                  newPages[i].title = e.target.value;
                  setConfig({ pages: newPages });
                }}
                onClick={(e) => e.stopPropagation()}
                className="oled-page-title-input"
              />
              <label className="oled-page-toggle">
                <input
                  type="checkbox"
                  checked={page.enabled !== false}
                  onChange={(e) => {
                    const newPages = [...config.pages];
                    newPages[i].enabled = e.target.checked;
                    setConfig({ pages: newPages });
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
                Enabled
              </label>
            </div>
          ))}
        </div>

        {currentPage && (
          <>
            <div className="oled-page-settings">
              <label>
                Page Title:
                <input
                  type="text"
                  value={currentPage.title || ""}
                  onChange={(e) => updatePage("title", e.target.value)}
                />
              </label>
              <label>
                Display Time (seconds) - applies to all pages:
                <input
                  type="number"
                  min={1}
                  max={300}
                  value={globalInterval}
                  onChange={(e) => {
                    const value = e.target.value === "" ? 10 : parseInt(e.target.value, 10);
                    if (!isNaN(value) && value >= 1 && value <= 300) {
                      setGlobalInterval(value);
                    }
                  }}
                />
              </label>
            </div>

            <div className="oled-elements-section">
              <div className="oled-elements-header">
                <h4>Page Elements</h4>
                <button type="button" onClick={() => addElement()} className="oled-btn-add" title="Add empty line">+ Add line</button>
              </div>

              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <VariableDropZone>
                  <span className="oled-variable-drop-zone-text">Drag a variable here to add a line</span>
                </VariableDropZone>

                <SortableContext
                  items={(currentPage.elements || []).map((_, i) => `element-${i}`)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="oled-elements-list">
                    {(currentPage.elements || []).map((element, i) => (
                      <SortableElement
                        key={`element-${i}`}
                        id={`element-${i}`}
                        element={element}
                        onUpdate={(updated) => updateElement(i, updated)}
                        onDelete={() => deleteElement(i)}
                      />
                    ))}
                  </div>
                </SortableContext>

                <div className="oled-variables-help">
                  <strong>Add a line: drag or click a variable</strong>
                  <div className="oled-variables-list">
                    {AVAILABLE_VARIABLES.map((v) => (
                      <DraggableVariableChip
                        key={v.value}
                        variable={v}
                        onAdd={(value) => {
                          if (variableDropJustHappenedRef.current) return;
                          addElement(value);
                        }}
                      />
                    ))}
                  </div>
                </div>
              </DndContext>
            </div>

            {isDirty && (
              <button type="button" onClick={saveConfig} className="save-settings-button">
                Save OLED Config
              </button>
            )}
          </>
        )}
      </div>

      <div className="oled-editor-right">
        <div className="oled-preview-controls">
          <label>
            Text Size:
            <select
              value={previewTextSize}
              onChange={(e) => {
                const newSize = e.target.value;
                setPreviewTextSize(newSize);
                saveOledPreviewSettings({ textSize: newSize, textColor: previewTextColor });
              }}
            >
              <option value="small">Small</option>
              <option value="med">Medium</option>
              <option value="large">Large</option>
            </select>
          </label>
          <label>
            Text Color:
            <select
              value={previewTextColor}
              onChange={(e) => {
                const newColor = e.target.value;
                setPreviewTextColor(newColor);
                saveOledPreviewSettings({ textSize: previewTextSize, textColor: newColor });
              }}
            >
              <option value="white">White</option>
              <option value="#00ff00">Green</option>
              <option value="#0080ff">Blue</option>
              <option value="#ff0000">Red</option>
              <option value="#ffff00">Yellow</option>
              <option value="#ff00ff">Magenta</option>
              <option value="#00ffff">Cyan</option>
            </select>
          </label>
        </div>
        <OledMirror 
          refreshInterval={1000} 
          compact={true}
          previewPages={enabledPages}
          previewInterval={globalInterval}
          previewSettings={previewSettings}
          textSize={previewTextSize}
          textColor={previewTextColor}
        />
        {currentPage && (
          <div style={{ marginTop: "var(--space-sm)", fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center" }}>
            Display time: {globalInterval}s (all pages)
          </div>
        )}
      </div>
    </div>
  );
};

export default OledEditor;
