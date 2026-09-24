import type { StorageBackend } from "./storage/backend"
import type { PortProxyEvent } from "./port-proxy/events"
import type { PushEvent } from "./push/events"
import type { ShareEvent } from "./session-share/share-projection"
import {
  applyPortProxyEventToMap,
  loadPushEventsFromLog,
  loadShareEventsFromLog,
  loadPortProxyEventsFromLog,
} from "./event-store-snapshot"


export interface PeripheralEventsDeps {
  readonly storage: StorageBackend
  readonly portProxyLogPath: string
  readonly sharesLogPath: string
  readonly pushLogPath: string
  readonly portProxyEventsByChatId: Map<string, PortProxyEvent[]>
  readonly shareEventsAll: ShareEvent[]
  getWriteChain: () => Promise<void>
  setWriteChain: (p: Promise<void>) => void
}


export async function appendPortProxyEvent(
  deps: PeripheralEventsDeps,
  event: PortProxyEvent,
): Promise<void> {
  const payload = `${JSON.stringify(event)}\n`
  const chain = deps.getWriteChain().then(async () => {
    await deps.storage.appendText(deps.portProxyLogPath, payload)
    applyPortProxyEventToMap(deps.portProxyEventsByChatId, event)
  })
  deps.setWriteChain(chain)
  await chain
}

export function getPortProxyEvents(
  deps: PeripheralEventsDeps,
  chatId: string,
): PortProxyEvent[] {
  const list = deps.portProxyEventsByChatId.get(chatId)
  return list ? [...list] : []
}

export function listPortProxyChats(deps: PeripheralEventsDeps): string[] {
  return [...deps.portProxyEventsByChatId.keys()]
}

export async function loadPortProxyEvents(deps: PeripheralEventsDeps): Promise<void> {
  await loadPortProxyEventsFromLog(deps.storage, deps.portProxyLogPath, deps.portProxyEventsByChatId)
}


export async function appendShareEvent(
  deps: PeripheralEventsDeps,
  event: ShareEvent,
): Promise<void> {
  const payload = `${JSON.stringify(event)}\n`
  const chain = deps.getWriteChain().then(async () => {
    await deps.storage.appendText(deps.sharesLogPath, payload)
    deps.shareEventsAll.push(event)
  })
  deps.setWriteChain(chain)
  await chain
}

export function getShareEvents(deps: PeripheralEventsDeps): ShareEvent[] {
  return [...deps.shareEventsAll]
}

export async function loadShareEvents(deps: PeripheralEventsDeps): Promise<void> {
  await loadShareEventsFromLog(deps.storage, deps.sharesLogPath, deps.shareEventsAll)
}


export async function appendPushEvent(
  deps: PeripheralEventsDeps,
  event: PushEvent,
): Promise<void> {
  const payload = `${JSON.stringify(event)}\n`
  const chain = deps.getWriteChain().then(async () => {
    await deps.storage.appendText(deps.pushLogPath, payload)
  })
  deps.setWriteChain(chain)
  await chain
}

export async function loadPushEvents(deps: PeripheralEventsDeps): Promise<PushEvent[]> {
  return loadPushEventsFromLog(deps.storage, deps.pushLogPath)
}
