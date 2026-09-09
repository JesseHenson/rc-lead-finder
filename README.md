# RC Lead Finder

A Claude Desktop extension (`.mcpb`) that finds local pressure-washing leads and drafts
what to say about them. It does not post anything. You do.

Built for a one-truck pressure-washing business in the Houston area that was about to hire
someone for two hours a day to do this by hand.

## What it does

**Residential.** Searches public Facebook posts in a service area for people asking for
pressure washing, house washing, window cleaning or parking-lot cleaning. Drops competitors
advertising. Scores what's left on how recent it is, whether it's a real ask, and whether
anyone has answered yet. Drafts a short comment tagging your page.

**Commercial.** Pulls freestanding small businesses in the same area, drops corporate and
big-footprint locations, keeps franchise locations where the operator actually controls
purchasing, finds a contact email, and drafts a first-touch note.

Both land on one page you check at lunch, with a copy button and a next action per lead.

## It drafts. You post.

This is the design decision everything else follows from.

Meta has no API that lets a personal account search public posts *and* comment on them.
Driving a personal account with a script is against Meta's terms, and the realistic downside
is losing the account and the business page with it. Nextdoor is stricter still.

So the bundle does the finding — which is the part that actually takes two hours a day — and
you spend ten minutes posting. Ten comments is ten minutes. It also means every message is
approved by a human before it exists publicly, structurally rather than as a setting.

## Install

Download the `.mcpb` from [Releases](../../releases) and open it in Claude Desktop.

You need one thing: an [Apify](https://apify.com) API token, from Settings → Integrations.
Every search runs through Apify — no Meta credentials, nothing signs in as you.

Running costs are small: roughly $0.16 a day for the residential searches, and about $1.20
for a one-off commercial sweep of a territory.

## Tools

| Tool | What to ask for |
|---|---|
| `set_territory` | "Set my service area to Spring, TX" |
| `find_leads` | "Find me some leads" — starts searches, returns without waiting |
| `check_leads` | "Check on those searches" — collects whatever finished |
| `import_past_runs` | "Import my past Apify runs" — rebuilds the store from runs already paid for |
| `show_leads` | "What have I got?" |
| `query_leads` | "How many prospects have an email?" — read-only SQL |
| `serve_dashboard` | "Open the dashboard" — a local page that refreshes itself |
| `mark_lead` | "I posted that one" |

## How it's built

Node only. No Python, no native modules, one runtime dependency
(`@modelcontextprotocol/sdk`), so the same bundle runs on macOS, Windows and Linux.

- **Store** — SQLite via `node:sqlite`, in a stable per-user directory. Everything found is
  kept, including leads over the daily cap and prospects that were filtered out, with the
  reason
- **Searches don't block** — Apify runs are started and collected later. Claude Desktop kills
  a tool call at about four minutes and Apify's synchronous endpoint gives up at 300 seconds;
  neither is raisable, so nothing waits
- **Dashboard** — one template, two modes. As a file it renders an inlined snapshot; served
  over loopback it polls its own JSON and refreshes
- **`resources.yaml` is the source of truth.** The schema, pipeline and tool list are
  projections of it. Fixes go there, never into a generated file

See [ARCHITECTURE.md](ARCHITECTURE.md) for the decisions and what they cost.

## Development

```bash
npm install
npm test                 # 39 tests
npm run fixtures         # APIFY_TOKEN=... caches real datasets for offline testing
npx mcpb pack . dist/rc-lead-finder-0.5.0.mcpb
```

`npm run fixtures` pulls datasets from runs that already happened. Testing against a live
scrape costs money and gives a different answer every time; a cached dataset is free and
repeatable — and real data is what caught the bug that broke commercial ingest.

## Limits

- **Facebook only.** Nextdoor's post-level scrapers need your login and session cookies. Not
  worth the risk for the coverage
- **The dashboard is a snapshot** unless you're running the local server, and that server
  lives only as long as the extension process
- **The local server has no auth beyond loopback.** Fine for a single-operator laptop
- **`node:sqlite` needs Node 22+**, which the manifest declares

## License

MIT
