import { describe, expect, test } from "bun:test"
import type { PortProxyEvent } from "./port-proxy/events"
import type { PushEvent } from "./push/events"
import type { ShareEvent } from "./session-share/share-projection"
import type { StorageBackend } from "./storage/backend"
import {
  appendPortProxyEvent,
  appendPushEvent,
  appendShareEvent,
  getPortProxyEvents,
  getShareEvents,
  listPortProxyChats,
  loadPushEvents,
  loadPortProxyEvents,
  loadShareEvents,
  type PeripheralEventsDeps,
} from "./event-store-peripheral-events.adapter"


function makeStorage(files: Map<string, string> = new Map()): StorageBackend {
  return {
    mkdir: async () => {},
    exists: async (p) => files.has(p),
    existsSync: (p) => files.has(p),
    size: async (p) => files.get(p)?.length ?? 0,
    readText: async (p) => files.get(p) ?? "",
    readTextSync: (p) => files.get(p) ?? "",
    writeText: async (p, v) => { files.set(p, v) },
    appendText: async (p, v) => { files.set(p, (files.get(p) ?? "") + v) },
    rename: async () => {},
    remove: async () => {},
  }
}

function makeWriteChainRef() {
  let chain = Promise.resolve()
  return {
    getWriteChain: () => chain,
    setWriteChain: (p: Promise<void>) => { chain = p },
  }
}

function makeDeps(overrides: Partial<PeripheralEventsDeps> = {}): PeripheralEventsDeps {
  const wc = makeWriteChainRef()
  return {
    storage: makeStorage(),
    portProxyLogPath: "/data/port-proxies.jsonl",
    sharesLogPath: "/data/shares.jsonl",
    pushLogPath: "/data/push.jsonl",
    portProxyEventsByChatId: new Map(),
    shareEventsAll: [],
    getWriteChain: wc.getWriteChain,
    setWriteChain: wc.setWriteChain,
    ...overrides,
  }
}

function makePortProxyEvent(chatId = "chat-1"): PortProxyEvent {
  return { v: 1, kind: "port_proxy_started", chatId, proxyId: "p-1", port: 3000, url: "https://kanna.test/port-proxy/3000", timestamp: 1000 }
}

function makeShareEvent(chatId = "chat-1"): ShareEvent {
  return { type: "share_minted", chatId, shareId: "s-1", token: "tok", expiresAt: null, timestamp: 1000 } as unknown as ShareEvent
}

function makePushEvent(): PushEvent {
  return { type: "push_device_registered", deviceId: "d-1", pushToken: "pt-1", platform: "web", timestamp: 1000 } as unknown as PushEvent
}


describe("getPortProxyEvents", () => {
  test("returns empty array for unknown chatId", () => {
    const deps = makeDeps()
    expect(getPortProxyEvents(deps, "no-chat")).toEqual([])
  })

  test("returns list for known chatId", () => {
    const ev = makePortProxyEvent("chat-a")
    const portProxyEventsByChatId = new Map([["chat-a", [ev]]])
    const deps = makeDeps({ portProxyEventsByChatId })
    expect(getPortProxyEvents(deps, "chat-a")).toEqual([ev])
  })

  test("returns a copy (not the original array)", () => {
    const ev = makePortProxyEvent("chat-a")
    const inner: PortProxyEvent[] = [ev]
    const portProxyEventsByChatId = new Map([["chat-a", inner]])
    const deps = makeDeps({ portProxyEventsByChatId })
    const result = getPortProxyEvents(deps, "chat-a")
    expect(result).toEqual([ev])
    expect(result).not.toBe(inner)
  })
})

describe("listPortProxyChats", () => {
  test("returns empty array when no chats", () => {
    const deps = makeDeps()
    expect(listPortProxyChats(deps)).toEqual([])
  })

  test("returns all chatIds with proxy events", () => {
    const portProxyEventsByChatId = new Map([
      ["c1", [makePortProxyEvent("c1")]],
      ["c2", [makePortProxyEvent("c2")]],
    ])
    const deps = makeDeps({ portProxyEventsByChatId })
    expect(listPortProxyChats(deps)).toEqual(expect.arrayContaining(["c1", "c2"]))
  })
})

