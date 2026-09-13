# Architecture

The decisions, and what each one cost. Written after the fact from what shipped.

## 0.6.0: the bundle plans, Claude browses

0.5 scraped public Facebook through Apify. Live tests found 84 public posts and zero
customers, while real asks sat in Nextdoor and busy local groups that only a signed-in person
can see. 0.6 drops scraping and uses the owner's own Chrome through Claude in Chrome.

A bundle's server cannot reach Claude in Chrome, so work splits three ways:

| Part | Owns |
|---|---|
| Bundle | Profile, sweep recipes, storage, the speaker gate, dashboard |
| Claude | Browsing, deciding what each post is, the written report |
| Claude Desktop scheduler | When it runs |

Tools that need a browser return a script (`start_onboarding`, `plan_sweep`, `setup_schedule`);
results come back through `save_profile`, `save_findings`, `save_report`.

**The speaker gate** (`src/watch/speaker.js`) is the one place the bundle overrules Claude: a
post Claude calls a lead is reclassified when its author is plainly advertising, hiring,
offering to do the work, or talking shop. Claude's judgement stands otherwise.

**The Facebook job** (`src/watch/facebook.js`) runs in the page as a background job because a
single script call is cancelled at 45 seconds, and needs one real mouse move before post links
appear. Details are in the file header.

The commercial track (Google Maps prospects via Apify) is parked: `src/pipeline/prospects.js`,
`runs.js`, `apify.js` remain but are not exposed as tools.

*Everything below this line describes 0.5 and is kept as history.*

## The constraint everything follows from

A `.mcpb` is **stdio only**. The manifest's `mcp_config` takes `command`, `args` and `env`;
there is no way to declare an HTTP transport. That single fact shapes the rest:

- Business logic is a callable module, not a service
- The dashboard, as a file, cannot fetch — the payload is inlined into the HTML at write time
- Only operations that change what's on the page trigger a rewrite; reads stop at SQLite

The escape hatch is that nothing stops the process from opening its own listener. That's what
`serve_dashboard` does, and it's the one place the file-mode constraint is lifted — at the
cost of owning the lifecycle ourselves.

## It drafts, it doesn't post

Meta exposes no API that lets a personal account search public posts and comment on them.
Automating a personal account violates Meta's terms and risks the account and the connected
business page. Nextdoor is stricter.

The work being replaced is *finding*, not typing. Ten drafted comments is ten minutes of
posting. So the bundle finds, filters, ranks and drafts; a human posts.

Two things fall out of that for free: every public message is approved before it exists, and
there are no platform credentials in the bundle at all.

## Nextdoor is out

The only Apify actor that reads Nextdoor *posts* requires login credentials and session
cookies, is poorly rated, and costs several times Facebook per item. The others read business
directories, which is the wrong end of the funnel. Facebook alone clears the daily target.

## Two timeout ceilings, neither raisable

The original implementation called Apify's synchronous endpoint inside the tool handler. It
died. There were two independent reasons:

| Ceiling | Value | Raisable |
|---|---|---|
| Claude Desktop tool call | ~4 min | No — the `timeout` field in `claude_desktop_config.json` is ignored |
| Apify `run-sync-get-dataset-items` | 300 s, then HTTP 408 | No — documented behaviour |

Even an unlimited MCP timeout would still have hit Apify's 300 seconds. The fix could not be
a bigger timeout; it had to be not waiting.

**The run ledger.** A `run` table records every started search. `POST /v2/acts/{id}/runs`
returns immediately with a run id and dataset id. `find_leads` starts everything, spends a
bounded 60 seconds collecting what already landed, and answers. `check_leads` picks up the
rest — idempotent, so an ingested run is never collected twice and a failed run is retired
rather than retried forever.

Eight searches also now start concurrently instead of sequentially, which removed most of the
wall clock on its own.

**Progress notifications** are sent where the host provides a `progressToken`. The MCP SDK's
`resetTimeoutOnProgress` restarts the client's countdown on each one. It's a free win where
honoured and a no-op where not — and it does nothing about Apify's ceiling, so it is never
the load-bearing fix.

## Storage

SQLite in a stable per-user directory:

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/rc-lead-finder` |
| Windows | `%APPDATA%\rc-lead-finder` |
| Linux | `$XDG_DATA_HOME/rc-lead-finder` |

**This was wrong at first.** The store lived at `${__dirname}/.data` — inside the installed
extension folder. Claude Desktop installs each version into its own directory, so every
version bump silently started from an empty database. On first open the client now also
rescues a `leads.db` left behind by an older bundle.

Everything found is kept. Leads past the daily cap are stored as `skipped` rather than
discarded, so raising the cap surfaces yesterday's overflow instead of re-scraping. Filtered
prospects keep the reason they were filtered, so a bad call is auditable.

`data.json` and `dashboard.html` are derived views, rewritten on every operation that changes
what's on the page. SQLite is the record.

## Rebuilding from Apify

The run ledger is local; the datasets are not. `import_past_runs` asks *Apify* what has
already run rather than asking our own table, so a fresh install can rebuild itself from runs
already paid for. Matching is on actor name, and imports are idempotent.

`npm run fixtures` does the same thing for tests, caching real datasets to disk. A live
scrape costs money and returns something different every time; a cached one is free,
repeatable, and shaped exactly like the thing that broke.

## `resources.yaml` is the source of truth

Everything under `src/` is a projection of it:

| Surface | Derived from |
|---|---|
| `db/schema.sql` | `resources[].fields` |
| `pipeline/<resource>.js` | `operations[]` |
| Tool registrations | `tools[]` |
| `data.json` shape | `dashboard.panels` |
| `user_config` | source tools needing credentials |

The rule is one-directional: **never edit a generated file to fix something.** Change
`resources.yaml` and rewrite. A fix that lives only in `src/` dies at the next regeneration.

Tools stay coarse. A dashboard panel needing three filtered queries does not justify three
tools — the panel reads `data.json`, which one operation produced. Tool count is the quiet
usability killer: too many, and the model picks wrong.

## Node, deliberately

Claude Desktop ships Node; Python leans on system Python. Native modules break
cross-platform bundles on both.

- SQLite is `node:sqlite`, built in from Node 22. `better-sqlite3` is native and would force
  per-platform bundles or fail at launch
- Apify is plain `fetch` against the REST API — no SDK to vendor
- Tests are `node:test`

One runtime dependency, no `.node` binaries, one bundle for every platform.

## Two bugs worth recording

**Runs marked ingested before the rows were written.** A throw during ingest retired the run
and lost posts Apify had already charged for — unrecoverable through the ledger. Now: insert,
then mark.

**A spread into a SQL statement.** The prospect insert spread a working object carrying
`address_city`, a field that only fed the email draft. `node:sqlite` rejects any named
parameter the SQL does not declare, and `address_city: undefined` does not remove the key.
Commercial ingest threw and saved nothing. Parameters are now listed explicitly.

Both were found by running against real data, not synthetic fixtures.

## Known limits

- The local dashboard server has no auth beyond binding to `127.0.0.1`. Any process on the
  same machine can read it. Proportionate for a single-operator laptop, not for anything
  shared
- The served dashboard dies with the extension process. The file snapshot is the durable
  artifact
- No write-back anywhere. Lead status is local only, which is correct here because the
  systems of record are a person's Facebook account and inbox
