import React, { useState } from "react";
import "/src/styles/NutrientCalculator.css";
import { STORAGE_KEYS } from "../constants";
import { getGrowLogs, addGrowEntry } from "../api";

function loadNutrientCalcSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.NUTRIENT_CALC);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveNutrientCalcSaved(data) {
  try {
    localStorage.setItem(STORAGE_KEYS.NUTRIENT_CALC, JSON.stringify(data));
  } catch (e) {
    console.warn("Could not save nutrient calculator state", e);
  }
}

const GALLONS_TO_LITERS = 3.785411784;

function toLiters(amount, unit) {
  if (unit === "liters") return amount;
  return amount * GALLONS_TO_LITERS;
}

function toGallons(amount, unit) {
  if (unit === "gallons") return amount;
  return amount / GALLONS_TO_LITERS;
}

function createNutrientRow(overrides = {}) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    doseAmount: "",
    doseUnit: "grams",
    dosePerAmount: "",
    dosePerUnit: "liters",
    strengthPercent: 100,
    ...overrides,
  };
}

const NutrientCalculator = () => {
  const saved = loadNutrientCalcSaved();

  const [reservoirAmount, setReservoirAmount] = useState(() => saved?.reservoirAmount ?? "");
  const [reservoirUnit, setReservoirUnit] = useState(() => saved?.reservoirUnit ?? "gallons");

  const [nutrients, setNutrients] = useState(() => {
    if (saved && Array.isArray(saved.nutrients) && saved.nutrients.length > 0) {
      return saved.nutrients.map((n) =>
        createNutrientRow({
          id: n.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: n.name || "",
          doseAmount: n.doseAmount ?? "",
          doseUnit: n.doseUnit || "grams",
          dosePerAmount: n.dosePerAmount ?? "",
          dosePerUnit: n.dosePerUnit || "liters",
          strengthPercent:
            typeof n.strengthPercent === "number" && !Number.isNaN(n.strengthPercent) ? n.strengthPercent : 100,
        }),
      );
    }

    if (saved && (saved.nutrientAmount || saved.perVolumeAmount)) {
      return [
        createNutrientRow({
          doseAmount: saved.nutrientAmount ?? "",
          doseUnit: saved.nutrientUnit || "grams",
          dosePerAmount: saved.perVolumeAmount ?? "",
          dosePerUnit: saved.perVolumeUnit || "liters",
          strengthPercent:
            typeof saved.strengthPercent === "number" && !Number.isNaN(saved.strengthPercent)
              ? saved.strengthPercent
              : 100,
        }),
      ];
    }

    return [createNutrientRow()];
  });

  const [results, setResults] = useState(null);
  const [trackStatus, setTrackStatus] = useState(null);
  const [tracking, setTracking] = useState(false);

  const calculate = () => {
    const res = parseFloat(reservoirAmount);
    if (Number.isNaN(res) || res <= 0) {
      setResults(null);
      return;
    }

    const perNutrient = [];
    const totalsByUnit = {};

    nutrients.forEach((row) => {
      const amt = parseFloat(row.doseAmount);
      const perVol = parseFloat(row.dosePerAmount);
      if (Number.isNaN(amt) || Number.isNaN(perVol) || perVol <= 0) {
        return;
      }

      let reservoirInPerUnit;
      if (row.dosePerUnit === "liters") {
        reservoirInPerUnit = toLiters(res, reservoirUnit);
      } else {
        reservoirInPerUnit = toGallons(res, reservoirUnit);
      }

      const rawNeed = (reservoirInPerUnit / perVol) * amt;
      const finalNeed = rawNeed * (row.strengthPercent / 100);

      const result = {
        id: row.id,
        name: row.name || "",
        amount: finalNeed,
        unit: row.doseUnit,
        strengthPercent: row.strengthPercent,
      };
      perNutrient.push(result);

      if (!Number.isNaN(finalNeed)) {
        const key = row.doseUnit;
        totalsByUnit[key] = (totalsByUnit[key] || 0) + finalNeed;
      }
    });

    if (perNutrient.length === 0) {
      setResults(null);
      return;
    }

    setResults({ perNutrient, totalsByUnit });

    saveNutrientCalcSaved({
      reservoirAmount,
      reservoirUnit,
      nutrients,
    });
  };

  const trackToGrowLog = async () => {
    if (!results || !results.perNutrient || results.perNutrient.length === 0) return;
    setTrackStatus(null);
    setTracking(true);
    try {
      const { grows } = await getGrowLogs();
      const primary = grows?.find((g) => g.is_primary);
      if (!primary) {
        setTrackStatus("No primary grow set. Set a primary grow in Grow Log first.");
        setTracking(false);
        return;
      }
      const now = new Date();
      const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
      const resVolume = parseFloat(reservoirAmount);
      const resUnit = reservoirUnit || "gallons";

      const nutrientsPayload = results.perNutrient.map((n) => ({
        name: n.name || null,
        amount: Number.isFinite(n.amount) ? Math.round(n.amount * 100) / 100 : n.amount,
        unit: n.unit,
        strength_percent: n.strengthPercent,
      }));
      await addGrowEntry(primary.id, {
        type: "feeding",
        timestamp,
        nutrients: nutrientsPayload,
      });
      await addGrowEntry(primary.id, {
        type: "res_change",
        timestamp,
        volume: Number.isNaN(resVolume) ? 0 : resVolume,
        volume_unit: resUnit,
      });
      setTrackStatus("Tracked to primary grow.");
    } catch (e) {
      setTrackStatus(e.response?.data?.error || "Failed to track.");
    } finally {
      setTracking(false);
    }
  };

  return (
    <div className="grow-info-page">
      <h1 className="grow-info-title">Nutrient Calculator</h1>

      <div className="grow-info-tiles">
        <div className="grow-info-tile">
          <h2 className="grow-info-tile-title">Nutrient Calculator</h2>

          <div className="nutrient-calc-section">
            <label className="nutrient-calc-label">Reservoir size</label>
            <div className="nutrient-calc-row">
              <input
                type="number"
                min="0"
                step="any"
                placeholder="e.g. 5"
                value={reservoirAmount}
                onChange={(e) => setReservoirAmount(e.target.value)}
                className="nutrient-calc-input"
              />
              <select
                value={reservoirUnit}
                onChange={(e) => setReservoirUnit(e.target.value)}
                className="nutrient-calc-select"
              >
                <option value="gallons">gallons</option>
                <option value="liters">liters</option>
              </select>
            </div>
          </div>

          <div className="nutrient-calc-section">
            <label className="nutrient-calc-label">Nutrients (amount per volume of water)</label>
            {nutrients.map((row, index) => (
              <div key={row.id} className="nutrient-calc-row nutrient-calc-ratio nutrient-calc-row-multi">
                <input
                  type="text"
                  placeholder={`Nutrient ${index + 1} (e.g. Part A, CalMag)`}
                  value={row.name}
                  onChange={(e) => {
                    const next = nutrients.map((n) =>
                      n.id === row.id ? { ...n, name: e.target.value } : n,
                    );
                    setNutrients(next);
                  }}
                  className="nutrient-calc-input nutrient-calc-input-name"
                />
                <div className="nutrient-calc-row">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="e.g. 5 or 5.5"
                    value={row.doseAmount}
                    onChange={(e) => {
                      const next = nutrients.map((n) =>
                        n.id === row.id ? { ...n, doseAmount: e.target.value } : n,
                      );
                      setNutrients(next);
                    }}
                    className="nutrient-calc-input"
                  />
                  <select
                    value={row.doseUnit}
                    onChange={(e) => {
                      const next = nutrients.map((n) =>
                        n.id === row.id ? { ...n, doseUnit: e.target.value } : n,
                      );
                      setNutrients(next);
                    }}
                    className="nutrient-calc-select"
                  >
                    <option value="grams">grams</option>
                    <option value="ml">ml</option>
                  </select>
                  <span className="nutrient-calc-per">per</span>
                  <input
                    type="number"
                    min="0.001"
                    step="any"
                    placeholder="e.g. 1"
                    value={row.dosePerAmount}
                    onChange={(e) => {
                      const next = nutrients.map((n) =>
                        n.id === row.id ? { ...n, dosePerAmount: e.target.value } : n,
                      );
                      setNutrients(next);
                    }}
                    className="nutrient-calc-input"
                  />
                  <select
                    value={row.dosePerUnit}
                    onChange={(e) => {
                      const next = nutrients.map((n) =>
                        n.id === row.id ? { ...n, dosePerUnit: e.target.value } : n,
                      );
                      setNutrients(next);
                    }}
                    className="nutrient-calc-select"
                  >
                    <option value="liters">liters</option>
                    <option value="gallons">gallons</option>
                  </select>
                </div>
                <div className="nutrient-calc-row nutrient-calc-row-strength">
                  <label className="nutrient-calc-label-inline">
                    Strength: {row.strengthPercent}%
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={row.strengthPercent}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      const next = nutrients.map((n) =>
                        n.id === row.id ? { ...n, strengthPercent: value } : n,
                      );
                      setNutrients(next);
                    }}
                    className="nutrient-calc-slider"
                  />
                  {nutrients.length > 1 && (
                    <button
                      type="button"
                      className="nutrient-calc-remove-btn"
                      onClick={() => {
                        setNutrients(nutrients.filter((n) => n.id !== row.id));
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
            <button
              type="button"
              className="nutrient-calc-btn nutrient-calc-add-btn"
              onClick={() => setNutrients([...nutrients, createNutrientRow()])}
            >
              + Add nutrient
            </button>
          </div>

          <button type="button" onClick={calculate} className="nutrient-calc-btn">
            Calculate
          </button>

          {results && results.perNutrient && results.perNutrient.length > 0 && (
            <div className="nutrient-calc-result">
              <strong>Per nutrient:</strong>
              <ul className="nutrient-calc-result-list">
                {results.perNutrient.map((n, idx) => (
                  <li key={n.id}>
                    {n.name || `Nutrient ${idx + 1}`}:{" "}
                    <strong>{Number.isFinite(n.amount) ? n.amount.toFixed(2) : n.amount} {n.unit}</strong>{" "}
                    @ {n.strengthPercent}%
                  </li>
                ))}
              </ul>
              {results.totalsByUnit && Object.keys(results.totalsByUnit).length > 0 && (
                <div className="nutrient-calc-totals">
                  <strong>Totals:</strong>{" "}
                  {Object.entries(results.totalsByUnit)
                    .map(([unit, amt]) => `${amt.toFixed(2)} ${unit}`)
                    .join(", ")}
                </div>
              )}
              <button
                type="button"
                onClick={trackToGrowLog}
                disabled={tracking}
                className="nutrient-calc-btn nutrient-calc-track-btn"
              >
                {tracking ? "Tracking…" : "Track"}
              </button>
              {trackStatus && (
                <p className={`nutrient-calc-track-status ${trackStatus.startsWith("Tracked") ? "success" : "error"}`}>
                  {trackStatus}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NutrientCalculator;
