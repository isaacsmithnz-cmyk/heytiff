/**
 * @jest-environment node
 */
/* The website's bug (the bug in the top bar): the phone's folder and numbers, anyone in the workspace's, its App line
   "Web", the session saying which workspace. Storage is a fake folder. */

let session: { orgId: string } | null = { orgId: "org1" };
let role: string | null = "owner";
jest.mock("@/lib/permissions-server", () => ({
  requireOrg: async () => {
    if (!session) throw new Error("Not authenticated");
    return { orgId: session.orgId, userId: "auth0|isaac" };
  },
  getDbRole: async () => role,
}));

const files = new Map<string, string>();
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { first_name: "Luke", preferred_name: null, full_name: "Luke Brown" }, error: null }) };
      return q;
    },
    storage: {
      from: (bucket: string) => ({
        list: async (folder: string) => ({
          data: [...files.keys()].filter((k) => k.startsWith(`${bucket}:${folder}/`)).map((k) => ({ name: k.split("/").pop() })),
          error: null,
        }),
        upload: async (path: string, body: Blob, opts: { upsert?: boolean }) => {
          if (!opts.upsert && files.has(`${bucket}:${path}`)) return { error: { message: "The resource already exists" } };
          files.set(`${bucket}:${path}`, await body.text());
          return { error: null };
        },
        download: async (path: string) => (files.has(`${bucket}:${path}`) ? { data: new Blob([files.get(`${bucket}:${path}`)!]), error: null } : { data: null, error: { message: "not found" } }),
        createSignedUploadUrl: async (path: string) => ({ data: { signedUrl: `https://store/${bucket}/${path}?token=t`, path, token: "t" }, error: null }),
        remove: async (paths: string[]) => {
          for (const p of paths) files.delete(`${bucket}:${p}`);
          return { error: null };
        },
      }),
    },
  },
}));

import { POST } from "@/app/api/bugs/route";
import { DELETE, PUT } from "@/app/api/bugs/[n]/route";

const req = (method: string, body?: unknown) => new Request("https://go.hey-tiff.com/api/bugs", { method, ...(body ? { body: JSON.stringify(body) } : {}) });
const params = (n: string) => ({ params: Promise.resolve({ n }) });

beforeEach(() => {
  files.clear();
  session = { orgId: "org1" };
  role = "owner";
});

test("a bug from the website takes the next number after the phone's, says Web, and hands back its picture's slot", async () => {
  files.set("documents:bugs/org1/0012.png", "png");
  files.set("documents:bugs/org1/0012.txt", "Bug 12\n");
  const res = await POST(req("POST", { page: "Job 3521, /dashboard/jobs/abc?tab=scope", app: "1.0.11" }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ number: 13, uploadUrl: "https://store/documents/bugs/org1/0013.png?token=t", path: "bugs/org1/0013.png", token: "t" });
  expect(files.get("documents:bugs/org1/0013.txt")).toMatch(/^Bug 13\nWhen: .*\nBy: Luke Brown\nUser: auth0\|isaac\nPage: Job 3521, \/dashboard\/jobs\/abc\?tab=scope\nApp: Web\n$/);
});

test("anyone in the workspace files one, and only signed in", async () => {
  role = null;
  expect((await POST(req("POST", {}))).status).toBe(403);
  role = "staff";
  expect((await POST(req("POST", {}))).status).toBe(200);
  files.clear();
  session = null;
  expect((await POST(req("POST", {}))).status).toBe(401);
  expect(files.size).toBe(0);
});

test("what's wrong is kept with it, and Cancel or Undo takes it away", async () => {
  await POST(req("POST", { page: "/dashboard" }));
  files.set("documents:bugs/org1/0001.png", "png");
  expect((await PUT(req("PUT", { note: "The Side by side switch shows the supplied scope twice" }), params("1"))).status).toBe(200);
  expect(files.get("documents:bugs/org1/0001.txt")).toMatch(/\nNote: The Side by side switch shows the supplied scope twice\n$/);
  expect((await DELETE(req("DELETE"), params("1"))).status).toBe(200);
  expect(files.size).toBe(0);
});
