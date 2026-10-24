"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/parts/button";
import { Chooser } from "@/components/parts/chooser";
import { Dialog } from "@/components/parts/dialog";
import { Field, TextArea, TextInput } from "@/components/parts/field";
import { mintPressId } from "@/lib/workboard/press-id";
import { CONTACT_ROLES, CUSTOMER_WORDS, type CustomerForm, type FormContact } from "@/lib/integrations/sm8-customer-plan";
import { readCustomerForEdit, saveCustomer, type CustomerSaveAnswer } from "@/app/actions/job-customer";

/* EDIT CUSTOMER — a dialog over the job page (Isaac, 2026-10-02: "editing
   the customer… pop-up modal… ServiceM8's job contact page… same
   information… lots of different site contacts… each with a role").

   The client's name and address, the job's contacts each with their role,
   and where the bills go — "Same as the site" one press away. Saving sends
   only what changed to ServiceM8; the page catches up when the mirror next
   reads the job.

   The v2 dialog (Isaac, 25 October 2026): fields with their labels above,
   each contact a card, and the six role chips one Role chooser. */

const blank = (): FormContact => ({ uuid: null, first: "", last: "", mobile: "", phone: "", email: "", type: "JOB" });
const ROLES = CONTACT_ROLES.map((r) => ({ value: r.type as string, label: r.word as string }));

export function JobCustomerDialog({ jobUuid, onClose, onSaved }: { jobUuid: string; onClose: () => void; onSaved: (words: string) => void }) {
  const [pressId] = useState(() => mintPressId());
  const [form, setForm] = useState<CustomerForm | null>(null);
  const [siteAddress, setSiteAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /* decided once, from what ServiceM8 holds, so typing never swaps the field under the cursor */
  const [multiline, setMultiline] = useState(false);

  useEffect(() => {
    let live = true;
    void readCustomerForEdit(jobUuid).then((r) => {
      if (!live) return;
      if (!r.ok) setError(r.error);
      else {
        setForm(r.form);
        setSiteAddress(r.siteAddress);
        setMultiline(!!r.form.company?.address.includes("\n"));
      }
    });
    return () => {
      live = false;
    };
  }, [jobUuid]);

  const setAddress = (address: string) => setForm((f) => (f?.company ? { ...f, company: { ...f.company, address } } : f));
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

  /* Escape and the scrim close this and only this: the page under it stays open. */
  return (
    <Dialog
      heading="Edit customer"
      width={560}
      onClose={onClose}
      foot={
        <>
          <Button kind="second" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="main" disabled={!form || busy} onClick={() => void save()}>
            {busy ? "Saving to ServiceM8" : "Save to ServiceM8"}
          </Button>
        </>
      }
    >
      {!form ? (
        error ? <p className="ecust-wrong">{error}</p> : <p className="ecust-note">Reading the customer</p>
      ) : (
        <div className="ecust">
          {form.company && (
            <>
              <Field label="Customer">
                <TextInput value={form.company.name} onChange={(e) => setForm({ ...form, company: { ...form.company!, name: e.target.value } })} />
              </Field>
              <Field label="Address">
                {/* one line, as a field, unless ServiceM8 holds the address over several */}
                {multiline ? (
                  <TextArea rows={2} value={form.company.address} placeholder="Their address" onChange={(e) => setAddress(e.target.value)} />
                ) : (
                  <TextInput value={form.company.address} placeholder="Their address" onChange={(e) => setAddress(e.target.value)} />
                )}
              </Field>
            </>
          )}

          <section className="ecust-grp" aria-labelledby="ecust-contacts">
            <h3 className="ecust-gt" id="ecust-contacts">
              Contacts
            </h3>
            {form.contacts.map((c, i) => (
              <fieldset className="ecust-contact" key={c.uuid ?? `new-${i}`} aria-label={`Contact ${i + 1}`}>
                <div className="ecust-two">
                  <Field label="First name">
                    <TextInput value={c.first} onChange={(e) => setContact(i, { first: e.target.value })} />
                  </Field>
                  <Field label="Last name">
                    <TextInput value={c.last} onChange={(e) => setContact(i, { last: e.target.value })} />
                  </Field>
                  <Field label="Mobile">
                    <TextInput value={c.mobile} inputMode="tel" onChange={(e) => setContact(i, { mobile: e.target.value })} />
                  </Field>
                  <Field label="Email">
                    <TextInput value={c.email} inputMode="email" onChange={(e) => setContact(i, { email: e.target.value })} />
                  </Field>
                </div>
                <div className="ecust-role">
                  <Field label="Role">
                    <Chooser value={c.type} options={ROLES} placeholder="Choose a role" onChange={(type) => setContact(i, { type })} />
                  </Field>
                  <Button kind="delete" onClick={() => setForm({ ...form, contacts: form.contacts.filter((_, k) => k !== i) })}>
                    Remove contact
                  </Button>
                </div>
              </fieldset>
            ))}
            <Button kind="second" className="ecust-add" onClick={() => setForm({ ...form, contacts: [...form.contacts, blank()] })}>
              Add a contact
            </Button>
          </section>

          {form.billingAddress !== null && (
            <div className="ecust-bills">
              <Field label="Bills go to">
                <TextArea rows={2} value={form.billingAddress} placeholder="Billing address" onChange={(e) => setForm({ ...form, billingAddress: e.target.value })} />
              </Field>
              {siteAddress && form.billingAddress.trim() !== siteAddress.trim() && (
                <button type="button" className="ecust-same" onClick={() => setForm({ ...form, billingAddress: siteAddress })}>
                  Same as the site
                </button>
              )}
            </div>
          )}
          {error && <p className="ecust-wrong">{error}</p>}
        </div>
      )}
    </Dialog>
  );
}
