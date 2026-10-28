import { pendingRequests } from "@/lib/timepay/leave-query";
import { loadTimepay } from "@/lib/timepay/page-data";
import { staffIdFor } from "@/lib/workboard/projects-query";
import { derive, type WeekCtx } from "@/components/timepay/logic";
import { approveLeave, declineLeave } from "@/app/actions/leave";
import { approveWeek, sendBackWeek } from "@/app/actions/timepay";
import { actAsPhoneUser, ok, requireMobile } from "@/lib/mobile/auth";

/* APPROVALS ON THE PHONE (Isaac, 28 October 2026): leave asked for, and
   timesheets sent for this period or the one before, for whoever holds
   `approvals`; never your own. Reading them is the Team screen's own
   loaders, and deciding is the web's own actions (approveLeave, declineLeave,
   approveWeek, sendBackWeek) run as the phone's verified person
   (actAsPhoneUser), so every rule they keep is kept the same way: no
   approving your own, a decline and a send-back each need their reason,
   approved leave clashing with a sent sheet is refused. */

const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  if (!ctx.caps.has("approvals")) return no(403, "You don't approve leave or timesheets here.");
  const me = await staffIdFor(ctx.orgId, ctx.userId).catch(() => null);

  const leave = (await pendingRequests(ctx.orgId))
    .filter((r) => r.staffId !== me)
    .map((r) => ({
      id: r.id,
      staffName: r.staffName ?? "Someone",
      kind: r.kind,
      startDate: r.startDate,
      endDate: r.endDate,
      hours: r.hours,
      note: r.note ?? null,
      certExpected: !!r.certExpected,
    }));

  /* timesheets sent and waiting: this period, and the one before (a week sends itself on its last day) */
  const sheets = await actAsPhoneUser(ctx, async () => {
    const now = await loadTimepay({ pay: false });
    if (!now) return [];
    const before = now.periods[now.periodIndex + 1];
    const then = before ? await loadTimepay({ pay: false }, before.start) : null;
    return [now, then].flatMap((t) => {
      if (!t) return [];
      const period = t.periods[t.periodIndex];
      if (!period) return [];
      return t.staff
        .filter((s) => s.id !== me && t.sheets[s.id]?.status === "submitted")
        .map((s) => {
          const week: WeekCtx = { week: t.week, today: t.today, through: t.through, workDays: s.workDays, dayHours: s.dayHours, holidays: s.holidayDays, certMissing: s.certMissing };
          const d = derive(s, t.settings, week);
          return {
            staffId: s.id,
            name: s.name,
            period: { start: period.start, range: period.range },
            worked: d.worked,
            normal: d.normal,
            ot: d.ot,
            ot2: d.ot2,
            paidAbsence: d.leave + d.sick + d.ph,
          };
        });
    });
  });
  return ok({ leave, sheets });
}

export async function POST(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  if (!ctx.caps.has("approvals")) return no(403, "You don't approve leave or timesheets here.");
  const body = (await request.json().catch(() => null)) as {
    do?: unknown;
    id?: unknown;
    decision?: unknown;
    reason?: unknown;
    staffId?: unknown;
    period?: unknown;
    question?: unknown;
  } | null;
  const text = (v: unknown) => (typeof v === "string" ? v : "");

  if (body?.do === "leave" && text(body.id)) {
    const r =
      body.decision === "approve"
        ? await actAsPhoneUser(ctx, () => approveLeave(text(body.id)))
        : body.decision === "decline"
          ? await actAsPhoneUser(ctx, () => declineLeave(text(body.id), text(body.reason)))
          : null;
    if (!r) return no(400, "Approve or decline.");
    return r.ok ? ok({ ok: true }) : no(400, r.error);
  }
  if (body?.do === "sheet" && text(body.staffId) && text(body.period)) {
    const r =
      body.decision === "approve"
        ? await actAsPhoneUser(ctx, () => approveWeek(text(body.staffId), text(body.period)))
        : body.decision === "send_back"
          ? await actAsPhoneUser(ctx, () => sendBackWeek(text(body.staffId), text(body.period), text(body.question)))
          : null;
    if (!r) return no(400, "Approve or send back.");
    return r.ok ? ok({ ok: true }) : no(400, r.error);
  }
  return no(400, "Say which leave or timesheet.");
}
