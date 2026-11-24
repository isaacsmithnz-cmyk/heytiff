import "server-only";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can, getDbRole } from "@/lib/permissions-server";
import type { Capability } from "@/lib/permissions";
import type { MobileCtx } from "@/lib/mobile/auth";
import type { Sm8Press } from "@/lib/integrations/sm8-press";
import { sm8LeaveAllowed } from "@/lib/integrations/sm8-kinds";
import { getSm8Timezone } from "@/lib/workboard/query";
import { addUsed, changeUsed, dayFor } from "@/lib/mobile/used";
import { readUsedWords } from "@/lib/mobile/used-read";
import type { Ready } from "@/lib/mobile/used-plan";
import { addStint, changeStint } from "@/lib/mobile/day";
import { completeChecked } from "@/lib/mobile/complete-checked";
import { createBlock, removeBlock } from "@/lib/schedule/blocks-store";
import { sm8StaffOfCard } from "@/lib/workboard/note-move-read";
import { applyTaskEdit } from "@/lib/workboard/visit-tasks-server";
import { workdayHours } from "@/lib/dashboard/reminders-query";
import { getOwnVehicle, listVehiclePicker } from "@/lib/fleet/query";
import { clientMatchOf, siteMatchOf } from "@/lib/email/proposal-server";
import { addLine, removeLine, readLines } from "@/lib/quotes/lines-server";
import { linePricer } from "@/lib/quotes/session/tools-server";
import { readByHand } from "@/lib/quotes/lines-job-server";
import { makeWorkOrder, markUnsuccessful } from "@/app/actions/booking-sm8";
import { createNewJob } from "@/app/actions/job-new";
import { requestLeave, cancelLeave } from "@/app/actions/leave";
import { addLog, deleteLog } from "@/app/actions/fleet";
import { addSiteNote, removeSiteNote } from "@/app/actions/site-notes";
import { readCustomerForEdit, saveCustomer } from "@/app/actions/job-customer";
import { STATUS_WORDS, clock, linesWords, shortDay, type ProposedSkill, type SkillLine, type SkillMade } from "./note-skills";
import type { NoteReceipt } from "./note-cost";
import { jobHref } from "@/lib/shell/links";
import { isStarred, setStar } from "@/lib/jobs/job-stars";

/* TIFF'S SKILLS, DONE — server only (note-skills holds what each is).

   Each through the action the app already has for it, behind that action's
   own gate, so Tiff can do nothing the person couldn't do with a press:
   the phone's Used (addUsed), Add a job's time (addStint), the office's
   Completed (completeChecked) and the job card's Make work order, New job
   (createNewJob), Block out time (createBlock), the job's Add task, Leave
   (requestLeave), Vehicles (addLog), Site notes (addSiteNote), Customer
   (saveCustomer) and the quote's lines (addLine).

   Each comes back as Tiff's line and, when something was made, what Undo
   needs to take it back (`undoSkill`). ServiceM8 can't take back a status
   or a job made, so those are asked first (note-skills `confirms`) and
   have no Undo; nor can a contact sent to ServiceM8. */

/** Who's filing, and their ServiceM8 press: the action that calls here
    makes it from the session, as only a "use server" action may. */
export type SkillCtx = { orgId: string; userId: string; staffId: string | null; press: Sm8Press | null };
export type SkillTarget = { kind: string; id?: string | null };
export type SkillStep = { made: SkillMade | null; line: string };

const said = (line: string): SkillStep => ({ made: null, line });

async function mobileCtx(ctx: SkillCtx): Promise<MobileCtx> {
  const [role, manage] = await Promise.all([getDbRole(), can("workboard_manage")]);
  return {
    userId: ctx.userId,
    orgId: ctx.orgId,
    role,
    caps: new Set<Capability>(["workboard", ...(manage ? (["workboard_manage"] as const) : [])]),
    orgIds: [ctx.orgId],
  };
}

