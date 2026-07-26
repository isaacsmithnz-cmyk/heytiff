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
   details, and whose licence it is has already been answered by the rail.

   Presentational. The status is worked out by licenceStatus() and handed in, so
   this card and the dashboard's expiry chip can never disagree about what is
   about to lapse. */
export function LicenceCard({
  typeName,
  licenceNumber,
  /** already formatted dd/mm/yyyy, or null for one with no expiry */
  expiry,
  status,
  /** the org's trading name — the issuer line, as on every card here */
  org,
  onRemove,
  removing,
}: {
  typeName: string;
  licenceNumber: string | null;
  expiry: string | null;
  status: LicenceStatus;
  org?: string | null;
  onRemove?: () => void;
  removing?: boolean;
}) {
  const stamp = credBadgeCode(typeName);
  return (
    <IdCard
      variant="light"
      org={org}
      badge={{ label: stamp.code, color: stamp.color }}
      name={typeName}
      facts={[
        { em: "Licence no.", b: licenceNumber || "—" },
        { em: "Expires", b: expiry || "—", tone: status.tone },
        { em: "Status", b: status.label, tone: status.tone },
      ]}
      action={
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
