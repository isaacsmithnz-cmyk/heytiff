import type { ReactNode } from "react";

/* The plastic ID card.

   CR80 — the aspect ratio of every access pass, driver licence and gym card
   in a wallet — so a staff record READS as a thing you'd be issued rather
   than as a form someone filled in. It is presentational only: no state, no
   actions, no data fetching. The profile's read views are all made of these.

   Below 480px the ratio is unlocked (see .idc in shell.css): a fixed 856:540
   on a narrow phone leaves the facts row unreadably small, and a wallet card
   that has to be pinch-zoomed defeats the point. */

export type IdCardBadge = {
  label: string;
  /** the pill's accent — a hex; the fill is derived from it */
  color?: string;
};

export type IdCardFact = {
  em: string;
  b: ReactNode;
  /** semantic tint for a fact that is a state, e.g. an expiry */
  tone?: "ok" | "warn" | "bad" | "mute";
};

export function IdCard({
  variant = "dark",
  org,
  badge,
  photoUrl,
  initials,
  name,
  sub,
  facts,
  action,
  children,
}: {
  variant?: "dark" | "light";
  /** the org's trading name — the issuer line, top left */
  org?: string | null;
  badge?: IdCardBadge;
  /** future staff_photo; initials stand in until there is one */
  photoUrl?: string | null;
  initials?: string;
  name: ReactNode;
  sub?: ReactNode;
  facts?: IdCardFact[];
  /** a control in the card's bottom-right corner — the licence wall's remove × */
  action?: ReactNode;
  children?: ReactNode;
}) {
  const accent = badge?.color ?? "#00E5C0";
  const hasFace = Boolean(photoUrl || initials);
  return (
    <div className={`idc ${variant}${hasFace ? "" : " faceless"}`}>
      <span className="idc-sheen" aria-hidden="true" />
      <span className="idc-mesh" aria-hidden="true">
        <i className="m1" />
        <i className="m2" />
      </span>
      {action ? <div className="idc-action">{action}</div> : null}
      <div className="idc-in">
        <div className="idc-top">
          <span className="idc-org">{org || "HeyTiff"}</span>
          {badge && (
            <span
              className="idc-badge"
              style={{ background: `${accent}22`, color: accent, borderColor: `${accent}55` }}
            >
              {badge.label}
            </span>
          )}
        </div>

        <div className="idc-id">
          {/* A card with no face. Passing neither a photo nor initials means the
              card is not ABOUT a person — a licence carries its own details, and
              a wall of them would otherwise repeat one face four times. Every
              other caller passes one or the other, so they are unaffected. */}
          {hasFace && (
            <span className="idc-photo">
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl} alt="" />
              ) : (
                <span className="inn">{initials}</span>
              )}
            </span>
          )}
          <span className="idc-who">
            <b>{name}</b>
            {sub ? <em>{sub}</em> : null}
          </span>
        </div>

        {children}

        {facts && facts.length > 0 && (
          <div className="idc-facts">
            {facts.map((f, i) => (
              <span key={i} className={f.tone ? `f ${f.tone}` : "f"}>
                <em>{f.em}</em>
                <b>{f.b}</b>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
