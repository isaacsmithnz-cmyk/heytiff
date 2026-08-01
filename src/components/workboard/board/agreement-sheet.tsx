"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import type { BoardAgreement, BoardTag, BoardCategory } from "@/lib/workboard/board-query";
import {
  addAgreementEquipment,
  addPackingItem,
  createCategory,
  createTag,
  removeAgreementEquipment,
  removePackingItem,
  setAgreementCategory,
  setAgreementStatus,
  tagAgreement,
  untagAgreement,
  updateAgreementMeta,
  updateAgreementSchedule,
  type MaintenanceResult,
} from "@/app/actions/workboard-maintenance";
import { cadenceLabel, untilLabel } from "./derive";

/* The agreement sheet (A6's fix) — everything the shipped detail page could
   do, now one slide-over on the board: meta, schedule (with the redraw
   rule said out loud), pause/end/resume, category, tags, the packing list
   the visits tick, and the structured equipment register (D5: assets stay
   model/serial/location — never flattened to strings). The three fields
   the prototype collected and never showed — billing contact, technicians
   needed, hours — render here for good (L2). */

const INTERVALS: [number, string][] = [
  [1, "Monthly"],
  [2, "Every 2 months"],
  [3, "Quarterly"],
  [4, "Every 4 months"],
  [6, "6-monthly"],
  [12, "Annual"],
  [24, "Every 2 years"],
];

