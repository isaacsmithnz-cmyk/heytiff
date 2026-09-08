"use client";

import { Icon } from "@/components/shell/icon";
import { credBadgeCode, type LicenceStatus } from "@/lib/staff/licence";
import { IdCard } from "./id-card";

/* One staff licence, as the plastic card it is in real life.

   A driver licence, an ARC ticket and a white card are all things you carry in
   a wallet, so they render as the same CR80 object the rest of this screen uses
   — issuer across the top, the stamp in the corner, the number and the expiry
   along the bottom. It replaced a plain info tile that looked like a form row.

   NO FACE, DELIBERATELY. A real licence carries the holder's photo, but a staff
   card shows three or four at once and repeating one face four times reads as a
   rendering bug rather than as a wallet. The card carries the licence's own
   details, and whose licence it is has already been answered by the block above
   the wall.

   NO ISSUER LINE EITHER, and the status is a PILL rather than a third fact.
   Both changed for the same reason: three of these sit side by side on Summary
   now, and the card had to survive that. The business name was the same three
   identical rows of small caps on every card, distinguishing nothing and taking
   the width the facts wanted; and "Expires in 3 weeks" as a fact was long
   enough to push one card's row onto two lines while its neighbours stayed on
   one, so a wall of them never lined up. The status moves into the corner the
   issuer gave up, wearing its colour, and the two facts left sit on a grid.

   IT IS A DOOR NOW. A ticket carries a history of terms
   (docs/migrations/staff_licence_records.sql), so the whole card opens the
   licence modal and the remove × is gone from it — deleting a ticket is a
   deliberate act behind Edit details, not a hover target on a wall. `onRemove`
   stays for any caller that still shows a card it may only remove.

   Presentational. The status is worked out by licenceStatus() and handed in, so
   this card and the dashboard's expiry chip can never disagree about what is
   about to lapse. */
export function LicenceCard({
  typeName,
  licenceNumber,
  /** already formatted dd/mm/yyyy, or null for one with no expiry */
  expiry,
  status,
  note,
  onOpen,
  onRemove,
  removing,
}: {
  typeName: string;
  licenceNumber: string | null;
  expiry: string | null;
  status: LicenceStatus;
  /** "3 terms on file" — the history, visible from outside the card. */
  note?: string;
  /** Opens the licence modal; makes the whole card the target. */
  onOpen?: () => void;
  onRemove?: () => void;
  removing?: boolean;
}) {
  const stamp = credBadgeCode(typeName);
  return (
    <IdCard
      variant="light"
      credential
      badge={{ label: stamp.code, color: stamp.color }}
      state={{ label: status.label, tone: status.tone }}
      name={typeName}
      sub={note}
      onOpen={onOpen}
      openLabel={onOpen ? `Open ${typeName}` : undefined}
      /* the date stays untinted — the pill above is carrying the colour, and
         two things going amber for one fact is one too many */
      facts={[
        { em: "Licence no.", b: licenceNumber || "—" },
        { em: "Expires", b: expiry || "—" },
      ]}
      action={
        !onOpen &&
        onRemove && (
          <button
            className="idc-del"
            type="button"
            title={`Remove ${typeName}`}
            aria-label={`Remove ${typeName}`}
            disabled={removing}
            onClick={onRemove}
          >
            <Icon name="x" size={14} />
          </button>
        )
      }
    />
  );
}
