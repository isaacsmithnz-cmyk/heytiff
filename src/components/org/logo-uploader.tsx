"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import { uploadFile } from "@/lib/documents/upload-client";
import type { SaveResult } from "./types";

/* The company logo — a real upload now, where the old screen had a dead
   "Coming soon" tile.

   THE BYTES DON'T COME THROUGH HERE. uploadFile asks the server for a signed
   slot, PUTs the file straight to storage and confirms it; all this component
   then does is hand the resulting document id to setOrgLogo, which re-checks
   that the document is this org's, is an org_logo, and finished uploading.

   IT SAVES ITSELF. Unlike the fields around it, the logo is not part of the
   card's Save — picking a file writes it immediately, because the thing you are
   looking at IS the confirmation. The card's draft is untouched by the
   revalidate that follows (the draft is the mode — see profile/section-card),
   so whatever else was being typed stays where it was. */

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

  return (
    <div className="orglogo">
      <div className="orglogo-row">
        <span className="orglogo-prev">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Company logo" />
          ) : (
            <Icon name="cam" size={20} />
          )}
        </span>
        <div className="orglogo-k">
          <b>{logoUrl ? "Company logo" : "No logo yet"}</b>
          <em>PNG, JPG or WEBP — it appears on your company card</em>
        </div>
        <div className="orglogo-act">
          <button
            className="pbtn ghost"
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="upload" size={15} />
            {logoUrl ? "Replace" : "Upload"}
          </button>
          {logoUrl && (
            <button className="pbtn ghost" type="button" disabled={busy} onClick={clear}>
              Remove
            </button>
          )}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        aria-label="Company logo"
        style={{ display: "none" }}
        onChange={(e) => pick(e.target.files?.[0])}
      />
      {error && <div className="carderr">{error}</div>}
    </div>
  );
}
