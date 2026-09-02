/**
 * attachment-web.ts — attaching a file to a message sent from the dashboard.
 *
 * WHAT AN ATTACHMENT ACTUALLY IS HERE. The composer types a line into a tmux pane; there is no
 * channel through which a byte array could reach an assistant. What every one of these CLIs does
 * understand is a PATH — reading a file it is pointed at is the most ordinary thing they do. So an
 * attachment is written to this machine's disk and its path is what travels in the message.
 *
 * That is worth stating plainly in the UI too, because it is not what "attach" means in a chat
 * application: the file lands on the machine running the session, not inside the conversation.
 *
 * The write goes to ONE directory under `~/.agentistics`, which is agentop's own — the rule that
 * anything written outside its own directories is an explicit act of the user is not bent here. The
 * filename is REBUILT by the pure `attachment-name.ts` rather than sanitised, because a name from a
 * browser is attacker-controlled and joining it to a directory is how an upload becomes an
 * arbitrary write.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { AGENTISTICS_DATA_DIR } from '../config'
import { storedAttachmentName } from './attachment-name'

/** Where uploads land. Inside agentop's own directory, never beside the user's project. */
export const ATTACHMENT_DIR = join(AGENTISTICS_DATA_DIR, 'attachments')

/**
 * The ceiling on one upload.
 *
 * Generous enough for a screenshot or a log, far below anything that would make writing it a
 * problem. The transport enforces its own limit as well; this is the one that decides what this
 * feature is for.
 */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

export interface AttachmentResult {
  ok: boolean
  /** The absolute path to reference in a message. Present only on success. */
  path?: string
  /** The stored name, for the chip in the composer. */
  name?: string
  /** Already-localized. Always present on failure, and on a name that had to be rewritten. */
  message?: string
}

export async function storeAttachment(
  lang: 'pt' | 'en',
  file: { name: string; bytes: Uint8Array },
): Promise<AttachmentResult> {
  const pt = lang === 'pt'

  if (file.bytes.byteLength === 0) {
    return { ok: false, message: pt ? 'O arquivo está vazio.' : 'The file is empty.' }
  }
  if (file.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    const mb = Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))
    return {
      ok: false,
      message: pt
        ? `O arquivo passa do limite de ${mb} MB para anexos.`
        : `The file is over the ${mb} MB attachment limit.`,
    }
  }

  const name = storedAttachmentName(file.name, randomBytes(4).toString('hex'))
  const path = join(ATTACHMENT_DIR, name)

  try {
    await mkdir(ATTACHMENT_DIR, { recursive: true })
    // 0600: an attachment can be anything the user had open, and the directory is shared by every
    // session on this machine.
    await writeFile(path, file.bytes, { mode: 0o600 })
  } catch {
    return {
      ok: false,
      message: pt
        ? 'Não foi possível gravar o anexo nesta máquina.'
        : 'The attachment could not be written on this machine.',
    }
  }

  return { ok: true, path, name }
}