export function AgreementSheet({
  agreement: a,
  categories,
  tagPool,
  today,
  manage,
  onToast,
  onClose,
}: {
  agreement: BoardAgreement;
  categories: BoardCategory[];
  tagPool: BoardTag[];
  today: string;
  manage: boolean;
  onToast: (message: string, undo?: () => void | Promise<void>) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // section drafts
  const [label, setLabel] = useState(a.label);
  const [clientName, setClientName] = useState(a.clientName);
  const [siteLabel, setSiteLabel] = useState(a.siteLabel ?? "");
  const [siteAddress, setSiteAddress] = useState(a.siteAddress ?? "");
  const [billingContact, setBillingContact] = useState(a.billingContact ?? "");
  const [techsNeeded, setTechsNeeded] = useState(a.techsNeeded);
  const [hoursText, setHoursText] = useState(a.hoursEstimate !== null ? String(a.hoursEstimate) : "");
  const [weInstalled, setWeInstalled] = useState(a.weInstalled);
  const [accessNotes, setAccessNotes] = useState(a.accessNotes ?? "");
  const [siteRequirements, setSiteRequirements] = useState(a.siteRequirements ?? "");
  const [notes, setNotes] = useState(a.notes ?? "");
  const [interval, setInterval_] = useState(a.intervalMonths);
  const [anchor, setAnchor] = useState(a.anchorDate);
  const [contractEnd, setContractEnd] = useState(a.contractEnd ?? "");
  const [ending, setEnding] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const [tagText, setTagText] = useState("");
  const [newCategory, setNewCategory] = useState(false);
  const [categoryText, setCategoryText] = useState("");
  const [eq, setEq] = useState({ description: "", model: "", serial: "", location: "" });

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

  const run = (fn: () => Promise<MaintenanceResult>, toastMsg?: string, undo?: () => void | Promise<void>) => {
    setErr(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setErr(res.error);
      else if (toastMsg) onToast(toastMsg, undo);
      router.refresh();
    });
  };

  const metaDirty =
    label !== a.label ||
    clientName !== a.clientName ||
    siteLabel !== (a.siteLabel ?? "") ||
    siteAddress !== (a.siteAddress ?? "") ||
    billingContact !== (a.billingContact ?? "") ||
    techsNeeded !== a.techsNeeded ||
    hoursText !== (a.hoursEstimate !== null ? String(a.hoursEstimate) : "") ||
    weInstalled !== a.weInstalled ||
    accessNotes !== (a.accessNotes ?? "") ||
    siteRequirements !== (a.siteRequirements ?? "") ||
    notes !== (a.notes ?? "");

  const scheduleDirty =
    interval !== a.intervalMonths || anchor !== a.anchorDate || contractEnd !== (a.contractEnd ?? "");

  const saveMeta = () =>
    run(
      () =>
        updateAgreementMeta(a.id, {
          label,
          clientName,
          siteLabel: siteLabel.trim() || null,
          siteAddress: siteAddress.trim() || null,
          billingContact: billingContact.trim() || null,
          techsNeeded,
          hoursEstimate: hoursText.trim() === "" ? null : Number(hoursText),
          weInstalled,
          accessNotes: accessNotes.trim() || null,
          siteRequirements: siteRequirements.trim() || null,
          notes: notes.trim() || null,
        }),
      "Agreement saved"
    );

  const saveSchedule = () =>
    run(
      () =>
        updateAgreementSchedule(a.id, {
          intervalMonths: interval,
          anchorDate: anchor,
          contractEnd: contractEnd.trim() === "" ? null : contractEnd,
        }),
      "Cadence saved — untouched future visits redrawn"
    );

  const rel = a.nextDue ? untilLabel(a.nextDue, today) : null;
  const tagSuggestions = tagPool.filter((t) => !a.tags.some((x) => x.id === t.id));

  const addTag = (raw: string) => {
    const name = raw.trim();
    setAddingTag(false);
    setTagText("");
    if (!name) return;
    const existing = tagPool.find((t) => t.name.toLowerCase() === name.toLowerCase());
    run(async () => {
      if (existing) return tagAgreement(a.id, existing.id);
      const made = await createTag(name);
      if (!made.ok || !made.id) return made;
      return tagAgreement(a.id, made.id);
    });
  };

  return createPortal(
    <>
      <div className="wb2-scrim" onClick={onClose} />
      <aside className="wb2-sheet" role="dialog" aria-modal="true" aria-label={`${a.clientName} — ${a.label}`}>
        <div className="wb2-shtop">
          <span className="wb2-chip blue">Service agreement</span>
          {a.status === "paused" ? (
            <span className="wb2-chip warn">Paused</span>
          ) : (
            <span className="wb2-chip ok">Active</span>
          )}
          {a.category && <span className="wb2-chip">{a.category.name}</span>}
          <button ref={closeRef} className="wb2-ico" onClick={onClose} title="Close" aria-label="Close">
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="wb2-shhd">
          <h2>{a.label}</h2>
          <p>
            {a.clientName}
            {a.siteLabel ? ` · ${a.siteLabel}` : ""}
          </p>
          <div className="wb2-facts">
            <div>
              <span className="wb2-sect">Cadence</span>
              <b>{cadenceLabel(a.intervalMonths)}</b>
              <em>anchored {fmtAuWeekdayDayMonth(a.anchorDate)}</em>
            </div>
            <div>
              <span className="wb2-sect">Next due</span>
              <b>{a.nextDue ? fmtAuWeekdayDayMonth(a.nextDue) : "—"}</b>
              <em className={rel?.tone === "dan" ? "dan" : undefined}>
                {a.status === "paused" ? "paused — nothing generates" : rel ? rel.t : "no open visits"}
              </em>
            </div>
          </div>
        </div>

        {err && <p className="wb2-sherr">{err}</p>}

        {manage && (
          <div className="wb2-shsect">
            <div className="wb2-shsh">
              <span className="wb2-sect">Standing</span>
            </div>
            <div className="wb2-corow">
              {a.status === "paused" ? (
                <button
                  className="pbtn"
                  disabled={busy}
                  onClick={() =>
                    run(() => setAgreementStatus(a.id, "active"), `Resumed — ${a.clientName}`, async () => {
                      await setAgreementStatus(a.id, "paused");
                      router.refresh();
                    })
                  }
                >
                  Resume the agreement
                </button>
              ) : (
                <button
                  className="pbtn ghost"
                  disabled={busy}
                  onClick={() =>
                    run(() => setAgreementStatus(a.id, "paused"), `Paused — ${a.clientName}`, async () => {
                      await setAgreementStatus(a.id, "active");
                      router.refresh();
                    })
                  }
                >
                  Pause
                </button>
              )}
              {ending ? (
                <>
                  <button
                    className="pbtn ghost danger"
                    disabled={busy}
                    onClick={() => {
                      setEnding(false);
                      run(() => setAgreementStatus(a.id, "ended"), `Ended — ${a.clientName}`, async () => {
                        await setAgreementStatus(a.id, "active");
                        router.refresh();
                      });
                      onClose();
                    }}
                  >
                    End it — I&apos;m sure
                  </button>
                  <button className="pbtn ghost" disabled={busy} onClick={() => setEnding(false)}>
                    Keep it
                  </button>
                </>
              ) : (
                <button className="pbtn ghost" disabled={busy} onClick={() => setEnding(true)}>
                  End the agreement…
                </button>
              )}
            </div>
            <p className="wb2-hint">
              Pausing keeps every row and takes them off the radar; ending hides the agreement from
              the board. Nothing is deleted either way.
            </p>
          </div>
        )}

        <div className="wb2-shsect">
          <div className="wb2-shsh">
            <span className="wb2-sect">The agreement</span>
            {manage && metaDirty && (
              <button className="pbtn" disabled={busy} onClick={saveMeta}>
                Save
              </button>
            )}
          </div>
          {manage ? (
            <div className="wb2-formgrid">
              <label className="wb2-fl">
                Service label
                <input className="wb2-fi" value={label} onChange={(e) => setLabel(e.target.value)} />
              </label>
              <label className="wb2-fl">
                Client
                <input className="wb2-fi" value={clientName} onChange={(e) => setClientName(e.target.value)} />
              </label>
              <label className="wb2-fl">
                Site label
                <input className="wb2-fi" value={siteLabel} onChange={(e) => setSiteLabel(e.target.value)} placeholder="e.g. DC 2, Head office" />
              </label>
              <label className="wb2-fl">
                Site address
                <input className="wb2-fi" value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} />
              </label>
              <label className="wb2-fl">
                Billing contact
                <input className="wb2-fi" value={billingContact} onChange={(e) => setBillingContact(e.target.value)} placeholder="who the invoice goes to" />
              </label>
              <label className="wb2-fl">
                Technicians needed
                <select className="wb2-sel" value={techsNeeded} onChange={(e) => setTechsNeeded(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wb2-fl">
                Hours on site (estimate)
                <input
                  type="number"
                  min={0.5}
                  max={24}
                  step={0.5}
                  className="wb2-fi"
                  value={hoursText}
                  onChange={(e) => setHoursText(e.target.value)}
                />
              </label>
              <label className="wb2-flcheck">
                <input type="checkbox" checked={weInstalled} onChange={(e) => setWeInstalled(e.target.checked)} />
                We installed this system
              </label>
              <label className="wb2-fl wide">
                Access notes
                <textarea className="wb2-notes" rows={2} value={accessNotes} onChange={(e) => setAccessNotes(e.target.value)} placeholder="keys, roof access, who to ask for…" />
              </label>
              <label className="wb2-fl wide">
                Site requirements
                <textarea className="wb2-notes" rows={2} value={siteRequirements} onChange={(e) => setSiteRequirements(e.target.value)} placeholder="inductions, white card, PPE…" />
              </label>
              <label className="wb2-fl wide">
                Agreement notes
                <textarea className="wb2-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
            </div>
          ) : (
            <ul className="wb2-ul">
              <li>{a.siteAddress ?? "No site address recorded."}</li>
              <li>{a.billingContact ? `Billing: ${a.billingContact}` : "No billing contact recorded."}</li>
              <li>{a.accessNotes ?? "No access notes."}</li>
            </ul>
          )}
        </div>

        <div className="wb2-shsect">
          <div className="wb2-shsh">
            <span className="wb2-sect">Schedule</span>
            {manage && scheduleDirty && (
              <button className="pbtn" disabled={busy} onClick={saveSchedule}>
                Save the cadence
              </button>
            )}
          </div>
          {manage ? (
            <>
              <div className="wb2-formgrid">
                <label className="wb2-fl">
                  How often
                  <select className="wb2-sel" value={interval} onChange={(e) => setInterval_(Number(e.target.value))}>
                    {INTERVALS.map(([n, word]) => (
                      <option key={n} value={n}>
                        {word}
                      </option>
                    ))}
                    {!INTERVALS.some(([n]) => n === a.intervalMonths) && (
                      <option value={a.intervalMonths}>{cadenceLabel(a.intervalMonths)}</option>
                    )}
                  </select>
                </label>
                <label className="wb2-fl">
                  Anchor date
                  <input type="date" className="wb2-fi" value={anchor} onChange={(e) => setAnchor(e.target.value)} />
                </label>
                <label className="wb2-fl">
                  Contract ends
                  <input type="date" className="wb2-fi" value={contractEnd} onChange={(e) => setContractEnd(e.target.value)} />
                </label>
              </div>
              <p className="wb2-hint">
                Saving redraws only the visits nobody has touched — anything booked, ticked, noted or
                assigned stays exactly where it is.
              </p>
            </>
          ) : (
            <p className="wb2-hint">
              {cadenceLabel(a.intervalMonths)}, anchored {fmtAuWeekdayDayMonth(a.anchorDate)}
              {a.contractEnd ? `, until ${fmtAuWeekdayDayMonth(a.contractEnd)}` : ""}.
            </p>
          )}
        </div>

        {manage && (
          <div className="wb2-shsect">
            <div className="wb2-shsh">
              <span className="wb2-sect">Category</span>
            </div>
            <div className="wb2-corow">
              <select
                className="wb2-sel"
                disabled={busy}
                value={a.category?.id ?? ""}
                aria-label="Billing category"
                onChange={(e) => {
                  const id = e.target.value;
                  run(() => setAgreementCategory(a.id, id === "" ? null : id));
                }}
              >
                <option value="">Uncategorised</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {newCategory ? (
                <input
                  className="wb2-fi"
                  autoFocus
                  placeholder="New category name"
                  value={categoryText}
                  onChange={(e) => setCategoryText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const name = categoryText.trim();
                      setNewCategory(false);
                      setCategoryText("");
                      if (!name) return;
                      run(async () => {
                        const made = await createCategory(name);
                        if (!made.ok || !made.id) return made;
                        return setAgreementCategory(a.id, made.id);
                      });
                    }
                    if (e.key === "Escape") {
                      setNewCategory(false);
                      setCategoryText("");
                    }
                  }}
                />
              ) : (
                <button className="pbtn ghost" disabled={busy} onClick={() => setNewCategory(true)}>
                  New category…
                </button>
              )}
            </div>
            <p className="wb2-hint">
              Creating a category never moves other agreements into it — every move is this
              dropdown, on purpose.
            </p>
          </div>
        )}

        <div className="wb2-shsect">
          <div className="wb2-shsh">
            <span className="wb2-sect">Tags</span>
            <span className="wb2-chip">{a.tags.length || "none"}</span>
          </div>
          <div className="wb2-tags">
            {a.tags.map((t) => (
              <span className={`wb2-tag on t-${t.color}`} key={t.id}>
                {t.name}
                {manage && (
                  <button
                    disabled={busy}
                    title="Remove"
                    aria-label={`Remove ${t.name}`}
                    onClick={() => run(() => untagAgreement(a.id, t.id))}
                  >
                    <Icon name="x" size={10} />
                  </button>
                )}
              </span>
            ))}
            {manage &&
              (addingTag ? (
                <input
                  className="wb2-tagin"
                  autoFocus
                  placeholder="Type or pick a tag"
                  value={tagText}
                  onChange={(e) => setTagText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag(tagText);
                    }
                    if (e.key === "Escape") {
                      setAddingTag(false);
                      setTagText("");
                    }
                  }}
                  onBlur={() => addTag(tagText)}
                />
              ) : (
                <button className="wb2-tag add" disabled={busy} onClick={() => setAddingTag(true)}>
                  <Icon name="plus" size={11} />
                  Add tag
                </button>
              ))}
          </div>
          {manage && addingTag && tagSuggestions.length > 0 && (
            <div className="wb2-tagsug">
              {tagSuggestions.map((t) => (
                <button
                  key={t.id}
                  className={`wb2-tag sug t-${t.color}`}
                  disabled={busy}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setAddingTag(false);
                    setTagText("");
                    run(() => tagAgreement(a.id, t.id));
                  }}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="wb2-shsect">
          <div className="wb2-shsh">
            <span className="wb2-sect">Equipment to bring</span>
            <span className="wb2-chip">{a.packing.length || "none"}</span>
          </div>
          <div className="wb2-pklist">
            {a.packing.map((p) => (
              <div className="wb2-pk" key={p.id}>
                <span className="wb2-pkl">{p.label}</span>
                {manage && (
                  <button
                    className="wb2-pkx"
                    disabled={busy}
                    title="Remove from the list"
                    aria-label={`Remove ${p.label}`}
                    onClick={() => run(() => removePackingItem(p.id))}
                  >
                    <Icon name="x" size={11} />
                  </button>
                )}
              </div>
            ))}
            {a.packing.length === 0 && (
              <p className="wb2-hint">Nothing on the packing list — visits tick these off as the van loads.</p>
            )}
            {manage && <AddInline placeholder="What needs to come" onAdd={(v) => run(() => addPackingItem(a.id, v))} busy={busy} />}
          </div>
          {a.bringList && (
            <p className="wb2-hint">Older freeform bring list: {a.bringList}</p>
          )}
        </div>

        <div className="wb2-shsect">
          <div className="wb2-shsh">
            <span className="wb2-sect">Equipment on site</span>
            <span className="wb2-chip">{a.equipment.length || "none"}</span>
          </div>
          <div className="wb2-eqlist">
            {a.equipment.map((e) => (
              <div className="wb2-eqrow" key={e.id}>
                <div className="wb2-trt">
                  <b>{e.description}</b>
                  <em>
                    {[e.model && `Model ${e.model}`, e.serial && `Serial ${e.serial}`, e.location]
                      .filter(Boolean)
                      .join(" · ") || "no details recorded"}
                  </em>
                </div>
                {manage && (
                  <button
                    className="wb2-pkx show"
                    disabled={busy}
                    title="Remove"
                    aria-label={`Remove ${e.description}`}
                    onClick={() => run(() => removeAgreementEquipment(e.id))}
                  >
                    <Icon name="x" size={11} />
                  </button>
                )}
              </div>
            ))}
            {a.equipment.length === 0 && (
              <p className="wb2-hint">The installed assets on this site — model, serial, where they live.</p>
            )}
          </div>
          {manage && (
            <div className="wb2-formgrid eq">
              <input className="wb2-fi" placeholder="Unit (e.g. Rooftop package #1)" value={eq.description} onChange={(e) => setEq({ ...eq, description: e.target.value })} />
              <input className="wb2-fi" placeholder="Model" value={eq.model} onChange={(e) => setEq({ ...eq, model: e.target.value })} />
              <input className="wb2-fi" placeholder="Serial" value={eq.serial} onChange={(e) => setEq({ ...eq, serial: e.target.value })} />
              <input className="wb2-fi" placeholder="Location" value={eq.location} onChange={(e) => setEq({ ...eq, location: e.target.value })} />
              <button
                className="pbtn ghost"
                disabled={busy || !eq.description.trim()}
                onClick={() => {
                  const draft = eq;
                  setEq({ description: "", model: "", serial: "", location: "" });
                  run(() =>
                    addAgreementEquipment(a.id, {
                      description: draft.description,
                      model: draft.model || undefined,
                      serial: draft.serial || undefined,
                      location: draft.location || undefined,
                    })
                  );
                }}
              >
                Add unit
              </button>
            </div>
          )}
        </div>
      </aside>
    </>,
    document.body
  );
}

function AddInline({
  placeholder,
  onAdd,
  busy,
}: {
  placeholder: string;
  onAdd: (value: string) => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  if (!editing) {
    return (
      <button className="wb2-pk add" disabled={busy} onClick={() => setEditing(true)}>
        <Icon name="plus" size={12} />
        Add item
      </button>
    );
  }
  const commit = () => {
    const v = text.trim();
    setEditing(false);
    setText("");
    if (v) onAdd(v);
  };
  return (
    <input
      className="wb2-fi"
      autoFocus
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          setEditing(false);
          setText("");
        }
      }}
      onBlur={commit}
    />
  );
}
