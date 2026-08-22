"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Chevron, Wordmark } from "@/components/logo";
import { AU_STATES, preValidateOrg } from "@/lib/org/settings";
import { draftSections, SETUP_STEPS, stepForFields, type SetupDraft } from "@/lib/org/setup";
import type { CompanySetupActions } from "./types";

/* First-run company setup — two short steps and a way out.

   OUTSIDE THE DASHBOARD SHELL, like the invite screens: the shell is
   org-scoped furniture, and drawing fifteen nav entries around someone whose
   company is thirty seconds old is the empty-dashboard problem this flow
   exists to replace. So the screen is self-contained — Tailwind on the
   landing/invite vocabulary, not shell.css, which belongs to the app frame.

   ONE DRAFT ACROSS BOTH STEPS, saved once at the end. Stepping back and
   forth never loses typing, and the org row is written exactly once — by
   completeOrgSetup, through the same section writes the Organisation screen
   makes. A rejected save comes back naming columns; stepForFields routes the
   error to the step that renders them, so it lands beside the field instead
   of on whichever step pressed the button.

   The ABN pre-flight is the shared preValidateOrg — the same check the
   action runs, run in the browser first, so a typo'd checksum is answered on
   the field without a round trip. Not a control; the action re-checks. */

const NETWORK_ERROR = "Couldn’t save — check your connection and try again.";

const INP =
  "w-full rounded-lg border bg-white px-3 py-2 text-sm text-zinc-900 " +
  "placeholder:text-zinc-400 focus:outline-none focus:ring-2";
const INP_OK = `${INP} border-zinc-300 focus:border-[#00A389] focus:ring-[#00A389]/25`;
const INP_BAD = `${INP} border-rose-600 focus:border-rose-600 focus:ring-rose-600/20`;

function Field({
  label,
  req,
  help,
  group,
  children,
}: {
  label: string;
  req?: boolean;
  help?: string;
  /** for children that are BUTTONS (the GST segment): buttons are labelable,
      so wrapping them in a <label> hands the caption to the first one as its
      accessible name — and makes clicking the caption press it. A group gets
      a plain wrapper instead; the child carries its own aria-label. */
  group?: boolean;
  children: React.ReactNode;
}) {
  const Wrap = group ? "div" : "label";
  return (
    <Wrap className="block">
      <span className="text-sm font-medium text-zinc-700">
        {label}
        {req && <span className="text-rose-600"> *</span>}
      </span>
      <div className="mt-1">{children}</div>
      {help && <span className="mt-1 block text-xs text-zinc-500">{help}</span>}
    </Wrap>
  );
}

