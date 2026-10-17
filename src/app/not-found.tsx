import Link from "next/link";
import { Wrong } from "@/components/parts/states";
import "@/components/parts/patterns.css";

/* Any address the app has no page for, and a `notFound()` no nearer
   not-found catches (rule 42). Home is the dashboard until `/` becomes
   Home. */
export default function NotFound() {
  return (
    <main className="pt-wrong-page">
      <Wrong
        word="Not found"
        means="There's no page at this address. It may have moved, or the link may be wrong."
        action={
          <Link href="/dashboard" className="pt-wrong-link">
            Go to Home
          </Link>
        }
      />
    </main>
  );
}
