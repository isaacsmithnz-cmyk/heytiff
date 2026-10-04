import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const addJobPicklistItem = jest.fn(async () => ({}));
jest.mock("@/app/actions/job-picklist", () => ({ addJobPicklistItem: (...a: unknown[]) => addJobPicklistItem(...(a as [])) }));

import { JobQuoteRooms } from "../job-quote-rooms";
import type { BriefRooms } from "@/lib/quotes/brief-rooms-server";

/* Isaac, 2026-10-04: "What if I said the room is 30m2?" */
const rooms: BriefRooms = {
  read: [],
  rooms: [
    {
      name: "Living",
      said: "living room, room is 30m2",
      areaM2: 30,
      loadKw: 4.4,
      assumed: ["the ceiling height"],
      style: "wall",
      options: [{ indoor: "MSZ-AP50VGD2", outdoor: "MUZ-AP50VG2", style: "Wall", coolKw: 5, heatKw: 6 }],
    },
  ],
  dropped: ["Bed 3"],
  buildingType: "residential",
  buildingSaid: true,
  zone: { zone: 5, from: "address", town: "Riverview" },
};

it("reads the rooms on a press, sizes them, and puts a pair on the job only when a person adds it", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ json: async () => ({ ok: true, rooms }) }));
  const onAdded = jest.fn();
  render(<JobQuoteRooms job="j-1" onAdded={onAdded} />);
  expect(addJobPicklistItem).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Size the rooms from the brief" }));
  expect(await screen.findByText("Living, 30 m²")).toBeInTheDocument();
  expect(screen.getByText("4.4 kW")).toBeInTheDocument();
  expect(screen.getByText("“living room, room is 30m2”")).toBeInTheDocument();
  expect(screen.getByText("Counted as standard, to ask: the ceiling height.")).toBeInTheDocument();
  expect(screen.getByText("From the address, Riverview")).toBeInTheDocument();
  expect(screen.getByText("Not used, their size isn't in the brief's words: Bed 3.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Add to materials" }));
  expect(addJobPicklistItem).toHaveBeenCalledWith("j-1", { kind: "material", name: "MSZ-AP50VGD2", qty: "1", sub: "Wall indoor unit, Living" });
  expect(addJobPicklistItem).toHaveBeenCalledWith("j-1", { kind: "material", name: "MUZ-AP50VG2", qty: "1", sub: "Outdoor unit, Living" });
  expect(onAdded).toHaveBeenCalled();
  expect(await screen.findByRole("button", { name: "Added" })).toBeDisabled();
});
