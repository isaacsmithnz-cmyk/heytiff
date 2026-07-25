import { Icon } from "@/components/shell/icon";
import { credBadgeCode, type CredBadge, type LicenceStatus } from "@/lib/staff/licence";

/* One licence / ticket / policy, as the small card it is in real life.

   Presentational: it is handed a status that licenceStatus() already worked
   out, so this card and the dashboard's expiry chip can never disagree about
   whether something is expiring. The status tones are CSS classes (.lstat.ok
   etc.) rather than inline styles, so a tone is named once.

   Two shapes of card use it. A staff licence is REPLACED — it carries an × and
   nothing else. An organisation credential is EDITED — a policy renews and its
   expiry moves — so it takes `onOpen` and becomes one big click target for the
   modal. A card gets one or the other, never both. */

export function CredentialCard({
  typeName,
  licenceNumber,
  issuer,
  expiry,
  status,
  badge,
  onOpen,
  onRemove,
  removing,
}: {
  typeName: string;
  licenceNumber: string | null;
  /** who issued it — the insurer, or the authority. Omitted for staff tickets. */
  issuer?: string | null;
  /** already formatted dd/mm/yyyy, or null for one with no expiry */
  expiry: string | null;
  status: LicenceStatus;
  /** overrides the derived stamp — org credentials carry their own registry */
  badge?: CredBadge;
  /** makes the whole card a button (edit-in-place); mutually exclusive with onRemove */
  onOpen?: () => void;
  onRemove?: () => void;
  removing?: boolean;
}) {
  const stamp = badge ?? credBadgeCode(typeName);
  return (
    <div className={onOpen ? "cred clickable" : "cred"}>
      {/* a stretched, labelled button rather than a click handler on the card:
          it keeps the whole surface clickable without inventing a div that
          behaves like a button for a mouse and like nothing for a keyboard */}
      {onOpen && (
        <button
          className="cred-open"
          type="button"
          aria-label={`Edit ${typeName}`}
          onClick={onOpen}
        />
      )}
      <div className="cred-top">
        <b>{typeName}</b>
        <span
          className="cred-badge"
          style={{ background: `${stamp.color}18`, color: stamp.color }}
        >
          {stamp.code}
        </span>
      </div>
      <div className={licenceNumber ? "cred-no" : "cred-no none"}>
        {licenceNumber ? `No. ${licenceNumber}` : "No. —"}
      </div>
      {issuer ? <div className="cred-issuer">{issuer}</div> : null}
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
