import {
  THREAD_BYTES_MAX,
  mergeThreads,
  pendingChanges,
  sigsOf,
  threadIdOf,
  threadOf,
  threadSig,
  type TiffThread,
} from "../threads";

/* Tiff's threads, the shape both copies share and how they agree
   (docs/migrations/tiff_threads.sql, NOT YET APPLIED). The merge is the part
   that loses a conversation if it is wrong, so each of its cases is here. */

const t = (id: string, updatedAt: number, over: Partial<TiffThread> = {}): TiffThread => ({
  id,
  title: `Thread ${id}`,
  updatedAt,
  messages: [{ role: "user", text: `asked in ${id}`, at: updatedAt }],
  ...over,
});

describe("a thread as a browser sends it", () => {
  it("takes a well-formed thread and keeps what each message carries", () => {
    const thread = t("t-1", 10, {
      messages: [
        { role: "user", text: "why P8?", at: 9 },
        { role: "tiff", text: "Piping temperature.", at: 10, researched: true, steps: ["Searched your library: 2 matching passages"] },
      ],
    });
    expect(threadOf(thread)).toEqual(thread);
  });

  it("refuses what isn't one: a bad id, no title, a message with no role, an unknown field's junk dropped", () => {
    expect(threadOf(t("has space", 1))).toBeNull();
    expect(threadOf(t("x".repeat(81), 1))).toBeNull();
    expect(threadOf({ ...t("t-1", 1), title: "  " })).toBeNull();
    expect(threadOf({ ...t("t-1", 1), messages: [{ text: "no role", at: 1 }] })).toBeNull();
    expect(threadOf({ ...t("t-1", 1), updatedAt: "yesterday" })).toBeNull();
    expect(threadOf({ ...t("t-1", 1), messages: [{ role: "user", text: "hi", at: 1, html: "<b>" }] })?.messages[0]).toEqual({ role: "user", text: "hi", at: 1 });
    expect(threadOf(null)).toBeNull();
  });

  it("refuses a thread too big to keep", () => {
    expect(threadOf(t("t-1", 1, { messages: [{ role: "tiff", text: "x".repeat(THREAD_BYTES_MAX), at: 1 }] }))).toBeNull();
  });

  it("checks an id on its own, for a removal", () => {
    expect(threadIdOf("t-lq3-abc")).toBe("t-lq3-abc");
    expect(threadIdOf("../x")).toBeNull();
    expect(threadIdOf(4)).toBeNull();
  });
});

describe("the browser's copy and the server's, merged", () => {
  it("sends everything up on the first open after the cutover, once", () => {
    const local = [t("a", 2), t("b", 1)];
    const { threads, upload } = mergeThreads(local, [], null, "who-1");
    expect(threads.map((x) => x.id)).toEqual(["a", "b"]);
    expect(upload.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("brings down what another device wrote", () => {
    const { threads, upload } = mergeThreads([t("a", 2)], [t("a", 2), t("phone", 5)], { who: "who-1", sigs: sigsOf([t("a", 2)]) }, "who-1");
    expect(threads.map((x) => x.id)).toEqual(["phone", "a"]);
    expect(upload).toEqual([]);
  });

  it("keeps whichever copy moved last", () => {
    const mark = { who: "who-1", sigs: sigsOf([t("a", 1)]) };
    const newerHere = mergeThreads([t("a", 9)], [t("a", 1)], mark, "who-1");
    expect(newerHere.threads[0].updatedAt).toBe(9);
    expect(newerHere.upload.map((x) => x.id)).toEqual(["a"]);
    const newerThere = mergeThreads([t("a", 1)], [t("a", 9)], mark, "who-1");
    expect(newerThere.threads[0].updatedAt).toBe(9);
    expect(newerThere.upload).toEqual([]);
  });

  it("keeps a rename made here, which doesn't move a thread", () => {
    const sent = t("a", 3);
    const renamed = { ...sent, title: "Riverview brief" };
    const { threads, upload } = mergeThreads([renamed], [sent], { who: "who-1", sigs: sigsOf([sent]) }, "who-1");
    expect(threads[0].title).toBe("Riverview brief");
    expect(upload).toEqual([renamed]);
  });

  it("lets a thread deleted on another device go here too, and sends up one that is only new here", () => {
    const mark = { who: "who-1", sigs: sigsOf([t("gone", 1)]) };
    const { threads, upload } = mergeThreads([t("gone", 1), t("new", 2)], [], mark, "who-1");
    expect(threads.map((x) => x.id)).toEqual(["new"]);
    expect(upload.map((x) => x.id)).toEqual(["new"]);
  });

  it("never sends one person's threads up under another's name", () => {
    const mark = { who: "who-1", sigs: sigsOf([t("theirs", 1)]) };
    const { threads, upload } = mergeThreads([t("theirs", 1)], [t("mine", 4)], mark, "who-2");
    expect(threads.map((x) => x.id)).toEqual(["mine"]);
    expect(upload).toEqual([]);
  });
});

describe("what changed since the server was last sent it", () => {
  it("names the threads that moved or were renamed, and the ones deleted here", () => {
    const sent = [t("a", 1), t("b", 1), t("c", 1)];
    const mark = { who: "w", sigs: sigsOf(sent) };
    const now = [t("a", 1), { ...t("b", 1), title: "Renamed" }, t("d", 2)];
    const { upsert, remove } = pendingChanges(now, mark);
    expect(upsert.map((x) => x.id)).toEqual(["b", "d"]);
    expect(remove).toEqual(["c"]);
  });

  it("tells a thread that grew from one that didn't", () => {
    const a = t("a", 1);
    expect(threadSig(a)).toBe(threadSig({ ...a }));
    expect(threadSig(a)).not.toBe(threadSig({ ...a, messages: [...a.messages, { role: "tiff", text: "yes", at: 1 }] }));
  });
});
