export interface TelemetrySettingsInput {
  enabled: boolean
  endpoint: string
}

export interface OtelEnvInput {
  KANNA_OTEL?: string
  KANNA_OTEL_SERVICE_NAME?: string
  OTEL_EXPORTER_OTLP_ENDPOINT?: string
}

export interface ResolvedOtelConfig {
  serviceName: string
  serviceVersion: string
  machineName: string
  traceUrl: string | undefined
  metricUrl: string | undefined
}

export function sanitizeServiceNamePart(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
}

export function resolveOtelConfig(_args: {
  env: OtelEnvInput
  telemetry: TelemetrySettingsInput | undefined
  machineName: string
}): ResolvedOtelConfig | null {
  return null
}
