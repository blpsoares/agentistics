/**
 * editor-web.ts — the routes behind the repository explorer.
 *
 * `capability-guard.ts` has already refused these paths where the exposure profile forbids them
 * (the `/api/fleet` prefix), and `index.ts` applies the user's own `editorEnabled` switch on top
 * before this is ever reached (Task 12). What is left here is resolving the session's directory
 * once per request and turning each `editor-fs.ts` refusal code into a localized sentence — the
 * modules themselves stay language-free, like `shell-web.ts` does for `ShellRefusal`.
 */
import type { StartHost } from '../cli-start'
import type { CliLang } from '../cli-lang'
import {
  createTreeEntry, deleteTreeEntry, listChildren, readTreeFile, renameTreeEntry,
  resolveSessionDirectory, searchTree, writeTreeFile,
} from './editor-fs'
import type { SessionDirRefusal } from './editor-directory'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const DIR_REFUSAL: Record<SessionDirRefusal, { en: string; pt: string }> = {
  'unknown-session': {
    en: 'That session is not in this machine’s list.',
    pt: 'Essa sessão não está na lista desta máquina.',
  },
  'no-cwd': {
    en: 'This session records no folder, so there is nothing to open here.',
    pt: 'Esta sessão não tem uma pasta registrada, então não há o que abrir aqui.',
  },
  'cwd-missing': {
    en: 'This session’s folder no longer exists on disk.',
    pt: 'A pasta desta sessão não existe mais no disco.',
  },
}

const GENERIC_REFUSAL: Record<string, { en: string; pt: string }> = {
  escaped: {
    en: 'That path is outside this session’s folder.',
    pt: 'Esse caminho está fora da pasta desta sessão.',
  },
  'not-found': {
    en: 'That path does not exist.',
    pt: 'Esse caminho não existe.',
  },
  'not-a-directory': {
    en: 'That path is a file, not a folder.',
    pt: 'Esse caminho é um arquivo, não uma pasta.',
  },
  'not-a-file': {
    en: 'That path is a folder, not a file.',
    pt: 'Esse caminho é uma pasta, não um arquivo.',
  },
  'already-exists': {
    en: 'Something is already there.',
    pt: 'Já existe algo nesse caminho.',
  },
  'not-empty': {
    en: 'That folder is not empty. Delete it recursively to remove everything inside it.',
    pt: 'Essa pasta não está vazia. Apague recursivamente para remover tudo dentro dela.',
  },
  conflict: {
    en: 'This file changed on disk since it was opened. Review the current version before saving over it.',
    pt: 'Este arquivo mudou no disco desde que foi aberto. Revise a versão atual antes de salvar sobre ela.',
  },
}

function sentence(reason: string, lang: CliLang): string {
  const dir = DIR_REFUSAL[reason as SessionDirRefusal]
  if (dir) return dir[lang]
  const generic = GENERIC_REFUSAL[reason]
  return generic ? generic[lang] : reason
}

