import { useRef, useState, type ReactNode } from "react";
import { api, type Status } from "../api.js";

interface Props {
  status: Status | null;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onChanged: () => void | Promise<void>;
  onError: (msg: string | null) => void;
  children?: ReactNode;
}

export function ControlBar({ status, from, to, onFrom, onTo, onChanged, onError, children }: Props) {
  const [syncing, setSyncing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function doSync() {
    if (!from || !to) {
      onError("Pick a from and to date to sync.");
      return;
    }
    setSyncing(true);
    onError(null);
    try {
      const r = await api.sync(from, to);
      setNote(`Synced ${r.activityDays} activity day(s), ${r.userProductRows} user×product row(s).`);
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    onError(null);
    try {
      const r = await api.uploadCsv(file);
      setNote(`Loaded CSV: ${r.rows} row(s).`);
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="panel">
      <div className="row">
        <div>
          <label>From (UTC)</label>
          <input type="date" value={from} onChange={(e) => onFrom(e.target.value)} />
        </div>
        <div>
          <label>To (UTC)</label>
          <input type="date" value={to} onChange={(e) => onTo(e.target.value)} />
        </div>
        <button onClick={doSync} disabled={syncing}>
          {syncing ? "Syncing…" : "Sync from API"}
        </button>
        <button
          className="secondary"
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Uploading…" : "Upload CSV"}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        {children}
      </div>

      <div style={{ marginTop: 12 }}>
        {status && !status.apiKeyConfigured && (
          <span className="error">No Admin API key configured — set ANTHROPIC_ADMIN_API_KEY in .env. </span>
        )}
        <span className="pill">
          CSV: {status?.csvLoaded ? status.csvSource : "none loaded"}
        </span>
        <span className="pill">Developers cached: {status?.developerCount ?? 0}</span>
        <span className="pill">
          Cached range:{" "}
          {status?.cachedDateRange
            ? `${status.cachedDateRange.min} → ${status.cachedDateRange.max}`
            : "empty"}
        </span>
        {note && <span className="muted"> {note}</span>}
      </div>
    </div>
  );
}
