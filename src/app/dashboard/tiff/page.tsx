import { redirect } from "next/navigation";

/* Retired (v2 audit, 20 October 2026; Isaac: "I was able to access the old
   library screen"). Asking Tiff is Conversations, which reads the same
   hand-off a question carries (lib/tiff/ask-handoff); the documents are the
   Library's, /dashboard/tiff/library. */
export default function TiffPage(): never {
  redirect("/dashboard/conversations");
}
