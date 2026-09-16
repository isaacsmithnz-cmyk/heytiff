"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Chevron, Wordmark } from "@/components/logo";
import { EMERGENCY_RELATIONSHIPS } from "@/lib/staff/profile";
import type { SaveResult } from "@/app/actions/profile";

/* A new staff member's first run — their details, once, on arrival.

   WHY IT EXISTS. Nothing between an invitation and Home ever asked a person
   their name. The invite's name box is optional, Auth0's sign-up never asks,
   and the card was seeded with whatever was left — which in production was an
   email address in one first-name field and an email prefix in another. The
   person who actually knows the answer is the one arriving, so this is where
   it is asked.

   OUTSIDE THE DASHBOARD SHELL, like /welcome: the shell is the workspace's
   furniture, and fifteen nav entries around a form somebody has thirty seconds
   of context for is noise. Tailwind on the tokens (tokens.css is on :root for
   every route), in the shell's own vocabulary — the 46px tinted input with the
   ink ring, the ink primary, labels at 13/500 in the quiet grey.

   ONE SCREEN, SAVED ONCE, AND SKIPPABLE. Nine fields in two groups do not need
   steps. The name is the only thing it insists on before saving; Skip is right
   beside Save and records the answer the same way, so Home does not send them
   back. What keeps reminding them afterwards is Home's attention count, which
   clears itself when the details are in. */

export type OnboardingDraft = {
  first_name: string;
  last_name: string;
  preferred_name: string;
  birthday: string;
  phone: string;
  address: string;
  emergency_name: string;
  emergency_relationship: string;
  emergency_phone: string;
};

export type OnboardingActions = {
  onComplete: (personal: Record<string, string>, emergency: Record<string, string>) => Promise<SaveResult>;
  onSkip: () => Promise<SaveResult>;
};

const NETWORK_ERROR = "Couldn’t save — check your connection and try again.";

/* The columns a rejected save named, or none. Out here rather than inline at
   the call site, which sits inside a try/catch: React Compiler 1.0 cannot lower
   a value block — a `??` — in there, and silently gives up on the whole
   component when it meets one (company-setup.tsx hit the same wall). */
const namedFields = (fields: string[] | undefined) => fields ?? [];

/* The shell's `.inp`, restated in Tailwind because shell.css is not loaded out
   here: 46px, the control radius, a tint that goes to paper under the 2px ink
   focus ring (law 32). A rejected field keeps the tint and takes the state
   colour on its edge, the only colour on the form. */
const INP =
  "h-[46px] w-full rounded-[var(--r-control)] border px-4 text-[14px] font-medium text-[var(--ink)] " +
  "bg-[var(--tint)] placeholder:text-[var(--q)] placeholder:font-medium outline-none " +
  "transition-[background-color,box-shadow] duration-[120ms] ease-out " +
  "focus:bg-[var(--paper)] focus:shadow-[var(--ring)]";
const INP_OK = `${INP} border-[var(--line)]`;
const INP_BAD = `${INP} border-[var(--bad-t)]`;

