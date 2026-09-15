# Claude Analytics Explorer

Query your organisation's **all-product Claude usage** (chat, Claude Code, Cowork, Claude Design, Office Agent) from a CLI and a tiny self-hosted React app, and join the per-developer metrics to any attributes you supply in a CSV (e.g. Level, BU, Role, practice area) so you can analyse usage, cost, and adoption across whatever dimensions your CSV happens to carry.

## Run it locally

Start to finish, from a fresh checkout to a running app. Should take about five minutes.

### Prerequisites

- **Node.js 22.12 or newer** (`node --version`). If you don't have it, install via [nvm](https://github.com/nvm-sh/nvm) (`nvm install 22`) or from [nodejs.org](https://nodejs.org).
- Git, and read access to this repo.

### 1. Get the code and install

```bash
git clone https://github.com/and-digital/internal-claude-spend-analysis.git
cd internal-claude-spend-analysis
npm install
```

(If you've already checked it out, just `cd` in and run `npm install`.)

### 2. Add your Analytics API key

The app reads all its data from the Claude Enterprise Analytics API, which needs one credential.

```bash
cp .env.example .env
```

Now open `.env` and set `ANTHROPIC_ANALYTICS_API_KEY`. This is a **Claude Enterprise Analytics API key**:

- It starts with `sk-ant-api01-…` and has the `read:analytics` scope.
- It's created by your org's **primary owner** in **claude.ai → Organization settings → API**.
- It is **not** a Console Admin key and **not** a standard Claude API key — those won't work here.
- If you don't have one, ask whoever owns your Claude organisation to generate it for you.

The key stays server-side only (in your local `.env`, which is git-ignored) and is never sent to the browser.

Nothing else in `.env` is required to start — `CSV_PATH`, `PROJECTS_PATH`, `DB_PATH`, and `PORT` all have sensible defaults.

### 3. (Optional) Add your data export CSV

The app works with **just the API key** — every user is identified by email and shown individually. A CSV is what lets you slice usage by attributes like Level, Business Unit, or Role.

The "data export" is a CSV of your people, exported from wherever your org keeps that directory (HR system, people spreadsheet, etc.). The rules:

- The **only required column is `email`** — that's the join key against the analytics data.
- **Every other column** you include automatically becomes a dimension you can group and break down by. Nothing is hard-coded.
- See [`sample.csv`](./sample.csv) for the exact shape.

You have two ways to supply it:

- **Web app:** upload it in the UI after the app is running (easiest — no config needed).
- **CLI / a default for the app:** save the file into the project (e.g. `export.csv`) and point `CSV_PATH` at it in `.env`.

> `export.csv` is git-ignored, so real people data never gets committed.

### 4. Start the app

```bash
npm run dev
```

This builds the shared core, starts the backend, and starts the Vite dev server. Open the localhost URL it prints (default [http://localhost:3000](http://localhost:3000)).

Then, in the UI:

1. **Sync a date range** — this pulls analytics into a local SQLite cache. Try a recent week to start (data is available from 2026-01-01 onward and lags ~3 days).
2. **(Optional) Upload your CSV** to unlock attribute breakdowns.
3. **(Optional)** Set up [`config/projects.yaml`](#projects--teams-temporal-groupings) for date-aware Project/Team/Client groupings.
4. Explore the **Overview**, **Groups & products**, and **Members** tabs (described below).

That's it — you're running locally. For a production-style single process instead of the dev servers, use `npm run build && npm start`.

### Linting and formatting

`npm run lint` (ESLint, flat config in `eslint.config.js`) and `npm run format:check` (Prettier); `npm run lint:fix` / `npm run format` to apply fixes. Both run in CI. Note: `typescript-eslint` doesn't yet support TypeScript 7, so the root `typescript` devDependency is aliased to a TS 6 compatibility shim (`@typescript/typescript6`) purely for the linter's own module resolution — every workspace's actual build and `tsc`/`vite build` still run on real TypeScript 7 via the separately-aliased `@typescript/native` devDependency (`node_modules/.bin/tsc`). Nothing in application code imports the `typescript` package directly, so this only affects tooling.

---

## What it talks to

The **[Claude Enterprise Analytics API](https://platform.claude.com/docs/en/manage-claude/analytics-api)** under `https://api.anthropic.com/v1/organizations/analytics/`. It returns per-user, per-day activity across all Claude products plus org-wide cost, token usage, and adoption — and identifies users by `email`, which is the join key against your CSV.

Endpoints used: `/summaries`, `/users`, `/usage_report`, `/user_usage_report`, `/cost_report`, `/user_cost_report`.

## Layout

```
packages/core    shared TS: API client, SQLite cache, CSV parse/projects.yaml parse, join, aggregate
apps/cli         commander CLI (sync / overview / group / member / export / projects)
apps/server      Fastify backend-for-frontend; also serves the built web app
apps/web         React + Vite + Recharts UI (Overview · Groups & products · Members)
```

## Projects & teams (temporal groupings)

The attributes CSV gives every person one fixed value per column, forever. Real
project staffing isn't fixed — people move between projects and teams over
time — so there's a second, date-aware source of groupings: `config/projects.yaml`.

```bash
cp config/projects.sample.yaml config/projects.yaml
```

Each project has a name, an optional `team` and `client`, and a list of members
with `start`/`end` dates (inclusive, `YYYY-MM-DD`; blank/omitted `end` = still
on it). See [`config/projects.sample.yaml`](./config/projects.sample.yaml) for
the exact shape. The rules:

- The **only required fields** are a project `name` and each member's `email`
  and `start` date.
- A person on **more than one project at once** has that day's cost split
  between them by `allocation` — a ratio between the *concurrent* memberships,
  not an absolute share (so one active project is always 100% of that day,
  whatever its `allocation` says; omit it for an even split).
- Days with **no active membership** are grouped as `Unassigned`, so totals
  always reconcile with your true spend.

Once loaded (via `PROJECTS_PATH` in `.env`, or "Upload projects YAML" in the
web UI), **Project**, **Team** and **Client** appear as extra "Timeline" Group
By options on the Groups & products page, alongside your CSV columns, complete
with a cost-over-time chart. They're also filterable — hiding a project in the
member filter removes exactly that project's (fractional) share of the day's
cost from every other view, not the whole person.

`config/projects.yaml` is git-ignored, like `export.csv` — only the sample
ships in the repo.

### Cycles (milestones within a project)

Each project can also declare its own `cycles` — named periods like sprints or
delivery phases, timed however that team runs them:

```yaml
projects:
  - name: "Flow Team #1 - Chatbot"
    team: Flow
    cycles:
      - name: Discovery
        start: 2026-03-25       # end omitted -> runs to the day before the next cycle
      - name: Build
        start: 2026-04-14
        end: 2026-05-17         # explicit inclusive end
      - name: Harden
        start: 2026-05-18       # last cycle, no end -> open-ended
    members:
      - email: someone@yourorg.com
        start: 2026-03-25
```

Cycles never overlap: an omitted `end` runs up to (but not including) the next
cycle's `start`, and the final cycle's omitted `end` stays open-ended. Days
inside a project but outside every declared cycle show up as their own
**"(no cycle)"** bar, so the numbers always add up to the project's real total.

Where cycles show up:

- **Groups & products** — pick a single **Project** (the new dropdown next to
  Group by, or by filtering the member picker down to one project) and a
  **Cycle** option appears on the cost-over-time chart's Day/Week/Month
  control, so each bar is one cycle instead of a fixed period.
- **All three tabs** (Groups, Overview, Members) annotate their time charts with
  each project's cycles — a labelled band when exactly one project is in view,
  or a labelled lane per project when several are. A "Show/Hide cycles" toggle
  turns this off.

Run `npm run cli -- projects` any time to validate a projects file — it lists
every project's cycles with their resolved date ranges and flags anything that
looks off (duplicate names, overlapping windows, a cycle outside anyone's
assignment, and so on).

## CLI

The CLI is an alternative to the web app that hits the same cache. Run `npm run cli -- columns` any time to list the dimensions available in your CSV.

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

# aggregate by ANY CSV column, or @project/@team/@client (optionally restricted to one product)
npm run cli -- group --group-by Level
npm run cli -- group --group-by BU --product claude_code
npm run cli -- group --group-by @project

# validate config/projects.yaml — lists every project and any warnings
npm run cli -- projects

# one member across all products
npm run cli -- member someone@yourorg.com

# write a grouped view to CSV
npm run cli -- export --group-by Level --out by-level.csv
```

## Web app

Started with `npm run dev` (see [Run it locally](#run-it-locally)). The three tabs:

- **Overview** — daily cost & active users, cost by product, heaviest days.
- **Groups & products** — aggregate any metric by any CSV column or by Project/Team/Client (if a projects file is loaded), with a cost-over-time chart, filter to a product, export CSV. Pick a **Secondary group by** (any other dimension, including **Member**) to drill into each group's own breakdown — e.g. Group by Team, Secondary by Member, to see who made up a team's cost.
- **Members** — per-person cross-product usage, cost-by-product, daily trends.

## Security & deployment constraints

The server has **no authentication** and binds to `127.0.0.1` only, by design — that binding is the only thing standing between an anonymous caller and every employee email, per-person cost/token spend, HR-ish CSV attributes, and the ability to trigger a sync against the org's analytics key. **Do not expose this server beyond localhost** — no `--host`, no SSH port-forward exposing it further, no container port mapping to a reachable interface — without adding real authentication first. State-mutating endpoints (`/api/csv`, `/api/projects`, `/api/sync`) additionally reject cross-origin requests (a mismatched `Origin` header), which defends against a malicious page in the same browser silently triggering them, but is not a substitute for the localhost-only binding.

## Notes on the data

- Available from **2026-01-01** onward. Activity/summaries lag ~3 days; cost/usage refresh every ~4h and can revise for up to 30 days. `sync` clamps date ranges to what the API will serve.
- Cost amounts arrive as decimal **fractional cents** — displayed as dollars.
- A date range is fetched day-by-day (activity) / in ≤31-day windows (cost & usage), then cached in SQLite so re-querying is instant. Re-syncing a day is idempotent.
- Users with analytics activity but no CSV row are surfaced as **“(unmatched)”**, never dropped.
- Group views report two headcounts, not one: **seats** (everyone the org assigned to the group, including people who never touched Claude) and **active users** (only those with real spend or activity), with a per-seat and a per-active-user average cost alongside each. Before this, a single `developers` figure silently counted every seat, so `avgCostPerDeveloper` was actually a per-seat number despite its name — if you compared numbers against an older export, expect the old figure to match the new `avg_cost_per_seat_usd` column, not `avg_cost_per_active_user_usd`.
