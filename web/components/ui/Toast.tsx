'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

const TOAST_MS = 1800;

type ShowToast = (message: string) => void;

const ToastContext = createContext<ShowToast | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const nextId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const show = useCallback<ShowToast>((message) => {
    clearTimeout(timer.current);
    nextId.current += 1;
    setToast({ id: nextId.current, message });
    timer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {/* The live region stays mounted so screen readers announce each new message. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed bottom-7 left-1/2 z-50 -translate-x-1/2"
      >
        {toast && (
          <div
            key={toast.id}
            className="max-w-[calc(100vw-32px)] animate-toast truncate whitespace-nowrap rounded-pill bg-btn px-[18px] py-3 text-sm font-bold text-on-btn shadow-float"
          >
            {toast.message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

/** Returns `toast(message)`. Used for copy, save, remove, verify, export, sign-out. */
export function useToast(): ShowToast {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
