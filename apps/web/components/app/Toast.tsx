"use client";

import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

type Toast = { id: number; text: string; action?: { label: string; run: () => void } };
type Notify = (text: string, action?: Toast["action"]) => void;

const Ctx = createContext<Notify>(() => {});

/** Short confirmations ("Bill saved", "Copied") with an optional Undo. Read out by screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seq = useRef(0);

  const notify = useCallback<Notify>((text, action) => {
    clearTimeout(timer.current);
    const id = ++seq.current;
    setToast({ id, text, action });
    timer.current = setTimeout(() => setToast((t) => (t?.id === id ? null : t)), action ? 6000 : 3200);
  }, []);

  return (
    <Ctx.Provider value={notify}>
      {children}
      <div className="ap-toast-region" aria-live="polite" role="status">
        <AnimatePresence>
          {toast && (
            <motion.div
              key={toast.id}
              className="ap-toast"
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
            >
              <span>{toast.text}</span>
              {toast.action && (
                <button
                  className="ap-toast-action"
                  onClick={() => {
                    toast.action?.run();
                    setToast(null);
                  }}
                >
                  {toast.action.label}
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export const useNotify = () => useContext(Ctx);
