import { redirect } from "next/navigation";

/* Knowledge from the field is the Library's (Isaac, 25 October 2026:
   "Knowledge from the field in the Library"): the Field notes shelf, on its
   To look over view, an admin's. This address was the page; a saved link
   lands there. The Library gates itself, and reads the notes to look over
   only for an admin. */
export default function AdminKnowledgePage(): never {
  redirect("/dashboard/tiff/library?cat=field&view=review");
}
