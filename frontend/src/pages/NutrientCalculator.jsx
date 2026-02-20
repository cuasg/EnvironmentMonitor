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

const NutrientCalculator = () => {
  const [reservoirAmount, setReservoirAmount] = useState(() => loadNutrientCalcSaved()?.reservoirAmount ?? "");
  const [reservoirUnit, setReservoirUnit] = useState(() => loadNutrientCalcSaved()?.reservoirUnit ?? "gallons");

  const [nutrientAmount, setNutrientAmount] = useState(() => loadNutrientCalcSaved()?.nutrientAmount ?? "");
  const [nutrientUnit, setNutrientUnit] = useState(() => loadNutrientCalcSaved()?.nutrientUnit ?? "grams");
  const [perVolumeAmount, setPerVolumeAmount] = useState(() => loadNutrientCalcSaved()?.perVolumeAmount ?? "");
  const [perVolumeUnit, setPerVolumeUnit] = useState(() => loadNutrientCalcSaved()?.perVolumeUnit ?? "liters");

  const [strengthPercent, setStrengthPercent] = useState(() => {
    const s = loadNutrientCalcSaved();
    return typeof s?.strengthPercent === "number" ? s.strengthPercent : 100;
  });
  const [result, setResult] = useState(null);
  const [trackStatus, setTrackStatus] = useState(null);
  const [tracking, setTracking] = useState(false);

  const calculate = () => {
    const res = parseFloat(reservoirAmount);
    const amt = parseFloat(nutrientAmount);
    const perVol = parseFloat(perVolumeAmount);

    if (Number.isNaN(res) || Number.isNaN(amt) || Number.isNaN(perVol) || perVol <= 0 || res <= 0) {
      setResult(null);
      return;
    }

    let reservoirInPerUnit;
    if (perVolumeUnit === "liters") {
      reservoirInPerUnit = toLiters(res, reservoirUnit);
    } else {
      reservoirInPerUnit = toGallons(res, reservoirUnit);
    }

    const rawNeed = (reservoirInPerUnit / perVol) * amt;
    const finalNeed = rawNeed * (strengthPercent / 100);
    setResult({ value: finalNeed, unit: nutrientUnit });

    saveNutrientCalcSaved({
      reservoirAmount,
      reservoirUnit,
      nutrientAmount,
      nutrientUnit,
      perVolumeAmount,
      perVolumeUnit,
      strengthPercent,
      calculatedAmount: finalNeed,
      calculatedUnit: nutrientUnit,
    });
  };

  const trackToGrowLog = async () => {
    if (result == null) return;
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

      const amountTwoDecimals = Number.isFinite(result.value)
        ? Math.round(result.value * 100) / 100
        : result.value;
      await addGrowEntry(primary.id, {
        type: "feeding",
        timestamp,
        nutrient_amount: amountTwoDecimals,
        nutrient_unit: result.unit,
        strength_percent: strengthPercent,
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

  const resultDisplay =
    result != null
      ? `${result.value.toFixed(2)} ${result.unit} needed`
      : null;

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
            <label className="nutrient-calc-label">Nutrient mix (amount per volume of water)</label>
            <div className="nutrient-calc-row nutrient-calc-ratio">
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 5 or 5.5"
                value={nutrientAmount}
                onChange={(e) => setNutrientAmount(e.target.value)}
                className="nutrient-calc-input"
              />
              <select
                value={nutrientUnit}
                onChange={(e) => setNutrientUnit(e.target.value)}
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
                value={perVolumeAmount}
                onChange={(e) => setPerVolumeAmount(e.target.value)}
                className="nutrient-calc-input"
              />
              <select
                value={perVolumeUnit}
                onChange={(e) => setPerVolumeUnit(e.target.value)}
                className="nutrient-calc-select"
              >
                <option value="liters">liters</option>
                <option value="gallons">gallons</option>
              </select>
            </div>
          </div>

          <div className="nutrient-calc-section">
            <label className="nutrient-calc-label">Strength: {strengthPercent}%</label>
            <input
              type="range"
              min="0"
              max="100"
              value={strengthPercent}
              onChange={(e) => setStrengthPercent(Number(e.target.value))}
              className="nutrient-calc-slider"
            />
          </div>

          <button type="button" onClick={calculate} className="nutrient-calc-btn">
            Calculate
          </button>

          {resultDisplay && (
            <div className="nutrient-calc-result">
              <strong>{resultDisplay}</strong>
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
