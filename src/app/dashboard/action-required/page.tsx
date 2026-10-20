import { redirect } from "next/navigation";

/* Retired (v2 audit, 20 October 2026): what this board listed is Home's
   now, its To do and Activity columns. The address stays for the links
   that name it and lands on Home. */
export default function ActionRequiredPage(): never {
  redirect("/dashboard");
}
