import { KnowledgeBase } from "@/components/tiff/knowledge";

// Empty until real uploads land (Documents/storage track); the knowledge base
// renders a per-category "No documents yet" state from an empty library.
export default function KnowledgeBasePage() {
  return <KnowledgeBase docs={[]} />;
}
