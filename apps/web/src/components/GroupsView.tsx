import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  api,
  MEMBER_DIMENSION_ID,
  MEMBER_DIMENSION_LABEL,
  PRODUCTS,
  tokens,
  usd,
  type GroupDayRow,
  type GroupRow,
  type GroupsResponse,
  type ProjectCycles,
  type TimelineDimension,
} from "../api.js";
import { CHART_MARGIN, COLORS, NEUTRAL_COLOR, Y_AXIS_WIDTH, wrapLabel, xAxisProps } from "../charts.js";
import { bucketByCycle, snapBand, type ChartBucket } from "../cycles.js";
import { bucketSeries, type Granularity } from "../series.js";
import { useUrlParam } from "../url.js";
import { CycleRail } from "./CycleRail.js";
import { NestedGroupsTable } from "./NestedGroupsTable.js";
import { SortableTable, type Column } from "./SortableTable.js";

/** Chart/table ordering: by metric magnitude ("size", default) or by group name ("alpha"). */
type SortOrder = "size" | "alpha";

interface Props {
  from: string;
  to: string;
  dimensions: string[];
  timelineDimensions: TimelineDimension[];
  projectCycles: ProjectCycles[];
  filterQuery?: string;
  onError: (msg: string | null) => void;
}

type Metric = { key: keyof GroupRow; label: string; money?: boolean };
const METRICS: Metric[] = [
  { key: "costCents", label: "Total cost", money: true },
  { key: "avgCostPerDeveloper", label: "Avg cost / developer", money: true },
  { key: "totalTokens", label: "Total tokens" },
  { key: "ccSessions", label: "Claude Code sessions" },
  { key: "chatMessages", label: "Chat messages" },
  { key: "activeUserDays", label: "Active user-days" },
];

const columns: Column<GroupRow>[] = [
  { key: "key", label: "Group", value: (r) => r.key },
  { key: "developers", label: "Devs", numeric: true, value: (r) => r.developers },
  { key: "activeUserDays", label: "Active days", numeric: true, value: (r) => r.activeUserDays, render: (r) => r.activeUserDays.toFixed(1) },
  { key: "costCents", label: "Cost", numeric: true, value: (r) => r.costCents, render: (r) => usd(r.costCents) },
  { key: "avgCostPerDeveloper", label: "$/dev", numeric: true, value: (r) => r.avgCostPerDeveloper, render: (r) => usd(r.avgCostPerDeveloper) },
  { key: "totalTokens", label: "Tokens", numeric: true, value: (r) => r.totalTokens, render: (r) => tokens(r.totalTokens) },
  { key: "chatMessages", label: "Chat", numeric: true, value: (r) => r.chatMessages },
  { key: "ccSessions", label: "CC sessions", numeric: true, value: (r) => r.ccSessions },
  { key: "ccLocAdded", label: "CC loc+", numeric: true, value: (r) => r.ccLocAdded },
  { key: "coworkMessages", label: "Cowork", numeric: true, value: (r) => r.coworkMessages },
  { key: "webSearches", label: "Web", numeric: true, value: (r) => r.webSearches },
];

