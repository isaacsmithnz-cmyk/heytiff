"use client";

import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/parts/button";
import { Initials } from "@/components/parts/initials";
import { StateWord } from "@/components/parts/state";
import { Icon } from "@/components/shell/icon";
import type { NextVisit } from "@/lib/jobs/job-conversation";
import type { MirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import { MAP_SIZE } from "@/lib/jobs/job-map";

/* THE FACTS CARD, ON THE LEFT OF A JOB'S OVERVIEW (Isaac, 13 and 14 November
   2026: "Should next visit go above map?", calls 11, 19 and 21; mocks C and D
   approved on https://claude.ai/artifact/MkfHutEG1PanPDCW7fyV5a). One white
   card 320 wide, fitted to the screen and scrolling inside itself, its parts
   under hairlines, each under a 13/500 label with an icon:

     Next visit  the next booked visit, or Nothing booked and Book a visit,
                 the one blue button (the Visit form's door, rule 52); its
                 name opens Visits from anywhere on it
     Site        the address, its first line at 16 bold and the rest grey,
                 with Directions on the label's right (Google Maps, in a
                 new tab); their PO under it, where they gave one
     Contacts    who to ring, in full: a disc, the name in bold, the role
                 grey, the numbers to ring and the email, none underlined
                 and none faded (important text never fades); Edit at the
                 label's right where saving customers is on

   Money and the Job tracker went to Billing (Isaac, 13 November 2026). */

/** A dialable href, or null when the field isn't one number.

    SERVICEM8'S PHONE FIELD IS FREE TEXT. Stripping everything that isn't a
    digit assumes it holds exactly one number, so "0412 345 678 / 9999 a/h"
    becomes tel:04123456789999 — a number that is nobody's, offered as if it
    were the contact's. */
export function telHref(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const bare = raw.replace(/[\s()\-.]/g, "");
  return /^\+?\d{6,15}$/.test(bare) ? `tel:${bare}` : null;
}

/** A number as Australians write it: a mobile 0403 183 628, a landline
    02 9876 5432 (the walk of 25 October 2026: it read 0403183628).
    Anything else, a 1300 number, one from overseas, ServiceM8's free text
    saying more than one number, is shown as it was given. */
export function phoneWords(raw: string): string {
  const bare = raw.replace(/[\s()\-.]/g, "");
  if (/^04\d{8}$/.test(bare)) return `${bare.slice(0, 4)} ${bare.slice(4, 7)} ${bare.slice(7)}`;
  if (/^0[2378]\d{8}$/.test(bare)) return `${bare.slice(0, 2)} ${bare.slice(2, 6)} ${bare.slice(6)}`;
  return raw.trim();
}

const LOOK: Record<string, { icon: string; hue: "grey" | "pink" }> = {
  Site: { icon: "home", hue: "grey" },
  Contact: { icon: "user", hue: "grey" },
  Contacts: { icon: "user", hue: "grey" },
  "Next visit": { icon: "calendar", hue: "pink" },
};

function Fact({
  label,
  onOpen,
  aside,
  className,
  children,
}: {
  label: string;
  /** Opens the tab behind the part, from anywhere on it. */
  onOpen?: () => void;
  /** At the label's right: Directions, Contacts' Edit. */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const look = LOOK[label];
  const name = look ? (
    <span className="jov-labname">
      <Icon name={look.icon} size={16} />
      {label}
    </span>
  ) : (
    label
  );
  return (
    <section className={["jfc-part", onOpen ? "jfc-part--door" : "", className ?? ""].filter(Boolean).join(" ")} aria-labelledby={id}>
      <div className={`jov-lab${look ? ` jov-lab--${look.hue}` : ""}`}>
        {onOpen ? (
          <button type="button" className="jov-open" id={id} onClick={onOpen}>
            {name}
          </button>
        ) : (
          <span id={id}>{name}</span>
        )}
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Google Maps' directions to the job, in a new tab: the address as written,
    one line. */
export function directionsHref(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address.replace(/\s*\n\s*/g, ", ").trim())}`;
}

/** THE MAP over the site (Isaac, 14 November 2026: "Yes, add the map"):
    Google's picture of the address, 320 by 96, through our own route so the
    key stays on the server (api/workboard/job-map). A picture that won't
    load takes its room away. */
export function JobMap({ jobUuid, hue, address }: { jobUuid: string; hue: string; address: string }) {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="jfc-map"
      src={`/api/workboard/job-map?job=${encodeURIComponent(jobUuid)}&hue=${encodeURIComponent(hue)}`}
      alt={`Map of ${address}`}
      width={MAP_SIZE.width}
      height={MAP_SIZE.height}
      loading="lazy"
      onError={() => setGone(true)}
    />
  );
}

export function JobFacts({
  detail,
  next,
  nextRead,
  onVisits,
  onBook,
  onEditContact,
  map = null,
  jobUuid: _jobUuid = null,
}: {
  detail: MirrorJobDetail | null;
  next: NextVisit | null;
  /** The visits have been read (no next visit means none, not not-yet). */
  nextRead: boolean;
  onVisits: () => void;
  /** Book a visit, where the reader may book. */
  onBook?: () => void;
  /** Edit, where saving customers to ServiceM8 is on for this reader. */
  onEditContact?: () => void;
  /** The map of the site, over its address. */
  map?: ReactNode;
  /** The job, for what hangs off its site (Site notes, build 9). */
  jobUuid?: string | null;
}) {
  const where = detail ? (detail.address ?? "").trim() || detail.geoLine || detail.suburb || "" : "";
  const [first, ...rest] = where.split(/\s*\n\s*/).filter(Boolean);
  const contacts = detail?.contacts ?? [];
  return (
    <div className="jfc" role="group" aria-label="The job's facts">
      <Fact label="Next visit" onOpen={onVisits}>
        {next ? (
          <>
            <b className="jov-strong">{next.when}</b>
            {next.who && <p className="jov-cap">{next.who}</p>}
            {next.state && <StateWord tone={next.state.tone}>{next.state.word}</StateWord>}
          </>
        ) : nextRead ? (
          <>
            <b className="jov-strong">Nothing booked</b>
            {onBook && (
              <span className="jov-press">
                <Button kind="main" size={32} onClick={onBook}>
                  Book a visit
                </Button>
              </span>
            )}
          </>
        ) : (
          <>
            <p className="jov-cap">Reading the visits</p>
            {/* Book a visit's room, kept while it reads, so nothing jumps when it comes */}
            {onBook && <span className="jov-press jov-press--held" aria-hidden="true" />}
          </>
        )}
      </Fact>

      {map}

      <Fact
        label="Site"
        aside={
          where ? (
            <Button kind="quiet" size={32} className="jov-edit" href={directionsHref(where)} target="_blank" rel="noopener noreferrer">
              Directions
            </Button>
          ) : null
        }
      >
        {!detail ? (
          <p className="jov-cap">Reading the job</p>
        ) : (
          <>
            {first ? (
              <p className="jov-addr">
                <b>{first}</b>
                {rest.length > 0 && <span>{rest.join(", ")}</span>}
              </p>
            ) : (
              <p className="jov-cap">No address on the job</p>
            )}
            {detail.purchaseOrder && (
              <p className="jov-po">
                <span>Their PO</span> <b>{detail.purchaseOrder}</b>
              </p>
            )}
          </>
        )}
      </Fact>

      <Fact
        label={contacts.length > 1 ? "Contacts" : "Contact"}
        className="jfc-part--contact"
        aside={
          onEditContact ? (
            <Button kind="quiet" size={32} className="jov-edit" onClick={onEditContact}>
              Edit
            </Button>
          ) : null
        }
      >
        {!detail ? (
          <p className="jov-cap">Reading the job</p>
        ) : contacts.length === 0 ? (
          <p className="jov-cap">No contact on the job</p>
        ) : (
          <ul className="jov-contacts">
            {contacts.map((c, i) => (
              <li key={`${c.name}-${i}`}>
                <Initials name={c.name || "Unnamed"} size={32} beside />
                <span className="jov-person">
                  <b className="jov-strong">{c.name || "Unnamed"}</b>
                  {c.type && <span className="jov-cap">{roleWord(c.type)}</span>}
                  <ContactNumber value={c.phone} />
                  <ContactNumber value={c.altPhone} />
                  {c.email && (
                    <a className="jov-mail" href={`mailto:${c.email}`}>
                      {c.email}
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Fact>
    </div>
  );
}

/** ServiceM8 types a contact "JOB" or "BILLING"; the others it spells out
    ("Property Manager"). A role reads in sentence case either way. */
function roleWord(type: string): string {
  const t = type.trim().toLowerCase();
  if (t === "job") return "Job contact";
  if (t === "billing") return "Billing contact";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Dialable when the field is one number, plain text when ServiceM8's
    free-text field is saying more than that. */
function ContactNumber({ value }: { value: string | null }) {
  if (!value) return null;
  const href = telHref(value);
  return href ? (
    <a className="jov-tel" href={href}>
      {phoneWords(value)}
    </a>
  ) : (
    <span className="jov-tel">{value}</span>
  );
}
