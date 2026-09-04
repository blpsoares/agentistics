/** The URL that reads an attachment back — see `GET /api/fleet/attachment` and its
 *  `resolveAttachmentRead` guard on the server. One place, so a caller never hand-builds it. */
export function attachmentUrl(path: string): string {
  return `/api/fleet/attachment?path=${encodeURIComponent(path)}`
}

/**
 * The URL that reads one stored attachment back BY ITS NAME — see `GET /api/fleet/attachment/
 * by-name` and its pure `attachmentPathByName` / `attachmentImageType` guards on the server.
 *
 * The narrower of the two, and the one the GALLERY uses. The chat shows an attachment back from
 * the message that carried it, so it necessarily has a path; the gallery is a view OF the
 * attachments directory and needs nothing more than a name — which is a shape that cannot express
 * a traversal at all. That route also serves images ONLY, so it can never become a general reader
 * of agentop's own directory.
 *
 * A `HEAD` on this same URL answers the SIZE without the bytes, which is what the list column
 * under each name is for.
 */
export function attachmentNameUrl(name: string): string {
  return `/api/fleet/attachment/by-name?name=${encodeURIComponent(name)}`
}
