import React, { useState, useEffect, useRef } from "react";
import "/src/styles/GrowLog.css";
import {
  getGrowLogs,
  createGrow,
  updateGrow,
  deleteGrow,
  addGrowEntry,
  updateGrowEntry,
  deleteGrowEntry,
} from "../api";
import { API_BASE_URL } from "../api";
import { API_PATHS, STORAGE_KEYS } from "../constants";
import { formatDateTime } from "../utils/format";
import { useToast } from "../context/ToastContext";
import ConfirmModal from "../components/ConfirmModal";

const defaultStrain = (growStartDate = "") => ({
  name: "",
  start_date: growStartDate || new Date().toISOString().split("T")[0],
  days_to_finish: "",
  actual_harvest_date: "",
  strain_type: "Hybrid",
  plant_type: "Photo",
});

/** Add days to YYYY-MM-DD string; returns YYYY-MM-DD or "" */
function addDaysToDate(dateStr, days) {
  if (!dateStr || days === "" || days == null || Number.isNaN(Number(days))) return "";
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + Number(days));
  return d.toISOString().split("T")[0];
}

const defaultGrowForm = () => ({
  start_date: new Date().toISOString().split("T")[0],
  strains: [defaultStrain(new Date().toISOString().split("T")[0])],
  is_primary: false,
  notes: "",
});

function normalizeGrowForForm(grow) {
  const growStart = grow.start_date || new Date().toISOString().split("T")[0];
  const strains = Array.isArray(grow.strains) && grow.strains.length > 0
    ? grow.strains.map((s) => ({
        name: s?.name ?? "",
        start_date: s?.start_date || growStart,
        days_to_finish: s?.days_to_finish != null && s?.days_to_finish !== "" ? s.days_to_finish : "",
        actual_harvest_date: s?.actual_harvest_date || "",
        strain_type: s?.strain_type && ["Indica", "Sativa", "Hybrid"].includes(s.strain_type) ? s.strain_type : "Hybrid",
        plant_type: s?.plant_type && ["Auto", "Photo"].includes(s.plant_type) ? s.plant_type : "Photo",
      }))
    : grow.strain
      ? [{ ...defaultStrain(growStart), name: grow.strain }]
      : [defaultStrain(growStart)];
  return {
    start_date: growStart,
    strains,
    is_primary: !!grow.is_primary,
    notes: grow.notes || "",
  };
}

function growStrainDisplay(grow) {
  const strains = Array.isArray(grow.strains) && grow.strains.length > 0
    ? grow.strains
    : grow.strain ? [{ name: grow.strain }] : [];
  const names = strains.filter((s) => s?.name).map((s) => s.name);
  return names.length ? names.join(", ") : "Unnamed Grow";
}

