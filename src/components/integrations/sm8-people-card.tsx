"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/shell/icon";
import type { Sm8PersonRow } from "@/lib/integrations/sm8-people";
import {
  importSm8Staff,
  linkSm8Staff,
  unlinkSm8Staff,
  type ImportPersonInput,
} from "@/app/actions/staff-import";

/* The ServiceM8 people card — import is a REVIEW, not a copy.

   Every value a card would receive is on screen before anything is written:
   the row itself shows name · title · email · mobile, and the pencil opens
   them as editable fields where title, email and phone can be unticked.
   Import sends exactly what's ticked at that moment — a value that never
   appeared here can never reach a card, and the server re-checks the FACTS
   (which uuids exist, who's active) against ServiceM8 live either way.

   Suggested rows lead with Link because a match means NO new card — the whole
   track exists so one human never becomes two records. Import-as-new for a
   suggested person is deliberately inside the editor, one step further away.

   Nothing here auto-runs. Connecting doesn't import; rendering doesn't
   import; the buttons import. */

export type Sm8PeopleData = {
  rows: Sm8PersonRow[];
  /** Active cards with no ServiceM8 link yet — the manual picker's options. */
  linkable: { staffProfileId: string; name: string }[];
  /** The read failed — the sentence to show instead of rows. */
  error: string | null;
};

/** Per-person review state: current values plus which optionals are ticked.
    Seeded from the ServiceM8 person on first render, then owned by the
    reviewer — edits survive collapse because the map, not the DOM, holds them. */
type FieldState = {
  firstName: string;
  lastName: string;
  jobTitle: string;
  email: string;
  phone: string;
  incTitle: boolean;
  incEmail: boolean;
  incPhone: boolean;
};

function seedFields(row: Sm8PersonRow): FieldState {
  return {
    firstName: row.person.first ?? "",
    lastName: row.person.last ?? "",
    jobTitle: row.person.jobTitle ?? "",
    email: row.person.email ?? "",
    phone: row.person.mobile ?? "",
    incTitle: !!row.person.jobTitle,
    incEmail: !!row.person.email,
    incPhone: !!row.person.mobile,
  };
}

function payloadOf(uuid: string, f: FieldState): ImportPersonInput {
  return {
    uuid,
    firstName: f.firstName.trim() || undefined,
    lastName: f.lastName.trim() || undefined,
    jobTitle: f.incTitle && f.jobTitle.trim() ? f.jobTitle.trim() : undefined,
    email: f.incEmail && f.email.trim() ? f.email.trim() : undefined,
    phone: f.incPhone && f.phone.trim() ? f.phone.trim() : undefined,
  };
}

