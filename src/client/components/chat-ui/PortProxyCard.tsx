import type { PortProxyRecord } from "../../../shared/port-proxy/types"
import { clipboardAdapter } from "../../adapters/clipboard.adapter"
import type { ClipboardPort } from "../../ports/clipboardPort"
import { TranscriptActionCard, type CardAction } from "./TranscriptActionCard"

export interface PortProxyCardProps {
  record: PortProxyRecord
  onStop: (proxyId: string) => void | Promise<void>
  ports?: { clipboard?: ClipboardPort }
}

export function PortProxyCard({ record, onStop, ports = {} }: PortProxyCardProps) {
  const clipboard = ports.clipboard ?? clipboardAdapter

  if (record.state === "active") {
    const url = record.url
    const actions: CardAction[] = [
      {
        id: "copy",
        label: "Copy URL",
        variant: "secondary",
        onClick: async () => { await clipboard.writeText(url) },
      },
      {
        id: "stop",
        label: "Stop proxy",
        variant: "ghost",
        onClick: () => onStop(record.proxyId),
      },
    ]
    return (
      <TranscriptActionCard
        title={`Port ${record.port} exposed via Kanna`}
        tone="success"
        body={
          <a href={url} target="_blank" rel="noreferrer" className="font-mono break-all underline-offset-4 hover:underline">
            {url}
          </a>
        }
        actions={actions}
      />
    )
  }

  return (
    <TranscriptActionCard
      title={`Proxy stopped (port ${record.port})`}
      tone="muted"
    />
  )
}
