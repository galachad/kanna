import { afterEach, describe, expect, test } from "bun:test"
import { serve } from "bun"
import { handlePortProxyRequest } from "./port-proxy.adapter"

let server: ReturnType<typeof serve> | null = null

afterEach(() => {
  server?.stop(true)
  server = null
})

describe("handlePortProxyRequest", () => {
  test("returns null for unrelated paths", async () => {
    const result = await handlePortProxyRequest(new Request("http://localhost/nope"))
    expect(result).toBeNull()
  })

  test("proxies the request to localhost port", async () => {
    server = serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        const url = new URL(req.url)
        return Response.json({
          path: url.pathname,
          query: url.searchParams.get("q"),
          host: req.headers.get("host"),
        })
      },
    })
    const req = new Request(`http://127.0.0.1:3210/port-proxy/${server.port}/hello/world?q=test`)
    const result = await handlePortProxyRequest(req)
    expect(result?.status).toBe(200)
    expect(await result?.json()).toEqual({ path: "/hello/world", query: "test", host: `localhost:${server?.port}` })
  })

  test("returns 502 when the target port is unreachable", async () => {
    const result = await handlePortProxyRequest(new Request("http://127.0.0.1:3210/port-proxy/65534"))
    expect(result?.status).toBe(502)
    expect(await result?.json()).toEqual({ error: "proxy_error", message: "Could not connect to port 65534" })
  })
})