/** The instant of a wall-clock time on a day, in the account's zone. */
export function instantIn(day: string, hhmm: string, tz: string): string {
  const guess = Date.parse(`${day}T${hhmm}:00Z`);
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(guess))
    .reduce<Record<string, string>>((m, p) => ({ ...m, [p.type]: p.value }), {});
  const seen = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`);
  return new Date(guess - (seen - guess)).toISOString();
}

const jobOf = (target: SkillTarget): string | null => (target.kind === "job" && target.id ? target.id : null);
const NO_JOB = "That needs a job, and this note isn't on one.";
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Do one skill (one asked first only once it's been said yes to). */
export async function doSkill(
  ctx: SkillCtx,
  s: ProposedSkill,
  index: number,
  target: SkillTarget,
  o: { today: string; jobLabel: string | null; receipt: NoteReceipt | null; who: string },
): Promise<SkillStep> {
  const made = (line: string, undo: SkillMade["undo"], open?: string): SkillStep => ({
    made: { index, kind: s.kind, line, undo, ...(open ? { open } : {}), undone: false },
    line,
  });
  const job = jobOf(target);
  const mine = !s.whoId || s.whoId === ctx.staffId;

  switch (s.kind) {
    case "used":
    case "stock_taken": {
      if (!job) return said(NO_JOB);
      const unit = s.kind === "used" ? s.unit : "";
      const words = [s.qty, unit, s.what].filter(Boolean).join(" ");
      const found = (await readUsedWords(ctx.orgId, words, job).catch(() => null)) ?? [];
      const ready: Ready[] = found.length
        ? found.map((f) => ({ ...f, qty: f.qty ?? s.qty }))
        : [{ said: words, name: s.what, qty: s.qty, unit: unit || null, supplierKey: null, code: null, choices: null }];
      const day = await dayFor(ctx.orgId, o.today);
      if (!day) return said("The job's Used list for today couldn't be opened.");
      const r = await addUsed(await mobileCtx(ctx), job, day, words, ready);
      if (!r.added.length) {
        const a = r.asks[0];
        return said(a ? `${a.name} is on the job's Used already (${a.had}${a.unit ? ` ${a.unit}` : ""}), so I've left it: change it there if it's more.` : `${s.what} wasn't put on the job's Used.`);
      }
      const what = r.added.map((l) => `${l.name}, ${l.qty}${l.unit ? ` ${l.unit}` : ""}`).join("; ");
      const from = s.kind === "stock_taken" && s.from ? ` There's no stock to take it out of in HeyTiff yet, so it's on the job's Used, from ${s.from}.` : "";
      return made(`On the job's Used: ${what}.${from}`, { do: "used", job, ids: r.added.map((l) => l.id) });
    }

    case "time_on_job": {
      if (!job) return said(NO_JOB);
      const tz = (await getSm8Timezone(ctx.orgId)) ?? "Australia/Sydney";
      const from = instantIn(o.today, s.from, tz);
      const until = instantIn(o.today, s.until, tz);
      const press = ctx.press;
      const r = await addStint(await mobileCtx(ctx), job, from, until, Date.now(), press);
      if (!r.ok) return said(`Your time wasn't added: ${r.error}`);
      const { data } = await supabaseAdmin
        .from("job_check_ins")
        .select("id")
        .eq("org_id", ctx.orgId)
        .eq("user_id", ctx.userId)
        .eq("sm8_job_uuid", job)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const id = (data as { id: string } | null)?.id ?? null;
      return made(`Your time is on${o.jobLabel ? ` ${o.jobLabel}` : " the job"} today, ${clock(s.from)} to ${clock(s.until)}.`, id ? { do: "stint", id } : null);
    }

    case "job_status": {
      if (!job) return said(NO_JOB);
      const words = STATUS_WORDS[s.to];
      if (s.to === "completed") {
        if (!(await can("workboard_manage"))) return said(`Only someone who manages the board can mark a job ${words}.`);
        const r = await completeChecked(ctx.press, ctx.orgId, job);
        return said(r.queued ? `${o.jobLabel ?? "The job"} is going to ServiceM8 as Completed.` : `It wasn't marked Completed: ${r.why}`);
      }
      const r = s.to === "work_order" ? await makeWorkOrder({ jobUuid: job, pressId: randomUUID() }) : await markUnsuccessful({ jobUuid: job, pressId: randomUUID() });
      return said(r.ok ? `${o.jobLabel ?? "The job"} is going to ServiceM8 as ${words}.` : `It wasn't marked ${words}: ${r.error}`);
    }

    case "new_job": {
      const client = s.client ? await clientMatchOf(ctx.orgId, s.client).catch(() => null) : null;
      const site = s.address ? await siteMatchOf(ctx.orgId, s.address).catch(() => null) : null;
      const [first, ...rest] = s.client.split(" ");
      const r = await createNewJob({
        client: client ? { kind: "existing", uuid: client.uuid } : { kind: "new", name: s.client || s.address, address: s.address },
        jobAddress: site?.address ?? s.address,
        description: s.work,
        categoryUuid: null,
        contact: s.client || s.phone || s.email ? { first: first ?? "", last: rest.join(" "), mobile: s.phone, phone: "", email: s.email } : null,
        pressId: randomUUID(),
        clientName: client?.name ?? s.client,
        via: "tiff",
        next: null,
      });
      return r.ok ? made(`The job is made${s.address ? ` at ${s.address}` : ""}, as a Quote in ServiceM8.`, null, jobHref(r.jobUuid)) : said(`The job wasn't made: ${r.error}`);
    }

    case "block_out": {
      const card = s.whoId ?? ctx.staffId;
      if (!card) return said("Your staff profile isn't set up yet, so nothing's blocked out.");
      if (!mine && !(await can("workboard_manage"))) return said(`Only someone who manages the schedule can block out ${o.who || "someone else"}'s time.`);
      const staffUuid = await sm8StaffOfCard(ctx.orgId, card);
      if (!staffUuid) return said(`${mine ? "You're" : `${o.who || "They"} isn't`} not linked to a ServiceM8 staff member, so nothing's blocked out.`);
      const press = sm8LeaveAllowed() ? ctx.press : null;
      const r = await createBlock(ctx.orgId, ctx.staffId, { what: s.what || "Away", where: "", minutes: minutes(s.end) - minutes(s.start), place: { staffUuid, day: s.day, startMin: minutes(s.start) } }, press);
      if (!r.ok) return said(`It wasn't blocked out: ${r.error}`);
      return made(`${mine ? "You're" : `${o.who} is`} blocked out ${shortDay(s.day, true)} ${clock(s.start)} to ${clock(s.end)}${s.what ? `, ${s.what}` : ""}.`, { do: "block", id: r.id });
    }

    case "photo_request": {
      if (!job) return said(NO_JOB);
      if (!(await can("workboard_manage"))) return said("Only someone who manages the board can add to a job's list, so ask them for the photo.");
      const name = `Photo: ${s.what}`.slice(0, 120);
      const r = await applyTaskEdit(ctx.orgId, job, { userId: ctx.userId, name: null }, { kind: "add", name, stage: "Install", taskKind: "photos", visit: null } as Parameters<typeof applyTaskEdit>[3]);
      if (!r.ok) return said(`The photo wasn't asked for: ${r.reason}`);
      const { data } = await supabaseAdmin.from("job_tasks").select("id").eq("org_id", ctx.orgId).eq("sm8_job_uuid", job).eq("name", name).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const id = (data as { id: string } | null)?.id;
      return made(`On the job's list for next visit: a photo of ${s.what}.`, id ? { do: "task", job, id } : null);
    }

    case "leave": {
      if (!mine) return said(`${o.who || "They"} asks for their own leave, from Leave on their phone.`);
      const hours = await leaveHours(ctx, s.fromDay, s.toDay, s.part);
      const r = await requestLeave({
        kind: s.leave === "sick" ? "personal" : s.leave,
        startDate: s.fromDay,
        endDate: s.toDay,
        hours,
        ...(s.why || s.leave === "sick" ? { note: [s.leave === "sick" ? "Sick" : "", s.why].filter(Boolean).join(": ") } : {}),
      });
      if (!r.ok) return said(`Your leave wasn't booked: ${r.error}`);
      const days = s.toDay !== s.fromDay ? `${shortDay(s.fromDay, true)} to ${shortDay(s.toDay, true)}` : shortDay(s.fromDay, true);
      return made(`${s.leave === "sick" ? "Sick leave" : "Leave"} asked for, ${days}, ${hours} hours.${r.note ? ` ${r.note}` : ""}`, r.id ? { do: "leave", id: r.id } : null);
    }

    case "fuel":
    case "vehicle_issue": {
      const v = await vehicleFor(ctx, s.vehicleHint);
      if (!v) return said(s.vehicleHint ? `I couldn't find the vehicle "${s.vehicleHint}".` : "You don't have a vehicle in Vehicles, so say which one.");
      const fuel = s.kind === "fuel" && (s.litres > 0 || s.amount > 0);
      const r = await addLog(
        s.kind === "vehicle_issue"
          ? { vehicleId: v.id, kind: "issue", note: s.problem }
          : fuel
            ? { vehicleId: v.id, kind: "fuel", source: "manual", ...(s.litres ? { litres: s.litres } : {}), ...(s.amount ? { cost: s.amount } : {}), ...(s.km ? { odo: s.km } : {}), ...(o.receipt ? { receiptDocumentId: o.receipt.documentId } : {}) }
            : { vehicleId: v.id, kind: "odo", odo: s.km, source: "manual" },
      );
      if (!r.ok) return said(`${s.kind === "fuel" ? "The fuel" : "The problem"} wasn't logged: ${"error" in r ? String(r.error) : "refused"}`);
      const { data } = await supabaseAdmin.from("vehicle_logs").select("id").eq("org_id", ctx.orgId).eq("vehicle_id", v.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const id = (data as { id: string } | null)?.id;
      const line =
        s.kind === "vehicle_issue"
          ? `Logged on ${v.name}: ${s.problem}.`
          : `Logged on ${v.name}: ${[s.litres ? `${s.litres} L` : "", s.amount ? `$${s.amount.toFixed(2)}` : "", s.km ? `${s.km.toLocaleString("en-AU")} km` : ""].filter(Boolean).join(", ")}${o.receipt ? ", with the receipt" : ""}.`;
      return made(line, id ? { do: "vehicleLog", id } : null);
    }

    case "site_note": {
      if (!job) return said(NO_JOB);
      const r = await addSiteNote({ jobUuid: job, kind: "other", words: s.text, whole: true });
      return r.ok ? made(`A site note for next time: ${s.text}.`, { do: "siteNote", job, id: r.id }) : said(`The site note wasn't kept: ${r.error}`);
    }

    case "job_contact": {
      if (!job) return said(NO_JOB);
      const now = await readCustomerForEdit(job);
      if (!now.ok) return said(`${s.name} wasn't added: ${now.error}`);
      const [first, ...rest] = s.name.split(" ");
      const mobile = /^(?:\+?61|0)4/.test(s.phone.replace(/\s/g, "")) ? s.phone : "";
      const r = await saveCustomer(randomUUID(), {
        ...now.form,
        contacts: [...now.form.contacts, { uuid: null, first: first ?? "", last: rest.join(" "), mobile, phone: mobile ? "" : s.phone, email: s.email, type: contactType(s.role) }],
      });
      return r.ok ? said(`${s.name} is a contact on the job${r.waiting ? ", on its way to ServiceM8" : ""}.`) : said(`${s.name} wasn't added: ${r.error}`);
    }

    case "quote_add":
      return addToQuote(ctx, job, s.what, s.lines, index, s.kind);

    case "swap_visit":
      return said("I can't give a booking to someone else yet: drag it to them on the Schedule.");

    /* the job head's Star, as you (lib/jobs/job-stars); Undo puts it back as it was */
    case "star_job": {
      if (!job) return said(NO_JOB);
      const owner = { orgId: ctx.orgId, userId: ctx.userId };
      const was = await isStarred(owner, job).catch(() => false);
      const r = await setStar(owner, job, s.on);
      const name = o.jobLabel || "The job";
      if (!r.ok) return said(r.error);
      if (was === s.on) return said(s.on ? `${name} is already in your Starred.` : `${name} wasn't starred.`);
      return made(s.on ? `${name} is in your Starred.` : `${name} is off your Starred.`, { do: "star", job, on: was });
    }
  }
}

