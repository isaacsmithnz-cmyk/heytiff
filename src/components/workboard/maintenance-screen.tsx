"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { WbModal } from "./wb-modal";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import type { AgreementSummary } from "@/lib/workboard/maintenance-query";
import { createAgreement } from "@/app/actions/workboard-maintenance";

/* The agreements list — every recurring service the business has promised,
   with the next due date doing the talking. Overdue rows breathe red; that
   is the whole product brief in one CSS class. */

const cadenceLabel = (months: number) =>
  months === 1 ? "Monthly" : months === 3 ? "Quarterly" : months === 6 ? "6-monthly" : months === 12 ? "Annual" : `Every ${months} months`;

export function MaintenanceScreen({
  agreements,
  manage,
  today,
}: {
  agreements: AgreementSummary[];
  manage: boolean;
  today: string;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg">
          <div className="v2head" style={{ marginBottom: 14 }}>
            <div>
              <Link href="/dashboard/workboard" className="int-back">
                <Icon name="chevL" size={15} />
                Workboard
              </Link>
              <h1 style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.03em", margin: "10px 0 0" }}>
                Maintenance
              </h1>
              <p className="int-lede" style={{ margin: "6px 0 0" }}>
                Recurring services, owned here — visits generate themselves, and nothing slips
                off the radar quietly.
              </p>
            </div>
            {manage && (
              <button className="pbtn primary" onClick={() => setCreating(true)}>
                <Icon name="plus" size={16} />
                New agreement
              </button>
            )}
          </div>

          {agreements.length === 0 ? (
            <div className="card2">
              <div className="c2h">
                <span className="ci">
                  <Icon name="rotate" size={19} />
                </span>
                <div>
                  <b>No agreements yet</b>
                  <em>
                    An agreement is a client, a site, a cadence and an onboarding story — visits
                    appear on the radar by themselves from there.
                  </em>
                </div>
              </div>
            </div>
          ) : (
            <div className="card2">
              {agreements.map((a) => (
                <Link
                  href={`/dashboard/workboard/maintenance/${a.id}`}
                  className={"wb-row" + (a.overdueCount > 0 ? " wb-pulse" : "")}
                  key={a.id}
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <span className="wb-who">
                    <b>{a.label}</b>
                    <em>
                      {" "}
                      · {a.clientName}
                      {a.siteLabel ? ` · ${a.siteLabel}` : ""}
                    </em>
                  </span>
                  <span className="wb-chip">{cadenceLabel(a.intervalMonths)}</span>
                  {a.equipmentCount > 0 && (
                    <span className="wb-chip">
                      {a.equipmentCount} unit{a.equipmentCount === 1 ? "" : "s"}
                    </span>
                  )}
                  {a.status === "paused" && <span className="wb-chip">Paused</span>}
                  {a.overdueCount > 0 ? (
                    <span className="wb-chip bad">
                      {a.overdueCount} overdue
                    </span>
                  ) : a.nextDue ? (
                    <span className={"wb-chip" + (a.nextBucket === "due_soon" ? "" : " on")}>
                      {a.nextDue === today ? "Due today" : `Next ${fmtAuWeekdayDayMonth(a.nextDue)}`}
                    </span>
                  ) : (
                    <span className="wb-chip">No visits ahead</span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {creating && (
        <NewAgreementModal
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            router.push(`/dashboard/workboard/maintenance/${id}`);
          }}
        />
      )}
    </div>
  );
}

function NewAgreementModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [clientName, setClientName] = useState("");
  const [siteLabel, setSiteLabel] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [intervalMonths, setIntervalMonths] = useState(6);
  const [anchorDate, setAnchorDate] = useState("");
  const [weInstalled, setWeInstalled] = useState(false);
  const [accessNotes, setAccessNotes] = useState("");
  const [bringList, setBringList] = useState("");
  const [siteRequirements, setSiteRequirements] = useState("");

  const submit = () => {
    setError(null);
    start(async () => {
      const res = await createAgreement({
        label,
        clientName,
        siteLabel,
        siteAddress,
        intervalMonths,
        anchorDate,
        weInstalled,
        accessNotes,
        bringList,
        siteRequirements,
      });
      if (res.ok && res.id) onCreated(res.id);
      else if (!res.ok) setError(res.error);
    });
  };

  return (
    <WbModal title="New agreement" sub="The onboarding story lives here from day one" onClose={onClose} wide>
      {error && <div className="int-note bad">{error}</div>}
      <div className="fl-grid">
        <label className="fl-f span">
          <span>
            Label<i>*</i>
          </span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Warehouse rooftop package — quarterly"
            autoFocus
          />
        </label>
        <label className="fl-f">
          <span>
            Client<i>*</i>
          </span>
          <input value={clientName} onChange={(e) => setClientName(e.target.value)} />
        </label>
        <label className="fl-f">
          <span>Site label</span>
          <input value={siteLabel} onChange={(e) => setSiteLabel(e.target.value)} />
        </label>
        <label className="fl-f span">
          <span>Site address</span>
          <input value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} />
        </label>
        <label className="fl-f">
          <span>
            How often<i>*</i>
          </span>
          <select
            className="wb-select"
            value={intervalMonths}
            onChange={(e) => setIntervalMonths(parseInt(e.target.value, 10))}
          >
            <option value={1}>Monthly</option>
            <option value={3}>Quarterly</option>
            <option value={6}>Every 6 months</option>
            <option value={12}>Annual</option>
          </select>
        </label>
        <label className="fl-f">
          <span>
            First service<i>*</i>
          </span>
          <input type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} />
        </label>
        <label className="fl-f span" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <input
            type="checkbox"
            checked={weInstalled}
            onChange={(e) => setWeInstalled(e.target.checked)}
            style={{ width: 16, height: 16 }}
          />
          <span style={{ margin: 0 }}>We did the installation</span>
        </label>
        <label className="fl-f span">
          <span>Access notes</span>
          <input
            value={accessNotes}
            onChange={(e) => setAccessNotes(e.target.value)}
            placeholder="Roof key from reception · induction at gatehouse"
          />
        </label>
        <label className="fl-f span">
          <span>Things to bring</span>
          <input
            value={bringList}
            onChange={(e) => setBringList(e.target.value)}
            placeholder="2 × 595 filters · coil cleaner · harness"
          />
        </label>
        <label className="fl-f span">
          <span>Site requirements</span>
          <input
            value={siteRequirements}
            onChange={(e) => setSiteRequirements(e.target.value)}
            placeholder="White card · closed boots · sign in at office"
          />
        </label>
      </div>
      <div className="fl-foot">
        <button className="pbtn ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          className="pbtn primary"
          onClick={submit}
          disabled={busy || !label.trim() || !clientName.trim() || !anchorDate}
        >
          {busy ? "Creating…" : "Create agreement"}
        </button>
      </div>
    </WbModal>
  );
}
