import { api, CYCLE_DIMENSION_ID, CYCLE_DIMENSION_LABEL, PRODUCTS } from "../api.js";
import type { QuickFilterFacet } from "../quickFilter.js";

/** The Groups page's top control row: Stacking by / Quick filter by / Product
 *  selects, plus the two CSV export links. Extracted from GroupsView (#29).
 *  Purely presentational — every value and handler comes in as a prop. */
export function GroupsControls({
  dimension,
  onDimensionChange,
  dimensions,
  timelineDimensions,
  cycleAvailable,
  quickFilterFacets,
  qfRaw,
  onQfChange,
  product,
  onProductChange,
  from,
  to,
  effectiveFilterQuery,
  scopeValue,
  scopeDimension,
}: {
  dimension: string;
  onDimensionChange: (v: string) => void;
  dimensions: string[];
  timelineDimensions: { id: string; label: string }[];
  cycleAvailable: boolean;
  quickFilterFacets: QuickFilterFacet[];
  qfRaw: string;
  onQfChange: (v: string) => void;
  product: string;
  onProductChange: (v: string) => void;
  from: string;
  to: string;
  effectiveFilterQuery: string | undefined;
  scopeValue: string | undefined;
  scopeDimension: string | undefined;
}) {
  const exportParams = {
    dimension,
    from: from || undefined,
    to: to || undefined,
    product: product || undefined,
    filter: effectiveFilterQuery,
    scope: scopeValue,
    scopeDimension,
  };

  return (
    <div className="row" style={{ marginBottom: 16 }}>
      <div>
        <label>Stacking by</label>
        <select value={dimension} onChange={(e) => onDimensionChange(e.target.value)}>
          {dimensions.length === 0 && timelineDimensions.length === 0 && (
            <option value="">— no CSV or projects file loaded —</option>
          )}
          {timelineDimensions.length > 0 && (
            <optgroup label="Timeline">
              {timelineDimensions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
              {cycleAvailable && <option value={CYCLE_DIMENSION_ID}>{CYCLE_DIMENSION_LABEL}</option>}
            </optgroup>
          )}
          {dimensions.length > 0 && (
            <optgroup label="CSV columns">
              {dimensions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
      {quickFilterFacets.length > 0 && (
        <div>
          <label>Quick filter by</label>
          <select value={qfRaw} onChange={(e) => onQfChange(e.target.value)}>
            <option value="">None</option>
            {quickFilterFacets.map((f) => (
              <optgroup label={f.label} key={f.id}>
                {f.values.map((v) => (
                  <option key={`${f.id}::${v}`} value={`${f.id}::${v}`}>
                    {v}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      )}
      <div>
        <label>Product (cost/tokens)</label>
        <select value={product} onChange={(e) => onProductChange(e.target.value)}>
          <option value="">All products</option>
          {PRODUCTS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <a href={api.exportUrl(exportParams)}>
        <button className="secondary" type="button">
          Export CSV
        </button>
      </a>
      <a href={api.exportGroupsDailyUrl(exportParams)}>
        <button className="secondary" type="button">
          Export daily CSV
        </button>
      </a>
    </div>
  );
}
