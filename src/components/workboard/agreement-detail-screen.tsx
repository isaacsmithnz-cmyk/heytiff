"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { WbModal } from "./wb-modal";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { READINESS_KEYS, type ReadinessKey } from "@/lib/workboard/visit-schedule";
import type { AgreementDetail, VisitView } from "@/lib/workboard/maintenance-query";
import type { JobSearchHit } from "@/lib/workboard/projects-query";
import { searchJobs } from "@/app/actions/workboard";
import {
  addAgreementEquipment,
  linkVisitJob,
  removeAgreementEquipment,
  setAgreementStatus,
  setVisitReadiness,
  setVisitStatus,
  unlinkVisitJob,
  updateAgreementMeta,
  updateAgreementSchedule,
} from "@/app/actions/workboard-maintenance";

/* One agreement, whole story: the onboarding panel a tech reads the night
   before, the gear on the roof, and the visit timeline where the readiness
   chips live. Overdue visits breathe red (.wb-pulse); a linked job that went
   sideways in ServiceM8 gets a warning chip and a human decides. */

const READINESS_LABEL: Record<ReadinessKey, string> = {
  access_confirmed: "Access",
  time_confirmed: "Time",
  parts_ready: "Parts",
  customer_notified: "Customer told",
};

const cadenceLabel = (months: number) =>
  months === 1 ? "Monthly" : months === 3 ? "Quarterly" : months === 6 ? "6-monthly" : months === 12 ? "Annual" : `Every ${months} months`;

