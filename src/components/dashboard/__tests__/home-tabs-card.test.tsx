import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DashboardHome } from "../home";
import type { DashboardData } from "@/lib/dashboard/page-data";
import type { ActionChip } from "@/lib/dashboard/chips";

/* Home as one card with five faces.

   The Tiff button reaches the note flow and its server actions, and
   "use server" modules cannot be imported into jsdom. Stubbed so this suite
   stays about the card; the button has its own. */
jest.mock("@/components/notes/tiff-button", () => ({
  TiffButton: () => <button aria-label="Ask or tell Tiff" />,
}));
jest.mock("@/components/notes/note-token", () => ({
  NoteToken: () => <button aria-label="Debrief" />,
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("@/app/actions/dashboard", () => ({
  completeTask: jest.fn(),
  createTask: jest.fn(),
  reopenTask: jest.fn(),
}));

const TODAY = "2026-08-10";

const chip = (state: "bad" | "warn", key: string): ActionChip => ({
  key,
  kind: "rego",
  state,
  label: state === "bad" ? "Rego expired 4 days ago" : "Rego expires in 2 weeks",
  subject: "Hilux ute",
  href: "/dashboard/assets",
  urgency: state === "bad" ? -4 : 10_014,
});

const data = (over: Partial<DashboardData> = {}): DashboardData => ({
  chips: { self: [], team: [] },
  roster: null,
  money: [],
  tasks: { mine: [], team: null, done: [], reported: [] },
  notices: [],
  journal: [],
  assignable: [],
  canManage: false,
  viewerStaffId: "s1",
  today: TODAY,
  ...over,
});

const draw = (over: Partial<DashboardData> = {}) => render(<DashboardHome data={data(over)} />);
const tab = (name: RegExp) => screen.getByRole("tab", { name });
const panel = (key: string) => document.getElementById(`hmsec-${key}`)!;

describe("the card", () => {
  it("lands on Journal — the other four say for themselves whether they want you", () => {
    draw();
    expect(tab(/Journal/)).toHaveAttribute("aria-selected", "true");
    expect(panel("journal")).not.toHaveAttribute("hidden");
  });

  it("shows exactly ONE panel at a time", async () => {
    /* THE BUG THIS EXISTS FOR. `.wb2-urbody.twocol` sets `display:grid` and is
       (0,2,0); a plain `.wb2-body[hidden]` is (0,2,0) too and loses on source
       order, so the Tasks panel stayed painted underneath whichever tab was
       open. The stylesheet answers that at (0,3,0); this pins the markup side
       — every non-active panel carries `hidden`, so nothing but CSS
       specificity could ever put two on screen. */
    const user = userEvent.setup();
    const keys = ["journal", "urgent", "attention", "board", "tasks"];
    const shown = () => keys.filter((k) => !panel(k).hasAttribute("hidden"));

    draw({ tasks: { mine: [], team: null, done: [], reported: [] } });
    expect(shown()).toEqual(["journal"]);

    await user.click(tab(/Tasks/));
    expect(shown()).toEqual(["tasks"]);

    await user.click(tab(/Urgent/));
    expect(shown()).toEqual(["urgent"]);
  });

  it("wires each tab to the panel it controls", () => {
    draw();
    for (const k of ["journal", "urgent", "attention", "board", "tasks"]) {
      const t = document.getElementById(`hmtab-${k}`)!;
      expect(t).toHaveAttribute("aria-controls", `hmsec-${k}`);
      expect(panel(k)).toHaveAttribute("aria-labelledby", `hmtab-${k}`);
    }
  });
});

describe("the badges", () => {
  it("carry the counts, so a hidden tab still says whether it wants you", () => {
    /* The whole reason Journal can be the landing tab. A tab hides its content
       by definition; if the number went with it, the glance the counters
       existed for would be gone. */
    draw({
      chips: { self: [chip("bad", "a"), chip("warn", "b")], team: [] },
      tasks: { mine: [], team: null, done: [], reported: [] },
    });
    expect(within(tab(/Urgent/)).getByText("1")).toBeInTheDocument();
    expect(within(tab(/Needs attention/)).getByText("1")).toBeInTheDocument();
  });

  it("say what the number means, for anyone who can't see the tint", () => {
    draw({ chips: { self: [chip("bad", "a")], team: [] } });
    expect(tab(/Urgent/).textContent).toContain("past its date");
  });

  it("are absent on a clear day rather than showing a grey 0", () => {
    draw();
    for (const name of [/Urgent/, /Needs attention/, /Noticeboard/, /Tasks/]) {
      expect(tab(name).querySelector(".wb2-vtn")).toBeNull();
    }
  });
});

describe("the panels", () => {
  it("says what it checked when a view is empty, not just that it is", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(tab(/Urgent/));
    expect(panel("urgent").textContent).toMatch(/Nothing is past its date/);
  });

  it("renders the urgent chips as rows, worst first", async () => {
    const user = userEvent.setup();
    draw({ chips: { self: [chip("warn", "w"), chip("bad", "b")], team: [] } });
    await user.click(tab(/Urgent/));
    // only the bad one — warn belongs to the other tab, and the two split one list
    const rows = panel("urgent").querySelectorAll(".hm-row");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Rego expired 4 days ago");
    expect(rows[0]).toHaveAttribute("data-sev", "over");
  });
});

describe("Tiff", () => {
  it("sits in the tab row, so a debrief is one press from every face", () => {
    /* Not inside the Journal panel: the capture slot at the row's right end is
       where the board puts its own, and putting it there means you never have
       to change tabs to say something. */
    draw();
    const btn = screen.getByLabelText("Ask or tell Tiff");
    expect(btn.closest(".wb2-vtcap")).not.toBeNull();
    expect(btn.closest(".wb2-vtabs")).not.toBeNull();
  });
});

describe("the strip under the card", () => {
  it("is absent entirely without the capabilities that fill it", () => {
    // roster needs `team`, payroll needs `financials`; the loader returns null
    // and [] without them, and an empty shell is worse than no shell
    draw();
    expect(document.querySelector(".hm-strip")).toBeNull();
  });

  it("appears when there is something in it", () => {
    draw({
      roster: {
        onLeave: [{ staffId: "s2", name: "Dane Whitcombe", kind: "annual", label: "Annual leave" }],
        publicHoliday: null,
      },
    });
    expect(document.querySelector(".hm-strip")).not.toBeNull();
    expect(screen.getByText("Dane Whitcombe")).toBeInTheDocument();
  });
});
