import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { compareVersions, classifyInstallVersionFailure, parseArgs, resolveInstallCommand, runCli } from "./cli-runtime"
import { CLI_SUPPRESS_OPEN_ONCE_ENV_VAR } from "./restart"

const originalRuntimeProfile = process.env.KANNA_RUNTIME_PROFILE
const originalSuppressOpen = process.env[CLI_SUPPRESS_OPEN_ONCE_ENV_VAR]
const originalEnableSelfUpdate = process.env.KANNA_ENABLE_SELF_UPDATE

afterEach(() => {
  if (originalRuntimeProfile === undefined) {
    delete process.env.KANNA_RUNTIME_PROFILE
  } else {
    process.env.KANNA_RUNTIME_PROFILE = originalRuntimeProfile
  }
  if (originalSuppressOpen === undefined) {
    delete process.env[CLI_SUPPRESS_OPEN_ONCE_ENV_VAR]
  } else {
    process.env[CLI_SUPPRESS_OPEN_ONCE_ENV_VAR] = originalSuppressOpen
  }
  if (originalEnableSelfUpdate === undefined) {
    delete process.env.KANNA_ENABLE_SELF_UPDATE
  } else {
    process.env.KANNA_ENABLE_SELF_UPDATE = originalEnableSelfUpdate
  }
})

function createDeps(overrides: Partial<Parameters<typeof runCli>[1]> = {}) {
  const calls = {
    startServer: [] as Array<{
      port: number
      host: string
      openBrowser: boolean
      password: string | null
      strictPort: boolean
      trustProxy?: boolean
    }>,
    openUrl: [] as string[],
    log: [] as string[],
    warn: [] as string[],
  }

  const deps: Parameters<typeof runCli>[1] = {
    version: "0.3.0",
    bunVersion: "1.3.10",
    startServer: async (options) => {
      calls.startServer.push(options)
      return {
        port: options.port,
        stop: async () => {},
      }
    },
    openUrl: (url) => {
      calls.openUrl.push(url)
    },
    log: (message) => {
      calls.log.push(message)
    },
    warn: (message) => {
      calls.warn.push(message)
    },
    ...overrides,
  }

  return { calls, deps }
}

describe("parseArgs", () => {
  test("parses runtime options", () => {
    expect(parseArgs(["--port", "4000", "--no-open"])).toEqual({
      kind: "run",
      options: {
        port: 4000,
        host: "127.0.0.1",
        openBrowser: false,
        password: null,
        strictPort: false,
      },
    })
  })

  test("parses strict port mode", () => {
    expect(parseArgs(["--strict-port"])).toEqual({
      kind: "run",
      options: {
        port: 3210,
        host: "127.0.0.1",
        openBrowser: true,
        password: null,
        strictPort: true,
      },
    })
  })

  test("--remote without value binds all interfaces", () => {
    expect(parseArgs(["--remote"])).toEqual({
      kind: "run",
      options: {
        port: 3210,
        host: "0.0.0.0",
        openBrowser: true,
        password: null,
        strictPort: false,
      },
    })
  })

  
  
  test("--password accepts a secret", () => {
    expect(parseArgs(["--password", "secret"])).toEqual({
      kind: "run",
      options: {
        port: 3210,
        host: "127.0.0.1",
        openBrowser: true,
        password: "secret",
        strictPort: false,
      },
    })
  })

  test("--password without a value throws", () => {
    expect(() => parseArgs(["--password"])).toThrow("Missing value for --password")
    expect(() => parseArgs(["--password", "--no-open"])).toThrow("Missing value for --password")
  })

  
  test("--host with IP binds to that address", () => {
    expect(parseArgs(["--host", "100.64.0.1"])).toEqual({
      kind: "run",
      options: {
        port: 3210,
        host: "100.64.0.1",
        openBrowser: true,
        password: null,
        strictPort: false,
      },
    })
  })

  test("--host with hostname binds to that name", () => {
    expect(parseArgs(["--host", "dev-box"])).toEqual({
      kind: "run",
      options: {
        port: 3210,
        host: "dev-box",
        openBrowser: true,
        password: null,
        strictPort: false,
      },
    })
  })

  test("--host without a value throws", () => {
    expect(() => parseArgs(["--host"])).toThrow("Missing value for --host")
    expect(() => parseArgs(["--host", "--no-open"])).toThrow("Missing value for --host")
  })

  
  
  test("returns version and help actions without running startup", () => {
    expect(parseArgs(["--version"])).toEqual({ kind: "version" })
    expect(parseArgs(["--help"])).toEqual({ kind: "help" })
  })
})

