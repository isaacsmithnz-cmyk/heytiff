/**
 * @jest-environment node
 */

/* Build the quote from the phone on a job still on the old engine: it moves over
   first, or the session refuses with "Tiff builds on the quote's lines" (Isaac's
   3479, 3 November 2026). An answer to a question moves nothing. */

jest.mock("server-only", () => ({}));
const calls: string[] = [];
let engine = "old";
jest.mock("@/lib/mobile/auth", () => ({
  requireMobile: async () => ({ orgId: "o", userId: "u" }),
  actAsPhoneUser: async (_c: unknown, fn: () => Promise<Response>) => fn(),
}));
jest.mock("@/lib/quotes/lines-server", () => ({ readEngine: async () => engine }));
jest.mock("@/app/api/workboard/quote-lines/route", () => ({
  GET: jest.fn(),
  POST: async (r: Request) => {
    const b = (await r.json()) as { op: string; engine: string };
    calls.push(`${b.op} ${b.engine}`);
    return Response.json({ ok: true });
  },
}));
jest.mock("@/app/api/workboard/quote-session/route", () => ({
  GET: jest.fn(),
  POST: async () => {
    calls.push("talk");
    return Response.json({ ok: true });
  },
}));
jest.mock("@/app/api/workboard/quote-price/route", () => ({ GET: jest.fn() }));
jest.mock("@/app/api/workboard/quote-lookup/route", () => ({ GET: jest.fn() }));
jest.mock("@/app/api/workboard/quote-send/route", () => ({ GET: jest.fn() }));
jest.mock("@/app/actions/quote-sm8", () => ({ quoteSendOffered: jest.fn(), sendQuoteToSm8: jest.fn() }));
jest.mock("@/lib/workboard/all-jobs-query", () => ({ resolveJobCard: jest.fn() }));
/* the read's look for ServiceM8's own quote: none on these jobs */
jest.mock("@/lib/supabase-server", () => {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null }) };
  return { supabaseAdmin: { from: () => q } };
});

import { POST } from "@/app/api/mobile/jobs/[id]/quote/talk/route";

const post = (body: unknown) =>
  POST(new Request("https://x/api", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "job" }) });

beforeEach(() => {
  calls.length = 0;
  engine = "old";
});

describe("Build the quote from the phone", () => {
  it("moves a quote on the old engine to lines before Tiff starts", async () => {
    await post({ message: "A multi for the loft" });
    expect(calls).toEqual(["switch lines", "talk"]);
  });
  it("leaves one already on lines alone", async () => {
    engine = "lines";
    await post({ message: "A multi for the loft" });
    expect(calls).toEqual(["talk"]);
  });
  it("moves nothing for an answer", async () => {
    await post({ op: "answer", event: 1, answer: 0 });
    expect(calls).toEqual(["talk"]);
  });
});
