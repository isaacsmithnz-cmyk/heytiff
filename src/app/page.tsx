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

   THE GLOW IS THE SHELL'S, TAKEN DOWN. `.fg .side .glow` is a 250px teal
   radial at .16 — but that sits in a narrow dark rail, and the same alpha
   spread across a whole light page stops being atmosphere and becomes a
   teal tint over the ground. At .11 and .07 the surface still reads as
   #F0F2F5 and the light is something you notice second. They are capped at
   90vw as well: a fixed 620px circle is most of a phone screen, and what
   reads as a soft top-light on a laptop became a teal wash on a 375px one.
   The sign-in page template carries the identical pair, so a person who
   signs in here and lands on the dashboard cannot say where the light
   changed. */

export default function Home() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-9 overflow-hidden bg-surface px-6">
      {/* decorative — the page's light, announcing nothing */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-56 left-1/2 h-[min(620px,90vw)] w-[min(620px,90vw)] -translate-x-1/2 rounded-full bg-brand-teal opacity-[0.11] blur-[140px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-72 left-1/2 h-[min(620px,90vw)] w-[min(620px,90vw)] -translate-x-1/2 rounded-full bg-brand-blue opacity-[0.07] blur-[140px]"
      />

      <div className="relative flex items-center gap-3">
        <Chevron size={44} gradient className="ht-draw" decorative />
        <Wordmark className="text-4xl" />
      </div>

      <div className="relative flex flex-col items-center gap-5">
        {/* the app's primary action: ink, white label, 700 — `.newbtn` */}
        <a
          href="/auth/login?screen_hint=signup"
          className="rounded-2xl bg-ink-2 px-6 py-3.5 text-sm font-bold text-white transition-transform hover:-translate-y-px"
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
