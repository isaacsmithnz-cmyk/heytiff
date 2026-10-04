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
      runM: null,
      outdoorAt: null,
      drain: null,
      newCircuit: null,
      options: [
        { indoor: "MSZ-AP50VGD2", outdoor: "MUZ-AP50VG2", style: "Wall", coolKw: 5, heatKw: 6, liquidMm: 6.35, gasMm: 12.7, outdoorWidthMm: 840, outdoorWeightKg: 53, outdoorAmps: 16 },
      ],
    },
  ],
  dropped: ["Bed 3"],
  buildingType: "residential",
  buildingSaid: true,
  zone: { zone: 5, from: "address", town: "Riverview" },
  multi: null,
  ducted: null,
  swap: { replacing: false, keepPipe: false },
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
  expect(screen.getByText("To ask: goes on as Run to ask")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Add to materials" }));
  expect(addJobPicklistItem).toHaveBeenCalledWith("j-1", { kind: "material", name: "MSZ-AP50VGD2", qty: "1", sub: "Wall indoor unit, Living" });
  expect(addJobPicklistItem).toHaveBeenCalledWith("j-1", { kind: "material", name: "MUZ-AP50VG2", qty: "1", sub: "Outdoor unit, Living" });
  expect(addJobPicklistItem).toHaveBeenCalledWith("j-1", { kind: "material", name: "ø6.35 / ø12.7 pair coil", qty: "Run to ask", sub: "liquid / gas mm, Living" });
  expect(addJobPicklistItem).toHaveBeenCalledWith("j-1", { kind: "material", name: "Isolator", qty: "1", sub: "for the outdoor's 16 A, Living" });
  /* nobody said where the outdoor sits: it goes on to ask */
  expect(addJobPicklistItem).toHaveBeenCalledWith("j-1", { kind: "material", name: "Outdoor mount", qty: "Where it sits: ask", sub: "Living" });
  expect(addJobPicklistItem).toHaveBeenCalledWith("j-1", { kind: "material", name: "Consumables", qty: "1", sub: "a head, Living" });
  expect(onAdded).toHaveBeenCalled();
  expect(await screen.findByRole("button", { name: "Added" })).toBeDisabled();
});

it("takes a pipe run typed for the room over the brief's", async () => {
  addJobPicklistItem.mockClear();
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ json: async () => ({ ok: true, rooms }) }));
  render(<JobQuoteRooms job="j-1" onAdded={jest.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Size the rooms from the brief" }));
  await userEvent.type(await screen.findByLabelText("Pipe run for Living, metres"), "8");
  await userEvent.selectOptions(screen.getByLabelText("Where Living's outdoor sits"), "wall");
  expect(screen.getByText("Typed here")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Add to materials" }));
  expect(addJobPicklistItem).toHaveBeenCalledWith("j-1", { kind: "material", name: "ø6.35 / ø12.7 pair coil", qty: "8 m", sub: "liquid / gas mm, Living" });
  expect(addJobPicklistItem).toHaveBeenCalledWith("j-1", { kind: "material", name: "Wall bracket", qty: "1", sub: "for the outdoor's 840 mm, 53 kg, Living" });
  expect(addJobPicklistItem).toHaveBeenCalledWith("j-1", { kind: "material", name: "Pipe cover", qty: "8 m", sub: "along the run, Living" });
});

it("shows one ducted system for the rooms — its pair, the brief's outlets and ductwork, what to ask — and adds it whole", async () => {
  addJobPicklistItem.mockClear();
  const ducted: BriefRooms = {
    ...rooms,
    rooms: [rooms.rooms[0]!, { ...rooms.rooms[0]!, name: "Dining", said: "dining 15m2", areaM2: 15, loadKw: 2.2 }],
    ducted: {
      read: {
        ducted: true,
        unitAt: "roof",
        unitSaid: "Unit in the roof",
        outlets: [{ room: "", count: 2, type: "mdo", neckMm: 250, lengthMm: null, heightMm: null, flangeless: false, said: "2 mdo" }],
        outletsUnsure: null,
        returns: [],
        layout: [{ piece: "fitting", inMm: 350, outsMm: [250, 250], count: 1, said: "split to 14/10/10" }],
        zoning: null,
        run: { m: 15, said: "run 15m" },
        outdoor: { at: "wall", said: "on the side wall" },
        drain: { how: null, said: null },
        circuit: { needed: null, said: null },
      },
      dropped: [],
      loadKw: 6.6,
      options: [{ indoor: "PEAD-M71JAA(D)", outdoor: "SUZ-M71VAD-A", coolKw: 7.1, heatKw: 8, airflowLs: 417, liquidMm: 9.52, gasMm: 15.88, outdoorWidthMm: 800, outdoorWeightKg: 50, outdoorAmps: 16 }],
      air: [],
    },
  };
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ json: async () => ({ ok: true, rooms: ducted }) }));
  const onAdded = jest.fn();
  render(<JobQuoteRooms job="j-1" onAdded={onAdded} />);
  await userEvent.click(screen.getByRole("button", { name: "Size the rooms from the brief" }));
  expect(await screen.findByText("One ducted system for the 2 rooms")).toBeInTheDocument();
  expect(screen.getByText("6.6 kW together")).toBeInTheDocument();
  /* a ducted brief's rooms aren't offered a split each */
  expect(screen.queryByLabelText("Pipe run for Living, metres")).toBeNull();
  expect(screen.getByText("Ductwork, as the brief has it: “split to 14/10/10”")).toBeInTheDocument();
  expect(screen.getByText(/^To ask: .*the return: where and what size/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Add to materials" }));
  const names = addJobPicklistItem.mock.calls.map((c) => (c as unknown as [string, { name: string; qty: string }])[1].name);
  expect(names).toEqual(expect.arrayContaining(["PEAD-M71JAA(D)", "SUZ-M71VAD-A", "MDO, Ø250 neck", "Fitting Ø350 → Ø250 / Ø250", "Return grille", "Hanging kit"]));
  expect(onAdded).toHaveBeenCalled();
});

it("applies a swap ticked here: the old system recovered, the kept pipe flushed", async () => {
  addJobPicklistItem.mockClear();
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ json: async () => ({ ok: true, rooms }) }));
  render(<JobQuoteRooms job="j-1" onAdded={jest.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "Size the rooms from the brief" }));
  await userEvent.click(await screen.findByLabelText("Old system out"));
  await userEvent.click(screen.getByLabelText("Keeping the pipe"));
  await userEvent.click(screen.getByRole("button", { name: "Add to materials" }));
  const names = addJobPicklistItem.mock.calls.map((c) => (c as unknown as [string, { name: string }])[1].name);
  expect(names).toEqual(expect.arrayContaining(["Pipe flush", "Recovery and removal"]));
  expect(names.some((n) => /pair coil/.test(n))).toBe(false);
});
