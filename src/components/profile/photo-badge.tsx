"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";
import type { SaveResult } from "./types";

/* The avatar, and the camera badge that finally makes it settable.

   `.pphoto` has carried a camera badge since the first build of this screen
   and the profile has always hidden it, because there was nowhere for the
   bytes to go: a staff card showed initials forever, and `photo_url` only ever
   held whatever picture Auth0 happened to have at sign-up. The badge is back
   and wired to the same three-step signed upload the org logo uses.

   THE BYTES DON'T COME THROUGH A SERVER ACTION. uploadFile asks for a signed
   slot, PUTs the file straight to storage and confirms it; only the resulting
   document id crosses an action, which re-checks that the document is this
   org's, is a `staff_photo`, and finished uploading (lib/staff/photo).

   IT SAVES ITSELF, like the org logo and unlike every field around it. There
   is no draft to join: the avatar you are looking at is the confirmation. The
   revalidate that follows can't disturb an open form either — a card's draft
   is its mode, and nothing here touches it (see section-card).

   The remove is a second, quieter control and only exists once there IS a
   photo — a card showing initials has nothing to remove. */
export function PhotoBadge({
  photoUrl,
  initials,
  name,
  onSet,
  onClear,
}: {
  /** signed at render, or an absolute URL on a card seeded from Auth0 */
  photoUrl?: string | null;
  initials: string;
  /** whose photo — for the controls' labels, which are the only text here */
  name: string;
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
      /* IMPORTED WHERE IT IS USED, not at the top. upload-client pulls the
         documents actions, which pull auth0's server bundle — statically, that
         puts the whole chain in the module graph of every screen that renders
         a staff card, and in the initial bundle of a page where most visits
         never pick a file. Deferring it also keeps the profile's render tests
         from having to mock a module they never exercise. */
      const { uploadFile } = await import("@/lib/documents/upload-client");
      const up = await uploadFile(file, "staff_photo");
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
    <>
      <div className={"pphoto" + (busy ? " busy" : "")}>
        {photoUrl ? (
          /* a signed storage URL, not a build-time asset — next/image would
             want the host allowlisted, as on the ID cards */
          // eslint-disable-next-line @next/next/no-img-element
          <img className="inn" src={photoUrl} alt="" />
        ) : (
          <div className="inn">{initials}</div>
        )}

        <button
          type="button"
          className="cam"
          disabled={busy}
          aria-label={photoUrl ? `Replace ${name}'s photo` : `Add a photo for ${name}`}
          onClick={() => fileRef.current?.click()}
        >
          <Icon name="cam" size={14} />
        </button>

        {photoUrl && (
          <button
            type="button"
            className="camdel"
            disabled={busy}
            aria-label={`Remove ${name}'s photo`}
            onClick={clear}
          >
            <Icon name="x" size={12} />
          </button>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          aria-label="Profile photo"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>

      {/* Outside the tile on purpose: an error inside a 68px square is a
          tooltip nobody reads, and this one names a reason worth reading. */}
      {error && <div className="carderr photoerr">{error}</div>}
    </>
  );
}
