import React from "react";
import "/src/styles/Toast.css";
import { useToast } from "../context/ToastContext";

const Toast = () => {
  const { toast, dismissToast } = useToast();

  if (!toast) return null;

  return (
    <div
      className={`toast toast-${toast.type}`}
      role="status"
      aria-live="polite"
      onClick={dismissToast}
    >
      <span className="toast-message">{toast.message}</span>
      <button
        type="button"
        className="toast-dismiss"
        onClick={dismissToast}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
};

export default Toast;
