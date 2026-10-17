import { PUSH_PAUSE_MS, THREADS_ENDPOINT, pullThreads, pushThreads, resetThreadSync, threadsKept } from "../thread-sync";
import { STORE_KEY, SYNCED_KEY, saveThreads, sigsOf, type TiffThread } from "../threads";

/* The threads' server copy following the browser's. The server is a fetch
   stand-in that records what it is sent. Until the table is applied it
   answers 503, and then nothing may change at all. */

const t = (id: string, updatedAt: number, over: Partial<TiffThread> = {}): TiffThread => ({
  id,
  title: `Thread ${id}`,
  updatedAt,
  messages: [{ role: "user", text: `asked in ${id}`, at: updatedAt }],
  ...over,
});

type Sent = { method: string; body: { upsert: TiffThread[]; remove: string[] } | null };
let sent: Sent[] = [];
let server: { status: number; who?: string; threads?: TiffThread[] } = { status: 503 };

const fetchStub = jest.fn(async (url: string, init?: { method?: string; body?: string }) => {
  expect(url).toBe(THREADS_ENDPOINT);
  const method = init?.method ?? "GET";
  sent.push({ method, body: init?.body ? JSON.parse(init.body) : null });
  if (method === "GET") {
    return {
      ok: server.status === 200,
      status: server.status,
      json: async () => (server.status === 200 ? { ok: true, who: server.who, threads: server.threads ?? [] } : { ok: false }),
    };
  }
  return { ok: server.status === 200, status: server.status, json: async () => ({ ok: server.status === 200 }) };
});

const local = (): TiffThread[] => JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]");
/** Lets a send the timer started finish its round trip. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const posts = () => sent.filter((s) => s.method === "POST").map((s) => s.body);

beforeEach(() => {
  localStorage.clear();
  sent = [];
  server = { status: 503 };
  resetThreadSync();
  (globalThis as { fetch?: unknown }).fetch = fetchStub;
});

afterEach(() => {
  jest.useRealTimers();
});

it("leaves the threads on this device, untouched, while the table isn't there", async () => {
  saveThreads([t("a", 1)]);
  expect(await pullThreads()).toBeNull();
  expect(threadsKept()).toBe(false);
  expect(local().map((x) => x.id)).toEqual(["a"]);
  pushThreads();
  expect(posts()).toEqual([]);
});

it("imports this browser's threads on the first open, once, and brings the other devices' down", async () => {
  saveThreads([t("here", 2)]);
  server = { status: 200, who: "who-1", threads: [t("phone", 5)] };
  const merged = await pullThreads();
  expect(merged?.map((x) => x.id)).toEqual(["phone", "here"]);
  expect(local().map((x) => x.id)).toEqual(["phone", "here"]);
  expect(posts()).toEqual([{ upsert: [t("here", 2)], remove: [] }]);
  expect(threadsKept()).toBe(true);

  // the second open sends nothing: the server has it all now
  sent = [];
  server = { status: 200, who: "who-1", threads: [t("phone", 5), t("here", 2)] };
  await pullThreads();
  expect(posts()).toEqual([]);
});

it("sends a change up once the threads sit still, and a deletion with it", async () => {
  saveThreads([t("a", 1), t("b", 1)]);
  server = { status: 200, who: "who-1", threads: [t("a", 1), t("b", 1)] };
  await pullThreads();
  sent = [];

  jest.useFakeTimers();
  saveThreads([t("a", 7)]);
  pushThreads();
  pushThreads();
  expect(posts()).toEqual([]);
  await jest.advanceTimersByTimeAsync(PUSH_PAUSE_MS);
  await settle();
  expect(posts()).toEqual([{ upsert: [t("a", 7)], remove: ["b"] }]);
  expect(JSON.parse(localStorage.getItem(SYNCED_KEY) ?? "{}")).toEqual({ who: "who-1", sigs: sigsOf([t("a", 7)]) });
});

it("tries again with the next change when a send fails", async () => {
  saveThreads([t("a", 1)]);
  server = { status: 200, who: "who-1", threads: [t("a", 1)] };
  await pullThreads();

  jest.useFakeTimers();
  server = { status: 500 };
  saveThreads([t("a", 2)]);
  pushThreads();
  await jest.advanceTimersByTimeAsync(PUSH_PAUSE_MS);
  await settle();
  server = { status: 200 };
  sent = [];
  saveThreads([t("a", 3)]);
  pushThreads();
  await jest.advanceTimersByTimeAsync(PUSH_PAUSE_MS);
  await settle();
  expect(posts()).toEqual([{ upsert: [t("a", 3)], remove: [] }]);
});

it("shows another person's threads, not this browser's, on a shared browser", async () => {
  saveThreads([t("theirs", 1)]);
  localStorage.setItem(SYNCED_KEY, JSON.stringify({ who: "who-1", sigs: sigsOf([t("theirs", 1)]) }));
  server = { status: 200, who: "who-2", threads: [t("mine", 3)] };
  const merged = await pullThreads();
  expect(merged?.map((x) => x.id)).toEqual(["mine"]);
  expect(posts()).toEqual([]);
});