describe("appendPortProxyEvent", () => {
  test("writes to portProxyLogPath and updates in-memory map", async () => {
    const files = new Map([[ "/data/port-proxies.jsonl", "" ]])
    const storage = makeStorage(files)
    const deps = makeDeps({ storage })
    const ev = makePortProxyEvent("chat-1")

    await appendPortProxyEvent(deps, ev)

    const content = files.get("/data/port-proxies.jsonl") ?? ""
    expect(content.trim()).toBe(JSON.stringify(ev))

    expect(getPortProxyEvents(deps, "chat-1")).toEqual([ev])
  })

  test("chains multiple appends in order", async () => {
    const files = new Map([["/data/port-proxies.jsonl", ""]])
    const storage = makeStorage(files)
    const deps = makeDeps({ storage })
    const ev1 = { ...makePortProxyEvent("chat-1"), proxyId: "p-1" }
    const ev2 = { ...makePortProxyEvent("chat-1"), proxyId: "p-2" }

    await Promise.all([appendPortProxyEvent(deps, ev1), appendPortProxyEvent(deps, ev2)])

    const lines = (files.get("/data/port-proxies.jsonl") ?? "").trim().split("\n")
    expect(lines.length).toBe(2)
    expect(JSON.parse(lines[0]!).proxyId).toBe("p-1")
    expect(JSON.parse(lines[1]!).proxyId).toBe("p-2")
  })
})

describe("loadPortProxyEvents", () => {
  test("populates in-memory map from disk", async () => {
    const ev = makePortProxyEvent("chat-x")
    const files = new Map([["/data/port-proxies.jsonl", `${JSON.stringify(ev)}\n`]])
    const storage = makeStorage(files)
    const portProxyEventsByChatId = new Map<string, PortProxyEvent[]>()
    const deps = makeDeps({ storage, portProxyEventsByChatId })

    await loadPortProxyEvents(deps)

    expect(getPortProxyEvents(deps, "chat-x")).toEqual([ev])
  })

  test("handles empty log file without errors", async () => {
    const files = new Map([["/data/port-proxies.jsonl", ""]])
    const deps = makeDeps({ storage: makeStorage(files) })
    await expect(loadPortProxyEvents(deps)).resolves.toBeUndefined()
  })
})


describe("getShareEvents", () => {
  test("returns empty array by default", () => {
    const deps = makeDeps()
    expect(getShareEvents(deps)).toEqual([])
  })

  test("returns a copy of shareEventsAll", () => {
    const ev = makeShareEvent()
    const shareEventsAll: ShareEvent[] = [ev]
    const deps = makeDeps({ shareEventsAll })
    const result = getShareEvents(deps)
    expect(result).toEqual([ev])
    expect(result).not.toBe(shareEventsAll)
  })
})

describe("appendShareEvent", () => {
  test("writes to sharesLogPath and pushes into shareEventsAll", async () => {
    const files = new Map([["/data/shares.jsonl", ""]])
    const storage = makeStorage(files)
    const shareEventsAll: ShareEvent[] = []
    const deps = makeDeps({ storage, shareEventsAll })
    const ev = makeShareEvent("chat-2")

    await appendShareEvent(deps, ev)

    expect(files.get("/data/shares.jsonl")?.trim()).toBe(JSON.stringify(ev))
    expect(shareEventsAll).toEqual([ev])
  })
})

describe("loadShareEvents", () => {
  test("fills shareEventsAll from disk", async () => {
    const ev = makeShareEvent("chat-y")
    const files = new Map([["/data/shares.jsonl", `${JSON.stringify(ev)}\n`]])
    const storage = makeStorage(files)
    const shareEventsAll: ShareEvent[] = []
    const deps = makeDeps({ storage, shareEventsAll })

    await loadShareEvents(deps)

    expect(shareEventsAll).toEqual([ev])
  })
})


describe("appendPushEvent", () => {
  test("writes to pushLogPath (no in-memory state)", async () => {
    const files = new Map([["/data/push.jsonl", ""]])
    const storage = makeStorage(files)
    const deps = makeDeps({ storage })
    const ev = makePushEvent()

    await appendPushEvent(deps, ev)

    expect(files.get("/data/push.jsonl")?.trim()).toBe(JSON.stringify(ev))
  })
})

describe("loadPushEvents", () => {
  test("returns events from push log", async () => {
    const ev = makePushEvent()
    const files = new Map([["/data/push.jsonl", `${JSON.stringify(ev)}\n`]])
    const deps = makeDeps({ storage: makeStorage(files) })

    const result = await loadPushEvents(deps)

    expect(result).toEqual([ev])
  })

  test("returns empty array for empty log", async () => {
    const files = new Map([["/data/push.jsonl", ""]])
    const deps = makeDeps({ storage: makeStorage(files) })
    const result = await loadPushEvents(deps)
    expect(result).toEqual([])
  })
})