function Field({
  id,
  label,
  req,
  className,
  children,
}: {
  id: string;
  label: string;
  req?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-[13px] font-medium text-[var(--q)]">
        {label}
        {req ? <span className="text-[var(--ink)]"> *</span> : null}
      </label>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Group({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-8 border-t border-[var(--line)] pt-6">
      <h2 id={id} className="text-[16px] font-semibold text-[var(--ink)]">
        {title}
      </h2>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function StaffOnboarding({
  initial,
  orgName,
  actions,
}: {
  initial: OnboardingDraft;
  /** the workspace they joined, when the owner has named it */
  orgName: string | null;
  actions: OnboardingActions;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<OnboardingDraft>(initial);
  const [busy, setBusy] = useState<"save" | "skip" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [badFields, setBadFields] = useState<string[]>([]);

  const set = (field: keyof OnboardingDraft) => (value: string) => {
    setDraft((d) => ({ ...d, [field]: value }));
    // typing is the correction — a stale rejection over a changed value only
    // argues with the person fixing it
    setError(null);
    setBadFields([]);
  };
  const bad = (field: string) => badFields.includes(field);
  const input = (field: keyof OnboardingDraft, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input
      id={field}
      name={field}
      className={bad(field) ? INP_BAD : INP_OK}
      value={draft[field]}
      aria-invalid={bad(field) || undefined}
      onChange={(e) => set(field)(e.target.value)}
      {...extra}
    />
  );

  const save = async () => {
    const missing = (["first_name", "last_name"] as const).filter((k) => !draft[k].trim());
    if (missing.length) {
      setError("Add your first and last name.");
      setBadFields([...missing]);
      return;
    }
    setBusy("save");
    setError(null);
    try {
      const res = await actions.onComplete(
        {
          first_name: draft.first_name,
          last_name: draft.last_name,
          preferred_name: draft.preferred_name,
          birthday: draft.birthday,
          phone: draft.phone,
          address: draft.address,
        },
        {
          emergency_name: draft.emergency_name,
          emergency_relationship: draft.emergency_relationship,
          emergency_phone: draft.emergency_phone,
        }
      );
      if (res.ok) {
        router.replace("/dashboard");
        return; // stay busy — the screen is navigating, not waiting
      }
      setError(res.error);
      setBadFields(namedFields(res.fields));
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
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[var(--bg)] px-4 py-12">
      <div className="flex items-center gap-2">
        <Chevron size={26} decorative />
        <Wordmark className="text-xl" />
      </div>

      <form
        className="w-full max-w-[560px] rounded-[var(--r-card)] border border-[var(--line)] bg-[var(--paper)] p-8"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void save();
        }}
      >
        <h1 className="text-[24px] font-bold text-[var(--ink)]">Your details</h1>
        {/* the one fact under the title: which workspace this is for. An
            unnamed workspace has nothing to say here, so nothing is said. */}
        {orgName ? (
          <p className="mt-1 text-[14px] text-[var(--q)]">Joining {orgName}.</p>
        ) : null}

        <Group id="ob-you" title="About you">
          <Field id="first_name" label="First name" req>
            {input("first_name", { autoComplete: "given-name" })}
          </Field>
          <Field id="last_name" label="Last name" req>
            {input("last_name", { autoComplete: "family-name" })}
          </Field>
          <Field id="preferred_name" label="Preferred name" className="sm:col-span-2">
            {input("preferred_name", { autoComplete: "nickname" })}
          </Field>
          <Field id="birthday" label="Date of birth">
            {input("birthday", { inputMode: "numeric", placeholder: "dd/mm/yyyy", autoComplete: "bday" })}
          </Field>
          <Field id="phone" label="Mobile">
            {input("phone", { type: "tel", autoComplete: "tel" })}
          </Field>
          <Field id="address" label="Home address" className="sm:col-span-2">
            {input("address", { autoComplete: "street-address" })}
          </Field>
        </Group>

        <Group id="ob-emergency" title="Emergency contact">
          <Field id="emergency_name" label="Name" className="sm:col-span-2">
            {input("emergency_name")}
          </Field>
          <Field id="emergency_relationship" label="Relationship">
            <select
              id="emergency_relationship"
              name="emergency_relationship"
              className={INP_OK}
              value={draft.emergency_relationship}
              onChange={(e) => set("emergency_relationship")(e.target.value)}
            >
              <option value="">Choose</option>
              {EMERGENCY_RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <Field id="emergency_phone" label="Phone">
            {input("emergency_phone", { type: "tel" })}
          </Field>
        </Group>

        {error ? (
          <p className="mt-6 text-[14px] font-medium text-[var(--bad-t)]" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-8 flex items-center justify-between gap-4">
          <button
            type="button"
            disabled={busy !== null}
            className="rounded-[var(--r-control)] text-[14px] font-medium text-[var(--q)] underline underline-offset-[3px] hover:text-[var(--ink)] focus-visible:shadow-[var(--ring)] focus-visible:outline-none disabled:opacity-50"
            onClick={() => void skip()}
          >
            Skip for now
          </button>
          <button
            type="submit"
            disabled={busy !== null}
            className="h-[46px] rounded-[var(--r-button)] bg-[var(--ink)] px-6 text-[14px] font-semibold text-[var(--paper)] transition-colors duration-[120ms] ease-out hover:bg-[var(--ink2)] focus-visible:shadow-[var(--ring)] focus-visible:outline-none disabled:opacity-50"
          >
            {busy === "save" ? "Saving…" : "Save details"}
          </button>
        </div>
      </form>
    </main>
  );
}
