/* THE CUSTOMER'S MESSAGES ON ONE JOB, READ (Isaac, 26 October 2026): the
   job's own, names from its contacts and the team, and ServiceM8's own sends
   told by how many of the business's jobs their opening went out on. */

type Call = { table: string; eq: Record<string, unknown>; neq?: [string, unknown]; ilike?: [string, string]; in?: [string, unknown[]] };
const calls: Call[] = [];
let jobRows: Record<string, unknown>[] = [];
/** how many OTHER jobs each opening pattern went out on */
let others: Record<string, number> = {};

const table = (name: string) => {
  const call: Call = { table: name, eq: {} };
  calls.push(call);
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "order", "limit"]) chain[k] = () => chain;
  chain.eq = (c: string, v: unknown) => ((call.eq[c] = v), chain);
  chain.neq = (c: string, v: unknown) => ((call.neq = [c, v]), chain);
  chain.ilike = (c: string, p: string) => ((call.ilike = [c, p]), chain);
  chain.in = (c: string, v: unknown[]) => ((call.in = [c, v]), chain);
  chain.then = (res: (v: { data: unknown; error: unknown }) => unknown) => {
    let data: unknown = [];
    if (name === "sm8_job_messages" && call.ilike) {
      data = Array.from({ length: others[call.ilike[1]] ?? 0 }, (_, i) => ({ related_object_uuid: `job-${i}` }));
    } else if (name === "sm8_job_messages") data = jobRows;
    else if (name === "sm8_job_contacts") data = [{ first: "Marco", last: "Rossi", mobile: "0400 000 001", phone: null, email: "marco@example.com" }];
    else if (name === "sm8_staff") data = [{ uuid: "s-dana", first: "Dana", last: "Lee" }];
    return Promise.resolve({ data, error: null }).then(res);
  };
  return chain;
};
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (n: string) => table(n) } }));

import { readCustomerMessages } from "../customer-messages-query";
import type { CustomerSend, CustomerThread, ThreadBubble } from "../customer-messages";

const FOLLOW_UP = "Hi Marco!\n\nI hope you've been well.\n\nI just wanted to follow up on the quote we sent through last week.";
const FOLLOW_UP_PATTERN = "%I%hope%you%ve%been%well%I%just%wanted%to%";

beforeEach(() => {
  calls.length = 0;
  others = {};
  jobRows = [
    { uuid: "e1", kind: "email", direction: "outbound", raw: { timestamp: "2026-10-06 09:31:18", subject: "Your Quote (Ref #3372)", message_text: FOLLOW_UP, from_email: "messaging-service@post.servicem8.com", to_email: '["marco@example.com"]', sent_by_staff_uuid: "S-DANA", first_opened_at: "2026-10-06 09:56:11", opened: "true", attachment_uuids: "[]" } },
    { uuid: "e2", kind: "email", direction: "inbound", raw: { timestamp: "2026-10-06 10:03:39", subject: "Re: Your Quote (Ref #3372)", message_text: "", message_html: "<p>Hi Dana,</p><p>Hope you had a good break.</p>", from_email: "Marco@Example.com" } },
    { uuid: "t1", kind: "sms", direction: "inbound", raw: { timestamp: "2026-10-06 11:40:19", message: "Running late, see you at 2", from_phone: "+61400000001" } },
  ];
});

it("reads the job's own messages, newest 200, inside the organisation", async () => {
  await readCustomerMessages({ orgId: "org-1", jobUuid: "job-1", money: true });
  const read = calls.find((c) => c.table === "sm8_job_messages" && !c.ilike)!;
  expect(read.eq).toEqual({ org_id: "org-1", related_object_uuid: "job-1" });
});

it("names the customer from the job's contacts, by number or address, and the team from ServiceM8's staff", async () => {
  const items = await readCustomerMessages({ orgId: "org-1", jobUuid: "job-1", money: true });
  const thread = items.find((i): i is CustomerThread => i.kind === "thread")!;
  expect(thread.title).toBe("Email and text with Marco");
  const bubbles = thread.lines.filter((l): l is ThreadBubble => l.kind === "bubble");
  expect(bubbles.map((b) => b.name)).toEqual(["Dana", "Marco", null]);
});

it("takes the HTML only where there is no text, and as text", async () => {
  const items = await readCustomerMessages({ orgId: "org-1", jobUuid: "job-1", money: true });
  const thread = items.find((i): i is CustomerThread => i.kind === "thread")!;
  const theirs = thread.lines.find((l): l is ThreadBubble => l.kind === "bubble" && l.side === "them")!;
  expect(theirs.words).toBe("Hi Dana,\nHope you had a good break.");
  expect(theirs.words).not.toMatch(/</);
});

it("makes a send ServiceM8's own once its opening went out on five of the business's jobs, and not on four", async () => {
  /* nobody answered it here, so as a template it is a row */
  jobRows = jobRows.filter((r) => r.uuid !== "e2");
  others = { [FOLLOW_UP_PATTERN]: 3 };
  let items = await readCustomerMessages({ orgId: "org-1", jobUuid: "job-1", money: true });
  expect(items.some((i) => i.kind === "send")).toBe(false);
  const ask = calls.find((c) => c.ilike)!;
  expect(ask).toMatchObject({ eq: { org_id: "org-1", kind: "email", direction: "outbound" }, neq: ["related_object_uuid", "job-1"], ilike: ["raw->>message_text", FOLLOW_UP_PATTERN] });

  others = { [FOLLOW_UP_PATTERN]: 4 };
  items = await readCustomerMessages({ orgId: "org-1", jobUuid: "job-1", money: true });
  const send = items.find((i): i is CustomerSend => i.kind === "send")!;
  expect(send).toMatchObject({ words: "Emailed", seen: "Seen 9:56 am" });
});

it("never asks about the customer's own messages", async () => {
  await readCustomerMessages({ orgId: "org-1", jobUuid: "job-1", money: true });
  expect(calls.filter((c) => c.ilike)).toHaveLength(1);
});
