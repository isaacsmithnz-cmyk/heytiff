import { redirect } from "next/navigation";

/* The certificate wording moved to Admin → Paperwork (2026-10-03). This
   address stays so links already sent still land on it. */
export default function CertificateWordingPage() {
  redirect("/dashboard/admin/paperwork?sec=wording");
}
