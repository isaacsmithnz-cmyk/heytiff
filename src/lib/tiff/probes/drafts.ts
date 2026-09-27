/* FORTY DRAFT TOOLS AND A PHRASE FOR EACH — for probe P3.

   The universal-Tiff plan turns on tool search once the registry passes
   about thirty tools. P3 asks whether search works on our setup (our model,
   our fallback beta, our cache markers) and whether it picks the right tool
   at least as often as loading everything. That needs a registry the size
   Phase 3 and 4 will make, so these are drafts of the actions those phases
   wrap (the audit of src/app/actions lists them), each with the kind of
   description the plan asks for. Nothing here runs anything: a probe only
   reads which tool the model reached for.

   The phrases use made-up people (Sam, Alex, Priya) and places, so nothing
   here is anyone's real data. */

type Schema = Record<string, unknown>;

export type DraftTool = { name: string; description: string; input_schema: Schema };

const str = { type: "string" } as const;
const obj = (properties: Record<string, unknown>, required: string[]): Schema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

const t = (name: string, description: string, input_schema: Schema): DraftTool => ({ name, description, input_schema });

export const DRAFT_TOOLS: readonly DraftTool[] = [
  // Home: tasks, reminders, issues, flags
  t("task_complete", "Mark one of the person's tasks done. Use when they say they finished something that is on their task list. Not for jobs or visits: those have their own tools.", obj({ task: str }, ["task"])),
  t("task_reopen", "Put a task that was marked done back on the list. Use when they say something isn't finished after all.", obj({ task: str }, ["task"])),
  t("task_set_due", "Move a task's due day. Use when they say a task is now due on another day. Not for visits or calendar events.", obj({ task: str, due: str }, ["task", "due"])),
  t("task_give", "Give an existing task to someone else on the team. Use when they want a task handed over or reassigned. Needs the team capability.", obj({ task: str, person: str }, ["task", "person"])),
  t("reminder_snooze", "Push one of the person's reminders to a later time. Use for 'remind me later', 'snooze that'.", obj({ reminder: str, until: str }, ["reminder", "until"])),
  t("issue_resolve", "Mark a recurring equipment issue on a job as fixed. Use when a fault that kept coming back is now sorted.", obj({ issue: str }, ["issue"])),
  t("issue_reopen", "Reopen an equipment issue that was marked fixed. Use when a fixed fault has come back.", obj({ issue: str }, ["issue"])),
  t("flag_clear", "Take a warning flag off a job on the board. Use when the problem the flag was about is dealt with.", obj({ job: str }, ["job"])),
  t("flag_restore", "Put a flag that was cleared back on a job.", obj({ job: str }, ["job"])),
  // Calendar
  t("calendar_add_event", "Put an event on the team calendar: a toolbox talk, a training day, a meeting. Not for job visits, which live on the workboard.", obj({ title: str, day: str, time: str }, ["title", "day", "time"])),
  t("calendar_edit_event", "Change an event already on the team calendar: its day, time or title.", obj({ event: str, change: str }, ["event", "change"])),
  t("calendar_note_on_event", "Add a note to an event already on the calendar.", obj({ event: str, note: str }, ["event", "note"])),
  // Workboard
  t("visit_checklist_tick", "Tick an item on a maintenance visit's checklist, or untick it. Use when they say a step on a visit is done, like a filter clean or a coil wash.", obj({ visit: str, item: str, done: { type: "boolean" } }, ["visit", "item", "done"])),
  t("visit_checklist_add", "Add an item to a visit's checklist.", obj({ visit: str, item: str }, ["visit", "item"])),
  t("visit_checklist_remove", "Take an item off a visit's checklist.", obj({ visit: str, item: str }, ["visit", "item"])),
  t("visit_bring_add", "Add something to bring to a visit: parts, filters, a ladder. Use for 'we need to take X to site'.", obj({ visit: str, item: str }, ["visit", "item"])),
  t("visit_bring_packed", "Mark something on a visit's bring list as packed, or not.", obj({ visit: str, item: str, packed: { type: "boolean" } }, ["visit", "item", "packed"])),
  t("visit_set_readiness", "Mark whether a visit is ready to go: parts in, access booked, customer confirmed.", obj({ visit: str, ready: { type: "boolean" } }, ["visit", "ready"])),
  t("visit_place", "Put a maintenance visit on a day in the schedule, or move it to another day.", obj({ visit: str, day: str }, ["visit", "day"])),
  t("visit_assign_tech", "Give a maintenance visit to a technician.", obj({ visit: str, person: str }, ["visit", "person"])),
  t("visit_set_status", "Change a visit's status: scheduled, in progress, on hold, cancelled.", obj({ visit: str, status: str }, ["visit", "status"])),
  t("visit_complete", "Mark a maintenance visit as completed.", obj({ visit: str }, ["visit"])),
  t("visit_set_invoiced", "Mark a completed visit as invoiced, or not.", obj({ visit: str, invoiced: { type: "boolean" } }, ["visit", "invoiced"])),
  t("project_set_stage", "Move a project to another stage: quoting, won, in progress, commissioning, handed over.", obj({ project: str, stage: str }, ["project", "stage"])),
  t("project_set_blocked", "Mark a project as blocked, with the reason, or unblock it.", obj({ project: str, reason: str }, ["project", "reason"])),
  t("project_add_claim", "Add a progress claim to a project, with its amount. Money: needs the money capability.", obj({ project: str, amount: str, label: str }, ["project", "amount", "label"])),
  t("job_note_send_to_servicem8", "Send a note on a job to ServiceM8 so it shows in the job's diary there.", obj({ job: str, note: str }, ["job", "note"])),
  t("job_email_documents", "Email a job's compliance documents (SWMS, commissioning sheet, certificates) to the customer.", obj({ job: str, documents: str }, ["job", "documents"])),
  // Me
  t("leave_request", "Request leave for the person asking: annual leave, sick leave, a day off.", obj({ from: str, to: str, kind: str }, ["from", "to", "kind"])),
  t("leave_cancel", "Cancel a leave request the person made.", obj({ request: str }, ["request"])),
  t("availability_mark_unavailable", "Mark days the person is unavailable for work without taking leave.", obj({ days: str }, ["days"])),
  t("my_note_add", "Keep a private note in the person's own notebook. Only they see it. Not for job notes.", obj({ note: str }, ["note"])),
  t("vehicle_log_fuel", "Log a fuel fill or a service on the person's work vehicle: litres, cost, odometer.", obj({ vehicle: str, entry: str }, ["vehicle", "entry"])),
  t("timesheet_submit_week", "Submit the person's timesheet for a week to their approver.", obj({ week: str }, ["week"])),
  // Approvals
  t("timesheet_approve", "Approve someone's submitted timesheet. Never your own.", obj({ person: str, week: str }, ["person", "week"])),
  t("leave_approve", "Approve someone's leave request. Never your own.", obj({ person: str, request: str }, ["person", "request"])),
  t("leave_decline", "Decline someone's leave request, with a reason.", obj({ person: str, request: str, reason: str }, ["person", "request", "reason"])),
  t("expense_approve", "Approve someone's expense claim. Never your own.", obj({ person: str, claim: str }, ["person", "claim"])),
  // Team
  t("staff_invite", "Invite a new person to join the workspace by email.", obj({ email: str, role: str }, ["email", "role"])),
  t("notice_post", "Post an announcement on the team noticeboard.", obj({ title: str, body: str }, ["title", "body"])),
];

