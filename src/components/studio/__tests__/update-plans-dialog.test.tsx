import { fireEvent, render, screen, within } from "@testing-library/react";
import type { JobPlan } from "@/lib/jobs/plans";
import type { PlanUpdate } from "@/lib/studio/update-plans";
import { NewerPlansRow, UpdatePlansDialog } from "../update-plans-dialog";

/* UPDATE PLANS, the screen (update-plans-dialog.tsx): the row that says a
   newer set is on the job, and the dialog that takes it with its ticks. */

const plan = (name: string, addedAt: string) => ({ id: name, name, addedAt }) as JobPlan;
const update: PlanUpdate = {
  plan: plan("Issue H.pdf", "2026-12-02T00:00:00Z"),
  was: plan("Issue G.pdf", "2026-11-01T00:00:00Z"),
  pages: [{ n: 4, title: "First floor, page 4", lines: ["Study is Bedroom 05 now, 9.1 m² with a window to the north", "Ensuite is new, 4.0 m²"] }],
  offers: [
    { id: "obj_study", title: "Study becomes Bedroom 05", line: "Its outline and windows off First floor, page 4. Its load goes from 1.5 kW to 1.6 kW" },
    { id: "new:4:3", title: "Mark Ensuite", line: "New on First floor, page 4. Its load is 0.6 kW" },
  ],
  said: [{ title: "Bedroom 01 isn't on the new plans", line: "It stays as you drew it" }],
  kept: [],
};

describe("Update plans", () => {
  it("says the newer set and how many sheets changed, and opens on its button", () => {
    const open = jest.fn();
    render(<NewerPlansRow plan={update.plan} was={update.was} changed={2} onOpen={open} />);
    expect(screen.getByText("Issue H.pdf is in the job's Plans")).toBeTruthy();
    expect(screen.getByText("2 sheets changed from Issue G.pdf")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Update plans" }));
    expect(open).toHaveBeenCalled();
  });

  it("lists what the plans changed and what it does, and takes only what's left ticked", () => {
    const take = jest.fn();
    render(<UpdatePlansDialog update={update} onUpdate={take} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/^Issue H\.pdf, added .*, against Issue G\.pdf, which this design was drawn from\.$/)).toBeTruthy();
    const changed = within(dialog).getByRole("list", { name: "What the plans changed" });
    expect(within(changed).getByText("First floor, page 4")).toBeTruthy();
    expect(within(changed).getByText("Study is Bedroom 05 now, 9.1 m² with a window to the north. Ensuite is new, 4.0 m²")).toBeTruthy();
    const does = within(dialog).getByRole("list", { name: "What it does to the design" });
    expect(within(does).getByText("Bedroom 01 isn't on the new plans")).toBeTruthy();
    expect(within(does).getByText("The supplied scope takes Issue H.pdf")).toBeTruthy();
    fireEvent.click(within(does).getByRole("checkbox", { name: "Mark Ensuite" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Update plans" }));
    expect([...take.mock.calls[0][0]]).toEqual(["obj_study"]);
  });

  it("keeps what was set by hand, each with Use the plans'", () => {
    const onUpdate = jest.fn();
    const kept = { id: "plans:obj_hall", title: "Grand Hall height 6.4 m", line: "You set it in the design. Issue H.pdf has Grand Hall height 3.2 m" };
    render(<UpdatePlansDialog update={{ ...update, kept: [kept] }} onUpdate={onUpdate} onClose={() => {}} />);
    const list = screen.getByRole("list", { name: "Kept as you set them" });
    expect(within(list).getByText("Grand Hall height 6.4 m")).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "Use the plans'" }));
    expect(within(list).getByRole("button", { name: "Keep mine" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Update plans" }));
    expect([...onUpdate.mock.calls[0][0]]).toEqual(["obj_study", "new:4:3", "plans:obj_hall"]);
  });
});
