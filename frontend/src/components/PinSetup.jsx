import React, { useState, useRef, useEffect } from "react";
import "/src/styles/PinSetup.css";
import { setupPin } from "../api";
import { useAuth } from "../context/AuthContext";
import { PIN_LENGTH } from "../context/AuthContext";

const PinSetup = () => {
  const { onPinVerified, setPinError } = useAuth();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const confirmRef = useRef(null);

  const isNumeric = (s) => /^\d*$/.test(s);

  const handlePinChange = (e) => {
    const v = e.target.value;
    if (!isNumeric(v) || v.length <= PIN_LENGTH) setPin(v);
    if (v.length === PIN_LENGTH) confirmRef.current?.focus();
  };

  const handleConfirmChange = (e) => {
    const v = e.target.value;
    if (!isNumeric(v) || v.length <= PIN_LENGTH) setConfirm(v);
  };

  useEffect(() => {
    if (pin.length !== PIN_LENGTH || confirm.length !== PIN_LENGTH) return;
    if (pin !== confirm) {
      setError("PINs do not match");
      return;
    }
    setError("");
    setLoading(true);
    setupPin(pin)
      .then((data) => {
        onPinVerified(data.token, new Date(data.expiresAt));
      })
      .catch((err) => {
        setError(err.response?.data?.error || "Failed to set PIN");
        setLoading(false);
      });
  }, [pin, confirm, onPinVerified]);

  return (
    <div className="pin-setup-overlay">
      <div className="pin-setup-card">
        <h1>Set up your PIN</h1>
        <p className="pin-setup-hint">Enter a 4-digit PIN to protect pump and pH settings.</p>
        <div className="pin-setup-fields">
          <label>
            PIN
            <input
              type="password"
              inputMode="numeric"
              maxLength={PIN_LENGTH}
              value={pin}
              onChange={handlePinChange}
              placeholder="••••"
              autoFocus
              disabled={loading}
              className="pin-input"
            />
          </label>
          <label>
            Confirm PIN
            <input
              ref={confirmRef}
              type="password"
              inputMode="numeric"
              maxLength={PIN_LENGTH}
              value={confirm}
              onChange={handleConfirmChange}
              placeholder="••••"
              disabled={loading}
              className="pin-input"
            />
          </label>
        </div>
        {error && <p className="pin-setup-error">{error}</p>}
        {loading && <p className="pin-setup-loading">Setting up…</p>}
      </div>
    </div>
  );
};

export default PinSetup;
