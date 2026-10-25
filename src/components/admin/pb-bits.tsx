"use client";

import type { ReactNode } from "react";
import { buttonClass } from "@/components/parts/button";
import { Dot } from "@/components/parts/state";

/* THE PRICE BOOK'S SMALL PIECES, for the page and for the dialogs its rows
   open, where `.fg` (and so the frame's own Wrong) doesn't reach: a fact
   said in ink, what went wrong, and a file chosen through a button. */

const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });
/** cents as dollars: $1,234.56 */
export const dollars = (cents: number) => money.format(cents / 100);

/** A fact, in ink, with a second line in grey when it has one. */
export function Said({ children, more }: { children: ReactNode; more?: ReactNode }) {
  return (
    <p className="st2-pb-said" role="status">
      {children}
      {more != null && <span>{more}</span>}
    </p>
  );
}

/** What went wrong (rule 42): a red dot and the words. */
export function Oops({ children }: { children: ReactNode }) {
  return (
    <p className="st2-pb-wrong" role="alert">
      <Dot hue="red" />
      <span>{children}</span>
    </p>
  );
}

/** A file chosen through the second button: the button's words, the
    file input over it unseen, so the browser's own chooser opens. */
export function FileButton({
  words,
  label,
  accept,
  disabled,
  size = 36,
  onFile,
}: {
  /** what the button says, a verb and a noun, or what it's doing */
  words: string;
  /** the input's name for a screen reader */
  label: string;
  accept: string;
  disabled?: boolean;
  size?: 32 | 36;
  onFile: (f: File) => void;
}) {
  return (
    <label className={buttonClass("second", size, "st2-pb-file")} aria-disabled={disabled || undefined}>
      <span className="pt-btn__word">{words}</span>
      <input
        type="file"
        aria-label={label}
        accept={accept}
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
    </label>
  );
}
