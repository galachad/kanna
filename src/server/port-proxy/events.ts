export const PORT_PROXY_EVENT_VERSION = 1 as const

export type PortProxyEvent =
  | {
      v: typeof PORT_PROXY_EVENT_VERSION
      kind: "port_proxy_started"
      proxyId: string
      chatId: string
      port: number
      url: string
      timestamp: number
    }
  | {
      v: typeof PORT_PROXY_EVENT_VERSION
      kind: "port_proxy_stopped"
      proxyId: string
      chatId: string
      reason: "user" | "session_closed" | "server_shutdown"
      timestamp: number
    }
