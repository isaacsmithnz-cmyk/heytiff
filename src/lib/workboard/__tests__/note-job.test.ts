import {
  clientScore,
  clientWords,
  foundJobLine,
  jobNamedOf,
  jobNumberOf,
  notFoundLine,
  pickNamedJob,
  workWords,
  type NamedJob,
} from "../note-job";
import { rawFromCalls, shapeProposal, noteTools, type NoteContext } from "../note-brain";
import { storedProposal } from "../note-draft";

/* THE JOB THE WORDS NAME (bugs 77, 87, 88). Made-up clients and places. */

const job = (over: Partial<NamedJob>): NamedJob => ({
  uuid: "j",
  number: "100",
  address: "12 Sample Road\nExampleton NSW 2000",
  client: "Sampleco Building",
  status: "Completed",
  date: "2026-01-01 00:00:00",
  ...over,
});
const named = (over: Partial<{ client: string; place: string; number: string; latest: boolean; work: string; open: boolean }> = {}) => ({
  client: "",
  place: "",
  number: "",
  latest: false,
  ...over,
});

describe("what the router said", () => {
  it("is re-read, and nothing when it names nothing", () => {
    expect(jobNamedOf({ client: " Sampleco Building ", place: "Exampleton", number: "", latest: true })).toEqual(named({ client: "Sampleco Building", place: "Exampleton", latest: true }));
    expect(jobNamedOf({ client: "", place: "", number: "" })).toBeNull();
    expect(jobNamedOf("Sampleco")).toBeNull();
    expect(jobNamedOf(null)).toBeNull();
  });

  it("reads a job number as ServiceM8 writes it", () => {
    expect(jobNumberOf("#3239a")).toBe("3239A");
    expect(jobNumberOf("job 3239A")).toBe("3239A");
    expect(jobNumberOf("1042")).toBe("1042");
    expect(jobNumberOf("the big one")).toBe("");
  });

  it("is a tool the router can call, and reaches the stored proposal", () => {
    expect(noteTools(true).map((t) => t.name)).toContain("job_named");
    const raw = rawFromCalls([{ name: "job_named", input: { client: "Sampleco Building", place: "Exampleton", number: "", latest: true } }]);
    const ctx: NoteContext = { staff: [], todayISO: "2026-11-24" };
    const p = shapeProposal(raw, ctx);
    expect(p.jobNamed).toEqual(named({ client: "Sampleco Building", place: "Exampleton", latest: true }));
    expect(storedProposal(JSON.parse(JSON.stringify(p)))?.jobNamed).toEqual(p.jobNamed);
    expect(shapeProposal(rawFromCalls([]), ctx).jobNamed).toBeUndefined();
  });
});

describe("the client said", () => {
  it("is the same name, or a letter or two out as a name is heard, never a word in common", () => {
    expect(clientScore("Sampleco Building", "Sampleco Building Pty Ltd")).toBe(3);
    // "T-Con" heard for "Tecon": one letter out
    expect(clientScore("T-Con Building", "Tecon Building")).toBe(2);
    expect(clientScore("T-Con Building", "Rizk Building")).toBe(0);
    expect(clientScore("Building", "Sampleco Building")).toBe(0);
    expect(clientScore("Al", "Al")).toBe(0);
  });

  it("is looked for by its words, a hyphenated one squashed too", () => {
    expect(clientWords("T-Con Building")).toEqual(["tcon", "con", "building"]);
  });
});

