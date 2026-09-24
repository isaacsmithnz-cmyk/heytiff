import {
  ATTENTION_SHOWN,
  attentionCountLabel,
  buildJobAttention,
  type AttentionInputs,
} from "@/lib/workboard/job-attention";

const inputs = (over: Partial<AttentionInputs> = {}): AttentionInputs => ({
  flags: [],
  tasks: [],
  notes: [],
  jobOpen: true,
  answered: new Set<string>(),
  people: new Map([["lukeingold", { name: "Luke Ingold", staffId: null }]]),
  today: "2026-08-28",
  ...over,
});

const note = (over: Partial<AttentionInputs["notes"][number]> = {}) => ({
  remoteId: "n-1",
  text: "@lukeingold still need another day on site",
  author: "David Hann",
  at: "2026-08-20 09:14:00",
  actionRequired: false,
  handles: ["lukeingold"],
  ours: false,
  ...over,
});

describe("buildJobAttention", () => {
  it("is empty on a quiet job — the strip draws nothing at all", () => {
    expect(buildJobAttention(inputs())).toEqual({ items: [], total: 0 });
  });

  it("puts an urgent flag above everything else", () => {
    const built = buildJobAttention(
      inputs({
        flags: [
          { id: "f-1", message: "Timber needs replacing", severity: "urgent", raised: "2026-08-12" },
        ],
        tasks: [{ id: "t-1", title: "Order controllers", assignee: "Luke", dueDate: null }],
        notes: [note({ actionRequired: true })],
      })
    );
    expect(built.items[0]).toMatchObject({ kind: "flag", id: "f-1" });
    expect(built.total).toBe(3);
  });

  it("puts an overdue task above ServiceM8's bookmark, and a plain one below it", () => {
    const built = buildJobAttention(
      inputs({
        tasks: [
          { id: "late", title: "Pressure test", assignee: "Jake", dueDate: "2026-08-20" },
          { id: "soon", title: "Handover", assignee: "Jake", dueDate: "2026-09-04" },
        ],
        notes: [note({ actionRequired: true })],
      })
    );
    expect(built.items.map((i) => i.key)).toEqual(["task:late", "sm8flag:n-1", "task:soon"]);
    expect(built.items[0]).toMatchObject({ overdue: true });
    expect(built.items[2]).toMatchObject({ overdue: false });
  });

  it("compares due dates as ISO days, never as instants", () => {
    /* Both sides are days in the ACCOUNT's zone; parsing them into Date
       objects is how a job in Perth reads as overdue in Sydney. */
    const built = buildJobAttention(
      inputs({
        today: "2026-08-28",
        tasks: [{ id: "t", title: "Today's", assignee: null, dueDate: "2026-08-28" }],
      })
    );
    expect(built.items[0]).toMatchObject({ kind: "task", overdue: false });
  });

  it("caps what it shows but says how many there are", () => {
    const built = buildJobAttention(
      inputs({
        flags: [1, 2, 3, 4, 5].map((n) => ({
          id: `f-${n}`,
          message: `Flag ${n}`,
          severity: "warn" as const,
          raised: "2026-08-12",
        })),
      })
    );
    expect(built.items).toHaveLength(ATTENTION_SHOWN);
    expect(built.total).toBe(5);
  });

  describe("ServiceM8's own signals", () => {
    it("go silent the moment the job closes", () => {
      const open = buildJobAttention(inputs({ notes: [note({ actionRequired: true })] }));
      const closed = buildJobAttention(
        inputs({ notes: [note({ actionRequired: true })], jobOpen: false })
      );
      expect(open.total).toBe(1);
      /* 41 of the 49 flagged jobs live are already Completed — a red banner
         on four cards in five is why this rule exists. */
      expect(closed).toEqual({ items: [], total: 0 });
    });

    it("go silent for good once somebody has answered them", () => {
      const built = buildJobAttention(
        inputs({ notes: [note()], answered: new Set(["n-1"]) })
      );
      expect(built).toEqual({ items: [], total: 0 });
    });

    it("suggest a mention as ONE row, never two, when the note is also flagged", () => {
      const built = buildJobAttention(inputs({ notes: [note({ actionRequired: true })] }));
      expect(built.items).toHaveLength(1);
      expect(built.items[0].kind).toBe("sm8flag");
    });

    it("names the mentioned person, and says when they are not linked", () => {
      const built = buildJobAttention(inputs({ notes: [note()] }));
      expect(built.items[0]).toMatchObject({
        kind: "mention",
        named: [{ name: "Luke Ingold", staffId: null }],
      });
    });

    it("carries the staff id where integration_links actually links one", () => {
      const built = buildJobAttention(
        inputs({
          notes: [note()],
          people: new Map([["lukeingold", { name: "Luke Ingold", staffId: "staff-9" }]]),
        })
      );
      expect(built.items[0]).toMatchObject({ named: [{ staffId: "staff-9" }] });
    });

    it("never offer HeyTiff's own note back as a mention or a flag", () => {
      /* A reply HeyTiff posts to ServiceM8 comes back with the next sync as
         one of ServiceM8's notes. Offered as a suggestion, it would ask Luke
         to answer his own words; HeyTiff's own row is where it lives. */
      const built = buildJobAttention(
        inputs({ notes: [note({ ours: true }), note({ remoteId: "n-2", ours: true, actionRequired: true })] })
      );
      expect(built).toEqual({ items: [], total: 0 });
    });

    it("still names Luke from the same words when the note isn't ours, and reads the handles unchanged", () => {
      const mine = note({ ours: true });
      const theirs = note({ ours: false });
      expect(buildJobAttention(inputs({ notes: [theirs] })).items[0]).toMatchObject({
        kind: "mention",
        named: [{ name: "Luke Ingold" }],
      });
      expect(mine.handles).toEqual(theirs.handles);
    });

    it("stays quiet about a handle the roster doesn't know", () => {
      /* Naming somebody we cannot identify is worse than saying nothing. */
      const built = buildJobAttention(
        inputs({ notes: [note({ handles: ["someoneelse"] })] })
      );
      expect(built).toEqual({ items: [], total: 0 });
    });
  });

  it("orders same-weight rows newest first", () => {
    const built = buildJobAttention(
      inputs({
        notes: [
          note({ remoteId: "old", at: "2026-08-01 08:00:00", actionRequired: true }),
          note({ remoteId: "new", at: "2026-08-20 08:00:00", actionRequired: true }),
        ],
      })
    );
    expect(built.items.map((i) => i.key)).toEqual(["sm8flag:new", "sm8flag:old"]);
  });
});

describe("attentionCountLabel", () => {
  it("counts in words a person would use", () => {
    expect(attentionCountLabel(1)).toBe("1 open");
    expect(attentionCountLabel(4)).toBe("4 open");
  });
});