/** The contact's role, as ServiceM8 names it. */
function contactType(role: string): string {
  const r = role.toLowerCase();
  if (/tenant/.test(r)) return "Tenant";
  if (/owner/.test(r)) return "Property Owner";
  if (/manager|agent/.test(r)) return "Property Manager";
  if (/bill|account/.test(r)) return "BILLING";
  if (/site|builder|super/.test(r)) return "Site Contact";
  return "JOB";
}

/** The vehicle a note means: the one named, or the speaker's own. */
async function vehicleFor(ctx: SkillCtx, hint: string): Promise<{ id: string; name: string } | null> {
  const h = hint.toLowerCase().replace(/\s+/g, "");
  if (h && !/^(?:the|my)?(?:ute|van|car|truck|vehicle)$/.test(h)) {
    const all = await listVehiclePicker(ctx.orgId).catch(() => []);
    const hit = all.filter((v) => [v.name, v.plate, `${v.make}${v.model}`, v.model].some((x) => x && x.toLowerCase().replace(/\s+/g, "").includes(h)));
    if (hit.length === 1) return { id: hit[0]!.id, name: hit[0]!.name || hit[0]!.plate };
    if (hit.length > 1) return null;
  }
  const own = await getOwnVehicle(ctx.orgId, ctx.staffId).catch(() => null);
  return own ? { id: own.id, name: own.name || own.plate } : null;
}

