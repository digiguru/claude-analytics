import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  api,
  CYCLE_DIMENSION_ID,
  CYCLE_DIMENSION_LABEL,
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
  type UserListEntry,
} from "../api.js";
import {
  CHART_MARGIN,
  COLORS,
  NEUTRAL_COLOR,
  RechartsReferenceArea as ReferenceArea,
  Y_AXIS_WIDTH,
  wrapLabel,
  xAxisProps,
} from "../charts.js";
import { bucketByCycle, snapBand, type ChartBucket } from "../cycles.js";
import { bucketSeries, type Granularity } from "../series.js";
import { useUrlParam } from "../url.js";
import { buildFacets, EMAIL_FACET, isolateValue, mergeFilterSpecs, type FilterSpec } from "../filters.js";
import { CycleRail } from "./CycleRail.js";
import { NestedGroupsTable } from "./NestedGroupsTable.js";
import { SortableTable, type Column } from "./SortableTable.js";
import { VariableWidthBars } from "./VariableWidthBars.js";

/** Chart/table ordering: by metric magnitude ("size", default) or by group name ("alpha"). */
type SortOrder = "size" | "alpha" | "date";

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

/** One "Quick filter by" choice: a facet (timeline or CSV) and its values.
 *  Timeline facets scope date-aware, via the server's `scope`/`scopeDimension`
 *  params; CSV facets are a plain member-filter hide-all-but-one, merged into
 *  this component's own `filter` query (see isolateValue/mergeFilterSpecs). */
interface QuickFilterFacet {
  id: string;
  label: string;
  values: string[];
  kind: "timeline" | "csv";
}

/** Pivot the daily group×date rows into one row per bucket with a cost column per
 *  key, capping the stack at the top MAX_STACK_KEYS keys (by total cost) plus an
 *  "Other" catch-all. Unassigned always renders, last, regardless of rank. Buckets
 *  by day/week/month, or — when scoped to one project with cycles — by cycle. */
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

/** Recharts <Tooltip content>: the default per-series list, plus a "Total"
 *  row summing every stacked series at the hovered bucket. */
function StackedCostTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey?: string; name?: string; value?: number; color?: string }[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const total = payload.reduce((sum, p) => sum + (Number(p.value) || 0), 0);
  return (
    <div style={{ background: "#1a1d24", border: "1px solid #2a2f3a", borderRadius: 6, padding: "8px 10px", fontSize: 12, lineHeight: 1.5 }}>
      <div style={{ marginBottom: 4 }}>
        <strong>{label}</strong>
      </div>
      {payload.map((p) => (
        <div key={p.dataKey} className="row" style={{ gap: 6, alignItems: "center" }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, display: "inline-block" }} />
          <span className="muted" style={{ flex: 1 }}>{p.name}</span>
          <span>{usd((Number(p.value) || 0) * 100)}</span>
        </div>
      ))}
      <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid #2a2f3a" }}>
        Total: <strong>{usd(total * 100)}</strong>
      </div>
    </div>
  );
}

