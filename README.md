# JEV Search

One search box that becomes the right real-estate search as you type.

Type *"Show me 3 bedroom houses to buy in Cupertino under $1M with a backyard"* and the box
grows into a buy-search card with the city, bed count, ceiling price and amenity already
filled in. Type *"Can I afford an $850k place in Cupertino"* and the same box becomes a
mortgage calculator. Nothing is submitted, nothing reloads — the form follows the sentence.

**▶ [Watch the demo](demo/jev_search_demo.mp4)** — 2m35s, silent. A screen recording of the box
in use; the readout in the bottom-right corner is the live latency, parse time and token cost of
each classification, which is the part worth watching. See
[Why the two clocks are drawn on screen](#why-the-two-clocks-are-drawn-on-screen).

The idea of a search box that rewrites itself as you type comes from
[shapeshift](https://github.com/anishfn/shapeshift); none of its code does. This is a fresh
implementation over a full property-filter set — 36 fields — built on
[Jev](https://typesafe.ai) via OpenRouter's Decisions API.

---

## The one idea worth stealing

**Jev decides. Code computes.**

Jev is a *classifier*, not an extractor. It is asked things like "is this person buying or
renting?" and "is a price ceiling implied?" — questions with a fixed set of answers and a
probability attached to each. It is never asked to pull out a number, count a bedroom, or
work out a date.

Everything with a right answer is parsed deterministically in `src/lib/parse/`. That split
is the whole architecture, and it buys three things:

- **Reproducibility.** The same sentence always produces the same JSON. Prices and bed
  counts cannot drift between two runs.
- **Speed.** Filters appear on every keystroke, because parsing is pure string work. The
  network round trip only decides *which card* to show.
- **Debuggability.** When the output is wrong you know immediately which half to look at:
  a bad number is a regex bug, a bad card is a threshold or a question.

Where the two halves disagree, the text wins. If the sentence says "under $1M", a Jev
answer of `priceBound: "minimum"` is ignored — a stated comparator is not a judgement
call. Jev's reading of the bound is consulted *only* when the text states none.

How much of the work Jev does is a flag, `EXTRACTION_MODE` — but only for the fields it
*can* do. Jev answers with a label, a probability or a score, never a number or a string,
so no setting makes it return a price or an address. See
[Extraction modes](#extraction-modes).

### Why the two clocks are drawn on screen

The **Speed** bullet above is the claim a latency budget actually turns on, so the app measures
it rather than asserting it. Under the card, `LatencyTimeline` plots both paths against a 100ms
line:

| Path | What it is | Order of magnitude |
| --- | --- | --- |
| Filters | regexes in `src/lib/parse/`, running in the browser | **~0.1ms** (p50 0.107ms, p95 0.507ms, p99 0.915ms over the example set on Node/V8) |
| Card | 120ms debounce + one hosted classification | **a few hundred ms**, and not under this app's control |

The ratio is the point, not either figure. A classifier in the *blocking* path of a search box
cannot meet a 100ms budget, and no amount of tuning changes that — but nothing here blocks on
it. `useSearchIntent` recomputes the whole `SearchQuery` locally on every render and
[deliberately discards the copy the route returns](src/hooks/useSearchIntent.ts), so the price,
the bed count and the location are on screen before the request has even left. The
classification arrives later and changes which *card* those filters are shown in.

That is the pattern worth taking from this repo if latency is the constraint: don't make the
model faster, make it non-blocking. The timeline is there so that reads as a measurement rather
than a claim.

## The output contract

Every query produces one `SearchQuery` (`src/lib/jev/types.ts`), which is what a listings
backend would receive. It covers an entire "Applied filters" panel — 36 fields.
Only the ones a query actually mentions are shown below; everything else is `null`, `""`,
`false` or `[]`.

```jsonc
// "Show me 3 bedroom houses to buy in Cupertino under $1M with a backyard"
{
  "intent": "buy",
  "property_type": ["house"],
  "location": { "city": "Cupertino", "state": "CA", "zipcode": "" },
  "price_max": 1000000,
  "beds_min": 3,
  "amenities": ["backyard"],
  "raw_keywords": ["3 bedroom", "house", "Cupertino", "backyard"]
  // + price_min, price_cadence, price_reduced, builder_promotions, baths_min,
  //   sale_status, listing_status, listing_types, tours, days_on_market, sqft_min,
  //   sqft_max, lot_size_min/max, home_age_min/max, hoa_max, garage_min, stories,
  //   excluded, commute, radius_miles, include_nearby_areas, timeframe, sort_by
}
```

```jsonc
// "single story 3 bed under $700k, 20 min drive to downtown Cupertino,
//  no HOA, 2 car garage, half an acre, foreclosures ok"
{
  "intent": "buy",
  "property_type": [],                  // a lot size is not a request for vacant land
  "location": { "city": "Cupertino", "state": "CA", "zipcode": "" },
  "price_max": 700000,
  "beds_min": 3,
  "listing_types": ["foreclosure"],
  "lot_size_min": 21780,                // acres converted, so one unit reaches the backend
  "hoa_max": 0,                         // "no HOA" is a ceiling of zero, not a missing filter
  "garage_min": 2,
  "stories": "single",
  "commute": { "address": "downtown Cupertino", "mode": "driving", "max_minutes": 20 },
  "raw_keywords": ["single story", "3 bed", "20 min", "drive", "downtown Cupertino",
                   "Cupertino", "no HOA", "2 car garage", "half an acre", "foreclosures"]
}
```

The first is asserted field by field in `src/lib/__tests__/contract.test.ts`, along with a
second rental example.

Every constraint lives in exactly one field. "No HOA" is `hoa_max: 0` and not also an
amenity tag; "2 car garage" is `garage_min: 2` and not also `amenities: ["garage"]`; "newly
built" is `listing_types: ["new-construction"]` and not also a feature. Two fields saying
the same thing means a backend filters twice on one constraint, and the weaker of the two
silently does nothing — `src/lib/__tests__/parse.test.ts` § "one constraint, one field"
pins each case.

`raw_keywords` is emitted in **text order** — the order the words appear in the query.
Price wording is deliberately left out of it: `price_max: 1000000` already says "under
$1M" exactly, and repeating it as free text would make a downstream keyword search
double-filter on the same constraint.

## Extraction modes

Who fills those 36 fields is a flag: `EXTRACTION_MODE`, either `hybrid` (the default) or
`jev`, overridable per request with `{ text, mode }`.

- **`hybrid`** — Jev decides *which card* to show. The parsers fill every filter.
- **`jev`** — Jev does that, and also infers the closed-set filters (home type, stories,
  features…) for queries that imply one without naming it: *"nothing with stairs"* →
  `stories: "single"`. Costs 34 extra questions and 2.5× the prompt.

Neither mode lets Jev near a number, a place or a date. Both parse those, always.

| | `hybrid` | `jev` |
|---|---|---|
| Questions per request | 17 | 51 |
| Question schema | 5,588 chars | 14,108 chars |
| Cost per uncached keystroke | ~$0.000073 | ~$0.00018 |
| Numbers, places, addresses, keywords | parsers | parsers |
| Home type, status, listing type, tours, stories, garage, beds, baths, features | parsers | Jev, where the text has no literal |
| `intent`, `sort_by`, how to read an ambiguous amount | Jev | Jev |

**Both modes parse every number and every piece of free text**, and that is a property of
Jev rather than an unfinished feature. Jev answers in exactly three shapes — one label from
a closed list, a truth probability, or a fractional score on a rubric. None of them can
carry a number or a string. There is no request that comes back with `850000` or
`100 Main St` in it, so there is nothing for a flag to switch:

|  | Jev can decide it? |
|---|---|
| Home type, status, foreclosure / auction / 55+, stories, garage bucket, tours, commute mode, the feature checkboxes, bed and bath buckets | **Yes** — each is a classification over a fixed set of labels |
| Price, square feet, lot size, home age, max HOA, days on market, commute minutes, radius, the destination address, city / zip | **No** — not expressible as a label, a probability or a score |

What `jev` mode buys is the *implied* requirement: "room for the boat" becoming
`rv-boat-parking`, "somewhere my parents can visit" becoming `accessibility`, "nothing with
stairs" becoming `stories: "single"`. What it costs is 2.5× the prompt on every keystroke,
to re-derive filters the text usually states outright — which is why `hybrid` is the
default and the extra 34 questions are not sent in it at all.

Where the two disagree, **the literal text always wins**. Jev fills gaps; it never
overwrites a stated filter. "Townhome" is not a probabilistic question.

The table that decides all of this is `src/lib/filters/fields.ts` — one row per field, with
its kind and its owner. The debug panel renders from it, and `fields.test.ts` fails if it
and `SearchQuery` drift apart.

### Seeing which half decided what

Every response carries a `sources` map beside the query: `parser`, `jev` or `none` per
field, where `none` means nobody could fill it. Two modes that both return a `SearchQuery`
of the same shape cannot be compared from the output alone — what differs is the
provenance, so "Under the hood" → *Who decided what* lists every field under the half that
filled it, and the mode toggle there re-classifies the same text the other way. Fields the
toggle would move are marked `◆`, so the flag's effect is visible before you flip it.

## Setup

```bash
npm install
cp .env.example .env.local     # then paste your key into .env.local
npm run dev                    # http://localhost:3000
```

You need an [OpenRouter](https://openrouter.ai/keys) API key with credit on it. Put it in
`.env.local`:

```
OPENROUTER_API_KEY=sk-or-v1-...
```

Two things about that variable:

- It is **not** prefixed `NEXT_PUBLIC_`. Anything so prefixed is inlined into the browser
  bundle, which would publish your key to every visitor. It is read only inside
  `src/app/api/search-intent/route.ts`, which runs on the server — that route handler
  exists for no other reason.
- `.env.local` is gitignored. `.env.example` is the committed template and holds no key.

**This app is online-only by design.** There is no offline or mock classifier to fall back
on. Without a working key the parsers still extract every filter, but the app will say it
could not classify the query rather than guess an intent. That is the intended behaviour:
a confidently wrong card is worse than an honest blank.

### If the dev server won't start

```
Error: EINVAL: invalid argument, readlink '...\.next\static\5LnGKULS5HRJuvl7LgSVi'
```

`next dev` and `next build` share one `.next` directory, and dev cannot start on top of a
build's output — it walks `.next/static` calling `readlink`, and a build leaves a real
directory there named after the build id. `npm run dev` detects and clears that state
automatically (`scripts/dev.mjs`). If you hit it another way, `rm -rf .next` and start again.

```
Error: EPERM: operation not permitted, open '...\.next\trace'
```

Two dev servers in one project folder. Only one can own `.next`, because it holds
`.next/trace` open for writing — but Next does not check, so the second one sees port 3000
taken, announces "using available port 3001 instead", starts anyway, and dies on the trace
file. `npm run dev` now refuses up front and tells you which pid to kill. If you are certain
nothing is running, delete `.dev.pid` and retry.

That guard is two signals, because neither covers the other's case: a `.dev.pid` lockfile
held for the server's lifetime, which is exact but only sees servers started through
`npm run dev`; and a test-open of `.next/trace`, which catches `npx next dev` or an IDE run
configuration but cannot see a server so young it has not compiled anything yet.

The same sharing goes the other way, and it fails silently rather than loudly: `next build`
on top of a dev server's `.next` can hang before printing *Creating an optimized production
build*, with the process alive and idle. Nothing times it out and there is no error to
search for. If a build produces no output for more than a minute or two, kill it,
`rm -rf .next`, and run it again — a clean build of this project takes about 20 seconds.

### Model

Classification is pinned to `typesafe/jev-1.13`. Override with `JEV_MODEL` if you want a
different version. Do not use `typesafe/jev-latest` — it is not routable on OpenRouter and
returns 404.

Cost is roughly $0.042 per million prompt tokens with free completions, and each keystroke
that misses the cache is one request of about 1.7k tokens in `hybrid` mode or 4.2k in `jev`
mode — nearly all of it the question schema, which is resent every time. Typing a full
sentence costs a fraction of a cent; the debug panel shows the exact figure per call.

## How it works

```
keystroke
   │
   ├─► parsers (sync, local)  ──────────────────► SearchQuery   every keystroke
   │
   └─► debounce 120ms ─► /api/search-intent ─► Jev ─► 17 answers
                                                      │
                                                      ├─► decide.ts  ─► which card
                                                      └─► signals.ts ─► which chips
```

### Asking Jev

One request per classification, carrying all 17 core questions (`src/lib/jev/questions.ts`),
plus 34 more in `jev` mode (`src/lib/jev/extended.ts`). They are asked speculatively — every
question on every keystroke — because a second round trip costs more than a few extra
questions in the first one.

```ts
await openrouter.alpha.decisions.create({
  decisionsRequest: {
    model: "typesafe/jev-1.13",
    state: { query: text },      // the data, not a chat transcript
    questions,                   // a map of name -> question
  },
});
```

This is the Decisions API, not chat completions. There is no `messages` array, no
`choices[0].message.content`, and no chain of thought — the response is a map of named
answers, each with a value, a confidence, and a probability per option. Three question
types are used:

| Type     | Returns                           | Used for                                  |
| -------- | --------------------------------- | ----------------------------------------- |
| `choice` | one label + probability per option | intent, price bound, cadence, sort order |
| `noul`   | a probability of being true        | 11 feature and phrasing flags             |
| `score`  | a fractional expected score        | readiness, urgency                        |

None of the three can return a number or a string of free text. That is the constraint the
whole `parse/` directory exists to work around, and the reason the mode flag moves only the
closed-set fields — see [Extraction modes](#extraction-modes).

Two gotchas worth knowing if you write your own questions: `instructions` is required on
every question, and `score.criteria` is an **array** (ordered worst to best), whereas
`choice.criteria` is an object keyed by label. `src/lib/jev/schema.ts` holds small builders
that encode both.

### Not thrashing the UI

Jev's probabilities genuinely move mid-word: "3 bed" leans rent, "3 bed house to buy"
leans buy. Rendering the raw argmax would flip the card between layouts while the user is
still typing, which is the worst thing a morphing UI can do — they lose the thing they
were reading.

So the raw answer is never rendered. `src/lib/decide.ts` runs a four-state machine:

| State       | Meaning                                                |
| ----------- | ------------------------------------------------------ |
| `input`     | nothing is confident enough to show                    |
| `ghost`     | a faint preview of where this is heading               |
| `choose`    | two intents are genuinely close — ask instead of guess |
| `committed` | the card is up                                         |

Leaving a state is deliberately harder than entering it. A challenger intent must either
be overwhelming (≥0.85) or lead for two consecutive keystrokes. A committed card survives
until its own probability collapses or the query is rewritten. `src/lib/signals.ts`
applies the same idea per signal, with paired on/off thresholds so chips do not blink.

A user's own pick from the palette outranks Jev entirely, and survives the query being
*refined* — appending " with a backyard" is a large edit by distance but the original
question is still there in full, so throwing away an explicit choice for it would be
obnoxious. It yields only to a rewrite, or to overwhelming evidence that the added words
contradict the pick.

### Not reading the same digits twice

The same five digits could be a zip, a price, or a floor area; the same "3" could be a bed
count or a day of the month. Parsers therefore publish the character spans they claimed,
and later parsers skip them (`Span` in `src/lib/parse/common.ts`). Order matters, and
`query.ts` documents it: rooms, location, listing, home details and commute claim first,
then price, then timeframe.

Three cases forced this, each of which was a live bug:

- chrono parses `$1M` as "one month", so `"under $1M"` produced `timeframe: "1m"` until the
  price span was reserved.
- `"$300 HOA"` was read as the asking price, until `home.ts` claimed it first.
- `"1200 sqft"` and `"12000 sqft lot"` are the same unit on two different fields, told apart
  only by an adjacent lot word. `inLotContext` in `common.ts` is shared by both parsers
  precisely so they cannot each claim the same figure.

## Layout

```
src/
  app/
    api/search-intent/route.ts   the only place the API key is read
    page.tsx  layout.tsx
    globals.css                  the whole colour theme, as ~12 semantic tokens
  hooks/useSearchIntent.ts       debounce, abort, stale-guard, client cache
  lib/
    jev/
      questions.ts               the 17 core questions — the model's entire job
      extended.ts                34 more, sent only in `jev` mode
      schema.ts                  choice / noul / score builders
      request.ts                 builds the request body — shared with the panel
      client.ts                  Decisions API call, wire -> typed answers
      types.ts                   SearchQuery and the answer envelope
    filters/fields.ts            every field, its kind and its owner
    extraction.ts                the mode flag and the provenance types
    parse/                       everything with a right answer
      common.ts  location.ts  rooms.ts  propertyType.ts
      amenities.ts  price.ts  timeframe.ts  mortgage.ts
      listing.ts  home.ts  commute.ts
      query.ts                   the assembler, and the only Jev overlay
    decide.ts                    the confidence state machine
    signals.ts                   per-signal hysteresis
    lru.ts                       caching, both sides
  components/
    cards/                       one spec-driven card, seven intents
    search/                      the shell, the palette, the tie-breaker
    ui/
      DebugPanel.tsx             the shell — composes the five sections below
      JevRequest.tsx             the exact payload, and every question in it
      JevAnswers.tsx             raw answers, each with its threshold drawn in
      Provenance.tsx             Jev / deterministic code / nobody, per field
      LatencyHud.tsx             round-trip time, and whether it was cached
```

### The theme lives in one block

`globals.css` declares a Tailwind v4 `@theme` of semantic tokens — `canvas`, `surface`,
`raised`, `line`, `ink`, `ink-muted` — and the components only ever name those, never a
shade number. Flipping the app light or dark is editing that one block, because nothing
downstream knows which polarity it is rendering. The previous version spelled the polarity
into ~200 class names, where `neutral-950` meant "background" and `neutral-100` meant
"text"; inverting it meant inverting every one of them by hand. Accent hues are the one
exception and live in `cards/intentSpecs.ts`, since on white an accent has to carry its
contrast in the text rather than in the fill.

## Card types

Seven intents, and one card component. They are not seven components because they differ in
almost nothing that is code — the accent, the wording, and which filters are worth showing.
All of that is data in `src/components/cards/intentSpecs.ts`, and `SearchCard.tsx` renders
it. `mortgage` is the single exception, because it does arithmetic rather than filtering.

| Intent | Card | Accent | Shows | Own code? |
|---|---|---|---|---|
| `buy` | Homes for sale | emerald | where, type, price, beds, baths, size, must-have, sort | no |
| `rent` | Rentals | sky | where, type, rent, beds, baths, must-have, when, sort | no |
| `sold` | Recently sold | violet | where, type, price, beds, size | no |
| `mortgage` | Affordability | amber | price, where — plus the payment breakdown | `MortgageCard.tsx` |
| `valuation` | What's it worth | rose | where, type, beds, baths, size | no |
| `commute` | Search by commute | teal | where, type, price, beds, must-have | no |
| `agent` | Find an agent | indigo | where, type, price | no |

The `Shows` column is deliberately not the same for any two cards, and the omissions are the
interesting part:

- **`rent` formats price monthly** (`monthlyPrice: true`), so `$3,000/mo` rather than `$3M`,
  and it is the only card with a **when** field — a move-in date means nothing to a buyer.
- **`sold` drops must-have and when.** It is a price-history question, and filtering comps by
  amenity narrows the set until it stops being comparable.
- **`valuation` drops price.** The price is what you are asking it for.
- **`mortgage` shows almost nothing.** Two fields, then a breakdown of principal, interest,
  tax, insurance and down payment, with the rate, term and down percent editable — the
  defaults are placeholders, not market data, and a payment presented as fact when the rate
  was guessed is worse than no payment.

Two things this does **not** mean:

- **Omitting a field does not drop it from the output.** `fields` is display only. A rental
  query that mentions square footage still submits `sqft_min`; the rent card just doesn't
  show it. The `SearchQuery` is built by `parse/query.ts`, which has never heard of a card.
- **`amenities` is in the field list but is not a field.** It renders as accent-coloured
  chips below the grid rather than as one value, so `SearchCard` filters it out of the
  `<dl>` and checks for it separately.

Empty fields are omitted rather than rendered as `—`. A card showing "Beds: —" is telling
you about something you never said, and the point of the morph is to show what was
understood, not to put a blank form on screen.

## How to add a new card

Say you want `newConstruction`. Four steps across three files, in this order — the order
matters, because two of them fail silently if you take them out of turn.

**1. `src/lib/jev/types.ts` — add the key to `INTENT_KEYS`.**

This is the root of everything. `CardIntent` is `Exclude<IntentKey, "none">`, so the type
every card touches derives from this array, and `client.ts` validates Jev's answer against
it at runtime.

**2. `src/lib/jev/questions.ts` — add the option to the `intent` question.**

One line of criteria, describing the user's goal rather than the words they used:

```ts
newConstruction: "Looking for a newly built home, a new development or pre-construction",
```

> **Do step 1 first.** `asChoice` coerces any value not in `INTENT_KEYS` to the fallback
> `"none"` and drops it from the probabilities map. Add the option without the key and Jev
> will answer your question correctly, every time, and the app will discard the answer
> without logging anything. The debug panel shows the question being asked, which makes this
> look like a model problem for as long as you believe the panel is showing you everything.

**3. `src/components/cards/intentSpecs.ts` — add an `IntentSpec`.**

```ts
newConstruction: {
  intent: "newConstruction",
  title: "New construction",
  subtitle: "Newly built and pre-construction homes",
  action: "Search new builds",
  icon: Hammer,                    // any lucide-react icon
  accent: ACCENTS.teal,            // or add a hue, following the -50/-200/-600/-700 shape
  fields: ["location", "propertyType", "price", "beds", "baths", "sqft"],
  shortLabel: "New",
},
```

`INTENT_SPECS` is a `Record<CardIntent, IntentSpec>`, so this step is compiler-enforced —
skip it and `tsc` tells you. `fields` is a `FieldKey[]` drawn from a closed set of nine:
`location`, `propertyType`, `price`, `beds`, `baths`, `sqft`, `amenities`, `timeframe`,
`sort`. Order is display order.

**4. `src/components/cards/intentSpecs.ts` — add it to `PALETTE_ORDER`.**

> `PALETTE_ORDER` is an array, not a record, so this one is **not** compiler-enforced. Miss
> it and everything works except the manual override — your card can be chosen by Jev but
> never by the user, which is the half of the UI you are least likely to test yourself.

That is a working card. The remaining step is only for a card that computes.

**5. Optional — a bespoke component, plus a branch in `IntentCard.tsx`.**

`SearchCard` takes `children`, rendered between the filters and the action row. That is the
whole extension mechanism: wrap it, pass the spec, put your own content inside, as
`MortgageCard` does. Then route to it:

```tsx
if (intent === "newConstruction") return <NewConstructionCard … />;
```

Wrap `SearchCard` rather than replacing it. The morph works because `motion`'s shared
`layout` animates elements between positions instead of tearing one card down and building
the next; a card that renders its own `<section>` cross-fades, and looks broken next to the
six that don't.

### Before you add one, check it is not a near-duplicate

The most common way to break this app is to add an intent that overlaps an existing one.
Jev's probability mass splits between two options that mean nearly the same thing, and
`rawState` reads that split exactly as it is meant to — as a tie:

> `top.p - second.p < 0.15`, both above `0.25`, and the leader below `commitAt` of `0.7` →
> state `choose`.

So the user gets the *"did you mean buy or new construction?"* prompt instead of a card, on
a query that used to work. Nothing is broken and no threshold needs tuning — two options
genuinely are indistinguishable, and the fix is sharper criteria or one option instead of
two. `decide.test.ts` is the cheap place to confirm the intent you added can still reach
`committed` on a query aimed at it.

### If the card needs a filter that doesn't exist yet

That is a different job, and a bigger one: `SearchQuery` in `src/lib/jev/types.ts`, a row in
`src/lib/filters/fields.ts`, a parser in `src/lib/parse/`, and a case in `parse.test.ts`.
`fields.test.ts` fails until the first two agree, which is the point of it. See
[The output contract](#the-output-contract).

## Where to look when it's wrong

Open **Under the hood** at the bottom of the page. Read top to bottom it is the pipeline in
order, and each section fails in a different file:

| Section | Shows | Where the bug is if it looks wrong |
|---|---|---|
| **Extraction mode** | the active mode, and what each costs to send | `EXTRACTION_MODE`, or the toggle |
| **Input sent to Jev** | the literal `POST /api/alpha/decisions` body, plus every question and the shape it can answer in | `questions.ts` / `extended.ts` |
| **Jev's answers** | every raw answer *before* gating, with its threshold drawn on the bar | a low answer → the question's `criteria`; a high answer that did nothing → `signals.ts` |
| **Signals, after gating** | only what the UI is allowed to act on | `signals.ts` hysteresis |
| **Who decided what** | every field under Jev, deterministic code, or nobody | a field in the wrong column → `fields.ts` |
| **SearchQuery** | the object a listings API would receive | a parser in `src/lib/parse/` |

The request section is built by `decisionsRequest()` — the same function `client.ts` calls —
so it is the request, not a description of one that may have drifted. It also settles the
question people ask first: Jev is handed `{ query }` and nothing else. No transcript, no
system prompt, no listing data.

Three failures worth naming, because they look alike from the card:

- **A filter the query clearly asked for is missing.** Check its bar in *Jev's answers*
  against the hairline. A noul at 0.58 under a 0.65 floor is the most common cause, and it
  is invisible everywhere else. Sharpen the question's `criteria` before lowering the floor.
- **The card is the wrong kind of search.** The `intent` confidence is in *Jev's answers*
  and the thresholds are in `decide.ts`. If the confidence is right, tune `decide.ts`.
- **A value is wrong rather than absent.** *Who decided what* names the owner — a parser
  file or a question key. If it is a parser, add the sentence to
  `src/lib/__tests__/parse.test.ts` first.

## Scripts

| Command             | Does                                        |
| ------------------- | ------------------------------------------- |
| `npm run dev`       | dev server                                  |
| `npm run build`     | production build                            |
| `npm test`          | vitest, once                                |
| `npm run typecheck` | `tsc --noEmit`                              |
| `npm run check`     | typecheck + tests — run this before pushing |

Tests cover the parsers and both state machines. They make no network calls, so they are
fast and cost nothing; the Jev integration itself is exercised by running the app.
