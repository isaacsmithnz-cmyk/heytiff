import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { readStart } from "@/lib/mobile/start";
import { sessionIdentity } from "@/lib/session-identity";
import { createMyOrg } from "@/app/actions/org-create";
import { askFromStart, confirmFromStart, joinFromStart, saveFirstRunStep } from "@/app/actions/first-run";
import { StartScreen } from "@/components/start/start-screen";

/* The door for a signed-in person who belongs to nowhere — the phone's first
   door, on the web (bug 101; Isaac, 26 November 2026: "make the web first run
   match the phone").

   THIS STATE USED TO BE IMPOSSIBLE, and that was the bug. Signing in founded
   a company for anyone without a membership, so "I was invited but I signed
   up first" produced a silent phantom org with that person as its owner. The
   proxy sends every org-less session here instead.

   IT ANSWERS THE QUESTION BEFORE ASKING IT, from the same reading the phone's
   door makes (lib/mobile/start's readStart): an invitation waiting for this
   address (Join it), one that has run out (ask the inviter for a new one),
   nothing (first what that may mean, then Set up your business), or an
   address Auth0 hasn't verified (confirm it first). An invitation is matched
   only on a verified address, as the phone matches it. */

export default async function StartPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  if (session.orgId) redirect("/dashboard");
  const who = sessionIdentity(session);
  if (!who) redirect("/auth/login");

  const state = await readStart(who);
  return (
    <StartScreen
      state={state}
      email={who.shownEmail}
      actions={{ join: joinFromStart, ask: askFromStart, confirm: confirmFromStart, create: createMyOrg, save: saveFirstRunStep }}
    />
  );
}
