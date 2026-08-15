"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { fmtAud } from "@/lib/workboard/project-money";
import {
  createProjectFromJob,
  readJobFiles,
  readJobRecord,
  readMirrorJob,
  type JobRecordRead,
} from "@/app/actions/workboard";
import {
  collectionAgainst,
  fmtQuantity,
  materialsTaxMixed,
  materialsTotalCents,
  paymentsTotalCents,
} from "@/lib/workboard/job-ledger";
import { MONEY_BASIS } from "@/lib/workboard/job-money";
import { cacheJobFiles } from "@/app/actions/workboard-media";
import type { MirrorJobDetail } from "@/lib/workboard/all-jobs-query";
import type { JobMediaGroupsRead } from "@/lib/workboard/job-media-query";
import { JOB_MEDIA_CAP, mediaCountLine } from "@/lib/workboard/job-media";
import { fmtMinutesAsHours, groupChecklist, type AllJobRow } from "@/lib/workboard/all-jobs";

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

/** Enough rounds for the busiest job in the live account (a few dozen files
    at six a round), and a hard stop against a server that never converges. */
const MAX_CACHE_ROUNDS = 12;

const dayOf = (naive: string | null | undefined) =>
  naive && naive.length >= 10 ? naive.slice(0, 10) : null;

/** When a design was last touched. `studio_designs.updated_at` is a real
    timestamptz — a genuine instant, unlike every ServiceM8 stamp on this
    sheet — so it is PARSED and shown in the reader's own zone. The studio's
    contributors card stamps its dates the same way.

    Absolute, not "2 days ago": a relative label needs the clock at render
    time, and `Date.now()` in a render body breaks hydration for the whole
    tree. This block only mounts after the detail fetch, so it would get away
    with it — but the sheet's every other date is absolute anyway. */
const editedOn = (iso: string): string => {
  const d = new Date(iso);
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
  // through the sheet's own formatter, so this date wears the same shape as
  // every other one beside it ("Fri 14 Aug", not en-AU's "Fri, 14 Aug")
  return fmtAuWeekdayDayMonth(local);
};

/** "7:30am" from a naive local string, by slicing — never by parsing a wall
    clock into a Date, which would shift it by the browser's offset. */
function timeOf(naive: string): string | null {
  const hh = Number(naive.slice(11, 13));
  const mm = naive.slice(14, 16);
  if (Number.isNaN(hh) || !/^\d{2}$/.test(mm)) return null;
  const ampm = hh < 12 ? "am" : "pm";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return mm === "00" ? `${h12}${ampm}` : `${h12}:${mm}${ampm}`;
}

/** "7:30am Thu 14 Aug", or "7:30am–3:30pm Thu 14 Aug" when the booking's end
    is known and lands on the same day. Same approach as the project screen's
    booking label. */
