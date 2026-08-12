"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { fmtAud } from "@/lib/workboard/project-money";
import { createProjectFromJob, readMirrorJob } from "@/app/actions/workboard";
import type { MirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import type { AllJobRow } from "@/lib/workboard/all-jobs";

/* One ServiceM8 job, read-only — and the two ways out of it.

   READ-ONLY IS THE WHOLE POSTURE. ServiceM8 is mirrored under a read charter;
   nothing here writes back, and the sheet says so rather than offering
   controls that would lie. What it DOES offer is promotion: this job becomes
   a project, or the client becomes a maintenance agreement. That is the
   funnel the All jobs side exists for — see an untracked install, put it on a
   board.

   PORTALS TO BODY and reuses `.wb2-sheet`. Both are load-bearing: a dashboard
   modal must portal (`.page.in`'s will-change breaks position:fixed), and
   reusing the class means the portal type-ramp and button restatements apply
   with no new CSS root to keep in step — the bug that made sheet text
   1.17:1 and left ghost buttons unstyled came from exactly that drift.

   OPENS ON WHAT THE ROW ALREADY KNEW, then fills in. A list of 800 rows can't
   carry every description, address and contact, so the row's slim facts paint
   immediately and the detail arrives a beat later. Nothing jumps: the fields
   that fill in were absent, not wrong. */

const dayOf = (naive: string | null | undefined) =>
  naive && naive.length >= 10 ? naive.slice(0, 10) : null;

/** "7:30am Thu 14 Aug" from a naive local string, by slicing — never by
    parsing a wall clock into a Date, which would shift it by the browser's
    offset. Same approach as the project screen's booking label. */
function bookingLabel(naive: string): string {
  const date = dayOf(naive);
  const hh = Number(naive.slice(11, 13));
  const mm = naive.slice(14, 16);
  if (!date || Number.isNaN(hh)) return date ? fmtAuWeekdayDayMonth(date) : naive;
  const ampm = hh < 12 ? "am" : "pm";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const time = mm === "00" ? `${h12}${ampm}` : `${h12}:${mm}${ampm}`;
  return `${time} ${fmtAuWeekdayDayMonth(date)}`;
}

export function JobSheet({
  row,
  manage,
  moneyVisible,
  onClose,
  onCreateAgreement,
  onOpenTracked,
  onToast,
}: {
  row: AllJobRow;
  manage: boolean;
  moneyVisible: boolean;
  onClose: () => void;
  /** Hands this job to the existing new-agreement modal, prefilled. */
  onCreateAgreement: (row: AllJobRow, detail: MirrorJobDetail | null) => void;
  /** Follows the tracked chip to the board that already holds this job. */
  onOpenTracked: (tracked: NonNullable<AllJobRow["tracked"]>) => void;
  onToast: (message: string) => void;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<MirrorJobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* No setLoading(true) here: the sheet is KEYED BY JOB, so a different job
     is a different component with `loading` already true. Resetting it in the
     effect would be state written during an effect for a case that can't
     happen — and the same "keyed by id, never reset by effect" rule the visit
     sheet follows for its drafts. */
  useEffect(() => {
    let live = true;
    void readMirrorJob(row.id).then((d) => {
      if (!live) return;
      setDetail(d);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [row.id]);

  const money = moneyVisible ? (detail?.money ?? null) : null;

  const makeProject = () => {
    setErr(null);
    start(async () => {
      const res = await createProjectFromJob(row.id, {
        name: name.trim() || row.clientName || undefined,
        clientName: row.clientName ?? undefined,
        siteLabel: row.suburb ?? undefined,
        siteAddress: detail?.address ?? undefined,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      onToast("Project created from this job");
      router.push(`/dashboard/workboard/projects/${res.id}`);
    });
  };

  return createPortal(
    <>
      <div className="wb2-scrim" onClick={onClose} />
      <aside
        className="wb2-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${row.clientName ?? "Job"}${row.number ? ` — job ${row.number}` : ""}`}
      >
        <div className="wb2-shtop">
          <span className="wb2-shno">{row.number ? `#${row.number}` : "—"}</span>
          <h2 className="wb2-shname">{row.clientName ?? "Unnamed client"}</h2>
          <span className="wb2-shchips">
            <span className="wb2-chip" title="This job's number in ServiceM8">
              ServiceM8 job
            </span>
            {row.tone !== "" && <span className={`wb2-chip ${row.tone}`}>{row.statusLabel}</span>}
            {row.categoryName && <span className="wb2-chip">{row.categoryName}</span>}
          </span>
          <button
            ref={closeRef}
            className="wb2-ico"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="wb2-shhd">
          <p>{detail?.address ?? row.suburb ?? "No address on the job"}</p>
          <div className="wb2-facts">
            <div>
              <span className="wb2-sect">{row.dateLabel === "raised" ? "Raised" : "When"}</span>
              <b>{dayOf(row.date) ? fmtAuWeekdayDayMonth(dayOf(row.date)!) : "—"}</b>
              <em>{row.dateLabel}</em>
            </div>
            {detail?.nextBooking && (
              <div>
                <span className="wb2-sect">Next on site</span>
                <b>{bookingLabel(detail.nextBooking.start)}</b>
                <em>{detail.nextBooking.staffName ?? "Nobody named"}</em>
              </div>
            )}
            {moneyVisible && (
              <div className="wb2-money">
                <span className="wb2-sect">Job value</span>
                <b>{money?.valueCents != null ? fmtAud(money.valueCents) : "—"}</b>
                <em>
                  {money?.paid
                    ? `Paid${money.paidOn ? ` ${fmtAuWeekdayDayMonth(money.paidOn)}` : ""}`
                    : money?.invoiced
                      ? `Invoiced${money.invoicedOn ? ` ${fmtAuWeekdayDayMonth(money.invoicedOn)}` : ""} — awaiting payment`
                      : "Not invoiced"}
                </em>
              </div>
            )}
            {detail?.purchaseOrder && (
              <div>
                <span className="wb2-sect">Their PO</span>
                <b>{detail.purchaseOrder}</b>
              </div>
            )}
          </div>
        </div>

        {row.tracked && (
          <div className="wb2-shsect">
            <span className="wb2-sect">Already tracked</span>
            <p className="int-hint">
              This job is on the{" "}
              {row.tracked.kind === "visit" ? "maintenance board" : "projects board"}.
            </p>
            <button className="pbtn ghost" onClick={() => onOpenTracked(row.tracked!)}>
              <Icon name="send" size={15} />
              {row.tracked.kind === "visit"
                ? `Open ${row.tracked.label}`
                : `Open ${row.tracked.label}`}
            </button>
          </div>
        )}

        <div className="wb2-shsect">
          <span className="wb2-sect">The job</span>
          {loading && !detail ? (
            <p className="int-hint">Reading it from the mirror…</p>
          ) : (
            <p className="wb2-shtext">
              {detail?.description ?? row.title ?? "Nothing written on the job."}
            </p>
          )}
          {detail?.workDone && (
            <>
              <span className="wb2-sect" style={{ marginTop: 10 }}>
                What was done
              </span>
              <p className="wb2-shtext">{detail.workDone}</p>
            </>
          )}
        </div>

        {detail && detail.contacts.length > 0 && (
          <div className="wb2-shsect">
            <span className="wb2-sect">Who to ring</span>
            {detail.contacts.map((c, i) => (
              <p className="wb2-shtext" key={`${c.name}-${i}`}>
                <b>{c.name || "Unnamed"}</b>
                {c.type ? ` · ${c.type.toLowerCase()}` : ""}
                {c.phone ? ` · ${c.phone}` : ""}
              </p>
            ))}
          </div>
        )}

        {/* The read-only fact, said once, where somebody would look for an
            edit button rather than discovered by pressing one. */}
        <div className="wb2-shsect">
          <span className="wb2-sect">Changing it</span>
          <p className="int-hint">
            This job belongs to ServiceM8 — HeyTiff only reads it. Edit it over there and the
            change follows here on the next sync.
          </p>
        </div>

        {err && <div className="wb2-sherr">{err}</div>}

        {manage && (
          <div className="wb2-shft">
            {naming ? (
              <>
                <input
                  className="wb2-fi"
                  autoFocus
                  value={name}
                  placeholder={row.clientName ?? "Project name"}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") makeProject();
                    if (e.key === "Escape") setNaming(false);
                  }}
                  aria-label="Name the project"
                />
                <button className="pbtn" disabled={busy} onClick={makeProject}>
                  <Icon name="check" size={15} />
                  Create it
                </button>
                <button className="pbtn ghost" disabled={busy} onClick={() => setNaming(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  className="pbtn ghost"
                  disabled={busy}
                  onClick={() => onCreateAgreement(row, detail)}
                >
                  <Icon name="file" size={15} />
                  Create a maintenance agreement
                </button>
                <button
                  className="pbtn"
                  disabled={busy}
                  onClick={() => {
                    setName(row.clientName ?? "");
                    setNaming(true);
                  }}
                >
                  <Icon name="plus" size={15} />
                  Create a project from this job
                </button>
              </>
            )}
          </div>
        )}
      </aside>
    </>,
    document.body
  );
}
