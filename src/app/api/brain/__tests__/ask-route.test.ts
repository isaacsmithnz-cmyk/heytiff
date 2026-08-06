/**
 * @jest-environment node
 *
 * The brain's ask door. The loop is replaced at our OWN seam
 * (`lib/brain/ask`), never by mocking the SDK — the house rule, and the
 * reason that module is a generator. Under test here is the protocol: who
 * gets in, that the viewer's capabilities decide which tools the loop is
 * handed, and the order events come out in.
 */

const getSession = jest.fn();
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: () => getSession() } }));

let caps = new Set<string>();
jest.mock("@/lib/permissions-server", () => ({
  can: async (c: string) => caps.has(c),
}));

jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: async () => "Australia/Brisbane" }));
jest.mock("@/lib/workboard/dates", () => ({ todayInZone: () => "2026-08-06" }));

/* The client throws at import without env — stubbed so the REAL tools
   registry loads, because the capability-filtering tests below are about
   toolsFor's actual behaviour, not a copy of it. */
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));

type AskBrainEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; label: string }
  | { type: "error"; message: string }
  | { type: "done" };

let events: AskBrainEvent[] = [];
const streamBrainAnswer = jest.fn((input: unknown) => {
  void input;
  return (async function* () {
    for (const e of events) yield e;
  })();
});
jest.mock("@/lib/brain/ask", () => ({
  streamBrainAnswer: (input: unknown) => streamBrainAnswer(input),
}));

import { POST } from "../ask/route";

const req = (body: unknown) =>
  new Request("http://localhost/api/brain/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const eventsOf = async (res: Response): Promise<Record<string, unknown>[]> =>
  (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

const loopInput = () =>
  streamBrainAnswer.mock.calls[streamBrainAnswer.mock.calls.length - 1][0] as Record<
    string,
    unknown
  >;

beforeEach(() => {
  jest.clearAllMocks();
  caps = new Set(["workboard", "tiff"]);
  getSession.mockResolvedValue({ user: { sub: "auth0|me" }, orgId: "org-1" });
  events = [
    { type: "tool", name: "job_history", label: "Reading the job's history" },
    { type: "delta", text: "Two open tasks." },
    { type: "done" },
  ];
});

describe("the gate", () => {
  it("refuses the signed-out", async () => {
    getSession.mockResolvedValue(null);
    expect((await POST(req({ question: "what's open?" }))).status).toBe(401);
  });

  it("refuses a viewer with nothing to ask about — no caps, no tools, 403", async () => {
    caps = new Set();
    const res = await POST(req({ question: "what's open?" }));
    expect(res.status).toBe(403);
    expect(streamBrainAnswer).not.toHaveBeenCalled();
  });

  it("refuses an empty question before spending anything", async () => {
    expect((await POST(req({ question: "  " }))).status).toBe(400);
    expect(streamBrainAnswer).not.toHaveBeenCalled();
  });
});

describe("capability filtering — asking must not reach past the screens", () => {
  it("workboard-only viewers get no kb_search", async () => {
    caps = new Set(["workboard"]);
    await POST(req({ question: "what's open?" }));
    const names = (loopInput().tools as { name: string }[]).map((t) => t.name);
    expect(names).toContain("job_history");
    expect(names).not.toContain("kb_search");
  });

  it("tiff-only viewers get ONLY kb_search", async () => {
    caps = new Set(["tiff"]);
    await POST(req({ question: "how do I clear an E6?" }));
    const names = (loopInput().tools as { name: string }[]).map((t) => t.name);
    expect(names).toEqual(["kb_search"]);
  });
});

describe("the wire", () => {
  it("streams tool, delta, done — in the order the loop said them", async () => {
    const res = await POST(req({ question: "what's open at Meridian?" }));
    expect(await eventsOf(res)).toEqual([
      { t: "tool", name: "job_history", label: "Reading the job's history" },
      { t: "delta", text: "Two open tasks." },
      { t: "done" },
    ]);
  });

  it("hands the loop the org's own today and the scope's target", async () => {
    await POST(
      req({
        question: "what's left here?",
        target: { kind: "visit", id: "v-1" },
        targetLabel: "Meridian Data · CRACs",
      })
    );
    expect(loopInput()).toMatchObject({
      orgId: "org-1",
      todayISO: "2026-08-06",
      targetLabel: "Meridian Data · CRACs",
      targetRef: { kind: "visit", id: "v-1" },
    });
  });

  it("a junk target is dropped rather than trusted", async () => {
    await POST(req({ question: "hi?", target: { kind: "drop table", id: 5 } }));
    expect(loopInput().targetRef).toBeUndefined();
  });

  it("an error from the loop reaches the wire as err, then the stream ends", async () => {
    events = [{ type: "error", message: "Too busy right now — try again in a minute." }];
    const res = await POST(req({ question: "what's open?" }));
    expect(await eventsOf(res)).toEqual([
      { t: "err", message: "Too busy right now — try again in a minute." },
    ]);
  });
});
