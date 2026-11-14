import { signedPath } from "../photo-thumbs-plan";

it("finds the stored file a signed link points at", () => {
  expect(signedPath("https://x.supabase.co/storage/v1/object/sign/documents/org-1/sm8/a%20b.jpg?token=t", "documents")).toBe("org-1/sm8/a b.jpg");
});

it("is nothing for another bucket, a render link, or no link", () => {
  expect(signedPath("https://x.supabase.co/storage/v1/object/sign/other/a.jpg?token=t", "documents")).toBeNull();
  expect(signedPath("https://x.supabase.co/storage/v1/render/image/sign/documents/a.jpg?token=t", "documents")).toBeNull();
  expect(signedPath(null, "documents")).toBeNull();
  expect(signedPath("not a url", "documents")).toBeNull();
});
