import type { PortProxyRecord } from "../../shared/port-proxy/types"
import type { PortProxyEvent } from "./events"

export interface ChatProxyState {
  proxies: Record<string, PortProxyRecord>
  liveProxyId: string | null
}

const EMPTY: ChatProxyState = { proxies: {}, liveProxyId: null }

export function deriveChatProxies(events: readonly PortProxyEvent[], chatId: string): ChatProxyState {
  const proxies: Record<string, PortProxyRecord> = {}
  let liveProxyId: string | null = null

  for (const event of events) {
    if (event.kind === "port_proxy_started") {
      proxies[event.proxyId] = {
        proxyId: event.proxyId,
        chatId,
        port: event.port,
        state: "active",
        url: event.url,
        createdAt: event.timestamp,
        stoppedAt: null,
      }
      liveProxyId = event.proxyId
      continue
    }

    const record = proxies[event.proxyId]
    if (!record) continue
    record.state = "stopped"
    record.stoppedAt = event.timestamp
    if (liveProxyId === event.proxyId) liveProxyId = null
  }

  if (Object.keys(proxies).length === 0 && liveProxyId === null) return EMPTY
  return { proxies, liveProxyId }
}
