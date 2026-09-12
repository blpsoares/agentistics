/**
 * editor-text.ts — whether a file's bytes can be handed to an EDITOR at all, decided once. Pure.
 *
 * The Studio's read path used to be `buf.toString('utf8')` behind a NUL-byte sniff, and the save
 * path writes the editor's string back as UTF-8. Those two are each other's inverse ONLY for bytes
 * that already were valid UTF-8. A Latin-1 / cp1252 file carries no NUL, so the sniff called it
 * text, `toString` replaced every byte it could not decode with U+FFFD, the editor offered a live
 * Save, and the save wrote the replacement characters over the original bytes — with the mtime
 * matching, so no conflict, no refusal, and a strip saying "Saved". Measured: `caf\xE9\n` came back
 * as `63 61 66 ef bf bd 0a`.
 *
 * So the decode is STRICT (`fatal: true`): a buffer that is not valid UTF-8 yields `null`, and the
 * caller REFUSES — this module's standing rule is refuse, never repair. There is deliberately no
 * transcoding path: guessing an encoding is guessing which bytes the save will write, and a wrong
 * guess is the same silent corruption by another door.
 *
 * `ignoreBOM: true` KEEPS a leading byte-order mark in the string rather than consuming it, so the
 * save writes it back and the file stays byte-identical. Every string this returns re-encodes to
 * exactly the bytes it came from — that is the whole contract, and `editor-text.test.ts` asserts it
 * over the bytes.
 */
export function decodeUtf8Lossless(buf: Uint8Array): string | null {
  try {
    // A fresh decoder per call: a fatal decoder that has thrown is not a thing to keep state in.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf)
  } catch {
    return null
  }
}
