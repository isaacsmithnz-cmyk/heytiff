"use client";

import type { MirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import { telHref } from "./job-sheet";

/* THE CUSTOMER'S CONTACTS, IN THE RAIL (Isaac, 2026-10-01: "contact details
   would be on the left… as if it's an office person"). Who to ring, on every
   part of the card — the Contacts section left the Summary for here, because
   "who do I ring" is asked from any page. The client's name and the site
   stay in the band above, said once.

   Both numbers, a dialable one as a tel: link and ServiceM8's free text left
   as text, the email as a mailto, the role in the account's own word, and
   the client's PO under them. */

export function JobCustomer({ detail, onEdit }: { detail: MirrorJobDetail | null; onEdit?: () => void }) {
  if (!detail || (detail.contacts.length === 0 && !detail.purchaseOrder && !onEdit)) return null;
  return (
    <section className="jcl-cust" aria-label="Customer">
      <div className="jcl-custhead">
        <h3>Contacts</h3>
        {onEdit && (
          <button type="button" className="jcl-edit" onClick={onEdit}>
            Edit
          </button>
        )}
      </div>
      {detail.contacts.length > 0 && (
        <ul className="jcl-contacts">
          {detail.contacts.map((c, i) => (
            <li key={`${c.name}-${i}`}>
              <b>{c.name || "Unnamed"}</b>
              {c.type && <em>{roleWord(c.type)}</em>}
              <ContactNumber value={c.phone} />
              <ContactNumber value={c.altPhone} />
              {c.email && (
                <a className="jcl-mail" href={`mailto:${c.email}`} title={c.email}>
                  {c.email}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {detail.purchaseOrder && (
        <p className="jcl-po">
          <em>Their PO</em>
          <b>{detail.purchaseOrder}</b>
        </p>
      )}
    </section>
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
    <a className="jcl-tel" href={href}>
      {value}
    </a>
  ) : (
    <span className="jcl-tel">{value}</span>
  );
}