/** The hours a leave asks for: the speaker's working day, Monday to
    Friday, half of it for a morning or an afternoon. The Leave form reads
    the roster; this is its plain week. */
async function leaveHours(ctx: SkillCtx, from: string, to: string, part: string): Promise<number> {
  const { start, end } = await workdayHours(ctx.orgId, ctx.staffId);
  const day = Math.max(0, (minutes(end) - minutes(start)) / 60);
  let days = 0;
  for (let d = Date.parse(`${from}T00:00:00Z`); d <= Date.parse(`${to}T00:00:00Z`); d += 86_400_000) {
    const wd = new Date(d).getUTCDay();
    if (wd !== 0 && wd !== 6) days++;
  }
  const hours = part !== "day" && from === to ? day / 2 : days * day;
  return Math.round(hours * 4) / 4;
}

/** Lines onto the job's quote: on the quote itself while nothing is
    accepted, as the quote page's own Add does. Priced as the quote builder
    prices a said line (linePricer): labour at the business's hour. */
export async function addToQuote(
  ctx: SkillCtx,
  job: string | null,
  what: string,
  lines: readonly SkillLine[],
  index: number,
  kind: "quote_add",
  option?: number,
): Promise<SkillStep> {
  if (!job) return said(NO_JOB);
  if (!(await can("workboard"))) return said("Changing a quote needs access to Jobs.");
  const [byHand, now] = await Promise.all([readByHand(ctx.orgId, job), readLines(ctx.orgId, job)]);
  if (option === undefined && byHand.accepted.length) return said(`The quote's accepted already, so ${what} is a variation: say it as one and I'll start it.`);
  const at = option ?? (now.length ? Math.min(...now.map((l) => l.optionIndex)) : 0);
  const system = now.find((l) => l.optionIndex === at)?.system ?? now[0]?.system ?? "Extras";
  const pricer = linePricer(ctx.orgId, job);
  const ids: { id: string; version: number }[] = [];
  const refused: string[] = [];
  for (const l of lines) {
    const row = await pricer.lineFor({
      optionIndex: at,
      system,
      group: option === undefined ? "Added" : "Variation",
      name: l.what,
      code: null,
      kind: l.kind,
      qty: l.kind === "labour" ? l.hours : l.qty,
      unit: l.kind === "labour" ? "h" : "",
      source: "said",
      why: what,
    });
    if (typeof row === "string") {
      refused.push(`${l.what}: ${row}`);
      continue;
    }
    const r = await addLine(ctx.orgId, job, row, ctx.userId, what);
    if (r.ok && r.line) ids.push({ id: r.line.id, version: r.line.version });
    else refused.push(`${l.what}: ${r.ok ? "not added" : r.reason}`);
  }
  if (!ids.length) return said(`Nothing went on the quote. ${refused.join(" ")}`);
  const line = `On the ${option === undefined ? "quote" : "variation"}: ${what}, ${linesWords(lines)}, to check and price.${refused.length ? ` Not added: ${refused.join("; ")}.` : ""}`;
  return {
    made: { index, kind, line, undo: { do: "lines", job, ids }, undone: false },
    line,
  };
}

