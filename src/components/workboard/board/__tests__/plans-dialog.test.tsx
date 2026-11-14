import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JobPlanRead } from "@/lib/jobs/plans";
import { PlansDialog } from "../plans-dialog";

/* PLANS from a design's Edit plans (plans-dialog.tsx): the job's sets,
   ticked where the design uses them, each page's floor in a menu, Add plans
   onto the job, and Save plans with what changed and what's ticked. */

const plan = (id: string, over: Partial<JobPlanRead> = {}): JobPlanRead => ({
  id,
  jobUuid: "job-1",
  documentId: "d1",
  attachmentId: null,
  name: `${id}.pdf`,
  sourceRef: null,
  sourceKind: "pdf",
  pageCount: 2,
  pages: [
    { n: 1, kind: "floor", name: "Ground floor", level: 0, ref: `org/o/${id}1.png`, preview: "x", width: 10, height: 10, mmPerPx: 10, scale: "1:100" },
    { n: 2, kind: "floor", name: "Level 1", level: 1, ref: `org/o/${id}2.png`, preview: "x", width: 10, height: 10, mmPerPx: 10, scale: "1:100" },
  ],
  reading: { at: "2026-11-11T00:00:00Z", model: "m", floors: {}, failed: [] },
  state: "read",
  said: null,
  addedBy: null,
  addedAt: "2026-11-11T00:00:00Z",
  readAt: "2026-11-11T00:00:00Z",
  thumbs: { 1: "https://example.invalid/1.jpg", 2: "https://example.invalid/2.jpg" },
  usedBy: 1,
  ...over,
});

it("ticks the design's plans, says they're the job's, and saves a floor changed and the ticks", async () => {
  const onSave = jest.fn(async () => null);
  const onClose = jest.fn();
  render(<PlansDialog plans={[plan("g"), plan("f")]} jobNumber="3465" ticked={["g"]} onSave={onSave} onClose={onClose} />);
  const dialog = screen.getByRole("dialog", { name: "Plans" });
  expect(within(dialog).getByRole("checkbox", { name: "Use g.pdf" })).toBeChecked();
  expect(within(dialog).getByRole("checkbox", { name: "Use f.pdf" })).not.toBeChecked();
  expect(dialog).toHaveTextContent("In job 3465's Plans");
  const [, level1] = within(dialog).getAllByRole("combobox", { name: "Floor of page 2" });
  await userEvent.click(level1);
  const menu = await screen.findByRole("listbox");
  expect(within(menu).getAllByRole("option").map((o) => o.textContent)).toEqual(["Basement 1", "Ground floor", "Level 1", "Level 2", "Not a floor plan"]);
  await userEvent.click(within(menu).getByRole("option", { name: "Level 2" }));
  await userEvent.click(within(dialog).getByRole("checkbox", { name: "Use f.pdf" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Save plans" }));
  expect(onSave).toHaveBeenCalledWith({ f: { 2: "2" } }, ["g", "f"]);
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

it("adds plans to the job, ticks one once it's read, and keeps the dialog open on a failed save", async () => {
  const onAdd = jest.fn(async () => null);
  const onSave = jest.fn(async () => "The floors couldn't be saved. Try again.");
  const onClose = jest.fn();
  const { rerender } = render(<PlansDialog plans={[plan("g")]} ticked={["g"]} onAdd={onAdd} onSave={onSave} onClose={onClose} />);
  const file = new File(["%PDF"], "issue-h.pdf", { type: "application/pdf" });
  await userEvent.upload(screen.getByLabelText("Choose plans to add to the job"), file);
  expect(onAdd).toHaveBeenCalledWith([file]);
  rerender(<PlansDialog plans={[plan("h", { state: "reading", pages: [], thumbs: {} }), plan("g")]} ticked={["g"]} onAdd={onAdd} onSave={onSave} onClose={onClose} />);
  expect(screen.getByRole("checkbox", { name: "Use h.pdf" })).toBeDisabled();
  expect(screen.getByText("Reading the plans")).toBeInTheDocument();
  rerender(<PlansDialog plans={[plan("h"), plan("g")]} ticked={["g"]} onAdd={onAdd} onSave={onSave} onClose={onClose} />);
  expect(screen.getByRole("checkbox", { name: "Use h.pdf" })).toBeChecked();
  await userEvent.click(screen.getByRole("button", { name: "Save plans" }));
  expect(onSave).toHaveBeenCalledWith({}, ["h", "g"]);
  expect(await screen.findByRole("alert")).toHaveTextContent("The floors couldn't be saved. Try again.");
  expect(onClose).not.toHaveBeenCalled();
});
