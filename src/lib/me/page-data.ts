import { loadMyLeave } from "@/lib/timepay/leave-page";

/* WHAT IS LEFT OF THE ME CARD'S LOAD: Leave. Timesheet, Expense claims,
   Your vehicle and Notes are pages of their own under Your name (Isaac,
   24 October 2026) and each loads its own rows; Leave's page replaces this
   next. Nobody is redirected for a missing staff card: `leave` comes back
   null and the face says why. */

export type MeData = {
  leave: Awaited<ReturnType<typeof loadMyLeave>>;
};

export async function loadMe(): Promise<MeData> {
  return { leave: await loadMyLeave() };
}
