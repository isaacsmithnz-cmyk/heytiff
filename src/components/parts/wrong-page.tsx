"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Wrong } from "./states";

/* What an error boundary shows (rule 42): the word, that the page didn't
   load, and Try again or Home. The root's error.tsx and the dashboard's
   share it; the dashboard's sits inside the outlet, which is already the
   page's <main>. */
export function WrongPage({
  error,
  retry,
  as: Tag = "main",
}: {
  error: Error & { digest?: string };
  retry: () => void;
  as?: "main" | "div";
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Tag className="pt-wrong-page">
      <Wrong
        word="Something went wrong"
        means="This page didn't load. Try it again, and if it still won't load, go to Home."
        action={
          <>
            <button type="button" className="pt-wrong-main" onClick={() => retry()}>
              Try again
            </button>
            <Link href="/dashboard" className="pt-wrong-link">
              Go to Home
            </Link>
          </>
        }
      />
    </Tag>
  );
}
