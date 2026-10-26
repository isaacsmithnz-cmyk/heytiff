"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Dialog, type DialogWidth } from "@/components/parts/dialog";
import { Button } from "@/components/parts/button";
import { Chooser, type ChooserOption } from "@/components/parts/chooser";
import { Field, TextArea, TextInput } from "@/components/parts/field";
import { StateWord, type Tone } from "@/components/parts/state";
import { Tick } from "@/components/parts/tick";
import { DateField } from "@/components/ui/date-field";
import { fmtAud, parseAudToCents } from "@/lib/workboard/project-money";
import { MONEY_BASIS } from "@/lib/workboard/job-money";
import type { JobSearchHit, ProjectDetail } from "@/lib/workboard/projects-query";
import { listDesignOptions, searchJobs } from "@/app/actions/workboard";
import { readEquipmentPhoto } from "@/app/actions/workboard-ai";
import { withCleanup } from "@/lib/ui/with-cleanup";
import { fileToUprightBase64 } from "@/lib/images/upright";

/* A PROJECT'S FORMS, on the v2 Dialog (Isaac, 27 October 2026, on the
   old screens' mocks: the pop-ups mock's "Project forms"). They all went
   through the Workboard's own modal shell, with a cross in the corner and a
   subtitle under each title explaining the form; the subtitles were hint
   text and the shell is gone. Cancel is the quiet button beside the one blue
   press, and every button names its thing ("Block project", "Save
   project").

   Each form only gathers and checks what's typed; the page runs the action
   it hands back and closes the form, so a form never talks to the server
   except to read (ServiceM8's jobs, the Studio's designs, a nameplate). */

type Close = { onClose: () => void };

/** The foot every form here has: Cancel, quiet, then the one blue press. */
function Foot({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <>
      <Button kind="quiet" onClick={onClose}>
        Cancel
      </Button>
      {children}
    </>
  );
}

function Form({
  heading,
  width = 560,
  onClose,
  foot,
  children,
}: {
  heading: string;
  width?: DialogWidth;
  onClose: () => void;
  foot: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog heading={heading} width={width} onClose={onClose} foot={<Foot onClose={onClose}>{foot}</Foot>}>
      <div className="mk-form">{children}</div>
    </Dialog>
  );
}

/* ── the status ── */

export function BlockForm({ onClose, onBlock }: Close & { onBlock: (reason: string, on: string) => void }) {
  const [on, setOn] = useState("");
  const [reason, setReason] = useState("");
  const ready = !!on.trim() && !!reason.trim();
  return (
    <Form
      heading="Block the project"
      onClose={onClose}
      foot={
        <Button kind="main" disabled={!ready} onClick={() => onBlock(reason.trim(), on.trim())}>
          Block project
        </Button>
      }
    >
      <Field label="Waiting on">
        <TextInput value={on} onChange={(e) => setOn(e.target.value)} placeholder="The builder, the sparky, council" data-autofocus />
      </Field>
      <Field label="Why">
        <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Switchboard upgrade not done" />
      </Field>
    </Form>
  );
}

export type ProjectMetaPatch = {
  name?: string;
  clientName?: string | null;
  siteLabel?: string | null;
  siteAddress?: string | null;
};

export function EditProjectForm({ project, onClose, onSave }: Close & { project: ProjectDetail; onSave: (patch: ProjectMetaPatch) => void }) {
  const [name, setName] = useState(project.name);
  const [clientName, setClientName] = useState(project.clientName ?? "");
  const [siteLabel, setSiteLabel] = useState(project.siteLabel ?? "");
  const [siteAddress, setSiteAddress] = useState(project.siteAddress ?? "");
  return (
    <Form
      heading="Edit project"
      onClose={onClose}
      foot={
        <Button kind="main" disabled={!name.trim()} onClick={() => onSave({ name, clientName, siteLabel, siteAddress })}>
          Save project
        </Button>
      }
    >
      <Field label="Name">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} data-autofocus />
      </Field>
      <div className="mk-pair">
        <Field label="Client">
          <TextInput value={clientName} onChange={(e) => setClientName(e.target.value)} />
        </Field>
        <Field label="Site label">
          <TextInput value={siteLabel} onChange={(e) => setSiteLabel(e.target.value)} />
        </Field>
      </div>
      <Field label="Site address">
        <TextInput value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} />
      </Field>
    </Form>
  );
}

/* ── jobs and equipment ── */