describe("compareVersions", () => {
  test("orders semver-like versions", () => {
    expect(compareVersions("0.3.0", "0.3.0")).toBe(0)
    expect(compareVersions("0.3.0", "0.3.1")).toBe(-1)
    expect(compareVersions("1.0.0", "0.9.9")).toBe(1)
  })
})

describe("resolveInstallCommand", () => {
  const baseDeps = {
    packageName: "@cuongtran001/kanna",
    version: "1.2.3",
  }

  test("uses KANNA_UPDATE_COMMAND env override with {version} + {package} placeholders", () => {
    const result = resolveInstallCommand({
      ...baseDeps,
      env: { KANNA_UPDATE_COMMAND: "npm install -g {package}@{version}" },
      hasCommand: () => false,
      binaryPath: undefined,
    })
    expect(result).toEqual({
      kind: "ok",
      installer: "custom",
      plan: {
        command: "sh",
        args: ["-c", "npm install -g @cuongtran001/kanna@1.2.3"],
      },
    })
  })

  test("KANNA_UPDATE_COMMAND empty string falls through to detection", () => {
    const result = resolveInstallCommand({
      ...baseDeps,
      env: { KANNA_UPDATE_COMMAND: "  " },
      hasCommand: (c) => c === "npm",
      binaryPath: "/usr/local/bin/kanna",
    })
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") expect(result.installer).toBe("npm")
  })

  test("detects bun installer when binary lives under .bun/", () => {
    const result = resolveInstallCommand({
      ...baseDeps,
      env: {},
      hasCommand: () => true,
      binaryPath: "/Users/cuongtran/.bun/bin/kanna",
    })
    expect(result).toEqual({
      kind: "ok",
      installer: "bun",
      plan: { command: "bun", args: ["install", "-g", "@cuongtran001/kanna@1.2.3"] },
    })
  })

  test("detects pnpm installer when binary lives under pnpm path", () => {
    const result = resolveInstallCommand({
      ...baseDeps,
      env: {},
      hasCommand: () => true,
      binaryPath: "/home/user/.local/share/pnpm/kanna",
    })
    expect(result).toEqual({
      kind: "ok",
      installer: "pnpm",
      plan: { command: "pnpm", args: ["add", "-g", "@cuongtran001/kanna@1.2.3"] },
    })
  })

  test("detects yarn installer when binary lives under .yarn/", () => {
    const result = resolveInstallCommand({
      ...baseDeps,
      env: {},
      hasCommand: () => true,
      binaryPath: "/home/user/.yarn/bin/kanna",
    })
    expect(result).toEqual({
      kind: "ok",
      installer: "yarn",
      plan: { command: "yarn", args: ["global", "add", "@cuongtran001/kanna@1.2.3"] },
    })
  })

  test("falls back to npm for typical npm prefix paths", () => {
    const result = resolveInstallCommand({
      ...baseDeps,
      env: {},
      hasCommand: (c) => c === "npm",
      binaryPath: "/usr/local/bin/kanna",
    })
    expect(result).toEqual({
      kind: "ok",
      installer: "npm",
      plan: { command: "npm", args: ["install", "-g", "@cuongtran001/kanna@1.2.3"] },
    })
  })

  test("falls back through priority list when detected installer not on PATH", () => {
    const result = resolveInstallCommand({
      ...baseDeps,
      env: {},
      hasCommand: (c) => c === "npm",
      binaryPath: "/Users/cuongtran/.bun/bin/kanna",
    })
    expect(result.kind).toBe("ok")
    if (result.kind === "ok") expect(result.installer).toBe("npm")
  })

  test("returns missing when no installer available", () => {
    const result = resolveInstallCommand({
      ...baseDeps,
      env: {},
      hasCommand: () => false,
      binaryPath: "/usr/local/bin/kanna",
    })
    expect(result).toEqual({
      kind: "missing",
      result: {
        ok: false,
        errorCode: "command_missing",
        userTitle: "Package manager not found",
        userMessage:
          "Kanna could not find npm, bun, pnpm, or yarn to install the update. Set KANNA_UPDATE_COMMAND to override.",
      },
    })
  })
})

