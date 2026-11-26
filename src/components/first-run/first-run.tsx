"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DoorFrame, GROUP, LEAD, PRIMARY, QUIET, SECOND, TITLE } from "@/components/start/door";
import { AddressField } from "@/components/address/address-field";
import { ScanCard, type ScanMode } from "@/components/record-modal/scan-card";
import { SCAN_COPY, TermFields, emptyTerm, termInput, type Term } from "@/components/profile/licence-modal/term-fields";
import { LICENCE_DOC_KIND, type LicenceTermInput } from "@/lib/staff/licence-records";
import type { LicenceInput } from "@/lib/staff/licence";
import type { ReadLicenceResult } from "@/app/actions/staff-licence-ai";
import type { SaveResult } from "@/app/actions/profile";
import type { FirstRunStep, TeamResult } from "@/app/actions/first-run";
import { Box, Field, INPUT, Row, Steps, Word, maskDate } from "./parts";

/* THE FIRST RUN ON THE WEB, AS THE PHONE'S (heytiff-mobile app/onboarding;
   Isaac, 26 November 2026: "make the web first run match the phone"). Short
   steps, one thing each, every one skippable but your name and the business's
   name, each saved as you leave it through the web's own saves.

     joining a team       Your details, Emergency contact, Licences
     starting a business  (its name, at the door), How customers reach you,
                          Your details, Your team, You're set up

   The phone's "On this phone" (notifications, location) has no web twin.
   What's left goes on being asked where it always is: Home's count and the
   phone's To do for your card, the Organisation screen for the business. */

export type Step = "business" | "contact" | "details" | "emergency" | "licences" | "team" | "ready";

export type FirstRunActions = {
  save: (step: FirstRunStep, fields: Record<string, string>) => Promise<SaveResult>;
  team: (people: { name: string; email: string; role: string }[]) => Promise<TeamResult>;
  finish: () => Promise<SaveResult>;
  readLicence: (fileBase64: string, mediaType: string, staffId: string) => Promise<ReadLicenceResult>;
  addLicence: (input: LicenceInput, term?: LicenceTermInput) => Promise<SaveResult>;
};

const NETWORK = "Couldn't save. Check your connection and try again.";
/* Out here, not inline in a try: React Compiler 1.0 can't lower a value block (`??`, a ternary) inside a try/catch
   and gives up on the whole component when it meets one. */
const fieldsOf = (f: string[] | undefined) => f ?? [];
const sourceOf = (mode: ScanMode) => (mode === "scanned" ? "scan" : "manual");

const TITLES: Record<Step, string> = {
  business: "Set up your business",
  contact: "How customers reach you",
  details: "Your details",
  emergency: "Emergency contact",
  licences: "Licences",
  team: "Your team",
  ready: "You're set up",
};

/** A birthday that could be one: a real day, not ahead, all four figures of the year. */
function birthdayProblem(v: string): boolean {
  if (!v.trim()) return false;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v.trim());
  if (!m) return true;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return d.getDate() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d > new Date() || Number(m[3]) < 1900;
}

type Person = { name: string; email: string; role: "staff" | "admin" };