export function AgreementDetailScreen({
  agreement,
  manage,
  today,
  sm8Connected,
}: {
  agreement: AgreementDetail;
  manage: boolean;
  today: string;
  sm8Connected: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [addingEquip, setAddingEquip] = useState(false);
  const [linkingVisit, setLinkingVisit] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok && res.error) setError(res.error);
      router.refresh();
    });
  };

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg">
          <div className="v2head" style={{ marginBottom: 14 }}>
            <div style={{ minWidth: 0 }}>
              <Link href="/dashboard/workboard/maintenance" className="int-back">
                <Icon name="chevL" size={15} />
                Maintenance
              </Link>
              <h1 style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.03em", margin: "10px 0 0" }}>
                {agreement.label}
              </h1>
              <p className="int-lede" style={{ margin: "6px 0 0" }}>
                {[agreement.clientName, agreement.siteLabel, agreement.siteAddress]
                  .filter(Boolean)
                  .join(" · ")}
                {" · "}
                {cadenceLabel(agreement.intervalMonths)}
              </p>
            </div>
            {manage && (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select
                  className="wb-select"
                  value={agreement.status}
                  onChange={(e) => run(() => setAgreementStatus(agreement.id, e.target.value))}
                  disabled={busy}
                >
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="ended">Ended</option>
                </select>
                <button className="pbtn ghost" onClick={() => setEditing(true)}>
                  <Icon name="edit" size={15} />
                  Edit
                </button>
              </div>
            )}
          </div>

          {error && <div className="int-note bad">{error}</div>}
          {agreement.status !== "active" && (
            <div className="int-note bad">
              This agreement is {agreement.status} — its visits stay off the radar until it&apos;s
              active again.
            </div>
          )}

          {/* ── onboarding ── */}
          <div className="card2">
            <div className="c2h">
              <span className="ci">
                <Icon name="compass" size={19} />
              </span>
              <div>
                <b>Before the day</b>
                <em>The onboarding story — what a tech reads the night before.</em>
              </div>
              {agreement.weInstalled && <span className="wb-chip on" style={{ marginLeft: "auto" }}>Our install</span>}
            </div>
            <dl className="int-facts">
              <div>
                <dt>Access</dt>
                <dd>{agreement.accessNotes ?? "—"}</dd>
              </div>
              <div>
                <dt>Bring</dt>
                <dd>{agreement.bringList ?? "—"}</dd>
              </div>
              <div>
                <dt>Site requirements</dt>
                <dd>{agreement.siteRequirements ?? "—"}</dd>
              </div>
              {agreement.notes && (
                <div>
                  <dt>Notes</dt>
                  <dd>{agreement.notes}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* ── equipment ── */}
          <div className="card2">
            <div className="c2h">
              <span className="ci">
                <Icon name="box" size={19} />
              </span>
              <div>
                <b>Equipment at this site</b>
                <em>What each visit works through.</em>
              </div>
              {manage && (
                <button className="pbtn ghost" style={{ marginLeft: "auto" }} onClick={() => setAddingEquip(true)}>
                  <Icon name="plus" size={15} />
                  Add
                </button>
              )}
            </div>
            {agreement.equipment.length === 0 ? (
              <p className="int-hint">Nothing listed yet — the first visit usually fills this in.</p>
            ) : (
              agreement.equipment.map((e) => (
                <div className="wb-row" key={e.id}>
                  <span className="wb-who">
                    <b>{e.description}</b>
                    {(e.model || e.serial) && (
                      <em> · {[e.model, e.serial && `s/n ${e.serial}`].filter(Boolean).join(" · ")}</em>
                    )}
                    {e.location && <em> · {e.location}</em>}
                  </span>
                  {e.installProjectId && (
                    <Link
                      className="wb-chip on"
                      href={`/dashboard/workboard/projects/${e.installProjectId}`}
                      title="The install project"
                    >
                      {e.installProjectName ?? "Install project"}
                    </Link>
                  )}
                  {manage && (
                    <button
                      className="fl-x"
                      aria-label="Remove equipment"
                      disabled={busy}
                      onClick={() => run(() => removeAgreementEquipment(e.id))}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {/* ── visits ── */}
          <div className="card2">
            <div className="c2h">
              <span className="ci">
                <Icon name="rotate" size={19} />
              </span>
              <div>
                <b>Visits</b>
                <em>Generated from the cadence — tick the chips as the day gets real.</em>
              </div>
            </div>
            {agreement.open.length === 0 ? (
              <p className="int-hint">Nothing ahead — check the cadence or the contract end.</p>
            ) : (
              agreement.open.map((v) => (
                <VisitRow
                  key={v.id}
                  visit={v}
                  manage={manage}
                  busy={busy}
                  today={today}
                  onReadiness={(key, val) => run(() => setVisitReadiness(v.id, key, val))}
                  onStatus={(status) => run(() => setVisitStatus(v.id, status))}
                  onLink={() => setLinkingVisit(v.id)}
                  onUnlink={() => run(() => unlinkVisitJob(v.id))}
                />
              ))
            )}

            {agreement.history.length > 0 && (
              <>
                <button className="pbtn ghost" style={{ marginTop: 10 }} onClick={() => setShowHistory((s) => !s)}>
                  {showHistory ? "Hide history" : `History (${agreement.history.length})`}
                </button>
                {showHistory &&
                  agreement.history.map((v) => (
                    <div className="wb-row" key={v.id} style={{ opacity: 0.65 }}>
                      <span className="wb-time">{fmtAuWeekdayDayMonth(v.dueDate)}</span>
                      <span className="wb-chip">{v.status}</span>
                      {v.jobNumber && <span className="wb-chip">#{v.jobNumber}</span>}
                      <span className="wb-who">
                        {v.completedAt && (
                          <em>
                            {v.status === "done" ? "Done" : "Closed"} {fmtAuWeekdayDayMonth(v.completedAt)}
                            {v.completedSource === "servicem8" ? " — from ServiceM8" : ""}
                          </em>
                        )}
                      </span>
                    </div>
                  ))}
              </>
            )}
          </div>
        </div>
      </div>

      {editing && (
        <EditAgreementModal
          agreement={agreement}
          onClose={() => setEditing(false)}
          onSaveMeta={(patch) => {
            setEditing(false);
            run(() => updateAgreementMeta(agreement.id, patch));
          }}
          onSaveSchedule={(sched) => {
            setEditing(false);
            run(() => updateAgreementSchedule(agreement.id, sched));
          }}
        />
      )}
      {addingEquip && (
        <AddEquipModal
          onClose={() => setAddingEquip(false)}
          onAdd={(input) => {
            setAddingEquip(false);
            run(() => addAgreementEquipment(agreement.id, input));
          }}
        />
      )}
      {linkingVisit && (
        <LinkJobModal
          sm8Connected={sm8Connected}
          onClose={() => setLinkingVisit(null)}
          onLink={(input) => {
            const id = linkingVisit;
            setLinkingVisit(null);
            run(() => linkVisitJob(id, input));
          }}
        />
      )}
    </div>
  );
}

/* ── rows & modals ── */

function VisitRow({
  visit,
  manage,
  busy,
  today,
  onReadiness,
  onStatus,
  onLink,
  onUnlink,
}: {
  visit: VisitView;
  manage: boolean;
  busy: boolean;
  today: string;
  onReadiness: (key: ReadinessKey, value: boolean) => void;
  onStatus: (status: string) => void;
  onLink: () => void;
  onUnlink: () => void;
}) {
  const overdue = visit.bucket === "overdue";
  return (
    <div className={"wb-visit" + (overdue ? " wb-pulse" : "")}>
      <div className="wb-row" style={{ paddingBottom: 4 }}>
        <span className={"wb-chip" + (overdue ? " bad" : visit.bucket === "due_soon" ? "" : " on")}>
          {visit.dueDate === today
            ? "Due today"
            : overdue
              ? `Overdue — ${fmtAuWeekdayDayMonth(visit.dueDate)}`
              : fmtAuWeekdayDayMonth(visit.dueDate)}
        </span>
        {visit.status === "booked" && <span className="wb-chip on">Booked</span>}
        {visit.jobNumber ? (
          <span className="wb-chip">
            #{visit.jobNumber}
            {visit.mirrorStatus ? ` · ${visit.mirrorStatus}` : ""}
          </span>
        ) : null}
        {visit.warn && (
          <span className="wb-chip bad" title="The linked ServiceM8 job was cancelled or deleted — decide what happens to this visit.">
            Job went sideways
          </span>
        )}
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {manage &&
            (visit.jobNumber ? (
              <button className="pbtn ghost" disabled={busy} onClick={onUnlink}>
                Unlink job
              </button>
            ) : (
              <button className="pbtn ghost" disabled={busy} onClick={onLink}>
                Link job
              </button>
            ))}
          {manage && (
            <select
              className="wb-select"
              value={visit.status}
              disabled={busy}
              onChange={(e) => onStatus(e.target.value)}
            >
              <option value="upcoming">Upcoming</option>
              <option value="booked">Booked</option>
              <option value="done">Done</option>
              <option value="skipped">Skipped</option>
            </select>
          )}
        </span>
      </div>
      <div className="wb-row" style={{ paddingTop: 0 }}>
        {READINESS_KEYS.map((key) => {
          const on = visit.readiness[key];
          return (
            <button
              key={key}
              className={"wb-chip" + (on ? " on" : "")}
              disabled={busy}
              onClick={() => onReadiness(key, !on)}
              title={on ? "Tap to untick" : "Tap when it's sorted"}
            >
              {READINESS_LABEL[key]}
              {on ? " ✓" : ""}
            </button>
          );
        })}
        {visit.notes && (
          <span className="wb-projsub" style={{ marginLeft: 6 }}>
            {visit.notes}
          </span>
        )}
      </div>
    </div>
  );
}

function EditAgreementModal({
  agreement,
  onClose,
  onSaveMeta,
  onSaveSchedule,
}: {
  agreement: AgreementDetail;
  onClose: () => void;
  onSaveMeta: (patch: {
    label?: string;
    clientName?: string;
    siteLabel?: string | null;
    siteAddress?: string | null;
    weInstalled?: boolean;
    accessNotes?: string | null;
    bringList?: string | null;
    siteRequirements?: string | null;
    notes?: string | null;
  }) => void;
  onSaveSchedule: (sched: { intervalMonths: number; anchorDate: string; contractEnd?: string | null }) => void;
}) {
  const [label, setLabel] = useState(agreement.label);
  const [clientName, setClientName] = useState(agreement.clientName);
  const [siteLabel, setSiteLabel] = useState(agreement.siteLabel ?? "");
  const [siteAddress, setSiteAddress] = useState(agreement.siteAddress ?? "");
  const [weInstalled, setWeInstalled] = useState(agreement.weInstalled);
  const [accessNotes, setAccessNotes] = useState(agreement.accessNotes ?? "");
  const [bringList, setBringList] = useState(agreement.bringList ?? "");
  const [siteRequirements, setSiteRequirements] = useState(agreement.siteRequirements ?? "");
  const [notes, setNotes] = useState(agreement.notes ?? "");
  const [intervalMonths, setIntervalMonths] = useState(agreement.intervalMonths);
  const [anchorDate, setAnchorDate] = useState(agreement.anchorDate);
  const [contractEnd, setContractEnd] = useState(agreement.contractEnd ?? "");

  const scheduleChanged =
    intervalMonths !== agreement.intervalMonths ||
    anchorDate !== agreement.anchorDate ||
    (contractEnd || null) !== agreement.contractEnd;

  return (
    <WbModal title="Edit agreement" onClose={onClose} wide>
      <div className="fl-grid">
        <label className="fl-f span">
          <span>
            Label<i>*</i>
          </span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
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
          <input value={accessNotes} onChange={(e) => setAccessNotes(e.target.value)} />
        </label>
        <label className="fl-f span">
          <span>Things to bring</span>
          <input value={bringList} onChange={(e) => setBringList(e.target.value)} />
        </label>
        <label className="fl-f span">
          <span>Site requirements</span>
          <input value={siteRequirements} onChange={(e) => setSiteRequirements(e.target.value)} />
        </label>
        <label className="fl-f span">
          <span>Notes</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <label className="fl-f">
          <span>How often</span>
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
          <span>Anchor date</span>
          <input type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} />
        </label>
        <label className="fl-f">
          <span>Contract end</span>
          <input type="date" value={contractEnd} onChange={(e) => setContractEnd(e.target.value)} />
        </label>
      </div>
      {scheduleChanged && (
        <p className="int-hint">
          Changing the cadence redraws only untouched future visits — anything booked, linked,
          ticked or noted stays exactly where it is.
        </p>
      )}
      <div className="fl-foot">
        <button className="pbtn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="pbtn primary"
          disabled={!label.trim() || !clientName.trim() || !anchorDate}
          onClick={() => {
            onSaveMeta({
              label,
              clientName,
              siteLabel,
              siteAddress,
              weInstalled,
              accessNotes,
              bringList,
              siteRequirements,
              notes,
            });
            if (scheduleChanged) {
              onSaveSchedule({ intervalMonths, anchorDate, contractEnd: contractEnd || null });
            }
          }}
        >
          Save
        </button>
      </div>
    </WbModal>
  );
}

function AddEquipModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (input: { description: string; model?: string; serial?: string; location?: string }) => void;
}) {
  const [description, setDescription] = useState("");
  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");
  const [location, setLocation] = useState("");

  return (
    <WbModal title="Add equipment" sub="What's at this site" onClose={onClose}>
      <div className="fl-grid">
        <label className="fl-f span">
          <span>
            Description<i>*</i>
          </span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Rooftop package unit"
            autoFocus
          />
        </label>
        <label className="fl-f">
          <span>Model</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} />
        </label>
        <label className="fl-f">
          <span>Serial</span>
          <input value={serial} onChange={(e) => setSerial(e.target.value)} />
        </label>
        <label className="fl-f span">
          <span>Where</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="North roof, unit 3" />
        </label>
      </div>
      <div className="fl-foot">
        <button className="pbtn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="pbtn primary"
          disabled={!description.trim()}
          onClick={() => onAdd({ description, model, serial, location })}
        >
          Add
        </button>
      </div>
    </WbModal>
  );
}

function LinkJobModal({
  sm8Connected,
  onClose,
  onLink,
}: {
  sm8Connected: boolean;
  onClose: () => void;
  onLink: (input: { jobNumber?: string; remoteId?: string }) => void;
}) {
  const [jobNumber, setJobNumber] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<JobSearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  const doSearch = async (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    setHits(await searchJobs(q));
    setSearching(false);
  };

  return (
    <WbModal
      title="Link the raised job"
      sub={sm8Connected ? "Search ServiceM8, or type the number" : "Type the job number"}
      onClose={onClose}
    >
      <label className="fl-f span">
        <span>Job number (typed)</span>
        <input value={jobNumber} onChange={(e) => setJobNumber(e.target.value)} placeholder="1042" autoFocus />
      </label>
      {sm8Connected && (
        <>
          <label className="fl-f span" style={{ marginTop: 10 }}>
            <span>Or search ServiceM8</span>
            <input value={query} onChange={(e) => doSearch(e.target.value)} placeholder="Number or client…" />
          </label>
          {searching && <p className="int-hint">Searching…</p>}
          {hits.map((h) => (
            <button key={h.remoteId} className="wb-row wb-hit" onClick={() => onLink({ remoteId: h.remoteId })}>
              <span className="wb-chip">#{h.jobNumber ?? "—"}</span>
              <span className="wb-who">
                <b>{h.clientName ?? "—"}</b>
                {h.suburb && <em> · {h.suburb}</em>}
              </span>
              {h.status && <span className="wb-chip">{h.status}</span>}
            </button>
          ))}
        </>
      )}
      <div className="fl-foot">
        <button className="pbtn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="pbtn primary" disabled={!jobNumber.trim()} onClick={() => onLink({ jobNumber })}>
          Link typed number
        </button>
      </div>
    </WbModal>
  );
}
