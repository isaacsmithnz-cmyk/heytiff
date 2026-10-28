/**
 * @jest-environment node
 */
/* Where Resend posts an email sent to Tiff: only a signed post, for an address
   that finds a business, is taken; twice is once; the rest waits behind the
   answer. */
import { createHmac } from "node:crypto";

const afterQueue: (() => Promise<void>)[] = [];
jest.mock("next/server", () => ({ after: (fn: () => Promise<void>) => afterQueue.push(fn) }));
const orgForToken = jest.fn();
const noteEmailIn = jest.fn();
const takeEmailIn = jest.fn();
jest.mock("@/lib/email/inbound-server", () => ({ orgForToken: (...a: unknown[]) => orgForToken(...a), noteEmailIn: (...a: unknown[]) => noteEmailIn(...a), takeEmailIn: (...a: unknown[]) => takeEmailIn(...a) }));

const readEmailIntoJob = jest.fn();
jest.mock("@/lib/email/proposal-server", () => ({ readEmailIntoJob: (...a: unknown[]) => readEmailIntoJob(...a) }));

import { POST } from "../route";

const key = Buffer.from("route-test-key");
const post = (data: unknown, opts: { sign?: boolean; type?: string } = {}) => {
  const body = JSON.stringify({ type: opts.type ?? "email.received", data });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = `v1,${createHmac("sha256", key).update(`msg_1.${ts}.${body}`).digest("base64")}`;
  const headers = new Headers(opts.sign === false ? {} : { "svix-id": "msg_1", "svix-timestamp": ts, "svix-signature": sig });
  return new Request("https://go.hey-tiff.com/api/email/in", { method: "POST", body, headers }) as never;
};
const email = { email_id: "e1", from: "Isaac <isaac@diamondair.com.au>", subject: "Fw: Tender", to: ["tiff-k7m2q9xwab@in.hey-tiff.com"] };

beforeEach(() => {
  process.env.RESEND_INBOUND_SECRET = `whsec_${key.toString("base64")}`;
  afterQueue.length = 0;
  for (const f of [orgForToken, noteEmailIn, takeEmailIn, readEmailIntoJob]) f.mockReset();
  readEmailIntoJob.mockResolvedValue("read");
  orgForToken.mockResolvedValue("org-1");
  noteEmailIn.mockResolvedValue({ id: "row-1" });
  takeEmailIn.mockResolvedValue("received");
});

it("takes a signed email for a business's address, and fetches it behind the answer", async () => {
  const res = await POST(post(email));
  expect(res.status).toBe(200);
  expect(orgForToken).toHaveBeenCalledWith("k7m2q9xwab");
  expect(noteEmailIn).toHaveBeenCalledWith("org-1", "e1", "Isaac <isaac@diamondair.com.au>", "Fw: Tender");
  expect(takeEmailIn).not.toHaveBeenCalled();
  await afterQueue[0]!();
  expect(takeEmailIn).toHaveBeenCalledWith("row-1", "org-1", "e1");
  /* taken from the team, Tiff reads it into a job */
  expect(readEmailIntoJob).toHaveBeenCalledWith("row-1");
});

it("doesn't read an email it refused", async () => {
  takeEmailIn.mockResolvedValue("refused");
  await POST(post(email));
  await afterQueue[0]!();
  expect(readEmailIntoJob).not.toHaveBeenCalled();
});

it("refuses a post Resend didn't sign, and reads nothing", async () => {
  expect((await POST(post(email, { sign: false }))).status).toBe(401);
  expect(orgForToken).not.toHaveBeenCalled();
});

it("drops an address that finds no one, and a second delivery, without fetching", async () => {
  orgForToken.mockResolvedValueOnce(null);
  expect((await POST(post(email))).status).toBe(200);
  noteEmailIn.mockResolvedValueOnce("again");
  expect((await POST(post(email))).status).toBe(200);
  expect(afterQueue).toHaveLength(0);
});

it("takes nothing with no secret set", async () => {
  delete process.env.RESEND_INBOUND_SECRET;
  expect((await POST(post(email))).status).toBe(404);
});
