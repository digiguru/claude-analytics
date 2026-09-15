import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import {
  api,
  CYCLE_DIMENSION_ID,
  CYCLE_DIMENSION_LABEL,
  MEMBER_DIMENSION_ID,
  MEMBER_DIMENSION_LABEL,
  type GroupsResponse,
  type ProjectCycles,
  type TimelineDimension,
  type UserListEntry,
} from "../api.js";
import { COLORS, NEUTRAL_COLOR } from "../charts.js";
import { resolveBucket } from "../cycles.js";
import {
  combineSummaries,
  dragSelectionReducer,
  initialDragSelectionState,
  liveIndexRanges,
  resolveRanges,
  summarizeRows,
} from "../dragSelection.js";
import { buildGroupColumns } from "../groupColumns.js";
import { buildQuickFilterFacets, parseQuickFilter, resolveScopeProject } from "../quickFilter.js";
import { useUrlParam } from "../url.js";
import { isolateValue, mergeFilterSpecs, type FilterSpec } from "../filters.js";
import { OTHER_KEY, stackRows, UNASSIGNED_KEY, type ChartBucket } from "../stack.js";
import { CostOverTimeChart } from "./CostOverTimeChart.js";
import { GroupsControls } from "./GroupsControls.js";
import { GroupsTableSection } from "./GroupsTableSection.js";
import { GroupTotalsChart, type Metric, type SortOrder } from "./GroupTotalsChart.js";

interface Props {
  from: string;
  to: string;
  dimensions: string[];
  timelineDimensions: TimelineDimension[];
  projectCycles: ProjectCycles[];
  filterQuery?: string;
  onError: (msg: string | null) => void;
}

// Stable empty-array reference — see the `scopeCycles` comment below for why
// a fresh `[]` literal here would defeat downstream useMemo calls.
const EMPTY_CYCLES: ProjectCycles["cycles"] = [];

