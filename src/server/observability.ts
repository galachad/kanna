export interface Attributes {
  readonly [key: string]: string | number | boolean | null | undefined
}

export interface SpanStatus {
  code: number
  message?: string
}

export interface Span {
  setStatus(status: SpanStatus): void
  recordException(error: Error): void
  end(): void
}

export const PROCESS_RSS_BYTES = "kanna.process.rss_bytes"
export const HOST_MEMORY_TOTAL_BYTES = "kanna.host.memory_total_bytes"
export const PROCESS_MEMORY_CEILING_BYTES = "kanna.process.memory_ceiling_bytes"
export const PROCESS_RSS_RATIO = "kanna.process.rss_ratio"
export const SUBAGENT_RUN_FINISHED = "kanna.subagent.run.finished"
export const TURN_DURATION_MS = "kanna.turn.duration_ms"
export const SUBAGENT_RUN_DURATION_MS = "kanna.subagent.run.duration_ms"
export const TURN_TOKENS = "kanna.turn.tokens"
export const TURN_COST_USD = "kanna.turn.cost_usd"
export const SUBAGENT_TOKENS = "kanna.subagent.tokens"
export const PACKAGE_CHECK_FINISHED = "kanna.packages.check_finished"
export const PACKAGE_APPLY_FINISHED = "kanna.packages.apply_finished"
export const PACKAGE_UPDATE_RATE_LIMITED = "kanna.packages.update_rate_limited"
export const PACKAGE_CHECK_DURATION_MS = "kanna.packages.check_duration_ms"
export const PACKAGE_APPLY_DURATION_MS = "kanna.packages.apply_duration_ms"
export const COMPACTION_STARTED = "kanna.compaction.started"
export const COMPACTION_FINISHED = "kanna.compaction.finished"
export const COMPACTION_PRE_TOKENS = "kanna.compaction.pre_tokens"
export const COMPACTION_POST_TOKENS = "kanna.compaction.post_tokens"

export const DURATION_BUCKETS_MS: readonly number[] = [
  1_000, 2_000, 5_000, 10_000, 20_000, 30_000,
  60_000, 120_000, 300_000, 600_000, 1_200_000, 1_800_000,
]

export const COMPACTION_TOKEN_BUCKETS: readonly number[] = [
  1_000, 5_000, 10_000, 25_000, 50_000, 100_000,
  150_000, 200_000, 300_000, 500_000, 800_000, 1_200_000,
]

const NOOP_SPAN: Span = {
  setStatus() {},
  recordException() {},
  end() {},
}

export async function withSpan<T>(
  _name: string,
  _attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return fn(NOOP_SPAN)
}

export function resetMetricInstrumentCache(): void {}

export function addCounter(_name: string, _value: number, _attributes?: Attributes): void {}

export function recordUpDown(_name: string, _value: number, _attributes?: Attributes): void {}

export function recordHistogram(_name: string, _value: number, _attributes?: Attributes): void {}
