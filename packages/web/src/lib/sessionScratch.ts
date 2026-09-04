/**
 * sessionScratch.ts — what survives leaving a conversation and coming back.
 *
 * Two things did not, and both were reported:
 *
 *   1. "as conversas que eu ja abri, se eu saio e volto elas sao recarregadas novamente" — the chat
 *      view holds its payload in component state, so navigating away destroys it and returning
 *      paints an empty column until a fetch completes. The data is on this machine; the wait is
 *      pure ceremony.
 *   2. "se eu comeco a digitar aqui e vou pra outra pagina, eu perco todo o prompt que eu escrevi" —
 *      the composer's draft is component state too. Losing typed words to a click is the worst
 *      thing a text field can do, and it is the one thing here that CANNOT be recovered from the
 *      server: a conversation re-fetches, a paragraph the person wrote does not exist anywhere
 *      else.
 *
 * They get DIFFERENT storage, because they are different kinds of thing:
 *
 * - A DRAFT is the person's own words and nothing else has a copy, so it goes to `sessionStorage`
 *   and survives a reload as well as a navigation. Per tab, deliberately: two tabs open on one
 *   session are two people composing, and merging their keystrokes is not a feature.
 * - A CONVERSATION is a CACHE of something the server will hand back on request, so it stays in
 *   memory. Writing hundreds of turns per session into `sessionStorage` would spend a real quota
 *   on bytes that are one fetch away, and quota errors are silent in exactly the browsers where
 *   they happen.
 *
 * THE CACHED CONVERSATION IS NEVER THE ANSWER, only the first paint. The poll fires on mount as it
 * always did and replaces it; the cache removes the blank column in front of it, and nothing more.
 * That is why there is no staleness rule here — a cache whose maximum age is one request does not
 * need one.
 *
 * Every read and write is wrapped: `sessionStorage` THROWS on access in a browser set to block
 * site data, not merely returns null, and a composer that cannot be typed into because storage is
 * off would be a far worse bug than the one this fixes.
 */

/** The shape this module keeps for a conversation. Structural, so it never imports the chat view. */
export interface CachedChat {
  turns: unknown[]
  live?: boolean
  unavailable?: string
}

/** A `Storage`-shaped dependency, so the behaviour is testable without a browser. */
export interface ScratchStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/**
 * How many conversations stay in memory.
 *
 * A fleet here routinely holds forty rows and a long conversation is hundreds of turns, so an
 * unbounded map is a leak that grows with how much of the product you use. Ten is what a person
 * moves between in one sitting; the eleventh costs exactly what it cost before this file existed.
 */
export const MAX_CACHED_CHATS = 10

/** `sessionStorage` key for one session's draft. Namespaced so nothing else can collide with it. */
export function draftKey(id: string): string {
  return `agentistics:draft:${id}`
}

/**
 * Insert into a bounded, least-recently-USED-first map.
 *
 * Pure, and it re-inserts on every write so touching a conversation keeps it: a plain size check
 * would evict by insertion order and drop the very conversation somebody is switching back and
 * forth with. Returns a NEW map — the caller holds the only reference and mutation would make the
 * eviction order depend on read paths.
 */
export function capChats(
  map: ReadonlyMap<string, CachedChat>,
  id: string,
  chat: CachedChat,
  max: number = MAX_CACHED_CHATS,
): Map<string, CachedChat> {
  const next = new Map(map)
  next.delete(id)
  next.set(id, chat)
  while (next.size > max) {
    const oldest = next.keys().next()
    if (oldest.done) break
    next.delete(oldest.value)
  }
  return next
}

export interface SessionScratch {
  readDraft(id: string): string
  writeDraft(id: string, text: string): void
  clearDraft(id: string): void
  readChat(id: string): CachedChat | null
  writeChat(id: string, chat: CachedChat): void
}

/** Build a scratch over any storage. `null` storage yields drafts that work only in memory. */
export function createSessionScratch(store: ScratchStore | null): SessionScratch {
  let chats: ReadonlyMap<string, CachedChat> = new Map()
  // The in-memory fallback for a browser that refuses storage: a draft still survives NAVIGATION
  // (this module outlives the component), it simply does not survive a reload. Degrading to "less
  // durable" is right; degrading to "the field eats your words" is not.
  const memoryDrafts = new Map<string, string>()

  return {
    readDraft(id) {
      if (store) {
        try {
          const v = store.getItem(draftKey(id))
          if (v !== null) return v
        } catch { /* storage blocked — fall through to memory */ }
      }
      return memoryDrafts.get(id) ?? ''
    },
    writeDraft(id, text) {
      // An empty draft is a REMOVAL, not a stored empty string: leaving one behind means the next
      // read cannot tell "they cleared it" from "they never typed", and it spends quota forever.
      if (text === '') { this.clearDraft(id); return }
      memoryDrafts.set(id, text)
      if (store) {
        try { store.setItem(draftKey(id), text) } catch { /* quota or blocked — memory still has it */ }
      }
    },
    clearDraft(id) {
      memoryDrafts.delete(id)
      if (store) {
        try { store.removeItem(draftKey(id)) } catch { /* nothing to do about it */ }
      }
    },
    readChat(id) {
      return chats.get(id) ?? null
    },
    writeChat(id, chat) {
      chats = capChats(chats, id, chat)
    },
  }
}

/** The one instance the app uses. Built against `sessionStorage` where there is one. */
export const sessionScratch: SessionScratch = createSessionScratch(
  typeof globalThis !== 'undefined' && 'sessionStorage' in globalThis
    ? (globalThis as unknown as { sessionStorage: ScratchStore }).sessionStorage
    : null,
)
