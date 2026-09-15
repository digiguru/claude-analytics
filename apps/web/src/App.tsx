import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Status } from "./api.js";
import { ControlBar } from "./components/ControlBar.js";
import { FilterMenu } from "./components/FilterMenu.js";
import { OverviewView } from "./components/OverviewView.js";
import { GroupsView } from "./components/GroupsView.js";
import { MembersView } from "./components/MembersView.js";
import { readParams, setParam, useUrlParam } from "./url.js";
import {
  filterToQuery,
  hiddenCount,
  isEmptyFilter,
  loadActiveFilter,
  parseFilterSpecJSON,
  persistActiveFilter,
  type FilterSpec,
} from "./filters.js";

type Tab = "overview" | "groups" | "members";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "groups", label: "Groups & products" },
  { id: "members", label: "Members" },
];

/** Read a filter from the URL, falling back to the last-used filter in localStorage. */
function initialFilter(): FilterSpec {
  const raw = readParams().get("filter");
  if (raw) {
    const spec = parseFilterSpecJSON(raw);
    if (spec) return spec;
  }
  return loadActiveFilter();
}

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [tabRaw, setTabRaw] = useUrlParam("tab", "overview");
  const tab = (TABS.some((t) => t.id === tabRaw) ? tabRaw : "overview") as Tab;
  const [from, setFrom] = useUrlParam("from", "");
  const [to, setTo] = useUrlParam("to", "");
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterSpec>(initialFilter);

  const filterQuery = useMemo(() => filterToQuery(filter), [filter]);
  const changeFilter = useCallback((spec: FilterSpec) => {
    setFilter(spec);
    persistActiveFilter(spec);
    setParam("filter", isEmptyFilter(spec) ? null : JSON.stringify({ hidden: spec.hidden }));
  }, []);

  // Keep the filter in sync when the URL changes via back/forward navigation.
  useEffect(() => {
    const sync = () => {
      const raw = readParams().get("filter");
      if (!raw) return setFilter((cur) => (isEmptyFilter(cur) ? cur : loadActiveFilter()));
      const spec = parseFilterSpecJSON(raw);
      if (spec) setFilter(spec);
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await api.status();
      setStatus(s);
      // Fill the date range from the cached range only when the URL didn't pin it.
      const params = readParams();
      if (!params.get("from") && s.cachedDateRange?.min) setFrom(s.cachedDateRange.min, true);
      if (!params.get("to") && s.cachedDateRange?.max) setTo(s.cachedDateRange.max, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [setFrom, setTo]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  return (
    <div className="app">
      <h1>Claude Analytics Explorer</h1>
      <p className="subtitle">
        All-product Claude usage (chat · code · cowork · design · office) joined to your developer CSV.
      </p>

      {error && <p className="error">{error}</p>}

      <ControlBar
        status={status}
        from={from}
        to={to}
        onFrom={setFrom}
        onTo={setTo}
        onChanged={refreshStatus}
        onError={setError}
      >
        <FilterMenu
          dimensions={status?.dimensions ?? []}
          timelineDimensions={status?.timelineDimensions ?? []}
          csvLoaded={status?.csvLoaded ?? false}
          from={from}
          to={to}
          filter={filter}
          onChange={changeFilter}
        />
      </ControlBar>

      {hiddenCount(filter) > 0 && (
        <p className="muted filter-banner">
          Member filter active — {hiddenCount(filter)} value(s) hidden. Applies to Groups, Members, Export and the
          filtered Overview cost/tokens.
        </p>
      )}

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTabRaw(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <OverviewView
          from={from}
          to={to}
          projectCycles={status?.projectCycles ?? []}
          filterQuery={filterQuery}
          onError={setError}
        />
      )}
      {tab === "groups" && (
        <GroupsView
          from={from}
          to={to}
          dimensions={status?.dimensions ?? []}
          timelineDimensions={status?.timelineDimensions ?? []}
          projectCycles={status?.projectCycles ?? []}
          filterQuery={filterQuery}
          onError={setError}
        />
      )}
      {tab === "members" && (
        <MembersView
          from={from}
          to={to}
          filter={filter}
          projectCycles={status?.projectCycles ?? []}
          onError={setError}
        />
      )}
    </div>
  );
}
