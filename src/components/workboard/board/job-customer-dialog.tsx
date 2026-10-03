"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import { mintPressId } from "@/lib/workboard/press-id";
import { CONTACT_ROLES, CUSTOMER_WORDS, type CustomerForm, type FormContact } from "@/lib/integrations/sm8-customer-plan";
import { readCustomerForEdit, saveCustomer, type CustomerSaveAnswer } from "@/app/actions/job-customer";

/* EDIT CUSTOMER — a dialog over the job card (Isaac, 2026-10-02: "editing
   the customer… pop-up modal… ServiceM8's job contact page… same
   information… lots of different site contacts… each with a role").

   The client's name and address, the job's contacts each with their role,
   and where the bills go — "Same as the site" one press away. Saving sends
   only what changed to ServiceM8; the card catches up when the mirror next
   reads the job. */

const blank = (): FormContact => ({ uuid: null, first: "", last: "", mobile: "", phone: "", email: "", type: "JOB" });

export function JobCustomerDialog({ jobUuid, onClose, onSaved }: { jobUuid: string; onClose: () => void; onSaved: (words: string) => void }) {
  const [pressId] = useState(() => mintPressId());
  const [form, setForm] = useState<CustomerForm | null>(null);
  const [siteAddress, setSiteAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void readCustomerForEdit(jobUuid).then((r) => {
      if (!live) return;
      if (!r.ok) setError(r.error);
      else {
        setForm(r.form);
        setSiteAddress(r.siteAddress);
      }
    });
    return () => {
      live = false;
    };
  }, [jobUuid]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setContact = (i: number, patch: Partial<FormContact>) =>
    setForm((f) => (f ? { ...f, contacts: f.contacts.map((c, k) => (k === i ? { ...c, ...patch } : c)) } : f));

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setError(null);
    const a: CustomerSaveAnswer = await saveCustomer(pressId, form).catch(() => ({ ok: false as const, error: CUSTOMER_WORDS.press.unqueued }));
    setBusy(false);
    if (!a.ok) {
      setError(a.error);
      return;
    }
    if (a.failed.length > 0) {
      setError(a.failed[0]!);
      return;
    }
    onSaved(a.waiting > 0 ? "Saving to ServiceM8. The card catches up within a minute." : "Saved to ServiceM8. The card catches up within a minute.");
    onClose();
  };

  return createPortal(
    <>
      <div className="wb2-scrim" onClick={onClose} />
      <div className="wb2-daymodal wb2-newmodal njob" role="dialog" aria-modal="true" aria-label="Edit customer">
        <div className="wb2-dmhd">
          <div className="wb2-dmtop">
            <h2 className="njob-title">Edit customer</h2>
            <button className="wb2-ico" onClick={onClose} title="Close" aria-label="Close">
              <Icon name="x" size={14} />
            </button>
          </div>
        </div>
        <div className="wb2-dmbody njob-body">
          {!form ? (
            error ? <p className="wb2-sherr" style={{ margin: 0 }}>{error}</p> : <p className="njob-line">Reading the customer…</p>
          ) : (
            <>
              {form.company && (
                <div className="njob-row">
                  <span className="njob-k">Customer</span>
                  <div className="njob-v">
                    <input className="wb2-fi" value={form.company.name} onChange={(e) => setForm({ ...form, company: { ...form.company!, name: e.target.value } })} aria-label="Customer name" />
                    <textarea className="wb2-fi njob-addr" value={form.company.address} onChange={(e) => setForm({ ...form, company: { ...form.company!, address: e.target.value } })} aria-label="Customer address" placeholder="Their address" />
                  </div>
                </div>
              )}

              <div className="njob-row">
                <span className="njob-k">Contacts</span>
                <div className="njob-v">
                  {form.contacts.map((c, i) => (
                    <fieldset className="ncust-contact" key={c.uuid ?? `new-${i}`} aria-label={`Contact ${i + 1}`}>
                      <div className="njob-two">
                        <input className="wb2-fi" value={c.first} onChange={(e) => setContact(i, { first: e.target.value })} placeholder="First name" aria-label="First name" />
                        <input className="wb2-fi" value={c.last} onChange={(e) => setContact(i, { last: e.target.value })} placeholder="Last name" aria-label="Last name" />
                        <input className="wb2-fi" value={c.mobile} onChange={(e) => setContact(i, { mobile: e.target.value })} placeholder="Mobile" aria-label="Mobile" inputMode="tel" />
                        <input className="wb2-fi" value={c.email} onChange={(e) => setContact(i, { email: e.target.value })} placeholder="Email" aria-label="Email" inputMode="email" />
                      </div>
                      <div className="njob-chips" role="radiogroup" aria-label="Role">
                        {CONTACT_ROLES.map((r) => (
                          <button key={r.type} type="button" role="radio" aria-checked={c.type === r.type} className={"wb2-filter" + (c.type === r.type ? " on" : "")} onClick={() => setContact(i, { type: r.type })}>
                            {r.word}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="njob-link ncust-remove"
                          onClick={() => setForm({ ...form, contacts: form.contacts.filter((_, k) => k !== i) })}
                        >
                          Remove
                        </button>
                      </div>
                    </fieldset>
                  ))}
                  <button type="button" className="pbtn ghost" onClick={() => setForm({ ...form, contacts: [...form.contacts, blank()] })}>
                    <Icon name="plus" size={15} />
                    Add a contact
                  </button>
                </div>
              </div>

              {form.billingAddress !== null && (
                <div className="njob-row">
                  <span className="njob-k">Bills go to</span>
                  <div className="njob-v">
                    <textarea className="wb2-fi njob-addr" value={form.billingAddress} onChange={(e) => setForm({ ...form, billingAddress: e.target.value })} aria-label="Billing address" placeholder="Billing address" />
                    {siteAddress && form.billingAddress.trim() !== siteAddress.trim() && (
                      <button type="button" className="njob-link" onClick={() => setForm({ ...form, billingAddress: siteAddress })}>
                        Same as the site
                      </button>
                    )}
                  </div>
                </div>
              )}
              {error && <p className="wb2-sherr" style={{ margin: 0 }}>{error}</p>}
            </>
          )}
        </div>
        <div className="wb2-dmft">
          <button className="pbtn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="pbtn" disabled={!form || busy} onClick={() => void save()}>
            {busy ? "Saving to ServiceM8…" : "Save to ServiceM8"}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
