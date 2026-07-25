import { Icon } from "@/components/shell/icon";
import { credBadgeCode, type LicenceStatus } from "@/lib/staff/licence";

/* One licence / ticket, as the small card it is in real life.

   Presentational: it is handed a status that licenceStatus() already worked
   out, so this card and the dashboard's expiry chip can never disagree about
   whether something is expiring. The status tones are CSS classes (.lstat.ok
   etc.) rather than inline styles, so a tone is named once. */

export function CredentialCard({
  typeName,
  licenceNumber,
  expiry,
  status,
  onRemove,
  removing,
}: {
  typeName: string;
  licenceNumber: string | null;
  /** already formatted dd/mm/yyyy, or null for a licence with no expiry */
  expiry: string | null;
  status: LicenceStatus;
  onRemove?: () => void;
  removing?: boolean;
}) {
  const badge = credBadgeCode(typeName);
  return (
    <div className="cred">
      <div className="cred-top">
        <b>{typeName}</b>
        <span
          className="cred-badge"
          style={{ background: `${badge.color}18`, color: badge.color }}
        >
          {badge.code}
        </span>
      </div>
      <div className={licenceNumber ? "cred-no" : "cred-no none"}>
        {licenceNumber ? `No. ${licenceNumber}` : "No. —"}
      </div>
      <div className="cred-foot">
        <span className="cred-exp">{expiry ? `Expires ${expiry}` : "No expiry date"}</span>
        <span className={`lstat ${status.tone}`}>{status.label}</span>
      </div>
      {onRemove && (
        <button
          className="cred-del"
          type="button"
          title={`Remove ${typeName}`}
          aria-label={`Remove ${typeName}`}
          disabled={removing}
          onClick={onRemove}
        >
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}
