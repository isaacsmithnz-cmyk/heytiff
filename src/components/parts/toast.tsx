"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/* THE TOAST (rule 37). Ink, bottom left, a few words and Undo: what saving
   says when it keeps you where you were (rule 51). White words on the ink,
   the button's 10 corner, at --z-toast over everything.

   Each toast carries its own Undo, bound where it was raised, so an Undo can
   only ever undo its own action. It goes after five seconds, and the clock
   stops while the pointer or the focus is on it, so a slow reader or a
   keyboard on its way to Undo never loses it. Three at most: a fourth pushes
   the oldest out.

   The live region is drawn from the start, empty, because a region that
   arrives with its words is often not read out. */

export type ToastInput = {
  /** A few words: "Visit booked". */
  text: string;
  /** Puts it back. Shown as an Undo button; pressing it also dismisses. */
  undo?: () => void;
};

type Item = ToastInput & { id: number };

const TOAST_MS = 5_000;
const MAX = 3;

type Raise = (t: ToastInput) => () => void;

const ToastContext = createContext<Raise | null>(null);

/** `toast({ text, undo })` shows one and returns its dismiss. */
export function useToast(): Raise {
  const raise = useContext(ToastContext);
  if (!raise) throw new Error("useToast needs a <ToastProvider> above it");
  return raise;
}

const noSubscribe = () => () => {};
const useClient = () => useSyncExternalStore(noSubscribe, () => true, () => false);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const next = useRef(1);
  const client = useClient();

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const raise = useCallback<Raise>(
    ({ text, undo }) => {
      const id = next.current++;
      setItems((list) => [...list, { id, text, undo }].slice(-MAX));
      return () => dismiss(id);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={raise}>
      {children}
      {client &&
        createPortal(
          <div className="pt-toasts" role="status" aria-live="polite">
            {items.map((t) => (
              <Toast key={t.id} item={t} onDismiss={dismiss} />
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

function Toast({ item, onDismiss }: { item: Item; onDismiss: (id: number) => void }) {
  const { id, text, undo } = item;
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  /* What is left of the five seconds, kept across a pause. */
  const left = useRef(TOAST_MS);

  useEffect(() => {
    if (hover || focus) return;
    const started = Date.now();
    const timer = setTimeout(() => onDismiss(id), Math.max(0, left.current));
    return () => {
      clearTimeout(timer);
      left.current -= Date.now() - started;
    };
  }, [hover, focus, id, onDismiss]);

  return (
    <div
      className="pt-toast"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
      }}
    >
      <span className="pt-toast-text">{text}</span>
      {undo && (
        <button
          type="button"
          className="pt-toast-undo"
          onClick={() => {
            undo();
            onDismiss(id);
          }}
        >
          Undo
        </button>
      )}
    </div>
  );
}
