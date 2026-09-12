/**
 * attachments.ts — PURE. Which lines of a message are attachment PATHS rather than prose.
 *
 * An attachment here is a PATH (see the server's `attachment-web.ts` header): the composer types a
 * line into a tmux pane, so a message is the quote, then one line per attachment's own path, then
 * whatever was typed. The transcript records exactly that, verbatim.
 *
 * The heuristic is deliberately narrow: a line that is JUST a path (no spaces) ending in a known
 * image extension. Prose that happens to mention "see diagram.png in the repo" has spaces around
 * the name and is left alone; a bare attachment line never does, because that is how it was built.
 *
 * It lived in the web's `attachmentPreview.ts` while the browser was the only thing that asked. The
 * SERVER asks it too now: what a message CARRIED is recorded at the moment it is delivered, read
 * off the very text being typed into the pane, so a `[Image #N]` marker pairs with the files of
 * THAT message instead of with whatever else was uploaded in the same hour. Two implementations of
 * that one rule would let the record and the render disagree about which lines were attachments.
 */

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'])

export function isImagePath(path: string): boolean {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return false
  return IMAGE_EXTENSIONS.has(path.slice(dot + 1).toLowerCase())
}

/** A path-shaped line: no whitespace, and not empty. Prose never qualifies. */
function looksLikeBarePath(line: string): boolean {
  return line !== '' && !/\s/.test(line)
}

export interface SplitAttachments {
  /** The image paths found, in the order they appeared. */
  images: string[]
  /** The remaining text, with those lines removed and no blank line left in their place. */
  text: string
}

export function splitImageAttachments(text: string): SplitAttachments {
  const images: string[] = []
  const kept: string[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (looksLikeBarePath(trimmed) && isImagePath(trimmed)) images.push(trimmed)
    else kept.push(line)
  }
  return { images, text: kept.join('\n').trim() }
}
