export type PortProxyState = "active" | "stopped"

export interface PortProxyRecord {
  proxyId: string
  chatId: string
  port: number
  state: PortProxyState
  url: string
  createdAt: number
  stoppedAt: number | null
}
