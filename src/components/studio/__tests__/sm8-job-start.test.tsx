/* Starting a design FROM a ServiceM8 job — the naming step's search.

   What has to hold: the box only exists where the route says ServiceM8 is
   readable; picking a job names the design AND fills the three meta fields
   the Summary sheet prints; and a stale answer can never overwrite a newer
   one, which is the failure a per-keystroke search invites and the reason
   the component carries a sequence number at all. */

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Studio, type JobLists, type JobSearch } from "../studio";
import { LocalDesignStore } from "@/lib/studio/store";
import { createDesign } from "@/lib/studio/document";
import type { StudioJobHit } from "@/lib/studio/job-link";

const JOBS: StudioJobHit[] = [
  {
    remoteId: "j-3151",
    jobNumber: "3151",
    clientName: "Diamond Air",
    status: "Work Order",
    address: "12/3 Wallace St\nWaverley NSW 2024",
    suburb: "Waverley",
    description: "Supply and install 10kW multi",
    kind: "Install",
    hue: "purple",
    plansRead: true,
  },
  {
    remoteId: "j-2506",
    jobNumber: "2506",
    clientName: "Bondi Body Corp",
    status: "Completed",
    address: "260 Birrell St,\nBondi Junction NSW 2022",
    suburb: "Bondi Junction",
    description: "AC not cooling",
  },
];

const studio = (jobSearch: JobSearch, sm8Jobs = true, jobLists?: JobLists) => (
  <Studio
    store={new LocalDesignStore(window.localStorage)}
    sm8Jobs={sm8Jobs}
    jobSearch={jobSearch}
    jobLists={jobLists}
  />
);

const FIELD = "Find a job";
const WALLACE = "3151, Diamond Air, 12/3 Wallace St, Waverley";

