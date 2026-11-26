/**
 * @jest-environment node
 */

/* Her voice's front door: the dictation gate, words cleaned before they
   cost anything, her voice streamed through, and the device's voice named
   (with the words to say) whenever hers can't be had. */

let session: { orgId?: string } | null = { orgId: "org1" };
let allowed = true;
const said: string[] = [];
let result: unknown = { ok: false, fallback: true };

jest.mock("@/lib/auth0", () => ({ auth0: { getSession: async () => session } }));
jest.mock("@/lib/voice/can-dictate", () => ({ canDictate: async () => allowed }));
jest.mock("@/lib/voice/speak", () => ({
  ...jest.requireActual("@/lib/voice/speak"),
  synthesize: async (text: string) => (said.push(text), result),
}));

import { POST } from "../speak/route";

const ask = (body: unknown) =>
  POST(new Request("http://x.test/api/tiff/speak", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

beforeEach(() => {
  session = { orgId: "org1" };
  allowed = true;
  said.length = 0;
  result = { ok: false, fallback: true };
});

it("is shut to the signed out and to those without a microphone", async () => {
  session = null;
  expect((await ask({ text: "Hi." })).status).toBe(401);
  session = { orgId: "org1" };
  allowed = false;
  expect((await ask({ text: "Hi." })).status).toBe(403);
  expect(said).toEqual([]);
});

it("spends nothing on nothing to say", async () => {
  expect((await ask({ text: "---\n```\ncode\n```" })).status).toBe(400);
  expect((await ask({})).status).toBe(400);
  expect(said).toEqual([]);
});

it("hands back the words to say in the device's voice when hers can't be had", async () => {
  const res = await ask({ text: "**Sam** is free." });
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ fallback: true, say: "Sam is free." });
  expect(said).toEqual(["Sam is free."]);
});

it("streams her voice through", async () => {
  result = { ok: true, audio: new Response("mp3bytes").body, contentType: "audio/mpeg" };
  const res = await ask({ text: "Sam is free." });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("audio/mpeg");
  expect(await res.text()).toBe("mp3bytes");
});

it("a failure worth retrying still carries the words", async () => {
  result = { ok: false, fallback: false };
  const res = await ask({ text: "Sam is free." });
  expect(res.status).toBe(502);
  expect((await res.json()).say).toBe("Sam is free.");
});
