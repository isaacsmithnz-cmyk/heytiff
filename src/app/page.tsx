export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-6 bg-zinc-50 dark:bg-black">
      <h1 className="text-4xl font-semibold tracking-tight text-black dark:text-zinc-50">
        HeyTiff
      </h1>
      <a
        href="/auth/login?screen_hint=signup"
        className="px-4 py-2 text-sm font-medium text-white bg-black rounded-md dark:bg-zinc-50 dark:text-black"
      >
        Create account
      </a>
      <a
        href="/auth/login"
        className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        Sign in
      </a>
    </div>
  );
}
