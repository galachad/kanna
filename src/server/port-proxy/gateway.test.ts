import { describe, expect, test } from "bun:test"
import { EventStore } from "../event-store"
import { PortProxyGateway } from "./gateway"

function createGateway(store: EventStore, calls: string[]) {
  return new PortProxyGateway({
    store,
    broadcast: (chatId) => calls.push(chatId),
    getBaseUrl: () => "http://127.0.0.1:3210",
    now: () => 1000,
  })
}

async function waitForStopEvent(store: EventStore, chatId: string, reason: "session_closed" | "server_shutdown") {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const event = store.getPortProxyEvents(chatId).at(-1)
    if (event?.kind === "port_proxy_stopped" && event.reason === reason) return event
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return store.getPortProxyEvents(chatId).at(-1)
}

describe("PortProxyGateway", () => {
  test("starts a proxy and reuses an active one for the same port", async () => {
    const store = new EventStore("/home/runner/work/kanna/kanna/.kanna-test-port-proxy-gateway-1")
    await store.initialize()
    const project = await store.openProject("/home/runner/work/kanna/kanna")
    const chat = await store.createChat(project.id)
    const calls: string[] = []
    const gateway = createGateway(store, calls)

    const started = await gateway.expose({ chatId: chat.id, port: 5173 })
    expect(started.status).toBe("started")
    expect(calls).toEqual([chat.id])

    const again = await gateway.expose({ chatId: chat.id, port: 5173 })
    expect(again.status).toBe("already_active")
    if (started.status === "started" && again.status === "already_active") {
      expect(again.proxyId).toBe(started.proxyId)
      expect(again.url).toBe(started.url)
    }
  })

  test("stops proxies for user and shutdown paths", async () => {
    const store = new EventStore("/home/runner/work/kanna/kanna/.kanna-test-port-proxy-gateway-2")
    await store.initialize()
    const project = await store.openProject("/home/runner/work/kanna/kanna")
    const chat = await store.createChat(project.id)
    const calls: string[] = []
    const gateway = createGateway(store, calls)

    const started = await gateway.expose({ chatId: chat.id, port: 5174 })
    expect(started.status).toBe("started")
    if (started.status !== "started") return
    await gateway.stop(chat.id, started.proxyId)

    const events = store.getPortProxyEvents(chat.id)
    expect(events.at(-1)).toMatchObject({ kind: "port_proxy_stopped", reason: "user" })

    const next = await gateway.expose({ chatId: chat.id, port: 5175 })
    expect(next.status).toBe("started")
    gateway.closeChat(chat.id)
    expect(await waitForStopEvent(store, chat.id, "session_closed")).toMatchObject({ kind: "port_proxy_stopped", reason: "session_closed" })

    const third = await gateway.expose({ chatId: chat.id, port: 5176 })
    expect(third.status).toBe("started")
    await gateway.reapOrphanedProxies()
    expect(await waitForStopEvent(store, chat.id, "server_shutdown")).toMatchObject({ kind: "port_proxy_stopped", reason: "server_shutdown" })
  })
})