const ROLES: readonly ChooserOption[] = [
  { value: "quote", label: "Quote" },
  { value: "install", label: "Install" },
  { value: "variation", label: "Variation" },
  { value: "service", label: "Service" },
  { value: "other", label: "Other" },
];

export type AttachInput = { jobNumber?: string; remoteId?: string; role?: string };

export function AttachJobForm({ sm8Connected, onClose, onAttach }: Close & { sm8Connected: boolean; onAttach: (input: AttachInput) => void }) {
  const [role, setRole] = useState("install");
  const [jobNumber, setJobNumber] = useState("");
  const [hits, setHits] = useState<JobSearchHit[]>([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  /* the last search asked is the one shown: an earlier, slower answer never lands over it */
  const asked = useRef(0);

  const find = async (q: string) => {
    setQuery(q);
    const n = ++asked.current;
    if (q.trim().length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const found = await searchJobs(q);
    if (n !== asked.current) return;
    setHits(found);
    setSearching(false);
  };

  return (
    <Form
      heading="Attach a job"
      width={720}
      onClose={onClose}
      foot={
        <Button kind="main" disabled={!jobNumber.trim()} onClick={() => onAttach({ jobNumber: jobNumber.trim(), role })}>
          Attach job
        </Button>
      }
    >
      <div className={`pj-attach${sm8Connected ? "" : " pj-attach--typed"}`}>
        <Field label="Role on this project">
          <Chooser options={ROLES} value={role} onChange={setRole} />
        </Field>
        <Field label="Job number">
          <TextInput value={jobNumber} onChange={(e) => setJobNumber(e.target.value)} placeholder="1042" inputMode="numeric" data-autofocus />
        </Field>
        {sm8Connected && (
          <Field label="Or find it in ServiceM8">
            <TextInput value={query} onChange={(e) => void find(e.target.value)} placeholder="A number, a client or an address" />
          </Field>
        )}
      </div>
      {sm8Connected && searching && <p className="pj-dlg-cap">Searching ServiceM8</p>}
      {sm8Connected && hits.length > 0 && (
        <ul className="pj-hits" aria-label="Jobs in ServiceM8">
          {hits.map((h) => (
            <li key={h.remoteId} className="pj-hit">
              <b className="pj-hit-no">{h.jobNumber ?? "No number"}</b>
              <span className="pj-hit-text">
                <b>{h.clientName ?? "No client"}</b>
                <span>{[h.suburb, h.linkedTo.length ? `already on ${h.linkedTo.join(" and ")}` : null].filter(Boolean).join(", ")}</span>
              </span>
              {h.status && <StateWord tone="info">{h.status}</StateWord>}
              <Button
                size={32}
                aria-label={`Attach job ${h.jobNumber ?? h.clientName ?? ""}`.trim()}
                onClick={() => onAttach({ remoteId: h.remoteId, role })}
              >
                Attach job
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Form>
  );
}

export type EquipmentInput = { description: string; model?: string; serial?: string; locationNote?: string };

/** What reading the nameplate came to, as a state word. */
type Read = { tone: Tone; word: string } | null;

export function EquipmentForm({ onClose, onAdd }: Close & { onAdd: (input: EquipmentInput, photo: File | null) => void }) {
  const [description, setDescription] = useState("");
  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");
  const [locationNote, setLocationNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [keepPhoto, setKeepPhoto] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [read, setRead] = useState<Read>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  /* the photo's own picture beside what was read from it, let go when
     another is chosen and when the form closes */
  const shown = useRef<string | null>(null);
  useEffect(() => () => {
    if (shown.current) URL.revokeObjectURL(shown.current);
  }, []);
  const show = (file: File) => {
    if (typeof URL.createObjectURL !== "function") return;
    if (shown.current) URL.revokeObjectURL(shown.current);
    shown.current = URL.createObjectURL(file);
    setThumb(shown.current);
  };

  const scan = async (file: File) => {
    setPhoto(file);
    show(file);
    setRead(null);
    if (!file.type.startsWith("image/")) return;
    setScanning(true);
    await withCleanup(async () => {
      const img = await fileToUprightBase64(file);
      const res = await readEquipmentPhoto(img.data, img.mediaType);
      if (res.ok) {
        // a draft, never a decision: it fills only what's still empty
        if (res.read.description && !description) setDescription(res.read.description);
        if (res.read.model && !model) setModel(res.read.model);
        if (res.read.serial && !serial) setSerial(res.read.serial);
        setRead(
          res.read.model || res.read.serial
            ? { tone: "good", word: "Read from the nameplate" }
            : { tone: "look", word: "Couldn't make out a model or serial" },
        );
      } else {
        setRead(res.reason === "no-key" ? { tone: "info", word: "Photo kept, not read" } : { tone: "look", word: res.reason });
      }
    }, () => setScanning(false));
  };

  return (
    <Form
      heading="Add equipment"
      onClose={onClose}
      foot={
        <Button
          kind="main"
          disabled={!description.trim() || scanning}
          onClick={() => onAdd({ description, model, serial, locationNote }, keepPhoto ? photo : null)}
        >
          Add equipment
        </Button>
      }
    >
      <input
        ref={picker}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        aria-label="Photo of the unit or its nameplate"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void scan(f);
        }}
      />
      {photo ? (
        <>
          <div className="pj-photo">
            {thumb ? (
              /* a blob: URL of the photo just chosen, which next/image can't fetch */
              // eslint-disable-next-line @next/next/no-img-element
              <img className="pj-thumb" src={thumb} alt="" />
            ) : (
              <span className="pj-thumb" aria-hidden="true" />
            )}
            <span className="pj-photo-read">
              {scanning ? <StateWord tone="info">Reading the nameplate</StateWord> : read && <StateWord tone={read.tone}>{read.word}</StateWord>}
            </span>
            <Button kind="quiet" size={32} disabled={scanning} onClick={() => picker.current?.click()}>
              Choose another
            </Button>
          </div>
          <Tick label="Keep the photo with the project's files" checked={keepPhoto} onChange={setKeepPhoto} />
        </>
      ) : (
        <div className="pj-photo">
          <Button icon="cam" onClick={() => picker.current?.click()}>
            Read the nameplate
          </Button>
        </div>
      )}
      <Field label="Description">
        <TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ducted indoor unit" data-autofocus />
      </Field>
      <div className="mk-pair">
        <Field label="Model">
          <TextInput value={model} onChange={(e) => setModel(e.target.value)} placeholder="PEAD-M100" />
        </Field>
        <Field label="Serial">
          <TextInput value={serial} onChange={(e) => setSerial(e.target.value)} />
        </Field>
      </div>
      <Field label="Where on site">
        <TextInput value={locationNote} onChange={(e) => setLocationNote(e.target.value)} placeholder="Roof space above hallway" />
      </Field>
    </Form>
  );
}

/* ── money ── */

export type ClaimInput = { label: string; amountCents: number; variationId?: string | null };

export function ClaimForm({ project, onClose, onAdd }: Close & { project: ProjectDetail; onAdd: (input: ClaimInput) => void }) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [variationId, setVariationId] = useState("");
  const cents = parseAudToCents(amount);
  const approved = project.variations.filter((v) => v.status === "approved");
  const options: ChooserOption[] = [{ value: "", label: "No, base work" }, ...approved.map((v) => ({ value: v.id, label: v.title }))];
  return (
    <Form
      heading="Add a claim"
      onClose={onClose}
      foot={
        <Button
          kind="main"
          disabled={!label.trim() || cents === null || cents <= 0}
          onClick={() => onAdd({ label: label.trim(), amountCents: cents!, variationId: variationId || null })}
        >
          Add claim
        </Button>
      }
    >
      <Field label="Label">
        <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Deposit, Rough-in claim, Final" data-autofocus />
      </Field>
      <div className="mk-pair">
        <Field label="Amount ($)">
          <TextInput value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10,000" inputMode="decimal" />
        </Field>
        {approved.length > 0 && (
          <Field label="For a variation">
            <Chooser options={options} value={variationId} onChange={setVariationId} />
          </Field>
        )}
      </div>
    </Form>
  );
}

export type VariationInput = { title: string; detail?: string; amountCents: number };

export function VariationForm({ onClose, onAdd }: Close & { onAdd: (input: VariationInput) => void }) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [detail, setDetail] = useState("");
  const cents = parseAudToCents(amount);
  return (
    <Form
      heading="Add a variation"
      onClose={onClose}
      foot={
        <Button
          kind="main"
          disabled={!title.trim() || cents === null || cents === 0}
          onClick={() => onAdd({ title: title.trim(), detail: detail.trim() || undefined, amountCents: cents! })}
        >
          Add variation
        </Button>
      }
    >
      <Field label="What it is">
        <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Extra return-air grille" data-autofocus />
      </Field>
      <div className="mk-pair">
        <Field label="Amount ($)">
          <TextInput value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="4,000 or -1,500" inputMode="decimal" />
        </Field>
      </div>
      <Field label="Detail">
        <TextArea value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Why, and what it covers" />
      </Field>
    </Form>
  );
}

/** Approve or decline: the same dialog, the blue press says which (Decline loses nothing, so it isn't red). */
export function DecideForm({
  to,
  variation,
  onClose,
  onDecide,
}: Close & {
  to: "approved" | "declined";
  variation: { title: string; amountCents: number };
  onDecide: (who: string) => void;
}) {
  const [who, setWho] = useState("");
  const verb = to === "approved" ? "Approve" : "Decline";
  const go = () => {
    if (who.trim()) onDecide(who.trim());
  };
  return (
    <Form
      heading={`${verb} the variation`}
      width={400}
      onClose={onClose}
      foot={
        <Button kind="main" disabled={!who.trim()} onClick={go}>
          {`${verb} variation`}
        </Button>
      }
    >
      <p className="pj-dlg-line">
        {variation.title}, {variation.amountCents > 0 ? "" : "−"}
        {fmtAud(Math.abs(variation.amountCents))}.
      </p>
      <Field label={to === "approved" ? "Who approved it" : "Who declined it"}>
        <TextInput
          value={who}
          onChange={(e) => setWho(e.target.value)}
          placeholder="Sarah Bowden (client)"
          data-autofocus
          onKeyDown={(e) => {
            if (e.key === "Enter") go();
          }}
        />
      </Field>
    </Form>
  );
}

/** The job total, typed on the money's basis: blank clears it. */
export function TotalForm({
  cents: was,
  onClose,
  onSave,
}: Close & { cents: number | null; onSave: (cents: number | null) => void }) {
  const [text, setText] = useState(was !== null ? String(was / 100) : "");
  const [wrong, setWrong] = useState<string | null>(null);
  const save = () => {
    const raw = text.trim();
    if (raw === "") return onSave(null);
    const cents = parseAudToCents(raw);
    if (cents === null || cents < 0) {
      setWrong("The total needs to be a dollar amount.");
      return;
    }
    onSave(cents);
  };
  return (
    <Form
      heading="Job total"
      width={400}
      onClose={onClose}
      foot={
        <Button kind="main" onClick={save}>
          Save total
        </Button>
      }
    >
      <Field label={`Total ($, ${MONEY_BASIS})`} error={wrong}>
        <TextInput
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setWrong(null);
          }}
          placeholder="50,000"
          inputMode="decimal"
          data-autofocus
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
        />
      </Field>
    </Form>
  );
}

/* ── trips, dates and hours ── */

export type TripInput = { label: string; dueDate: string; bookedDate: string | null };

export function TripForm({ today, onClose, onAdd }: Close & { today: string; onAdd: (input: TripInput) => void }) {
  const [label, setLabel] = useState("");
  const [around, setAround] = useState("");
  const [day, setDay] = useState("");
  const ids = useId();
  const ready = !!label.trim() && !!around;
  return (
    <Form
      heading="Add a trip"
      onClose={onClose}
      foot={
        <Button kind="main" disabled={!ready} onClick={() => onAdd({ label: label.trim(), dueDate: around, bookedDate: day || null })}>
          Add trip
        </Button>
      }
    >
      <Field label="What it's for">
        <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Rough-in day 1" data-autofocus />
      </Field>
      <div className="mk-pair">
        <Field label="Around" id={`${ids}-around`}>
          <DateField id={`${ids}-around`} today={today} clearable value={around || null} onChange={(iso) => setAround(iso ?? "")} />
        </Field>
        <Field label="Day booked" id={`${ids}-day`}>
          <DateField id={`${ids}-day`} today={today} clearable value={day || null} onChange={(iso) => setDay(iso ?? "")} />
        </Field>
      </div>
    </Form>
  );
}

export type MilestoneInput = { label: string; onDate: string };

export function MilestoneForm({ today, onClose, onAdd }: Close & { today: string; onAdd: (input: MilestoneInput) => void }) {
  const [label, setLabel] = useState("");
  const [day, setDay] = useState("");
  const dayId = useId();
  return (
    <Form
      heading="Add a milestone"
      onClose={onClose}
      foot={
        <Button kind="main" disabled={!label.trim() || !day} onClick={() => onAdd({ label: label.trim(), onDate: day })}>
          Add milestone
        </Button>
      }
    >
      <div className="mk-pair">
        <Field label="What it is">
          <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Crane booked" data-autofocus />
        </Field>
        <Field label="Day" id={dayId}>
          <DateField id={dayId} today={today} value={day || null} onChange={(iso) => setDay(iso ?? "")} />
        </Field>
      </div>
    </Form>
  );
}

/** A committed date: set, moved or cleared. */
export function DayForm({
  heading,
  value,
  today,
  onClose,
  onSave,
}: Close & { heading: string; value: string | null; today: string; onSave: (day: string | null) => void }) {
  const [day, setDay] = useState(value ?? "");
  const dayId = useId();
  return (
    <Dialog
      heading={heading}
      onClose={onClose}
      foot={
        <>
          <Button kind="quiet" onClick={onClose}>
            Cancel
          </Button>
          {value && <Button onClick={() => onSave(null)}>Clear date</Button>}
          <Button kind="main" disabled={!day || day === value} onClick={() => onSave(day)}>
            Save date
          </Button>
        </>
      }
    >
      <div className="mk-form">
        <Field label="Day" id={dayId}>
          <DateField id={dayId} today={today} value={day || null} onChange={(iso) => setDay(iso ?? "")} />
        </Field>
      </div>
    </Dialog>
  );
}

export function HoursForm({ hours, onClose, onSave }: Close & { hours: number | null; onSave: (hours: number | null) => void }) {
  const [text, setText] = useState(hours !== null ? String(hours) : "");
  const n = Number(text.trim());
  const bad = text.trim() !== "" && (!Number.isFinite(n) || n < 0);
  const save = () => {
    if (!bad) onSave(text.trim() === "" ? null : n);
  };
  return (
    <Form
      heading="Hours allowed"
      width={400}
      onClose={onClose}
      foot={
        <Button kind="main" disabled={bad} onClick={save}>
          Save hours
        </Button>
      }
    >
      <Field label="Hours" error={bad ? "Hours need to be a number." : null}>
        <TextInput
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="60"
          inputMode="decimal"
          data-autofocus
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
        />
      </Field>
    </Form>
  );
}

/* ── the checklist and the design ── */

export function SectionForm({ onClose, onAdd }: Close & { onAdd: (section: string, label: string) => void }) {
  const [section, setSection] = useState("");
  const [label, setLabel] = useState("");
  return (
    <Form
      heading="Add a section"
      onClose={onClose}
      foot={
        <Button kind="main" disabled={!section.trim() || !label.trim()} onClick={() => onAdd(section.trim(), label.trim())}>
          Add section
        </Button>
      }
    >
      <Field label="Section">
        <TextInput value={section} onChange={(e) => setSection(e.target.value)} placeholder="Defects" data-autofocus />
      </Field>
      <Field label="First item">
        <TextInput value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
    </Form>
  );
}

const NO_DESIGN = "";

export function DesignForm({ designId, onClose, onSave }: Close & { designId: string | null; onSave: (id: string | null) => void }) {
  const [options, setOptions] = useState<{ id: string; name: string }[] | null>(null);
  const [chosen, setChosen] = useState(designId ?? NO_DESIGN);
  useEffect(() => {
    let live = true;
    void listDesignOptions().then((o) => {
      if (live) setOptions(o);
    });
    return () => {
      live = false;
    };
  }, []);
  const list: ChooserOption[] = [{ value: NO_DESIGN, label: "No design" }, ...(options ?? []).map((o) => ({ value: o.id, label: o.name }))];
  return (
    <Form
      heading="Link a design"
      onClose={onClose}
      foot={
        <Button kind="main" disabled={options === null || chosen === (designId ?? NO_DESIGN)} onClick={() => onSave(chosen || null)}>
          Save design
        </Button>
      }
    >
      <Field label="Design">
        <Chooser
          options={list}
          value={chosen}
          onChange={setChosen}
          disabled={options === null}
          placeholder={options === null ? "Reading the designs" : "Choose a design"}
        />
      </Field>
    </Form>
  );
}

/** Which of the forms is open over the page: one at a time. */
export type OpenForm =
  | { kind: "block" }
  | { kind: "edit" }
  | { kind: "attach" }
  | { kind: "equipment" }
  | { kind: "claim" }
  | { kind: "variation" }
  | { kind: "decide"; id: string; to: "approved" | "declined" }
  | { kind: "total" }
  | { kind: "trip" }
  | { kind: "milestone" }
  | { kind: "promise" }
  | { kind: "defects" }
  | { kind: "hours" }
  | { kind: "section" }
  | { kind: "design" }
  | { kind: "agreement" };
