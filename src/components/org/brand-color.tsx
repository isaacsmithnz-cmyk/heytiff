"use client";

import { useState } from "react";
import { documentTheme } from "@/lib/org/theme";
import type { SaveResult } from "./types";

/* THE BRAND COLOUR, AND A DOCUMENT TO CHECK IT AGAINST.

   A swatch on a settings screen is the same broken preview the logo tile was:
   every colour looks fine as a 40px square, and none of them tell you what a
   customer will hold. So the control here IS a document — a masthead rule, a
   heading, a panel — repainted live as the colour changes.

   NOTHING SHOWN HERE IS THE COLOUR THAT WAS PICKED. `documentTheme` derives
   the roles, pushing each until it measures against the ground it sits on, so
   a business that picks a pale yellow sees the dark gold their headings will
   actually be, at the moment they pick it, rather than discovering it on a
   handover sheet. Picking a colour that "doesn't work" is impossible by
   construction; picking one whose derived form surprises you should not be.

   It saves itself, like the logo tile beside it and for the same reason: it is
   outside the card edit cycle, and what you are looking at is the
   confirmation. */

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
  /* The seed the PREVIEW is drawn from, which is not the saved value: a native
     colour input streams while the pointer drags, and saving on every frame
     would be hundreds of writes for one decision. `input` moves this, `change`
     commits — see `commit`. */
  const [draft, setDraft] = useState(value ?? DEFAULT_SEED);
  const [typed, setTyped] = useState(value ?? "");
  /* Whether the picker has been TOUCHED, which is not the same as whether a
     colour is saved. The colour input has to open on something, so `draft`
     carries a seed from the first render — previewing THAT would show a band
     in a colour nobody chose. Until it is touched the preview shows the real
     default instead. */
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const theme = documentTheme(draft);
  /* TRANSPARENT, not a grey stand-in and not a house colour: no colour means
     no frame, which is what an unthemed document actually does. This drew the
     documents' old default near-black instead, and once that default went the
     control was previewing a sheet the app can no longer produce — the third
     time this preview has needed hand-syncing, and the reason it cannot read
     `--doc-*` like the sheets do is unchanged: it has to draw for a colour
     that has not been saved, which is exactly when those variables are
     absent. */
  const ink = theme && (value || touched) ? theme.ink : "transparent";

  const commit = async (hex: string) => {
    setError(null);
    // the same parser the server and the derivation use — a value this refuses
    // would be refused there too, and saying so here costs no round trip
    if (!documentTheme(hex)) {
      setError("That isn't a colour — use a hex value like #1a2b4c.");
      return;
    }
    setBusy(true);
    try {
      const res = await onSet(hex);
      if (!res.ok) setError(res.error);
      else setTyped(hex);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await onClear();
      if (!res.ok) setError(res.error);
      else setTyped("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="orgcol">
      {/* THE DOCUMENT, and it shows the BAND because the band is what the
          colour does. This preview and the real sheets are the same shape and
          the same two numbers — 4mm gutter, 7.94mm radius (the app shell's own
          30px, converted at 96dpi) — scaled down together. Nothing chosen
          draws no frame, because that is what an unthemed sheet does.

          Inert: no role, no labels, nothing to tab to. It is a picture of an
          outcome, and a screen reader announcing a coloured rectangle would be
          reading out something that is not there.

          What is drawn is never the colour that was picked. `documentTheme`
          darkens it only as far as it must to stay visible on white, so a
          business choosing pale yellow sees the gold its band will actually be
          at the moment it chooses. */}
      <div className="orgcol-doc" aria-hidden="true">
        <div className="orgcol-band" style={{ background: ink }} />
        <div className="orgcol-well" />
        <div className="orgcol-page">
          <b>Handover sheet</b>
          <span>Smith Air Conditioning &middot; ABN 51 824 753 556</span>
          <i />
          <i className="short" />
        </div>
      </div>

      <div className="orgcol-pick">
        {/* `input` repaints, `change` saves. Both are needed: without the
            first the preview is dead while you drag, and with only the first
            a drag across the spectrum is a write per frame. */}
        <input
          type="color"
          className="orgcol-swatch"
          value={draft}
          disabled={busy}
          aria-label="Brand colour"
          onInput={(e) => { setTouched(true); setDraft(e.currentTarget.value); }}
          onChange={(e) => void commit(e.currentTarget.value)}
        />
        {/* Typed, because a business has its brand hex written down on a style
            guide and copying it in is the accurate way to do this. */}
        <input
          type="text"
          className="inp orgcol-hex"
          value={typed}
          disabled={busy}
          placeholder={DEFAULT_SEED}
          aria-label="Brand colour hex"
          spellCheck={false}
          onChange={(e) => {
            setTyped(e.target.value);
            // repaint as they type, but only once it is a colour
            if (documentTheme(e.target.value)) {
              setTouched(true);
              setDraft(e.target.value);
            }
          }}
          onBlur={(e) => e.target.value.trim() && void commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit(e.currentTarget.value);
          }}
        />
        {value && (
          <button className="pbtn ghost" type="button" disabled={busy} onClick={clear}>
            Remove
          </button>
        )}
      </div>

      {error && <div className="carderr">{error}</div>}
    </div>
  );
}

/* Not a brand and not the app's teal — a neutral navy for the colour input to
   open on when there is nothing saved. The app's own accent would suggest
   HeyTiff's colour is the default answer, and it is the one colour a customer
   document should never be themed in. */
const DEFAULT_SEED = "#1a2b4c";

