export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-50 px-6 text-center dark:bg-black">
      <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
        Political Watchtower
      </h1>
      <p className="max-w-md text-zinc-600 dark:text-zinc-400">
        Pre-code placeholder — Stage 0 scaffold. See{" "}
        <code className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-white/[.08]">
          SPEC.md
        </code>{" "}
        for the build plan.
      </p>
    </main>
  );
}
