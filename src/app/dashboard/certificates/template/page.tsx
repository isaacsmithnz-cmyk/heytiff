import { redirect } from "next/navigation";

/* The certificate wording moved to Admin → Templates (2026-10-03). This
   address stays so links already sent still land on it. */
export default function CertificateWordingPage() {
  redirect("/dashboard/admin/templates/certificate");
}
