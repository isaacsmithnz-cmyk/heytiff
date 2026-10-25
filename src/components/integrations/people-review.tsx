"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/parts/button";
import { Chooser } from "@/components/parts/chooser";
import { Dialog } from "@/components/parts/dialog";
import { Field, TextInput } from "@/components/parts/field";
import { Dot, StateWord } from "@/components/parts/state";
import { Tick } from "@/components/parts/tick";
import { Setting } from "@/components/settings/parts";
import type { PersonRow } from "@/lib/integrations/people-import";
import { NOTE_WORDS } from "@/lib/integrations/sm8-note-words";
import type { ImportPersonInput, ImportProvider } from "@/app/actions/staff-import";
import type { PeopleCardData } from "./types";

/* The actions are reached through a dynamic import, never a top-level one.
   A `"use server"` module drags next/cache into whatever imports it, and in
   jsdom that is a `ReferenceError: Request is not defined`, which lands not
   here but in the suite of any screen that renders this. Same shape as the
   Time & Pay panel's `(await import("@/app/actions/xero-links"))`. */
const actions = () => import("@/app/actions/staff-import");

/* PEOPLE IN SERVICEM8, PEOPLE IN XERO: one row in the app's group, and the
   review it opens (v2, 25 October 2026; the mock's "People in ServiceM8",
   Review people). Import is a REVIEW, not a copy, and one component serves
   every connected app, because "which fields land on a card" must not
   become a per-app opinion.

   Every value a card would receive is on screen before anything is written:
   each person's line is the title, email and phone that would land, and
   Edit fields opens them, where each can be unticked or corrected. Import
   sends exactly what is ticked at that moment, so a value that never
   appeared here can never reach a card, and the server re-checks the FACTS
   (which ids exist, who's active) against the app live either way.

   A possible match leads with Link, because a match means NO new card: the
   whole track exists so one human never becomes two records. Importing a
   possible match as a new card is inside its fields, one step further away.

   Nothing here runs by itself. Connecting doesn't import, opening doesn't
   import; the buttons import. */

/** The app's name in the sentences, and where an unlink belongs. A
    ServiceM8 link is unlinked here; a Xero payroll link is unmatched from
    Time & Pay, where the same act also settles the wage drift it carries,
    so this sends people there rather than offering a weaker second control
    over the same decision. */
const APPS: Record<ImportProvider, { label: string; unlinkHere: boolean; unlinkNote?: string }> = {
  servicem8: { label: "ServiceM8", unlinkHere: true },
  xero: {
    label: "Xero",
    unlinkHere: false,
    unlinkNote: "Unmatch from Time & Pay. That screen settles pay-rate drift at the same time.",
  },
};

/** Per-person review state: the values, and which of the optional ones
    are ticked. Seeded from the app's person, then owned by the reviewer. */
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

