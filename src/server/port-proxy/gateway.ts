import { randomUUID } from "node:crypto"
import type { EventStore } from "../event-store"
import type { PortProxyEvent } from "./events"
import { PORT_PROXY_EVENT_VERSION } from "./events"
import { deriveChatProxies } from "./read-model"

export interface PortProxyGatewayArgs {
  store: EventStore
  broadcast: (chatId: string) => void
  getBaseUrl: () => string
  now?: () => number
}

export type ExposeOutcome =
  | { status: "started"; proxyId: string; port: number; url: string }
  | { status: "already_active"; proxyId: string; port: number; url: string }
  | { status: "invalid_port"; reason: string }

const MIN_PORT = 1
const MAX_PORT = 65535

export class PortProxyGateway {
  private readonly store: EventStore
  private readonly broadcast: (chatId: string) => void
  private readonly getBaseUrl: () => string
  private readonly now: () => number
  private baseUrl: string | null = null

  constructor(args: PortProxyGatewayArgs) {
    this.store = args.store
    this.broadcast = args.broadcast
    this.getBaseUrl = args.getBaseUrl
    this.now = args.now ?? (() => Date.now())
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl
  }

  async expose(args: { chatId: string; port: number }): Promise<ExposeOutcome> {
    if (!Number.isInteger(args.port) || args.port < MIN_PORT || args.port > MAX_PORT) {
      return { status: "invalid_port", reason: `port must be an integer in [${MIN_PORT}, ${MAX_PORT}]` }
    }

    const existing = this.findActiveProxyForPort(args.chatId, args.port)
    if (existing) {
      return { status: "already_active", proxyId: existing.proxyId, port: existing.port, url: existing.url }
    }

    const proxyId = randomUUID()
    const baseUrl = (this.baseUrl ?? this.getBaseUrl()).replace(/\/$/, "")
    const url = `${baseUrl}/port-proxy/${args.port}`

    await this.persist({
      v: PORT_PROXY_EVENT_VERSION,
      kind: "port_proxy_started",
      proxyId,
      chatId: args.chatId,
      port: args.port,
      url,
      timestamp: this.now(),
    })

    return { status: "started", proxyId, port: args.port, url }
  }

  async stop(chatId: string, proxyId: string): Promise<void> {
    await this.persist({
      v: PORT_PROXY_EVENT_VERSION,
      kind: "port_proxy_stopped",
      proxyId,
      chatId,
      reason: "user",
      timestamp: this.now(),
    })
  }

  closeChat(chatId: string): void {
    const events = this.store.getPortProxyEvents(chatId)
    const { liveProxyId } = deriveChatProxies(events, chatId)
    if (!liveProxyId) return
    void this.persist({
      v: PORT_PROXY_EVENT_VERSION,
      kind: "port_proxy_stopped",
      proxyId: liveProxyId,
      chatId,
      reason: "session_closed",
      timestamp: this.now(),
    })
  }

  async reapOrphanedProxies(): Promise<void> {
    const chatIds = this.store.listPortProxyChats()
    for (const chatId of chatIds) {
      const { proxies } = deriveChatProxies(this.store.getPortProxyEvents(chatId), chatId)
      for (const record of Object.values(proxies)) {
        if (record.state !== "active") continue
        await this.persist({
          v: PORT_PROXY_EVENT_VERSION,
          kind: "port_proxy_stopped",
          proxyId: record.proxyId,
          chatId,
          reason: "server_shutdown",
          timestamp: this.now(),
        })
      }
    }
  }

  shutdown(): void {}

  private findActiveProxyForPort(chatId: string, port: number): { proxyId: string; port: number; url: string } | null {
    const { proxies } = deriveChatProxies(this.store.getPortProxyEvents(chatId), chatId)
    for (const record of Object.values(proxies)) {
      if (record.state === "active" && record.port === port) {
        return { proxyId: record.proxyId, port: record.port, url: record.url }
      }
    }
    return null
  }

  private async persist(event: PortProxyEvent): Promise<void> {
    await this.store.appendPortProxyEvent(event)
    this.broadcast(event.chatId)
  }
}