/** One phrase per tool, said the way people say it, and the tool it wants. */
export const DRAFT_PHRASES: readonly { say: string; want: string }[] = [
  { say: "I finished the grille order, tick that off my list", want: "task_complete" },
  { say: "Actually the quote for Harbour Rd isn't done, put it back on my list", want: "task_reopen" },
  { say: "Make my ladder inspection task due next Thursday instead", want: "task_set_due" },
  { say: "Hand the filter order task over to Sam", want: "task_give" },
  { say: "Snooze my reminder about the crane until 3pm", want: "reminder_snooze" },
  { say: "The compressor fault at Bayview is sorted now, mark it fixed", want: "issue_resolve" },
  { say: "That tripping fault at Bayview is back again, reopen it", want: "issue_reopen" },
  { say: "Take the warning flag off the Harbour Rd job, we've dealt with it", want: "flag_clear" },
  { say: "Put the flag back on Harbour Rd, I cleared it too early", want: "flag_restore" },
  { say: "Put a toolbox talk on the calendar for Thursday at 7", want: "calendar_add_event" },
  { say: "Move Friday's training day to 9am", want: "calendar_edit_event" },
  { say: "Add a note to the toolbox talk: bring the new SWMS", want: "calendar_note_on_event" },
  { say: "The filter clean is done on the Bayview visit", want: "visit_checklist_tick" },
  { say: "Add a coil wash to the checklist for the Bayview visit", want: "visit_checklist_add" },
  { say: "Take the drain test off the Bayview checklist", want: "visit_checklist_remove" },
  { say: "We need to take two 20x20 filters to the Bayview visit", want: "visit_bring_add" },
  { say: "The filters for Bayview are packed", want: "visit_bring_packed" },
  { say: "The Bayview visit is ready to go, parts are in", want: "visit_set_readiness" },
  { say: "Move the Bayview service to Friday", want: "visit_place" },
  { say: "Give the Bayview service to Alex", want: "visit_assign_tech" },
  { say: "Put the Bayview visit on hold", want: "visit_set_status" },
  { say: "The Bayview service is finished", want: "visit_complete" },
  { say: "Bayview's visit has been invoiced", want: "visit_set_invoiced" },
  { say: "Move the Harbour Rd project to commissioning", want: "project_set_stage" },
  { say: "Harbour Rd is blocked, we're waiting on the builder", want: "project_set_blocked" },
  { say: "Add a claim of $12,400 for rough-in on Harbour Rd", want: "project_add_claim" },
  { say: "Send that note on job 4127 across to ServiceM8", want: "job_note_send_to_servicem8" },
  { say: "Email the SWMS and the commissioning sheet for job 4127 to the customer", want: "job_email_documents" },
  { say: "Book me off Friday week, annual leave", want: "leave_request" },
  { say: "Cancel my leave for next Monday", want: "leave_cancel" },
  { say: "I can't work Saturday or Sunday this weekend, mark me unavailable", want: "availability_mark_unavailable" },
  { say: "Keep a note for me: ask about the new van lease", want: "my_note_add" },
  { say: "Log 60 litres of diesel on the Hilux, 142,300 km", want: "vehicle_log_fuel" },
  { say: "Submit my timesheet for last week", want: "timesheet_submit_week" },
  { say: "Approve Alex's timesheet for last week", want: "timesheet_approve" },
  { say: "Approve Sam's leave request for the 14th", want: "leave_approve" },
  { say: "Decline Priya's leave for the 3rd, we're short that week", want: "leave_decline" },
  { say: "Approve Alex's fuel expense claim", want: "expense_approve" },
  { say: "Invite priya@example.com to join as staff", want: "staff_invite" },
  { say: "Post on the noticeboard that the office is closed Monday", want: "notice_post" },
];
