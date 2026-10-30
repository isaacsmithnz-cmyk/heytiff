/* THE LIBRARY AS SHELVES OF COVERS, on the phone (Isaac, 30 October 2026,
   the overnight mock's Library, second go: "it needs a bit more love and
   jazz"; built on "Yes I think it's good").

   Every manual is a cover on a shelf, coloured by its maker, under the kind
   of system it's for. All of it is read off what the documents already
   carry: their Manufacturer and System tags (the Library's own, each with
   the colour the business gave it), and the title. A document nobody tagged
   is shelved by the tags its own name says (guessKbTags, the upload drawer's
   guess), and one with no maker at all sits on its kind's shelf (Company
   SOPs, Field notes). Pure: no database, no org. */

import { guessKbTags, type KbTagRef } from "./tags";
import type { KbCategory } from "./files";

export type ShelfDoc = {
  id: string;
  category: KbCategory | string;
  title: string;
  source: string | null;
  fileName: string | null;
};

/** What a document's cover and shelf say. */
export type Shelving = {
  /** the shelf's identity, shared by every document on it */
  shelf: string;
  /** "Mitsubishi Electric · Ducted and zoning" */
  shelfName: string;
  /** the maker's name on the cover, or null */
  maker: string | null;
  /** the cover's colour: the maker's tag colour, or null for the plain cover */
  color: string | null;
  /** the cover's big words: the title less its maker and the kind of document it is */
  name: string;
};

/** Each kind's shelf, for documents with no maker. */
const KIND_SHELF: Record<string, string> = {
  install: "Installation documents",
  faults: "Service documents",
  specs: "Manufacturer specs",
  sops: "Company SOPs",
  field: "Field notes",
};

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*";
/* what a title says about itself rather than the gear, read off its end: the
   kind of document, its date, a printing code ("SM", "Jul2023", "2023-12") */
const TAIL = new RegExp(
  `(?:${[
    "\\b(?:im|sm|sh|om|iom|manuals?|installation|install|service|diagnosis|troubleshooting|brochure|flyer|leaflet|data ?sheets?|specifications?|specs|guide|handbook|catalogue|catalog|edition|revised|product release)",
    `\\b${MONTH}\\s?\\d{2,4}`,
    "\\b[a-z]{1,3}\\d{4}",
    "\\b\\d{4}(?:[-/]\\d{1,2})?",
  ].join("|")})\\s*$`,
  "i",
);

/** "Mitsubishi Electric" is also "ME"; a one-word maker has no initials. */
function initialsOf(label: string): string | null {
  const words = label.trim().split(/\s+/);
  return words.length > 1 ? words.map((w) => w[0]!.toUpperCase()).join("") : null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The cover's big words: "PUMY-SP80-140VYKMD2-A SM UL2023" is
    "PUMY-SP80-140VYKMD2-A"; "ME - Zone Wireless Sensor" is "Zone Wireless
    Sensor". The whole title where nothing would be left. Pure. */
export function coverName(title: string, maker: string | null): string {
  let s = title.trim();
  if (maker) {
    const names = [maker, initialsOf(maker)].filter((n): n is string => !!n).map(escape);
    s = s.replace(new RegExp(`^(?:${names.join("|")})\\b\\s*[-–:]?\\s*`, "i"), "");
  }
  for (let i = 0; i < 8; i++) {
    const next = s.replace(TAIL, "").replace(/[\s\-–:,(]+$/, "");
    /* a title that's only what kind of document it is keeps every word */
    if (!next) return title.trim();
    if (next === s) break;
    s = next;
  }
  return s.trim() || title.trim();
}

/** "Ducted and zoning"; a name in capitals keeps them ("VRF and ducted"). */
function systemsName(labels: readonly string[]): string {
  return labels.map((l, i) => (i === 0 || l === l.toUpperCase() ? l : l.charAt(0).toLowerCase() + l.slice(1))).join(" and ");
}

/** Every document's cover and shelf. Systems that share a document share a
    shelf: a zone controller tagged Ducted and Zoning puts Mitsubishi
    Electric's ducted manuals and its zoning ones on one shelf. Pure. */
export function shelvesOf(docs: readonly ShelfDoc[], tagsOf: Readonly<Record<string, readonly KbTagRef[]>>, orgTags: readonly KbTagRef[]): Map<string, Shelving> {
  /* each document's maker and systems: its own tags, else the tags its name says */
  const read = docs.map((d) => {
    let tags = tagsOf[d.id] ?? [];
    if (!tags.some((t) => t.kind === "brand")) {
      const guessed = new Set(guessKbTags([d.title, d.source, d.fileName].filter(Boolean).join(" "), orgTags));
      tags = [...tags, ...orgTags.filter((t) => guessed.has(t.id) && !tags.some((o) => o.id === t.id))];
    }
    const brand = tags.find((t) => t.kind === "brand") ?? null;
    const systems = tags.filter((t) => t.kind === "system").map((t) => t.label);
    return { d, brand, systems };
  });

  /* within a maker, systems seen together on a document are one shelf */
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    const p = parent.get(k) ?? k;
    if (p === k) return k;
    const root = find(p);
    parent.set(k, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const r of read) {
    if (!r.brand) continue;
    const keys = r.systems.map((s) => `${r.brand!.id}|${s}`);
    for (const k of keys) if (!parent.has(k)) parent.set(k, k);
    for (const k of keys.slice(1)) union(keys[0]!, k);
  }
  /* each shelf's systems, the most used first */
  const used = new Map<string, number>();
  for (const r of read) if (r.brand) for (const s of r.systems) used.set(`${r.brand.id}|${s}`, (used.get(`${r.brand.id}|${s}`) ?? 0) + 1);
  const members = new Map<string, string[]>();
  for (const k of parent.keys()) (members.get(find(k)) ?? members.set(find(k), []).get(find(k))!).push(k.split("|")[1]!);
  for (const [root, list] of members) list.sort((a, b) => (used.get(`${root.split("|")[0]}|${b}`) ?? 0) - (used.get(`${root.split("|")[0]}|${a}`) ?? 0) || a.localeCompare(b));

  const out = new Map<string, Shelving>();
  for (const { d, brand, systems } of read) {
    if (!brand) {
      const shelfName = KIND_SHELF[d.category] ?? "Other documents";
      out.set(d.id, { shelf: `kind:${d.category}`, shelfName, maker: null, color: null, name: coverName(d.title, null) });
      continue;
    }
    const root = systems.length ? find(`${brand.id}|${systems[0]}`) : null;
    const together = root ? (members.get(root) ?? systems) : [];
    out.set(d.id, {
      shelf: root ? `brand:${root}` : `brand:${brand.id}`,
      shelfName: together.length ? `${brand.label} · ${systemsName(together)}` : brand.label,
      maker: brand.label,
      color: brand.color,
      name: coverName(d.title, brand.label),
    });
  }
  return out;
}