const METRICS: Metric[] = [
  { key: "costCents", label: "Total cost", money: true },
  { key: "avgCostPerSeat", label: "Avg cost / seat", money: true },
  { key: "avgCostPerActiveUser", label: "Avg cost / active user", money: true },
  { key: "totalTokens", label: "Total tokens" },
  { key: "ccSessions", label: "Claude Code sessions" },
  { key: "chatMessages", label: "Chat messages" },
  { key: "activeUserDays", label: "Active user-days" },
];

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

  // The member list (for CSV facet values) — ranged the same way the Filter
  // menu's own list is, so both build "Quick filter by"'s isolateValue spec
  // and the Filter menu's own hide-list from the same set of values. An
  // unranged list here used to disagree with the Filter menu's ranged one
  // whenever a CSV attribute value existed on one side but not the other,
  // producing an incomplete "hide everything except X" spec. See #23 item 2.
  useEffect(() => {
    api
      .users(from || undefined, to || undefined)
      .then((r) => setUsers(r.users))
      .catch(() => setUsers([]));
  }, [from, to]);

  const quickFilterFacets = useMemo(
    () => buildQuickFilterFacets(timelineDimensions, dimensions, users, UNASSIGNED_KEY),
    [timelineDimensions, dimensions, users],
  );
  const quickFilter = useMemo(() => parseQuickFilter(qfRaw, quickFilterFacets), [qfRaw, quickFilterFacets]);

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
  // twice is meaningless). Doesn't affect the chart — see GroupsTableSection.
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
    (name: string) => projectCycles.find((p) => p.project === name)?.cycles ?? EMPTY_CYCLES,
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

  const { scopeProject, scopeIsInferred } = resolveScopeProject(quickFilter, data?.activeProjects ?? []);
  // A stable empty-array reference for "no scope project" (or a project with
  // no cycles) — a fresh `[]` literal here would change identity every
  // render and defeat every useMemo downstream that depends on scopeCycles
  // (cycleOrder, stacked), even though nothing about the data actually
  // changed. See #23 item 3.
  const scopeCycles = scopeProject ? cyclesForProject(scopeProject) : EMPTY_CYCLES;
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

  const bucket: ChartBucket = resolveBucket(bucketRaw, cycleAvailable);

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
  const columns = useMemo(
    () => buildGroupColumns(dimension === CYCLE_DIMENSION_ID, cycleOrder),
    [dimension, cycleOrder],
  );

  // The chart always stacks by "Stacking by" (the primary dimension) — the
  // table's Secondary drill-down doesn't touch it.
  const stacked = useMemo(
    () => stackRows(data?.timeseries ?? [], data?.keys ?? [], bucket, scopeCycles),
    [data, bucket, scopeCycles],
  );
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
  // region alongside whatever's already selected. The index arithmetic lives
  // in dragSelection.ts (pure, unit-tested there); this component only
  // resolves it against the chart's own rows/labels for rendering. Driven by
  // a reducer rather than nested setState calls — see #23 item 1, whose bug
  // (a setRegions call nested inside a setActiveDrag updater) is what this
  // replaces.
  const [dragState, dispatchDrag] = useReducer(dragSelectionReducer, initialDragSelectionState);
  const { regions, activeDrag } = dragState;

  // Reset the selection when the *query* changes (a new dimension/product/
  // filter/scope/secondary/date-range — anything `load`'s identity captures)
  // or the client-only bucket granularity changes — not on every `data`
  // identity change, which used to also fire on a same-query refetch whose
  // content hadn't actually changed. See #29.
  useEffect(() => {
    dispatchDrag({ type: "reset" });
  }, [bucket, load]);

  const liveRanges = useMemo(
    () => liveIndexRanges(chartLabels, regions, activeDrag),
    [chartLabels, regions, activeDrag],
  );

  // Committed regions plus whatever's currently being dragged (already clipped
  // so the live preview never overlaps a committed region), each resolved to a
  // label range and its rows — this is what's drawn/summarized.
  const liveRegions = useMemo(
    () =>
      resolveRanges(chartLabels, liveRanges).map((r, i) => ({
        ...r,
        rows: stacked.rows.slice(liveRanges[i]!.lo, liveRanges[i]!.hi + 1),
      })),
    [chartLabels, liveRanges, stacked.rows],
  );

  const regionSummaries = useMemo(
    () => liveRegions.map((r) => ({ ...summarizeRows(r.rows, stacked.keys), x1: r.x1, x2: r.x2 })),
    [liveRegions, stacked.keys],
  );

  // Combined across every selected region, and across the whole chart
  // regardless of selection — shown together at the top of the section.
  const combinedRegionSummary = useMemo(() => combineSummaries(regionSummaries), [regionSummaries]);

  const overallSummary = useMemo(() => summarizeRows(stacked.rows, stacked.keys), [stacked.rows, stacked.keys]);

  const handleChartMouseDown = (e: { activeLabel?: string | number }, event: { shiftKey?: boolean }) => {
    if (e?.activeLabel == null) return;
    dispatchDrag({ type: "start", label: String(e.activeLabel), add: Boolean(event?.shiftKey) });
  };
  const handleChartMouseMove = (e: { activeLabel?: string | number }) => {
    if (activeDrag && e?.activeLabel != null) dispatchDrag({ type: "move", label: String(e.activeLabel) });
  };
  const commitDrag = () => dispatchDrag({ type: "commit", labels: chartLabels });
  const removeRegion = (index: number) => dispatchDrag({ type: "remove", index });
  const clearSelection = () => dispatchDrag({ type: "clear" });

  return (
    <div className="panel">
      <GroupsControls
        dimension={dimension}
        onDimensionChange={setDimension}
        dimensions={dimensions}
        timelineDimensions={timelineDimensions}
        cycleAvailable={cycleAvailable}
        quickFilterFacets={quickFilterFacets}
        qfRaw={qfRaw}
        onQfChange={setQf}
        product={product}
        onProductChange={setProduct}
        from={from}
        to={to}
        effectiveFilterQuery={effectiveFilterQuery}
        scopeValue={scopeValue}
        scopeDimension={scopeDimension}
      />

      {loading && <p className="muted">Loading…</p>}

      {scopeIsInferred && scopeProject && (
        <p className="muted" style={{ marginTop: -8, marginBottom: 12 }}>
          <span className="pill">Scoped to {scopeProject}</span>
          (the totals above already reflect it)
        </p>
      )}

      {data && stacked.rows.length > 0 && (
        <CostOverTimeChart
          stacked={stacked}
          bucket={bucket}
          onBucketChange={setBucket}
          cycleAvailable={cycleAvailable}
          showCycles={showCycles}
          onToggleCycles={() => setShowCycles(showCycles ? "0" : "1")}
          overallSummary={overallSummary}
          combinedRegionSummary={combinedRegionSummary}
          regionSummaries={regionSummaries}
          stackColor={stackColor}
          chartLabels={chartLabels}
          annotateBands={annotateBands}
          scopeCycles={scopeCycles}
          railProjects={railProjects}
          projectCycles={projectCycles}
          activeDrag={activeDrag}
          liveRegions={liveRegions}
          onChartMouseDown={handleChartMouseDown}
          onChartMouseMove={handleChartMouseMove}
          onCommitDrag={commitDrag}
          onRemoveRegion={removeRegion}
          onClearSelection={clearSelection}
        />
      )}

      {data && data.groups.length > 0 && (
        <>
          <GroupTotalsChart
            dimensionLabel={dimensionLabel}
            metric={metric}
            metrics={METRICS}
            onMetricChange={setMetricKey}
            sortOrder={sortOrder}
            onSortOrderChange={setSortOrder}
            showDateSort={dimension === CYCLE_DIMENSION_ID}
            orderedGroups={orderedGroups}
          />
          <GroupsTableSection
            columns={columns}
            orderedGroups={orderedGroups}
            data={data}
            secondary={secondary}
            onSecondaryChange={setSecondary}
            secondaryOptions={secondaryOptions}
            secondaryLabel={secondaryLabel}
            sortOrder={sortOrder}
            metricKey={String(metric.key)}
          />
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
