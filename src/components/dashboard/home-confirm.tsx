"use client";

import { useEffect, useRef } from "react";

/* ASKING TWICE, on the new Home. A delete that has no undo never fires on
   the first press: the button that would do it swaps for this — the
   question, the verb again, and Keep — and focus lands on Keep, so a
   second Enter backs out rather than deletes.

   The old Home's Tasks face had its own copy, in the `hm-` dress, and it
   went with that Home (2026-09-26); this one wears the new Home's and is
   the one its faces share. */
export function Confirm({
  question = "Delete for good?",
  verb = "Delete",
  pending = false,
  onGo,
  onKeep,
}: {
  question?: string;
  verb?: string;
  /** The delete is out: neither button answers until it is back. */
  pending?: boolean;
  onGo: () => void;
  onKeep: () => void;
}) {
  const keep = useRef<HTMLButtonElement>(null);
  /* Once, as it appears: the question replaced the button that had focus. */
  useEffect(() => {
    keep.current?.focus();
  }, []);
  return (
    <div className="hd-cf" role="group" aria-label={question}>
      <span className="hd-cf-q">{question}</span>
      <button type="button" className="hd-ls-vb hd-cf-go" disabled={pending} onClick={onGo}>
        {verb}
      </button>
      <button type="button" className="hd-ls-vb" ref={keep} disabled={pending} onClick={onKeep}>
        Keep
      </button>
    </div>
  );
}