function seedFields(row: PersonRow): FieldState {
  return {
    firstName: row.person.first ?? "",
    lastName: row.person.last ?? "",
    jobTitle: row.person.jobTitle ?? "",
    email: row.person.email ?? "",
    phone: row.person.phone ?? "",
    incTitle: !!row.person.jobTitle,
    incEmail: !!row.person.email,
    incPhone: !!row.person.phone,
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

/** "3 possible matches, 21 not here yet, 2 linked", leaving out what is
    none. */
function countsLine(rows: readonly PersonRow[]): string {
  const suggested = rows.filter((r) => r.kind === "suggested").length;
  const fresh = rows.filter((r) => r.kind === "new").length;
  const linked = rows.filter((r) => r.kind === "linked").length;
  if (suggested + fresh === 0) return "Everyone in this account is matched to a card here.";
  return [
    suggested > 0 ? `${suggested} possible ${suggested === 1 ? "match" : "matches"}` : null,
    fresh > 0 ? `${fresh} not here yet` : null,
    linked > 0 ? `${linked} linked` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

export function PeopleReview({ provider, rows, linkable, error }: PeopleCardData & { provider: ImportProvider }) {
  const [open, setOpen] = useState(false);
  const label = APPS[provider].label;
  if (error) return <Setting name={`People in ${label}`} line={error} />;
  if (rows.length === 0) return null;
  return (
    <>
      <Setting name={`People in ${label}`} line={countsLine(rows)}>
        <Button kind="second" size={32} onClick={() => setOpen(true)}>
          Review people
        </Button>
      </Setting>
      {open && <PeopleDialog provider={provider} rows={rows} linkable={linkable} onClose={() => setOpen(false)} />}
    </>
  );
}

function PeopleDialog({
  provider,
  rows,
  linkable,
  onClose,
}: {
  provider: ImportProvider;
  rows: PersonRow[];
  linkable: PeopleCardData["linkable"];
  onClose: () => void;
}) {
  const app = APPS[provider];
  const router = useRouter();
  const [busy, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [fields, setFields] = useState<Record<string, FieldState>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [showInactive, setShowInactive] = useState(false);
  const [showLinked, setShowLinked] = useState(false);
  // two-step unlink, like every destructive small button here
  const [armed, setArmed] = useState<string | null>(null);
  // the manual "match to someone already here" pick, per person
  const [pick, setPick] = useState<Record<string, string>>({});

  const linked = useMemo(() => rows.filter((r) => r.kind === "linked"), [rows]);
  const pending = useMemo(() => rows.filter((r) => r.kind !== "linked"), [rows]);
  const hiddenInactive = pending.filter((r) => !r.person.active).length;
  /* possible matches first: resolving them prevents duplicates, which is
     the review's whole reason to exist */
  const shown = useMemo(
    () =>
      [...pending]
        .filter((r) => showInactive || r.person.active)
        .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "suggested" ? -1 : 1)),
    [pending, showInactive],
  );

  const fieldsOf = (row: PersonRow): FieldState => fields[row.person.id] ?? seedFields(row);
  const patch = (row: PersonRow, p: Partial<FieldState>) =>
    setFields((f) => ({ ...f, [row.person.id]: { ...(f[row.person.id] ?? seedFields(row)), ...p } }));
  const toggle = (set: (fn: (s: Set<string>) => Set<string>) => void, id: string) =>
    set((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) => {
    setNote(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setNote({ ok: false, text: res.error });
      else after?.();
      router.refresh();
    });
  };

  const doImport = (batch: ImportPersonInput[]) =>
    run(
      async () => {
        const res = await (await actions()).importPeople(provider, batch);
        if (res.ok) {
          const skipped = res.skipped ? ` ${res.skipped} skipped: already imported or no longer in ${app.label}.` : "";
          setNote({
            ok: true,
            text: `Imported ${res.imported} ${res.imported === 1 ? "person" : "people"}.${skipped} They appear in Team greyed out until they accept an invite.`,
          });
        }
        return res;
      },
      () => setSelected(new Set()),
    );

  const selectable = shown.filter((r) => r.kind === "new");
  const allPicked = selectable.length > 0 && selectable.every((r) => selected.has(r.person.id));
  const linkOptions = linkable.map((s) => ({ value: s.staffProfileId, label: s.name }));

  return (
    <Dialog
      heading={`People in ${app.label}`}
      onClose={onClose}
      width={720}
      foot={
        <>
          <Button kind="second" size={36} onClick={onClose} data-autofocus>
            Done
          </Button>
          {selected.size > 0 && (
            <Button
              kind="main"
              size={36}
              disabled={busy}
              onClick={() => doImport(shown.filter((r) => selected.has(r.person.id)).map((r) => payloadOf(r.person.id, fieldsOf(r))))}
            >
              {busy ? "Importing the staff" : `Import ${selected.size} selected`}
            </Button>
          )}
        </>
      }
    >
      <p className="st2-int-pline">{countsLine(rows)}</p>
      {note && (
        <p className={`st2-int-pnote${note.ok ? "" : " st2-int-pnote--wrong"}`} role={note.ok ? "status" : "alert"}>
          <Dot hue={note.ok ? "green" : "red"} />
          <span>{note.text}</span>
        </p>
      )}

      {(selectable.length > 0 || hiddenInactive > 0) && (
        <div className="st2-int-ptools">
          {selectable.length > 0 && (
            <Tick
              label="Select all new"
              checked={allPicked}
              onChange={() => setSelected(allPicked ? new Set() : new Set(selectable.map((r) => r.person.id)))}
            />
          )}
          {hiddenInactive > 0 && (
            <Button kind="quiet" size={32} onClick={() => setShowInactive((v) => !v)}>
              {`${showInactive ? "Hide" : "Show"} ${hiddenInactive} inactive`}
            </Button>
          )}
        </div>
      )}

      <ul className="st2-int-people">
        {shown.map((row) => {
          const { person } = row;
          const f = fieldsOf(row);
          const isOpen = editing.has(person.id);
          // exactly the optional values this import would write, live
          const willLand = [
            f.incTitle && f.jobTitle.trim() ? f.jobTitle.trim() : null,
            f.incEmail && f.email.trim() ? f.email.trim() : null,
            f.incPhone && f.phone.trim() ? f.phone.trim() : null,
          ].filter(Boolean);
          const name = [f.firstName.trim(), f.lastName.trim()].filter(Boolean).join(" ") || person.name;

          return (
            <li key={person.id} className="st2-int-person">
              <div className="st2-int-pline-row">
                <span className="st2-int-pick">
                  {row.kind === "new" && (
                    <Tick
                      label={<span className="st2-int-hide">Choose {name}</span>}
                      checked={selected.has(person.id)}
                      onChange={() => toggle(setSelected, person.id)}
                    />
                  )}
                </span>
                <div className="st2-int-pmain">
                  <span className="st2-int-pname">
                    {name}
                    {!person.active && <StateWord tone="look">Inactive in {app.label}</StateWord>}
                  </span>
                  {/* the values Import would write, always on the row */}
                  <span className="st2-int-pfacts">{willLand.length ? willLand.join(", ") : "Name only"}</span>
                  {row.kind === "suggested" && (
                    <span className="st2-int-pfacts">
                      Looks like <b>{row.staffName}</b>, same {row.reason === "email" ? "email address" : "name"}
                    </span>
                  )}
                </div>
                <span className="st2-int-pend">
                  {row.kind === "suggested" ? (
                    <Button
                      kind="second"
                      size={32}
                      disabled={busy}
                      onClick={() => run(async () => (await actions()).linkPerson(provider, row.staffProfileId, person.id, "auto"))}
                    >
                      Link
                    </Button>
                  ) : (
                    <Button kind="second" size={32} disabled={busy} onClick={() => doImport([payloadOf(person.id, f)])}>
                      Import
                    </Button>
                  )}
                  <Button
                    kind="quiet"
                    size={32}
                    aria-expanded={isOpen}
                    aria-label={`Review fields for ${person.name}`}
                    onClick={() => toggle(setEditing, person.id)}
                  >
                    {isOpen ? "Hide fields" : "Edit fields"}
                  </Button>
                </span>
              </div>

              {isOpen && (
                <div className="st2-int-pedit">
                  <Field label="First name">
                    <TextInput size={32} value={f.firstName} onChange={(e) => patch(row, { firstName: e.target.value })} />
                  </Field>
                  <Field label="Last name">
                    <TextInput size={32} value={f.lastName} onChange={(e) => patch(row, { lastName: e.target.value })} />
                  </Field>
                  <div className="st2-int-pfield">
                    <Tick label="Include job title" checked={f.incTitle} onChange={(on) => patch(row, { incTitle: on })} />
                    <Field label="Job title">
                      <TextInput size={32} value={f.jobTitle} disabled={!f.incTitle} onChange={(e) => patch(row, { jobTitle: e.target.value })} />
                    </Field>
                  </div>
                  <div className="st2-int-pfield">
                    <Tick label="Include email" checked={f.incEmail} onChange={(on) => patch(row, { incEmail: on })} />
                    <Field label="Email">
                      <TextInput size={32} value={f.email} disabled={!f.incEmail} onChange={(e) => patch(row, { email: e.target.value })} />
                    </Field>
                  </div>
                  <div className="st2-int-pfield">
                    <Tick label="Include mobile" checked={f.incPhone} onChange={(on) => patch(row, { incPhone: on })} />
                    <Field label="Mobile">
                      <TextInput size={32} value={f.phone} disabled={!f.incPhone} onChange={(e) => patch(row, { phone: e.target.value })} />
                    </Field>
                  </div>
                  <div className="st2-int-pfoot">
                    {row.kind === "suggested" ? (
                      /* one step past Link on purpose: importing a possible
                         match is how one human becomes two records */
                      <Button kind="second" size={32} disabled={busy} onClick={() => doImport([payloadOf(person.id, f)])}>
                        Import as a new card instead
                      </Button>
                    ) : (
                      linkOptions.length > 0 && (
                        <>
                          <Chooser
                            size={32}
                            className="st2-int-pchoose"
                            aria-label={`Match ${person.name} to someone already here`}
                            placeholder="Match to someone already here"
                            options={linkOptions}
                            value={pick[person.id] ?? null}
                            onChange={(v) => setPick((p) => ({ ...p, [person.id]: v }))}
                          />
                          <Button
                            kind="second"
                            size={32}
                            disabled={busy || !pick[person.id]}
                            onClick={() => run(async () => (await actions()).linkPerson(provider, pick[person.id], person.id, "manual"))}
                          >
                            Link to them
                          </Button>
                        </>
                      )
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && pending.length > 0 && (
        <p className="st2-int-pline">Only inactive {app.label} people are left. Show them to import them.</p>
      )}

      {linked.length > 0 && (
        <div className="st2-int-plinked">
          <Button kind="quiet" size={32} aria-expanded={showLinked} onClick={() => setShowLinked((v) => !v)}>
            {showLinked ? "Hide the linked" : `Show the ${linked.length} linked`}
          </Button>
          {showLinked && (
            <ul className="st2-int-people">
              {linked.map((row) =>
                row.kind === "linked" ? (
                  <li key={row.person.id} className="st2-int-person">
                    <div className="st2-int-pline-row">
                      <span className="st2-int-pick" />
                      <div className="st2-int-pmain">
                        <span className="st2-int-pname">{row.person.name}</span>
                        <span className="st2-int-pfacts">
                          is <b>{row.staffName}</b> here
                        </span>
                        {/* they said this link isn't them: fixed here */}
                        {row.denied && <StateWord tone="look">{NOTE_WORDS.door.peopleDenied}</StateWord>}
                      </div>
                      <span className="st2-int-pend">
                        {app.unlinkHere ? (
                          <Button
                            kind="delete"
                            size={32}
                            disabled={busy}
                            onBlur={() => setArmed((a) => (a === row.person.id ? null : a))}
                            onClick={() => {
                              if (armed !== row.person.id) return setArmed(row.person.id);
                              setArmed(null);
                              run(async () => (await actions()).unlinkSm8Staff(row.staffProfileId));
                            }}
                          >
                            {armed === row.person.id ? "Confirm unlink" : "Unlink"}
                          </Button>
                        ) : (
                          <span className="st2-int-pfacts">{app.unlinkNote}</span>
                        )}
                      </span>
                    </div>
                  </li>
                ) : null,
              )}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  );
}
