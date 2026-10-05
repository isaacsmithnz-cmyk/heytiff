jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));
jest.mock("@/lib/studio/packs/server", () => ({}));
jest.mock("../proposal-writer", () => ({}));

import { acceptedChange } from "../accepted-materials-server";

/* Isaac, 2026-10-05: "whichever one is accepted as an option will then turn
   into the materials list for the job" */
const row = (name: string, sub = "") => ({ name, sub, qty: "1" });

it("puts the accepted option's rows on, gives way only its rivals' unpicked rows, and keeps what a person added or picked", () => {
  const accepted = [row("MXZ-4F71VGD", "Multi outdoor unit"), row("Isolator", "the multi")];
  const every = [...accepted, row("MUZ-AP25VG2", "Outdoor unit, Bed 1"), row("Wall bracket", "Bed 1")];
  const onJob = [
    { id: "a", name: "MUZ-AP25VG2", sub: "Outdoor unit, Bed 1", picked: false },
    { id: "b", name: "Wall bracket", sub: "Bed 1", picked: true },
    { id: "c", name: "Silicone", sub: "", picked: false },
    { id: "d", name: "Isolator", sub: "the multi", picked: false },
  ];
  const { remove, add } = acceptedChange(accepted, every, onJob);
  /* the other option's unpicked outdoor goes; its picked bracket and the hand-added silicone stay */
  expect(remove).toEqual(["a"]);
  /* the isolator is there already; only the outdoor goes on */
  expect(add.map((r) => r.name)).toEqual(["MXZ-4F71VGD"]);
});
