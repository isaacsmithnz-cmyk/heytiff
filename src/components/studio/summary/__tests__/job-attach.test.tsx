/* Linking an existing design to a job (#414; Link job, 15 November 2026).

   The behaviour worth pinning is not the markup — it is what linking does
   to a document somebody has already filled in, that its plans go onto the
   job first and the link only lands once they have, and what unlinking does
   NOT do to what is already on the job. */

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { JobAttach } from "../job-attach";
import { createDesign, type DesignDocument } from "@/lib/studio/document";

const searchStudioJobs = jest.fn();
const listStudioJobs = jest.fn();
jest.mock("@/app/actions/studio", () => ({
  searchStudioJobs: (...a: unknown[]) => searchStudioJobs(...a),
  readStudioJobs: () => Promise.resolve([]),
  listStudioJobs: (...a: unknown[]) => listStudioJobs(...a),
}));
const linkPlansToJob = jest.fn();
jest.mock("@/app/actions/job-plans", () => ({
  linkPlansToJob: (...a: unknown[]) => linkPlansToJob(...a),
}));
const kickPlanReads = jest.fn();
jest.mock("@/lib/jobs/plans-client", () => ({
  kickPlanReads: (...a: unknown[]) => kickPlanReads(...a),
}));

const HIT = {
  remoteId: "job-uuid-1",
  jobNumber: "1234",
  clientName: "JT Construct",
  status: "Completed",
  address: "23 West Street\nNorth Sydney NSW 2060",
  suburb: "North Sydney",
  description: "Install VRF System",
};

function doc(over: Partial<DesignDocument["meta"]> = {}): DesignDocument {
  const d = createDesign({ name: "85 West St", mode: "blank", now: "2026-08-16T00:00:00.000Z" });
  d.meta = { ...d.meta, ...over };
  return d;
}

/** a design with its own plan: one photo on the ground floor */
function withPlan(): DesignDocument {
  const d = doc();
  d.floors = [
    {
      id: "flr_gf",
      name: "Ground floor",
      level: 0,
      scaleMmPerUnit: null,
      northDeg: null,
      northPos: null,
      plans: [{ id: "sht_1", imageRef: "org/o/page1.png", pageNumber: null, name: "Ground floor", width: 2000, height: 1400, x: 0, y: 0 }],
    },
  ];
  d.planImport = { sources: [{ ref: "org/o/src.jpeg", kind: "image", name: "Neridah.jpeg" }], placed: { 0: "org/o/page1.png" }, chosen: [0], names: {} };
  return d;
}

/** render with a live document so onMutate actually applies, like the studio */
function harness(initial: DesignDocument) {
  const state = { doc: initial };
  const onMutate = jest.fn((fn: (d: DesignDocument) => DesignDocument) => {
    state.doc = fn(state.doc);
  });
  const view = render(<JobAttach doc={state.doc} onMutate={onMutate} />);
  return { state, onMutate, view };
}

/** the dialog's own Link job */
const confirm = () => fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^link job$/i }));

/** Link job, then the job picked from its card */
async function pick() {
  fireEvent.click(screen.getByRole("button", { name: /^link job$/i }));
  await screen.findByRole("dialog");
  fireEvent.click(await screen.findByRole("button", { name: /1234, JT Construct/ }));
}

beforeEach(() => {
  jest.clearAllMocks();
  searchStudioJobs.mockResolvedValue([HIT]);
  listStudioJobs.mockResolvedValue([HIT]);
  linkPlansToJob.mockResolvedValue({ ok: true, planIds: ["jplan_1"], toRead: [], lead: "jplan_1" });
});

