import { Chevron, Wordmark } from "@/components/logo";

/* The door. Everything here is one press away from Auth0's own screen, so
   the two have to look like one product — this page, the Universal Login
   widget (src/lib/brand/auth0/theme.ts) and the mail that follows all draw
   from the same tokens now.

   THE DARK VARIANTS ARE GONE, and were never right. Every element on this
   page carried a `dark:` twin, which Tailwind resolves off the OS setting —
   so on a dark-mode Mac the front door rendered black and the app behind it
   rendered light. globals.css says it out loud: "HeyTiff is a LIGHT design
   ... There is no dark theme". The starter's dark half was deleted from
   globals.css for exactly this reason; this page was the last place still
   carrying it.

   THE LIGHT IS GONE, HERE AND ON THE DASHBOARD. This page carried two
   blurred discs, teal and blue, tuned to match the shell's corner glow so
   that a person who signed in here and landed on the dashboard could not
   say where the light changed. On 2026-09-10 the frame went still
   (docs/design.md, frame-still.test.ts), and by that same argument the door
   goes still with it: ink on paper, and the only light is the page. The
   Auth0 Universal Login template still carries the pair; it is pushed
   separately and should follow. */

export default function Home() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-9 overflow-hidden bg-surface px-6">
      <div className="relative flex items-center gap-3">
        <Chevron size={44} gradient className="ht-draw" decorative />
        <Wordmark className="text-4xl" />
      </div>

      <div className="relative flex flex-col items-center gap-5">
        {/* the app's primary action: ink, white label, 700 — `.newbtn` */}
        <a
          href="/auth/login?screen_hint=signup"
          className="rounded-2xl bg-ink-2 px-6 py-3.5 text-sm font-bold text-white transition-colors hover:bg-ink"
        >
          Create account
        </a>
        <a
          href="/auth/login"
          className="text-sm font-semibold text-ink-2 underline decoration-1 underline-offset-4 transition-colors hover:text-brand-teal-dark"
        >
          Sign in
        </a>
      </div>

      {/* Quiet staff door — HQ 404s for anyone not on the allowlist, so this
          stays low-key rather than secret. returnTo lands staff in /hq
          straight after auth instead of the default /dashboard. */}
      <a
        href="/auth/login?returnTo=/hq"
        className="absolute bottom-6 text-xs font-semibold text-quiet transition-colors hover:text-brand-teal-dark"
      >
        Staff HQ →
      </a>
    </div>
  );
}
