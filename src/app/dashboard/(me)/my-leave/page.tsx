import { MeScreen } from "@/components/me/me-screen";
import { loadMe } from "@/lib/me/page-data";

/* Ungated, like the rest of the card: booking your own leave is intrinsic.
   `timepay_all` gates everyone else's. */
export default async function MyLeavePage() {
  return <MeScreen initialTab="leave" data={await loadMe()} />;
}
