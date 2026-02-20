import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { getAuthStatus } from "../api";

const AuthContext = createContext(null);

const PIN_LENGTH = 4;
const SESSION_CHECK_MS = 30 * 1000; // check expiry every 30s

export function AuthProvider({ children }) {
  const [pinConfigured, setPinConfigured] = useState(null);
  const [sessionToken, setSessionToken] = useState(() =>
    sessionStorage.getItem("pin_session_token") || null
  );
  const [expiresAt, setExpiresAt] = useState(() => {
    const s = sessionStorage.getItem("pin_session_expires_at");
    return s ? new Date(s) : null;
  });
  const [showPinModal, setShowPinModal] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [pinError, setPinError] = useState(null);

  const isAuthenticated = !!(
    sessionToken &&
    expiresAt &&
    new Date(expiresAt) > new Date()
  );

  const persistSession = useCallback((token, expAt) => {
    setSessionToken(token);
    setExpiresAt(expAt);
    if (token) sessionStorage.setItem("pin_session_token", token);
    else sessionStorage.removeItem("pin_session_token");
    if (expAt) sessionStorage.setItem("pin_session_expires_at", expAt.toISOString());
    else sessionStorage.removeItem("pin_session_expires_at");
  }, []);

  const clearSession = useCallback(() => {
    setSessionToken(null);
    setExpiresAt(null);
    sessionStorage.removeItem("pin_session_token");
    sessionStorage.removeItem("pin_session_expires_at");
  }, []);

  useEffect(() => {
    getAuthStatus(sessionToken).then((data) => {
      setPinConfigured(!!data.pinConfigured);
      if (data.authenticated && data.expiresAt) {
        persistSession(sessionToken, new Date(data.expiresAt));
      } else if (!data.authenticated && sessionToken) {
        clearSession();
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!expiresAt || !sessionToken) return;
    const t = setInterval(() => {
      if (new Date(expiresAt) <= new Date()) clearSession();
    }, SESSION_CHECK_MS);
    return () => clearInterval(t);
  }, [expiresAt, sessionToken, clearSession]);

  useEffect(() => {
    const handleSessionExpired = () => clearSession();
    window.addEventListener("auth:session-expired", handleSessionExpired);
    return () => window.removeEventListener("auth:session-expired", handleSessionExpired);
  }, [clearSession]);

  const runWithPin = useCallback(
    (fn) => {
      if (!pinConfigured) {
        return fn(null);
      }
      if (isAuthenticated) {
        return fn(sessionToken);
      }
      setPendingAction(() => fn);
      setShowPinModal(true);
      setPinError(null);
    },
    [pinConfigured, isAuthenticated, sessionToken]
  );

  /** Always show PIN modal for this action (e.g. pump). Never use existing session. */
  const runWithPinAlways = useCallback(
    (fn) => {
      if (!pinConfigured) {
        return fn(null);
      }
      setPendingAction(() => fn);
      setShowPinModal(true);
      setPinError(null);
    },
    [pinConfigured]
  );

  const onPinVerified = useCallback(
    (token, expAt) => {
      setPinConfigured(true);
      persistSession(token, new Date(expAt));
      setShowPinModal(false);
      setPinError(null);
      if (pendingAction) {
        pendingAction(token);
        setPendingAction(null);
      }
    },
    [persistSession, pendingAction]
  );

  const onPinModalCancel = useCallback(() => {
    setShowPinModal(false);
    setPinError(null);
    setPendingAction(null);
  }, []);

  const value = {
    pinConfigured,
    isAuthenticated,
    sessionToken,
    expiresAt,
    setSession: persistSession,
    clearSession,
    runWithPin,
    runWithPinAlways,
    showPinModal,
    setShowPinModal,
    onPinVerified,
    onPinModalCancel,
    pinError,
    setPinError,
    pendingAction: !!pendingAction,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export { PIN_LENGTH };
