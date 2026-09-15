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
  const [uploadingCsv, setUploadingCsv] = useState(false);
  const [uploadingProjects, setUploadingProjects] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const projectsInput = useRef<HTMLInputElement>(null);

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
    setUploadingCsv(true);
    onError(null);
    try {
      const r = await api.uploadCsv(file);
      setNote(`Loaded CSV: ${r.rows} row(s).`);
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingCsv(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function onProjectsFile(file: File | undefined) {
    if (!file) return;
    setUploadingProjects(true);
    onError(null);
    try {
      const r = await api.uploadProjects(file);
      setNote(`Loaded projects: ${r.projects} project(s), ${r.members} membership(s).${r.warnings.length ? ` ${r.warnings.length} warning(s).` : ""}`);
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingProjects(false);
      if (projectsInput.current) projectsInput.current.value = "";
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
          disabled={uploadingCsv}
        >
          {uploadingCsv ? "Uploading…" : "Upload CSV"}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <button
          className="secondary"
          onClick={() => projectsInput.current?.click()}
          disabled={uploadingProjects}
        >
          {uploadingProjects ? "Uploading…" : "Upload projects YAML"}
        </button>
        <input
          ref={projectsInput}
          type="file"
          accept=".yaml,.yml"
          style={{ display: "none" }}
          onChange={(e) => onProjectsFile(e.target.files?.[0])}
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
        <span className="pill">
          Projects: {status?.projectsLoaded ? status.projectsSource : "none loaded"}
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

      {status && status.projectWarnings.length > 0 && (
        <p className="muted" style={{ marginTop: 8 }}>
          {status.projectWarnings.length} projects-file warning(s):{" "}
          {status.projectWarnings.join(" · ")}
        </p>
      )}
    </div>
  );
}
