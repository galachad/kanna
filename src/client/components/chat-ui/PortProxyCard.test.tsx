import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { PortProxyCard } from "./PortProxyCard"
import type { PortProxyRecord } from "../../../shared/port-proxy/types"

const baseRecord: PortProxyRecord = {
  proxyId: "p1",
  chatId: "c1",
  port: 5173,
  state: "active",
  url: "http://127.0.0.1:3210/port-proxy/5173",
  createdAt: 1,
  stoppedAt: null,
}

describe("PortProxyCard", () => {
  test("active state renders url and actions", () => {
    const html = renderToStaticMarkup(
      <PortProxyCard
        record={baseRecord}
        onStop={() => {}}
      />,
    )
    expect(html).toContain("Port 5173 exposed via Kanna")
    expect(html).toContain(baseRecord.url)
    expect(html).toContain("Copy URL")
    expect(html).toContain("Stop proxy")
  })

  test("stopped state renders muted label", () => {
    const html = renderToStaticMarkup(
      <PortProxyCard
        record={{ ...baseRecord, state: "stopped", stoppedAt: 2 }}
        onStop={() => {}}
      />,
    )
    expect(html).toContain("Proxy stopped")
  })
})
