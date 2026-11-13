/**
 * @jest-environment node
 */
/* The phone's bug: the owner's alone, each one the workspace's next number, kept under bugs/<workspace>/ as
   0012.png beside 0012.txt; a note rewrites the .txt's Note line; Undo takes both away. Storage is a fake folder. */

let role: string | null = "owner";
jest.mock("@/lib/mobile/auth", () => ({
  requireMobile: async (r: Request) => (r.headers.get("authorization") ? { userId: "auth0|isaac", orgId: "org1", role } : new Response(null, { status: 401 })),
  ok: (b: unknown) => Response.json(b),
}));

const files = new Map<string, string>();
/** names a second tap took in the same instant, there by the time this one writes */
let racing: string[] = [];
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    storage: {
      from: (bucket: string) => ({
        list: async (folder: string) => ({
          data: [...files.keys()].filter((k) => k.startsWith(`${bucket}:${folder}/`)).map((k) => ({ name: k.split("/").pop() })),
          error: null,
        }),
        upload: async (path: string, body: Blob, opts: { upsert?: boolean }) => {
          for (const r of racing) files.set(`${bucket}:${r}`, "taken");
          racing = [];
          if (!opts.upsert && files.has(`${bucket}:${path}`)) return { error: { message: "The resource already exists" } };
          files.set(`${bucket}:${path}`, await body.text());
          return { error: null };
        },
        download: async (path: string) => (files.has(`${bucket}:${path}`) ? { data: new Blob([files.get(`${bucket}:${path}`)!]), error: null } : { data: null, error: { message: "not found" } }),
        createSignedUploadUrl: async (path: string) => ({ data: { signedUrl: `https://store/${bucket}/${path}?token=t` }, error: null }),
        remove: async (paths: string[]) => {
          for (const p of paths) files.delete(`${bucket}:${p}`);
          return { error: null };
        },
      }),
    },
  },
}));

import { POST } from "@/app/api/mobile/bugs/route";
import { DELETE, PUT } from "@/app/api/mobile/bugs/[n]/route";
import { bugText, highestBug } from "@/lib/mobile/bugs";

const req = (method: string, body?: unknown, auth = true) =>
  new Request("https://go.hey-tiff.com/api/mobile/bugs", { method, headers: auth ? { authorization: "Bearer t" } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
const params = (n: string) => ({ params: Promise.resolve({ n }) });

beforeEach(() => {
  files.clear();
  racing = [];
  role = "owner";
});

test("the first bug is 1, the next is one past the highest in the folder, and each holds its number in a .txt", async () => {
  const first = await (await POST(req("POST", { page: "/job/3324", app: "1.0.11/e2d46512" }))).json();
  expect(first).toEqual({ number: 1, uploadUrl: "https://store/documents/bugs/org1/0001.png?token=t" });
  const txt = files.get("documents:bugs/org1/0001.txt")!;
  expect(txt).toMatch(/^Bug 1\nWhen: \d{4}-\d\d-\d\dT.*\nPage: \/job\/3324\nApp: 1\.0\.11\/e2d46512\n$/);

  files.set("documents:bugs/org1/0011.png", "png");
  const next = await (await POST(req("POST", { page: "/" }))).json();
  expect(next.number).toBe(12);
  expect(files.has("documents:bugs/org1/0012.txt")).toBe(true);
});

test("a second tap in the same instant takes the number after", async () => {
  racing = ["bugs/org1/0001.txt"];
  const r = await (await POST(req("POST", {}))).json();
  expect(r.number).toBe(2);
});

test("a note is kept with the bug, and a second note replaces the first", async () => {
  await POST(req("POST", { page: "/" }));
  await PUT(req("PUT", { note: "the hump\nclips the card" }), params("1"));
  await PUT(req("PUT", { note: "the hump clips the 3324 card" }), params("1"));
  const txt = files.get("documents:bugs/org1/0001.txt")!;
  expect(txt.match(/Note: /g)).toHaveLength(1);
  expect(txt).toMatch(/\nNote: the hump clips the 3324 card\n$/);
  expect((await PUT(req("PUT", { note: "x" }), params("9"))).status).toBe(404);
});

test("Undo takes the picture and its facts away", async () => {
  await POST(req("POST", {}));
  files.set("documents:bugs/org1/0001.png", "png");
  expect((await DELETE(req("DELETE"), params("1"))).status).toBe(200);
  expect([...files.keys()]).toEqual([]);
});

test("only the owner saves a bug, and only signed in; another workspace's folder is never touched", async () => {
  expect((await POST(req("POST", {}, false))).status).toBe(401);
  role = "staff";
  expect((await POST(req("POST", {}))).status).toBe(403);
  expect((await PUT(req("PUT", { note: "x" }), params("1"))).status).toBe(403);
  expect((await DELETE(req("DELETE"), params("1"))).status).toBe(403);
  expect(files.size).toBe(0);
  role = "owner";
  files.set("documents:bugs/org2/0040.png", "png");
  expect((await (await POST(req("POST", {}))).json()).number).toBe(1);
});

test("numbers come from the names alone, and the .txt says what it doesn't know", () => {
  expect(highestBug(["0003.png", "0003.txt", "0010.txt", "notes.md", "12.png"])).toBe(10);
  expect(bugText({ n: 4, at: "2026-11-11T05:40:00.000Z", page: "", app: "" })).toBe("Bug 4\nWhen: 2026-11-11T05:40:00.000Z\nPage: (not said)\nApp: (not said)\n");
});
