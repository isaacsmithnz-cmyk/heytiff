/* A project's rules that outlived the projects Urgent queue. Pure: callers
   pass the dates on the account's clock. */

/** Where a HeyTiff plan and the ServiceM8 diary disagree on a linked job —
    a chip, never an auto-write in either direction (decision: show + chip). */
export function sm8BookingMismatch(
  bookedDate: string | null,
  mirrorNextStart: string | null
): "none" | "differs" | "diary_only" {
  if (!mirrorNextStart) return "none";
  const diaryDay = mirrorNextStart.slice(0, 10);
  if (!bookedDate) return "diary_only";
  return diaryDay === bookedDate ? "none" : "differs";
}

