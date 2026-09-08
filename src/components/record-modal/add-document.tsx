"use client";

import { useRef } from "react";
import type { DocumentKind } from "@/lib/documents/files";
import { uploadFile } from "@/lib/documents/upload-client";
import { Inline } from "./parts";

/* "Add document" — the one affordance that puts a file on a record.

   IT IS ONE COMPONENT BECAUSE EACH RECORD SCREEN NEEDS IT TWICE, in two places
   that are not the same place: under the TERM in force, where the file is
   filed against that term, and on the CARD itself, where there is no term to
   file it against.

   The card-level one is why this exists at all. A term is a PERIOD and
   `expires_on` is NOT NULL, so a ticket that never lapses — a white card, a
   business licence with no renewal date — can hold no term, and until now the
   only "Add document" on either screen lived inside the current term's card.
   The one kind of card whose entire content IS a photo had nowhere to keep it.

   The upload and the filing stay two steps, as everywhere else in this
   codebase: the bytes go straight from the browser to storage and only the id
   that comes back crosses a server action, where the adoption contract decides
   whether it may land. An upload that refuses calls nothing. */

export function AddDocument({
  docKind,
  onAdded,
  label = "Add document",
}: {
  docKind: DocumentKind;
  /** The stored document's id, once the bytes have landed. */
  onAdded: (documentId: string) => void;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Inline onClick={() => input.current?.click()}>{label}</Inline>
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        aria-label={label}
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const up = await uploadFile(file, docKind).catch(() => null);
          if (up?.ok) onAdded(up.file.documentId);
        }}
      />
    </>
  );
}