// Must match core's UNASSIGNED_KEY (packages/core/src/projects.ts) — the bucket for
// days with no active project/team/client membership.
const UNASSIGNED_KEY = "Unassigned";
const OTHER_KEY = "Other";
const MAX_STACK_KEYS = 8;
const GRANULARITIES: { key: Granularity; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

/** Pivot the daily group×date rows into one row per bucket with a cost column per
 *  key, capping the stack at the top MAX_STACK_KEYS keys (by total cost) plus an
 *  "Other" catch-all. Unassigned always renders, last, regardless of rank. Buckets
 *  by day/week/month, or — when scoped to one project with cycles — by cycle.
 *  Takes explicit timeseries/keys (rather than the whole GroupsResponse) so the
 *  caller can choose the primary or secondary breakdown to chart. */
function useStackedSeries(
  timeseries: GroupDayRow[],
  keys: string[],
  bucket: ChartBucket,
  cycles: ProjectCycles["cycles"],
) {
  return useMemo(() => {
    if (timeseries.length === 0) return { rows: [] as Record<string, number | string>[], keys: [] as string[] };

    const rankedKeys = keys.filter((k) => k !== UNASSIGNED_KEY);
    const hasUnassigned = keys.includes(UNASSIGNED_KEY);
    const top = new Set(rankedKeys.slice(0, MAX_STACK_KEYS));
    const hasOther = rankedKeys.length > top.size;

    const byDate = new Map<string, Record<string, number | string>>();
    for (const row of timeseries) {
      let acc = byDate.get(row.date);
      if (!acc) byDate.set(row.date, (acc = { date: row.date }));
      const label = row.key === UNASSIGNED_KEY || top.has(row.key) ? row.key : OTHER_KEY;
      acc[label] = (Number(acc[label]) || 0) + row.costCents / 100;
    }
    const daily = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const bucketed = bucket === "cycle" ? bucketByCycle(daily, cycles) : bucketSeries(daily, bucket, {});

    const outKeys = [...rankedKeys.filter((k) => top.has(k)), ...(hasOther ? [OTHER_KEY] : []), ...(hasUnassigned ? [UNASSIGNED_KEY] : [])];
    return { rows: bucketed, keys: outKeys };
  }, [timeseries, keys, bucket, cycles]);
}

export function GroupsView({ from, to, dimensions, timelineDimensions, projectCycles, filterQuery, onError }: Props) {
  const [dimension, setDimension] = useUrlParam("groupBy", "");
  const [secondaryRaw, setSecondary] = useUrlParam("secondary", "");
  const [product, setProduct] = useUrlParam("product", "");
  const [project, setProject] = useUrlParam("project", "");
  const [metricKey, setMetricKey] = useUrlParam("metric", String(METRICS[0]!.key));
  const [sortOrderRaw, setSortOrder] = useUrlParam("sort", "size");
  const [bucketRaw, setBucket] = useUrlParam("granularity", "week");
  const [showCyclesRaw, setShowCycles] = useUrlParam("cycles", "1");
  const [data, setData] = useState<GroupsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const metric = METRICS.find((m) => String(m.key) === metricKey) ?? METRICS[0]!;
  const sortOrder: SortOrder = sortOrderRaw === "alpha" ? "alpha" : "size";
  const showCycles = showCyclesRaw !== "0";

  const projectNames = useMemo(
    () => (timelineDimensions.find((d) => d.id === "@project")?.values ?? []).filter((v) => v !== UNASSIGNED_KEY),
    [timelineDimensions],
  );

  // Secondary (drill-down) breakdown options: every Group By choice, plus the
  // always-available Member dimension, minus whichever is currently primary
  // (grouping by the same thing twice is meaningless).
  const secondaryOptions = useMemo(() => {
    const all = [
      ...timelineDimensions.map((d) => ({ id: d.id, label: d.label })),
      { id: MEMBER_DIMENSION_ID, label: MEMBER_DIMENSION_LABEL },
      ...dimensions.map((d) => ({ id: d, label: d })),
    ];
    return all.filter((d) => d.id !== dimension);
  }, [timelineDimensions, dimensions, dimension]);
  const secondary = secondaryOptions.some((d) => d.id === secondaryRaw) ? secondaryRaw : "";
  const secondaryLabel = secondaryOptions.find((d) => d.id === secondary)?.label ?? secondary;
  const cyclesForProject = useCallback(
    (name: string) => projectCycles.find((p) => p.project === name)?.cycles ?? [],
    [projectCycles],
  );

  // Default Group By once dimensions load (unless a URL/previous pick is still valid):
  // prefer the first timeline facet (Project) when a projects file is loaded, else the
  // first CSV column.
  useEffect(() => {
    const timelineIds = timelineDimensions.map((d) => d.id);
    if (timelineIds.includes(dimension) || dimensions.includes(dimension)) return;
    if (timelineIds.length) setDimension(timelineIds[0]!, true);
    else if (dimensions.length) setDimension(dimensions[0]!, true);
  }, [dimensions, timelineDimensions, dimension, setDimension]);

  const load = useCallback(async () => {
    if (!dimension) return;
    setLoading(true);
    onError(null);
    try {
      setData(
        await api.groups(
          dimension,
          from || undefined,
          to || undefined,
          product || undefined,
          filterQuery,
          project || undefined,
          secondary || undefined,
        ),
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [dimension, product, project, secondary, from, to, filterQuery, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  // The project this chart is effectively scoped to: the explicit picker, else
  // (when it settles to exactly one) the active member filter. Drives Cycle
  // granularity + annotation; never auto-selects Cycle, only offers it.
  const scopeProject = project || (data?.activeProjects.length === 1 ? data.activeProjects[0]! : null);
  const scopeIsInferred = !project && Boolean(scopeProject);
  const scopeCycles = scopeProject ? cyclesForProject(scopeProject) : [];
  const cycleAvailable = scopeCycles.length > 0;

  const bucket: ChartBucket = bucketRaw === "cycle" && cycleAvailable ? "cycle" : bucketRaw === "day" || bucketRaw === "month" ? bucketRaw : "week";

  // Order groups for the chart (and the table's default) by the selected metric or by name.
  const orderedGroups = useMemo(() => {
    const groups = [...(data?.groups ?? [])];
    if (sortOrder === "alpha") {
      groups.sort((a, b) => a.key.localeCompare(b.key));
    } else {
      groups.sort((a, b) => Number(b[metric.key]) - Number(a[metric.key]));
    }
    return groups;
  }, [data, sortOrder, metric.key]);

  const chartData = orderedGroups.map((g) => ({ name: g.key, value: Number(g[metric.key]) }));
  // Chart stacks by the secondary dimension when one is set (e.g. Group by
  // Team, Secondary by Member -> the chart stacks by member), else the primary.
  const chartTimeseries = data?.secondaryDimension ? data.secondaryTimeseries : data?.timeseries ?? [];
  const chartKeys = data?.secondaryDimension ? data.secondaryKeys : data?.keys ?? [];
  const stacked = useStackedSeries(chartTimeseries, chartKeys, bucket, scopeCycles);
  const stackColor = useMemo(() => {
    const colorByKey = new Map<string, string>();
    let i = 0;
    for (const key of stacked.keys) {
      if (key === UNASSIGNED_KEY) colorByKey.set(key, NEUTRAL_COLOR);
      else if (key === OTHER_KEY) colorByKey.set(key, "#3a3f4d");
      else colorByKey.set(key, COLORS[i++ % COLORS.length]!);
    }
    return colorByKey;
  }, [stacked.keys]);

  const isTimelineDimension = dimension.startsWith("@");

  // Cycle annotation (bands or a ribbon), gated off entirely when the bars
  // themselves already are cycles, or the "Cycles" toggle is off.
  const chartLabels = stacked.rows.map((r) => String(r.date));
  const annotateBands = showCycles && bucket !== "cycle" && scopeProject !== null && cycleAvailable;
  const railProjects = useMemo(() => {
    if (!showCycles || bucket === "cycle") return [];
    if (scopeProject) return []; // single project scoped -> bands instead, not a redundant one-row rail
    const active = new Set(data?.activeProjects ?? []);
    return projectCycles.filter((p) => active.has(p.project) || active.size === 0);
  }, [showCycles, bucket, scopeProject, data, projectCycles]);

  return (
    <div className="panel">
      <div className="row" style={{ marginBottom: 16 }}>
        <div>
          <label>Group by</label>
          <select value={dimension} onChange={(e) => setDimension(e.target.value)}>
            {dimensions.length === 0 && timelineDimensions.length === 0 && (
              <option value="">— no CSV or projects file loaded —</option>
            )}
            {timelineDimensions.length > 0 && (
              <optgroup label="Timeline">
                {timelineDimensions.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </optgroup>
            )}
            {dimensions.length > 0 && (
              <optgroup label="CSV columns">
                {dimensions.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        {secondaryOptions.length > 0 && (
          <div>
            <label>Secondary group by</label>
            <select value={secondary} onChange={(e) => setSecondary(e.target.value)}>
              <option value="">None</option>
              {secondaryOptions.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </div>
        )}
        {projectNames.length > 0 && (
          <div>
            <label>Project</label>
            <select value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">All projects</option>
              {projectNames.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label>Product (cost/tokens)</label>
          <select value={product} onChange={(e) => setProduct(e.target.value)}>
            <option value="">All products</option>
            {PRODUCTS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Chart metric</label>
          <select value={String(metric.key)} onChange={(e) => setMetricKey(e.target.value)}>
            {METRICS.map((m) => (
              <option key={String(m.key)} value={String(m.key)}>{m.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Sort order</label>
          <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
            <option value="size">Size (metric)</option>
            <option value="alpha">Name (A–Z)</option>
          </select>
        </div>
        <a href={api.exportUrl(dimension, from || undefined, to || undefined, product || undefined, filterQuery, project || undefined)}>
          <button className="secondary" type="button">Export CSV</button>
        </a>
        <a href={api.exportGroupsDailyUrl(dimension, from || undefined, to || undefined, product || undefined, filterQuery, project || undefined)}>
          <button className="secondary" type="button">Export daily CSV</button>
        </a>
      </div>

      {loading && <p className="muted">Loading…</p>}

      {scopeIsInferred && scopeProject && (
        <p className="muted" style={{ marginTop: -8, marginBottom: 12 }}>
          <span className="pill">Scoped to {scopeProject}</span>
          (via the active member filter — the totals above already reflect it)
        </p>
      )}

      {data && stacked.rows.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="row" style={{ marginBottom: 8, alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>
              Cost over time{data?.secondaryDimension ? ` (by ${secondaryLabel})` : ""}
            </h3>
            <div className="segmented" role="group" aria-label="Granularity">
              {GRANULARITIES.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  className={bucket === g.key ? "active" : ""}
                  onClick={() => setBucket(g.key)}
                >
                  {g.label}
                </button>
              ))}
              {cycleAvailable && (
                <button type="button" className={bucket === "cycle" ? "active" : ""} onClick={() => setBucket("cycle")}>
                  Cycle
                </button>
              )}
            </div>
            {(cycleAvailable || railProjects.length > 0) && (
              <button className="secondary" type="button" onClick={() => setShowCycles(showCycles ? "0" : "1")}>
                {showCycles ? "Hide cycles" : "Show cycles"}
              </button>
            )}
          </div>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stacked.rows} margin={CHART_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
                {annotateBands &&
                  scopeCycles.map((c, i) => {
                    const span = snapBand(c, chartLabels, bucket);
                    if (!span) return null;
                    const x1Idx = chartLabels.indexOf(span.x1);
                    const x2Idx = chartLabels.indexOf(span.x2);
                    const wide = x2Idx - x1Idx >= 1;
                    return (
                      <ReferenceArea
                        key={c.name}
                        x1={span.x1}
                        x2={span.x2}
                        isFront={false}
                        fill="#ffffff"
                        fillOpacity={i % 2 ? 0.07 : 0.04}
                        stroke="#2a2f3a"
                        strokeDasharray="3 3"
                        label={wide ? { value: wrapLabel(c.name, 18, 1)[0], position: "insideTopLeft", fill: "#9aa3b2", fontSize: 11 } : undefined}
                      />
                    );
                  })}
                <XAxis
                  dataKey="date"
                  stroke="#9aa3b2"
                  fontSize={11}
                  tickFormatter={bucket === "cycle" ? (v: string) => v : undefined}
                  {...xAxisProps(stacked.rows.length, 10, { rotateWhenShort: bucket !== "cycle", forceAllTicks: bucket === "cycle" })}
                />
                <YAxis stroke="#9aa3b2" fontSize={12} width={Y_AXIS_WIDTH} />
                <Tooltip
                  contentStyle={{ background: "#1a1d24", border: "1px solid #2a2f3a" }}
                  formatter={(v: number) => usd(v * 100)}
                />
                <Legend />
                {stacked.keys.map((key) => (
                  <Bar key={key} dataKey={key} stackId="groups" fill={stackColor.get(key)} name={key} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          {showCycles && bucket !== "cycle" && railProjects.length > 0 && (
            <CycleRail
              labels={chartLabels}
              projects={railProjects.map((p) => ({ project: p.project, cycles: p.cycles }))}
              granularity={bucket}
              moreCount={Math.max(0, projectCycles.length - railProjects.length)}
            />
          )}
        </div>
      )}

      {data && data.groups.length > 0 && (
        <>
          <div style={{ height: 280, marginBottom: 16 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
                <XAxis
                  dataKey="name"
                  stroke="#9aa3b2"
                  fontSize={12}
                  {...xAxisProps(chartData.length, Math.max(0, ...chartData.map((d) => d.name.length)))}
                />
                <YAxis stroke="#9aa3b2" fontSize={12} />
                <Tooltip
                  contentStyle={{ background: "#1a1d24", border: "1px solid #2a2f3a" }}
                  formatter={(v: number) => (metric.money ? usd(v) : metric.key === "totalTokens" ? tokens(v) : v)}
                />
                <Bar dataKey="value" fill="#d97757" name={metric.label} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {data.secondaryDimension ? (
            <NestedGroupsTable
              columns={columns}
              primaryRows={orderedGroups}
              secondaryRows={data.secondaryGroups}
              secondaryLabel={secondaryLabel}
            />
          ) : (
            <SortableTable
              columns={columns}
              rows={orderedGroups}
              initialSort={sortOrder === "alpha" ? "key" : String(metric.key)}
              initialDesc={sortOrder !== "alpha"}
            />
          )}
        </>
      )}

      {data && data.groups.length === 0 && !loading && (
        <p className="muted">No cached data for this range. Sync first.</p>
      )}

      {data && !isTimelineDimension && !project && data.unmatchedCount > 0 && (
        <p className="muted" style={{ marginTop: 12 }}>
          {data.unmatchedCount} developer(s) in analytics have no CSV match (grouped as “(unmatched)”). Upload a CSV
          whose <code>email</code> column matches your org's emails to break these out.
        </p>
      )}
    </div>
  );
}
