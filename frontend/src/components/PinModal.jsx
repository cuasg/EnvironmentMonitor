import React, { useState, useRef, useEffect } from "react";
import "/src/styles/PinModal.css";
import { verifyPin } from "../api";
import { useAuth } from "../context/AuthContext";
import { PIN_LENGTH } from "../context/AuthContext";

const PinModal = () => {
  const { showPinModal, onPinVerified, onPinModalCancel, pinError, setPinError } = useAuth();
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (showPinModal) {
      setPin("");
      setPinError(null);
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [showPinModal, setPinError]);

  const handleChange = (e) => {
    const v = e.target.value;
    if (!/^\d*$/.test(v) || v.length <= PIN_LENGTH) {
      setPin(v);
      if (pinError) setPinError(null);
    }
    if (v.length === PIN_LENGTH) {
      setLoading(true);
      verifyPin(v)
        .then((data) => {
          onPinVerified(data.token, new Date(data.expiresAt));
          // Action runs only after successful PIN verification (in AuthContext.onPinVerified)
        })
        .catch((err) => {
          setPin("");
          setPinError(err.response?.data?.error || "Wrong PIN");
          setLoading(false);
          inputRef.current?.focus();
        });
    }
  };

  if (!showPinModal) return null;

  return (
    <div className="pin-modal-overlay" onClick={onPinModalCancel}>
      <div className="pin-modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>Enter PIN</h2>
        <p className="pin-modal-hint">PIN is required for this action. Valid for 5 minutes.</p>
        <div className="pin-modal-input-wrapper">
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            maxLength={PIN_LENGTH}
            value={pin}
            onChange={handleChange}
            placeholder="••••"
            disabled={loading}
            className="pin-modal-input"
            autoComplete="off"
          />
        </div>
        {pinError && <p className="pin-modal-error">{pinError}</p>}
        <div className="pin-modal-actions">
          <button type="button" onClick={onPinModalCancel} className="pin-modal-cancel">
            Cancel
          </button>
          {pinError && (
            <button
              type="button"
              onClick={() => { setPin(""); setPinError(null); inputRef.current?.focus(); }}
              className="pin-modal-try"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PinModal;
