"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { uploadFile } from "@/lib/documents/upload-client";
import type { SaveResult } from "./types";
import { withCleanup } from "@/lib/ui/with-cleanup";

/* The company logo — one ROW on the Company tab, like every other setting.

   IT IS NOT INSIDE AN EDIT FORM, and that is the whole point of where it lives.
   It used to be the last field of a card's edit view: the only way to discover
   the app could hold a logo at all was to press Edit on a card titled after
   something else and scroll to the bottom of a form. Read the screen and there
   was no logo on it — indistinguishable from the feature not existing.

   So the row says what is there: the artwork in a box at the size it prints,
   or that initials stand in, and the one verb that fits (Upload, or Replace and
   Remove). The row is also the drop target, because a drop is the gesture
   people reach for with an image.

   THE BYTES DON'T COME THROUGH HERE. uploadFile asks the server for a signed
   slot, PUTs the file straight to storage and confirms it; all this component
   then does is hand the resulting document id to setOrgLogo, which re-checks
   that the document is this org's, is an org_logo, and finished uploading.

   IT SAVES ITSELF. Picking a file writes it immediately, because the row
   changing IS the confirmation — there is no card draft to keep in step.

   WHERE IT LANDS IS NOT SHOWN HERE. The templates draw every document with the
   logo on it, so that is where to check it against a white page and a dark bar;
   a second copy of those surfaces on this screen was a preview built from rules
   that could drift from the real ones. */

/** Same set the server accepts; the picker filters on it and the drop handler
    re-checks it, because a drop bypasses `accept` entirely.

    NO SVG. The row offered it from the start, and it could never be stored:
    `checkUpload` (lib/documents/files) and the `documents` bucket's own MIME
    allowlist both refuse image/svg+xml, so an SVG got as far as "photos and
    PDFs only" and stopped. Offering it here is a promise the storage layer
    breaks — and opening the bucket to SVG is not a picker change: an SVG is a
    document that can carry script. */
const IMAGE = /^image\/(png|jpeg|jpg|webp)$/;

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
    await withCleanup(async () => {
      const up = await uploadFile(file, "org_logo");
      if (!up.ok) {
        setError(up.error);
        return;
      }
      const res = await onSet(up.file.documentId);
      if (!res.ok) setError(res.error);
    }, () => {
      setBusy(false);
      // let the same file be chosen again after a failure
      if (fileRef.current) fileRef.current.value = "";
    });
  };

  const clear = async () => {
    setError(null);
    setBusy(true);
    await withCleanup(async () => {
      const res = await onClear();
      if (!res.ok) setError(res.error);
    }, () => setBusy(false));
  };

  /* It refuses a non-image HERE rather than letting the round trip refuse it,
     because the answer is instant and the file never leaves the machine. */
  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (busy) return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!IMAGE.test(file.type)) {
      setError("That's not an image — PNG, JPG or WEBP.");
      return;
    }
    void pick(file);
  };

  return (
    <div
      className={`orglogo${over ? " over" : ""}${busy ? " busy" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      {logoUrl ? (
        <span className="orglogo-thumb">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoUrl} alt="Company logo" />
        </span>
      ) : (
        <span className="orglogo-none">Initials stand in</span>
      )}

      <span className="orglogo-act">
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
      </span>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="Company logo"
        style={{ display: "none" }}
        onChange={(e) => pick(e.target.files?.[0])}
      />
      {error && <div className="carderr">{error}</div>}
    </div>
  );
}
