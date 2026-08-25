"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import { DateField, Field, Seg, TextInput } from "@/components/profile/fields";
import { dateInputValue } from "@/lib/au-dates";
import {
  buildOrgCredentialRow,
  credSuggestions,
  defaultColorFor,
  type OrgCredKind,
  type OrgCredential,
  type OrgCredentialInput,
} from "@/lib/org/credentials";
import type { CredResult } from "./types";
import { withCleanup } from "@/lib/ui/with-cleanup";

/* Adding or editing one of the business's licences / policies.

   PORTALLED TO <body>, and that is not a preference. The shell keeps
   `will-change` on `.page.in`, which makes it a containing block for
   position:fixed — a modal rendered inside the page would be anchored to the
   page instead of the viewport and land halfway down the scroll. The `.fg`
   wrapper is display:contents so it generates no box of its own while still
   carrying the design tokens and the `.fg .inp` / `.fg .field` styles down to
   the fields inside. Same pattern as the pay-settings modal.

   It runs buildOrgCredentialRow — the very validator the action runs — before
   it calls anything, so an impossible date is answered here rather than after a
   round trip. */

const KIND_LABELS: Record<OrgCredKind, string> = {
  licence: "Licence",
  insurance: "Insurance",
};
const LABEL_KINDS: Record<string, OrgCredKind> = { Licence: "licence", Insurance: "insurance" };

/* The only cosmetic choice on offer. "Auto" is the default and means "whatever
   this type is usually coloured" — picked up from the registry on save, so ARC
   is teal and a policy is blue without anyone choosing. */
const SWATCHES: { label: string; value: string }[] = [
  { label: "Auto", value: "" },
  { label: "Teal", value: "#00A389" },
  { label: "Blue", value: "#2E68FF" },
  { label: "Amber", value: "#F0A431" },
  { label: "Violet", value: "#8A2BE2" },
  { label: "Red", value: "#e0264f" },
];

export function OrgCredentialModal({
  credential,
  onSave,
  onDelete,
  onClose,
  today,
}: {
  /** null = adding a new one */
  credential: OrgCredential | null;
  /** the server's AU day, anchoring the expiry picker */
  today?: string;
  onSave: (input: OrgCredentialInput) => Promise<CredResult>;
  /** edit mode only */
  onDelete?: () => Promise<CredResult>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<OrgCredKind>(credential?.kind ?? "licence");
  const [name, setName] = useState(credential?.name ?? "");
  const [number, setNumber] = useState(credential?.number ?? "");
  const [issuer, setIssuer] = useState(credential?.issuer ?? "");
  const [expiry, setExpiry] = useState(dateInputValue(credential?.expiryDate));
  const [color, setColor] = useState(credential?.color ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);

  const editing = credential !== null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const input = (): OrgCredentialInput => ({
    kind,
    name,
    number,
    issuer,
    expiryDate: expiry,
    // an unpicked colour is the type's own — the registry decides, not the form
    color: color || defaultColorFor(kind, name),
  });

  const save = async () => {
    const built = buildOrgCredentialRow(input());
    if ("error" in built) {
      setError(built.error);
      return;
    }
    setError(null);
    setBusy(true);
    await withCleanup(async () => {
      const res = await onSave(input());
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onClose();
    }, () => setBusy(false));
  };

  const remove = async () => {
    if (!onDelete) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    await withCleanup(async () => {
      const res = await onDelete();
      if (!res.ok) {
        setError(res.error);
        setArmed(false);
        return;
      }
      onClose();
    }, () => setBusy(false));
  };

  return createPortal(
    <div className="fg" style={{ display: "contents" }}>
      <div className="fl-ov" onClick={onClose}>
        <div
          className="fl-modal"
          role="dialog"
          aria-modal="true"
          aria-label={editing ? "Edit licence or insurance" : "Add licence or insurance"}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="fl-mh">
            <div>
              <b>{editing ? "Edit" : "Add licence or insurance"}</b>
              <em>What lets the business trade — tracked to its expiry</em>
            </div>
            <button className="fl-x" type="button" aria-label="Close" onClick={onClose}>
              <Icon name="x" size={18} />
            </button>
          </div>

          <div className="fl-mb">
            <div className="frow">
              <Field label="Type">
                <Seg
                  value={KIND_LABELS[kind]}
                  options={["Licence", "Insurance"]}
                  onChange={(v) => setKind(LABEL_KINDS[v] ?? "licence")}
                />
              </Field>
            </div>
            <div className="frow" style={{ marginTop: 18 }}>
              <Field label="Name" req>
                <TextInput
                  name="cred-name"
                  placeholder={
                    kind === "insurance" ? "e.g. Public liability" : "e.g. Contractor licence"
                  }
                  value={name}
                  suggestions={credSuggestions(kind)}
                  onChange={setName}
                />
              </Field>
            </div>
            <div className="frow c2" style={{ marginTop: 18 }}>
              <Field label="Number">
                <TextInput
                  name="cred-number"
                  placeholder={kind === "insurance" ? "Policy number" : "Licence number"}
                  value={number}
                  onChange={setNumber}
                />
              </Field>
              <Field label={kind === "insurance" ? "Insurer" : "Issued by"}>
                <TextInput
                  name="cred-issuer"
                  placeholder={kind === "insurance" ? "e.g. QBE" : "e.g. VBA"}
                  value={issuer}
                  onChange={setIssuer}
                />
              </Field>
            </div>
            <div className="frow c2" style={{ marginTop: 18 }}>
              {/* picked, never typed — like every date in this app */}
              <Field label="Expiry">
                <DateField name="cred-expiry" value={expiry} onChange={setExpiry} today={today} />
              </Field>
              <Field label="Colour">
                <div className="oc-sw" role="group" aria-label="Colour">
                  {SWATCHES.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      className={`oc-swb${color === s.value ? " on" : ""}${s.value ? "" : " auto"}`}
                      style={s.value ? { background: s.value } : undefined}
                      aria-label={s.label}
                      aria-pressed={color === s.value}
                      onClick={() => setColor(s.value)}
                    />
                  ))}
                </div>
              </Field>
            </div>

            {error && <div className="carderr">{error}</div>}

            <div className="fl-foot">
              {editing && onDelete && (
                <button
                  className={`fl-btn danger${armed ? " arm" : ""}`}
                  type="button"
                  style={{ marginRight: "auto" }}
                  disabled={busy}
                  onClick={remove}
                >
                  {armed ? "Tap again to delete" : "Delete"}
                </button>
              )}
              <button className="fl-btn ghost" type="button" onClick={onClose}>
                Cancel
              </button>
              <button className="fl-btn primary" type="button" disabled={busy} onClick={save}>
                <Icon name="check" size={15} />
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
