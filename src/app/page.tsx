import { MorphSearch } from "@/components/search/MorphSearch";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center gap-8 px-5 py-16">
      <header className="mx-auto w-full max-w-2xl">
        <h1 className="text-balance text-2xl font-semibold tracking-tight text-ink">
          One box. Every real estate search.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-mid">
          Type what you want in your own words. Jev decides what kind of search it is; the
          parsers pull out every number, place and feature. The form follows.
        </p>
      </header>

      <MorphSearch />

      <footer className="mx-auto w-full max-w-2xl text-xs leading-relaxed text-ink-faint">
        Jev classifies only — it is never asked to extract a value, count a bedroom, or do
        arithmetic. Prices, beds, baths, sqft, zips, dates and amenities all come from
        deterministic parsers, so the same sentence always produces the same JSON.
      </footer>
    </main>
  );
}
