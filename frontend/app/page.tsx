"use client";

import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Cpu,
  Database,
  FileClock,
  Gauge,
  HardDrive,
  Info,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Network,
  RefreshCw,
  Settings2,
  Shield,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  X,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  DEFAULT_PREFERENCES,
  DiskMetric,
  formatBytes,
  formatTime,
  formatUptime,
  Preferences,
  SystemMetrics,
} from "@/lib/metrics";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

type NavItem = "Overview" | "Monitoring" | "Incident center" | "AI diagnosis" | "Activity log" | "Settings";
type Sample = { time: string; cpu: number; memory: number };
type DiagnosisCause = { cause: string; likelihood: number; rationale: string };
type DiagnosisPlan = {
  incident_type: string;
  severity: "low" | "medium" | "high" | "critical" | "unknown";
  observations: string[];
  possible_causes: DiagnosisCause[];
  recommended_checks: string[];
  proposed_fix: string;
  requires_approval: boolean;
  verification: string;
  uncertainties: string[];
};
type ActivityEvent = {
  id: string;
  occurred_at: string;
  event_type: "monitoring_sample" | "diagnosis" | "diagnosis_failure" | string;
  title: string;
  summary: string;
  severity: string;
  details: Record<string, unknown>;
};
const preferenceListeners = new Set<() => void>();
let preferenceSnapshot: Preferences = DEFAULT_PREFERENCES;
let preferencesLoaded = false;

const mainNavigation: { label: NavItem; icon: typeof LayoutDashboard }[] = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Monitoring", icon: Activity },
  { label: "Incident center", icon: AlertTriangle },
  { label: "AI diagnosis", icon: Sparkles },
  { label: "Activity log", icon: FileClock },
];

function getPreferences(): Preferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  if (preferencesLoaded) return preferenceSnapshot;
  preferencesLoaded = true;
  try {
    const stored = window.localStorage.getItem("sha-preferences");
    if (!stored) {
      preferenceSnapshot = DEFAULT_PREFERENCES;
      return preferenceSnapshot;
    }
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") {
      preferenceSnapshot = DEFAULT_PREFERENCES;
      return preferenceSnapshot;
    }
    const values = parsed as Partial<Preferences>;
    preferenceSnapshot = {
      interval: clamp(values.interval, 2, 300, DEFAULT_PREFERENCES.interval),
      cpuThreshold: clamp(values.cpuThreshold, 0, 100, DEFAULT_PREFERENCES.cpuThreshold),
      memoryThreshold: clamp(values.memoryThreshold, 0, 100, DEFAULT_PREFERENCES.memoryThreshold),
      diskThreshold: clamp(values.diskThreshold, 0, 100, DEFAULT_PREFERENCES.diskThreshold),
    };
    return preferenceSnapshot;
  } catch {
    preferenceSnapshot = DEFAULT_PREFERENCES;
    return preferenceSnapshot;
  }
}

function subscribePreferences(listener: () => void) {
  preferenceListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== "sha-preferences") return;
    preferencesLoaded = false;
    preferenceListeners.forEach((notify) => notify());
  };
  window.addEventListener("storage", onStorage);
  return () => {
    preferenceListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function savePreference(key: keyof Preferences, value: number) {
  const next = { ...getPreferences(), [key]: value };
  preferenceSnapshot = next;
  preferencesLoaded = true;
  try {
    window.localStorage.setItem("sha-preferences", JSON.stringify(next));
  } catch {
    // Keep the updated setting for this page session when browser storage is unavailable.
  }
  preferenceListeners.forEach((listener) => listener());
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

function AppMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <ShieldCheck size={21} strokeWidth={2.2} />
    </div>
  );
}

function MetricCard({
  title,
  value,
  detail,
  icon: Icon,
  accent,
  progress,
  footer,
}: {
  title: string;
  value: string;
  detail: string;
  icon: typeof Cpu;
  accent: string;
  progress?: number;
  footer?: string;
}) {
  return (
    <article className="metric-card">
      <div className="metric-card-top">
        <div>
          <div className="metric-label">{title}</div>
          <div className="metric-value">{value}</div>
        </div>
        <span className={`metric-icon ${accent}`}><Icon size={19} /></span>
      </div>
      <div className="metric-detail">{detail}</div>
      {progress !== undefined ? (
        <div className="progress-track"><span className={accent} style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} /></div>
      ) : <div className="metric-spacer" />}
      <div className="metric-footer">{footer ?? <><span className="live-dot" /> Live measurement</>}</div>
    </article>
  );
}

