import type { CreateNewJob } from "@/app/actions/job-new";

/* THE PHONE'S NEW JOB, AS THE WEB FORM HANDS IT IN (the phone's New › Job,
   Isaac, 20 November 2026: "Yes, build it" to
   https://claude.ai/artifact/JLF86oYMASuBt4gKDRr1VR). The phone's body is
   read into the web's own CreateNewJob, its shape only: what the words may
   be is the web's validNewJob's, inside createNewJob. Pure, so tested. */

const PRESS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID = PRESS_ID;

/** How the work came, as the web form's Came in by says it in the job's words. */
export const NEW_JOB_VIA = ["an existing customer", "phone", "email", "the website", "a referral"] as const;

const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** The body as the web's input, or why it can't be. */
export function newJobInputOf(body: unknown): { ok: true; input: CreateNewJob } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const pressId = typeof b.pressId === "string" && PRESS_ID.test(b.pressId) ? b.pressId : null;
  if (!pressId) return { ok: false, error: "Open New job again and try once more." };

  const c = (b.client && typeof b.client === "object" ? b.client : {}) as Record<string, unknown>;
  let client: CreateNewJob["client"];
  if (c.kind === "existing" && typeof c.uuid === "string" && UUID.test(c.uuid)) client = { kind: "existing", uuid: c.uuid };
  else if (c.kind === "site" && typeof c.parentUuid === "string" && UUID.test(c.parentUuid)) client = { kind: "site", parentUuid: c.parentUuid, address: text(c.address, 400) };
  else if (c.kind === "new" && text(c.name, 200).trim()) client = { kind: "new", name: text(c.name, 200), address: text(c.address, 400) };
  else return { ok: false, error: "Say who the customer is." };

  const k = (b.contact && typeof b.contact === "object" ? b.contact : null) as Record<string, unknown> | null;
  const contact = k ? { first: text(k.first, 100), last: text(k.last, 100), mobile: text(k.mobile, 40), phone: text(k.phone, 40), email: text(k.email, 200) } : null;
  const given = contact && Object.values(contact).some((v) => v.trim());

  const via = typeof b.via === "string" && (NEW_JOB_VIA as readonly string[]).includes(b.via) ? b.via : null;
  const categoryUuid = typeof b.categoryUuid === "string" && UUID.test(b.categoryUuid) ? b.categoryUuid : null;

  return {
    ok: true,
    input: {
      pressId,
      clientName: text(b.clientName, 200),
      client,
      jobAddress: text(b.jobAddress, 400),
      description: text(b.description, 4000),
      categoryUuid,
      contact: given ? contact : null,
      via,
      next: null,
    },
  };
}
