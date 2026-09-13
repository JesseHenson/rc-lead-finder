# RC Market Watch

A Claude Desktop extension (`.mcpb`) that watches a service business's own neighbourhood on
Nextdoor and Facebook groups and reports three things:

- **Leads** — people asking to hire for the services you offer, with a suggested reply
- **Market view** — what competitors are posting and charging, and demand triggers like storms or HOA letters
- **Opportunities** — services neighbours ask for that you don't offer yet, counted over time

Built for a one-truck pressure-washing business near Houston. Nothing in it is specific to
pressure washing: services, search words, and places to look are set in an interview.

## It reads. You post.

It uses your own Chrome through Claude in Chrome, signed in to your own accounts. It never
posts, comments, reacts, messages, or joins a group. Replies are drafted for you to send.

## Install

1. Download the `.mcpb` from [Releases](../../releases) and open it in Claude Desktop.
2. Connect Claude in Chrome, and sign in to Facebook and Nextdoor in Chrome.
3. In a new chat, turn on Claude in Chrome and say: **Set up my market watch.**

Requires Claude Desktop with Claude in Chrome, Chrome, and Node 22 or newer (bundled with Claude Desktop).

## What happens

| Step | Tool | What it does |
|---|---|---|
| Setup | `start_onboarding`, `save_profile`, `show_profile` | Interview: services, towns, groups, words, competitors, schedule |
| Sweep | `plan_sweep` | Browser instructions for this sweep, built from the setup |
| Save | `save_findings`, `save_report` | Stores what Claude found and its written summary |
| Look | `serve_dashboard`, `show_findings` | Local dashboard: Today, Leads, Signals, Competitors, Opportunities |
| Repeat | `setup_schedule` | Daily and weekly runs as Claude Desktop scheduled tasks |
| Follow up | `mark_lead`, `query_data` | Record outcomes; read-only SQL |

Data stays on your computer, in `~/Library/Application Support/rc-lead-finder/` on macOS.

## Scheduled runs need

Claude Desktop open, the computer awake, Chrome open and signed in, and Claude in Chrome
connected. Run each new scheduled task once with **Run now** and choose **Always allow**.

## Develop

    npm install
    npm test
    mcpb validate manifest.json
    mcpb pack . dist/rc-lead-finder-<version>.mcpb

## License

MIT
