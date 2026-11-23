"use client";

import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { withoutCountry } from "@/lib/au-address";
import { Button } from "@/components/parts/button";
import { Initials } from "@/components/parts/initials";
import { StateWord } from "@/components/parts/state";
import { Icon } from "@/components/shell/icon";
import type { NextVisit } from "@/lib/jobs/job-conversation";
import type { MirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import { HEAD_MAP_SIZE, headMapSize } from "@/lib/jobs/job-map";
import { SiteNotes } from "./site-notes";

/* THE FACTS CARD, ON THE LEFT OF A JOB'S OVERVIEW (Isaac, 13 and 14 November
   2026, calls 11, 19 and 21, mocks C and D; then 16 November 2026: "swap the
   map and the address with the stepper and the actions button", "The next
   visit and bookings can then take the place of the map"). One white card
   320 wide, fitted to the screen, its parts under hairlines, each under a
   13/500 label with an icon:
     Next visit  the next booked visit, or Nothing booked with Book a visit,
                 the one blue button (the Visit form's door, rule 52), on the
                 label's right; its name opens Visits from anywhere on it
     the stages  where the job is up to, a step to a line with its day, each
                 opening its part of the job (job-progress-line)
     Contacts    a line each: a disc, the name in bold, the role grey;
                 pressed, it drops down the numbers to ring and the email,
                 none underlined and none faded (important text never fades),
                 so three or four contacts fit (Isaac, 16 November 2026:
                 "Name and role on one line each, clicking it brings a drop
                 down with phone email etc."); Edit at the label's right,
                 where saving customers is on, opens Edit customer with
                 every contact on the job
   The site, its map, Directions and Site notes are the head's now
   (job-page-head, JobSiteWords and JobHeadMap below). Money and the Job
   tracker went to Billing (Isaac, 13 November 2026). */

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

/** A number as Australians write it: a mobile 0491 570 006, a landline
    02 9876 5432 (the walk of 25 October 2026: it read 0491570006).
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

export { withoutCountry };

/** The address as two lines, the street over the rest: ServiceM8's own
    lines where it has them, else split at its last comma ("2 Tempor Street,
    Demoford", 3533: the walk of 15 November 2026). */
export function addressLines(where: string): string[] {
  const lines = withoutCountry(where).split(/\s*\n\s*/).filter(Boolean);
  if (lines.length !== 1) return lines;
  const at = lines[0]!.lastIndexOf(",");
  if (at <= 0) return lines;
  const street = lines[0]!.slice(0, at).trim();
  const place = lines[0]!.slice(at + 1).trim();
  return street && place ? [street, place] : lines;
}

/** Google Maps' directions to the job, in a new tab: the address as written,
    one line. */
export function directionsHref(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address.replace(/\s*\n\s*/g, ", ").trim())}`;
}

/** THE MAP IN THE JOB'S HEAD (Isaac, 16 November 2026: "the map can probably
    become like a hero", A on https://claude.ai/artifact/XbKL1kUEjP1YxP3qEAQnL6,
    "zoomed out a bit more so you can see surrounding areas"): Google's picture
    of the address and the streets round it, 640 by 112, through our own route
    so the key stays on the server (api/workboard/job-map), fading into the
    head where the words are. Pressed, it is the directions to the site, in a
    new tab. A picture that won't load takes its room away.

    Its card stands in the head's right column, as wide as the Scope tab's
    column under it and as tall as the words' card beside it (bug 52, Isaac,
    20 November 2026: "map misaligned"; rule 31, "the same height"), and the
    picture is asked for at that size once the card is measured, so it is
    drawn whole with Google's mark and data line on it. Where nothing can be
    measured it is the wide picture. */
export function JobHeadMap({ jobUuid, hue, address }: { jobUuid: string; hue: string; address: string }) {
  const [gone, setGone] = useState(false);
  const box = useRef<HTMLAnchorElement>(null);
  /* undefined until measured; null where the card has no size to read */
  const [size, setSize] = useState<{ width: number; height: number } | null | undefined>(undefined);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => {
      const next = el.clientWidth > 0 && el.clientHeight > 0 ? headMapSize(el.clientWidth, el.clientHeight) : null;
      setSize((was) => (was && next && was.width === next.width && was.height === next.height ? was : next));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(read);
    watch.observe(el);
    return () => watch.disconnect();
  }, [gone]);
  if (gone) return null;
  const drawn = size ?? HEAD_MAP_SIZE;
  return (
    <a ref={box} className="jp-map" href={directionsHref(address)} target="_blank" rel="noopener noreferrer" aria-label={`Directions to ${address.replace(/\s*\n\s*/g, ", ")}`}>
      {size !== undefined && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={`/api/workboard/job-map?job=${encodeURIComponent(jobUuid)}&hue=${encodeURIComponent(hue)}&shape=head${size ? `&w=${size.width}&h=${size.height}` : ""}`}
          alt=""
          width={drawn.width}
          height={drawn.height}
          onError={() => setGone(true)}
        />
      )}
    </a>
  );
}

/** The site in the job's head: the address on one line, its first part bold,
    their PO where they gave one, and Site notes (build 9). */
export function JobSiteWords({ detail, jobUuid }: { detail: MirrorJobDetail | null; jobUuid: string | null }) {
  if (!detail) return null;
  const where = siteOf(detail);
  const [first, ...rest] = addressLines(where);
  if (!first) return null;
  return (
    <div className="jp-site">
      <p className="jp-addr">
        <b>{first}</b>
        {rest.length > 0 && <span>, {rest.join(", ")}</span>}
      </p>
      {jobUuid && <SiteNotes jobUuid={jobUuid} />}
      {detail.purchaseOrder && (
        <p className="jov-po">
          <span>Their PO</span> <b>{detail.purchaseOrder}</b>
        </p>
      )}
    </div>
  );
}

/** Where the job is, as written: ServiceM8's address, else its place. */
export function siteOf(detail: Pick<MirrorJobDetail, "address" | "geoLine" | "suburb">): string {
  return (detail.address ?? "").trim() || detail.geoLine || detail.suburb || "";
}

export function JobFacts({
  detail,
  next,
  nextRead,
  onVisits,
  onBook,
  onEditContact,
  stages = null,
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
  /** Where the job is up to, under Next visit. */
  stages?: ReactNode;
}) {
  const contacts = detail?.contacts ?? [];
  /* one contact open at a time */
  const [opened, setOpened] = useState<number | null>(null);
  return (
    <div className="jfc" role="group" aria-label="The job's facts">
      <Fact
        label="Next visit"
        onOpen={onVisits}
        aside={
          !onBook || next ? null : nextRead ? (
            <Button kind="main" size={32} onClick={onBook}>
              Book a visit
            </Button>
          ) : (
            /* Book a visit's room, kept while it reads, so nothing jumps when it comes */
            <span className="jov-press--held" aria-hidden="true" />
          )
        }
      >
        {next ? (
          <>
            <b className="jov-strong">{next.when}</b>
            {next.who && <p className="jov-cap">{next.who}</p>}
            {next.state && <StateWord tone={next.state.tone}>{next.state.word}</StateWord>}
          </>
        ) : nextRead ? (
          <b className="jov-strong">Nothing booked</b>
        ) : (
          <p className="jov-cap">Reading the visits</p>
        )}
      </Fact>

      {stages && (
        <section className="jfc-part jfc-part--stages" aria-label="Where the job is up to">
          {stages}
        </section>
      )}

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
              <ContactRow key={`${c.name}-${i}`} contact={c} open={opened === i} onToggle={() => setOpened(opened === i ? null : i)} />
            ))}
          </ul>
        )}
      </Fact>
    </div>
  );
}

type Contact = NonNullable<MirrorJobDetail["contacts"]>[number];

/** A contact on one line, the name and the role; pressed, its numbers and
    email drop down under it. A contact with neither is a line, not a press. */
function ContactRow({ contact: c, open, onToggle }: { contact: Contact; open: boolean; onToggle: () => void }) {
  const id = useId();
  const name = c.name || "Unnamed";
  const line = (
    <>
      <Initials name={name} size={24} beside />
      <span className="jov-who-words">
        <b className="jov-strong">{name}</b>
        {c.type && <span className="jov-cap">{roleWord(c.type)}</span>}
      </span>
    </>
  );
  if (!c.phone && !c.altPhone && !c.email) return <li className="jov-who">{line}</li>;
  return (
    <li>
      <button type="button" className="jov-who" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        {line}
        <Icon name="chevD" size={16} />
      </button>
      <div className="jov-reach" id={id} hidden={!open}>
        <ContactNumber value={c.phone} />
        <ContactNumber value={c.altPhone} />
        {c.email && (
          <a className="jov-mail" href={`mailto:${c.email}`}>
            {c.email}
          </a>
        )}
      </div>
    </li>
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
