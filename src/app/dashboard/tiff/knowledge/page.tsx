import { KnowledgeBase } from "@/components/tiff/knowledge";
import { demoKbDocs } from "@/mock/demo";

export default function KnowledgeBasePage() {
  return <KnowledgeBase docs={demoKbDocs} />;
}
