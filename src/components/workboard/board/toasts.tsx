"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/* Toasts, plural on purpose (B23): the prototype had ONE slot, so a second
   action's toast stomped the first and Undo could undo the WRONG thing.
   Here every action gets its own toast carrying its own inverse; they stack,
   they age out independently, and an Undo can never apply to anything but
   the action that raised it. */

export type BoardToast = {
  id: number;
  message: string;
  /** The action's own inverse — bound in the closure that raised it. */
  undo?: () => void | Promise<void>;
};

const TOAST_MS = 6_500;

export function useBoardToasts() {
  const [toasts, setToasts] = useState<BoardToast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message: string, undo?: () => void | Promise<void>) => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((list) => [...list, { id, message, undo }]);
  }, []);

  return { toasts, toast, dismiss };
}

export function ToastHost({
  toasts,
  onDismiss,
}: {
  toasts: BoardToast[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return createPortal(
    <div className="wb2-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <ToastRow key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body
  );
}

function ToastRow({ toast, onDismiss }: { toast: BoardToast; onDismiss: (id: number) => void }) {
  const { id, message, undo } = toast;

  useEffect(() => {
    const t = setTimeout(() => onDismiss(id), TOAST_MS);
    return () => clearTimeout(t);
  }, [id, onDismiss]);

  return (
    <div className="wb2-toast">
      <span>{message}</span>
      {undo && (
        <button
          onClick={async () => {
            onDismiss(id);
            await undo();
          }}
        >
          Undo
        </button>
      )}
      <button className="wb2-toastx" aria-label="Dismiss" onClick={() => onDismiss(id)}>
        ×
      </button>
    </div>
  );
}
