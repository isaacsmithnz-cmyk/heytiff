import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { KnowledgeBase } from "@/components/tiff/knowledge";

// Deep-linkable leaf — same `tiff` gate as the assistant page: the capability
// is revocable, so every route checks for itself, not just the nav entry.
//
// Empty until real uploads land (Documents/storage track); the knowledge base
// renders a per-category "No documents yet" state from an empty library.
export default async function KnowledgeBasePage() {
  if (!(await can("tiff"))) redirect("/dashboard");
  return <KnowledgeBase docs={[]} />;
}
