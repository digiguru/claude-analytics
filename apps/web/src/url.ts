// Tiny URL query-string state layer so any view is deep-linkable. No router dependency:
// state lives in `?key=value` params, and changing it pushes/replaces history so the URL
// always reflects the current view and a pasted link restores it.
import { useCallback, useEffect, useState } from "react";

/** Subscribers re-read the URL when we mutate it programmatically (the browser only
 *  fires `popstate` for back/forward, not for our own push/replaceState calls). */
const listeners = new Set<() => void>();
function notify(): void {
  for (const l of listeners) l();
}

export function readParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

/** Write one param (null/empty deletes it) and update the URL. `replace` avoids a history entry. */
export function setParam(key: string, value: string | null | undefined, replace = false): void {
  const params = readParams();
  if (value == null || value === "") params.delete(key);
  else params.set(key, value);
  writeParams(params, replace);
}

function writeParams(params: URLSearchParams, replace: boolean): void {
  const qs = params.toString();
  const url = qs ? `?${qs}` : window.location.pathname;
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  notify();
}

/** Bind a single string param to component state. Reflects back/forward navigation. */
export function useUrlParam(
  key: string,
  fallback = "",
): [string, (value: string | null, replace?: boolean) => void] {
  const [value, setValue] = useState(() => readParams().get(key) ?? fallback);

  useEffect(() => {
    const sync = () => setValue(readParams().get(key) ?? fallback);
    listeners.add(sync);
    window.addEventListener("popstate", sync);
    sync(); // re-read in case the URL changed before this effect ran
    return () => {
      listeners.delete(sync);
      window.removeEventListener("popstate", sync);
    };
  }, [key, fallback]);

  const set = useCallback(
    (v: string | null, replace = false) => setParam(key, v, replace),
    [key],
  );
  return [value, set];
}

/** Subscribe to any URL change (push, replace, or back/forward). Returns the live search string. */
export function useUrlChange(): string {
  const [search, setSearch] = useState(() => window.location.search);
  useEffect(() => {
    const sync = () => setSearch(window.location.search);
    listeners.add(sync);
    window.addEventListener("popstate", sync);
    return () => {
      listeners.delete(sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  return search;
}