export function Sm8PeopleCard({ rows, linkable, error }: Sm8PeopleData) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [note, setNote] = useState<{ kind: "ok" | "bad"; text: string } | null>(null);
  const [fields, setFields] = useState<Record<string, FieldState>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showInactive, setShowInactive] = useState(false);
  const [showLinked, setShowLinked] = useState(false);
  // two-step unlink, like every destructive small button here
  const [armed, setArmed] = useState<string | null>(null);
  // manual "link to existing" pick, per person
  const [pick, setPick] = useState<Record<string, string>>({});

  const linked = useMemo(() => rows.filter((r) => r.kind === "linked"), [rows]);
  const pending = useMemo(() => rows.filter((r) => r.kind !== "linked"), [rows]);
  const hiddenInactive = useMemo(
    () => pending.filter((r) => !r.person.active).length,
    [pending],
  );
  const shown = useMemo(
    () =>
      // possible matches first — resolving them prevents duplicates, which is
      // the screen's whole reason to exist
      [...pending]
        .filter((r) => showInactive || r.person.active)
        .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "suggested" ? -1 : 1)),
    [pending, showInactive],
  );

  const fieldsOf = (row: Sm8PersonRow): FieldState =>
    fields[row.person.uuid] ?? seedFields(row);
  const patch = (uuid: string, row: Sm8PersonRow, p: Partial<FieldState>) =>
    setFields((f) => ({ ...f, [uuid]: { ...(f[uuid] ?? seedFields(row)), ...p } }));

  const run = (fn: () => Promise<{ ok: boolean }>, after?: () => void) => {
    setNote(null);
    start(async () => {
      const res = await fn();
      if ("error" in res && !res.ok) setNote({ kind: "bad", text: String((res as { error: string }).error) });
      else after?.();
      router.refresh();
    });
  };

  const doImport = (batch: ImportPersonInput[]) =>
    run(
      async () => {
        const res = await importSm8Staff(batch);
        if (res.ok) {
          const skipped = res.skipped ? ` ${res.skipped} skipped — already imported or no longer in ServiceM8.` : "";
          setNote({
            kind: "ok",
            text: `Imported ${res.imported} ${res.imported === 1 ? "person" : "people"}.${skipped} They appear in Team greyed out until they accept an invite.`,
          });
        }
        return res;
      },
      () => setSelected(new Set()),
    );

  if (error) {
    return (
      <div className="card2">
        <div className="c2h">
          <span className="ci">
            <Icon name="users" size={19} />
          </span>
          <div>
            <b>People in ServiceM8</b>
            <em>{error}</em>
          </div>
        </div>
      </div>
    );
  }
  if (rows.length === 0) return null;

  const selectable = shown.filter((r) => r.kind === "new");
  const allPicked = selectable.length > 0 && selectable.every((r) => selected.has(r.person.uuid));

  return (
    <div className="card2">
      <div className="c2h">
        <span className="ci">
          <Icon name="users" size={19} />
        </span>
        <div style={{ minWidth: 0 }}>
          <b>People in ServiceM8</b>
          <em>
            {pending.length === 0
              ? "Everyone in this account is matched to a card here."
              : `${pending.filter((r) => r.kind === "suggested").length} possible ${
                  pending.filter((r) => r.kind === "suggested").length === 1 ? "match" : "matches"
                } · ${pending.filter((r) => r.kind === "new").length} not here yet · ${linked.length} linked. Review each field before it lands — untick or edit anything stale.`}
          </em>
        </div>
      </div>

      {note && <div className={`int-note ${note.kind}`}>{note.text}</div>}

      {shown.length > 0 && (
        <div className="sp-tools">
          <label className="sp-selall">
            <input
              type="checkbox"
              checked={allPicked}
              onChange={() =>
                setSelected(allPicked ? new Set() : new Set(selectable.map((r) => r.person.uuid)))
              }
            />
            Select all new
          </label>
          {hiddenInactive > 0 && (
            <button className="sp-ghostbtn" onClick={() => setShowInactive((v) => !v)}>
              {showInactive ? "Hide" : "Show"} {hiddenInactive} inactive
            </button>
          )}
        </div>
      )}

      <div className="sp-rows">
        {shown.map((row) => {
          const { person } = row;
          const f = fieldsOf(row);
          const isOpen = open.has(person.uuid);
          const meta = [
            f.incTitle && f.jobTitle.trim() ? f.jobTitle.trim() : null,
            f.incEmail && f.email.trim() ? f.email.trim() : null,
            f.incPhone && f.phone.trim() ? f.phone.trim() : null,
          ].filter(Boolean);

          return (
            <div key={person.uuid} className={`sp-row${person.active ? "" : " off"}`}>
              <div className="sp-line">
                {row.kind === "new" ? (
                  <label className="sp-check">
                    <input
                      type="checkbox"
                      checked={selected.has(person.uuid)}
                      onChange={() =>
                        setSelected((s) => {
                          const next = new Set(s);
                          if (next.has(person.uuid)) next.delete(person.uuid);
                          else next.add(person.uuid);
                          return next;
                        })
                      }
                    />
                  </label>
                ) : (
                  <span className="sp-check" aria-hidden />
                )}
                <div className="sp-main">
                  <b>
                    {[f.firstName.trim(), f.lastName.trim()].filter(Boolean).join(" ") || person.name}
                    {!person.active && <span className="int-tag warn">Inactive in ServiceM8</span>}
                  </b>
                  {/* the values Import would write, always visible on the row */}
                  <em>{meta.length ? meta.join(" · ") : "Name only"}</em>
                  {row.kind === "suggested" && (
                    <span className="sp-sug">
                      Looks like <b>{row.staffName}</b> — same {row.reason === "email" ? "email address" : "name"}
                    </span>
                  )}
                </div>
                <div className="sp-act">
                  {row.kind === "suggested" ? (
                    <button
                      className="fl-btn tiny"
                      disabled={busy}
                      onClick={() => run(() => linkSm8Staff(row.staffProfileId, person.uuid, "auto"))}
                    >
                      <Icon name="check" size={13} />
                      Link
                    </button>
                  ) : (
                    <button
                      className="fl-btn tiny"
                      disabled={busy}
                      onClick={() => doImport([payloadOf(person.uuid, f)])}
                    >
                      <Icon name="download" size={13} />
                      Import
                    </button>
                  )}
                  <button
                    className="sp-ghostbtn"
                    aria-label={`Review fields for ${person.name}`}
                    onClick={() =>
                      setOpen((o) => {
                        const next = new Set(o);
                        if (next.has(person.uuid)) next.delete(person.uuid);
                        else next.add(person.uuid);
                        return next;
                      })
                    }
                  >
                    <Icon name="edit" size={14} />
                  </button>
                </div>
              </div>

              {isOpen && (
                <div className="sp-editor">
                  <label className="sp-f">
                    <span>First name</span>
                    <input
                      aria-label="First name"
                      value={f.firstName}
                      onChange={(e) => patch(person.uuid, row, { firstName: e.target.value })}
                    />
                  </label>
                  <label className="sp-f">
                    <span>Last name</span>
                    <input
                      aria-label="Last name"
                      value={f.lastName}
                      onChange={(e) => patch(person.uuid, row, { lastName: e.target.value })}
                    />
                  </label>
                  <label className={`sp-f${f.incTitle ? "" : " out"}`}>
                    <span>
                      <input
                        type="checkbox"
                        aria-label="Include job title"
                        checked={f.incTitle}
                        onChange={(e) => patch(person.uuid, row, { incTitle: e.target.checked })}
                      />
                      Job title
                    </span>
                    <input
                      aria-label="Job title"
                      value={f.jobTitle}
                      disabled={!f.incTitle}
                      onChange={(e) => patch(person.uuid, row, { jobTitle: e.target.value })}
                    />
                  </label>
                  <label className={`sp-f${f.incEmail ? "" : " out"}`}>
                    <span>
                      <input
                        type="checkbox"
                        aria-label="Include email"
                        checked={f.incEmail}
                        onChange={(e) => patch(person.uuid, row, { incEmail: e.target.checked })}
                      />
                      Email — prefills their invite
                    </span>
                    <input
                      aria-label="Email"
                      value={f.email}
                      disabled={!f.incEmail}
                      onChange={(e) => patch(person.uuid, row, { email: e.target.value })}
                    />
                  </label>
                  <label className={`sp-f${f.incPhone ? "" : " out"}`}>
                    <span>
                      <input
                        type="checkbox"
                        aria-label="Include mobile"
                        checked={f.incPhone}
                        onChange={(e) => patch(person.uuid, row, { incPhone: e.target.checked })}
                      />
                      Mobile
                    </span>
                    <input
                      aria-label="Mobile"
                      value={f.phone}
                      disabled={!f.incPhone}
                      onChange={(e) => patch(person.uuid, row, { phone: e.target.value })}
                    />
                  </label>

                  <div className="sp-editorfoot">
                    {row.kind === "suggested" ? (
                      /* one step past Link on purpose — importing a suggested
                         person is how one human becomes two records */
                      <button
                        className="fl-btn tiny"
                        disabled={busy}
                        onClick={() => doImport([payloadOf(person.uuid, f)])}
                      >
                        <Icon name="download" size={13} />
                        Import as a new card instead
                      </button>
                    ) : (
                      linkable.length > 0 && (
                        <span className="sp-linkpick">
                          <select
                            value={pick[person.uuid] ?? ""}
                            onChange={(e) =>
                              setPick((p) => ({ ...p, [person.uuid]: e.target.value }))
                            }
                          >
                            <option value="">They&apos;re already here as…</option>
                            {linkable.map((s) => (
                              <option key={s.staffProfileId} value={s.staffProfileId}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                          <button
                            className="fl-btn tiny"
                            disabled={busy || !pick[person.uuid]}
                            onClick={() =>
                              run(() => linkSm8Staff(pick[person.uuid], person.uuid, "manual"))
                            }
                          >
                            Link
                          </button>
                        </span>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {shown.length === 0 && pending.length > 0 && (
          <div className="sp-empty">Only inactive ServiceM8 logins left — show them above to import.</div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="sp-bulk">
          <span>
            {selected.size} selected — the values shown on each row are what lands
          </span>
          <button
            className="fl-btn tiny"
            disabled={busy}
            onClick={() =>
              doImport(
                shown
                  .filter((r) => selected.has(r.person.uuid))
                  .map((r) => payloadOf(r.person.uuid, fieldsOf(r))),
              )
            }
          >
            <Icon name="download" size={13} />
            {busy ? "Importing…" : `Import ${selected.size} selected`}
          </button>
        </div>
      )}

      {linked.length > 0 && (
        <div className="sp-linked">
          <button className="sp-ghostbtn" onClick={() => setShowLinked((v) => !v)}>
            <Icon name={showLinked ? "chevD" : "chevR"} size={13} />
            Already linked ({linked.length})
          </button>
          {showLinked &&
            linked.map((row) =>
              row.kind === "linked" ? (
                <div key={row.person.uuid} className="sp-row linkedrow">
                  <div className="sp-line">
                    <span className="sp-check" aria-hidden />
                    <div className="sp-main">
                      <b>{row.person.name}</b>
                      <em>
                        is <b>{row.staffName}</b> here
                      </em>
                    </div>
                    <div className="sp-act">
                      <button
                        className={`fl-btn tiny${armed === row.person.uuid ? " danger arm" : ""}`}
                        disabled={busy}
                        onBlur={() => setArmed((a) => (a === row.person.uuid ? null : a))}
                        onClick={() => {
                          if (armed !== row.person.uuid) return setArmed(row.person.uuid);
                          setArmed(null);
                          run(() => unlinkSm8Staff(row.staffProfileId));
                        }}
                      >
                        {armed === row.person.uuid ? "Confirm unlink" : "Unlink"}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null,
            )}
        </div>
      )}
    </div>
  );
}
