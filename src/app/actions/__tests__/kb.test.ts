/* The knowledge base's writes. Server Functions are reachable by direct POST,
   so "the drawer only offered PDFs" is not a control — every rule that matters
   is re-decided here, and this file is about the gate and the round trip.

   THE THREE-STEP UPLOAD: a row is created (which is what mints the id the
   object key is made of), a signed slot is handed out, and the browser reports
   back. Until that last step the row is invisible everywhere, so an abandoned
   upload leaves nothing on anyone's screen. */

const inserts: Record<string, unknown>[] = [];
const updates: { table: string; patch: Record<string, unknown> }[] = [];
const deletes: string[] = [];
const removed: string[][] = [];

let rows: Record<string, Record<string, unknown> | null> = {};
let insertFails = false;
let slotFails = false;
let signFails = false;

const createSignedUploadUrl = jest.fn(async (ref: string) =>
  slotFails ? { data: null, error: { message: "no" } } : { data: { token: `tok-${ref}` }, error: null }
);

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = self;
      chain.eq = self;
      chain.maybeSingle = async () => ({ data: rows[table] ?? null });
      chain.insert = (payload: Record<string, unknown>) => {
        inserts.push(payload);
        return {
          select: () => ({
            maybeSingle: async () =>
              insertFails ? { data: null, error: { message: "no" } } : { data: { id: "doc-1" }, error: null },
          }),
        };
      };
      chain.update = (patch: Record<string, unknown>) => {
        const sub: Record<string, unknown> = {};
        sub.eq = () => sub;
        sub.then = (res: (v: { error: null }) => unknown) => {
          updates.push({ table, patch });
          return Promise.resolve({ error: null }).then(res);
        };
        return sub;
      };
      chain.delete = () => {
        const sub: Record<string, unknown> = {};
        sub.eq = () => sub;
        sub.then = (res: (v: { error: null }) => unknown) => {
          deletes.push(table);
          return Promise.resolve({ error: null }).then(res);
        };
        return sub;
      };
      return chain;
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUploadUrl: (ref: string) => createSignedUploadUrl(`${bucket}:${ref}`),
        createSignedUrl: async (ref: string) =>
          signFails
            ? { data: null, error: { message: "no" } }
            : { data: { signedUrl: `https://signed.example/${bucket}/${ref}` }, error: null },
        remove: async (refs: string[]) => {
          removed.push(refs);
          return { error: null };
        },
      }),
    },
  },
}));

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

let caps = new Set<string>(["tiff_manage"]);
let dbRole: string | null = "owner";
jest.mock("@/lib/permissions-server", () => ({
  requireOrg: async (capability?: string) => {
    if (capability && !caps.has(capability)) throw new Error("Insufficient permissions");
    return { orgId: "org-1", userId: "auth0|me" };
  },
  getDbRole: async () => dbRole,
}));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: async () => "staff-me" }));

import {
  beginKbUpload,
  confirmKbUpload,
  deleteKbDoc,
  kbDocUrl,
  retryKbDoc,
  updateKbDocMeta,
} from "../kb";

const PDF = { title: "City Multi install guide", category: "install", mime: "application/pdf", sizeBytes: 4_000_000 };

const patchesTo = (table: string) => updates.filter((u) => u.table === table).map((u) => u.patch);

beforeEach(() => {
  inserts.length = 0;
  updates.length = 0;
  deletes.length = 0;
  removed.length = 0;
  rows = { kb_documents: { storage_ref: "org/org-1/kb/doc-1.pdf", status: "uploading" } };
  insertFails = false;
  slotFails = false;
  signFails = false;
  caps = new Set(["tiff_manage"]);
  dbRole = "owner";
  jest.clearAllMocks();
});

describe("the gate", () => {
  it("refuses every write without tiff_manage, before any row exists", async () => {
    caps = new Set(["tiff"]); // reading and asking is the staff tier

    expect(await beginKbUpload(PDF)).toMatchObject({ ok: false });
    expect(await confirmKbUpload("doc-1")).toMatchObject({ ok: false });
    expect(await updateKbDocMeta("doc-1", { title: "x" })).toMatchObject({ ok: false });
    expect(await retryKbDoc("doc-1")).toMatchObject({ ok: false });
    expect(await deleteKbDoc("doc-1")).toMatchObject({ ok: false });

    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(deletes).toHaveLength(0);
  });

  /* requireOrg throws; the actions return. An action that throws reaches the
     browser as an opaque digest, and the library needs a sentence to show. */
  it("returns a reason rather than throwing", async () => {
    caps = new Set();
    await expect(beginKbUpload(PDF)).resolves.toMatchObject({
      ok: false,
      error: "You don't have access to manage the knowledge base.",
    });
  });
});

