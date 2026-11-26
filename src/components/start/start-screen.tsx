"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DoorFrame, GROUP, LEAD, PRIMARY, QUIET, SECOND, TITLE } from "./door";
import { Box, Field, Row } from "@/components/first-run/parts";
import type { CreateOrgResult } from "@/app/actions/org-create";
import type { DoorResult, FirstRunStep } from "@/app/actions/first-run";
import type { SaveResult } from "@/app/actions/profile";
import type { StartState } from "@/lib/mobile/start";
import { fmtAuDayMonth } from "@/lib/au-dates";

/* What a signed-in person with no workspace sees: the phone's first door, in
   its words (heytiff-mobile app/start; Isaac, 26 November 2026: "make the web
   first run match the phone").

   OUTSIDE THE DASHBOARD SHELL: the shell is org-scoped furniture and this is
   the screen for someone who has no org to furnish.

   THE ACTIONS ARRIVE AS PROPS. A static import of a `"use server"` module that
   pulls next/cache kills every jsdom suite in the file that renders it; the
   server page passes them down instead. */

export type { StartState };

export type StartActions = {
  join: (id: string) => Promise<DoorResult>;
  ask: (id: string) => Promise<DoorResult>;
  confirm: () => Promise<DoorResult>;
  create: () => Promise<CreateOrgResult>;
  save: (step: FirstRunStep, fields: Record<string, string>) => Promise<SaveResult>;
};

