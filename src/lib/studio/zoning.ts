/* Design Studio — zoning a ducted unit (Isaac, 2026-10-28: "build in some
   zone dampers. And controllers and sensors", then "Yes, build both" on
   mock Q6KqNgu5…).

   Zoning is set on the unit: Off, On/off, or Temperature. Once on, every
   room the unit serves is a zone of its own until the person joins rooms
   into one (the same ticks as rooms on a unit). From the zones:

   - DAMPERS: one on each run that feeds a single zone (ductwork.ts places
     them, sized to their run);
   - SENSORS: one a zone under temperature control, on a wall in the zone's
     first room, wireless or wired;
   - THE CONTROLLER: one a system, on a wall near the unit;
   - THE KIT: from the brand's pack (§10 zoning_controllers) — the smallest
     interface for the control and the zone count, its main controller, a
     receiver for wireless sensors, the sensors and their batteries — or,
     for a brand whose pack has none, plain lines the price book prices;
   - SPILL: a zone the person names to take the air when others shut.

   Kept on the system by unit (`settings.zoning`). Pure — no React. */

import type { DesignDocument, DesignSystem } from "./document";
import type { DataPack, ZoningController } from "./packs/schema";
import type { UnitAir } from "./airflow";

export type ZoneControl = "off" | "on_off" | "temperature";
export type SensorKind = "wireless" | "wired";

export interface UnitZoning {
  control: ZoneControl;
  sensors: SensorKind;
  /** a room joined to another's zone: room → the zone's first room */
  joined: Record<string, string>;
  /** the zone that takes the air when others shut, by its key */
  spill: string | null;
}

export interface Zone {
  /** its first room's id */
  key: string;
  /** "Z1" */
  label: string;
  roomIds: string[];
  name: string;
}

const OFF: UnitZoning = { control: "off", sensors: "wireless", joined: {}, spill: null };

/** a unit's zoning, as set */
export function zoningOf(sys: DesignSystem, unitId: string): UnitZoning {
  const all = sys.settings.zoning;
  const raw = all && typeof all === "object" && !Array.isArray(all) ? (all as Record<string, unknown>)[unitId] : null;
  if (!raw || typeof raw !== "object") return OFF;
  const z = raw as Record<string, unknown>;
  const joined: Record<string, string> = {};
  if (z.joined && typeof z.joined === "object" && !Array.isArray(z.joined)) {
    for (const [k, v] of Object.entries(z.joined as Record<string, unknown>)) if (typeof v === "string" && v !== k) joined[k] = v;
  }
  return {
    control: z.control === "on_off" || z.control === "temperature" ? z.control : "off",
    sensors: z.sensors === "wired" ? "wired" : "wireless",
    joined,
    spill: typeof z.spill === "string" ? z.spill : null,
  };
}

/** the system with one unit's zoning changed */
export function setZoning(doc: DesignDocument, systemId: string, unitId: string, change: Partial<UnitZoning>): DesignDocument {
  return {
    ...doc,
    systems: doc.systems.map((s) => {
      if (s.id !== systemId) return s;
      const all = s.settings.zoning && typeof s.settings.zoning === "object" ? (s.settings.zoning as Record<string, unknown>) : {};
      return { ...s, settings: { ...s.settings, zoning: { ...all, [unitId]: { ...zoningOf(s, unitId), ...change } } } };
    }),
  };
}

/** the zones a unit's rooms make, in the order the unit serves them */
export function zonesOf(air: Pick<UnitAir, "rooms">, z: UnitZoning): Zone[] {
  if (z.control === "off") return [];
  const ids = air.rooms.map((r) => r.roomId);
  const keyOf = (id: string) => {
    const to = z.joined[id];
    return to && ids.includes(to) && !z.joined[to] ? to : id;
  };
  const zones: Zone[] = [];
  for (const r of air.rooms) {
    const key = keyOf(r.roomId);
    let zone = zones.find((x) => x.key === key);
    if (!zone) {
      zone = { key, label: "", roomIds: [], name: "" };
      zones.push(zone);
    }
    zone.roomIds.push(r.roomId);
  }
  const nameOf = (id: string) => air.rooms.find((r) => r.roomId === id)?.name ?? "Zone";
  zones.forEach((zone, i) => {
    zone.label = `Z${i + 1}`;
    zone.name = joinNames(zone.roomIds.map(nameOf));
  });
  return zones;
}

/** "Living and Kitchen", "Living, Kitchen and Dining" */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** the system with a room moved into another room's zone, or with
    `zoneKey` null, into a zone of its own. A zone's first room moving out
    takes no one with it: the rest stay together under the next */
