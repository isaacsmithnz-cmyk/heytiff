"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { uploadFile } from "@/lib/documents/upload-client";
import { BrandLogo } from "./letterhead";
import { NO_BRAND } from "@/lib/org/brand";
import type { SaveResult } from "./types";

/* The company logo.

   IT IS NOT INSIDE AN EDIT FORM ANY MORE, and that is the whole change. It used
   to be the last field of the Company identity card's edit view: the only way
   to discover the app could hold a logo at all was to press Edit on a card
   titled after something else and scroll to the bottom of a form. Read the
   screen and there was no logo on it — which is indistinguishable from the
   feature not existing.

   So it is a TILE on the Your business card now, in read mode, always. Empty,
   it is a dashed drop target that says what it wants; filled, it is the logo at
   the size it will be used. Either way it is the first thing on the screen.

   THE BYTES DON'T COME THROUGH HERE. uploadFile asks the server for a signed
   slot, PUTs the file straight to storage and confirms it; all this component
   then does is hand the resulting document id to setOrgLogo, which re-checks
   that the document is this org's, is an org_logo, and finished uploading.

   IT SAVES ITSELF — it always did, and now nothing around it pretends
   otherwise. Picking a file writes it immediately, because the thing you are
   looking at IS the confirmation. There is no card draft to keep in step now
   that it sits outside the edit cycle. */

/** Same set the server accepts; the picker filters on it and the drop handler
    re-checks it, because a drop bypasses `accept` entirely. */
const IMAGE = /^image\/(png|jpeg|jpg|webp|svg\+xml)$/;

export function LogoUploader({
  logoUrl,
  onSet,
  onClear,
}: {
  /** signed, minted at render; null when there is no logo */
  logoUrl: string | null;
  onSet: (documentId: string) => Promise<SaveResult>;
  onClear: () => Promise<SaveResult>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const up = await uploadFile(file, "org_logo");
      if (!up.ok) {
        setError(up.error);
        return;
      }
      const res = await onSet(up.file.documentId);
      if (!res.ok) setError(res.error);
    } finally {
      setBusy(false);
      // let the same file be chosen again after a failure
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const clear = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await onClear();
      if (!res.ok) setError(res.error);
    } finally {
      setBusy(false);
    }
  };

  /* A drop is the gesture people reach for with an image, and the tile is
     already the right shape for it. It refuses a non-image HERE rather than
     letting the round trip refuse it, because the answer is instant and the
     file never leaves the machine. */
  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (busy) return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!IMAGE.test(file.type)) {
      setError("That's not an image — PNG, JPG, WEBP or SVG.");
      return;
    }
    void pick(file);
  };

  return (
    <div className="orglogo">
      {/* The tile is the button. Not a <button> wrapping an <img>, because the
          same element is also the drop zone and a nested Remove control would
          be a button inside a button — the Remove sits beside it below. */}
      <div
        className={`orglogo-tile${logoUrl ? " has" : ""}${over ? " over" : ""}${busy ? " busy" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="Company logo" />
        ) : (
          <span className="orglogo-empty">
            <Icon name="upload" size={22} />
            <b>Drop an image</b>
            <em>PNG, JPG, WEBP or SVG</em>
          </span>
        )}
        {busy && <span className="orglogo-busy" aria-hidden="true" />}
      </div>

      <div className="orglogo-act">
        <button
          className="pbtn ghost"
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <Icon name="upload" size={14} />
          {logoUrl ? "Replace" : "Upload"}
        </button>
        {logoUrl && (
          <button className="pbtn ghost" type="button" disabled={busy} onClick={clear}>
            Remove
          </button>
        )}
      </div>

      {/* WHERE IT ACTUALLY GOES.

          The tile above is the artwork on white at 224px, and on its own that
          is a preview which cannot fail — every logo looks right that big on
          that ground. The two places a customer meets this logo are neither:
          a document, and the dark bar on a share link at 26px tall. The rail
          shipped a logo 9px tall in black ink on black because nothing on this
          screen could have told anyone otherwise.

          So the sentence that used to sit here — "Goes on everything the
          business sends a customer" — is now the picture instead, and only the
          empty state still says it in words, where there is nothing to draw.

          Built from the same `BrandLogo` and the same classes the real
          surfaces use, over their real grounds. A preview assembled from a
          COPY of those rules is one that drifts, and a drifting preview is
          worse than none: it is confidently wrong. */}
      {logoUrl ? (
        <div className="orglogo-uses">
          <div className="orglogo-use paper">
            <em>On a document</em>
            <BrandLogo brand={{ ...NO_BRAND, logoUrl }} className="org-lh-logo" />
          </div>
          <div className="orglogo-use dark">
            <em>On a share link</em>
            <BrandLogo brand={{ ...NO_BRAND, logoUrl }} className="org-mark-logo org-plate" />
          </div>
        </div>
      ) : (
        <p className="orglogo-where">Goes on everything the business sends a customer.</p>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        aria-label="Company logo"
        style={{ display: "none" }}
        onChange={(e) => pick(e.target.files?.[0])}
      />
      {error && <div className="carderr">{error}</div>}
    </div>
  );
}
