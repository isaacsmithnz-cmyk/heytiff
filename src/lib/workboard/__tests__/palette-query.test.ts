/* What ⌘K reaches past the screens and the jobs (2026-09-24): the client
   book and the projects. The fake records every question so the QUESTION —
   which table, which filter, what was scrubbed — is what gets asserted. */

const rowsBy: Record<string, Record<string, unknown>[]> = {};
const calls: { table: string; method: string; args: unknown[] }[] = [];

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const sub: Record<string, unknown> = {};
      const note =
        (method: string) =>
        (...args: unknown[]) => {
          calls.push({ table, method, args });
          return sub;
        };
      for (const m of ["select", "eq", "neq", "ilike", "or", "order", "limit"]) sub[m] = note(m);
      sub.then = (res: (v: { data: unknown[] }) => unknown) =>
        Promise.resolve({ data: rowsBy[table] ?? [] }).then(res);
      return sub;
    },
  },
}));

import { searchClients, searchProjects, searchStaff } from "@/lib/workboard/palette-query";

const asked = (table: string, method: string) =>
  calls.filter((c) => c.table === table && c.method === method).map((c) => c.args);

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(rowsBy)) delete rowsBy[k];
});

describe("searchClients", () => {
  it("asks this org's active client book by name", async () => {
    await searchClients("org-1", "kings");
    expect(asked("sm8_companies", "eq")).toEqual([
      ["org_id", "org-1"],
      ["active", 1],
    ]);
    expect(asked("sm8_companies", "ilike")).toEqual([["name", "%kings%"]]);
  });

  /* Several words each have to START a word of the name, in any order:
     "constr hr" is HR Constructions, and "hr" inside Christine is not "hr". */
  it("asks for every word of several at the start of a word of the name", async () => {
    await searchClients("org-1", "constr hr");
    expect(asked("sm8_companies", "ilike")).toEqual([]);
    expect(asked("sm8_companies", "or")).toEqual([
      ["name.ilike.constr%,name.ilike.% constr%"],
      ["name.ilike.hr%,name.ilike.% hr%"],
    ]);
  });

  /* Alphabetical is how the book is read; it is not how an answer is ranked.
     "kings" wants Kingsford Bakery before The Kingsway Group. */
  it("puts the name itself, then a name that starts with it, then a word that does", async () => {
    rowsBy["sm8_companies"] = [
      { uuid: "c-1", name: "Hotel Kingsgate", address: null },
      { uuid: "c-2", name: "Kingsford Bakery", address: null },
      { uuid: "c-3", name: "Kings", address: null },
      { uuid: "c-4", name: "Ellakings Pty Ltd", address: null },
    ];
    const found = await searchClients("org-1", "kings");
    expect(found.map((c) => c.uuid)).toEqual(["c-3", "c-2", "c-1", "c-4"]);
  });

  it("shows a few, and reads an address as one line", async () => {
    rowsBy["sm8_companies"] = Array.from({ length: 9 }, (_, i) => ({
      uuid: `c-${i}`,
      name: `Smith ${i}`,
      address: "12 Anzac Pde\nKingsford  NSW 2032",
    }));
    const found = await searchClients("org-1", "smith");
    expect(found).toHaveLength(5);
    expect(found[0].address).toBe("12 Anzac Pde, Kingsford NSW 2032");
  });

  it("drops a client with no name, and asks nothing for too little", async () => {
    rowsBy["sm8_companies"] = [{ uuid: "c-1", name: "  ", address: null }];
    expect(await searchClients("org-1", "smith")).toEqual([]);
    calls.length = 0;
    expect(await searchClients("org-1", "%")).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("searchProjects", () => {
  it("asks by name, client or site, with the syntax PostgREST reads scrubbed out", async () => {
    await searchProjects("org-1", "Kingsford");
    expect(asked("projects", "or")).toEqual([
      [
        "name.ilike.%kingsford%,client_name.ilike.%kingsford%,site_label.ilike.%kingsford%,site_address.ilike.%kingsford%",
      ],
    ]);
  });

  /* Every word has to land in one of the four — "hr mosman" is HR's project
     on a Mosman site — and the brackets and commas PostgREST reads as syntax
     never reach it. */
  it("asks for every word, each in any of them", async () => {
    await searchProjects("org-1", "smith, (jones)");
    expect(asked("projects", "or")).toEqual([
      ["name.ilike.%smith%,client_name.ilike.%smith%,site_label.ilike.%smith%,site_address.ilike.%smith%"],
      ["name.ilike.%jones%,client_name.ilike.%jones%,site_label.ilike.%jones%,site_address.ilike.%jones%"],
    ]);
  });

  /* Archived is put away, as on the Projects list. Done is not. */
  it("leaves archived projects put away", async () => {
    await searchProjects("org-1", "tower");
    expect(asked("projects", "neq")).toEqual([["status", "archived"]]);
    expect(asked("projects", "eq")).toEqual([["org_id", "org-1"]]);
  });

  it("hands back the project in the palette's shape", async () => {
    rowsBy["projects"] = [
      {
        id: "p-9",
        name: "Kingsford fitout",
        client_name: "Kingsford Bakery",
        site_label: null,
        stage: "Pre-install",
        status: "on_hold",
      },
    ];
    expect(await searchProjects("org-1", "kingsford")).toEqual([
      {
        id: "p-9",
        name: "Kingsford fitout",
        clientName: "Kingsford Bakery",
        siteLabel: null,
        stage: "Pre-install",
        status: "on_hold",
      },
    ]);
  });
});

describe("searchStaff", () => {
  const card = (over: Record<string, unknown>) => ({
    id: "s-1",
    first_name: "Robert",
    last_name: "Smith",
    full_name: "Robert Smith",
    preferred_name: null,
    job_title: "Senior Tech",
    contact_email: null,
    status: "Active",
    ...over,
  });

  /* A first name, a surname, what they go by, a word of their title — each
     word has to START one of them, and every word has to land: "rob smi" is
     Robert Smith, and "rob" inside Carrobbie is not Rob. */
  it("asks for every word at the start of a name or a title, in this org", async () => {
    await searchStaff("org-1", "rob smi");
    expect(asked("staff_profiles", "eq")).toEqual([["org_id", "org-1"]]);
    expect(asked("staff_profiles", "or")).toEqual([
      [
        "first_name.ilike.rob%,last_name.ilike.rob%,preferred_name.ilike.rob%,full_name.ilike.rob%,full_name.ilike.% rob%,job_title.ilike.rob%,job_title.ilike.% rob%",
      ],
      [
        "first_name.ilike.smi%,last_name.ilike.smi%,preferred_name.ilike.smi%,full_name.ilike.smi%,full_name.ilike.% smi%,job_title.ilike.smi%,job_title.ilike.% smi%",
      ],
    ]);
  });

  /* People who have left stay findable — their records outlive them — but
     after the ones still here. */
  it("puts the people still here first, then by name", async () => {
    rowsBy["staff_profiles"] = [
      card({ id: "s-gone", first_name: "Aaron", full_name: "Aaron Smith", status: "Inactive" }),
      card({ id: "s-zed", first_name: "Zed", full_name: "Zed Smith" }),
      card({ id: "s-bob", first_name: "Bob", full_name: "Bob Smith" }),
    ];
    const found = await searchStaff("org-1", "smith");
    expect(found.map((p) => [p.id, p.active])).toEqual([
      ["s-bob", true],
      ["s-zed", true],
      ["s-gone", false],
    ]);
  });

  it("says what they go by only when it is not their first name", async () => {
    rowsBy["staff_profiles"] = [
      card({ id: "s-1", preferred_name: "Bob" }),
      card({ id: "s-2", first_name: "Ann", last_name: "Lee", full_name: "Ann Lee", preferred_name: "ann" }),
    ];
    const found = await searchStaff("org-1", "senior");
    expect(found.find((p) => p.id === "s-1")).toMatchObject({ name: "Robert Smith", known: "Bob", initials: "RS" });
    expect(found.find((p) => p.id === "s-2")).toMatchObject({ known: null });
  });

  /* An imported card can carry only an address until its person arrives —
     the directory names it by the address, and so does this. */
  it("names a card with no name by its address", async () => {
    rowsBy["staff_profiles"] = [
      card({ first_name: null, last_name: null, full_name: null, contact_email: "tony@example.com" }),
    ];
    expect(await searchStaff("org-1", "senior")).toEqual([
      expect.objectContaining({ name: "tony", initials: "TO", title: "Senior Tech" }),
    ]);
  });

  it("asks nothing for too little", async () => {
    expect(await searchStaff("org-1", "r")).toEqual([]);
    expect(calls).toEqual([]);
  });
});
