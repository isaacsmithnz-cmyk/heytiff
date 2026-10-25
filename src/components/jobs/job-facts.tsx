"use client";

import { useId, type ReactNode } from "react";
import { Button } from "@/components/parts/button";
import { Initials } from "@/components/parts/initials";
import { StateWord } from "@/components/parts/state";
import type { NextVisit } from "@/lib/jobs/job-conversation";
import type { MirrorJobDetail } from "@/lib/workboard/all-jobs-query";

/* THE STRIP OF FACTS, UNDER THE STAGES LINE (Isaac, 25 October 2026, "Yes,
   build the refined Overview A"): one box with the card's corner and the
   edge's colour, its cells split by hairlines, each under a 12/500 grey
   label.

     Site        the job's number in bold, then its address as written;
                 their PO under it, where they gave one
     Contact     who to ring: a disc, the name in bold, the role grey and
                 the numbers underlined to ring; Edit at the label's right
                 where saving customers is on
     Next visit  the next booked visit, or Nothing booked and Book a visit,
                 the one blue button (the Visit form's door, rule 52)
     Money       the figure at 20 with where collection stands under it in
                 its word's colour; only for whoever sees money, else the
                 strip has three cells

   A cell with a tab behind it opens it from anywhere on it (Next visit to
   Visits, Money to Billing): its name is the button and stretches over the
   cell, and its own buttons still press on their own. The customer column
   that stood under the tiles came into Site and Contact. */

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

function Fact({
  label,
  onOpen,
  aside,
  className,
  children,
}: {
  label: string;
  /** Opens the tab behind the cell, from anywhere on it. */
  onOpen?: () => void;
  /** At the label's right: Contact's Edit. */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className={["jov-fact", onOpen ? "jov-fact--door" : "", className ?? ""].filter(Boolean).join(" ")} aria-labelledby={id}>
      <div className="jov-lab">
        {onOpen ? (
          <button type="button" className="jov-open" id={id} onClick={onOpen}>
            {label}
          </button>
        ) : (
          <span id={id}>{label}</span>
        )}
        {aside}
      </div>
      {children}
    </section>
  );
}

export function JobFacts({
  detail,
  next,
  nextRead,
  onVisits,
  onBook,
  money,
  onMoney,
  onEditContact,
}: {
  detail: MirrorJobDetail | null;
  next: NextVisit | null;
  /** The visits have been read (no next visit means none, not not-yet). */
  nextRead: boolean;
  onVisits: () => void;
  /** Book a visit, where the reader may book. */
  onBook?: () => void;
  /** The Money cell's insides; absent for whoever doesn't see money. */
  money?: ReactNode;
  onMoney?: () => void;
  /** Edit, where saving customers to ServiceM8 is on for this reader. */
  onEditContact?: () => void;
}) {
  const where = detail ? (detail.address ?? "").trim() || detail.geoLine || detail.suburb || "" : "";
  const contacts = detail?.contacts ?? [];
  const withMoney = money !== undefined;
  return (
    <div className={`jov-facts${withMoney ? "" : " jov-facts--3"}`} role="group" aria-label="The job's facts">
      <Fact label="Site">
        {!detail ? (
          <p className="jov-cap">Reading the job</p>
        ) : (
          <>
            {detail.jobNumber && <b className="jov-strong">Job {detail.jobNumber}</b>}
            {where && <p className="jov-addr">{where}</p>}
            {!detail.jobNumber && !where && <p className="jov-cap">No address on the job</p>}
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
        className="jov-fact--contact"
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

      {withMoney && (
        <Fact label="Money" onOpen={onMoney}>
          {money}
        </Fact>
      )}
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