function DiskCard({ disk }: { disk: DiskMetric }) {
  const tone = disk.free_percent <= 10 ? "danger" : disk.free_percent <= 20 ? "warning" : "mint";
  return (
    <article className="disk-card">
      <div className="disk-card-heading">
        <div className="disk-symbol"><HardDrive size={18} /></div>
        <div className="disk-name">{disk.mountpoint}</div>
        <span className="disk-usage">{disk.used_percent.toFixed(0)}% used</span>
      </div>
      <div className="disk-track"><span className={tone} style={{ width: `${Math.min(100, disk.used_percent)}%` }} /></div>
      <div className="disk-foot">
        <span>{formatBytes(disk.free_bytes)} available</span>
        <span>of {formatBytes(disk.total_bytes)}</span>
      </div>
    </article>
  );
}

function NoData({ icon: Icon, title, detail }: { icon: typeof CircleHelp; title: string; detail: string }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon size={21} /></span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

export default function Home() {
  const [activeNav, setActiveNav] = useState<NavItem>("Overview");
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const preferences = useSyncExternalStore(
    subscribePreferences,
    getPreferences,
    () => DEFAULT_PREFERENCES,
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const signOut = async () => {
    try {
      const supabase = createSupabaseClient();
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sign out.");
      return;
    }
    window.location.replace("/login");
  };

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const query = new URLSearchParams({
      interval: String(preferences.interval),
      cpu_threshold: String(preferences.cpuThreshold),
      memory_threshold: String(preferences.memoryThreshold),
      disk_threshold: String(preferences.diskThreshold),
    });
    try {
      const response = await fetch(`/api/metrics?${query}`, { cache: "no-store", signal });
      const body: unknown = await response.json();
      if (!response.ok) {
        const detail = body && typeof body === "object" && "detail" in body
          ? String(body.detail)
          : `Metrics request failed (${response.status}).`;
        throw new Error(detail);
      }
      const nextMetrics = body as SystemMetrics;
      setMetrics(nextMetrics);
      setError("");
      setSamples((current) => [
        ...current.slice(-29),
        {
          time: formatTime(nextMetrics.captured_at),
          cpu: nextMetrics.cpu_percent,
          memory: nextMetrics.memory_percent,
        },
      ]);
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "Could not read system metrics.");
    } finally {
      setLoading(false);
    }
  }, [preferences]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    const poll = () => {
      if (controller.signal.aborted) return;
      void refresh(controller.signal).finally(() => {
        if (!controller.signal.aborted) {
          timer = window.setTimeout(poll, preferences.interval * 1000);
        }
      });
    };
    const initialRequest = window.setTimeout(poll, 0);
    return () => {
      controller.abort();
      window.clearTimeout(initialRequest);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [preferences.interval, refresh]);

  const minDisk = useMemo(
    () => metrics?.disks.reduce<DiskMetric | null>(
      (lowest, disk) => (!lowest || disk.free_percent < lowest.free_percent ? disk : lowest),
      null,
    ) ?? null,
    [metrics],
  );

  const pageSubtitle: Record<NavItem, string> = {
    Overview: "Browser-only mode cannot inspect this computer’s hardware.",
    Monitoring: "Full system readings require a small local agent.",
    "Incident center": "Hardware warnings are unavailable without a local agent.",
    "AI diagnosis": "System diagnosis requires measurements from a local agent.",
    "Activity log": "Persistent device history requires a local agent.",
    Settings: "Tune browser-side display preferences.",
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <AppMark />
          <div className="brand-copy"><strong>hearth</strong><span>PC HEALTH AGENT</span></div>
          <button className="mobile-close icon-button" onClick={() => setSidebarOpen(false)} aria-label="Close navigation"><X size={19} /></button>
        </div>

        <div className="workspace-switcher">
          <span className="device-icon"><Monitor size={16} /></span>
          <span><strong>Browser session</strong><small>Web-only access</small></span>
          <ChevronDown size={15} className="switch-chevron" />
        </div>

        <div className="nav-section-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {mainNavigation.map(({ label, icon: Icon }) => (
            <button key={label} onClick={() => { setActiveNav(label); setSidebarOpen(false); }} className={`nav-link ${activeNav === label ? "nav-active" : ""}`}>
              <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
              {label === "Incident center" && metrics?.warnings.length ? <span className="nav-count">{metrics.warnings.length}</span> : null}
            </button>
          ))}
        </nav>

        <div className="nav-section-label tools-label">PREFERENCES</div>
        <nav className="side-nav">
          <button onClick={() => { setActiveNav("Settings"); setSidebarOpen(false); }} className={`nav-link ${activeNav === "Settings" ? "nav-active" : ""}`}>
            <Settings2 size={17} strokeWidth={1.8} /><span>Settings</span>
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="safety-card">
            <span className="safety-icon"><Shield size={16} /></span>
            <div><strong>Read-only mode</strong><p>Your system is never changed without your approval.</p></div>
          </div>
          <div className="profile-row">
            <div className="avatar">PC</div>
            <div className="profile-copy"><strong>Signed-in user</strong><span>MFA protected</span></div>
            <span className="online-indicator" title="Local dashboard" />
          </div>
        </div>
      </aside>

      {sidebarOpen ? <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Close navigation" /> : null}

      <main className="main-panel">
        <header className="topbar">
          <button className="mobile-menu icon-button" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>{activeNav}</strong></div>
          <div className="topbar-right">
            <span className="local-badge"><span className="live-dot" /> SECURE · MFA</span>
            <button className="icon-button help-button" aria-label="Help"><CircleHelp size={18} /></button>
            <button className="refresh-button" onClick={() => void signOut()}><LogOut size={15} /> Sign out</button>
            <div className="top-avatar">PC</div>
          </div>
        </header>

        <div className="content-wrap">
          <div className="page-heading">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> SELF-HEALING AGENT</div>
              <h1>{activeNav === "Overview" ? "Good to see you." : activeNav}</h1>
              <p>{activeNav === "Overview" && metrics ? `Here’s the latest system status from ${metrics.platform.split("-")[0]}.` : pageSubtitle[activeNav]}</p>
            </div>
            <div className="heading-actions">
              <span className="last-updated">{metrics ? <>Updated <strong>{formatTime(metrics.captured_at)}</strong></> : error ? "Metrics unavailable" : "Waiting for metrics"}</span>
              <button className="refresh-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""} /> Refresh</button>
            </div>
          </div>

          {error ? (
            <div className="error-banner" role="alert">
              <span className="warning-icon"><AlertTriangle size={18} /></span>
              <div><strong>System metrics are unavailable</strong><p>{error}</p><small>A browser cannot read CPU, memory, processes, disks, or OS health. Full readings require a local agent on the monitored PC.</small></div>
              <button className="icon-button error-retry" onClick={() => void refresh()} aria-label="Retry"><RefreshCw size={16} /></button>
            </div>
          ) : null}

          {activeNav === "Settings" ? (
            <SettingsView preferences={preferences} updatePreference={savePreference} />
          ) : activeNav === "Incident center" ? (
            <section className="section-card page-section">
              <SectionHeading icon={AlertTriangle} title="Incident center" description="Current threshold observations, plus confirmed incident records when detection is enabled." />
              {metrics?.warnings.length ? <WarningList warnings={metrics.warnings} /> : metrics ? <NoData icon={ShieldCheck} title="No active warnings" detail="Your current readings are within their configured warning thresholds." /> : <NoData icon={Monitor} title="No system readings" detail="Browser-only mode cannot inspect hardware. Connect a local agent to check for warnings." />}
              <div className="phase-note"><span className="phase-dot" /> Confirmed incident detection is planned for Phase 2. A single high reading is only a warning.</div>
            </section>
          ) : activeNav === "AI diagnosis" ? (
            <DiagnosisView />
          ) : activeNav === "Activity log" ? (
            <ActivityLogView />
          ) : (
            <>
              {activeNav === "Monitoring" ? (
                <div className="monitoring-banner"><Activity size={18} /><div><strong>{metrics ? "Monitoring is active" : "Hardware monitoring is unavailable"}</strong><span>{metrics ? `Read-only checks refresh every ${preferences.interval} seconds. No background changes are made.` : "A local agent is required to read system hardware; this browser-only site cannot collect those metrics."}</span></div>{metrics ? <span className="active-pill"><span className="live-dot" /> LIVE</span> : null}</div>
              ) : null}

              {metrics?.warnings.length ? <WarningList warnings={metrics.warnings} compact /> : null}

              <section className="metric-grid" aria-label="System metrics">
                <MetricCard title="CPU usage" value={metrics ? `${metrics.cpu_percent.toFixed(1)}%` : "—"} detail="Processor utilization" icon={Cpu} accent="violet" progress={metrics?.cpu_percent} footer={metrics ? "Live measurement" : "Unavailable in browser-only mode"} />
                <MetricCard title="Memory" value={metrics ? `${metrics.memory_percent.toFixed(1)}%` : "—"} detail={metrics ? `${formatBytes(metrics.memory_used_bytes)} of ${formatBytes(metrics.memory_total_bytes)}` : "Memory utilization"} icon={Database} accent="blue" progress={metrics?.memory_percent} footer={metrics ? "Live measurement" : "Unavailable in browser-only mode"} />
                <MetricCard title="Disk space" value={minDisk ? `${minDisk.free_percent.toFixed(1)}%` : "—"} detail={minDisk ? `${formatBytes(minDisk.free_bytes)} free on ${minDisk.mountpoint}` : "Available storage"} icon={HardDrive} accent="mint" progress={minDisk ? 100 - minDisk.free_percent : undefined} footer={minDisk ? `${formatBytes(minDisk.total_bytes)} total` : "Unavailable in browser-only mode"} />
                <MetricCard title="System uptime" value={metrics ? formatUptime(metrics.uptime_seconds) : "—"} detail="Since last system start" icon={Clock3} accent="amber" footer={metrics ? `Python ${metrics.python_version}` : "Unavailable in browser-only mode"} />
              </section>

              <div className="dashboard-columns">
                <section className="section-card chart-card">
                  <SectionHeading icon={Activity} title="Resource usage" description="CPU and memory utilization" trailing={metrics ? <span className="chart-period"><span className="live-dot" /> LIVE</span> : <span className="chart-period">UNAVAILABLE</span>} />
                  <div className="chart-legend"><span><i className="legend-dot cpu-legend" /> CPU</span><span><i className="legend-dot memory-legend" /> Memory</span></div>
                  {samples.length > 1 ? (
                    <div className="chart-wrap">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={samples} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="cpuFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8176f5" stopOpacity={0.19} /><stop offset="95%" stopColor="#8176f5" stopOpacity={0} /></linearGradient>
                            <linearGradient id="memoryFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#53c9a5" stopOpacity={0.14} /><stop offset="95%" stopColor="#53c9a5" stopOpacity={0} /></linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} stroke="#eff0f4" strokeDasharray="3 5" />
                          <XAxis dataKey="time" tickLine={false} axisLine={false} tick={{ fill: "#9598a5", fontSize: 10 }} minTickGap={30} />
                          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickLine={false} axisLine={false} tick={{ fill: "#9598a5", fontSize: 10 }} tickFormatter={(value: number) => `${value}%`} />
                          <Tooltip contentStyle={{ border: "1px solid #eeeff3", borderRadius: 10, fontSize: 12, boxShadow: "0 6px 24px #17203312" }} formatter={(value) => [`${Number(value).toFixed(1)}%`]} />
                          <Area type="monotone" dataKey="memory" name="Memory" stroke="#52c5a1" strokeWidth={2} fill="url(#memoryFill)" />
                          <Area type="monotone" dataKey="cpu" name="CPU" stroke="#8176f5" strokeWidth={2} fill="url(#cpuFill)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : <div className="chart-placeholder"><div className="chart-placeholder-icon"><Activity size={21} /></div><strong>Resource timeline unavailable</strong><span>Browser-only mode cannot collect CPU or memory measurements.</span></div>}
                  <div className="chart-footnote"><span>{metrics ? <>Sampling every {preferences.interval}s</> : "Requires a local agent"}</span><span>{samples.length} {samples.length === 1 ? "sample" : "samples"} in this session</span></div>
                </section>

                <section className="section-card health-card">
                  <SectionHeading icon={ShieldCheck} title="Health summary" description="Current system signals" />
                  <div className="health-score">
                    <div className={`health-ring ${metrics?.warnings.length ? "ring-warning" : ""}`}>
                      <div><span>{metrics ? (metrics.warnings.length ? "!" : "OK") : "—"}</span><small>{metrics?.warnings.length ? "ATTENTION" : "STATUS"}</small></div>
                    </div>
                    <div className="health-copy"><strong>{metrics ? (metrics.warnings.length ? "Needs a closer look" : "Everything looks good") : "System status unavailable"}</strong><span>{metrics ? `${metrics.warnings.length} current warning${metrics.warnings.length === 1 ? "" : "s"} · No fixes will run automatically` : "Browser-only mode cannot read the monitored computer."}</span></div>
                  </div>
                  <div className="signal-list">
                    <SignalRow icon={Cpu} label="Processor" value={metrics ? `${metrics.cpu_percent.toFixed(0)}%` : "—"} status={metrics && metrics.cpu_percent >= preferences.cpuThreshold ? "warning" : metrics ? "good" : "pending"} />
                    <SignalRow icon={Database} label="Memory" value={metrics ? `${metrics.memory_percent.toFixed(0)}%` : "—"} status={metrics && metrics.memory_percent >= preferences.memoryThreshold ? "warning" : metrics ? "good" : "pending"} />
                    <SignalRow icon={HardDrive} label="Storage" value={minDisk ? `${minDisk.free_percent.toFixed(0)}% free` : "—"} status={minDisk && minDisk.free_percent <= preferences.diskThreshold ? "warning" : minDisk ? "good" : "pending"} />
                    <SignalRow icon={Network} label="Network" value="Not checked" status="pending" />
                  </div>
                  <div className="health-note"><Shield size={14} /> Warnings are observations, not confirmed incidents.</div>
                </section>
              </div>

              <div className="lower-grid">
                <section className="section-card storage-section">
                  <SectionHeading icon={HardDrive} title="Storage volumes" description={metrics ? `${metrics.disks.length} readable volume${metrics.disks.length === 1 ? "" : "s"} on this device` : "Waiting for disk measurements"} trailing={<button className="text-button" onClick={() => setActiveNav("Monitoring")}>View monitoring <ArrowUpRight size={14} /></button>} />
                  {metrics?.collection_warnings.length ? <CollectionNotes messages={metrics.collection_warnings} /> : null}
                  <div className="disk-grid">{metrics?.disks.map((disk) => <DiskCard key={disk.mountpoint} disk={disk} />)}</div>
                  {metrics && metrics.disks.length === 0 ? <NoData icon={HardDrive} title="No readable volumes" detail="The current user may not have permission to inspect mounted volumes." /> : null}
                </section>
                <section className="section-card process-section">
                  <SectionHeading icon={Zap} title="Top processes" description={metrics ? `${metrics.process_count} processes observed` : "Resource use by process"} trailing={<span className="table-live"><span className="live-dot" /> LIVE</span>} />
                  <ProcessTable processes={metrics?.top_processes ?? []} />
                </section>
              </div>

              <footer className="dashboard-footer">
                <span><ShieldCheck size={14} /> Browser-only mode does not read hardware measurements.</span>
                <span>Self-Healing PC Agent <b>·</b> Phase 1 foundation</span>
              </footer>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function SectionHeading({
  icon: Icon,
  title,
  description,
  trailing,
}: {
  icon: typeof Activity;
  title: string;
  description: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="section-heading">
      <div className="section-heading-icon"><Icon size={16} /></div>
      <div className="section-heading-copy"><h2>{title}</h2><p>{description}</p></div>
      {trailing ? <div className="section-trailing">{trailing}</div> : null}
    </div>
  );
}

function SignalRow({
  icon: Icon,
  label,
  value,
  status,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  status: "good" | "warning" | "pending";
}) {
  return (
    <div className="signal-row">
      <span className={`signal-icon ${status}`}><Icon size={15} /></span>
      <span className="signal-label">{label}</span>
      <strong>{value}</strong>
      <span className={`signal-status ${status}`}><i />{status === "good" ? "Normal" : status === "warning" ? "Check" : "Pending"}</span>
    </div>
  );
}

function ProcessTable({ processes }: { processes: SystemMetrics["top_processes"] }) {
  if (!processes.length) return <div className="table-empty"><TerminalSquare size={19} /><span>Process information is not available yet.</span></div>;
  return (
    <div className="process-table-wrap">
      <table className="process-table">
        <thead><tr><th>PROCESS</th><th>PID</th><th>CPU</th><th>MEMORY</th></tr></thead>
        <tbody>{processes.slice(0, 6).map((process) => (
          <tr key={process.pid}>
            <td><span className="process-name"><span className="process-bullet" />{process.name}</span></td>
            <td className="pid-cell">{process.pid}</td>
            <td><span className="process-value">{process.cpu_percent.toFixed(1)}%</span></td>
            <td><span className="process-value">{process.memory_percent.toFixed(1)}%</span></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function WarningList({ warnings, compact = false }: { warnings: string[]; compact?: boolean }) {
  return (
    <div className={`warning-list ${compact ? "warning-compact" : ""}`}>
      {warnings.map((warning, index) => (
        <div className="warning-item" key={`${index}-${warning}`}>
          <span className="warning-icon"><AlertTriangle size={16} /></span>
          <span>{warning}</span>
        </div>
      ))}
    </div>
  );
}

function CollectionNotes({ messages }: { messages: string[] }) {
  return (
    <div className="collection-notes" aria-label="Storage availability notes">
      {messages.map((message, index) => (
        <div className="collection-note" key={`${index}-${message}`}>
          <Info size={15} />
          <span>{message}</span>
        </div>
      ))}
    </div>
  );
}

function DiagnosisView() {
  const [provider, setProvider] = useState<{ configured: boolean; provider: string; model: string } | null>(null);
  const [description, setDescription] = useState("");
  const [consent, setConsent] = useState(false);
  const [plan, setPlan] = useState<DiagnosisPlan | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/diagnosis", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Diagnosis status is unavailable.");
        setProvider(body as { configured: boolean; provider: string; model: string });
      })
      .catch((reason: unknown) => {
        if (reason instanceof Error && reason.name !== "AbortError") setError(reason.message);
      });
    return () => controller.abort();
  }, []);

  const runDiagnosis = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setPlan(null);
    try {
      const response = await fetch("/api/diagnosis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problem_description: description, consent_to_send: consent }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const detail = body && typeof body === "object" && "detail" in body
          ? String(body.detail)
          : `Diagnosis request failed (${response.status}).`;
        throw new Error(detail);
      }
      setPlan(body as DiagnosisPlan);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not generate a diagnosis.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="diagnosis-layout">
      <section className="section-card diagnosis-form-card">
        <SectionHeading icon={Sparkles} title="Evidence-led diagnosis" description="Describe the issue and get a structured plan based on live measurements." />
        <div className="provider-status">
          <span className={`provider-indicator ${provider?.configured ? "configured" : ""}`} />
          <span>{provider ? (provider.configured ? `${provider.provider} connected · ${provider.model}` : "OpenAI is not configured") : "Checking provider configuration…"}</span>
          {provider?.configured ? <span className="provider-ready">READY</span> : null}
        </div>
        {!provider?.configured && provider ? (
          <div className="provider-setup">
            <>Set <code>OPENAI_API_KEY</code> in the environment where the Python API runs, then restart it. The key is used only by the local Python backend and is never sent to this browser.</>
          </div>
        ) : null}
        <form className="diagnosis-form" onSubmit={runDiagnosis}>
          <label htmlFor="problem-description" className="diagnosis-label">What problem are you seeing?</label>
          <textarea
            id="problem-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={3000}
            minLength={5}
            rows={5}
            placeholder="Describe the error message, what you were doing, and when it started. Please remove passwords, API keys, and other private details."
            required
          />
          <div className="input-foot"><span>Only include details needed to investigate.</span><span>{description.length}/3000</span></div>
          <div className="transmission-notice">
            <Shield size={16} />
            <div>
              <strong>Nothing is sent until you ask for a diagnosis.</strong>
              <p>After consent, your description and a small set of measurements (OS/Python version, CPU, memory, disk capacity and process count) are sent to OpenAI. Process names, PIDs, file contents, drive names, and environment variables are excluded.</p>
            </div>
          </div>
          <label className="consent-row">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            <span>I agree to send the description and listed system measurements to OpenAI for this diagnosis.</span>
          </label>
          <button className="diagnose-button" type="submit" disabled={!provider?.configured || !consent || description.trim().length < 5 || loading}>
            {loading ? <><RefreshCw size={15} className="spin" /> Analyzing evidence…</> : <><Sparkles size={15} /> Generate diagnosis</>}
          </button>
        </form>
        {error ? <div className="diagnosis-error" role="alert"><AlertTriangle size={15} />{error}</div> : null}
      </section>

      <section className="section-card diagnosis-results">
        {plan ? <DiagnosisResult plan={plan} /> : (
          <>
            <SectionHeading icon={ShieldCheck} title="Diagnosis results" description="Possible causes will be clearly separated from confirmed evidence." />
            <NoData icon={Sparkles} title="Ready when you are" detail="Enter an issue, review what will be shared, give consent, and request a diagnosis." />
            <div className="diagnosis-safety-note"><Shield size={14} /> Suggestions only. This feature never executes a fix.</div>
          </>
        )}
      </section>
    </div>
  );
}

function DiagnosisResult({ plan }: { plan: DiagnosisPlan }) {
  const severity = ["low", "medium", "high", "critical", "unknown"].includes(plan.severity) ? plan.severity : "unknown";
  return (
    <div className="diagnosis-result">
      <div className="result-heading">
        <div><div className="result-eyebrow">DIAGNOSTIC PLAN</div><h2>{plan.incident_type.replaceAll("_", " ")}</h2></div>
        <span className={`severity-badge severity-${severity}`}>{severity}</span>
      </div>
      <ResultList title="Observed evidence" items={plan.observations} />
      <div className="result-subheading">Possible causes</div>
      {plan.possible_causes.length ? (
        <div className="cause-list">{plan.possible_causes.map((cause, index) => (
          <article className="cause-card" key={`${index}-${cause.cause}`}>
            <div className="cause-top"><strong>{cause.cause}</strong><span>{Math.round(cause.likelihood * 100)}% likelihood</span></div>
            <p>{cause.rationale}</p>
          </article>
        ))}</div>
      ) : <p className="result-muted">There is not enough evidence to rank possible causes.</p>}
      <ResultList title="Recommended read-only checks" items={plan.recommended_checks} />
      <div className="result-subheading">Proposed next step</div>
      <p className="proposed-fix">{plan.proposed_fix}</p>
      <div className="verification-card"><strong>How to verify</strong><p>{plan.verification}</p></div>
      {plan.uncertainties.length ? <ResultList title="Remaining uncertainty" items={plan.uncertainties} /> : null}
      <div className="approval-boundary"><Shield size={14} /> {plan.requires_approval ? "Any change requires your approval. No action was performed." : "Diagnosis only. No action was performed."}</div>
    </div>
  );
}

function ResultList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="result-list-section">
      <div className="result-subheading">{title}</div>
      <ul className="result-list">{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
    </div>
  );
}

function ActivityLogView() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [filter, setFilter] = useState<"all" | "monitoring" | "diagnosis">("all");
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState("");

  const loadEvents = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch("/api/activity?limit=100", { cache: "no-store", signal });
      const body: unknown = await response.json();
      if (!response.ok) {
        const detail = body && typeof body === "object" && "detail" in body
          ? String(body.detail)
          : `Activity history request failed (${response.status}).`;
        throw new Error(detail);
      }
      if (body && typeof body === "object" && "events" in body && Array.isArray(body.events)) {
        setEvents(body.events as ActivityEvent[]);
      } else {
        throw new Error("The activity service returned an invalid response.");
      }
      setError("");
    } catch (reason) {
      if (reason instanceof Error && reason.name !== "AbortError") {
        setError(reason.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadEvents(controller.signal), 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [loadEvents]);

  const clearHistory = async () => {
    if (!window.confirm("Delete all locally stored monitoring and diagnosis history? This cannot be undone.")) return;
    setClearing(true);
    setError("");
    try {
      const response = await fetch("/api/activity", { method: "DELETE" });
      const body: unknown = await response.json();
      if (!response.ok) {
        const detail = body && typeof body === "object" && "detail" in body
          ? String(body.detail)
          : `Could not clear activity history (${response.status}).`;
        throw new Error(detail);
      }
      setEvents([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not clear activity history.");
    } finally {
      setClearing(false);
    }
  };

  const filteredEvents = events.filter((event) => {
    if (filter === "monitoring") return event.event_type === "monitoring_sample";
    if (filter === "diagnosis") return event.event_type !== "monitoring_sample";
    return true;
  });

  return (
    <section className="section-card activity-log-card">
      <div className="activity-heading">
        <SectionHeading icon={FileClock} title="Activity log" description="Local monitoring samples and completed diagnosis outcomes. Samples are recorded at most once per minute." />
        <div className="activity-actions">
          <button className="refresh-button" onClick={() => void loadEvents()} disabled={loading}><RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh</button>
          <button className="clear-history-button" onClick={() => void clearHistory()} disabled={clearing || loading || events.length === 0}>{clearing ? "Clearing…" : "Clear history"}</button>
        </div>
      </div>

      <div className="activity-meta">
        <div className="activity-filters" role="group" aria-label="Filter activity">
          {(["all", "monitoring", "diagnosis"] as const).map((value) => (
            <button key={value} onClick={() => setFilter(value)} className={filter === value ? "filter-active" : ""}>
              {value === "all" ? "All activity" : value === "monitoring" ? "Monitoring" : "Diagnoses"}
            </button>
          ))}
        </div>
        <span>{events.length} {events.length === 1 ? "event" : "events"} · Stored locally for up to 30 days</span>
      </div>

      {error ? <div className="diagnosis-error" role="alert"><AlertTriangle size={15} />{error}</div> : null}
      {loading && events.length === 0 ? <NoData icon={RefreshCw} title="Loading activity" detail="Reading local activity history." /> : null}
      {!loading && !error && filteredEvents.length === 0 ? (
        <NoData icon={FileClock} title={events.length ? "No matching activity" : "No recorded activity yet"} detail={events.length ? "Try another activity filter." : "Monitoring samples will be recorded about once per minute. Completed diagnosis requests will also appear here."} />
      ) : null}
      {filteredEvents.length > 0 ? (
        <div className="activity-list">
          {filteredEvents.map((event) => <ActivityEventRow key={event.id} event={event} />)}
        </div>
      ) : null}
      <div className="activity-retention"><Shield size={14} /> History is stored in the local SQLite database. Original problem descriptions, process names, and PIDs are not retained.</div>
    </section>
  );
}

function ActivityEventRow({ event }: { event: ActivityEvent }) {
  const diagnosis = event.event_type !== "monitoring_sample";
  const detail = event.details as Partial<DiagnosisPlan> & {
    cpu_percent?: number;
    memory_percent?: number;
    readable_disk_count?: number;
    warnings?: number;
  };
  return (
    <article className="activity-event">
      <span className={`event-icon ${diagnosis ? "event-diagnosis" : "event-monitoring"}`}>
        {diagnosis ? <Sparkles size={16} /> : <Activity size={16} />}
      </span>
      <div className="event-content">
        <div className="event-topline"><strong>{event.title}</strong><time dateTime={event.occurred_at}>{new Date(event.occurred_at).toLocaleString()}</time></div>
        <p>{event.summary}</p>
        {event.event_type === "monitoring_sample" ? (
          <div className="event-metrics">
            {typeof detail.cpu_percent === "number" ? <span>CPU <strong>{detail.cpu_percent.toFixed(1)}%</strong></span> : null}
            {typeof detail.memory_percent === "number" ? <span>Memory <strong>{detail.memory_percent.toFixed(1)}%</strong></span> : null}
            {typeof detail.readable_disk_count === "number" ? <span>Volumes <strong>{detail.readable_disk_count}</strong></span> : null}
            {typeof detail.warnings === "number" ? <span>Warnings <strong>{detail.warnings}</strong></span> : null}
          </div>
        ) : event.event_type === "diagnosis" && detail.possible_causes?.length ? (
          <details className="event-details">
            <summary>View saved diagnosis</summary>
            <DiagnosisResult plan={detail as DiagnosisPlan} />
          </details>
        ) : null}
      </div>
      <span className={`event-severity event-severity-${event.severity}`}>{event.severity}</span>
    </article>
  );
}

function SettingsView({
  preferences,
  updatePreference,
}: {
  preferences: Preferences;
  updatePreference: (key: keyof Preferences, value: number) => void;
}) {
  return (
    <div className="settings-layout">
      <section className="section-card settings-card">
        <SectionHeading icon={Gauge} title="Monitoring" description="Configure how often the local agent checks system health." />
        <label className="setting-row">
          <span><strong>Refresh interval</strong><small>How often new measurements are collected.</small></span>
          <select value={preferences.interval} onChange={(event) => updatePreference("interval", Number(event.target.value))}>
            <option value={5}>Every 5 seconds</option><option value={10}>Every 10 seconds</option><option value={30}>Every 30 seconds</option><option value={60}>Every minute</option>
          </select>
        </label>
        <ThresholdSetting label="CPU warning threshold" value={preferences.cpuThreshold} onChange={(value) => updatePreference("cpuThreshold", value)} />
        <ThresholdSetting label="Memory warning threshold" value={preferences.memoryThreshold} onChange={(value) => updatePreference("memoryThreshold", value)} />
        <ThresholdSetting label="Minimum free disk space" value={preferences.diskThreshold} onChange={(value) => updatePreference("diskThreshold", value)} />
        <div className="settings-note"><ShieldCheck size={16} /> Preferences are saved in this browser only. All checks are read-only.</div>
      </section>
      <section className="section-card settings-card privacy-card">
        <SectionHeading icon={Shield} title="Privacy & safety" description="The agent&apos;s current security posture." />
        <div className="privacy-row"><span><Check size={15} /></span><div><strong>Local measurements</strong><small>System data is served by a local API and isn&apos;t uploaded.</small></div></div>
        <div className="privacy-row"><span><Check size={15} /></span><div><strong>Read-only monitoring</strong><small>No files, services, processes, or settings are changed.</small></div></div>
        <div className="privacy-row"><span><Check size={15} /></span><div><strong>No AI provider configured</strong><small>AI diagnosis and external integrations are not active.</small></div></div>
      </section>
    </div>
  );
}

function ThresholdSetting({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="setting-row threshold-row">
      <span><strong>{label}</strong><small>Show a warning when this limit is reached.</small></span>
      <span className="threshold-control"><input type="range" min="0" max="100" value={value} onChange={(event) => onChange(Number(event.target.value))} /><b>{value}%</b></span>
    </label>
  );
}
