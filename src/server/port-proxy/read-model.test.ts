import { describe, expect, test } from "bun:test"
import type { PortProxyEvent } from "./events"
import { deriveChatProxies } from "./read-model"

const base = { v: 1 as const, chatId: "c1", proxyId: "p1", timestamp: 1000 }

describe("deriveChatProxies", () => {
  test("returns empty state for no events", () => {
    expect(deriveChatProxies([], "c1")).toEqual({ proxies: {}, liveProxyId: null })
  })

  test("tracks a started proxy", () => {
    const events: PortProxyEvent[] = [
      { ...base, kind: "port_proxy_started", port: 5173, url: "http://kanna.test/port-proxy/5173" },
    ]
    expect(deriveChatProxies(events, "c1")).toEqual({
      proxies: {
        p1: {
          proxyId: "p1",
          chatId: "c1",
          port: 5173,
          state: "active",
          url: "http://kanna.test/port-proxy/5173",
          createdAt: 1000,
          stoppedAt: null,
        },
      },
      liveProxyId: "p1",
    })
  })

  test("stops a proxy and clears live id", () => {
    const events: PortProxyEvent[] = [
      { ...base, kind: "port_proxy_started", port: 5173, url: "http://kanna.test/port-proxy/5173" },
      { ...base, kind: "port_proxy_stopped", reason: "user", timestamp: 2000 },
    ]
    const projection = deriveChatProxies(events, "c1")
    expect(projection.liveProxyId).toBeNull()
    expect(projection.proxies.p1).toEqual({
      proxyId: "p1",
      chatId: "c1",
      port: 5173,
      state: "stopped",
      url: "http://kanna.test/port-proxy/5173",
      createdAt: 1000,
      stoppedAt: 2000,
    })
  })
})
