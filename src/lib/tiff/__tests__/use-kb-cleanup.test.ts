import { act, renderHook } from "@testing-library/react";
import { useKbBackfill } from "../use-kb-backfill";
import { useKbIngest } from "../use-kb-ingest";
import { useKbOcr } from "../use-kb-ocr";

/* The Library's three hooks, mounted, and what each does when its work ends.

   Each holds a busy flag while a run is out, and a press while it is held does
   nothing. So the flag has to drop however the run ends, or the button never
   works again; and the server's numbers on the page are refreshed only when
   somebody is still there to read them. The loops underneath are pinned in
   use-kb-backfill.test.ts and use-kb-ingest.test.ts. This is the part only a
   mounted hook shows. */

const mockRouter = { refresh: jest.fn() };
jest.mock("next/navigation", () => ({ useRouter: () => mockRouter }));

type Call = { url: string; documentId?: string; reply: (body: unknown, ok?: boolean) => void };

/** fetch, answered by hand: every request waits until the test replies, and
    one the page aborts fails the way a real one does. */
function wire() {
  const calls: Call[] = [];
  let inFlight = 0;
  let most = 0;
  global.fetch = jest.fn(
    (url: string, init: RequestInit) =>
      new Promise((resolve, reject) => {
        most = Math.max(most, ++inFlight);
        init.signal?.addEventListener("abort", () => {
          inFlight--;
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
        calls.push({
          url,
          documentId: init.body ? (JSON.parse(String(init.body)) as { documentId: string }).documentId : undefined,
          reply: (body, ok = true) => {
            inFlight--;
            resolve({ ok, json: async () => body });
          },
        });
      })
  ) as unknown as typeof fetch;
  return { calls, most: () => most };
}

let net: ReturnType<typeof wire>;
const original = global.fetch;

beforeEach(() => {
  net = wire();
  mockRouter.refresh.mockClear();
});
afterAll(() => {
  global.fetch = original;
});

/** Everything the reply sets moving runs to where it waits again. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

async function reply(n: number, body: unknown, ok = true) {
  net.calls[n].reply(body, ok);
  await settle();
}

describe("useKbOcr", () => {
  it("lets go of the document once its run lands, and then reads the next", async () => {
    const { result } = renderHook(() => useKbOcr());

    act(() => result.current.read("d-1"));
    act(() => result.current.read("d-2"));
    expect(result.current.running).toBe("d-1");
    expect(net.calls).toHaveLength(1);

    await reply(0, { status: "ready", pagesRead: 12, scannedLeft: 0 });
    expect(result.current.running).toBeNull();
    expect(result.current.progress["d-1"]).toMatchObject({ status: "ready", pagesRead: 12 });
    expect(mockRouter.refresh).toHaveBeenCalledTimes(1);

    act(() => result.current.read("d-2"));
    expect(result.current.running).toBe("d-2");
    expect(net.calls).toHaveLength(2);
  });

  it("lets go after a run that failed too, and leaves the page alone", async () => {
    const { result } = renderHook(() => useKbOcr());

    act(() => result.current.read("d-1"));
    await reply(0, { error: "Out of pages." }, false);

    expect(result.current.running).toBeNull();
    expect(result.current.progress["d-1"]).toMatchObject({ status: "failed", error: "Out of pages." });
    expect(mockRouter.refresh).not.toHaveBeenCalled();

    act(() => result.current.read("d-1"));
    expect(net.calls).toHaveLength(2);
  });
});

describe("useKbBackfill", () => {
  it("lets go once nothing is left, refreshes the server's count, and runs again on the next press", async () => {
    const { result } = renderHook(() => useKbBackfill(64));

    act(() => result.current.start());
    act(() => result.current.start());
    expect(result.current.running).toBe(true);
    expect(net.calls).toHaveLength(1);

    await reply(0, { done: 64, remaining: 0 });
    expect(result.current).toMatchObject({ running: false, done: 64, remaining: 0, stopped: null });
    expect(mockRouter.refresh).toHaveBeenCalledTimes(1);

    act(() => result.current.start());
    expect(result.current.running).toBe(true);
    expect(net.calls).toHaveLength(2);
  });

  it("lets go of a run the server stopped, and still refreshes", async () => {
    const { result } = renderHook(() => useKbBackfill(106));

    act(() => result.current.start());
    await reply(0, { done: 0, remaining: 106, stopped: "rate-limited" });

    expect(result.current).toMatchObject({ running: false, remaining: 106, stopped: "rate-limited" });
    expect(mockRouter.refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes nothing once the page has gone", async () => {
    const { result, unmount } = renderHook(() => useKbBackfill(64));

    act(() => result.current.start());
    unmount();
    await settle();

    expect(net.calls).toHaveLength(1);
    expect(mockRouter.refresh).not.toHaveBeenCalled();
  });
});

describe("useKbIngest", () => {
  const ready = { status: "ready", pagesDone: 10, pageCount: 10, chunkCount: 14 };

  it("drives one document at a time, lets go when the queue is empty, and drives again on the next start", async () => {
    const { result } = renderHook(() => useKbIngest());

    act(() => result.current.start(["a", "b"]));
    // mid-run, a seen id is ignored and a new one joins the same line
    act(() => result.current.start(["a", "c"]));
    expect(result.current.busy).toBe(true);

    await reply(0, ready);
    await reply(1, ready);
    await reply(2, ready);

    expect(net.calls.map((c) => c.documentId)).toEqual(["a", "b", "c"]);
    expect(net.most()).toBe(1);
    expect(result.current.busy).toBe(false);
    expect(mockRouter.refresh).toHaveBeenCalledTimes(3);

    act(() => result.current.start(["d"]));
    expect(result.current.busy).toBe(true);
    expect(net.calls.map((c) => c.documentId)).toEqual(["a", "b", "c", "d"]);
  });

  it("adopts what the server says is still mid-flight", async () => {
    const { result } = renderHook(() => useKbIngest(["left-open"]));

    expect(net.calls.map((c) => c.documentId)).toEqual(["left-open"]);
    await reply(0, ready);

    expect(result.current.busy).toBe(false);
    expect(result.current.progress["left-open"]).toMatchObject({ status: "ready" });
  });

  it("abandons the queue and refreshes nothing once the page has gone", async () => {
    const { result, unmount } = renderHook(() => useKbIngest());

    act(() => result.current.start(["a", "b"]));
    unmount();
    await settle();

    expect(net.calls.map((c) => c.documentId)).toEqual(["a"]);
    expect(mockRouter.refresh).not.toHaveBeenCalled();
  });
});