/** `null` when the path is not ours, so `index.ts` falls through to its next route. */
export async function handleEditorTreeRoute(
  req: Request, url: URL, host: StartHost, lang: CliLang,
): Promise<Response | null> {
  const { pathname } = url

  if (pathname === '/api/fleet/tree' && req.method === 'GET') {
    const id = url.searchParams.get('id')
    if (!id) return json({ ok: false, reason: 'bad_request', message: 'id is required' }, 400)
    const dir = await resolveSessionDirectory(host, id)
    if (!dir.ok) return json({ ok: false, reason: dir.reason, message: sentence(dir.reason, lang) }, 404)
    const listed = await listChildren(dir.dir, url.searchParams.get('path') ?? '')
    if (!listed.ok) return json({ ok: false, reason: listed.reason, message: sentence(listed.reason, lang) }, 404)
    return json({ ok: true, children: listed.children })
  }

  if (pathname === '/api/fleet/tree/search' && req.method === 'GET') {
    const id = url.searchParams.get('id')
    if (!id) return json({ ok: false, reason: 'bad_request', message: 'id is required' }, 400)
    const dir = await resolveSessionDirectory(host, id)
    if (!dir.ok) return json({ ok: false, reason: dir.reason, message: sentence(dir.reason, lang) }, 404)
    const result = await searchTree(dir.dir, url.searchParams.get('q') ?? '')
    return json({ ok: true, ...result })
  }

  if (pathname === '/api/fleet/tree/file' && req.method === 'GET') {
    const id = url.searchParams.get('id')
    const path = url.searchParams.get('path')
    if (!id || path === null) return json({ ok: false, reason: 'bad_request', message: 'id and path are required' }, 400)
    const dir = await resolveSessionDirectory(host, id)
    if (!dir.ok) return json({ ok: false, reason: dir.reason, message: sentence(dir.reason, lang) }, 404)
    const file = await readTreeFile(dir.dir, path)
    if (!file.ok) return json({ ok: false, reason: file.reason, message: sentence(file.reason, lang) }, 404)
    return json(file)
  }

  if (pathname === '/api/fleet/tree/file' && req.method === 'PUT') {
    const id = url.searchParams.get('id')
    const path = url.searchParams.get('path')
    if (!id || path === null) return json({ ok: false, reason: 'bad_request', message: 'id and path are required' }, 400)
    const body = await req.json().catch(() => null) as { content?: string; mtimeMs?: number } | null
    if (!body || typeof body.content !== 'string' || typeof body.mtimeMs !== 'number') {
      return json({ ok: false, reason: 'bad_request', message: 'content and mtimeMs are required' }, 400)
    }
    const dir = await resolveSessionDirectory(host, id)
    if (!dir.ok) return json({ ok: false, reason: dir.reason, message: sentence(dir.reason, lang) }, 404)
    const out = await writeTreeFile(dir.dir, path, body.content, body.mtimeMs)
    if (!out.ok) {
      const status = out.reason === 'conflict' ? 409 : 404
      return json({ ...out, message: sentence(out.reason, lang) }, status)
    }
    return json(out)
  }

  if (pathname === '/api/fleet/tree/entry' && req.method === 'POST') {
    const body = await req.json().catch(() => null) as { id?: string; path?: string; kind?: string } | null
    if (!body?.id || !body.path || (body.kind !== 'file' && body.kind !== 'dir')) {
      return json({ ok: false, reason: 'bad_request', message: 'id, path and kind are required' }, 400)
    }
    const dir = await resolveSessionDirectory(host, body.id)
    if (!dir.ok) return json({ ok: false, reason: dir.reason, message: sentence(dir.reason, lang) }, 404)
    const out = await createTreeEntry(dir.dir, body.path, body.kind)
    if (!out.ok) return json({ ok: false, reason: out.reason, message: sentence(out.reason, lang) }, 409)
    return json(out)
  }

  if (pathname === '/api/fleet/tree/entry' && req.method === 'PATCH') {
    const body = await req.json().catch(() => null) as { id?: string; from?: string; to?: string } | null
    if (!body?.id || !body.from || !body.to) {
      return json({ ok: false, reason: 'bad_request', message: 'id, from and to are required' }, 400)
    }
    const dir = await resolveSessionDirectory(host, body.id)
    if (!dir.ok) return json({ ok: false, reason: dir.reason, message: sentence(dir.reason, lang) }, 404)
    const out = await renameTreeEntry(dir.dir, body.from, body.to)
    if (!out.ok) return json({ ok: false, reason: out.reason, message: sentence(out.reason, lang) }, 409)
    return json(out)
  }

  if (pathname === '/api/fleet/tree/entry' && req.method === 'DELETE') {
    const id = url.searchParams.get('id')
    const path = url.searchParams.get('path')
    if (!id || path === null) return json({ ok: false, reason: 'bad_request', message: 'id and path are required' }, 400)
    const dir = await resolveSessionDirectory(host, id)
    if (!dir.ok) return json({ ok: false, reason: dir.reason, message: sentence(dir.reason, lang) }, 404)
    const recursive = url.searchParams.get('recursive') === '1'
    const out = await deleteTreeEntry(dir.dir, path, recursive)
    if (!out.ok) return json({ ok: false, reason: out.reason, message: sentence(out.reason, lang) }, 409)
    return json(out)
  }

  return null
}
