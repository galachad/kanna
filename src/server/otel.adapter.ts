export interface ObservabilityHandle {
  shutdown(): Promise<void>
  applyTelemetrySettings(_telemetry?: unknown): void
}

export interface InitObservabilityArgs {
  dataDir: string
  telemetry?: unknown
  machineName?: string
}

const NOOP_OBSERVABILITY_HANDLE: ObservabilityHandle = {
  async shutdown() {},
  applyTelemetrySettings() {},
}

export function initObservability(_args: InitObservabilityArgs): ObservabilityHandle {
  return NOOP_OBSERVABILITY_HANDLE
}
