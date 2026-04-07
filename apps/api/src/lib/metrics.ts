export type TimingSummary = {
  count: number;
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
};

export type InMemoryMetrics = {
  counters: Record<string, number>;
  timings: Record<string, number[]>;
  inc: (name: string, by?: number) => void;
  observeMs: (name: string, ms: number) => void;
  summary: () => { counters: Record<string, number>; timings: Record<string, TimingSummary> };
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

export function createInMemoryMetrics(options?: { maxSamplesPerTiming?: number }): InMemoryMetrics {
  const maxSamples = options?.maxSamplesPerTiming ?? 500;

  const metrics: InMemoryMetrics = {
    counters: Object.create(null) as Record<string, number>,
    timings: Object.create(null) as Record<string, number[]>,
    inc(name, by = 1) {
      metrics.counters[name] = (metrics.counters[name] ?? 0) + by;
    },
    observeMs(name, ms) {
      const arr = (metrics.timings[name] ??= []);
      arr.push(ms);
      if (arr.length > maxSamples) {
        arr.splice(0, arr.length - maxSamples);
      }
    },
    summary() {
      const counters = { ...metrics.counters };
      const timings: Record<string, TimingSummary> = {};

      for (const [k, samples] of Object.entries(metrics.timings)) {
        const sorted = [...samples].sort((a, b) => a - b);
        const count = sorted.length;
        const sum = sorted.reduce((acc, x) => acc + x, 0);
        const avg = count ? sum / count : 0;
        timings[k] = {
          count,
          avg_ms: Number(avg.toFixed(2)),
          p50_ms: percentile(sorted, 0.5),
          p95_ms: percentile(sorted, 0.95),
          max_ms: count ? sorted[count - 1]! : 0,
        };
      }

      return { counters, timings };
    },
  };

  return metrics;
}

