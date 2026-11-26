import { Chevron, Wordmark } from "@/components/logo";

/* The frame every door outside the workspace wears: /start, the first run
   (/welcome, /welcome/details), and the screen an invitation link lands on
   when it cannot be accepted.

   ONE FRAME, SO THE DOORS CANNOT DRIFT. An invitee can meet several inside a
   minute — a link that has expired, then /start saying the same thing — and
   they have to read as one product. Since 26 November 2026 they also read as
   the phone's (bug 101, "make the web first run match the phone"): the same
   steps, the same words, the phone's grey ground with white groups on it, in
   the web's own sizes (design.md rules 12, 22, 28, 33).

   No hooks and no "use client": the error page is a server component, and the
   client screens import this as well. Class strings live here as plain values
   for the same reason — a constant exported from a client module reaches a
   server component as a reference, not a string. */

/** The main button: blue, white words (rule 22). */
export const PRIMARY =
  "inline-flex h-9 items-center justify-center rounded-[var(--r-button)] bg-[var(--blue)] px-4 " +
  "text-[14px] font-semibold text-white " +
  "focus-visible:shadow-[var(--ring)] focus-visible:outline-none disabled:opacity-60";
/** The second button: white in a thin outline (rule 23). */
export const SECOND =
  "inline-flex h-9 items-center justify-center rounded-[var(--r-button)] border border-[var(--edge)] bg-white px-4 " +
  "text-[14px] font-semibold text-[var(--ink)] transition-colors duration-[120ms] ease-out hover:bg-[var(--hov)] " +
  "focus-visible:shadow-[var(--ring)] focus-visible:outline-none disabled:opacity-60";
/** The quiet button: no edge until pointed at (rule 24). */
export const QUIET =
  "inline-flex h-9 items-center justify-center rounded-[var(--r-button)] px-3 text-[14px] font-semibold " +
  "text-[var(--ink)] transition-colors duration-[120ms] ease-out hover:bg-[var(--hov)] " +
  "focus-visible:shadow-[var(--ring)] focus-visible:outline-none disabled:opacity-60";
/** A screen title (rule 12). */
export const TITLE = "text-[24px] font-semibold leading-8 text-[var(--ink)] [text-wrap:balance]";
/** The fact under a title. */
export const LEAD = "mt-1 text-[14px] leading-5 text-[var(--q)]";
/** The second door on a card, below a hairline. */
export const AFTER = "mt-5 border-t border-[var(--line)] pt-4";
/** A white group on the grey, as the phone's. */
export const GROUP = "rounded-[var(--r-card)] bg-white";

export function DoorFrame({
  children,
  footer,
  wide = false,
  bare = false,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** a step with a form: room for two boxes side by side */
  wide?: boolean;
  /** the screen draws its own white groups; without it, everything sits in one white card */
  bare?: boolean;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[var(--soft)] px-4 py-10">
      <div className="flex items-center gap-2 text-[var(--ink)]">
        <Chevron size={26} decorative />
        <Wordmark className="text-xl" />
      </div>

      <div className={`w-full ${wide ? "max-w-[560px]" : "max-w-md"} ${bare ? "" : `${GROUP} p-6`}`}>{children}</div>

      {footer}
    </main>
  );
}