/* The one design in the local store — autosave debounces, so callers wait on
   a field of this rather than reading it once. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const savedDoc = (): any => {
  const key = Object.keys(window.localStorage).find((k) =>
    k.startsWith("heytiff.studio.design.")
  );
  return key ? JSON.parse(window.localStorage.getItem(key)!) : {};
};

describe("new design — from a ServiceM8 job", () => {
  beforeEach(() => window.localStorage.clear());

  it("is not offered when the route says ServiceM8 isn't readable", async () => {
    const user = userEvent.setup();
    const search = jest.fn(async () => JOBS);
    render(studio(search, false));

    await user.click(await screen.findByText("New design"));
    expect(screen.queryByLabelText(FIELD)).toBeNull();
    expect(screen.getByPlaceholderText(/Design name/)).toBeInTheDocument();
    expect(search).not.toHaveBeenCalled();
  });

  /* THE JOB COMES FIRST (Isaac, 14 November 2026: "designs have to be built
     from a job ... Unless you just do unlinked job"). */
  it("asks for the job before the name and the plans", async () => {
    const user = userEvent.setup();
    render(studio(async () => JOBS));

    await user.click(await screen.findByText("New design"));
    expect(screen.getByLabelText(FIELD)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start without a job" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Design name/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Start with a blank canvas" })).toBeNull();
    expect(screen.queryByText("Drop the plans")).toBeNull();
  });

  it("waits for two characters before asking the mirror", async () => {
    const user = userEvent.setup();
    const search = jest.fn(async () => JOBS);
    render(studio(search));

    await user.click(await screen.findByText("New design"));
    await user.type(screen.getByLabelText(FIELD), "3");
    expect(search).not.toHaveBeenCalled();
    expect(screen.queryByRole("list", { name: "Jobs found" })).toBeNull();

    await user.type(screen.getByLabelText(FIELD), "1");
    await waitFor(() => expect(search).toHaveBeenCalledWith("31"));
  });

  it("picks a job, names the design from its street, and fills the job card", async () => {
    const user = userEvent.setup();
    render(studio(async () => JOBS));

    await user.click(await screen.findByText("New design"));
    await user.type(screen.getByLabelText(FIELD), "wallace");

    const list = await screen.findByRole("list", { name: "Jobs found" });
    // a found job is a job card: its number, its client, its street
    const card = within(list).getByRole("button", { name: WALLACE });
    expect(card).toHaveClass("sc-card", "sc-card--purple");
    expect(within(card).getByText("3151")).toBeInTheDocument();
    expect(within(card).getByText("Diamond Air")).toBeInTheDocument();
    expect(within(card).getByText("12/3 Wallace St, Waverley")).toBeInTheDocument();
    expect(within(card).getByText("Install")).toBeInTheDocument();
    expect(within(card).getByText("Plans read")).toBeInTheDocument();
    expect(screen.getByText("2 jobs")).toBeInTheDocument();

    await user.click(card);

    // the name field is filled — and still editable
    expect(screen.getByPlaceholderText(/Design name/)).toHaveValue("12/3 Wallace St");
    // the search gives way to the job it found, as its card
    expect(screen.queryByLabelText(FIELD)).toBeNull();
    const picked = screen.getByText("3151").closest(".ds2-nd-picked")!;
    expect(picked).toHaveClass("sc-card--purple");
    expect(within(picked as HTMLElement).getByText("Diamond Air")).toBeInTheDocument();
    expect(within(picked as HTMLElement).getByText("12/3 Wallace St, Waverley")).toBeInTheDocument();
    // the Plans row says what's read; the card doesn't say it twice
    expect(within(picked as HTMLElement).queryByText("Plans read")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Start with a blank canvas" }));

    // the three fields the Summary sheet prints arrive already answered
    expect(await screen.findByTestId("studio-canvas")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Summary" }));
    expect(screen.getByLabelText("Job number")).toHaveValue("3151");
    expect(screen.getByLabelText("Client")).toHaveValue("Diamond Air");
    expect(screen.getByLabelText("Site")).toHaveValue("12/3 Wallace St, Waverley NSW 2024");
    // …and the sheet says where they came from, which the fields cannot
    expect(screen.getByText(/Added from ServiceM8/)).toBeInTheDocument();
  });

  /* The three meta fields are free text — retype the number and nothing can
     match the design back to its job. The link is what survives that, so it
     has to reach storage, not just the screen. */
  it("stores the mirror row's uuid on the saved document", async () => {
    const user = userEvent.setup();
    render(studio(async () => JOBS));

    await user.click(await screen.findByText("New design"));
    await user.type(screen.getByLabelText(FIELD), "wallace");
    await user.click(await screen.findByRole("button", { name: WALLACE }));
    await user.click(screen.getByRole("button", { name: "Start with a blank canvas" }));
    await screen.findByTestId("studio-canvas");

    await waitFor(() => {
      expect(savedDoc().jobLink).toMatchObject({
        provider: "servicem8",
        remoteId: "j-3151",
        jobNumber: "3151",
      });
    });
    expect(typeof savedDoc().jobLink.linkedAt).toBe("string");
  });

  it("started without a job, a design is linked to nothing", async () => {
    const user = userEvent.setup();
    render(studio(async () => JOBS));

    await user.click(await screen.findByText("New design"));
    await user.click(screen.getByRole("button", { name: "Start without a job" }));
    // the choice stays in the Job field, with a cross back to the jobs
    expect(screen.getByText("No job")).toBeInTheDocument();
    expect(screen.queryByLabelText(FIELD)).toBeNull();
    await user.type(screen.getByPlaceholderText(/Design name/), "Farran St");
    await user.click(screen.getByRole("button", { name: "Start with a blank canvas" }));
    await screen.findByTestId("studio-canvas");

    await waitFor(() => expect(savedDoc().meta.name).toBe("Farran St"));
    expect(savedDoc().jobLink).toBeNull();
  });

  it("No job's cross goes back to the jobs", async () => {
    const user = userEvent.setup();
    render(studio(async () => JOBS));

    await user.click(await screen.findByText("New design"));
    await user.click(screen.getByRole("button", { name: "Start without a job" }));
    await user.click(screen.getByRole("button", { name: "Choose a job" }));
    expect(screen.getByLabelText(FIELD)).toBeInTheDocument();
    expect(screen.queryByText("No job")).toBeNull();
  });

  it("keeps a name typed over the picked one, and still saves the job's fields", async () => {
    const user = userEvent.setup();
    render(studio(async () => JOBS));

    await user.click(await screen.findByText("New design"));
    await user.type(screen.getByLabelText(FIELD), "wallace");
    await user.click(await screen.findByRole("button", { name: WALLACE }));

    await user.clear(screen.getByPlaceholderText(/Design name/));
    await user.type(screen.getByPlaceholderText(/Design name/), "Wallace St — option B");
    await user.click(screen.getByRole("button", { name: "Start with a blank canvas" }));

    expect(await screen.findByLabelText("Design name")).toHaveValue("Wallace St — option B");
    await user.click(screen.getByRole("button", { name: "Summary" }));
    expect(screen.getByLabelText("Client")).toHaveValue("Diamond Air");
  });

  it("unpicking gives the search back, and the name the job gave goes with it", async () => {
    const user = userEvent.setup();
    render(studio(async () => JOBS));

    await user.click(await screen.findByText("New design"));
    await user.type(screen.getByLabelText(FIELD), "wallace");
    await user.click(await screen.findByRole("button", { name: WALLACE }));

    await user.click(screen.getByRole("button", { name: /Clear the job/ }));
    expect(screen.getByLabelText(FIELD)).toHaveValue("");
    // a design with no job isn't left named after a job's street
    await user.click(screen.getByRole("button", { name: "Start without a job" }));
    expect(screen.getByPlaceholderText(/Design name/)).toHaveValue("");
  });

  it("unpicking keeps a name typed over the job's", async () => {
    const user = userEvent.setup();
    render(studio(async () => JOBS));

    await user.click(await screen.findByText("New design"));
    await user.type(screen.getByLabelText(FIELD), "wallace");
    await user.click(await screen.findByRole("button", { name: WALLACE }));
    await user.clear(screen.getByPlaceholderText(/Design name/));
    await user.type(screen.getByPlaceholderText(/Design name/), "Option B");

    await user.click(screen.getByRole("button", { name: /Clear the job/ }));
    await user.click(screen.getByRole("button", { name: "Start without a job" }));
    expect(screen.getByPlaceholderText(/Design name/)).toHaveValue("Option B");
  });

  it("says so out loud when nothing in the mirror matches", async () => {
    const user = userEvent.setup();
    render(studio(async () => []));

    await user.click(await screen.findByText("New design"));
    await user.type(screen.getByLabelText(FIELD), "zzzz");
    expect(await screen.findByText("No jobs match")).toBeInTheDocument();
  });

  /* RECENT, THEN ALL JOBS (Isaac, 14 November 2026: "Recent jobs at top",
     and "Both" to the jobs last opened and the newest). */
  describe("the jobs under the search", () => {
    const more: StudioJobHit[] = Array.from({ length: 14 }, (_, i) => ({
      remoteId: `j-${3500 - i}`,
      jobNumber: String(3500 - i),
      clientName: `Client ${3500 - i}`,
      status: "Quote",
      address: `${i + 1} Test St\nBronte NSW 2024`,
      suburb: "Bronte",
      description: null,
      kind: "Install",
      hue: "orange" as const,
      plansRead: false,
    }));
    const lists = (): JobLists & { recent: jest.Mock; list: jest.Mock } => ({
      recent: jest.fn(async (ids: string[]) => JOBS.filter((j) => ids.includes(j.remoteId))),
      list: jest.fn(async (from: number, limit: number) => [JOBS[0], ...more].slice(from, from + limit)),
    });

    it("shows the jobs last opened here, then the newest, each a job card", async () => {
      window.localStorage.setItem("heytiff.jobs.opened", JSON.stringify(["j-3151"]));
      const user = userEvent.setup();
      const from = lists();
      render(studio(async () => JOBS, true, from));

      await user.click(await screen.findByText("New design"));
      const recent = await screen.findByRole("list", { name: "Recent jobs" });
      expect(from.recent).toHaveBeenCalledWith(["j-3151"]);
      expect(within(recent).getByRole("button", { name: WALLACE })).toHaveClass("sc-card--purple");

      const all = await screen.findByRole("list", { name: "All jobs" });
      expect(from.list).toHaveBeenCalledWith(0, 6);
      // a job in Recent isn't said again under All jobs
      expect(within(all).queryByRole("button", { name: WALLACE })).toBeNull();
      expect(within(all).getAllByRole("button")).toHaveLength(5);
      expect(within(all).getByRole("button", { name: "3500, Client 3500, 1 Test St, Bronte" })).toHaveClass("sc-card--orange");

      await user.click(within(recent).getByRole("button", { name: WALLACE }));
      expect(screen.getByPlaceholderText(/Design name/)).toHaveValue("12/3 Wallace St");
    });

    it("Show more brings the next lot, and goes when there are no more", async () => {
      const user = userEvent.setup();
      const from = lists();
      render(studio(async () => JOBS, true, from));

      await user.click(await screen.findByText("New design"));
      const all = await screen.findByRole("list", { name: "All jobs" });
      expect(screen.queryByRole("list", { name: "Recent jobs" })).toBeNull();
      expect(within(all).getAllByRole("button")).toHaveLength(6);

      await user.click(screen.getByRole("button", { name: "Show more" }));
      await waitFor(() => expect(within(all).getAllByRole("button")).toHaveLength(15));
      expect(from.list).toHaveBeenLastCalledWith(6, 12);
      // nine came where twelve were asked for: that's all of them
      expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    });

    it("what's typed replaces both lists, and clearing it brings them back", async () => {
      window.localStorage.setItem("heytiff.jobs.opened", JSON.stringify(["j-3151"]));
      const user = userEvent.setup();
      render(studio(async () => [JOBS[1]], true, lists()));

      await user.click(await screen.findByText("New design"));
      await screen.findByRole("list", { name: "Recent jobs" });
      await user.type(screen.getByLabelText(FIELD), "birrell");
      const found = await screen.findByRole("list", { name: "Jobs found" });
      expect(within(found).getAllByRole("button")).toHaveLength(1);
      expect(screen.getByText("1 job")).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "Recent jobs" })).toBeNull();
      expect(screen.queryByRole("list", { name: "All jobs" })).toBeNull();

      await user.clear(screen.getByLabelText(FIELD));
      expect(screen.getByRole("list", { name: "Recent jobs" })).toBeInTheDocument();
      expect(screen.getByRole("list", { name: "All jobs" })).toBeInTheDocument();
    });
  });

  /* THE RACE. Every keystroke fires its own request, so a slow early one can
     land after a fast later one. Without the sequence guard the list would
     end up showing the answer to a question that is no longer on screen —
     and the card you click is then the wrong job. */
  it("never lets a slow early answer overwrite a newer one", async () => {
    const user = userEvent.setup();
    const release: Array<() => void> = [];
    const search: JobSearch = (q) =>
      new Promise((resolve) => {
        release.push(() => resolve(q === "bo" ? [JOBS[1]] : [JOBS[0]]));
      });

    render(studio(search));
    await user.click(await screen.findByText("New design"));

    await user.type(screen.getByLabelText(FIELD), "bo"); // the slow one
    await user.type(screen.getByLabelText(FIELD), "ndi wallace"); // what's now typed
    // one request per keystroke from the second character on
    await waitFor(() => expect(release.length).toBeGreaterThan(5));

    // the newest answers first, then the stale "bo" lands late
    release[release.length - 1]();
    await screen.findByText("12/3 Wallace St, Waverley");
    release[0]();

    /* GIVE THE STALE ANSWER ITS CHANCE, then assert once. A `waitFor(...toBeNull)`
       here is a test that always passes: it succeeds on the first tick, before
       the late answer has landed. */
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByText("260 Birrell St, Bondi Junction")).toBeNull();
    expect(screen.getByText("12/3 Wallace St, Waverley")).toBeInTheDocument();
  });
});

