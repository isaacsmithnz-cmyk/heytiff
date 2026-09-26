/* Which job did the note mean?

   These are Isaac's actual note and the board it was dictated against. The
   headline case is that the transcript says "Kingsford Medical Center" and the
   agreement says "Kingsford Medical Centre" — an exact-name match finds
   nothing, which is why this matches by token. */

import { describeJob, matchedJobs, searchJobs, type JobCandidate } from "../note-match";

const KINGSFORD_TRIP: JobCandidate = {
  kind: "visit",
  id: "v-king",
  clientName: "Kingsford Medical Centre",
  label: "Ducted units — quarterly",
  siteLabel: "Consult wing",
  jobNumber: "1042",
};
const ARDEX: JobCandidate = {
  kind: "visit",
  id: "v-ardex",
  clientName: "Ardex Logistics",
  label: "Rooftop package units — monthly",
  siteLabel: "Bay 4",
  jobNumber: null,
};
const MERIDIAN: JobCandidate = {
  kind: "agreement",
  id: "a-mer",
  clientName: "Meridian Data",
  label: "Server room CRACs — quarterly",
  siteLabel: "Level 2 comms room",
  jobNumber: null,
};
const ROSTER = [ARDEX, MERIDIAN, KINGSFORD_TRIP];

const SAID =
  "Luke needs to organize some filters for Kingsford Medical Center. We're supposed to go " +
  "there on the third of August. We need two twenty by twenty by two filters, and we also " +
  "need to hire a scissor lift to get access to the outdoor unit";

/* What was said, matched to a job card: the quick answers under Tiff's
   "Which job is this for?" come off this (`matchedJobs`). */
describe("matching what was said to a job card", () => {
  it("finds the job Isaac's note meant, across the Centre/Center mishearing", () => {
    expect(matchedJobs(SAID, ROSTER).map((c) => c.id)).toEqual(["v-king"]);
  });

  it("a job number said out loud settles it outright, even against another client's name", () => {
    expect(matchedJobs("Ardex want a quote, but first close out job 1042", ROSTER)[0].id).toBe("v-king");
  });

  /* Two jobs for the same client is the case where guessing is worse than
     asking — both are offered, and nothing else. */
  it("offers both of two jobs for the same client, rather than picking one", () => {
    const second: JobCandidate = { ...KINGSFORD_TRIP, id: "v-king-2", siteLabel: null };
    expect(matchedJobs("filters for Kingsford", [...ROSTER, second]).map((c) => c.id).sort()).toEqual([
      "v-king",
      "v-king-2",
    ]);
  });

  it("the site breaks a tie the client name can't", () => {
    const second: JobCandidate = { ...KINGSFORD_TRIP, id: "v-king-2", siteLabel: "Plant room" };
    expect(matchedJobs("Kingsford plant room needs a scissor lift", [...ROSTER, second])[0].id).toBe("v-king-2");
  });

  /* "Medical", "Centre", "Data", "Logistics" appear across half a client
     list. Matching on them would make every client a candidate for every
     note, which is the same as matching on nothing. */
  it("generic words in a client name identify nobody", () => {
    expect(matchedJobs("the medical centre called about data", ROSTER)).toEqual([]);
    expect(matchedJobs("logistics of the aged care site", ROSTER)).toEqual([]);
  });

  it("an empty roster can't match anything and doesn't pretend to", () => {
    expect(matchedJobs(SAID, [])).toEqual([]);
  });
});

describe("how a job card says who it is", () => {
  it("leads with the job number when there is one", () => {
    expect(describeJob(KINGSFORD_TRIP)).toBe(
      "Kingsford Medical Centre — Ducted units — quarterly, Consult wing, job #1042"
    );
  });

  it("says there ISN'T a job number rather than leaving a gap", () => {
    expect(describeJob(ARDEX)).toContain("no job number yet");
    expect(describeJob(MERIDIAN)).toContain("the agreement, no job raised yet");
  });
});

/* Searching is not matching. Matching reads a whole spoken sentence and has
   to ignore the noise in it; searching reads what someone is deliberately
   typing to find a job, so it takes them literally. */
describe("searching the roster by hand", () => {
  it("takes generic words literally — they're useless to infer, fine to type", () => {
    expect(searchJobs("medical", ROSTER).map((c) => c.id)).toEqual(["v-king"]);
    expect(searchJobs("logistics", ROSTER).map((c) => c.id)).toEqual(["v-ardex"]);
  });

  it("finds a job by its number", () => {
    expect(searchJobs("1042", ROSTER).map((c) => c.id)).toEqual(["v-king"]);
  });

  it("finds by site and by service, not just by client", () => {
    expect(searchJobs("consult wing", ROSTER).map((c) => c.id)).toEqual(["v-king"]);
    expect(searchJobs("rooftop", ROSTER).map((c) => c.id)).toEqual(["v-ardex"]);
  });

  it("every word has to land — two words narrow, they don't widen", () => {
    expect(searchJobs("kingsford rooftop", ROSTER)).toHaveLength(0);
    expect(searchJobs("kingsford ducted", ROSTER).map((c) => c.id)).toEqual(["v-king"]);
  });

  it("an empty search is not a filter", () => {
    expect(searchJobs("   ", ROSTER)).toHaveLength(3);
  });
});

/* The quick answers under Tiff's "Which job is this for?". A button is an
   answer the person can press without reading, so it is only ever a job the
   words pointed at — never the rest of the roster. */
describe("the jobs a note pointed at", () => {
  it("offers only the matches, best first", () => {
    expect(matchedJobs(SAID, ROSTER).map((c) => c.id)).toEqual(["v-king"]);
    expect(matchedJobs("Ardex want a quote, but first close out job 1042", ROSTER).map((c) => c.id)).toEqual([
      "v-king",
      "v-ardex",
    ]);
  });

  it("offers nothing when the note named nobody on the board", () => {
    expect(matchedJobs("Order more coil cleaner for the van", ROSTER)).toEqual([]);
  });

  it("offers three at most", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ ...ARDEX, id: `v-${i}` }));
    expect(matchedJobs("Ardex", many)).toHaveLength(3);
  });
});
