/* toast.tsx — A6 cross-cutting: system-level notifications.
   Error UX taxonomy: system errors → toast (here); form errors → inline;
   critical → full-screen (ErrorState fullScreen). */
"use client";

import React from "react";
import { Icon, type IconName } from "@devdigest/ui";

/** How long a toast stays up before it dismisses itself. */
const DISMISS_MS = 4000;
/** Above the drawer and modal backdrops. */
const Z_INDEX = 1000;

type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  toast: (message: string, kind?: ToastKind) => void;
  success: (m: string) => void;
  error: (m: string) => void;
  info: (m: string) => void;
}

const ToastCtx = React.createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = React.useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

/* Module-level bridge so non-React code (e.g. the React Query cache) can raise
   toasts without the hook. The mounted <ToastProvider> registers its pusher. */
type Pusher = (message: string, kind?: ToastKind) => void;
let activePusher: Pusher | null = null;
export const notify = {
  toast: (m: string, k?: ToastKind) => activePusher?.(m, k),
  success: (m: string) => activePusher?.(m, "success"),
  error: (m: string) => activePusher?.(m, "error"),
  info: (m: string) => activePusher?.(m, "info"),
};

const COLORS: Record<ToastKind, { bg: string; border: string; icon: IconName }> = {
  success: { bg: "var(--ok-bg)", border: "var(--ok)", icon: "Check" },
  error: { bg: "var(--crit-bg)", border: "var(--crit)", icon: "X" },
  info: { bg: "var(--bg-elevated)", border: "var(--border-strong)", icon: "Info" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<Toast[]>([]);
  const seq = React.useRef(1);

  const push = React.useCallback((message: string, kind: ToastKind = "info") => {
    const id = seq.current++;
    setItems((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), DISMISS_MS);
  }, []);

  const api = React.useMemo<ToastApi>(
    () => ({
      toast: push,
      success: (m) => push(m, "success"),
      error: (m) => push(m, "error"),
      info: (m) => push(m, "info"),
    }),
    [push],
  );

  // Expose this provider's pusher to the module-level `notify` bridge.
  React.useEffect(() => {
    activePusher = push;
    return () => {
      if (activePusher === push) activePusher = null;
    };
  }, [push]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          zIndex: Z_INDEX,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          maxWidth: 380,
        }}
        role="status"
        aria-live="polite"
      >
        {items.map((t) => {
          const c = COLORS[t.kind];
          const I = Icon[c.icon];
          return (
            <div
              key={t.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 16px",
                borderRadius: 9,
                background: c.bg,
                border: `1px solid ${c.border}`,
                color: "var(--text-primary)",
                fontSize: 14,
                boxShadow: "var(--shadow-modal)",
                animation: "ddToastIn .16s ease-out",
              }}
            >
              <I size={16} style={{ color: c.border, flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{t.message}</span>
              <button
                onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  display: "inline-flex",
                  padding: 0,
                }}
                aria-label="Dismiss"
              >
                <Icon.X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
