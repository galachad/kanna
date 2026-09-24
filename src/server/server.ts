import path from "node:path"
import type { Server } from "bun"
import { isErrnoException } from "../shared/errors"
import { serveHttp } from "./server-io.adapter"
import {
  UPLOAD_MAX_FILE_SIZE_MB_MAX,
  type AppSettingsSnapshot,
} from "../shared/types"
import { createAuthManager } from "./auth"
import { createAuthSessionStore } from "./auth-session-store.adapter"
import { EventStore } from "./event-store"
import { PushManager, realWebPushSender } from "./push/push-manager"
import { loadOrGenerateVapidKeys } from "./push/vapid.adapter"
import { resolveVapidSubject } from "../shared/vapid-subject"
import { AgentCoordinator } from "./agent"
import { POLICY_DEFAULT } from "../shared/permission-policy"
import type { LimitDetector } from "./auto-continue/limit-detector"
import { AppSettingsManager } from "./app-settings"
import { DiffStore } from "./diff-store"
import { discoverProjects, type DiscoveredProject } from "./discovery.adapter"
import { KeybindingsManager } from "./keybindings"
import { readLlmProviderSnapshot, validateLlmProviderCredentials, writeLlmProviderSnapshot } from "./llm-provider"
import { toJsonValue } from "./json-boundary"
import { getMachineDisplayName } from "./machine-name.adapter"
import { TerminalManager } from "./terminal-manager"
import { TerminalPidRegistry } from "./terminal-pid-registry.adapter"
import { ClaudePtyRegistry } from "./claude-pty/pid-registry.adapter"
import { createPtyInstanceRegistry } from "./claude-pty/pty-instance-registry"
import { createBoardRegistry } from "./board-registry"
import { createBoardStore } from "./board-store.adapter"
import { createBoardSync } from "./board-sync"
import { startWork as runStartWork, startWorkView as runStartWorkView, type StartWorkDeps } from "./board-start-work"
import { addWorktree, isDirty, listWorktrees, localBranchExists, removeWorktree } from "./worktree-store.adapter"
import {
  resolveWorktreeCleanup,
  worktreeCleanupView,
  type WorktreeCleanupDeps,
} from "./board-worktree-cleanup"
import type { CleanupDecision } from "../shared/boards/worktree-cleanup"
import type { RepoSuggestion } from "../shared/boards/sync-types"
import { readOriginRepoSlug } from "./diff-store-git-branch.adapter"
import { createGitHubIssuesProvider } from "./github-issues.adapter"
import { readGitHubCliToken } from "./github-cli.adapter"
import { PackageUpdateManager } from "./package-update-manager"
import { createSkillUpdateChecker } from "./skill-update-checker.adapter"
import {
  createClaudePluginUpdateChecker,
  buildClaudePluginCheckerDeps,
  findClaudeBinary,
} from "./claude-plugin-update-checker.adapter"
import {
  createCodexPluginUpdateChecker,
  buildCodexPluginCheckerDepsForEnv,
} from "./codex-plugin-update-checker.adapter"
import { buildPackageUpdateAppliers } from "./package-update-appliers-boot.adapter"
import { readPackageInventory } from "./package-inventory-io.adapter"
import { createWsRouter, type ClientState } from "./ws-router"
import { ScheduleManager } from "./auto-continue/schedule-manager"
import { CronScheduler } from "./cron/scheduler"
import { OAuthTokenPool } from "./oauth-pool/oauth-token-pool"
import { setQuickResponseOAuthPool } from "./quick-response"
import { PortProxyGateway } from "./port-proxy/gateway"
import { initToolCallbackOnBoot, type ToolCallbackService } from "./tool-callback"
import { SessionShareService } from "./session-share"
import { recoverQueuedMessages } from "./queued-message-recovery"
import { createWorkflowRegistry } from "./workflow-registry"
import { LocalCatalogService } from "./local-catalog"
import { defaultHomeDir, scanLocalCatalog, statMtimes } from "./local-catalog-io.adapter"
import { createSubagentTranscriptRegistry } from "./subagent-transcript-registry"
import { createFollowedSessionRegistry } from "./followed-session-registry"
import { statSessionFile } from "./followed-session-io.adapter"
import { createBackgroundTaskOutputRegistry } from "./background-task-output-registry"
import { backgroundTaskOutputIo } from "./background-task-output-io.adapter"
import { importOneSession } from "./claude-session-importer.adapter"
import { parseClaudeSessionFile } from "./claude-session-parser.adapter"
import { listWorkflowRunDirs, readWorkflowDir, readWorkflowRunJournal, watchWorkflowDir, watchWorkflowRunDirs } from "./workflow-watch-io.adapter"
import { readWorkflowAgentTranscriptLines } from "./workflow-agent-transcript-io.adapter"
import { SnapshotStore } from "./session-share/snapshot-store.adapter"
import { buildChatSnapshot, type SnapshotSources } from "./session-share/snapshot-builder"
import { startSnapshotSweep } from "./session-share/sweep"
import { log } from "../shared/log"
import type {
  ChatSnapshotMessage,
  AttachmentManifestEntry,
  ChatMeta,
} from "../shared/session-share/types"
import { createHttpDispatcher } from "./http-dispatcher"
export { persistUploadedFiles } from "./http-api-routes"

function parsePositiveIntEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export interface AgentAppSettingsView {
  claudeDriver: AppSettingsSnapshot["claudeDriver"]
  globalPromptAppend: AppSettingsSnapshot["globalPromptAppend"]
  customMcpServers: AppSettingsSnapshot["customMcpServers"]
  customModels: AppSettingsSnapshot["customModels"]
  providerDefaults: AppSettingsSnapshot["providerDefaults"]
  subagentRuntime: AppSettingsSnapshot["subagentRuntime"]
}

export function buildAgentAppSettingsView(snapshot: AppSettingsSnapshot): AgentAppSettingsView {
  return {
    claudeDriver: snapshot.claudeDriver,
    globalPromptAppend: snapshot.globalPromptAppend,
    customMcpServers: snapshot.customMcpServers,
    customModels: snapshot.customModels,
    providerDefaults: snapshot.providerDefaults,
    subagentRuntime: snapshot.subagentRuntime,
  }
}

const STALE_EMPTY_CHAT_PRUNE_INTERVAL_MS = 60 * 1000
const IMPORT_FOLLOW_POLL_MS = 2000
const IMPORT_FOLLOW_ACTIVE_WINDOW_MS = 600_000
const IMPORT_FOLLOW_IDLE_MS = 600_000
const MULTIPART_OVERHEAD_BYTES = 16 * 1024 * 1024
export const MAX_REQUEST_BODY_BYTES = UPLOAD_MAX_FILE_SIZE_MB_MAX * 1024 * 1024 + MULTIPART_OVERHEAD_BYTES

export interface StartKannaServerOptions {
  port?: number
  host?: string
  openBrowser?: boolean
  dataDir?: string
  distDir?: string
  password?: string | null
  strictPort?: boolean
  trustProxy?: boolean
  onMigrationProgress?: (message: string) => void
  discoverProjects?: () => DiscoveredProject[]
  agentOverrides?: {
    claudeLimitDetector?: LimitDetector
    codexLimitDetector?: LimitDetector
    throwOnClaudeSessionStart?: boolean
  }
}

interface ApplicationServices {
  store: EventStore
  diffStore: DiffStore
  auth: ReturnType<typeof createAuthManager> | null
  terminals: TerminalManager
  packageUpdateManager: PackageUpdateManager
  agent: AgentCoordinator
  router: ReturnType<typeof createWsRouter>
  appSettings: AppSettingsManager
  keybindings: KeybindingsManager
  portProxyGateway: PortProxyGateway
  pushManager: PushManager
  sessionShareService: SessionShareService
  scheduleManager: ScheduleManager
  cronScheduler: CronScheduler
  staleEmptyChatPruneInterval: ReturnType<typeof setInterval>
  followedSessionTickInterval: ReturnType<typeof setInterval>
  snapshotSweepHandle: { stop(): void }
}

