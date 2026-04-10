#!/usr/bin/env bun
/**
 * Embeds the Vite build output (dist/) into a TypeScript module so that
 * the compiled binary can serve the frontend without any external files.
 *
 * Run after `bun run build`:
 *   bun run scripts/embed-dist.ts
 */

import { readdir, readFile, stat } from 'fs/promises'
import { join, relative } from 'path'

const ROOT = new URL('..', import.meta.url).pathname
const distDir = join(ROOT, 'dist')
const outputFile = join(ROOT, 'src', 'embedded-dist.generated.ts')

async function* walkDir(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walkDir(fullPath)
    } else {
      yield fullPath
    }
  }
}

function getContentType(filename: string): string {
  if (filename.endsWith('.html')) return 'text/html; charset=utf-8'
  if (filename.endsWith('.js') || filename.endsWith('.mjs')) return 'application/javascript'
  if (filename.endsWith('.css')) return 'text/css'
  if (filename.endsWith('.json')) return 'application/json'
  if (filename.endsWith('.svg')) return 'image/svg+xml'
  if (filename.endsWith('.png')) return 'image/png'
  if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) return 'image/jpeg'
  if (filename.endsWith('.ico')) return 'image/x-icon'
  if (filename.endsWith('.woff')) return 'font/woff'
  if (filename.endsWith('.woff2')) return 'font/woff2'
  if (filename.endsWith('.ttf')) return 'font/ttf'
  if (filename.endsWith('.txt')) return 'text/plain; charset=utf-8'
  return 'application/octet-stream'
}

const TEXT_EXTS = new Set([
  '.html', '.js', '.mjs', '.cjs', '.css', '.json', '.svg',
  '.txt', '.xml', '.map',
])

function isText(filename: string): boolean {
  return [...TEXT_EXTS].some(ext => filename.endsWith(ext))
}

// ── Validate dist/ exists ──────────────────────────────────────────────────

const distStat = await stat(distDir).catch(() => null)
if (!distStat?.isDirectory()) {
  console.error('Error: dist/ not found. Run `bun run build` first.')
  process.exit(1)
}

// ── Read every file under dist/ ────────────────────────────────────────────

type EmbeddedAsset = {
  content: string
  contentType: string
  encoding: 'utf8' | 'base64'
}

const assets: Record<string, EmbeddedAsset> = {}
let count = 0
let totalBytes = 0

for await (const file of walkDir(distDir)) {
  const urlPath = '/' + relative(distDir, file).replace(/\\/g, '/')
  const contentType = getContentType(file)
  const raw = await readFile(file)
  totalBytes += raw.byteLength

  if (isText(file)) {
    assets[urlPath] = { content: raw.toString('utf-8'), contentType, encoding: 'utf8' }
  } else {
    assets[urlPath] = { content: raw.toString('base64'), contentType, encoding: 'base64' }
  }
  count++
}

// ── Write generated module ─────────────────────────────────────────────────

const output = `// AUTO-GENERATED — do not edit manually.
// Regenerate with: bun run build:assets  (requires \`bun run build\` first)

export type EmbeddedAsset = {
  content: string
  contentType: string
  encoding: 'utf8' | 'base64'
}

export const embeddedDist: Record<string, EmbeddedAsset> = ${JSON.stringify(assets, null, 2)}
`

await Bun.write(outputFile, output)

const kb = (totalBytes / 1024).toFixed(1)
console.log(`Embedded ${count} assets (${kb} KB) → src/embedded-dist.generated.ts`)
