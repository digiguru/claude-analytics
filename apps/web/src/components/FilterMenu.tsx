import { useEffect, useMemo, useRef, useState } from "react";
import { api, type TimelineDimension, type UserListEntry } from "../api.js";
import {
  buildFacets,
  EMPTY_FILTER,
  filterToQuery,
  hiddenCount,
  isEmptyFilter,
  loadSavedFilters,
  persistSavedFilters,
  setFacetAll,
  toggleValue,
  type Facet,
  type FilterSpec,
  type SavedFilter,
} from "../filters.js";

interface Props {
  dimensions: string[];
  timelineDimensions: TimelineDimension[];
  csvLoaded: boolean;
  from: string;
  to: string;
  filter: FilterSpec;
  onChange: (spec: FilterSpec) => void;
}

export function FilterMenu({ dimensions, timelineDimensions, csvLoaded, from, to, filter, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<UserListEntry[]>([]);
  const [saved, setSaved] = useState<SavedFilter[]>(() => loadSavedFilters());
  const [openFacet, setOpenFacet] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");
  const popRef = useRef<HTMLDivElement>(null);

  // The member list (with attributes, and — when a projects file is loaded —
  // each person's timeline group membership over the current range) is the
  // source for every facet's values.
  useEffect(() => {
    api
      .users(from || undefined, to || undefined)
      .then((r) => setUsers(r.users))
      .catch(() => setUsers([]));
  }, [csvLoaded, from, to]);

  const facets = useMemo(
    () => buildFacets(users, dimensions, timelineDimensions),
    [users, dimensions, timelineDimensions],
  );

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const count = hiddenCount(filter);
  const empty = isEmptyFilter(filter);

  function saveCurrent() {
    const name = saveName.trim();
    if (!name) return;
    const next = [...saved.filter((f) => f.name !== name), { name, spec: filter }].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    setSaved(next);
    persistSavedFilters(next);
    setSaveName("");
  }

  function deleteSaved(name: string) {
    const next = saved.filter((f) => f.name !== name);
    setSaved(next);
    persistSavedFilters(next);
  }

  return (
    <div className="filter-menu" ref={popRef}>
      <label>Filter members</label>
      <button type="button" className="secondary" onClick={() => setOpen((o) => !o)}>
        Filters{count > 0 ? ` · ${count} hidden` : ""} {open ? "▲" : "▼"}
      </button>

      {open && (
        <div className="filter-pop">
          {!csvLoaded && (
            <p className="muted" style={{ marginTop: 0 }}>
              Upload a CSV to filter by attributes. You can still filter by individual member below.
            </p>
          )}

          <div className="filter-saved">
            <label>Saved filter sets</label>
            {saved.length === 0 && (
              <p className="muted" style={{ margin: "2px 0 8px" }}>
                None saved yet.
              </p>
            )}
            {saved.map((f) => {
              const active = filterToQuery(f.spec) === filterToQuery(filter);
              return (
                <div className="filter-saved-row" key={f.name}>
                  <button
                    type="button"
                    className={active ? "chip active" : "chip"}
                    onClick={() => onChange(f.spec)}
                    title="Load this filter set"
                  >
                    {f.name}
                  </button>
                  <button type="button" className="chip-x" onClick={() => deleteSaved(f.name)} title="Delete">
                    ✕
                  </button>
                </div>
              );
            })}
            <div className="filter-save-row">
              <input
                placeholder="Name this filter set…"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveCurrent()}
              />
              <button type="button" onClick={saveCurrent} disabled={!saveName.trim()}>
                Save
              </button>
            </div>
          </div>

          <div className="filter-groups">
            {facets.map((facet) => (
              <FacetGroup
                key={facet.key}
                facet={facet}
                spec={filter}
                expanded={openFacet === facet.key}
                onToggleExpand={() => setOpenFacet((k) => (k === facet.key ? null : facet.key))}
                onChange={onChange}
              />
            ))}
          </div>

          <div className="filter-footer">
            <button type="button" className="secondary" onClick={() => onChange(EMPTY_FILTER)} disabled={empty}>
              Clear all
            </button>
            <button type="button" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FacetGroup({
  facet,
  spec,
  expanded,
  onToggleExpand,
  onChange,
}: {
  facet: Facet;
  spec: FilterSpec;
  expanded: boolean;
  onToggleExpand: () => void;
  onChange: (s: FilterSpec) => void;
}) {
  const [search, setSearch] = useState("");
  const hidden = spec.hidden[facet.key] ?? [];
  const shownCount = facet.values.length - hidden.length;
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? facet.values.filter((v) => v.toLowerCase().includes(q)) : facet.values;
  }, [facet.values, search]);

  return (
    <div className="facet">
      <button type="button" className="facet-head" onClick={onToggleExpand}>
        <span>
          {expanded ? "▾" : "▸"} {facet.label}
        </span>
        <span className="muted">
          {shownCount}/{facet.values.length}
        </span>
      </button>
      {expanded && (
        <div className="facet-body">
          <div className="facet-actions">
            <button
              type="button"
              className="link"
              onClick={() => onChange(setFacetAll(spec, facet.key, facet.values, false))}
            >
              Select all
            </button>
            <button
              type="button"
              className="link"
              onClick={() => onChange(setFacetAll(spec, facet.key, facet.values, true))}
            >
              Select none
            </button>
          </div>
          {facet.values.length > 10 && (
            <input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          )}
          <div className="facet-values">
            {visible.map((v) => (
              <label key={v} className="facet-check">
                <input
                  type="checkbox"
                  checked={!hidden.includes(v)}
                  onChange={() => onChange(toggleValue(spec, facet.key, v))}
                />
                <span>{v}</span>
              </label>
            ))}
            {visible.length === 0 && (
              <p className="muted" style={{ margin: 4 }}>
                No matches.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
