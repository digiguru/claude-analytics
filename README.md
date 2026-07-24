# Claude Analytics Explorer

Query your organisation's **all-product Claude usage** (chat, Claude Code, Cowork, Claude Design, Office Agent) from a CLI and a tiny self-hosted React app, and join the per-developer metrics to any attributes you supply in a CSV (e.g. Level, BU, Role, practice area) so you can analyse usage, cost, and adoption across whatever dimensions your CSV happens to carry.

## What it talks to

The **[Claude Enterprise Analytics API](https://platform.claude.com/docs/en/manage-claude/analytics-api)** under `https://api.anthropic.com/v1/organizations/analytics/`. It returns per-user, per-day activity across all Claude products plus org-wide cost, token usage, and adoption — and identifies users by `email`, which is the join key against your CSV.

> Needs a **Claude Enterprise Analytics API key** (`sk-ant-api01-…`, `read:analytics` scope), created by the org primary owner in **claude.ai → Organization settings → API**. The key is held server-side only and never reaches the browser. (This is a different key from a Console Admin key or a standard Claude API key.)

Endpoints used: `/summaries`, `/users`, `/usage_report`, `/user_usage_report`, `/cost_report`, `/user_cost_report`.

## Layout

```
packages/core    shared TS: API client, SQLite cache, CSV parse, join, aggregate
apps/cli         commander CLI (sync / overview / group / member / export)
apps/server      Fastify backend-for-frontend; also serves the built web app
apps/web         React + Vite + Recharts UI (Overview · Groups & products · Members)
```

## Setup

```bash
npm install
cp .env.example .env      # put your Analytics key in ANTHROPIC_ANALYTICS_API_KEY
```

CSV format — the **only** required column is `email` (the join key). Every other
column becomes a dimension you can break down by; nothing is hard-coded. With
`export.csv` that's `BU, Role, Title, Name, Level, status, practiceArea, champions`.
Run `npm run cli -- columns` to list what's available in your file.

## CLI

```bash
# pull all analytics for a date range into the local SQLite cache
npm run cli -- sync --from 2026-06-01 --to 2026-06-10

# org-wide summary: total cost, cost by product, heaviest days, top 5 users
npm run cli -- overview

# rank individual users by cost (or tokens)
npm run cli -- top --by cost --limit 10
npm run cli -- top --by tokens

# list the columns available to group by in your CSV
npm run cli -- columns

# aggregate by ANY CSV column (optionally restricted to one product)
npm run cli -- group --group-by Level
npm run cli -- group --group-by BU --product claude_code

# one member across all products
npm run cli -- member someone@yourorg.com

# write a grouped view to CSV
npm run cli -- export --group-by Level --out by-level.csv
```

## Web app

```bash
npm run dev      # backend + Vite dev server (Vite proxies /api to the backend)
# or single-process production-style:
npm run build && npm start
```

Open the printed localhost URL, sync a date range, (optionally) upload a CSV, then explore:
- **Overview** — daily cost & active users, cost by product, heaviest days.
- **Groups & products** — aggregate any metric by any column in your CSV (the dropdown is populated from the file), filter to a product, export CSV.
- **Members** — per-person cross-product usage, cost-by-product, daily trends.

## Notes on the data

- Available from **2026-01-01** onward. Activity/summaries lag ~3 days; cost/usage refresh every ~4h and can revise for up to 30 days. `sync` clamps date ranges to what the API will serve.
- Cost amounts arrive as decimal **fractional cents** — displayed as dollars.
- A date range is fetched day-by-day (activity) / in ≤31-day windows (cost & usage), then cached in SQLite so re-querying is instant. Re-syncing a day is idempotent.
- Users with analytics activity but no CSV row are surfaced as **“(unmatched)”**, never dropped.
