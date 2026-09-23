import { describe, expect, test } from "bun:test"
import { PORT_PROXY_EVENT_VERSION, type PortProxyEvent } from "./events"

describe("port proxy events", () => {
  test("uses version 1", () => {
    expect(PORT_PROXY_EVENT_VERSION).toBe(1)
  })

  test("supports both event kinds", () => {
    const kinds: PortProxyEvent["kind"][] = ["port_proxy_started", "port_proxy_stopped"]
    expect(kinds).toEqual(["port_proxy_started", "port_proxy_stopped"])
  })
})
