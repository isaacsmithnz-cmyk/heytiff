import { render, screen, within } from "@testing-library/react";
import { JobScope } from "../job-scope";
import type { JobScopeRead } from "@/lib/jobs/job-scope";

/* The scope at the top of a job's Overview, as a written brief (layout B,
   Isaac, 28 October 2026), and its latest updates. */

const scope = (over: Partial<JobScopeRead> = {}): JobScopeRead => ({
  lede: "Four systems for the Carney Residence, from Anna Vaughan Architects' tender set (30 Sep).",
  systems: [
    { area: "Ground floor", kind: "ducted, under the floor", text: "Living/Dining, Kids Play, Guest Bed. Fan coil under the living room.", from: ["A200", "A202"] },
    { area: "Studio", kind: "split system", text: "Living and bedroom. No size given.", from: [] },
  ],
  added: [{ text: "Exhaust fans in the three bathrooms", from: "The builder's call, 28 Oct" }],
  notOurs: ["Solar panels off and back on", "Hot water and the pool heat pump"],
  clarify: [{ q: "Who removes the old units?", who: "Builder" }],
  updates: [{ on: "Wed 28 Oct", from: "Isaac Smith, the builder's call", said: "Added exhaust fans in the three bathrooms." }],
  stamp: "s",
  writtenAt: "2026-10-28T04:00:00Z",
  ...over,
});

it("reads as a brief: a heading and paragraph per system, its sources after it", () => {
  render(<JobScope scope={scope()} />);
  const s = screen.getByRole("region", { name: "Scope" });
  expect(within(s).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
    "Ground floor: ducted, under the floor",
    "Studio: split system",
    "Added",
    "Not ours",
    "To clarify",
  ]);
  expect(s).toHaveTextContent("Living/Dining, Kids Play, Guest Bed. Fan coil under the living room.A200, A202");
  expect(s).toHaveTextContent("Solar panels off and back on; Hot water and the pool heat pump");
  expect(within(s).getByText("Exhaust fans in the three bathrooms", { exact: false }).closest("li")).toHaveTextContent("Exhaust fans in the three bathroomsThe builder's call, 28 Oct");
});

it("numbers what's still to clarify and says who answers it", () => {
  render(<JobScope scope={scope()} />);
  expect(screen.getByText("Who removes the old units?").closest("li")).toHaveTextContent("1Who removes the old units?Builder");
});

it("lists the latest updates under it, and leaves out what it hasn't got", () => {
  const { unmount } = render(<JobScope scope={scope()} />);
  expect(screen.getByRole("region", { name: "Latest updates" })).toHaveTextContent("Wed 28 OctIsaac Smith, the builder's callAdded exhaust fans in the three bathrooms.");
  unmount();
  render(<JobScope scope={scope({ added: [], notOurs: [], clarify: [], updates: [] })} />);
  expect(screen.queryByRole("region", { name: "Latest updates" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Added" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "To clarify" })).toBeNull();
});
