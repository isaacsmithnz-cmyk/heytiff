/* Attaching an existing design to a job (#414).

   The behaviour worth pinning is not the markup — it is what attaching does
   to a document somebody has already filled in, and what detaching does NOT
   do to rows already pushed to a job card. */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { JobAttach } from "../job-attach";
import { createDesign, type DesignDocument } from "@/lib/studio/document";

const searchStudioJobs = jest.fn();
jest.mock("@/app/actions/studio", () => ({
  searchStudioJobs: (...a: unknown[]) => searchStudioJobs(...a),
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

/** render with a live document so onMutate actually applies, like the studio */
function harness(initial: DesignDocument) {
  const state = { doc: initial };
  const onMutate = jest.fn((fn: (d: DesignDocument) => DesignDocument) => {
    state.doc = fn(state.doc);
  });
  const view = render(<JobAttach doc={state.doc} onMutate={onMutate} />);
  return { state, onMutate, view };
}

beforeEach(() => {
  jest.clearAllMocks();
  searchStudioJobs.mockResolvedValue([HIT]);
});

describe("attaching", () => {
  it("offers the attach control when a design has no job", () => {
    harness(doc());
    expect(
      screen.getByRole("button", { name: /attach a servicem8 job/i })
    ).toBeInTheDocument();
  });

  it("writes the same jobLink shape createDesign does", async () => {
    const { state } = harness(doc());
    fireEvent.click(screen.getByRole("button", { name: /attach a servicem8 job/i }));
    fireEvent.change(screen.getByLabelText(/find the servicem8 job/i), {
      target: { value: "1234" },
    });
    fireEvent.click(await screen.findByRole("option"));

    expect(state.doc.jobLink).toMatchObject({
      provider: "servicem8",
      remoteId: "job-uuid-1",
      jobNumber: "1234",
    });
    // linkedAt is stamped, so sm8JobUuid() has a complete link to derive from
    expect(typeof state.doc.jobLink?.linkedAt).toBe("string");
  });

  it("fills the sheet's empty fields from the job", async () => {
    const { state } = harness(doc());
    fireEvent.click(screen.getByRole("button", { name: /attach a servicem8 job/i }));
    fireEvent.change(screen.getByLabelText(/find the servicem8 job/i), {
      target: { value: "1234" },
    });
    fireEvent.click(await screen.findByRole("option"));

    expect(state.doc.meta.client).toBe("JT Construct");
    expect(state.doc.meta.jobNumber).toBe("1234");
    expect(state.doc.meta.site).toContain("North Sydney");
  });

  it("NEVER overwrites an addressee somebody already typed", async () => {
    /* the difference from the new-design picker: there, the fields are empty
       by definition. Here a job is not licence to rewrite the sheet. */
    const { state } = harness(
      doc({ client: "Someone Else Pty Ltd", site: "9 Other Rd", jobNumber: "9999" })
    );
    fireEvent.click(screen.getByRole("button", { name: /attach a servicem8 job/i }));
    fireEvent.change(screen.getByLabelText(/find the servicem8 job/i), {
      target: { value: "1234" },
    });
    fireEvent.click(await screen.findByRole("option"));

    expect(state.doc.meta.client).toBe("Someone Else Pty Ltd");
    expect(state.doc.meta.site).toBe("9 Other Rd");
    expect(state.doc.meta.jobNumber).toBe("9999");
    // but the link itself still lands — that is what was being asked for
    expect(state.doc.jobLink?.remoteId).toBe("job-uuid-1");
  });
});

describe("an attached design", () => {
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

  it("says plainly that pushed rows stay on the job", () => {
    /* the one thing a person needs to know before clicking it — rows already
       pushed are a record of a push that happened, not a live mirror */
    harness(linked());
    expect(
      screen.getByRole("button", { name: /unlink/i }).getAttribute("title")
    ).toMatch(/already added to the job card stays/i);
  });
});

describe("the search field", () => {
  it("does not search on a single character", () => {
    harness(doc());
    fireEvent.click(screen.getByRole("button", { name: /attach a servicem8 job/i }));
    fireEvent.change(screen.getByLabelText(/find the servicem8 job/i), {
      target: { value: "1" },
    });
    expect(searchStudioJobs).not.toHaveBeenCalled();
  });

  it("reports an empty result rather than pretending to still be looking", async () => {
    searchStudioJobs.mockResolvedValue([]);
    harness(doc());
    fireEvent.click(screen.getByRole("button", { name: /attach a servicem8 job/i }));
    fireEvent.change(screen.getByLabelText(/find the servicem8 job/i), {
      target: { value: "zzzz" },
    });
    await waitFor(() =>
      expect(screen.getByText(/no servicem8 job matches/i)).toBeInTheDocument()
    );
  });
});