export function joinZone(
  doc: DesignDocument,
  systemId: string,
  unitId: string,
  air: Pick<UnitAir, "rooms">,
  roomId: string,
  zoneKey: string | null
): DesignDocument {
  const sys = doc.systems.find((s) => s.id === systemId);
  if (!sys) return doc;
  const z = zoningOf(sys, unitId);
  const zones = zonesOf(air, z);
  const joined: Record<string, string> = {};
  for (const zone of zones) {
    const stay = zone.roomIds.filter((id) => id !== roomId);
    const head = stay[0];
    for (const id of stay.slice(1)) joined[id] = head;
  }
  if (zoneKey && zoneKey !== roomId) {
    const target = zones.find((x) => x.key === zoneKey || x.roomIds.includes(zoneKey));
    const head = target?.roomIds.find((id) => id !== roomId);
    if (head) joined[roomId] = joined[head] ?? head;
  }
  const spill = z.spill && zonesOf(air, { ...z, joined }).some((x) => x.key === z.spill) ? z.spill : null;
  return setZoning(doc, systemId, unitId, { joined, spill });
}

export interface ZoneKitLine {
  shelf: "controls";
  name: string;
  sub: string;
  qty: string;
}

export interface ZoneKit {
  lines: ZoneKitLine[];
  /** the interface, or null for a brand whose pack has no zoning */
  interfaceModel: string | null;
  /** more zones than the largest interface takes, or wired sensors past
      their limit: what the builder says */
  problem: string | null;
}

/** the zoning kit for this many zones, from the brand's pack */
export function zoneKit(pack: DataPack, z: UnitZoning, zones: Zone[]): ZoneKit {
  const n = zones.length;
  if (z.control === "off" || n === 0) return { lines: [], interfaceModel: null, problem: null };
  const temp = z.control === "temperature";
  const range: ZoningController | undefined = pack.zoning_controllers.find(
    (c) => !c.compatible_brands?.length || c.compatible_brands.includes(pack.meta.brand)
  );
  const lines: ZoneKitLine[] = [];
  const spill = zones.find((x) => x.key === z.spill);
  const spillText = spill ? `, spill into ${spill.label} ${spill.name}` : "";
  if (!range?.interfaces?.length) {
    lines.push({ shelf: "controls", name: "Zone controller", sub: `${n} zones${spillText}`, qty: "1" });
    if (temp) lines.push({ shelf: "controls", name: "Zone sensor", sub: z.sensors === "wired" ? "Wired" : "Wireless", qty: String(n) });
    return { lines, interfaceModel: null, problem: null };
  }
  const want = temp ? "temperature" : "on_off";
  const fits = range.interfaces.filter((i) => i.control === want).sort((a, b) => a.max_zones - b.max_zones);
  const iface = fits.find((i) => i.max_zones >= n) ?? null;
  let problem: string | null = null;
  if (!iface) {
    const most = fits[fits.length - 1]?.max_zones ?? 0;
    problem = `${n} zones: the largest ${range.vendor} interface takes ${most}. Join rooms into fewer zones.`;
  } else {
    lines.push({ shelf: "controls", name: `Zone interface ${iface.model}`, sub: `${iface.max_zones} zones, ${temp ? "temperature" : "on/off"}${spillText}`, qty: "1" });
  }
  if (range.main_controller) {
    lines.push({ shelf: "controls", name: `Main controller ${range.main_controller.model}`, sub: "On a wall", qty: String(range.main_controller.per_system) });
  }
  if (temp) {
    const sensor = range.sensors?.find((x) => x.kind === z.sensors);
    if (sensor) {
      if (sensor.max != null && n > sensor.max) problem = problem ?? `${n} zones: ${sensor.model} wired sensors stop at ${sensor.max}. Use wireless.`;
      lines.push({ shelf: "controls", name: `${z.sensors === "wired" ? "Wired" : "Wireless"} sensor ${sensor.model}`, sub: "One a zone", qty: String(n) });
      if (sensor.batteries) {
        lines.push({ shelf: "controls", name: `${sensor.batteries.type} battery`, sub: `${sensor.batteries.per} a sensor`, qty: String(n * sensor.batteries.per) });
      }
      if (sensor.kind === "wireless" && range.wireless_receiver) {
        lines.push({
          shelf: "controls",
          name: `Wireless receiver ${range.wireless_receiver.model}`,
          sub: `Up to ${range.wireless_receiver.max_devices} sensors`,
          qty: String(Math.ceil(n / range.wireless_receiver.max_devices)),
        });
      }
    }
  }
  return { lines, interfaceModel: iface?.model ?? null, problem };
}

/** what a damper's cable is, as the maker specifies it */
export function damperCableSub(pack: DataPack): string {
  const c = pack.zoning_controllers.find((x) => !x.compatible_brands?.length || x.compatible_brands.includes(pack.meta.brand))?.damper_cable;
  return c ? `${c.kind}, ${c.max_m} m at most, one a damper` : "One a damper";
}
