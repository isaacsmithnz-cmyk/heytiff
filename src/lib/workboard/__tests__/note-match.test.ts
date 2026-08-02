/* Which job did the note mean?

   These are Isaac's actual note and the board it was dictated against. The
   headline case is that the transcript says "Kingsford Medical Center" and the
   agreement says "Kingsford Medical Centre" — an exact-name match finds
   nothing, which is why this matches by token. */

import { describeJob, matchJob, type JobCandidate } from "../note-match";

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

describe("matching what was said to a job card", () => {
  it("finds the job Isaac's note meant, across the Centre/Center mishearing", () => {
    const m = matchJob(SAID, ROSTER);
    expect(m.bestId).toBe("v-king");
    expect(m.ambiguous).toBe(false);
    expect(m.ranked[0].id).toBe("v-king");
  });

  it("says nothing rather than guessing when the note names no one on the board", () => {
    const m = matchJob("Order more coil cleaner for the van", ROSTER);
    expect(m.bestId).toBeNull();
    expect(m.ambiguous).toBe(false);
    // the whole roster is still offered — it just isn't ranked
    expect(m.ranked).toHaveLength(3);
  });

  it("a job number said out loud settles it outright, even against another client's name", () => {
    const m = matchJob("Ardex want a quote, but first close out job 1042", ROSTER);
    expect(m.bestId).toBe("v-king");
  });

  /* Two jobs for the same client is the case where guessing is worse than
     asking — both are offered at the top and nothing is preselected. */
  it("refuses to pick between two jobs for the same client", () => {
    const second: JobCandidate = { ...KINGSFORD_TRIP, id: "v-king-2", siteLabel: null };
    const m = matchJob("filters for Kingsford", [...ROSTER, second]);
    expect(m.bestId).toBeNull();
    expect(m.ambiguous).toBe(true);
    expect(m.ranked.slice(0, 2).map((c) => c.id).sort()).toEqual(["v-king", "v-king-2"]);
  });

  it("the site breaks a tie the client name can't", () => {
    const second: JobCandidate = { ...KINGSFORD_TRIP, id: "v-king-2", siteLabel: "Plant room" };
    const m = matchJob("Kingsford plant room needs a scissor lift", [...ROSTER, second]);
    expect(m.bestId).toBe("v-king-2");
    expect(m.ambiguous).toBe(false);
  });

  /* "Medical", "Centre", "Data", "Logistics" appear across half a client
     list. Matching on them would make every client a candidate for every
     note, which is the same as matching on nothing. */
  it("generic words in a client name identify nobody", () => {
    expect(matchJob("the medical centre called about data", ROSTER).bestId).toBeNull();
    expect(matchJob("logistics of the aged care site", ROSTER).bestId).toBeNull();
  });

  it("an empty roster can't match anything and doesn't pretend to", () => {
    const m = matchJob(SAID, []);
    expect(m.bestId).toBeNull();
    expect(m.ranked).toHaveLength(0);
  });
});

describe("how a job card says who it is", () => {
  it("leads with the job number when there is one", () => {
    expect(describeJob(KINGSFORD_TRIP)).toBe(
      "Kingsford Medical Centre — Ducted units — quarterly · Consult wing · job #1042"
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
  const { searchJobs } = require("../note-match") as typeof import("../note-match");

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