describe("classifyInstallVersionFailure", () => {
  test("maps version propagation failures to a user-facing retry message", () => {
    expect(classifyInstallVersionFailure('error: No version matching "0.13.3" found for specifier "@cuongtran001/kanna"')).toEqual({
      ok: false,
      errorCode: "version_not_live_yet",
      userTitle: "Update not live yet",
      userMessage: "This update is still propagating. Try again in a few minutes.",
    })
  })
})

describe("runCli", () => {
  test("skips update checks for --version", async () => {
    const { calls, deps } = createDeps()

    const result = await runCli(["--version"], deps)

    expect(result).toEqual({ kind: "exited", code: 0 })
    expect(calls.startServer).toEqual([])
    expect(calls.log).toEqual(["0.3.0"])
  })

  test("starts normally", async () => {
    const { calls, deps } = createDeps()
    process.env.KANNA_RUNTIME_PROFILE = "prod"

    const result = await runCli(["--port", "4000", "--no-open"], deps)

    expect(result.kind).toBe("started")
    expect(calls.startServer).toHaveLength(1)
    expect(calls.startServer[0]).toMatchObject({
      port: 4000,
      host: "127.0.0.1",
      openBrowser: false,
      password: null,
      strictPort: false,
    })
    expect(calls.openUrl).toEqual([])
    expect(calls.log).toContain("[kanna] data dir: ~/.kanna/data")
  })

  test("logs the dev data dir when the dev runtime profile is active", async () => {
    process.env.KANNA_RUNTIME_PROFILE = "dev"
    const { calls, deps } = createDeps()

    await runCli(["--port", "4000", "--no-open"], deps)

    expect(calls.log).toContain("[kanna] data dir: ~/.kanna-dev/data")
  })

  test("fails fast on unsupported Bun versions", async () => {
    const { calls, deps } = createDeps({
      bunVersion: "1.3.1",
    })

    const result = await runCli(["--no-open"], deps)

    expect(result).toEqual({ kind: "exited", code: 1 })
    expect(calls.startServer).toEqual([])
    expect(calls.warn).toContain("[kanna] Bun 1.3.5+ is required for the embedded terminal. Current Bun: 1.3.1")
  })

  test("opens the root route in the browser", async () => {
    delete process.env[CLI_SUPPRESS_OPEN_ONCE_ENV_VAR]
    const { calls, deps } = createDeps()

    await runCli(["--port", "4000"], deps)

    expect(calls.openUrl).toEqual(["http://localhost:4000"])
  })

  test("opens browser at hostname when --host <host> is given", async () => {
    delete process.env[CLI_SUPPRESS_OPEN_ONCE_ENV_VAR]
    const { calls, deps } = createDeps()

    await runCli(["--host", "dev-box", "--port", "4000"], deps)

    expect(calls.openUrl).toEqual(["http://dev-box:4000"])
  })

  test("suppresses browser open for a ui-triggered restarted child", async () => {
    process.env[CLI_SUPPRESS_OPEN_ONCE_ENV_VAR] = "1"
    const { calls, deps } = createDeps()

    await runCli(["--port", "4000"], deps)

    expect(calls.openUrl).toEqual([])
  })
})
