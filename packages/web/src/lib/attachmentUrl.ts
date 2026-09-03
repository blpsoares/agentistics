/** The URL that reads an attachment back — see `GET /api/fleet/attachment` and its
 *  `resolveAttachmentRead` guard on the server. One place, so a caller never hand-builds it. */
export function attachmentUrl(path: string): string {
  return `/api/fleet/attachment?path=${encodeURIComponent(path)}`
}
