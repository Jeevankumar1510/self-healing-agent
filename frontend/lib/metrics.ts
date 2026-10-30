export type DiskMetric = {
  mountpoint: string;
  total_bytes: number;
  used_bytes: number;
  free_bytes: number;
  used_percent: number;
  free_percent: number;
};

export type ProcessMetric = {
  pid: number;
  name: string;
  status: string;
  cpu_percent: number;
  memory_percent: number;
};

export type SystemMetrics = {
  captured_at: string;
  cpu_percent: number;
  memory_total_bytes: number;
  memory_used_bytes: number;
  memory_available_bytes: number;
  memory_percent: number;
  disks: DiskMetric[];
  uptime_seconds: number;
  process_count: number;
  top_processes: ProcessMetric[];
  python_executable: string;
  python_version: string;
  platform: string;
  warnings: string[];
  collection_warnings: string[];
  thresholds: {
    cpu_percent: number;
    memory_percent: number;
    disk_free_percent: number;
  };
};

export type Preferences = {
  interval: number;
  cpuThreshold: number;
  memoryThreshold: number;
  diskThreshold: number;
};

export const DEFAULT_PREFERENCES: Preferences = {
  interval: 10,
  cpuThreshold: 85,
  memoryThreshold: 85,
  diskThreshold: 10,
};

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export function formatUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}
