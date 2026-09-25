import type { SendLine } from "@/lib/integrations/sm8-write-plan";
import "@/components/swms/swms.css";

/** A line in the state's colour — a paper's expiry, a file's or a note's way
    to ServiceM8. No tone is the quiet colour. An `em` under a row's name on
    the Documents face; a `span` inside the diary's own meta line. */
export function StateLine({ line, as: Tag = "em" }: { line: SendLine; as?: "em" | "span" }) {
  return <Tag className={line.tone ? `sw-state ${line.tone}` : undefined}>{line.word}</Tag>;
}
