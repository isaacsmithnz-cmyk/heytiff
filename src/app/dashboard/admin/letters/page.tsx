import { redirect } from "next/navigation";
import { lettersHref } from "@/lib/letters/letter";

/* LETTERS' OLD ADDRESS. The list lives in Documents now (v2, step 5), as
   its Letters view, held to the same people as before: admin and up, and
   of those, each sees the letters they wrote or sign, the owner all of
   them. Settings' menu and an old bookmark land there. A letter's own
   editor stays where it was, at /dashboard/admin/letters/<id>. */
export default function LettersPage() {
  redirect(lettersHref);
}