/** Take a skill back, as its own action's Undo does. Null: taken back; a
    sentence: why not. */
export async function undoSkill(ctx: SkillCtx, m: SkillMade): Promise<string | null> {
  const u = m.undo;
  if (!u) return null;
  const str = (k: string) => (typeof u[k] === "string" ? (u[k] as string) : "");
  switch (u.do) {
    case "used": {
      const mctx = await mobileCtx(ctx);
      for (const id of Array.isArray(u.ids) ? (u.ids as string[]) : []) {
        const r = await changeUsed(mctx, str("job"), id, { do: "off" });
        if ("error" in r) return String(r.error);
      }
      return null;
    }
    case "stint": {
      const r = await changeStint(await mobileCtx(ctx), str("id"), null, null, true, Date.now(), undefined, ctx.press);
      return r.ok ? null : r.error;
    }
    case "block": {
      const r = await removeBlock(ctx.orgId, str("id"), sm8LeaveAllowed() ? ctx.press : null);
      return r.ok ? null : r.error;
    }
    case "task": {
      const r = await applyTaskEdit(ctx.orgId, str("job"), { userId: ctx.userId, name: null }, { kind: "remove", id: str("id") } as Parameters<typeof applyTaskEdit>[3]);
      return r.ok ? null : r.reason;
    }
    case "leave": {
      const r = await cancelLeave(str("id"));
      return r.ok ? null : r.error;
    }
    case "vehicleLog": {
      const r = await deleteLog(str("id"));
      return r.ok ? null : "error" in r ? String(r.error) : "It couldn't be taken back.";
    }
    case "siteNote": {
      const r = await removeSiteNote({ jobUuid: str("job"), id: str("id") });
      return r.ok ? null : r.error;
    }
    case "star": {
      const r = await setStar({ orgId: ctx.orgId, userId: ctx.userId }, str("job"), u.on === true);
      return r.ok ? null : r.error;
    }
    case "lines": {
      for (const l of Array.isArray(u.ids) ? (u.ids as { id: string; version: number }[]) : []) {
        const r = await removeLine(ctx.orgId, str("job"), l.id, l.version, ctx.userId, "Taken back");
        if (!r.ok && !r.stale) return r.reason;
      }
      return null;
    }
  }
  return null;
}
