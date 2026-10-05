"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { documentTheme } from "@/lib/org/theme";
import type { SaveResult } from "./types";
import { withCleanup } from "@/lib/ui/with-cleanup";

/* THE DOCUMENT COLOUR — one ROW on the Company tab: a swatch, the hex, Remove.

   It saves itself, like the logo row above it and for the same reason: it is
   outside the card edit cycle, and the row changing is the confirmation.

   NOTHING THAT PRINTS IS THE COLOUR THAT WAS PICKED. `documentTheme` derives
   the roles, pushing each until it measures against the ground it sits on, so
   a business that picks a pale yellow gets the dark gold its frame will
   actually be. That check lives on the templates now, where the documents are
   drawn in the derived colour on a real page; this row used to carry a
   miniature sheet for it, a second copy of the construction that had to be
   kept in step by hand — and had drifted — three times. Picking a colour that
   "doesn't work" is impossible by construction; this row only has to hand the
   server something `documentTheme` accepts. */

export function BrandColorPicker({
  value,
  onSet,
  onClear,
}: {
  /** lowercase #rrggbb, or null for no theme */
  value: string | null;
  onSet: (hex: string) => Promise<SaveResult>;
  onClear: () => Promise<SaveResult>;
}) {
  /* What the swatch shows, which is not the saved value: a native colour input
     streams while the pointer drags, and saving on every frame would be
     hundreds of writes for one decision. The stream moves this; the native
     `change` commits it. */
  const [draft, setDraft] = useState(value ?? DEFAULT_SEED);
  const [typed, setTyped] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const swatchRef = useRef<HTMLInputElement>(null);

  const commit = async (hex: string) => {
    setError(null);
    // the same parser the server and the derivation use — a value this refuses
    // would be refused there too, and saying so here costs no round trip
    if (!documentTheme(hex)) {
      setError("That isn't a colour — use a hex value like #1a2b4c.");
      return;
    }
    setBusy(true);
    await withCleanup(async () => {
      const res = await onSet(hex);
      if (!res.ok) setError(res.error);
      else setTyped(hex);
    }, () => setBusy(false));
  };

  const clear = async () => {
    setError(null);
    setBusy(true);
    await withCleanup(async () => {
      const res = await onClear();
      if (!res.ok) setError(res.error);
      else {
        /* back to the seed, not just an empty box: the swatch kept showing the
           removed colour beside a hex field that said nothing */
        setTyped("");
        setDraft(DEFAULT_SEED);
      }
    }, () => setBusy(false));
  };

  /* THE COMMIT IS A NATIVE `change` LISTENER, NOT React's onChange. React maps
     onChange on a colour input to the `input` event, which a browser fires on
     every frame of a drag — so `onChange={commit}` wrote the colour to the
     server, and revalidated the page, hundreds of times for one decision. The
     DOM's own `change` fires once, when the picker closes or the pointer lets
     go. An effect event, so the listener is attached once and still calls the
     current `commit`. */
  const commitPicked = useEffectEvent((hex: string) => void commit(hex));
  useEffect(() => {
    const el = swatchRef.current;
    if (!el) return;
    const onDone = () => commitPicked(el.value);
    el.addEventListener("change", onDone);
    return () => el.removeEventListener("change", onDone);
  }, []);

  return (
    <div className="orgcol">
      {/* React's onChange here is the `input` event, so it only repaints the
          swatch; saving is the native listener above. */}
      <input
        ref={swatchRef}
        type="color"
        className="orgcol-swatch"
        value={draft}
        disabled={busy}
        aria-label="Brand colour"
        onChange={(e) => setDraft(e.currentTarget.value)}
      />
      {/* Typed, because a business has its brand hex written down on a style
          guide and copying it in is the accurate way to do this. */}
      <input
        type="text"
        className="inp orgcol-hex"
        value={typed}
        disabled={busy}
        placeholder="None"
        aria-label="Brand colour hex"
        spellCheck={false}
        onChange={(e) => {
          setTyped(e.target.value);
          // move the swatch as they type, but only once it is a colour
          if (documentTheme(e.target.value)) setDraft(e.target.value);
        }}
        onBlur={(e) => e.target.value.trim() && void commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit(e.currentTarget.value);
        }}
      />
      {value && (
        <span className="orgcol-act">
          <button className="pbtn ghost" type="button" disabled={busy} onClick={clear}>
            Remove
          </button>
        </span>
      )}

      {error && <div className="carderr">{error}</div>}
    </div>
  );
}

/* Not a brand and not the app's teal — a neutral navy for the colour input to
   open on when there is nothing saved. The app's own accent would suggest
   HeyTiff's colour is the default answer, and it is the one colour a customer
   document should never be themed in. */
const DEFAULT_SEED = "#1a2b4c";