export function FirstRun({
  steps,
  org,
  initialDetails,
  initialBusiness,
  relationships,
  licenceKinds,
  staffId,
  today,
  addressLookup,
  actions,
}: {
  steps: Step[];
  org: string | null;
  initialDetails: Record<string, string>;
  initialBusiness: Record<string, string>;
  relationships: readonly string[];
  licenceKinds: readonly string[];
  staffId: string | null;
  today: string;
  addressLookup: boolean;
  actions: FirstRunActions;
}) {
  const router = useRouter();
  const [at, setAt] = useState(0);
  const [details, setDetails] = useState(initialDetails);
  const [biz, setBiz] = useState(initialBusiness);
  const [people, setPeople] = useState<Person[]>([{ name: "", email: "", role: "staff" }]);
  const [sent, setSent] = useState(0);
  const [added, setAdded] = useState<Record<string, true>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [bad, setBad] = useState<string[]>([]);
  const step = steps[at]!;
  const counted = steps.filter((s) => s !== "ready");

  const finish = async () => {
    setBusy(true);
    setSaid(null);
    try {
      const r = await actions.finish();
      if (r.ok) return router.replace("/dashboard");
      setSaid(r.error);
    } catch {
      setSaid(NETWORK);
    }
    setBusy(false);
  };
  const next = () => {
    setSaid(null);
    setBad([]);
    if (at + 1 >= steps.length) return void finish();
    setAt(at + 1);
  };
  const save = async (s: FirstRunStep, fields: Record<string, string>) => {
    setBusy(true);
    setSaid(null);
    try {
      const r = await actions.save(s, fields);
      if (r.ok) next();
      else {
        setSaid(r.error);
        setBad(fieldsOf(r.fields));
      }
    } catch {
      setSaid(NETWORK);
    }
    setBusy(false);
  };

  const go = () => {
    if (busy) return;
    if (step === "business") return void save("business", biz);
    if (step === "contact") return void save("contact", biz);
    if (step === "details") {
      if (!(details.first_name ?? "").trim() || !(details.last_name ?? "").trim()) {
        setBad(["first_name", "last_name"]);
        return setSaid("Add your first and last name.");
      }
      if (birthdayProblem(details.birthday ?? "")) {
        setBad(["birthday"]);
        return setSaid("Check your date of birth: day, month, then the full year.");
      }
      return void save("details", details);
    }
    if (step === "emergency") return void save("emergency", details);
    if (step === "team") {
      const going = people.filter((p) => p.email.trim());
      if (!going.length) return next();
      setBusy(true);
      setSaid(null);
      void actions
        .team(going)
        .then((r) => {
          if (!r.ok) return setSaid(r.error);
          setSent(r.sent);
          if (r.failed.length) {
            setSaid(r.failed.map((f) => `${f.email}: ${f.error}`).join(" "));
            setPeople(going.filter((p) => r.failed.some((f) => f.email === p.email.trim())));
          } else next();
        })
        .catch(() => setSaid(NETWORK))
        .finally(() => setBusy(false));
      return;
    }
    if (step === "ready" || step === "licences") return void (at + 1 >= steps.length ? finish() : next());
  };

  const going = people.filter((p) => p.email.trim()).length;
  const main =
    step === "ready"
      ? "Open Home"
      : step === "team" && going
        ? `Send ${going} invitation${going === 1 ? "" : "s"}`
        : at + 1 >= steps.length
          ? "Open Home"
          : "Continue";
  const skippable = step !== "business" && step !== "ready";
  const setD = (k: string) => (v: string) => setDetails((d) => ({ ...d, [k]: v }));
  const setB = (k: string) => (v: string) => setBiz((b) => ({ ...b, [k]: v }));

  return (
    <DoorFrame bare wide>
      {/* the address box and the scan card wear the frame's own rules (shell.css, scoped under .fg), which the page loads */}
      <div className="fg" style={{ display: "contents" }}>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            go();
          }}
        >
          {step !== "ready" ? <Steps count={counted.length} at={counted.indexOf(step)} /> : null}
          <div>
            <h1 className={TITLE} style={step === "emergency" ? { color: "var(--red-w)" } : undefined}>
              {TITLES[step]}
            </h1>
            {step === "emergency" ? <p className={LEAD}>Who {org ?? "the business"} calls if you&apos;re hurt on a job.</p> : null}
          </div>

          {step === "business" ? (
            <div className={`${GROUP} flex flex-col gap-4 p-5`}>
              <Box id="trading_name" label="Business name" value={biz.trading_name ?? ""} bad={bad.includes("trading_name")} onChange={setB("trading_name")} />
              <Box id="abn" label="ABN" value={biz.abn ?? ""} bad={bad.includes("abn")} inputMode="numeric" onChange={setB("abn")} />
              <Field label="Registered for GST?">
                <div role="radiogroup" aria-label="Registered for GST?" className="grid h-9 grid-cols-2 gap-[3px] rounded-[var(--r-button)] bg-[var(--soft)] p-[3px]">
                  {["Yes", "No"].map((o) => (
                    <button
                      key={o}
                      type="button"
                      role="radio"
                      aria-checked={(biz.gst_registered || "Yes") === o}
                      onClick={() => setB("gst_registered")(o)}
                      className={`rounded-[8px] text-[14px] font-semibold ${(biz.gst_registered || "Yes") === o ? "bg-white text-[var(--ink)]" : "text-[var(--q)]"}`}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          ) : null}

          {step === "contact" ? (
            <div className={`${GROUP} grid grid-cols-1 gap-4 p-5 sm:grid-cols-4`}>
              <Box id="email" label="Email" className="sm:col-span-2" type="email" value={biz.email ?? ""} bad={bad.includes("email")} onChange={setB("email")} />
              <Box id="phone" label="Phone" className="sm:col-span-2" type="tel" value={biz.phone ?? ""} bad={bad.includes("phone")} onChange={setB("phone")} />
              <Field id="address" label="Street address" className="sm:col-span-4">
                {/* Google finds it as it's typed; picked, its suburb, state and postcode come with it */}
                <AddressField
                  name="address"
                  value={biz.address ?? ""}
                  onChange={setB("address")}
                  onResolve={(p) => setBiz((b) => ({ ...b, address: p.address, suburb: p.suburb, state: p.state, postcode: p.postcode }))}
                  enabled={addressLookup}
                  className={INPUT}
                />
              </Field>
              <Box id="suburb" label="Suburb" className="sm:col-span-2" value={biz.suburb ?? ""} onChange={setB("suburb")} />
              <Box id="state" label="State" value={biz.state ?? ""} maxLength={3} onChange={(v) => setB("state")(v.toUpperCase())} />
              <Box id="postcode" label="Postcode" value={biz.postcode ?? ""} inputMode="numeric" maxLength={4} onChange={setB("postcode")} />
            </div>
          ) : null}

          {step === "details" ? (
            <div className={`${GROUP} grid grid-cols-1 gap-4 p-5 sm:grid-cols-2`}>
              <Box id="first_name" label="First name" autoComplete="given-name" value={details.first_name ?? ""} bad={bad.includes("first_name")} onChange={setD("first_name")} />
              <Box id="last_name" label="Last name" autoComplete="family-name" value={details.last_name ?? ""} bad={bad.includes("last_name")} onChange={setD("last_name")} />
              <Box id="preferred_name" label="Goes by" value={details.preferred_name ?? ""} onChange={setD("preferred_name")} />
              <Box id="birthday" label="Date of birth" placeholder="DD/MM/YYYY" inputMode="numeric" maxLength={10} value={details.birthday ?? ""} bad={bad.includes("birthday")} onChange={(v) => setD("birthday")(maskDate(v))} />
              <Box id="phone" label="Mobile" type="tel" autoComplete="tel" value={details.phone ?? ""} onChange={setD("phone")} />
              {steps.includes("team") ? null : (
                <Field id="address" label="Home address" className="sm:col-span-2">
                  <AddressField name="address" value={details.address ?? ""} onChange={setD("address")} enabled={addressLookup} className={INPUT} />
                </Field>
              )}
            </div>
          ) : null}

          {step === "emergency" ? (
            <div className={`${GROUP} grid grid-cols-1 gap-4 p-5 sm:grid-cols-2`}>
              <Box id="emergency_name" label="Name" className="sm:col-span-2" value={details.emergency_name ?? ""} onChange={setD("emergency_name")} />
              <Field id="emergency_relationship" label="Relationship">
                <select id="emergency_relationship" className={INPUT} value={details.emergency_relationship ?? ""} onChange={(e) => setD("emergency_relationship")(e.target.value)}>
                  <option value="">Choose</option>
                  {relationships.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </Field>
              <Box id="emergency_phone" label="Mobile" type="tel" value={details.emergency_phone ?? ""} onChange={setD("emergency_phone")} />
            </div>
          ) : null}

          {step === "licences" ? (
            <>
              <div className={GROUP}>
                {licenceKinds.map((k, i) => (
                  <Row key={k} first={i === 0} name={k}>
                    {added[k] ? (
                      <Word tone="ok">Added</Word>
                    ) : (
                      <button type="button" className={SECOND} disabled={!staffId} onClick={() => setAdding(k)}>
                        Add photo
                      </button>
                    )}
                  </Row>
                ))}
              </div>
              <p className="text-[13px] text-[var(--q)]">Tiff reads the number and expiry off the photo, and you check them.</p>
            </>
          ) : null}

          {step === "team" ? (
            <div className="flex flex-col gap-3">
              {people.map((p, i) => (
                <div key={i} className={`${GROUP} grid grid-cols-1 gap-4 p-5 sm:grid-cols-[1fr_1fr_auto]`}>
                  <Box id={`name-${i}`} label="Name" value={p.name} onChange={(v) => setPeople(people.map((q, j) => (j === i ? { ...q, name: v } : q)))} />
                  <Box id={`email-${i}`} label="Email" type="email" value={p.email} onChange={(v) => setPeople(people.map((q, j) => (j === i ? { ...q, email: v } : q)))} />
                  <Field id={`role-${i}`} label="Role">
                    <select id={`role-${i}`} className={INPUT} value={p.role} onChange={(e) => setPeople(people.map((q, j) => (j === i ? { ...q, role: e.target.value as Person["role"] } : q)))}>
                      <option value="staff">Staff</option>
                      <option value="admin">Admin</option>
                    </select>
                  </Field>
                </div>
              ))}
              <button type="button" className={`${SECOND} self-start`} onClick={() => setPeople([...people, { name: "", email: "", role: "staff" }])}>
                Add a person
              </button>
            </div>
          ) : null}

          {step === "ready" ? (
            <div className={GROUP}>
              <Row first name="Business" sub="ABN, GST, how customers reach you">
                <Word tone="ok">Done</Word>
              </Row>
              <Row name="Team" sub={sent ? `${sent} invited` : "Invite them from Team"}>
                <Word tone={sent ? "fyi" : "look"}>{sent ? "Sent" : "Not yet"}</Word>
              </Row>
              <Row name="ServiceM8" sub="Jobs, bookings and customers">
                <Word tone="look">Not yet</Word>
              </Row>
              <Row name="Logo and letterhead" sub="On quotes and invoices">
                <Word tone="look">Not yet</Word>
              </Row>
            </div>
          ) : null}

          {said ? (
            <p role="alert" className="text-[14px] font-medium text-[var(--bad-t)]">
              {said}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            {at > 0 && step !== "ready" ? (
              <button type="button" className={QUIET} onClick={() => (setSaid(null), setBad([]), setAt(at - 1))}>
                Back
              </button>
            ) : null}
            <span className="flex-1" />
            {skippable ? (
              <button type="button" className={QUIET} disabled={busy} onClick={next}>
                Skip
              </button>
            ) : null}
            {step === "ready" ? (
              <a className={SECOND} href="/dashboard/admin/integrations/servicem8">
                Connect ServiceM8
              </a>
            ) : null}
            <button type="submit" className={PRIMARY} disabled={busy}>
              {busy ? "Saving" : main}
            </button>
          </div>
        </form>

        {adding && staffId ? (
          <LicenceDialog
            typeName={adding}
            staffId={staffId}
            today={today}
            actions={actions}
            onClose={() => setAdding(null)}
            onSaved={() => setAdded((a) => ({ ...a, [adding]: true }))}
          />
        ) : null}
      </div>
    </DoorFrame>
  );
}

/* ADD A LICENCE FROM ITS PHOTO: the Compliance card's own scan (ScanCard, Tiff's
   reader) and its own add, for the one ticket the row named. */
function LicenceDialog({
  typeName,
  staffId,
  today,
  actions,
  onClose,
  onSaved,
}: {
  typeName: string;
  staffId: string;
  today: string;
  actions: FirstRunActions;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [mode, setMode] = useState<ScanMode>("idle");
  const [term, setTerm] = useState<Term>(emptyTerm);
  const [docId, setDocId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setSaid(null);
    const scan: LicenceTermInput = { ...termInput(term), documentId: docId, source: sourceOf(mode) };
    try {
      const r = await actions.addLicence({ typeName }, scan);
      if (r.ok) {
        onSaved();
        return onClose();
      }
      setSaid(r.error);
    } catch {
      setSaid(NETWORK);
    }
    setBusy(false);
  };
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[var(--scrim)] p-4" role="dialog" aria-modal="true" aria-label={typeName}>
      <div className="max-h-[90vh] w-full max-w-[520px] overflow-y-auto rounded-[var(--r-card)] bg-white p-6 shadow-[var(--shadow-overlay)]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-[20px] font-semibold leading-7">{typeName}</h2>
          <button type="button" className={QUIET} onClick={onClose}>
            Close
          </button>
        </div>
        <ScanCard<ReadLicenceResult>
          heading="Scan the card"
          prompt={SCAN_COPY.prompt}
          note={SCAN_COPY.note}
          paper={SCAN_COPY.paper}
          attachLabel={SCAN_COPY.attach}
          docKind={LICENCE_DOC_KIND}
          read={(b64, mt) => actions.readLicence(b64, mt, staffId)}
          onRead={(r, id) => {
            if (r.ok)
              setTerm((p) => ({
                number: r.number ?? p.number,
                issuer: r.issuer ?? p.issuer,
                issuingState: r.issuingState ?? p.issuingState,
                classes: r.classes ?? p.classes,
                startsOn: r.startsOn ?? p.startsOn,
                expiresOn: r.expiresOn ?? p.expiresOn,
              }));
            setDocId(id);
          }}
          onAttached={(id) => setDocId(id)}
          mode={mode}
          onMode={(m) => {
            setMode(m);
            if (m === "idle") {
              setTerm(emptyTerm);
              setDocId(null);
            }
          }}
        >
          <TermFields value={term} onChange={setTerm} today={today} />
        </ScanCard>
        {said ? (
          <p role="alert" className="mt-3 text-[14px] font-medium text-[var(--bad-t)]">
            {said}
          </p>
        ) : null}
        {mode === "scanned" || mode === "manual" ? (
          <div className="mt-4 flex justify-end">
            <button type="button" className={PRIMARY} disabled={busy} onClick={() => void save()}>
              {busy ? "Saving" : "Save licence"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