export function GroupsView({ from, to, dimensions, timelineDimensions, projectCycles, filterQuery, onError }: Props) {
  const [dimension, setDimension] = useUrlParam("groupBy", ""); // "Stacking by"
  const [secondaryRaw, setSecondary] = useUrlParam("secondary", ""); // table-only drill-down
  const [product, setProduct] = useUrlParam("product", "");
  const [qfRaw, setQf] = useUrlParam("qf", ""); // "Quick filter by", encoded "facetId::value"
  const [metricKey, setMetricKey] = useUrlParam("metric", String(METRICS[0]!.key));
  const [sortOrderRaw, setSortOrder] = useUrlParam("sort", "size");
  const [bucketRaw, setBucket] = useUrlParam("granularity", "week");
  const [showCyclesRaw, setShowCycles] = useUrlParam("cycles", "1");
  const [users, setUsers] = useState<UserListEntry[]>([]);
  const [data, setData] = useState<GroupsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const metric = METRICS.find((m) => String(m.key) === metricKey) ?? METRICS[0]!;
  const sortOrder: SortOrder =
    sortOrderRaw === "date" && dimension === CYCLE_DIMENSION_ID ? "date" : sortOrderRaw === "alpha" ? "alpha" : "size";
  const showCycles = showCyclesRaw !== "0";

  // The member list (for CSV facet values) — same source the Filter menu uses.
  useEffect(() => {
    api.users().then((r) => setUsers(r.users)).catch(() => setUsers([]));
  }, []);

  // Every facet "Quick filter by" can narrow to a single value of: the timeline
  // facets (Project/Team/Client) and every CSV column, each with its distinct values.
  const quickFilterFacets: QuickFilterFacet[] = useMemo(() => {
    const timeline: QuickFilterFacet[] = timelineDimensions.map((d) => ({
      id: d.id,
      label: d.label,
      values: d.values.filter((v) => v !== UNASSIGNED_KEY),
      kind: "timeline",
    }));
    const csv: QuickFilterFacet[] = buildFacets(users, dimensions)
      .filter((f) => f.key !== EMAIL_FACET)
      .map((f) => ({ id: f.key, label: f.label, values: f.values, kind: "csv" }));
    return [...timeline, ...csv];
  }, [timelineDimensions, dimensions, users]);

  const quickFilter = useMemo(() => {
    const idx = qfRaw.indexOf("::");
    if (idx === -1) return null;
    const facetId = qfRaw.slice(0, idx);
    const value = qfRaw.slice(idx + 2);
    const facet = quickFilterFacets.find((f) => f.id === facetId);
    if (!facet || !facet.values.includes(value)) return null;
    return { ...facet, value };
  }, [qfRaw, quickFilterFacets]);

  // Reset an invalid pick (e.g. the facet's value list changed) once facets have
  // actually loaded — don't clear a persisted URL pick just because data is still loading.
  useEffect(() => {
    if (qfRaw && quickFilterFacets.length > 0 && !quickFilter) setQf("", true);
  }, [qfRaw, quickFilterFacets.length, quickFilter, setQf]);

  // Timeline quick filters go through the server's date-aware `scope`/`scopeDimension`
  // (correctly split across concurrent memberships); CSV quick filters are a plain
  // "hide every other value" merged into this component's own filter query.
  const scopeValue = quickFilter?.kind === "timeline" ? quickFilter.value : undefined;
  const scopeDimension = quickFilter?.kind === "timeline" ? quickFilter.id : undefined;
  const effectiveFilterQuery = useMemo(() => {
    if (!quickFilter || quickFilter.kind === "timeline") return filterQuery;
    let base: FilterSpec | null = null;
    if (filterQuery) {
      try {
        base = JSON.parse(filterQuery) as FilterSpec;
      } catch {
        base = null;
      }
    }
    const merged = mergeFilterSpecs(base, isolateValue(quickFilter.id, quickFilter.values, quickFilter.value));
    return merged ? JSON.stringify(merged) : undefined;
  }, [filterQuery, quickFilter]);

  // Secondary (table drill-down) options: every dimension the table could group
  // by, minus whichever is currently "Stacking by" (grouping by the same thing
  // twice is meaningless). Doesn't affect the chart — see NestedGroupsTable.
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
  // Human label for "Stacking by", for the totals chart's title.
  const dimensionLabel =
    timelineDimensions.find((d) => d.id === dimension)?.label ??
    (dimension === MEMBER_DIMENSION_ID
      ? MEMBER_DIMENSION_LABEL
      : dimension === CYCLE_DIMENSION_ID
        ? CYCLE_DIMENSION_LABEL
        : dimension);
  const cyclesForProject = useCallback(
    (name: string) => projectCycles.find((p) => p.project === name)?.cycles ?? [],
    [projectCycles],
  );

  const load = useCallback(async () => {
    if (!dimension) return;
    setLoading(true);
    onError(null);
    try {
      setData(
        await api.groups({
          dimension,
          from: from || undefined,
          to: to || undefined,
          product: product || undefined,
          filter: effectiveFilterQuery,
          scope: scopeValue,
          scopeDimension,
          secondary: secondary || undefined,
        }),
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [dimension, product, effectiveFilterQuery, scopeValue, scopeDimension, secondary, from, to, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  // The PROJECT this chart is effectively scoped to, for Cycle purposes (cycles
  // are always project-specific): an explicit Quick-filter-by-Project pick, else
  // — regardless of what narrowed it (a Team/Client/CSV quick filter, or the
  // member filter) — whichever single project is the only one left active.
  // Never auto-selects Cycle granularity, only offers it.
  const explicitProject = quickFilter?.kind === "timeline" && quickFilter.id === "@project" ? quickFilter.value : "";
  const scopeProject = explicitProject || (data?.activeProjects.length === 1 ? data.activeProjects[0]! : null);
  const scopeIsInferred = !explicitProject && Boolean(scopeProject);
  const scopeCycles = scopeProject ? cyclesForProject(scopeProject) : [];
  const cycleAvailable = scopeCycles.length > 0;
  // Chronological order of the current project's cycles, keyed by name — for
  // "Sort order: Date" — mirrors CycleIndex's own sort-by-start order.
  const cycleOrder = useMemo(() => new Map(scopeCycles.map((c, i) => [c.name, i] as const)), [scopeCycles]);

  // Default "Stacking by" once dimensions load (unless a URL/previous pick is
  // still valid): prefer the first timeline facet (Project) when a projects
  // file is loaded, else the first CSV column. "Cycle" only counts as valid
  // while it's actually resolvable (cycleAvailable, just above).
  useEffect(() => {
    const timelineIds = timelineDimensions.map((d) => d.id);
    const validCycle = dimension === CYCLE_DIMENSION_ID && cycleAvailable;
    if (timelineIds.includes(dimension) || dimensions.includes(dimension) || validCycle) return;
    if (timelineIds.length) setDimension(timelineIds[0]!, true);
    else if (dimensions.length) setDimension(dimensions[0]!, true);
  }, [dimensions, timelineDimensions, dimension, cycleAvailable, setDimension]);

  const bucket: ChartBucket = bucketRaw === "cycle" && cycleAvailable ? "cycle" : bucketRaw === "day" || bucketRaw === "month" ? bucketRaw : "week";

  // Order groups for the chart (and the table's default) by the selected metric,
  // alphabetically, or — only offered when Stacking by is Cycle — chronologically
  // by each cycle's actual start date. A group with no known cycle (shouldn't
  // happen outside "(no cycle)") sorts last.
  const orderedGroups = useMemo(() => {
    const groups = [...(data?.groups ?? [])];
    if (sortOrder === "alpha") {
      groups.sort((a, b) => a.key.localeCompare(b.key));
    } else if (sortOrder === "date") {
      groups.sort((a, b) => (cycleOrder.get(a.key) ?? Infinity) - (cycleOrder.get(b.key) ?? Infinity));
    } else {
      groups.sort((a, b) => Number(b[metric.key]) - Number(a[metric.key]));
    }
    return groups;
  }, [data, sortOrder, metric.key, cycleOrder]);

  // The "Group" column sorts chronologically when Stacking by is Cycle (clicking
  // its header to re-sort alphabetically wouldn't be useful for cycle names
  // anyway), else by name as usual; always displays the group's name either way.
  const columns: Column<GroupRow>[] = useMemo(
    () => [
      {
        key: "key",
        label: "Group",
        value: (r) => (dimension === CYCLE_DIMENSION_ID ? cycleOrder.get(r.key) ?? Number.MAX_SAFE_INTEGER : r.key),
        render: (r) => r.key,
      },
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
    ],
    [dimension, cycleOrder],
  );

  const chartData = orderedGroups.map((g) => ({ name: g.key, value: Number(g[metric.key]) }));
  // The chart always stacks by "Stacking by" (the primary dimension) — the
  // table's Secondary drill-down doesn't touch it.
  const stacked = useStackedSeries(data?.timeseries ?? [], data?.keys ?? [], bucket, scopeCycles);
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

  // Click-and-drag range selection over "Cost over time" (only the regular
  // day/week/month bar chart — VariableWidthBars/cycle view isn't wired up).
  // A plain drag/click replaces the current selection with one region; holding
  // Shift while dragging/clicking instead adds a new, possibly non-contiguous,
  // region alongside whatever's already selected.
  interface DragRegion {
    x1: string;
    x2: string;
  }
  interface IndexRange {
    lo: number;
    hi: number;
  }
  const [regions, setRegions] = useState<DragRegion[]>([]);
  const [activeDrag, setActiveDrag] = useState<{ start: string; end: string; add: boolean } | null>(null);

  useEffect(() => {
    setRegions([]);
    setActiveDrag(null);
  }, [bucket, dimension, data]);

  const toIndexRange = useCallback(
    (r: DragRegion): IndexRange | null => {
      const i1 = chartLabels.indexOf(r.x1);
      const i2 = chartLabels.indexOf(r.x2);
      if (i1 === -1 || i2 === -1) return null;
      return { lo: Math.min(i1, i2), hi: Math.max(i1, i2) };
    },
    [chartLabels],
  );

  // Regions never overlap. Clip a candidate additive range to the free run of
  // indices reachable from `anchor` (the index the drag/click started on) —
  // truncating at the nearest already-selected region on either side. Returns
  // null when the anchor itself sits inside an existing region (nothing to add)
  // or the whole range gets clipped away.
  const clipAroundAnchor = useCallback((anchor: number, other: number, existing: IndexRange[]): IndexRange | null => {
    if (existing.some((r) => anchor >= r.lo && anchor <= r.hi)) return null;
    let lo = Math.min(anchor, other);
    let hi = Math.max(anchor, other);
    for (const r of existing) {
      if (r.hi < anchor) lo = Math.max(lo, r.hi + 1);
      if (r.lo > anchor) hi = Math.min(hi, r.lo - 1);
    }
    return lo <= hi ? { lo, hi } : null;
  }, []);

  // Committed regions plus whatever's currently being dragged (already clipped
  // so the live preview never overlaps a committed region), each resolved to a
  // label range and its rows — this is what's drawn/summarized.
  const liveRegions = useMemo(() => {
    const committed = regions.map(toIndexRange).filter((r): r is IndexRange => r !== null);
    const ranges = [...committed];
    if (activeDrag) {
      const startIdx = chartLabels.indexOf(activeDrag.start);
      const endIdx = chartLabels.indexOf(activeDrag.end);
      if (startIdx !== -1 && endIdx !== -1) {
        if (activeDrag.add) {
          const clipped = clipAroundAnchor(startIdx, endIdx, committed);
          if (clipped) ranges.push(clipped);
        } else {
          // Replace mode: the drag isn't constrained by regions it's about to wipe out.
          ranges.length = 0;
          ranges.push({ lo: Math.min(startIdx, endIdx), hi: Math.max(startIdx, endIdx) });
        }
      }
    }
    return ranges.map((r) => ({ x1: chartLabels[r.lo]!, x2: chartLabels[r.hi]!, rows: stacked.rows.slice(r.lo, r.hi + 1) }));
  }, [regions, activeDrag, chartLabels, stacked.rows, toIndexRange, clipAroundAnchor]);

  const regionSummaries = useMemo(
    () =>
      liveRegions.map((r) => {
        const byKey = new Map<string, number>();
        let total = 0;
        for (const row of r.rows) {
          for (const key of stacked.keys) {
            const v = Number(row[key]) || 0;
            if (v) byKey.set(key, (byKey.get(key) ?? 0) + v);
            total += v;
          }
        }
        return { total, byKey, x1: r.x1, x2: r.x2 };
      }),
    [liveRegions, stacked.keys],
  );

  // Combined across every selected region, and across the whole chart
  // regardless of selection — shown together at the top of the section.
  const combinedRegionSummary = useMemo(() => {
    if (regionSummaries.length === 0) return null;
    const byKey = new Map<string, number>();
    let total = 0;
    for (const s of regionSummaries) {
      total += s.total;
      for (const [k, v] of s.byKey) byKey.set(k, (byKey.get(k) ?? 0) + v);
    }
    return { total, byKey };
  }, [regionSummaries]);

  const overallSummary = useMemo(() => {
    const byKey = new Map<string, number>();
    let total = 0;
    for (const row of stacked.rows) {
      for (const key of stacked.keys) {
        const v = Number(row[key]) || 0;
        if (v) byKey.set(key, (byKey.get(key) ?? 0) + v);
        total += v;
      }
    }
    return { total, byKey };
  }, [stacked.rows, stacked.keys]);

  const handleChartMouseDown = (e: { activeLabel?: string | number }, event: { shiftKey?: boolean }) => {
    if (e?.activeLabel == null) return;
    const label = String(e.activeLabel);
    setActiveDrag({ start: label, end: label, add: Boolean(event?.shiftKey) });
  };
  const handleChartMouseMove = (e: { activeLabel?: string | number }) => {
    if (activeDrag && e?.activeLabel != null) setActiveDrag({ ...activeDrag, end: String(e.activeLabel) });
  };
  const commitDrag = () => {
    setActiveDrag((cur) => {
      if (!cur) return null;
      const startIdx = chartLabels.indexOf(cur.start);
      const endIdx = chartLabels.indexOf(cur.end);
      if (startIdx === -1 || endIdx === -1) return null;
      setRegions((rs) => {
        if (!cur.add) {
          return [{ x1: chartLabels[Math.min(startIdx, endIdx)]!, x2: chartLabels[Math.max(startIdx, endIdx)]! }];
        }
        const existing = rs.map(toIndexRange).filter((r): r is IndexRange => r !== null);
        const clipped = clipAroundAnchor(startIdx, endIdx, existing);
        if (!clipped) return rs;
        return [...rs, { x1: chartLabels[clipped.lo]!, x2: chartLabels[clipped.hi]! }];
      });
      return null;
    });
  };
  const removeRegion = (index: number) => setRegions((rs) => rs.filter((_, i) => i !== index));
  const clearSelection = () => {
    setRegions([]);
    setActiveDrag(null);
  };

  return (
    <div className="panel">
      <div className="row" style={{ marginBottom: 16 }}>
        <div>
          <label>Stacking by</label>
          <select value={dimension} onChange={(e) => setDimension(e.target.value)}>
            {dimensions.length === 0 && timelineDimensions.length === 0 && (
              <option value="">— no CSV or projects file loaded —</option>
            )}
            {timelineDimensions.length > 0 && (
              <optgroup label="Timeline">
                {timelineDimensions.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
                {cycleAvailable && <option value={CYCLE_DIMENSION_ID}>{CYCLE_DIMENSION_LABEL}</option>}
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
        {quickFilterFacets.length > 0 && (
          <div>
            <label>Quick filter by</label>
            <select value={qfRaw} onChange={(e) => setQf(e.target.value)}>
              <option value="">None</option>
              {quickFilterFacets.map((f) => (
                <optgroup label={f.label} key={f.id}>
                  {f.values.map((v) => (
                    <option key={`${f.id}::${v}`} value={`${f.id}::${v}`}>{v}</option>
                  ))}
                </optgroup>
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
        <a href={api.exportUrl({ dimension, from: from || undefined, to: to || undefined, product: product || undefined, filter: effectiveFilterQuery, scope: scopeValue, scopeDimension })}>
          <button className="secondary" type="button">Export CSV</button>
        </a>
        <a href={api.exportGroupsDailyUrl({ dimension, from: from || undefined, to: to || undefined, product: product || undefined, filter: effectiveFilterQuery, scope: scopeValue, scopeDimension })}>
          <button className="secondary" type="button">Export daily CSV</button>
        </a>
      </div>

      {loading && <p className="muted">Loading…</p>}

      {scopeIsInferred && scopeProject && (
        <p className="muted" style={{ marginTop: -8, marginBottom: 12 }}>
          <span className="pill">Scoped to {scopeProject}</span>
          (the totals above already reflect it)
        </p>
      )}

      {data && stacked.rows.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="row" style={{ marginBottom: 8, alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>Cost over time</h3>
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
          <div className="stat-grid" style={{ marginBottom: 12 }}>
            <div className="stat">
              <p className="label muted">All dates total</p>
              <div className="value">{usd(overallSummary.total * 100)}</div>
              {stacked.keys.length > 1 &&
                stacked.keys
                  .filter((k) => overallSummary.byKey.has(k))
                  .map((k) => (
                    <div key={k} className="row muted" style={{ gap: 6, alignItems: "center", fontSize: 12 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: stackColor.get(k), display: "inline-block" }} />
                      <span style={{ flex: 1 }}>{k}</span>
                      <span>{usd((overallSummary.byKey.get(k) ?? 0) * 100)}</span>
                    </div>
                  ))}
            </div>
            {combinedRegionSummary && (
              <div className="stat">
                <p className="label muted">
                  Selected total ({regionSummaries.length} region{regionSummaries.length === 1 ? "" : "s"})
                </p>
                <div className="value">{usd(combinedRegionSummary.total * 100)}</div>
                {stacked.keys.length > 1 &&
                  stacked.keys
                    .filter((k) => combinedRegionSummary.byKey.has(k))
                    .map((k) => (
                      <div key={k} className="row muted" style={{ gap: 6, alignItems: "center", fontSize: 12 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: stackColor.get(k), display: "inline-block" }} />
                        <span style={{ flex: 1 }}>{k}</span>
                        <span>{usd((combinedRegionSummary.byKey.get(k) ?? 0) * 100)}</span>
                      </div>
                    ))}
              </div>
            )}
          </div>
          {bucket === "cycle" ? (
            // Recharts' BarChart always gives every category an equal-width band,
            // which would misrepresent cycles of very different lengths — use a
            // hand-built chart instead where bar width is proportional to each
            // cycle's real day-count (see VariableWidthBars).
            <VariableWidthBars rows={stacked.rows} keys={stacked.keys} colors={stackColor} height={280} />
          ) : (
            <div style={{ height: 280, position: "relative", userSelect: activeDrag ? "none" : undefined }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={stacked.rows}
                  margin={CHART_MARGIN}
                  onMouseDown={handleChartMouseDown}
                  onMouseMove={handleChartMouseMove}
                  onMouseUp={commitDrag}
                  onMouseLeave={commitDrag}
                >
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
                          zIndex={1000}
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
                    {...xAxisProps(stacked.rows.length, 10, { rotateWhenShort: true })}
                  />
                  <YAxis stroke="#9aa3b2" fontSize={12} width={Y_AXIS_WIDTH} />
                  <Tooltip content={<StackedCostTooltip />} />
                  <Legend />
                  {stacked.keys.map((key) => (
                    <Bar key={key} dataKey={key} stackId="groups" fill={stackColor.get(key)} name={key} />
                  ))}
                  {liveRegions.map((r, i) => (
                    <ReferenceArea
                      key={`${r.x1}-${r.x2}-${i}`}
                      x1={r.x1}
                      x2={r.x2}
                      zIndex={1000}
                      stroke="#d97757"
                      strokeOpacity={0.6}
                      fill="#d97757"
                      fillOpacity={0.15}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
              {regionSummaries.length > 0 && (
                <div style={{ position: "absolute", top: 8, right: 12, zIndex: 30, display: "flex", flexDirection: "column", gap: 6, pointerEvents: "none" }}>
                  {regionSummaries.length > 1 && (
                    <button
                      type="button"
                      className="secondary"
                      style={{ alignSelf: "flex-end", fontSize: 11, padding: "2px 8px", pointerEvents: "auto" }}
                      onClick={clearSelection}
                    >
                      Clear all
                    </button>
                  )}
                  {regionSummaries.map((s, i) => (
                    <div
                      key={`${s.x1}-${s.x2}-${i}`}
                      style={{
                        background: "#1a1d24",
                        border: "1px solid #2a2f3a",
                        borderRadius: 6,
                        padding: "8px 10px",
                        fontSize: 12,
                        lineHeight: 1.5,
                        pointerEvents: "auto",
                        maxWidth: 220,
                      }}
                    >
                      <div className="row" style={{ justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                        <strong>{s.x1 === s.x2 ? s.x1 : `${s.x1} – ${s.x2}`}</strong>
                        <button
                          type="button"
                          className="secondary"
                          style={{ padding: "0 6px", lineHeight: 1.3 }}
                          onClick={() => removeRegion(i)}
                          aria-label="Remove selection"
                        >
                          ×
                        </button>
                      </div>
                      <div style={{ marginBottom: stacked.keys.length > 1 ? 4 : 0 }}>
                        Total: <strong>{usd(s.total * 100)}</strong>
                      </div>
                      {stacked.keys.length > 1 &&
                        stacked.keys
                          .filter((k) => s.byKey.has(k))
                          .map((k) => (
                            <div key={k} className="row" style={{ gap: 6, alignItems: "center" }}>
                              <span style={{ width: 8, height: 8, borderRadius: 2, background: stackColor.get(k), display: "inline-block" }} />
                              <span className="muted" style={{ flex: 1 }}>{k}</span>
                              <span>{usd((s.byKey.get(k) ?? 0) * 100)}</span>
                            </div>
                          ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {bucket !== "cycle" && (
            <p className="muted" style={{ fontSize: 11, margin: "4px 0 0" }}>
              Drag to select a range · Shift-drag or shift-click to add another region
            </p>
          )}
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
          <div className="row" style={{ marginBottom: 8, alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>{metric.label} by {dimensionLabel}</h3>
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
                {dimension === CYCLE_DIMENSION_ID && <option value="date">Date</option>}
              </select>
            </div>
          </div>
          <div style={{ height: 280, marginBottom: 16 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ ...CHART_MARGIN, top: 24 }}>
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
                  formatter={(v) => {
                    const n = Number(v ?? 0);
                    return metric.money ? usd(n) : metric.key === "totalTokens" ? tokens(n) : n;
                  }}
                />
                <Bar dataKey="value" fill="#d97757" name={metric.label}>
                  <LabelList
                    dataKey="value"
                    position="top"
                    fill="#9aa3b2"
                    fontSize={11}
                    formatter={(v) => {
                      const n = Number(v ?? 0);
                      return metric.money ? usd(n) : metric.key === "totalTokens" ? tokens(n) : n;
                    }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {secondaryOptions.length > 0 && (
            <div className="row" style={{ marginBottom: 8, alignItems: "center" }}>
              <div>
                <label>Table breakdown by</label>
                <select value={secondary} onChange={(e) => setSecondary(e.target.value)}>
                  <option value="">None</option>
                  {secondaryOptions.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </select>
              </div>
              {secondary && (
                <p className="muted" style={{ margin: 0 }}>
                  Expand a row below to see its breakdown by {secondaryLabel}.
                </p>
              )}
            </div>
          )}

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
              initialSort={sortOrder === "size" ? String(metric.key) : "key"}
              initialDesc={sortOrder === "size"}
            />
          )}
        </>
      )}

      {data && data.groups.length === 0 && !loading && (
        <p className="muted">No cached data for this range. Sync first.</p>
      )}

      {data && !isTimelineDimension && !quickFilter && data.unmatchedCount > 0 && (
        <p className="muted" style={{ marginTop: 12 }}>
          {data.unmatchedCount} developer(s) in analytics have no CSV match (grouped as “(unmatched)”). Upload a CSV
          whose <code>email</code> column matches your org's emails to break these out.
        </p>
      )}
    </div>
  );
}
