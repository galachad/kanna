const PORT_PROXY_RE = /^\/port-proxy\/(\d+)(\/.*)?$/

export async function handlePortProxyRequest(req: Request): Promise<Response | null> {
  const { pathname } = new URL(req.url)
  const match = PORT_PROXY_RE.exec(pathname)
  if (!match) return null

  const port = Number(match[1])
  const rest = match[2] ?? "/"
  const targetUrl = new URL(`http://localhost:${port}${rest}`)
  const originalUrl = new URL(req.url)
  for (const [key, value] of originalUrl.searchParams.entries()) {
    targetUrl.searchParams.set(key, value)
  }

  const headers = new Headers(req.headers)
  headers.set("host", `localhost:${port}`)
  headers.delete("x-forwarded-for")

  try {
    const response = await fetch(targetUrl.toString(), {
      method: req.method,
      headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
    })
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    })
  } catch {
    return new Response(JSON.stringify({ error: "proxy_error", message: `Could not connect to port ${port}` }), {
      status: 502,
      headers: { "content-type": "application/json" },
    })
  }
}
