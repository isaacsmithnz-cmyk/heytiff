import { TiffAssistant } from "@/components/tiff/assistant";
import { demoKbDocs } from "@/mock/demo";

export default function TiffPage() {
  return <TiffAssistant docs={demoKbDocs} />;
}