const GrowLog = () => {
  const { showToast } = useToast();
  const [confirmDeleteGrowId, setConfirmDeleteGrowId] = useState(null);
  const [confirmDeleteEntry, setConfirmDeleteEntry] = useState(null);
  const [grows, setGrows] = useState([]);
  const [selectedGrowId, setSelectedGrowId] = useState(null);
  const [expandedGrowIds, setExpandedGrowIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [showAddGrowModal, setShowAddGrowModal] = useState(false);
  const [showEditGrowModal, setShowEditGrowModal] = useState(false);
  const [editingGrow, setEditingGrow] = useState(null);
  const [showAddEntryModal, setShowAddEntryModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [nutrientCalcData, setNutrientCalcData] = useState(null);

  // Form states
  const [newGrowForm, setNewGrowForm] = useState(defaultGrowForm());
  const [editGrowForm, setEditGrowForm] = useState(defaultGrowForm());

  const [newEntryForm, setNewEntryForm] = useState({
    type: "note",
    timestamp: new Date().toISOString().slice(0, 16).replace("T", " "),
    content: "",
    volume: "",
    volume_unit: "gallons",
    nutrient_amount: "",
    nutrient_unit: "grams",
    strength_percent: 100,
    note_text: "",
  });

  useEffect(() => {
    loadGrowLogs();
    loadNutrientCalcData();
  }, []);

  const hasInitialExpand = useRef(false);
  useEffect(() => {
    if (grows.length > 0 && !hasInitialExpand.current) {
      const primary = grows.find((g) => g.is_primary);
      setExpandedGrowIds(new Set([primary ? primary.id : grows[0].id]));
      hasInitialExpand.current = true;
    }
    if (grows.length === 0) hasInitialExpand.current = false;
  }, [grows]);

  const toggleGrowExpanded = (growId) => {
    setExpandedGrowIds((prev) => {
      const next = new Set(prev);
      if (next.has(growId)) next.delete(growId);
      else next.add(growId);
      return next;
    });
  };

  const loadGrowLogs = async () => {
    try {
      const data = await getGrowLogs();
      setGrows(data.grows || []);
      if (data.grows && data.grows.length > 0) {
        const primaryGrow = data.grows.find((g) => g.is_primary);
        setSelectedGrowId(primaryGrow ? primaryGrow.id : data.grows[0].id);
      }
      setLoading(false);
    } catch (error) {
      console.error("Failed to load grow logs:", error);
      setLoading(false);
    }
  };

  const loadNutrientCalcData = async () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.NUTRIENT_CALC);
      if (saved) {
        const data = JSON.parse(saved);
        setNutrientCalcData({
          nutrientAmount: data.nutrientAmount || "",
          nutrientUnit: data.nutrientUnit || "grams",
          strengthPercent: data.strengthPercent ?? 100,
          calculatedAmount: data.calculatedAmount != null ? data.calculatedAmount : null,
          calculatedUnit: data.calculatedUnit || data.nutrientUnit || "grams",
        });
      }
    } catch (e) {
      console.warn("Could not load nutrient calculator data", e);
    }
  };

  const handleExport = async (format) => {
    try {
      const url = `${API_BASE_URL}${API_PATHS.GROW_LOGS_EXPORT}?format=${format}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.statusText);
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition");
      const match = disposition && disposition.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : `grow-logs-${new Date().toISOString().slice(0, 10)}.${format}`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      showToast(`Exported as ${format.toUpperCase()}.`, "success");
    } catch (error) {
      showToast("Export failed.", "error");
    }
  };

  const handleCreateGrow = async () => {
    try {
      const payload = {
        start_date: newGrowForm.start_date,
        is_primary: newGrowForm.is_primary,
        notes: newGrowForm.notes || "",
        strains: newGrowForm.strains.filter((s) => s.name?.trim()).map((s) => ({
          name: s.name.trim(),
          start_date: s.start_date || newGrowForm.start_date,
          days_to_finish: s.days_to_finish === "" || s.days_to_finish == null ? null : Number(s.days_to_finish),
          actual_harvest_date: s.actual_harvest_date?.trim() || null,
          strain_type: s.strain_type || "Hybrid",
          plant_type: s.plant_type || "Photo",
        })),
      };
      await createGrow(payload);
      setShowAddGrowModal(false);
      setNewGrowForm(defaultGrowForm());
      await loadGrowLogs();
    } catch (error) {
      showToast("Failed to create grow.", "error");
    }
  };

  const handleSetPrimary = async (growId) => {
    try {
      for (const grow of grows) {
        await updateGrow(grow.id, { is_primary: grow.id === growId });
      }
      await loadGrowLogs();
    } catch (error) {
      showToast("Failed to set primary grow.", "error");
    }
  };

  const openEditGrowModal = (grow) => {
    setEditingGrow(grow);
    setEditGrowForm(normalizeGrowForForm(grow));
    setShowEditGrowModal(true);
  };

  const handleUpdateGrow = async () => {
    if (!editingGrow) return;
    try {
      const payload = {
        start_date: editGrowForm.start_date,
        is_primary: editGrowForm.is_primary,
        notes: editGrowForm.notes || "",
        strains: editGrowForm.strains.filter((s) => s.name?.trim()).map((s) => ({
          name: s.name.trim(),
          start_date: s.start_date || editGrowForm.start_date,
          days_to_finish: s.days_to_finish === "" || s.days_to_finish == null ? null : Number(s.days_to_finish),
          actual_harvest_date: s.actual_harvest_date?.trim() || null,
          strain_type: s.strain_type || "Hybrid",
          plant_type: s.plant_type || "Photo",
        })),
      };
      await updateGrow(editingGrow.id, payload);
      setShowEditGrowModal(false);
      setEditingGrow(null);
      await loadGrowLogs();
    } catch (error) {
      showToast("Failed to update grow.", "error");
    }
  };

  const handleDeleteGrow = (growId) => setConfirmDeleteGrowId(growId);

  const runDeleteGrow = async () => {
    const growId = confirmDeleteGrowId;
    setConfirmDeleteGrowId(null);
    if (!growId) return;
    try {
      await deleteGrow(growId);
      if (selectedGrowId === growId) setSelectedGrowId(null);
      await loadGrowLogs();
    } catch (error) {
      showToast("Failed to delete grow.", "error");
    }
  };

  const handleAddEntry = async () => {
    if (!selectedGrowId) return;

    const entryData = {
      type: newEntryForm.type,
      timestamp: newEntryForm.timestamp,
    };

    if (newEntryForm.type === "res_change") {
      entryData.volume = parseFloat(newEntryForm.volume);
      entryData.volume_unit = newEntryForm.volume_unit;
    } else if (newEntryForm.type === "feeding") {
      entryData.nutrient_amount = parseFloat(newEntryForm.nutrient_amount);
      entryData.nutrient_unit = newEntryForm.nutrient_unit;
      entryData.strength_percent = parseFloat(newEntryForm.strength_percent);
    } else if (newEntryForm.type === "note") {
      entryData.note_text = newEntryForm.note_text;
    }

    try {
      await addGrowEntry(selectedGrowId, entryData);
      setShowAddEntryModal(false);
      setNewEntryForm({
        type: "note",
        timestamp: new Date().toISOString().slice(0, 16).replace("T", " "),
        content: "",
        volume: "",
        volume_unit: "gallons",
        nutrient_amount: "",
        nutrient_unit: "grams",
        strength_percent: 100,
        note_text: "",
      });
      await loadGrowLogs();
    } catch (error) {
      showToast("Failed to add entry.", "error");
    }
  };

  const handlePreloadNutrientCalc = () => {
    if (nutrientCalcData) {
      const amount =
        nutrientCalcData.calculatedAmount != null
          ? String(nutrientCalcData.calculatedAmount)
          : (nutrientCalcData.nutrientAmount || "");
      const unit = nutrientCalcData.calculatedUnit || nutrientCalcData.nutrientUnit || "grams";
      setNewEntryForm({
        ...newEntryForm,
        type: "feeding",
        nutrient_amount: amount,
        nutrient_unit: unit,
        strength_percent: nutrientCalcData.strengthPercent ?? 100,
      });
    }
  };

  const handleEditEntry = (entry, grow) => {
    // Multi-nutrient feedings are logged via the calculator and are currently
    // read-only from this screen to avoid losing per-nutrient detail.
    if (entry.type === "feeding" && Array.isArray(entry.nutrients) && entry.nutrients.length > 0) {
      showToast("Editing multi-nutrient feedings is not supported here. Log a new feeding from the Nutrient Calculator.", "error");
      return;
    }
    setSelectedGrowId(grow.id);
    setEditingEntry(entry);
    setNewEntryForm({
      type: entry.type,
      timestamp: entry.timestamp,
      volume: entry.volume?.toString() || "",
      volume_unit: entry.volume_unit || "gallons",
      nutrient_amount: entry.nutrient_amount?.toString() || "",
      nutrient_unit: entry.nutrient_unit || "grams",
      strength_percent: entry.strength_percent || 100,
      note_text: entry.note_text || "",
    });
    setShowAddEntryModal(true);
  };

  const handleUpdateEntry = async () => {
    if (!selectedGrowId || !editingEntry) return;

    const entryData = {
      type: newEntryForm.type,
      timestamp: newEntryForm.timestamp,
    };

    if (newEntryForm.type === "res_change") {
      entryData.volume = parseFloat(newEntryForm.volume);
      entryData.volume_unit = newEntryForm.volume_unit;
    } else if (newEntryForm.type === "feeding") {
      entryData.nutrient_amount = parseFloat(newEntryForm.nutrient_amount);
      entryData.nutrient_unit = newEntryForm.nutrient_unit;
      entryData.strength_percent = parseFloat(newEntryForm.strength_percent);
    } else if (newEntryForm.type === "note") {
      entryData.note_text = newEntryForm.note_text;
    }

    try {
      await updateGrowEntry(selectedGrowId, editingEntry.id, entryData);
      setShowAddEntryModal(false);
      setEditingEntry(null);
      setNewEntryForm({
        type: "note",
        timestamp: new Date().toISOString().slice(0, 16).replace("T", " "),
        content: "",
        volume: "",
        volume_unit: "gallons",
        nutrient_amount: "",
        nutrient_unit: "grams",
        strength_percent: 100,
        note_text: "",
      });
      await loadGrowLogs();
    } catch (error) {
      showToast("Failed to update entry.", "error");
    }
  };

  const handleDeleteEntry = (entryId, growId) => setConfirmDeleteEntry({ entryId, growId });

  const runDeleteEntry = async () => {
    const { entryId, growId } = confirmDeleteEntry || {};
    setConfirmDeleteEntry(null);
    if (!entryId) return;
    try {
      await deleteGrowEntry(growId ?? selectedGrowId, entryId);
      await loadGrowLogs();
    } catch (error) {
      showToast("Failed to delete entry.", "error");
    }
  };

  if (loading) {
    return <div className="grow-log-page">Loading...</div>;
  }

  return (
    <div className="grow-log-page">
      <div className="grow-log-header">
        <h1>Grow Log</h1>
        <div className="grow-log-header-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => handleExport("csv")}
            title="Download as CSV"
          >
            Export CSV
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => handleExport("json")}
            title="Download as JSON"
          >
            Export JSON
          </button>
          <button className="btn-primary" onClick={() => setShowAddGrowModal(true)}>
            + New Grow
          </button>
        </div>
      </div>

      <div className="grow-log-content">
        {grows.length === 0 ? (
          <p className="empty-state">No grows yet. Create your first grow!</p>
        ) : (
          <div className="grow-sections">
            {grows.map((grow) => {
              const isExpanded = expandedGrowIds.has(grow.id);
              return (
                <div
                  key={grow.id}
                  className={`grow-section ${grow.is_primary ? "primary" : ""} ${isExpanded ? "expanded" : ""}`}
                >
                  <div
                    className="grow-section-header"
                    onClick={() => toggleGrowExpanded(grow.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && toggleGrowExpanded(grow.id)}
                    aria-expanded={isExpanded}
                  >
                    <div className="grow-section-header-left">
                      <span className="grow-section-chevron" aria-hidden>
                        {isExpanded ? "▼" : "▶"}
                      </span>
                      <strong className="grow-section-title">{growStrainDisplay(grow)}</strong>
                      {grow.is_primary ? (
                        <span className="grow-section-star" title="Primary grow">⭐</span>
                      ) : (
                        <button
                          type="button"
                          className="btn-small btn-make-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSetPrimary(grow.id);
                          }}
                        >
                          Make primary
                        </button>
                      )}
                    </div>
                    <div className="grow-section-header-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="btn-small"
                        onClick={() => openEditGrowModal(grow)}
                        title="Edit grow"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-small btn-danger"
                        onClick={() => handleDeleteGrow(grow.id)}
                        title="Delete grow"
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="grow-section-body">
                      <div className="grow-info-block">
                        <div className="grow-info-grid">
                          <div><strong>Grow start:</strong> {grow.start_date}</div>
                          {grow.notes && <div><strong>Notes:</strong> {grow.notes}</div>}
                        </div>
                        {(Array.isArray(grow.strains) ? grow.strains : grow.strain ? [{ name: grow.strain }] : []).filter((s) => s?.name).length > 0 && (
                          <div className="strains-display">
                            <strong>Strains</strong>
                            {(Array.isArray(grow.strains) ? grow.strains : grow.strain ? [{ name: grow.strain }] : []).filter((s) => s?.name).map((s, i) => (
                              <div key={i} className="strain-display-row">
                                <span className="strain-display-name">{s.name}</span>
                                <span className="strain-display-meta">
                                  {s.strain_type && <span>{s.strain_type}</span>}
                                  {s.plant_type && <span> • {s.plant_type}</span>}
                                  {s.start_date && <span> • Start: {s.start_date}</span>}
                                  {s.days_to_finish != null && s.days_to_finish !== "" && <span> • {s.days_to_finish}d</span>}
                                  {s.days_to_finish != null && s.days_to_finish !== "" && s.start_date && (
                                    <span> • Est: {addDaysToDate(s.start_date, s.days_to_finish)}</span>
                                  )}
                                  {s.actual_harvest_date && <span> • Actual: {s.actual_harvest_date}</span>}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        <button type="button" className="btn-small" onClick={() => openEditGrowModal(grow)}>
                          Edit grow
                        </button>
                      </div>

                      <div className="grow-section-entries">
                        <div className="entries-row">
                          <h3>Entries</h3>
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={() => {
                              setSelectedGrowId(grow.id);
                              setShowAddEntryModal(true);
                            }}
                          >
                            + Add Entry
                          </button>
                        </div>
                        {grow.entries && grow.entries.length > 0 ? (
                          grow.entries
                            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                            .map((entry) => (
                              <div key={entry.id} className="entry-item">
                                <div className="entry-header">
                                  <span className="entry-type">{entry.type.replace("_", " ")}</span>
                                  <span className="entry-time">{formatDateTime(entry.timestamp)}</span>
                                  <div className="entry-actions">
                                    <button type="button" className="btn-small" onClick={() => handleEditEntry(entry, grow)}>
                                      ✏️
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-small btn-danger"
                                      onClick={() => handleDeleteEntry(entry.id, grow.id)}
                                    >
                                      ×
                                    </button>
                                  </div>
                                </div>
                                <div className="entry-content">
                                  {entry.type === "pump_activation" && (
                                    <div>
                                      Pump: <strong>{entry.pump_direction}</strong>
                                      {entry.pump_duration != null && entry.pump_duration !== "" && (
                                        <> • Duration: <strong>{entry.pump_duration}s</strong></>
                                      )}
                                      {" • "}pH: <strong>{entry.ph_value}</strong> •{" "}
                                      {entry.is_manual ? "Manual" : "Automatic"}
                                    </div>
                                  )}
                                  {entry.type === "res_change" && (
                                    <div>Volume: <strong>{entry.volume} {entry.volume_unit}</strong></div>
                                  )}
                                  {entry.type === "feeding" && (
                                    <div>
                                      {Array.isArray(entry.nutrients) && entry.nutrients.length > 0 ? (
                                        <>
                                          <div><strong>Nutrients:</strong></div>
                                          <ul className="entry-nutrients-list">
                                            {entry.nutrients.map((n, idx) => (
                                              <li key={n.name || idx}>
                                                {(n.name || `Nutrient ${idx + 1}`) + ": "}
                                                <strong>
                                                  {n.amount} {n.unit}
                                                </strong>
                                                {typeof n.strength_percent === "number" && !Number.isNaN(n.strength_percent) && (
                                                  <> @ {n.strength_percent}%</>
                                                )}
                                              </li>
                                            ))}
                                          </ul>
                                        </>
                                      ) : (
                                        <div>
                                          Amount: <strong>{entry.nutrient_amount} {entry.nutrient_unit}</strong> •{" "}
                                          Strength: <strong>{entry.strength_percent}%</strong>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  {entry.type === "note" && <div>{entry.note_text}</div>}
                                </div>
                              </div>
                            ))
                        ) : (
                          <p className="empty-state">No entries yet. Add your first entry!</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Grow Modal */}
      {showAddGrowModal && (
        <div className="modal-overlay" onClick={() => setShowAddGrowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>New Grow</h2>
            <div className="form-group">
              <label>Start Date</label>
              <input
                type="date"
                value={newGrowForm.start_date}
                onChange={(e) => setNewGrowForm({ ...newGrowForm, start_date: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Strains</label>
              <div className="strains-list">
                {(newGrowForm.strains || [defaultStrain(newGrowForm.start_date)]).map((strain, idx) => (
                  <div key={idx} className="strain-card">
                    <div className="strain-row">
                      <input
                        type="text"
                        value={strain.name}
                        onChange={(e) => {
                          const next = [...(newGrowForm.strains || [])];
                          next[idx] = { ...next[idx], name: e.target.value };
                          setNewGrowForm({ ...newGrowForm, strains: next });
                        }}
                        placeholder="Strain name"
                      />
                      {(newGrowForm.strains?.length || 0) > 1 && (
                        <button type="button" className="btn-small btn-danger" onClick={() => setNewGrowForm({ ...newGrowForm, strains: newGrowForm.strains.filter((_, i) => i !== idx) })}>×</button>
                      )}
                    </div>
                    <div className="strain-row strain-row-fields">
                      <label>Start</label>
                      <input type="date" value={strain.start_date || newGrowForm.start_date} onChange={(e) => { const next = [...(newGrowForm.strains || [])]; next[idx] = { ...next[idx], start_date: e.target.value }; setNewGrowForm({ ...newGrowForm, strains: next }); }} />
                      <label>Days to finish</label>
                      <input type="number" min={0} className="strain-days-input" value={strain.days_to_finish} onChange={(e) => { const next = [...(newGrowForm.strains || [])]; next[idx] = { ...next[idx], days_to_finish: e.target.value }; setNewGrowForm({ ...newGrowForm, strains: next }); }} />
                      <span className="strain-est">Est: {addDaysToDate(strain.start_date || newGrowForm.start_date, strain.days_to_finish) || "—"}</span>
                    </div>
                    <div className="strain-row strain-row-fields">
                      <label>Actual harvest</label>
                      <input type="date" value={strain.actual_harvest_date || ""} onChange={(e) => { const next = [...(newGrowForm.strains || [])]; next[idx] = { ...next[idx], actual_harvest_date: e.target.value }; setNewGrowForm({ ...newGrowForm, strains: next }); }} />
                      <label>Type</label>
                      <select value={strain.strain_type || "Hybrid"} onChange={(e) => { const next = [...(newGrowForm.strains || [])]; next[idx] = { ...next[idx], strain_type: e.target.value }; setNewGrowForm({ ...newGrowForm, strains: next }); }}>
                        <option value="Indica">Indica</option>
                        <option value="Hybrid">Hybrid</option>
                        <option value="Sativa">Sativa</option>
                      </select>
                      <label>Photo/Auto</label>
                      <select value={strain.plant_type || "Photo"} onChange={(e) => { const next = [...(newGrowForm.strains || [])]; next[idx] = { ...next[idx], plant_type: e.target.value }; setNewGrowForm({ ...newGrowForm, strains: next }); }}>
                        <option value="Photo">Photo</option>
                        <option value="Auto">Auto</option>
                      </select>
                    </div>
                  </div>
                ))}
                <button type="button" className="btn-small" onClick={() => setNewGrowForm({ ...newGrowForm, strains: [...(newGrowForm.strains || []), defaultStrain(newGrowForm.start_date)] })}>
                  + Add strain
                </button>
              </div>
            </div>
            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={newGrowForm.is_primary}
                  onChange={(e) =>
                    setNewGrowForm({ ...newGrowForm, is_primary: e.target.checked })
                  }
                />
                Set as Primary Grow
              </label>
            </div>
            <div className="form-group">
              <label>Notes</label>
              <textarea
                value={newGrowForm.notes}
                onChange={(e) => setNewGrowForm({ ...newGrowForm, notes: e.target.value })}
                rows={3}
                placeholder="General notes about this grow..."
              />
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowAddGrowModal(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleCreateGrow}>
                Create Grow
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Grow Modal */}
      {showEditGrowModal && editingGrow && (
        <div className="modal-overlay" onClick={() => { setShowEditGrowModal(false); setEditingGrow(null); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Edit Grow</h2>
            <div className="form-group">
              <label>Start Date</label>
              <input
                type="date"
                value={editGrowForm.start_date}
                onChange={(e) => setEditGrowForm({ ...editGrowForm, start_date: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Strains</label>
              <div className="strains-list">
                {(editGrowForm.strains || [defaultStrain(editGrowForm.start_date)]).map((strain, idx) => (
                  <div key={idx} className="strain-card">
                    <div className="strain-row">
                      <input
                        type="text"
                        value={strain.name}
                        onChange={(e) => {
                          const next = [...(editGrowForm.strains || [])];
                          next[idx] = { ...next[idx], name: e.target.value };
                          setEditGrowForm({ ...editGrowForm, strains: next });
                        }}
                        placeholder="Strain name"
                      />
                      {(editGrowForm.strains?.length || 0) > 1 && (
                        <button type="button" className="btn-small btn-danger" onClick={() => setEditGrowForm({ ...editGrowForm, strains: editGrowForm.strains.filter((_, i) => i !== idx) })}>×</button>
                      )}
                    </div>
                    <div className="strain-row strain-row-fields">
                      <label>Start</label>
                      <input type="date" value={strain.start_date || editGrowForm.start_date} onChange={(e) => { const next = [...(editGrowForm.strains || [])]; next[idx] = { ...next[idx], start_date: e.target.value }; setEditGrowForm({ ...editGrowForm, strains: next }); }} />
                      <label>Days to finish</label>
                      <input type="number" min={0} className="strain-days-input" value={strain.days_to_finish} onChange={(e) => { const next = [...(editGrowForm.strains || [])]; next[idx] = { ...next[idx], days_to_finish: e.target.value }; setEditGrowForm({ ...editGrowForm, strains: next }); }} />
                      <span className="strain-est">Est: {addDaysToDate(strain.start_date || editGrowForm.start_date, strain.days_to_finish) || "—"}</span>
                    </div>
                    <div className="strain-row strain-row-fields">
                      <label>Actual harvest</label>
                      <input type="date" value={strain.actual_harvest_date || ""} onChange={(e) => { const next = [...(editGrowForm.strains || [])]; next[idx] = { ...next[idx], actual_harvest_date: e.target.value }; setEditGrowForm({ ...editGrowForm, strains: next }); }} />
                      <label>Type</label>
                      <select value={strain.strain_type || "Hybrid"} onChange={(e) => { const next = [...(editGrowForm.strains || [])]; next[idx] = { ...next[idx], strain_type: e.target.value }; setEditGrowForm({ ...editGrowForm, strains: next }); }}>
                        <option value="Indica">Indica</option>
                        <option value="Hybrid">Hybrid</option>
                        <option value="Sativa">Sativa</option>
                      </select>
                      <label>Photo/Auto</label>
                      <select value={strain.plant_type || "Photo"} onChange={(e) => { const next = [...(editGrowForm.strains || [])]; next[idx] = { ...next[idx], plant_type: e.target.value }; setEditGrowForm({ ...editGrowForm, strains: next }); }}>
                        <option value="Photo">Photo</option>
                        <option value="Auto">Auto</option>
                      </select>
                    </div>
                  </div>
                ))}
                <button type="button" className="btn-small" onClick={() => setEditGrowForm({ ...editGrowForm, strains: [...(editGrowForm.strains || []), defaultStrain(editGrowForm.start_date)] })}>
                  + Add strain
                </button>
              </div>
            </div>
            <div className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={editGrowForm.is_primary}
                  onChange={(e) => setEditGrowForm({ ...editGrowForm, is_primary: e.target.checked })}
                />
                Set as Primary Grow
              </label>
            </div>
            <div className="form-group">
              <label>Notes</label>
              <textarea
                value={editGrowForm.notes}
                onChange={(e) => setEditGrowForm({ ...editGrowForm, notes: e.target.value })}
                rows={3}
                placeholder="General notes about this grow..."
              />
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => { setShowEditGrowModal(false); setEditingGrow(null); }}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleUpdateGrow}>
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Entry Modal */}
      {showAddEntryModal && (
        <div className="modal-overlay" onClick={() => {
          setShowAddEntryModal(false);
          setEditingEntry(null);
        }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>{editingEntry ? "Edit Entry" : "Add Entry"}</h2>
            <div className="form-group">
              <label>Entry Type</label>
              <select
                value={newEntryForm.type}
                onChange={(e) => setNewEntryForm({ ...newEntryForm, type: e.target.value })}
              >
                <option value="note">Note</option>
                <option value="res_change">Reservoir Change</option>
                <option value="feeding">Nutrient Feeding</option>
              </select>
            </div>
            <div className="form-group">
              <label>Timestamp</label>
              <input
                type="datetime-local"
                value={newEntryForm.timestamp.replace(" ", "T")}
                onChange={(e) =>
                  setNewEntryForm({
                    ...newEntryForm,
                    timestamp: e.target.value.replace("T", " "),
                  })
                }
              />
            </div>

            {newEntryForm.type === "res_change" && (
              <>
                <div className="form-group">
                  <label>Volume</label>
                  <div className="form-row">
                    <input
                      type="number"
                      step="any"
                      value={newEntryForm.volume}
                      onChange={(e) =>
                        setNewEntryForm({ ...newEntryForm, volume: e.target.value })
                      }
                      placeholder="e.g. 5"
                    />
                    <select
                      value={newEntryForm.volume_unit}
                      onChange={(e) =>
                        setNewEntryForm({ ...newEntryForm, volume_unit: e.target.value })
                      }
                    >
                      <option value="gallons">gallons</option>
                      <option value="liters">liters</option>
                    </select>
                  </div>
                </div>
              </>
            )}

            {newEntryForm.type === "feeding" && (
              <>
                <div className="form-group">
                  <label>
                    Nutrient Amount
                    {nutrientCalcData && (
                      <button
                        type="button"
                        className="btn-small btn-link"
                        onClick={handlePreloadNutrientCalc}
                      >
                        Preload from Calculator
                      </button>
                    )}
                  </label>
                  <div className="form-row">
                    <input
                      type="number"
                      step="any"
                      value={newEntryForm.nutrient_amount}
                      onChange={(e) =>
                        setNewEntryForm({ ...newEntryForm, nutrient_amount: e.target.value })
                      }
                      placeholder="e.g. 50"
                    />
                    <select
                      value={newEntryForm.nutrient_unit}
                      onChange={(e) =>
                        setNewEntryForm({ ...newEntryForm, nutrient_unit: e.target.value })
                      }
                    >
                      <option value="grams">grams</option>
                      <option value="ml">ml</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label>Strength: {newEntryForm.strength_percent}%</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={newEntryForm.strength_percent}
                    onChange={(e) =>
                      setNewEntryForm({
                        ...newEntryForm,
                        strength_percent: parseInt(e.target.value),
                      })
                    }
                  />
                </div>
              </>
            )}

            {newEntryForm.type === "note" && (
              <div className="form-group">
                <label>Note</label>
                <textarea
                  value={newEntryForm.note_text}
                  onChange={(e) =>
                    setNewEntryForm({ ...newEntryForm, note_text: e.target.value })
                  }
                  rows={4}
                  placeholder="Enter your note..."
                />
              </div>
            )}

            <div className="modal-actions">
              <button
                className="btn-secondary"
                onClick={() => {
                  setShowAddEntryModal(false);
                  setEditingEntry(null);
                }}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={editingEntry ? handleUpdateEntry : handleAddEntry}
              >
                {editingEntry ? "Update Entry" : "Add Entry"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteGrowId && (
        <ConfirmModal
          title="Delete Grow"
          message="Are you sure you want to delete this grow? All entries will be lost."
          confirmLabel="Delete"
          cancelLabel="Cancel"
          variant="danger"
          onConfirm={runDeleteGrow}
          onCancel={() => setConfirmDeleteGrowId(null)}
        />
      )}
      {confirmDeleteEntry && (
        <ConfirmModal
          title="Delete Entry"
          message="Are you sure you want to delete this entry?"
          confirmLabel="Delete"
          cancelLabel="Cancel"
          variant="danger"
          onConfirm={runDeleteEntry}
          onCancel={() => setConfirmDeleteEntry(null)}
        />
      )}
    </div>
  );
};

export default GrowLog;