describe("beginning an upload", () => {
  it("creates the row, keys the object off its id, and hands back a slot", async () => {
    const slot = await beginKbUpload({ ...PDF, source: "Mitsubishi Electric", edition: "2024" });

    expect(inserts[0]).toMatchObject({
      org_id: "org-1",
      category: "install",
      title: "City Multi install guide",
      source: "Mitsubishi Electric",
      edition: "2024",
      kind: "PDF",
      mime_type: "application/pdf",
      status: "uploading",
      uploaded_by: "staff-me",
    });
    // the ref is written back once the id exists — never a file no row points at
    expect(patchesTo("kb_documents")[0]).toMatchObject({ storage_ref: "org/org-1/kb/doc-1.pdf" });
    expect(slot).toMatchObject({
      ok: true,
      documentId: "doc-1",
      ref: "org/org-1/kb/doc-1.pdf",
      bucket: "kb",
    });
  });

  it("refuses anything that isn't a PDF, without creating a row", async () => {
    expect(await beginKbUpload({ ...PDF, mime: "image/png" })).toMatchObject({ ok: false });
    expect(inserts).toHaveLength(0);
  });

  it("refuses a file past the 50 MB ceiling", async () => {
    expect(await beginKbUpload({ ...PDF, sizeBytes: 60 * 1024 * 1024 })).toMatchObject({ ok: false });
    expect(inserts).toHaveLength(0);
  });

  it("refuses a category the database wouldn't accept either", async () => {
    expect(await beginKbUpload({ ...PDF, category: "manuals" })).toMatchObject({
      ok: false,
      error: "Pick a category for that document.",
    });
    expect(inserts).toHaveLength(0);
  });

  it("refuses an untitled document", async () => {
    expect(await beginKbUpload({ ...PDF, title: "   " })).toMatchObject({ ok: false });
    expect(inserts).toHaveLength(0);
  });

  /* No bytes were ever written, so the row is the only thing to clean up —
     and leaving it would put a permanently "uploading" entry in the library. */
  it("removes the row again when no slot could be minted", async () => {
    slotFails = true;
    expect(await beginKbUpload(PDF)).toMatchObject({ ok: false });
    expect(deletes).toEqual(["kb_documents"]);
  });
});

describe("confirming an upload", () => {
  it("stamps the arrival and hands the document to the ingest loop", async () => {
    expect(await confirmKbUpload("doc-1")).toEqual({ ok: true });
    expect(patchesTo("kb_documents")[0]).toMatchObject({ status: "processing", error: null });
    expect(patchesTo("kb_documents")[0].uploaded_at).toEqual(expect.any(String));
  });

  it("refuses a ref that isn't this org's", async () => {
    rows.kb_documents = { storage_ref: "org/org-2/kb/doc-1.pdf" };
    expect(await confirmKbUpload("doc-1")).toMatchObject({ ok: false });
    expect(updates).toHaveLength(0);
  });

  it("says so when the row is gone", async () => {
    rows.kb_documents = null;
    expect(await confirmKbUpload("doc-1")).toMatchObject({ ok: false });
  });
});

describe("editing the details", () => {
  it("saves only the fields it was given", async () => {
    await updateKbDocMeta("doc-1", { title: "  Fault codes 2024  ", source: "Daikin" });
    expect(patchesTo("kb_documents")[0]).toMatchObject({
      title: "Fault codes 2024",
      source: "Daikin",
    });
    expect(patchesTo("kb_documents")[0]).not.toHaveProperty("category");
  });

  it("lets an empty string clear a field, and absence leave it alone", async () => {
    await updateKbDocMeta("doc-1", { edition: "" });
    expect(patchesTo("kb_documents")[0]).toMatchObject({ edition: null });
  });

  it("refuses a made-up category and an emptied title", async () => {
    expect(await updateKbDocMeta("doc-1", { category: "manuals" })).toMatchObject({ ok: false });
    expect(await updateKbDocMeta("doc-1", { title: " " })).toMatchObject({ ok: false });
    expect(updates).toHaveLength(0);
  });

  it("writes nothing when it was given nothing", async () => {
    expect(await updateKbDocMeta("doc-1", {})).toEqual({ ok: true });
    expect(updates).toHaveLength(0);
  });
});