function bookingLabel(naive: string, end?: string | null): string {
  const date = dayOf(naive);
  const time = timeOf(naive);
  if (!date || !time) return date ? fmtAuWeekdayDayMonth(date) : naive;
  const endTime = end && dayOf(end) === date ? timeOf(end) : null;
  return `${endTime ? `${time}–${endTime}` : time} ${fmtAuWeekdayDayMonth(date)}`;
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
  const [media, setMedia] = useState<JobMediaGroupsRead | null>(null);
  const [mediaNote, setMediaNote] = useState<string | null>(null);
  const [record, setRecord] = useState<JobRecordRead | null>(null);
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

  /* The files arrive on their own clock. They cost a storage round trip that
     the rest of the sheet shouldn't wait behind, and a job with none is the
     common case — so this renders nothing at all until it has something to
     say, rather than a spinner over an empty shelf. */
  useEffect(() => {
    let live = true;
    void readJobFiles(row.id).then((m) => {
      if (live) setMedia(m);
    });
    return () => {
      live = false;
    };
  }, [row.id]);

  /* Notes and the ledger, on their own clock like the files. `ledger` comes
     back null for a reader without money — the gate is server-side, so this
     component never has numbers it must remember to hide. */
  useEffect(() => {
    let live = true;
    void readJobRecord(row.id).then((r) => {
      if (live) setRecord(r);
    });
    return () => {
      live = false;
    };
  }, [row.id]);

  /* Bringing the bytes across, a few per round, with the BROWSER as the loop
     — there is no server queue, the same reason the knowledge-base backfill
     is driven from here. Two rails, both load-bearing: a hard round cap so a
     pathological job can't spin forever, and STOP ON NO PROGRESS, because a
     server that keeps saying "6 left" while caching none is a bug, not a
     backlog. */
  useEffect(() => {
    let live = true;
    let rounds = 0;
    const pump = async () => {
      while (live && rounds < MAX_CACHE_ROUNDS) {
        rounds += 1;
        const res = await cacheJobFiles(row.id);
        if (!live) return;
        if (res.media) setMedia(res.media);
        if (res.note) setMediaNote(res.note);
        if (!res.ok || res.cached === 0 || res.remaining === 0) return;
      }
    };
    void pump();
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
            {row.categoryName && (
              <span className="wb2-chip">
                {row.categoryColour && (
                  <i className="wb2-catdot" style={{ background: row.categoryColour }} aria-hidden />
                )}
                {row.categoryName}
              </span>
            )}
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
          <p>{detail?.address ?? detail?.geoLine ?? row.suburb ?? "No address on the job"}</p>
          <div className="wb2-facts">
            <div>
              <span className="wb2-sect">{row.dateLabel === "raised" ? "Raised" : "When"}</span>
              <b>{dayOf(row.date) ? fmtAuWeekdayDayMonth(dayOf(row.date)!) : "—"}</b>
              <em>{row.dateLabel}</em>
            </div>
            {detail?.workOrderDate && row.statusLabel === "Work Order" && (
              <div>
                <span className="wb2-sect">Work order</span>
                <b>{dayOf(detail.workOrderDate) ? fmtAuWeekdayDayMonth(dayOf(detail.workOrderDate)!) : "—"}</b>
                <em>since</em>
              </div>
            )}
            {detail?.nextBooking && (
              <div>
                <span className="wb2-sect">Next on site</span>
                <b>{bookingLabel(detail.nextBooking.start, detail.nextBooking.end)}</b>
                <em>{detail.nextBooking.staffName ?? "Nobody named"}</em>
              </div>
            )}
            {detail?.timeOnSite && (
              <div>
                <span className="wb2-sect">Time on site</span>
                <b>{fmtMinutesAsHours(detail.timeOnSite.minutes)}</b>
                <em>
                  {detail.timeOnSite.sessions === 1
                    ? "recorded across 1 visit"
                    : `recorded across ${detail.timeOnSite.sessions} visits`}
                </em>
              </div>
            )}
            {detail?.queue && (
              <div>
                <span className="wb2-sect">In queue</span>
                <b>{detail.queue.name}</b>
                <em>
                  {[
                    detail.queue.staffName,
                    detail.queue.expiry ? `until ${fmtAuWeekdayDayMonth(detail.queue.expiry)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "waiting"}
                </em>
              </div>
            )}
            {moneyVisible && (
              <div className="wb2-money">
                {/* The basis is on the LABEL, not the figure: it belongs to
                    every number in this column, and repeating it beside each
                    one turns a fact into noise. */}
                <span className="wb2-sect">
                  Job value ({MONEY_BASIS})
                </span>
                <b>{money?.valueCents != null ? fmtAud(money.valueCents) : "—"}</b>
                {/* Rendered only when there is something TRUE to say. When
                    the invoice flag never arrived — every job on the live
                    account — this line is absent, because "Not invoiced" was
                    us announcing a fact nobody had told us. What has been
                    paid is answered properly by the payments ledger below. */}
                {(() => {
                  if (money?.paid) {
                    return (
                      <em>
                        Paid{money.paidOn ? ` ${fmtAuWeekdayDayMonth(money.paidOn)}` : ""}
                      </em>
                    );
                  }
                  if (money?.invoiced === true) {
                    return (
                      <em>
                        Invoiced
                        {money.invoicedOn ? ` ${fmtAuWeekdayDayMonth(money.invoicedOn)}` : ""} —
                        awaiting payment
                      </em>
                    );
                  }
                  if (money?.quoteSent === true) {
                    return (
                      <em>
                        Quote sent
                        {money.quoteSentOn ? ` ${fmtAuWeekdayDayMonth(money.quoteSentOn)}` : ""}
                      </em>
                    );
                  }
                  if (money?.invoiced === false) return <em>Not invoiced</em>;
                  return null;
                })()}
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

        {detail && detail.checklist.length > 0 && (
          <div className="wb2-shsect">
            <span className="wb2-sect">
              Their checklist —{" "}
              {`${detail.checklist.filter((c) => c.done).length} of ${detail.checklist.length} done`}
            </span>
            {groupChecklist(detail.checklist).map((group, gi) => (
              <div key={`${group.section ?? "-"}-${gi}`} className="wb2-ckgroup">
                {group.section && <span className="wb2-sect wb2-cksec">{group.section}</span>}
                {group.items.map((item, i) => (
                  <div key={`${item.name}-${i}`} className={`wb2-ckrow${item.done ? " done" : ""}`}>
                    <i className="wb2-ckdot" aria-hidden />
                    <span className="wb2-ckname">{item.name}</span>
                    {item.itemType && item.itemType !== "Todo" && (
                      <i className="wb2-chip">{item.itemType}</i>
                    )}
                    <em>
                      {item.done
                        ? [item.doneBy, item.doneOn ? fmtAuWeekdayDayMonth(item.doneOn) : null]
                            .filter(Boolean)
                            .join(" · ") || "done"
                        : ""}
                    </em>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {record && record.notes.length > 0 && (
          <div className="wb2-shsect">
            <span className="wb2-sect">What&apos;s been written on it</span>
            {record.notes.map((n) => (
              <div className="wb2-jnote" key={n.remoteId}>
                <p className="wb2-shtext">{n.text}</p>
                <em>
                  {[n.writtenBy, n.writtenOn ? fmtAuWeekdayDayMonth(n.writtenOn) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </em>
              </div>
            ))}
          </div>
        )}

        {/* Materials and payments arrive null without `workboard_money`, so
            there is nothing here to hide — the server never sent it. */}
        {record?.ledger && record.ledger.materials.length > 0 && (
          <div className="wb2-shsect">
            <span className="wb2-sect">What went on the job</span>
            {record.ledger.materials.map((m) => (
              <div className="wb2-mline" key={m.remoteId}>
                <b>{m.name}</b>
                <em>{m.quantity !== null ? `× ${fmtQuantity(m.quantity)}` : ""}</em>
                <span>{m.lineCents !== null ? fmtAud(m.lineCents) : "—"}</span>
              </div>
            ))}
            {(() => {
              const total = materialsTotalCents(record.ledger.materials);
              const mixed = materialsTaxMixed(record.ledger.materials);
              /* No total when a line couldn't be read, and none when the
                 lines disagree about tax — adding an inc-GST line to an
                 ex-GST one and printing one figure would be a lie. */
              if (mixed)
                return (
                  <p className="int-hint">
                    These lines mix tax-inclusive and tax-exclusive prices, so they don&apos;t add
                    up to one figure here — ServiceM8&apos;s invoice is the total.
                  </p>
                );
              if (total === null)
                return <p className="int-hint">Some lines aren&apos;t priced, so there&apos;s no total to show.</p>;
              return (
                <div className="wb2-mline total">
                  <b>{record.ledger.materials[0].taxInclusive ? "Total inc GST" : "Total ex GST"}</b>
                  <em />
                  <span>{fmtAud(total)}</span>
                </div>
              );
            })()}
          </div>
        )}

        {record?.ledger && record.ledger.payments.length > 0 && (
          <div className="wb2-shsect">
            <span className="wb2-sect">
              What&apos;s been paid —{" "}
              {(() => {
                const paid = paymentsTotalCents(record.ledger.payments);
                const state = collectionAgainst(paid, money?.valueCents ?? null);
                if (state === "paid") return `${fmtAud(paid)}, paid in full`;
                if (state === "part")
                  return `${fmtAud(paid)} of ${fmtAud(money!.valueCents!)}`;
                return fmtAud(paid);
              })()}
            </span>
            {record.ledger.payments.map((p) => (
              <div className="wb2-mline" key={p.remoteId}>
                <b>{p.method ?? "Payment"}</b>
                <em>
                  {[
                    p.isDeposit ? "deposit" : null,
                    p.takenOn ? fmtAuWeekdayDayMonth(p.takenOn) : null,
                    p.takenBy,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </em>
                <span>{p.amountCents !== null ? fmtAud(p.amountCents) : "—"}</span>
              </div>
            ))}
          </div>
        )}

        {media && media.photos.length + media.documents.length + media.elsewhere.length > 0 && (
          <div className="wb2-shsect">
            <span className="wb2-sect">Files on this job — {mediaCountLine(media)}</span>

            {media.photos.length > 0 && (
              <div className="wb2-mgrid">
                {media.photos.map((p) =>
                  p.url ? (
                    <a
                      key={p.remoteId}
                      className="wb2-mtile"
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      /* A grid tile has no room for a chip, but a photo that
                         was EMAILED IN is a different thing from one taken on
                         site — so the origin rides in the tooltip, where the
                         name already is. */
                      title={p.origin ? `${p.name} — ${p.origin.toLowerCase()}` : p.name}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt={p.name} loading="lazy" />
                    </a>
                  ) : (
                    /* Not cached yet. A tile that says so beats a broken
                       image, and beats hiding a photo that genuinely
                       exists. */
                    <span
                      key={p.remoteId}
                      className="wb2-mtile pending"
                      title={p.origin ? `${p.name} — ${p.origin.toLowerCase()}` : p.name}
                    >
                      <Icon name="cam" size={16} />
                    </span>
                  )
                )}
              </div>
            )}

            {media.documents.map((d) => (
              <p className="wb2-shtext" key={d.remoteId}>
                {d.url ? (
                  <a className="wb2-colink" href={d.url} target="_blank" rel="noreferrer">
                    {d.name}
                  </a>
                ) : (
                  <b>{d.name}</b>
                )}
                {d.origin ? <i className="wb2-chip">{d.origin}</i> : null}
              </p>
            ))}

            {media.elsewhere.length > 0 && (
              <p className="int-hint">
                {media.elsewhere.length === 1
                  ? "1 file stays in ServiceM8"
                  : `${media.elsewhere.length} files stay in ServiceM8`}{" "}
                — video and file types this screen can&apos;t show.
              </p>
            )}

            {mediaNote && <p className="int-hint">{mediaNote}</p>}

            {media.truncated && (
              <p className="int-hint">
                Showing the newest {JOB_MEDIA_CAP} files — this job has more in ServiceM8.
              </p>
            )}
          </div>
        )}

        {detail && detail.contacts.length > 0 && (
          <div className="wb2-shsect">
            <span className="wb2-sect">Who to ring</span>
            {detail.contacts.map((c, i) => (
              <p className="wb2-shtext" key={`${c.name}-${i}`}>
                <b>{c.name || "Unnamed"}</b>
                {c.type ? ` · ${c.type.toLowerCase()}` : ""}
                {c.phone ? ` · ${c.phone}` : ""}
                {c.email ? (
                  <>
                    {" · "}
                    <a className="wb2-colink" href={`mailto:${c.email}`}>
                      {c.email}
                    </a>
                  </>
                ) : null}
              </p>
            ))}
          </div>
        )}

        {/* The other end of the studio's job link. Absent for a reader
            without `studio` (the action doesn't fetch it), and absent when
            nobody has designed this job — an empty "Designs" heading on 800
            service calls would be a section that means nothing. */}
        {detail && detail.designs.length > 0 && (
          <div className="wb2-shsect">
            <span className="wb2-sect">
              {detail.designs.length === 1
                ? "Designed in the Studio"
                : `Designed in the Studio — ${detail.designs.length} options`}
            </span>
            {detail.designs.map((d) => (
              <Link
                key={d.id}
                className="wb2-dsgn"
                href={`/dashboard/studio?design=${encodeURIComponent(d.id)}`}
              >
                <span className="wb2-dsgn-ic">
                  <Icon name={d.mode === "plan" ? "file" : "square"} size={15} />
                </span>
                <span className="wb2-dsgn-b">
                  <b>{d.name}</b>
                  <em>
                    {`${d.floorCount} ${d.floorCount === 1 ? "floor" : "floors"} · ` +
                      `${d.systemCount} ${d.systemCount === 1 ? "system" : "systems"} · ` +
                      `edited ${editedOn(d.updatedAt)}`}
                  </em>
                </span>
                {/* its own wrapper because <Icon> renders <span><svg/></span>:
                    a `.wb2-dsgn > svg` rule would be valid CSS matching
                    nothing at all */}
                <span className="wb2-dsgn-go">
                  <Icon name="chevR" size={15} />
                </span>
              </Link>
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