const NETWORK = "Couldn't reach HeyTiff. Check the connection and try again.";
const first = (name: string | null) => name?.split(" ")[0] ?? null;
const initials = (name: string | null) =>
  (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
const day = (iso: string) => fmtAuDayMonth(iso) || iso.slice(0, 10);

export function StartScreen({ state, email, actions }: { state: StartState; email: string | null; actions: StartActions }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  const [sent, setSent] = useState(false);
  /* nothing waiting: first what that may mean (the wrong address), then the business's form */
  const [settingUp, setSettingUp] = useState(false);
  const [biz, setBiz] = useState({ trading_name: "", abn: "", gst_registered: "Yes" });
  const [bad, setBad] = useState<string[]>([]);
  const who = email ?? "the address you signed in with";

  const run = async (what: string, fn: () => Promise<{ ok: boolean; error?: string }>, then: () => void) => {
    if (busy) return;
    setBusy(what);
    setSaid(null);
    try {
      const r = await fn();
      if (r.ok) return then();
      setSaid(r.error ?? NETWORK);
    } catch {
      setSaid(NETWORK);
    }
    setBusy(null);
  };

  /* the business is made, then named; the first run on /welcome picks up at how customers reach it */
  const setUp = () => {
    if (!biz.trading_name.trim()) {
      setBad(["trading_name"]);
      return setSaid("Give the business a name.");
    }
    void run(
      "business",
      async () => {
        const made = await actions.create();
        if (!made.ok) return made;
        const named = await actions.save("business", biz);
        if (!named.ok) setBad(named.fields ?? []);
        return { ok: true };
      },
      () => router.push("/welcome")
    );
  };

  const signedInAs = (
    <p className="text-center text-[13px] text-[var(--q)]">
      {email ? `Signed in as ${email}. ` : null}
      <a className="font-semibold text-[var(--ink)] underline underline-offset-2" href="/auth/logout">
        Sign out
      </a>
    </p>
  );

  const nothing = state.kind === "none" || settingUp;
  const form = nothing && settingUp;

  return (
    <DoorFrame bare footer={signedInAs}>
      <div className="flex flex-col gap-4">
        {state.kind === "invite" ? (
          <>
            <h1 className={TITLE}>Join {state.company ?? "the team"}</h1>
            <div className={GROUP}>
              <div className="flex items-center gap-3 p-4">
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-[var(--soft)] text-[14px] font-semibold">
                  {initials(state.inviter ?? state.company)}
                </span>
                <div>
                  <div className="text-[14px] font-semibold">{state.inviter ?? state.company ?? "Your team"}</div>
                  <div className="text-[13px] text-[var(--q)]">
                    added you as {state.role} on {day(state.invitedOn)}
                  </div>
                </div>
              </div>
              <div className="flex gap-3 border-t border-[var(--line)] p-4 text-[14px]">
                <span className="w-16 font-semibold">{state.role}</span>
                <span className="flex-1 text-[var(--q)]">{state.roleBlurb.replace("their own", "your own")}</span>
              </div>
            </div>
            <button type="button" className={`${PRIMARY} w-full`} disabled={!!busy} onClick={() => void run("join", () => actions.join(state.id), () => router.push("/dashboard"))}>
              {busy === "join" ? "Joining" : `Join ${state.company ?? "the team"}`}
            </button>
          </>
        ) : null}

        {state.kind === "expired" && !settingUp ? (
          <>
            <div>
              <h1 className={TITLE}>That invitation has run out</h1>
              <p className={LEAD}>
                {state.company ?? "The business"} invited you on {day(state.invitedOn)}, and invitations last seven days.
              </p>
            </div>
            <div className={`${GROUP} p-4`}>
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-[var(--soft)] text-[14px] font-semibold">
                  {initials(state.inviter ?? state.company)}
                </span>
                <div>
                  <div className="text-[14px] font-semibold">{state.inviter ?? state.company ?? "Whoever invited you"}</div>
                  <div className="text-[13px] text-[var(--q)]">can send it again from Team</div>
                </div>
              </div>
              {asked ? (
                <p className="mt-3 text-[14px] font-semibold text-[var(--green-w)]">Asked. {first(state.inviter) ?? "They"} gets a notification.</p>
              ) : (
                <button type="button" className={`${SECOND} mt-3 w-full`} disabled={!!busy} onClick={() => void run("ask", () => actions.ask(state.id), () => (setAsked(true), setBusy(null)))}>
                  {state.inviter ? `Ask ${first(state.inviter)} to resend it` : "Ask for a new one"}
                </button>
              )}
            </div>
            <button type="button" className={`${QUIET} w-full`} onClick={() => setSettingUp(true)}>
              Set up my own business
            </button>
          </>
        ) : null}

        {state.kind === "confirm" ? (
          <>
            <div>
              <h1 className={TITLE}>Confirm your email</h1>
              <p className={LEAD}>Open the email Auth0 sent to {who}, then come back.</p>
            </div>
            <button type="button" className={`${PRIMARY} w-full`} onClick={() => router.refresh()}>
              I&apos;ve confirmed it
            </button>
            <button type="button" className={`${SECOND} w-full`} disabled={!!busy || sent} onClick={() => void run("confirm", actions.confirm, () => (setSent(true), setBusy(null)))}>
              {sent ? "Sent. Check your inbox." : "Send it again"}
            </button>
          </>
        ) : null}

        {state.kind === "member" ? (
          <>
            <div>
              <h1 className={TITLE}>Your workspace is ready</h1>
              <p className={LEAD}>You joined from another browser or device. Sign in again here to open it.</p>
            </div>
            <a className={`${PRIMARY} w-full`} href="/auth/login?returnTo=%2Fdashboard">
              Sign in again
            </a>
          </>
        ) : null}

        {nothing && !form ? (
          <>
            <div>
              <h1 className={TITLE}>No invitation for this address</h1>
              <p className={LEAD}>Nothing is waiting for {who}.</p>
            </div>
            <div className={GROUP}>
              <Row first name="Invited on another address?" sub="Sign out and use that one">
                <a className={SECOND} href="/auth/logout">
                  Sign out
                </a>
              </Row>
              <Row name="Not invited yet?" sub={`Ask your boss to add ${who}`} />
            </div>
            <button type="button" className={`${SECOND} w-full`} onClick={() => setSettingUp(true)}>
              Set up my own business
            </button>
          </>
        ) : null}

        {form ? (
          <>
            <div className="flex items-center justify-between">
              <h1 className={TITLE}>Set up your business</h1>
              <button type="button" className={QUIET} onClick={() => (setSettingUp(false), setSaid(null))}>
                Back
              </button>
            </div>
            <div className={`${GROUP} flex flex-col gap-4 p-5`}>
              <Box id="trading_name" label="Business name" value={biz.trading_name} bad={bad.includes("trading_name")} onChange={(v) => setBiz({ ...biz, trading_name: v })} />
              <Box id="abn" label="ABN" value={biz.abn} bad={bad.includes("abn")} inputMode="numeric" onChange={(v) => setBiz({ ...biz, abn: v })} />
              <Field label="Registered for GST?">
                <div role="radiogroup" aria-label="Registered for GST?" className="grid h-9 grid-cols-2 gap-[3px] rounded-[var(--r-button)] bg-[var(--soft)] p-[3px]">
                  {["Yes", "No"].map((o) => (
                    <button
                      key={o}
                      type="button"
                      role="radio"
                      aria-checked={biz.gst_registered === o}
                      onClick={() => setBiz({ ...biz, gst_registered: o })}
                      className={`rounded-[8px] text-[14px] font-semibold ${biz.gst_registered === o ? "bg-white text-[var(--ink)]" : "text-[var(--q)]"}`}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
            <button type="button" className={`${PRIMARY} w-full`} disabled={!!busy} onClick={setUp}>
              {busy === "business" ? "Setting up the business" : "Continue"}
            </button>
          </>
        ) : null}

        {said ? (
          <p role="alert" className="text-[14px] font-medium text-[var(--bad-t)]">
            {said}
          </p>
        ) : null}
      </div>
    </DoorFrame>
  );
}