describe("linking", () => {
  it("offers Link job when a design has no job", () => {
    harness(doc());
    expect(screen.getByRole("button", { name: /^link job$/i })).toBeInTheDocument();
  });

  it("writes the same jobLink shape createDesign does", async () => {
    const { state } = harness(doc());
    await pick();
    expect(screen.getByRole("heading", { name: "Link to job 1234" })).toBeInTheDocument();
    confirm();
    await waitFor(() => expect(state.doc.jobLink).not.toBeNull());
    expect(state.doc.jobLink).toMatchObject({ provider: "servicem8", remoteId: "job-uuid-1", jobNumber: "1234" });
    // linkedAt is stamped, so sm8JobUuid() has a complete link to derive from
    expect(typeof state.doc.jobLink?.linkedAt).toBe("string");
    /* a design with no plans has nothing to move */
    expect(linkPlansToJob).not.toHaveBeenCalled();
  });

  it("fills the sheet's empty fields from the job", async () => {
    const { state } = harness(doc());
    await pick();
    confirm();
    await waitFor(() => expect(state.doc.meta.client).toBe("JT Construct"));
    expect(state.doc.meta.jobNumber).toBe("1234");
    expect(state.doc.meta.site).toContain("North Sydney");
  });

  it("NEVER overwrites an addressee somebody already typed", async () => {
    /* the difference from the new-design picker: there, the fields are empty
       by definition. Here a job is not licence to rewrite the sheet. */
    const { state } = harness(doc({ client: "Someone Else Pty Ltd", site: "9 Other Rd", jobNumber: "9999" }));
    await pick();
    confirm();
    await waitFor(() => expect(state.doc.jobLink?.remoteId).toBe("job-uuid-1"));
    expect(state.doc.meta.client).toBe("Someone Else Pty Ltd");
    expect(state.doc.meta.site).toBe("9 Other Rd");
    expect(state.doc.meta.jobNumber).toBe("9999");
  });

  it("finds a job by search, as New design does", async () => {
    harness(doc());
    fireEvent.click(screen.getByRole("button", { name: /^link job$/i }));
    fireEvent.change(screen.getByLabelText(/find a job/i), { target: { value: "1234" } });
    await waitFor(() => expect(searchStudioJobs).toHaveBeenCalledWith("1234"));
    expect(await screen.findByRole("list", { name: "Jobs found" })).toBeInTheDocument();
  });
});

describe("its plans go onto the job", () => {
  it("lists them with what was read, and says they aren't read again", async () => {
    const d = withPlan();
    d.reading = {
      at: "2026-11-14T00:00:00Z",
      model: "m",
      floors: { flr_gf: [{ sheetId: "sht_1", spaces: [{ name: "Bed 1", kind: "room", outline: [] }, { name: "Bed 2", kind: "room", outline: [] }], openings: [], marks: [], furniture: [], checklist: [], flags: [], planUp: "N" } as never] },
      failed: [],
    };
    harness(d);
    await pick();
    expect(screen.getByText("Neridah.jpeg")).toBeInTheDocument();
    expect(screen.getByText("Ground floor, 2 rooms, as read in this design. Not read again")).toBeInTheDocument();
    expect(screen.getByText("Ground floor, page 1")).toBeInTheDocument();
  });

  it("moves them, then links, then says the design came from the job's plan", async () => {
    const { state } = harness(withPlan());
    await pick();
    expect(screen.getByText("Ground floor. Tiff reads it on the job")).toBeInTheDocument();
    linkPlansToJob.mockResolvedValue({ ok: true, planIds: ["jplan_1"], toRead: ["jplan_1"], lead: "jplan_1" });
    confirm();
    await waitFor(() => expect(state.doc.jobLink?.remoteId).toBe("job-uuid-1"));
    expect(linkPlansToJob).toHaveBeenCalledWith("job-uuid-1", state.doc.id);
    expect(state.doc.planImport?.jobPlanId).toBe("jplan_1");
    /* one not read in the design is read on the job */
    await waitFor(() => expect(kickPlanReads).toHaveBeenCalledWith(["jplan_1"]));
  });

  it("links nothing when the plans couldn't be moved, and says why", async () => {
    linkPlansToJob.mockResolvedValue({ ok: false, error: "A plan's file couldn't be fetched. Nothing was linked." });
    const { state } = harness(withPlan());
    await pick();
    confirm();
    expect(await screen.findByRole("alert")).toHaveTextContent("Nothing was linked");
    expect(state.doc.jobLink).toBeNull();
  });
});

describe("a linked design", () => {
  const linked = () => {
    /* filled in, so "unlinking touches nothing else" is actually testable —
       an empty fixture would pass even if detach blanked the sheet */
    const d = doc({ client: "JT Construct", site: "23 West Street, North Sydney" });
    d.jobLink = {
      provider: "servicem8",
      remoteId: "job-uuid-1",
      jobNumber: "1234",
      linkedAt: "2026-08-16T00:00:00.000Z",
    };
    return d;
  };

  it("shows where the number came from, and offers to unlink", () => {
    harness(linked());
    expect(screen.getByText(/added from servicem8/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /unlink/i })).toBeInTheDocument();
  });

  it("unlinking clears the link and touches nothing else", () => {
    const { state } = harness(linked());
    fireEvent.click(screen.getByRole("button", { name: /unlink/i }));
    expect(state.doc.jobLink).toBeNull();
    /* the meta the job filled in STAYS: it is the sheet's own content now,
       and blanking a client because a link was removed would lose work */
    expect(state.doc.meta.name).toBe("85 West St");
    expect(state.doc.meta.client).toBe("JT Construct");
    expect(state.doc.meta.site).toBe("23 West Street, North Sydney");
  });

  it("says plainly that what's on the job stays there, its plans too", () => {
    harness(linked());
    expect(screen.getByRole("button", { name: /unlink/i })).toHaveAccessibleDescription(/already added to the job card stays there, its plans too/i);
  });
});