describe("retrying", () => {
  /* The bookmark is deliberately NOT reset: 239 pages of chunks are already
     stored and paid for, and re-reading them would duplicate every one. */
  it("puts a failed document back to processing, at its bookmark", async () => {
    rows.kb_documents = { status: "failed", storage_ref: "org/org-1/kb/doc-1.pdf" };
    expect(await retryKbDoc("doc-1")).toEqual({ ok: true });

    const patch = patchesTo("kb_documents")[0];
    expect(patch).toMatchObject({ status: "processing", error: null });
    expect(patch).not.toHaveProperty("next_page");
  });

  it("does the same for one parked at the quota — the loop re-checks the room", async () => {
    rows.kb_documents = { status: "paused", storage_ref: "org/org-1/kb/doc-1.pdf" };
    expect(await retryKbDoc("doc-1")).toEqual({ ok: true });
    expect(patchesTo("kb_documents")[0]).toMatchObject({ status: "processing" });
  });

  it("refuses a document that isn't stopped", async () => {
    for (const status of ["processing", "ready", "uploading"]) {
      rows.kb_documents = { status, storage_ref: "org/org-1/kb/doc-1.pdf" };
      expect(await retryKbDoc("doc-1")).toMatchObject({ ok: false });
    }
    expect(updates).toHaveLength(0);
  });
});

describe("deleting", () => {
  /* Owner-only on top of tiff_manage: a document is what answers get quoted
     from, so removing one quietly changes what the whole company is told. */
  it("lets the owner remove it — object first, then the row", async () => {
    expect(await deleteKbDoc("doc-1")).toEqual({ ok: true });
    expect(removed).toEqual([["org/org-1/kb/doc-1.pdf"]]);
    expect(deletes).toEqual(["kb_documents"]);
  });

  it("refuses an admin who holds tiff_manage", async () => {
    dbRole = "admin";
    expect(await deleteKbDoc("doc-1")).toEqual({
      ok: false,
      error: "Only the owner can remove a document.",
    });
    expect(removed).toHaveLength(0);
    expect(deletes).toHaveLength(0);
  });

  it("refuses a staff member with the capability granted", async () => {
    dbRole = "staff";
    expect(await deleteKbDoc("doc-1")).toMatchObject({ ok: false });
    expect(deletes).toHaveLength(0);
  });

  it("refuses to touch an object belonging to another org", async () => {
    rows.kb_documents = { storage_ref: "org/org-2/kb/doc-1.pdf" };
    expect(await deleteKbDoc("doc-1")).toMatchObject({ ok: false });
    expect(removed).toHaveLength(0);
    expect(deletes).toHaveLength(0);
  });

  it("says so when it's already gone", async () => {
    rows.kb_documents = null;
    expect(await deleteKbDoc("doc-1")).toMatchObject({ ok: false });
  });
});

/* Opening a document is READING, and reading is the staff tier — this is the
   one action in the file that names `tiff` rather than `tiff_manage`. The link
   is minted per click because the bucket is private and links expire. */
describe("opening a document", () => {
  beforeEach(() => {
    // a staff member: the read capability, nothing else
    caps = new Set(["tiff"]);
    dbRole = "staff";
  });

  it("signs a link for anyone who may see the library at all", async () => {
    expect(await kbDocUrl("doc-1")).toEqual({
      ok: true,
      url: "https://signed.example/kb/org/org-1/kb/doc-1.pdf",
    });
  });

  it("refuses someone without the tiff capability", async () => {
    caps = new Set();
    expect(await kbDocUrl("doc-1")).toMatchObject({ ok: false });
  });

  it("never signs a reference belonging to another org", async () => {
    rows.kb_documents = { storage_ref: "org/org-2/kb/doc-1.pdf" };
    expect(await kbDocUrl("doc-1")).toEqual({
      ok: false,
      error: "That file doesn't belong to this organisation.",
    });
  });

  it("says so when the row is gone, and when the object is", async () => {
    rows.kb_documents = null;
    expect(await kbDocUrl("doc-1")).toMatchObject({ ok: false, error: "That document is no longer here." });

    rows.kb_documents = { storage_ref: "org/org-1/kb/doc-1.pdf" };
    signFails = true;
    expect(await kbDocUrl("doc-1")).toMatchObject({ ok: false, error: "That file couldn't be opened." });
  });

  it("writes nothing — it is a read", async () => {
    await kbDocUrl("doc-1");
    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(0);
    expect(deletes).toHaveLength(0);
  });
});