export function CompanySetup({
  initial,
  actions,
}: {
  initial: SetupDraft;
  actions: CompanySetupActions;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<SetupDraft>(initial);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<"save" | "skip" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [badFields, setBadFields] = useState<string[]>([]);

  const set = (field: keyof SetupDraft) => (value: string) => {
    setDraft((d) => ({ ...d, [field]: value }));
    // typing is the correction — a stale rejection over a changed value only
    // argues with the person fixing it
    setError(null);
    setBadFields([]);
  };
  const bad = (field: string) => badFields.includes(field);
  const inp = (field: string) => (bad(field) ? INP_BAD : INP_OK);

  const { identity, contact } = draftSections(draft);

  const next = () => {
    if (!draft.trading_name.trim()) {
      setError("Give the business a name — it's what your team and your documents will show.");
      setBadFields(["trading_name"]);
      return;
    }
    const flight = preValidateOrg("identity", identity);
    if (flight) {
      setError(flight.error);
      setBadFields(flight.fields);
      return;
    }
    setError(null);
    setBadFields([]);
    setStep(1);
  };

  const finish = async () => {
    setBusy("save");
    setError(null);
    try {
      const res = await actions.onComplete(identity, contact);
      if (res.ok) {
        router.replace("/dashboard");
        return; // stay "busy" — the screen is navigating, not waiting
      }
      setError(res.error);
      setBadFields(res.fields ?? []);
      setStep(stepForFields(res.fields));
    } catch {
      setError(NETWORK_ERROR);
    }
    setBusy(null);
  };

  const skip = async () => {
    setBusy("skip");
    setError(null);
    try {
      const res = await actions.onSkip();
      if (res.ok) {
        router.replace("/dashboard");
        return;
      }
      setError(res.error);
    } catch {
      setError(NETWORK_ERROR);
    }
    setBusy(null);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50 px-6 py-10">
      {/* Branded like /invite's screens: this is the first HeyTiff screen a
          new business ever sees, and a bare form on white reads as nowhere.
          Decorative — the wordmark beside it already says the name. */}
      <div className="flex items-center gap-2">
        <Chevron size={26} gradient decorative />
        <Wordmark className="text-xl" />
      </div>

      <form
        className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          if (step === 0) next();
          else void finish();
        }}
      >
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Set up your company · step {step + 1} of {SETUP_STEPS.length}
        </p>
        <h1 className="mt-1 text-xl font-semibold text-zinc-900">{SETUP_STEPS[step].title}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {step === 0
            ? "How the business appears to your team and on your documents. Everything here can be changed later."
            : "What customers see on your documents — all optional."}
        </p>

        {step === 0 ? (
          <div className="mt-5 space-y-4">
            <Field label="Business name" req help="The name your team and your customers see.">
              <input
                className={inp("trading_name")}
                name="trading_name"
                value={draft.trading_name}
                placeholder="e.g. Smith Air & Electrical"
                aria-invalid={bad("trading_name") || undefined}
                onChange={(e) => set("trading_name")(e.target.value)}
              />
            </Field>
            <Field label="Legal name" help="Only if it differs from the name above.">
              <input
                className={inp("legal_name")}
                name="legal_name"
                value={draft.legal_name}
                placeholder="e.g. Smith Air Pty Ltd"
                onChange={(e) => set("legal_name")(e.target.value)}
              />
            </Field>
            <Field label="ABN">
              <input
                className={inp("abn")}
                name="abn"
                value={draft.abn}
                inputMode="numeric"
                placeholder="11 digits"
                aria-invalid={bad("abn") || undefined}
                onChange={(e) => set("abn")(e.target.value)}
              />
            </Field>
            <Field label="Registered for GST?" group>
              <div
                role="group"
                aria-label="Registered for GST?"
                className="inline-flex rounded-lg border border-zinc-300 bg-zinc-50 p-0.5"
              >
                {(["Yes", "No"] as const).map((o) => {
                  const on = draft.gst_registered === o;
                  return (
                    <button
                      key={o}
                      type="button"
                      aria-pressed={on}
                      className={
                        on
                          ? "rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white"
                          : "rounded-md px-4 py-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-900"
                      }
                      onClick={() => set("gst_registered")(o)}
                    >
                      {o}
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <Field label="Email" help="The address customers reach the business on.">
              <input
                className={inp("email")}
                name="email"
                type="email"
                value={draft.email}
                onChange={(e) => set("email")(e.target.value)}
              />
            </Field>
            <Field label="Phone">
              <input
                className={inp("phone")}
                name="phone"
                type="tel"
                value={draft.phone}
                onChange={(e) => set("phone")(e.target.value)}
              />
            </Field>
            <Field label="Street address">
              <input
                className={inp("address")}
                name="address"
                value={draft.address}
                onChange={(e) => set("address")(e.target.value)}
              />
            </Field>
            <Field label="Suburb">
              <input
                className={inp("suburb")}
                name="suburb"
                value={draft.suburb}
                onChange={(e) => set("suburb")(e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="State"
                help="Sets the public-holiday calendar your team is paid against."
              >
                <select
                  className={inp("state")}
                  name="state"
                  value={draft.state}
                  aria-invalid={bad("state") || undefined}
                  onChange={(e) => set("state")(e.target.value)}
                >
                  <option value="">Choose…</option>
                  {AU_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Postcode">
                <input
                  className={inp("postcode")}
                  name="postcode"
                  inputMode="numeric"
                  value={draft.postcode}
                  onChange={(e) => set("postcode")(e.target.value)}
                />
              </Field>
            </div>
          </div>
        )}

        {error && (
          <p className="mt-4 text-sm text-rose-600" role="alert">
            {error}
          </p>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          {step === 1 ? (
            <button
              type="button"
              className="text-sm font-medium text-zinc-500 hover:text-zinc-700"
              onClick={() => {
                setError(null);
                setBadFields([]);
                setStep(0);
              }}
            >
              ← Back
            </button>
          ) : (
            <span />
          )}
          <button
            type="submit"
            disabled={busy !== null}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            {step === 0 ? "Continue" : busy === "save" ? "Finishing…" : "Finish setup"}
          </button>
        </div>
      </form>

      {/* A quiet, honest exit — recorded server-side so Home stops offering
          the flow, and named so nobody wonders where the fields went. */}
      <button
        type="button"
        disabled={busy !== null}
        className="text-sm text-zinc-500 hover:text-zinc-700 disabled:opacity-50"
        onClick={() => void skip()}
      >
        {busy === "skip"
          ? "Heading to your dashboard…"
          : "Skip for now — you can finish any time in Admin → Organisation"}
      </button>
    </main>
  );
}
