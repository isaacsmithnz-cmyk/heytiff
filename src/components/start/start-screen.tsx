"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Chevron, Wordmark } from "@/components/logo";
import type { CreateOrgResult } from "@/app/actions/org-create";

/* What a signed-in person with no workspace sees.

   OUTSIDE THE DASHBOARD SHELL, on the /welcome and /invite vocabulary:
   Tailwind, zinc-50 ground, one white card. The shell is org-scoped
   furniture and this is the screen for someone who has no org to furnish.

   THE ACTION ARRIVES AS A PROP. A static import of a `"use server"` module
   that pulls next/cache kills every jsdom suite in the file that renders it —
   the failure lands as `ReferenceError: Request is not defined` before the
   first assertion, and not always in the suite that caused it. The server
   page passes it down instead.

   FOUR STATES, ONE CARD. Each one leads with the thing that is true of this
   person, not with a menu of everything the screen can do. */

export type StartState =
  | { kind: "invite"; company: string | null; role: string; token: string }
  | { kind: "expired"; company: string | null }
  /** A membership exists but this cookie predates it — only a fresh sign-in
      re-runs the hook that puts orgId in the session. */
  | { kind: "member" }
  | { kind: "none" };

const CARD = "w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm";
const PRIMARY =
  "mt-5 flex w-full items-center justify-center rounded-lg bg-zinc-900 px-4 py-2.5 " +
  "text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60";
const QUIET =
  "rounded-lg px-3 py-2 text-sm font-semibold text-zinc-700 underline " +
  "underline-offset-2 hover:text-zinc-900 disabled:opacity-60";

export function StartScreen({
  state,
  email,
  onCreate,
}: {
  state: StartState;
  email: string | null;
  onCreate: () => Promise<CreateOrgResult>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await onCreate();
    if (res.ok) {
      /* PUSH ONLY — no refresh() first. The action already wrote the session
         cookie, so /welcome is fetched with the new org in hand; refreshing
         would re-render THIS page, which now redirects to /dashboard for
         having an org, and the two navigations would race. */
      router.push("/welcome");
      return;
    }
    setError(res.error);
    setBusy(false);
  };

  /* Named after what it does to THIS reader. On the invite screens it is the
     other door and reads as one; with nothing waiting it is the only door and
     carries the weight. */
  const createDoor = (primary: boolean) =>
    primary ? (
      <button type="button" className={PRIMARY} disabled={busy} onClick={create}>
        {busy ? "Creating…" : "Create a company"}
      </button>
    ) : (
      <button type="button" className={QUIET} disabled={busy} onClick={create}>
        {busy ? "Creating…" : "Create a company instead"}
      </button>
    );

  const company = state.kind === "invite" || state.kind === "expired" ? state.company : null;
  const named = company ?? "A company on HeyTiff";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50 px-6 py-10">
      <div className="flex items-center gap-2">
        <Chevron size={26} gradient decorative />
        <Wordmark className="text-xl" />
      </div>

      <div className={CARD}>
        {error && (
          <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
            {error}
          </p>
        )}

        {state.kind === "invite" && (
          <>
            <h1 className="text-xl font-semibold text-zinc-900">You&rsquo;ve been invited</h1>
            <p className="mt-1 text-sm text-zinc-500">
              {named} has invited you to join as <b className="text-zinc-700">{state.role}</b>.
            </p>
            <a className={PRIMARY} href={`/invite/accept?token=${state.token}`}>
              Join {company ?? "the team"}
            </a>
            <div className="mt-5 border-t border-zinc-200 pt-4">{createDoor(false)}</div>
          </>
        )}

        {state.kind === "expired" && (
          <>
            <h1 className="text-xl font-semibold text-zinc-900">
              That invitation has expired
            </h1>
            {/* The renewal is one press on their end, and saying so is the
                difference between waiting and giving up — it is not visible
                from this side of the invite. */}
            {/* `{" "}` is load-bearing: this paragraph carries an `&rsquo;`,
                and a JSXText run holding an entity loses the space that sits
                between `{named}` and the words after it — "Diamond Airinvited
                you". Same trap as the one already logged for entities after an
                expression; the remedy is the explicit space. */}
            <p className="mt-1 text-sm text-zinc-500">
              {named}{" "}
              invited you, but invitations run out after seven days. Ask them to renew it from
              their Team page and you&rsquo;ll get a fresh link.
            </p>
            <div className="mt-5 border-t border-zinc-200 pt-4">{createDoor(false)}</div>
          </>
        )}

        {state.kind === "member" && (
          <>
            <h1 className="text-xl font-semibold text-zinc-900">Your workspace is ready</h1>
            <p className="mt-1 text-sm text-zinc-500">
              You joined from another browser or device. Sign in again here to open it.
            </p>
            <a className={PRIMARY} href="/auth/login?returnTo=%2Fdashboard">
              Sign in again
            </a>
          </>
        )}

        {state.kind === "none" && (
          <>
            <h1 className="text-xl font-semibold text-zinc-900">Set up your workspace</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Create the company you run, and you can invite your team once it exists.
            </p>
            {createDoor(true)}
            {/* The one fact nobody can see from here: an invitation is bound
                to an address, and this is the address they arrived on. Someone
                waiting for an invite that is sitting in a different inbox has
                no other way to find that out. */}
            <p className="mt-5 border-t border-zinc-200 pt-4 text-sm text-zinc-500">
              Waiting on an invitation? It has to be sent to the address you sign in with
              {email ? (
                <>
                  {" "}
                  — <b className="font-semibold text-zinc-700">{email}</b>
                </>
              ) : null}
              .
            </p>
          </>
        )}
      </div>

      {/* Signing in with the wrong account is the other way to land here, and
          without this the screen is a dead end for anyone who did. */}
      <p className="text-sm text-zinc-500">
        {email ? `Signed in as ${email}. ` : null}
        <a className="font-semibold text-zinc-700 underline underline-offset-2" href="/auth/logout">
          Sign out
        </a>
      </p>
    </main>
  );
}