describe("which job that is", () => {
  it("is the most recent of the jobs at one site, finished ones too (bug 77)", () => {
    const jobs = [
      job({ uuid: "a", number: "3239", date: "2026-08-27 00:00:00" }),
      job({ uuid: "b", number: "3239A", date: "2026-09-15 00:00:00", address: "12 Sample Rd\nExampleton NSW 2000" }),
    ];
    expect(pickNamedJob(jobs, named({ place: "12 Sample Road" }))).toEqual({ kind: "one", job: jobs[1] });
  });

  it("is the most recent anywhere when they said the last one (bug 87)", () => {
    const jobs = [
      job({ uuid: "old", number: "276", address: "34 Other Street\nExampleton NSW 2000", date: "2024-04-29 00:00:00" }),
      job({ uuid: "new", number: "2494A", date: "2026-04-02 00:00:00" }),
      job({ uuid: "lost", number: "2600", address: "9 Lost Ave\nExampleton NSW 2000", status: "Unsuccessful", date: "2026-06-01 00:00:00" }),
    ];
    expect(pickNamedJob(jobs, named({ client: "Sampleco", place: "Exampleton", latest: true }))).toEqual({ kind: "one", job: jobs[1] });
  });

  it("is asked when several places fit and nothing says which, one answer a place", () => {
    const jobs = [
      job({ uuid: "a", number: "1", address: "1 One St\nExampleton NSW 2000", date: "2026-03-01" }),
      job({ uuid: "a2", number: "1A", address: "1 One Street\nExampleton NSW 2000", date: "2026-03-05" }),
      job({ uuid: "b", number: "2", address: "2 Two St\nExampleton NSW 2000", date: "2026-02-01" }),
    ];
    const pick = pickNamedJob(jobs, named({ client: "Sampleco" }));
    expect(pick).toEqual({ kind: "several", jobs: [jobs[1], jobs[2]] });
  });

  it("is the one with the number said", () => {
    const jobs = [job({ uuid: "a", number: "3239" }), job({ uuid: "b", number: "3239A", address: "1 Elsewhere St\nExampleton NSW 2000" })];
    expect(pickNamedJob(jobs, named({ number: "3239A" }))).toEqual({ kind: "one", job: jobs[1] });
  });

  it("is none when nothing was found", () => {
    expect(pickNamedJob([], named({ client: "Sampleco" }))).toEqual({ kind: "none" });
  });
});

describe("what she says", () => {
  it("names the job she found", () => {
    expect(foundJobLine(job({ number: "2494A" }))).toBe("On job #2494A, Sampleco Building, 12 Sample Road, Exampleton NSW 2000.");
  });

  it("says what she looked for when she found nothing", () => {
    expect(notFoundLine(named({ client: "Sampleco", place: "Exampleton" }), false)).toBe("I looked for Sampleco's jobs at Exampleton and found none.");
    expect(notFoundLine(named({ client: "Sampleco" }), true)).toBe("I couldn't find Sampleco among your clients.");
    expect(notFoundLine(named({ place: "12 Sample Road" }), false)).toBe("I looked for jobs at 12 Sample Road and found none.");
    expect(notFoundLine(named({ number: "3239A" }), false)).toBe("I looked for job 3239A and found none.");
  });
});

/* Isaac, 26 November 2026: "We need to get a quote built out for the split
   system that is outstanding" made a task and asked who, never which job. */
describe("a job named by its work", () => {
  it("is what the router said, open when they said outstanding", () => {
    expect(jobNamedOf({ client: "", place: "", number: "", latest: false, work: "split system", open: true })).toEqual(named({ work: "split system", open: true }));
    expect(workWords("the split system quote that's outstanding")).toEqual(["split", "system"]);
    // words that say nothing of the work name nothing
    expect(jobNamedOf({ client: "", place: "", number: "", latest: false, work: "the job", open: true })).toBeNull();
  });

  it("reaches the stored proposal", () => {
    const raw = rawFromCalls([{ name: "job_named", input: { client: "", place: "", number: "", latest: false, work: "split system", open: true } }]);
    const p = shapeProposal(raw, { staff: [], todayISO: "2026-11-27" });
    expect(storedProposal(JSON.parse(JSON.stringify(p)))?.jobNamed).toEqual(named({ work: "split system", open: true }));
  });

  it("one open job is that one; several at different places are asked about", () => {
    expect(pickNamedJob([job({ uuid: "a", status: "Quote" })], named({ work: "split system", open: true }))).toEqual({ kind: "one", job: job({ uuid: "a", status: "Quote" }) });
    expect(pickNamedJob([job({ uuid: "a", status: "Quote" }), job({ uuid: "b", status: "Quote", address: "2 Two St\nExampleton NSW 2000" })], named({ work: "split system", open: true })).kind).toBe("several");
  });

  it("says what she looked for when none is open", () => {
    expect(notFoundLine(named({ work: "split system", open: true }), false)).toBe("I looked for open jobs for a split system and found none.");
    expect(notFoundLine(named({ client: "Sampleco", work: "ducted quote", open: true }), false)).toBe("I looked for Sampleco's open jobs for a ducted quote and found none.");
  });
});
