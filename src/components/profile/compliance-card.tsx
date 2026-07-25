"use client";

import { useState } from "react";
import { Icon } from "@/components/shell/icon";
import { CredentialCard } from "@/components/cards/credential-card";
import { buildLicenceRow, licenceStatus } from "@/lib/staff/licence";
import { formatAuDate } from "@/lib/staff/profile";
import type { StaffLicence } from "@/lib/staff/types";
import { DateField } from "./fields";
import type { LicenceInput, SaveResult } from "./types";

/* Compliance — the licences and tickets, as a wall of credential cards.

   This card has no read/edit cycle: adding and removing are the edit. It also
   no longer calls router.refresh() after a write — every one of these actions
   revalidates the two paths that render this screen, so the RSC payload that
   comes back with the action result already carries the new list. The explicit
   refresh was a second round trip that did the same job, later. */

export type LicType = { name: string; sub?: string; color?: string };

export const LIC_TYPES: LicType[] = [
  { name: "Driver’s licence", sub: "State driver licence", color: "#2E68FF" },
  { name: "ARC licence", sub: "Refrigerant handling", color: "#00A389" },
  { name: "White card", sub: "Construction induction", color: "#8A2BE2" },
  { name: "Contractor licence", sub: "Trade contractor", color: "#F0A431" },
];

const CUSTOM = "__custom";

export function ComplianceCard({
  licences,
  today,
  onAdd,
  onRemove,
}: {
  licences: StaffLicence[];
  today: string;
  onAdd: (input: LicenceInput) => Promise<SaveResult>;
  onRemove: (licenceId: string) => Promise<SaveResult>;
}) {
  const [type, setType] = useState("");
  const [custom, setCustom] = useState("");
  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const typeName = type === CUSTOM ? custom.trim() : type;

  const add = async () => {
    const color = type === CUSTOM ? "" : (LIC_TYPES.find((t) => t.name === type)?.color ?? "");
    const input: LicenceInput = { typeName, licenceNumber: number, expiryDate: expiry, color };
    // the same pure validator the action runs — a bad date never leaves here
    const built = buildLicenceRow(input);
    if ("error" in built) {
      setError(built.error);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await onAdd(input);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setType("");
      setCustom("");
      setNumber("");
      setExpiry("");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setError(null);
    setRemovingId(id);
    try {
      const res = await onRemove(id);
      if (!res.ok) setError(res.error);
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="card2" data-live>
      <div className="c2h">
        <span className="ci">
          <Icon name="shield" size={18} />
        </span>
        <span>
          <b>Compliance</b>
          <em>
            Licences &amp; tickets — each one tracks its number and expiry, and warns on your
            dashboard before it lapses
          </em>
        </span>
      </div>

      <div className="licadd">
        {type === CUSTOM ? (
          <input
            className="inp"
            style={{ flex: 1, minWidth: 0 }}
            placeholder="Name this licence / ticket…"
            value={custom}
            autoFocus
            onChange={(e) => setCustom(e.target.value)}
          />
        ) : (
          <div className="selwrap" style={{ flex: 1, minWidth: 0 }}>
            <select
              className="inp"
              aria-label="Licence type"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="" disabled>
                Choose a licence to add…
              </option>
              {LIC_TYPES.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
              <option value={CUSTOM}>Custom…</option>
            </select>
            <span className="chev">
              <Icon name="chevD" size={16} />
            </span>
          </div>
        )}
      </div>
      <div className="licadd" style={{ marginTop: 10 }}>
        <input
          className="inp"
          style={{ flex: 1, minWidth: 0 }}
          placeholder="Licence number (optional)"
          aria-label="Licence number"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
        />
        {/* picked, not typed — like every other date in the app. The label is
            explicit because a bare calendar in a row of text boxes doesn't say
            what it is for. */}
        <label className="licexp">
          <span>Expiry</span>
          <DateField name="lic-expiry" value={expiry} onChange={setExpiry} today={today} />
        </label>
        <button
          className="pbtn primary"
          type="button"
          style={{ height: 46, flex: "0 0 auto" }}
          disabled={busy}
          onClick={add}
        >
          <Icon name="plus" size={16} />
          Add
        </button>
      </div>
      {error && <div className="carderr">{error}</div>}

      {licences.length > 0 ? (
        <div className="credgrid">
          {licences.map((l) => (
            <CredentialCard
              key={l.id}
              typeName={l.typeName}
              licenceNumber={l.licenceNumber}
              expiry={l.expiryDate ? formatAuDate(l.expiryDate) : null}
              status={licenceStatus(l.expiryDate, today)}
              removing={removingId === l.id}
              onRemove={() => remove(l.id)}
            />
          ))}
        </div>
      ) : (
        <div className="ro-empty" style={{ marginTop: 18 }}>
          <span className="ei">
            <Icon name="shield" size={20} />
          </span>
          <b>No licences added yet</b>
          <em>
            Pick a type (or name a custom one), add a number and expiry, and it tracks here — and
            raises a reminder on your dashboard before it lapses.
          </em>
        </div>
      )}
    </div>
  );
}
