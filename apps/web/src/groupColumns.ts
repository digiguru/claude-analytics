// The Groups table's column definitions — extracted from GroupsView (#29).
// Pure configuration (no JSX), parameterized by whether "Stacking by" is the
// Cycle dimension (which sorts the Group column chronologically instead of
// alphabetically) and the current cycle order.
import { tokens, usd, type GroupRow } from "./api.js";
import type { Column } from "./components/SortableTable.js";

export function buildGroupColumns(isCycleDimension: boolean, cycleOrder: Map<string, number>): Column<GroupRow>[] {
  return [
    {
      key: "key",
      label: "Group",
      value: (r) => (isCycleDimension ? (cycleOrder.get(r.key) ?? Number.MAX_SAFE_INTEGER) : r.key),
      render: (r) => r.key,
    },
    { key: "seats", label: "Seats", numeric: true, value: (r) => r.seats },
    { key: "activeUsers", label: "Active users", numeric: true, value: (r) => r.activeUsers },
    {
      key: "activeUserDays",
      label: "Active days",
      numeric: true,
      value: (r) => r.activeUserDays,
      render: (r) => r.activeUserDays.toFixed(1),
    },
    { key: "costCents", label: "Cost", numeric: true, value: (r) => r.costCents, render: (r) => usd(r.costCents) },
    {
      key: "avgCostPerSeat",
      label: "$/seat",
      numeric: true,
      value: (r) => r.avgCostPerSeat,
      render: (r) => usd(r.avgCostPerSeat),
    },
    {
      key: "avgCostPerActiveUser",
      label: "$/active user",
      numeric: true,
      value: (r) => r.avgCostPerActiveUser,
      render: (r) => usd(r.avgCostPerActiveUser),
    },
    {
      key: "totalTokens",
      label: "Tokens",
      numeric: true,
      value: (r) => r.totalTokens,
      render: (r) => tokens(r.totalTokens),
    },
    { key: "chatMessages", label: "Chat", numeric: true, value: (r) => r.chatMessages },
    { key: "ccSessions", label: "CC sessions", numeric: true, value: (r) => r.ccSessions },
    { key: "ccLocAdded", label: "CC loc+", numeric: true, value: (r) => r.ccLocAdded },
    { key: "coworkMessages", label: "Cowork", numeric: true, value: (r) => r.coworkMessages },
    { key: "webSearches", label: "Web", numeric: true, value: (r) => r.webSearches },
  ];
}
