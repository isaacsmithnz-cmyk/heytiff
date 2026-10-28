import type { VehicleIdentity } from "@/components/fleet/logic";

export type VehicleChoice = { id: string; name: string; odometer: number; offroad: boolean };

/** The vehicles fuel or a reading can go on: yours first, then the rest by name. Sold ones never. */
export function choicesOf(picker: readonly VehicleIdentity[], ownId: string | null): VehicleChoice[] {
  const usable = picker.filter((v) => v.status !== "sold");
  return [...usable.filter((v) => v.id === ownId), ...usable.filter((v) => v.id !== ownId)].map((v) => ({
    id: v.id,
    name: [v.plate?.trim().toUpperCase(), [v.make, v.model].filter((x) => x && x.trim()).join(" ")].filter(Boolean).join(", ") || v.name,
    odometer: v.odometer,
    offroad: v.status === "offroad",
  }));
}
