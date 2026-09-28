import { Chevron, Wordmark } from "@/components/logo";

/* The frame every door outside the workspace wears: /start, and the screen an
   invitation link lands on when it cannot be accepted.

   ONE FRAME, SO THE TWO CANNOT DRIFT. An invitee can meet both inside a
   minute — a link that has expired, then /start saying the same thing — and
   they have to read as one product. The error screen used to be red text on a
   white page with no mark on it, which is the look of a phish, on the screen
   that most needs to be believed.

   No hooks and no "use client": the error page is a server component, and
   /start's client screen imports this as well. Class strings live here as
   plain values for the same reason — a constant exported from a client module
   reaches a server component as a reference, not a string. */

export const PRIMARY =
  "mt-5 flex w-full items-center justify-center rounded-lg bg-zinc-900 px-4 py-2.5 " +
  "text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60";
export const QUIET =
  "rounded-lg px-3 py-2 text-sm font-semibold text-zinc-700 underline " +
  "underline-offset-2 hover:text-zinc-900 disabled:opacity-60";
export const TITLE = "text-xl font-semibold text-zinc-900";
export const LEAD = "mt-1 text-sm text-zinc-500";
/** The second door on a card, below a hairline. */
export const AFTER = "mt-5 border-t border-zinc-200 pt-4";

export function DoorFrame({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-50 px-6 py-10">
      <div className="flex items-center gap-2">
        <Chevron size={26} gradient decorative />
        <Wordmark className="text-xl" />
      </div>

      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        {children}
      </div>

      {footer}
    </main>
  );
}