/* ARRIVING ON A NAMED DESIGN — `?design=<id>`, which is what the Workboard's
   job sheet links to now that a design says which job it is for. */
describe("opening a design by id", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/dashboard/studio");
  });

  const seed = async (name: string) => {
    const store = new LocalDesignStore(window.localStorage);
    const doc = createDesign({ name, mode: "blank" });
    await store.save(doc);
    return doc.id;
  };

  it("opens that design instead of landing on Home", async () => {
    const id = await seed("12/3 Wallace St");
    render(
      <Studio store={new LocalDesignStore(window.localStorage)} openDesignId={id} />
    );

    // straight into the canvas — no Home, no swap to sit through
    expect(await screen.findByLabelText("Design name")).toHaveValue("12/3 Wallace St");
    expect(screen.getByTestId("studio-canvas")).toBeInTheDocument();
  });

  /* The studio's state is all client-side, so a bare /dashboard/studio in the
     address bar means any reload lands on Home with the design nowhere in
     sight. The id stays in the URL for exactly that reason. */
  it("keeps the parameter, so a reload comes back to the design", async () => {
    const id = await seed("Farran St");
    window.history.replaceState(null, "", `/dashboard/studio?design=${id}`);
    render(
      <Studio store={new LocalDesignStore(window.localStorage)} openDesignId={id} />
    );

    await screen.findByTestId("studio-canvas");
    expect(new URLSearchParams(window.location.search).get("design")).toBe(id);
    expect(window.location.pathname).toBe("/dashboard/studio");
  });

  /* Opening from Home writes it too — the whole point is that the URL always
     names what is on screen, however you got there. */
  it("names the design in the URL when one is opened from Home", async () => {
    const user = userEvent.setup();
    const id = await seed("Bourke St");
    render(<Studio store={new LocalDesignStore(window.localStorage)} />);

    await user.click(await screen.findByText("Bourke St"));

    await screen.findByTestId("studio-canvas");
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get("design")).toBe(id)
    );
  });

  /* And it goes when you do. Leaving it behind was the reason it used to be
     stripped on arrival: a stale id would drag you back into a design you had
     deliberately closed. */
  it("drops the parameter on the way back to Home", async () => {
    const user = userEvent.setup();
    const id = await seed("Iris St");
    window.history.replaceState(null, "", `/dashboard/studio?design=${id}`);
    render(
      <Studio store={new LocalDesignStore(window.localStorage)} openDesignId={id} />
    );
    await screen.findByTestId("studio-canvas");

    await user.click(screen.getByLabelText("Studio menu"));
    await user.click(screen.getByText("Open"));

    await screen.findByText("New design");
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  /* A dead link is a dead door: the design may have been deleted since the
     job sheet was drawn, and silently landing on Home leaves you unable to
     tell whether the link was broken or you were. */
  it("says so when the design is no longer there", async () => {
    render(
      <Studio
        store={new LocalDesignStore(window.localStorage)}
        openDesignId="dsn_gone"
      />
    );

    expect(await screen.findByText(/That design is no longer here/)).toBeInTheDocument();
    expect(screen.getByText("New design")).toBeInTheDocument();
  });

  it("lands on Home as usual when no design was named", async () => {
    await seed("Farran St");
    render(<Studio store={new LocalDesignStore(window.localStorage)} />);

    expect(await screen.findByText("New design")).toBeInTheDocument();
    expect(screen.queryByTestId("studio-canvas")).toBeNull();
    expect(screen.queryByText(/no longer here/)).toBeNull();
  });
});