async function createApplicationServices(options: StartKannaServerOptions): Promise<ApplicationServices> {
  const store = new EventStore(options.dataDir)
  const diffStore = new DiffStore(store.dataDir)
  const machineDisplayName = getMachineDisplayName()
  await store.initialize()

  let broadcastChatState: ((chatId: string) => void) | null = null
  let pushFollowedSessions: (() => void) | null = null

  const toolCallback: ToolCallbackService = await initToolCallbackOnBoot({
    store,
    serverSecret: process.env.KANNA_SERVER_SECRET ?? crypto.randomUUID(),
    onStateChange: (chatId) => broadcastChatState?.(chatId),
  })

  const vapid = await loadOrGenerateVapidKeys(store.dataDir)
  await diffStore.initialize()
  await store.migrateLegacyTranscripts(options.onMigrationProgress)

  let discoveredProjects: DiscoveredProject[] = []
  const runDiscovery = options.discoverProjects ?? discoverProjects
  async function refreshDiscovery() {
    discoveredProjects = runDiscovery()
    return discoveredProjects
  }
  await refreshDiscovery()

  const terminalPidRegistry = new TerminalPidRegistry(path.join(store.dataDir, "terminals.json"))
  const reapedTerminals = await terminalPidRegistry.reapStale()
  if (reapedTerminals.length > 0) {
    log.info(`[kanna] reaped ${reapedTerminals.length} orphan terminal process group(s) from previous run`)
  }
  const claudePtyRegistry = new ClaudePtyRegistry(path.join(store.dataDir, "claude-pty.json"))
  const ptyInstanceRegistry = createPtyInstanceRegistry()
  const boardStore = createBoardStore({ filePath: path.join(store.dataDir, "boards.db") })
  const boardRegistry = createBoardRegistry({ store: boardStore })
  const boardSync = createBoardSync({
    registry: boardRegistry,
    store: boardStore,
    providers: new Map([["github-issues", createGitHubIssuesProvider()]]),
    readToken: readGitHubCliToken,
    now: () => Date.now(),
  })
  const workflowRegistry = createWorkflowRegistry({
    read: readWorkflowDir,
    watch: (dir, onChange) => watchWorkflowDir(dir, onChange),
    listRunDirs: listWorkflowRunDirs,
    watchRunDirs: (dir, onChange) => watchWorkflowRunDirs(dir, onChange),
    readRunJournal: readWorkflowRunJournal,
    readAgentTranscriptLines: readWorkflowAgentTranscriptLines,
  })
  const subagentTranscriptRegistry = createSubagentTranscriptRegistry()
  const backgroundTaskOutputRegistry = createBackgroundTaskOutputRegistry(backgroundTaskOutputIo)
  const reapedClaudePty = await claudePtyRegistry.reapStale()
  if (reapedClaudePty.length > 0) {
    log.info(`[kanna] reaped ${reapedClaudePty.length} orphan claude PTY process group(s) from previous run`)
  }
  const keybindings = new KeybindingsManager()
  const appSettings = new AppSettingsManager(path.join(store.dataDir, "settings.json"))
  await appSettings.initialize()
  const pushManager = new PushManager({
    store,
    sender: realWebPushSender,
    vapid,
    getContactSubject: () =>
      resolveVapidSubject(appSettings.getSnapshot().push.contactSubject, vapid.subject),
  })
  await pushManager.initialize()
  const snapshotStore = new SnapshotStore(path.join(store.dataDir, "shares"))
  const snapshotSources: SnapshotSources = {
    getChatMeta(chatId): ChatMeta | null {
      const chat = store.getChat(chatId)
      if (!chat) return null
      const transcript = store.getMessages(chatId)
      const systemInit = transcript.find((e) => e.kind === "system_init")
      const model = systemInit?.kind === "system_init" ? systemInit.model : "unknown"
      return { id: chat.id, title: chat.title ?? "Untitled chat", model, createdAt: chat.createdAt ?? 0 }
    },
    getTranscript(chatId): ChatSnapshotMessage[] {
      const out: ChatSnapshotMessage[] = []
      for (const entry of store.getMessages(chatId)) {
        switch (entry.kind) {
          case "user_prompt":
            out.push({ kind: "user_prompt", id: entry._id, createdAt: entry.createdAt, text: entry.content })
            break
          case "assistant_text":
            out.push({ kind: "assistant_text", id: entry._id, createdAt: entry.createdAt, text: entry.text })
            break
          case "assistant_thinking":
            out.push({ kind: "assistant_thinking", id: entry._id, createdAt: entry.createdAt, text: entry.text })
            break
          case "tool_call":
            out.push({ kind: "tool_call", id: entry._id, createdAt: entry.createdAt, name: entry.tool.toolName, input: toJsonValue(entry.tool.input) })
            break
          case "tool_result":
            out.push({ kind: "tool_result", id: entry._id, createdAt: entry.createdAt, toolCallId: entry.toolId, output: entry.content, isError: entry.isError ?? false })
            break
          default:
            break
        }
      }
      return out
    },
    getAttachments(_chatId): AttachmentManifestEntry[] {
      return []
    },
  }
  const sessionShareService = new SessionShareService({
    events: store,
    snapshotStore,
    buildSnapshot: (chatId) => buildChatSnapshot(snapshotSources, chatId),
    getDefaultTtlHours: () => appSettings.getSnapshot().shareDefaultTtlHours,
    owner: () => "owner",
  })
  const snapshotSweepHandle = startSnapshotSweep(sessionShareService, 24 * 60 * 60 * 1000)
  await keybindings.initialize()
  const auth = options.password
    ? createAuthManager(options.password, {
        trustProxy: options.trustProxy ?? false,
        sessionStore: await createAuthSessionStore({
          filePath: path.join(store.dataDir, "sessions.json"),
        }),
        getMaxAgeMs: () => appSettings.getSnapshot().auth.sessionMaxAgeDays * 86_400_000,
      })
    : null
  const terminals = new TerminalManager({ pidRegistry: terminalPidRegistry })
  const packageUpdateManager = new PackageUpdateManager({
    inventory: readPackageInventory,
    checkers: [
      createSkillUpdateChecker({ fetchFn: fetch, token: null }),
      createClaudePluginUpdateChecker(
        buildClaudePluginCheckerDeps(findClaudeBinary()),
      ),
      createCodexPluginUpdateChecker(buildCodexPluginCheckerDepsForEnv()),
    ],
    appliers: buildPackageUpdateAppliers(findClaudeBinary()),
    settings: () => appSettings.getSnapshot().packageUpdates,
    timer: { setInterval, clearInterval },
    now: Date.now, hasAnyChatBusy: () => agent.hasAnyChatBusy(),
  })
  const portProxyGateway = new PortProxyGateway({
    store,
    broadcast: (chatId) => broadcastChatState?.(chatId),
    getBaseUrl: () => `http://${options.host ?? "127.0.0.1"}:${options.port ?? 3210}`,
  })
  const oauthPool = new OAuthTokenPool(
    () => appSettings.getSnapshot().claudeAuth.tokens,
    (id, patch) => {
      appSettings.mutateTokenStatus(id, patch).catch((err) => {
        log.warn("[oauth-pool] token status write failed:", err)
      })
    },
    Date.now,
    () => appSettings.getSnapshot().claudeAuth.concurrencyDefault,
  )
  setQuickResponseOAuthPool(oauthPool)
  const localCatalog = new LocalCatalogService({
    scan: scanLocalCatalog,
    statMtimes,
    homeDir: defaultHomeDir(),
  })

  let agent!: AgentCoordinator
  const scheduleManager = new ScheduleManager({
    fire: async (chatId, scheduleId) => {
      await agent.fireAutoContinue(chatId, scheduleId)
    },
  })
  const cronScheduler = new CronScheduler({
    fire: async (chatId, jobId) => {
      await agent.fireCronJob(chatId, jobId)
    },
  })
  agent = new AgentCoordinator({
    store,
    scheduleManager,
    cronScheduler,
    claudeLimitDetector: options.agentOverrides?.claudeLimitDetector,
    codexLimitDetector: options.agentOverrides?.codexLimitDetector,
    throwOnClaudeSessionStart: options.agentOverrides?.throwOnClaudeSessionStart,
    tunnelGateway: portProxyGateway,
    oauthPool,
    toolCallback,
    claudePtyRegistry,
    ptyInstanceRegistry,
    workflowRegistry,
    boardRegistry,
    backgroundTaskOutputRegistry,
    subagentTranscriptRegistry,
    localCatalog,
    chatPolicy: { ...POLICY_DEFAULT, defaultAction: "auto-allow" },
    getSubagents: () => appSettings.getSnapshot().subagents,
    getAppSettingsSnapshot: () => buildAgentAppSettingsView(appSettings.getSnapshot()),
    persistOAuthState: (id, oauth) => void appSettings.writePatch({ customMcpServers: { setOAuthState: { id, oauth } } }),
    readLlmProvider: () => readLlmProviderSnapshot(),
    onStateChange: (chatId?: string, broadcastOptions?: { immediate?: boolean }) => {
      if (chatId) {
        if (broadcastOptions?.immediate) {
          void router.broadcastChatStateImmediately(chatId)
          return
        }
        router.scheduleChatStateBroadcast(chatId)
        return
      }
      router.scheduleBroadcast()
    },
  })

  const startWorkDeps: StartWorkDeps = {
    registry: boardRegistry,
    getProject: (projectId) => {
      const project = store.getProject(projectId)
      return project ? { id: project.id, localPath: project.localPath } : null
    },
    chatExists: (chatId) => store.getChat(chatId) !== null,
    listWorktrees,
    localBranchExists,
    addWorktree,
    createChat: (projectId, chatOptions) => store.createChat(projectId, chatOptions),
    sendPrompt: async (chatId, content) => {
      await agent.send({ type: "chat.send", chatId, content })
    },
  }
  const startWork = (cardId: string) => runStartWork(startWorkDeps, cardId)
  const startWorkView = (cardId: string) => runStartWorkView(startWorkDeps, cardId)
  const cleanupDeps: WorktreeCleanupDeps = {
    registry: boardRegistry,
    getProject: startWorkDeps.getProject,
    listWorktrees,
    isDirty,
    previewMerge: async (repoRoot, branch) => {
      const preview = await diffStore.previewMergeBranch({
        projectPath: repoRoot,
        branch: { kind: "local", name: branch },
      })
      return { commitCount: preview.commitCount, hasConflicts: preview.hasConflicts }
    },
    mergeBranch: async (projectId, repoRoot, branch) => {
      const merged = await diffStore.mergeBranch({
        projectPath: repoRoot,
        branch: { kind: "local", name: branch },
      })
      return merged.ok ? { ok: true, message: `Merged ${branch}` } : { ok: false, message: merged.message }
    },
    removeWorktree,
  }
  const suggestSyncRepos = async (boardId: string): Promise<readonly RepoSuggestion[]> => {
    const board = boardRegistry.getBoard(boardId)
    if (!board) return []
    const projectIds =
      board.ownerKind === "stack"
        ? (store.getStack(board.ownerId)?.projectIds ?? [])
        : [board.ownerId]

    const suggestions = await Promise.all(
      projectIds.map(async (projectId): Promise<RepoSuggestion | null> => {
        const project = store.getProject(projectId)
        if (!project) return null
        const slug = await readOriginRepoSlug(project.localPath)
        const [owner, repo] = slug?.split("/") ?? []
        const named = owner && repo ? { owner, repo } : null
        return {
          projectId,
          projectName: project.title,
          repo: named,
          boundTo: named
            ? boardRegistry.repoBindingOwner(
                "github-issues",
                { provider: "github-issues", ...named },
                boardId,
              )
            : null,
        }
      }),
    )
    return suggestions.filter((entry): entry is RepoSuggestion => entry !== null)
  }
  const cleanupView = (cardId: string) => worktreeCleanupView(cleanupDeps, cardId)
  const resolveCleanup = (cardId: string, decision: CleanupDecision) =>
    resolveWorktreeCleanup(cleanupDeps, cardId, decision)

  const followedSessionRegistry = createFollowedSessionRegistry({
    statFile: statSessionFile,
    runDelta: async (_chatId, sourcePath) => {
      const session = parseClaudeSessionFile(sourcePath)
      if (session) await importOneSession(store, session)
    },
    isTurnActive: (chatId) => agent.hasActiveTurn(chatId),
    now: Date.now,
    onChange: () => pushFollowedSessions?.(),
    activeWindowMs: parsePositiveIntEnv(
      process.env.KANNA_IMPORT_FOLLOW_ACTIVE_WINDOW_MS,
      IMPORT_FOLLOW_ACTIVE_WINDOW_MS,
    ),
    idleMs: parsePositiveIntEnv(process.env.KANNA_IMPORT_FOLLOW_IDLE_MS, IMPORT_FOLLOW_IDLE_MS),
  })

  const router = createWsRouter({
    store,
    diffStore,
    agent,
    terminals,
    keybindings,
    appSettings,
    portProxyGateway,
    llmProvider: {
      read: readLlmProviderSnapshot,
      write: writeLlmProviderSnapshot,
      validate: validateLlmProviderCredentials,
    },
    refreshDiscovery,
    getDiscoveredProjects: () => discoveredProjects,
    machineDisplayName,
    pushManager,
    ptyInstances: ptyInstanceRegistry,
    workflowRegistry,
    boardRegistry,
    boardSync,
    startWork,
    startWorkView,
    cleanupView,
    resolveCleanup,
    suggestSyncRepos,
    backgroundTaskOutputRegistry,
    subagentTranscriptRegistry,
    followedSessionRegistry,
    killPtyInstance: async (chatId: string) => {
      try {
        await agent.killPtyInstance(chatId)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    sessionShare: sessionShareService,
    packageUpdateManager,
  })

  broadcastChatState = (chatId: string) => { router.scheduleChatStateBroadcast(chatId) }
  pushFollowedSessions = () => { router.pushFollowedSessions() }
  agent.onCronJobsChange = () => { router.pushCronJobs() }
  packageUpdateManager.start()

  const staleEmptyChatPruneInterval = setInterval(() => {
    void router.pruneStaleEmptyChats().then(() => router.broadcastSnapshots())
  }, STALE_EMPTY_CHAT_PRUNE_INTERVAL_MS)
  const followedSessionTickInterval = setInterval(
    () => { void followedSessionRegistry.tick() },
    parsePositiveIntEnv(process.env.KANNA_IMPORT_FOLLOW_POLL_MS, IMPORT_FOLLOW_POLL_MS),
  )

  return {
    store,
    diffStore,
    auth,
    terminals,
    packageUpdateManager,
    agent,
    router,
    appSettings,
    keybindings,
    portProxyGateway,
    pushManager,
    sessionShareService,
    scheduleManager,
    cronScheduler,
    staleEmptyChatPruneInterval,
    followedSessionTickInterval,
    snapshotSweepHandle,
  }
}

function rehydrateScheduledWork(services: ApplicationServices): void {
  const { store, agent, scheduleManager, cronScheduler } = services

  scheduleManager.rehydrate(
    store.listAutoContinueChats().flatMap((chatId) => store.getAutoContinueEvents(chatId))
  )

  const cronChatIds = store.listAutoContinueChats()
  const missedCronFires = cronScheduler.rehydrate(
    cronChatIds.flatMap((chatId) => store.getAutoContinueEvents(chatId)),
  )
  void agent.reconcileCronRunsAtBoot(missedCronFires, cronChatIds).catch((error) => {
    log.error("[kanna/cron] boot reconciliation failed:", String(error))
  })

  void recoverQueuedMessages({
    listChatsWithQueuedMessages: () => store.listChatsWithQueuedMessages(),
    maybeStartNextQueuedMessage: (chatId, opts) => agent.maybeStartNextQueuedMessage(chatId, opts),
  }).then(async (recovered) => {
    if (recovered.length > 0) {
      log.info("[kanna] resumed queued messages after restart", { chats: recovered.length })
    }
    const rearmed = await agent.recoverArmedLoopWakes()
    if (rearmed.length > 0) {
      log.info("[kanna] re-fired lost loop wakes after restart", { chats: rearmed.length })
    }
  })
}

async function shutdownServices(services: ApplicationServices, server: Server<ClientState>): Promise<void> {
  const { store, agent, auth, appSettings, keybindings, scheduleManager, cronScheduler,
    portProxyGateway, snapshotSweepHandle, staleEmptyChatPruneInterval,
    followedSessionTickInterval, router, terminals, packageUpdateManager } = services

  packageUpdateManager.stop()
  appSettings.dispose()
  keybindings.dispose()
  scheduleManager.shutdown()
  const cronDrain = cronScheduler.shutdown()
  portProxyGateway.shutdown()
  snapshotSweepHandle.stop()
  clearInterval(staleEmptyChatPruneInterval)
  clearInterval(followedSessionTickInterval)
  for (const chatId of agent.getActiveTurnChatIds()) {
    await agent.cancel(chatId)
  }
  await agent.drainCronOutcomes()
  await cronDrain
  await agent.dispose()
  router.dispose()
  await auth?.dispose()
  terminals.closeAll()
  await store.flush()
  await store.snapshotAndTruncateLogs()
  server.stop(true)
}

const MAX_PORT_ATTEMPTS = 20

export async function startKannaServer(options: StartKannaServerOptions = {}) {
  const services = await createApplicationServices(options)
  const { store, diffStore, appSettings, auth, sessionShareService, router } = services

  const distDir = options.distDir ?? path.join(import.meta.dir, "..", "..", "dist", "client")
  const fetchHandler = createHttpDispatcher({ store, appSettings, auth, sessionShare: sessionShareService, distDir })

  const port = options.port ?? 3210
  const hostname = options.host ?? "127.0.0.1"
  const strictPort = options.strictPort ?? false

  let server!: Server<ClientState>
  let actualPort = port

  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
    try {
      server = serveHttp<ClientState>({
        port: actualPort,
        hostname,
        maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
        fetch: fetchHandler,
        websocket: {
          open(ws) { router.handleOpen(ws) },
          message(ws, raw) { router.handleMessage(ws, raw) },
          close(ws) { router.handleClose(ws) },
        },
      })
      break
    } catch (err) {
      const isAddrInUse = isErrnoException(err) && err.code === "EADDRINUSE"
      if (!isAddrInUse || strictPort || attempt === MAX_PORT_ATTEMPTS - 1) throw err
      log.info(`Port ${actualPort} is in use, trying ${actualPort + 1}...`)
      actualPort++
    }
  }

  const boundPort = server.port ?? actualPort
  services.portProxyGateway.setBaseUrl(`http://${hostname}:${boundPort}`)
  await services.portProxyGateway.reapOrphanedProxies()

  rehydrateScheduledWork(services)

  return {
    port: boundPort,
    store,
    diffStore,
    appSettings,
    stop: () => shutdownServices(services, server),
  }
}
