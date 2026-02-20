import React, { useEffect, useRef } from "react";
import "/src/styles/ConfirmModal.css";

const ConfirmModal = ({ title, message, confirmLabel, cancelLabel = "Cancel", onConfirm, onCancel, variant = "default" }) => {
  const confirmRef = useRef(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <div className="confirm-modal-overlay" onClick={onCancel} role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
      <div className={`confirm-modal confirm-modal-${variant}`} onClick={(e) => e.stopPropagation()}>
        <h2 id="confirm-modal-title" className="confirm-modal-title">{title}</h2>
        <p className="confirm-modal-message">{message}</p>
        <div className="confirm-modal-actions">
          <button type="button" className="confirm-modal-cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            ref={confirmRef}
            className="confirm-modal-confirm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
