/* Several words, every one of them landing somewhere (2026-09-24). Isaac
   typed "hr constructions mosman" into ⌘K: the client's name and a suburb.
   HR Constructions Pty Ltd has fifteen jobs in Mosman, and the search found
   none, because it asked for the whole phrase inside one field.

   The fake here is a small PostgREST: it FILTERS rows the way the database
   would — eq, in, ilike and the `or` lists — so these tests pin what is
   found, not merely what was asked. */

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};

const likeToRegExp = (pattern: string) =>
  new RegExp(
    `^${pattern
      .split("%")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
    "is"
  );
const like = (value: unknown, pattern: string) =>
  typeof value === "string" && likeToRegExp(pattern).test(value);

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const tests: ((r: Row) => boolean)[] = [];
      let sort: { col: string; asc: boolean } | null = null;
      let cap = Infinity;
      const q: Record<string, unknown> = {};
      const keep = (t: (r: Row) => boolean) => {
        tests.push(t);
        return q;
      };
      q.select = () => q;
      q.eq = (c: string, v: unknown) => keep((r) => r[c] === v);
      q.in = (c: string, vs: unknown[]) => keep((r) => vs.includes(r[c]));
      q.ilike = (c: string, p: string) => keep((r) => like(r[c], p));
      q.gte = (c: string, v: string) => keep((r) => typeof r[c] === "string" && (r[c] as string) >= v);
      q.or = (list: string) => {
        const alts = list.split(",").map((alt) => {
          const [col, op, ...rest] = alt.split(".");
          if (op !== "ilike") throw new Error(`the fake reads ilike only, not ${op}`);
          const pattern = rest.join(".");
          return (r: Row) => like(r[col], pattern);
        });
        return keep((r) => alts.some((a) => a(r)));
      };
      q.order = (col: string, o?: { ascending?: boolean }) => {
        sort = { col, asc: o?.ascending !== false };
        return q;
      };
      q.limit = (n: number) => {
        cap = n;
        return q;
      };
      q.then = (res: (v: { data: Row[] }) => unknown) => {
        let rows = (tables[table] ?? []).filter((r) => tests.every((t) => t(r)));
        if (sort) {
          const { col, asc } = sort;
          rows = [...rows].sort((a, b) =>
            String(a[col] ?? "").localeCompare(String(b[col] ?? "")) * (asc ? 1 : -1)
          );
        }
        return Promise.resolve({ data: rows.slice(0, cap) }).then(res);
      };
      return q;
    },
  },
}));

import { searchAllMirrorJobs } from "@/lib/workboard/all-jobs-query";

const ORG = "org-1";
const TODAY = "2026-09-24";

const client = (uuid: string, name: string): Row => ({ org_id: ORG, uuid, name, active: 1 });
const job = (uuid: string, over: Row): Row => ({
  org_id: ORG,
  uuid,
  active: 1,
  generated_job_id: uuid.replace("j-", ""),
  status: "Completed",
  company_uuid: null,
  geo_city: null,
  category_uuid: null,
  job_description: null,
  date: "2026-01-01 09:00:00",
  quote_date: null,
  completion_date: null,
  ...over,
});

const numbers = async (query: string) =>
  (await searchAllMirrorJobs(ORG, query, TODAY, { includeMoney: false })).map((j) => j.jobNumber);

beforeEach(() => {
  tables.sm8_companies = [
    client("c-hr", "HR Constructions Pty Ltd"),
    client("c-abc", "ABC Constructions"),
    client("c-chr", "Christine Hair Studio"),
  ];
  tables.sm8_jobs = [
    job("j-2675", { company_uuid: "c-hr", geo_city: "Mosman", date: "2026-08-01 09:00:00" }),
    job("j-2545", { company_uuid: "c-hr", geo_city: "Mosman", date: "2026-05-01 09:00:00" }),
    job("j-3166", { company_uuid: "c-hr", geo_city: "Northbridge", date: "2026-09-01 09:00:00" }),
    job("j-2701", {
      company_uuid: "c-abc",
      geo_city: "Mosman",
      job_description: "HR office fitout",
      date: "2026-09-10 09:00:00",
    }),
    job("j-2702", { company_uuid: "c-abc", geo_city: "Mosman", job_description: "Roof unit" }),
    job("j-2800", { company_uuid: "c-chr", geo_city: "Mosman", job_description: "Split in the salon" }),
  ];
  tables.sm8_categories = [];
  tables.sm8_job_activities = [];
});

describe("several words, every one landing", () => {
  it("finds a client's jobs in a suburb when the name and the suburb are typed together", async () => {
    expect(await numbers("hr constructions mosman")).toEqual([
      // the client whose name covers the most words answers first, newest first
      "2675",
      "2545",
      // then work where the words land elsewhere: HR in the description
      "2701",
    ]);
  });

  it("answers first with the client covering more words, whatever order the book is in", async () => {
    tables.sm8_companies = [...tables.sm8_companies].reverse();
    expect(await numbers("constructions hr mosman")).toEqual(["2675", "2545", "2701"]);
  });

  it("takes the words in any order", async () => {
    expect(await numbers("mosman hr constructions")).toEqual(["2675", "2545", "2701"]);
  });

  /* "hr" inside Christine is not the word hr: a client is named by the words
     their name starts, or 47 clients would answer for one. */
  it("names a client by the words their name starts, not by letters inside one", async () => {
    expect(await numbers("hr mosman")).not.toContain("2800");
  });

  it("reads a job number and a suburb together", async () => {
    expect(await numbers("2675 mosman")).toEqual(["2675"]);
    expect(await numbers("2675 northbridge")).toEqual([]);
  });

  it("gives a client typed in full all of their work", async () => {
    expect(await numbers("hr constructions pty ltd")).toEqual(["3166", "2675", "2545"]);
  });

  /* The per-word pools are capped, and a word as common as "pty" fills its
     cap long before it reaches the one client being named. The client whose
     name covers EVERY word is asked for apart, so it cannot be crowded out. */
  it("finds the client named in full even when every word of the name is common", async () => {
    const filler = (n: number, name: string) => client(`c-${name}-${n}`, `${name} ${n}`);
    tables.sm8_companies = [
      ...Array.from({ length: 70 }, (_, n) => filler(n, "HR Recruitment")),
      ...Array.from({ length: 70 }, (_, n) => filler(n, "Constructions Supplies")),
      ...Array.from({ length: 70 }, (_, n) => filler(n, "Pty Ltd Holdings")),
      ...tables.sm8_companies,
    ];
    expect(await numbers("hr constructions pty ltd")).toEqual(["3166", "2675", "2545"]);
  });
});
