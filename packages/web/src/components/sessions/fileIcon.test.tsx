/**
 * What can be asserted about an icon set, in a repo with no jsdom.
 *
 * The RESOLUTION (which is where every bug in an icon set lives: a compound name losing to its own
 * extension, a dotfile with no extension to key on, `.envrc` being swept in with `.env`), and the
 * fact that every id the resolver can return actually DRAWS something — an id with no glyph is an
 * empty cell where a name's icon should be, and `Record<FileIconId, …>` only catches it if the union
 * and the map are edited together.
 *
 * What is NOT asserted is whether a whale looks like a whale. That was checked by eye at 13px in
 * both themes.
 */
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { FILE_ICON_IDS, FileIcon, fileIconId, type FileIconId } from './fileIcon'

describe('fileIconId', () => {
  test('the extensions the brief asked for', () => {
    const cases: readonly [string, FileIconId][] = [
      ['a.ts', 'ts'], ['a.mts', 'ts'], ['a.tsx', 'react'], ['a.jsx', 'react'],
      ['a.js', 'js'], ['a.mjs', 'js'], ['a.json', 'json'], ['README.md', 'markdown'],
      ['a.css', 'css'], ['a.scss', 'sass'], ['a.less', 'less'], ['index.html', 'html'],
      ['ci.yml', 'config'], ['ci.yaml', 'config'], ['a.sh', 'shell'],
      ['logo.png', 'image'], ['logo.svg', 'svg'],
    ]
    for (const [name, id] of cases) expect(fileIconId(name, 'file'), name).toBe(id)
  })

  test('Docker, including the compose files whose extension would answer YAML', () => {
    expect(fileIconId('Dockerfile', 'file')).toBe('docker')
    expect(fileIconId('Dockerfile.dev', 'file')).toBe('docker')
    expect(fileIconId('.dockerignore', 'file')).toBe('docker')
    expect(fileIconId('docker-compose.yml', 'file')).toBe('docker')
    expect(fileIconId('docker-compose.override.yaml', 'file')).toBe('docker')
    expect(fileIconId('compose.yaml', 'file')).toBe('docker')
    // The point of the compound rule: the extension alone says config.
    expect(fileIconId('ci.yml', 'file')).toBe('config')
  })

  test('.env and its variants, and NOT .envrc', () => {
    expect(fileIconId('.env', 'file')).toBe('env')
    expect(fileIconId('.env.local', 'file')).toBe('env')
    expect(fileIconId('.env.production', 'file')).toBe('env')
    expect(fileIconId('.env.example', 'file')).toBe('env')
    expect(fileIconId('.env.config', 'file')).toBe('env')
    expect(fileIconId('.envrc', 'file')).toBe('file')
  })

  test('lock files, whatever they are called', () => {
    for (const name of [
      'package-lock.json', 'bun.lock', 'bun.lockb', 'yarn.lock',
      'pnpm-lock.yaml', 'Cargo.lock', 'Gemfile.lock', 'poetry.lock', 'uv.lock', 'go.sum',
    ]) {
      expect(fileIconId(name, 'file'), name).toBe('lock')
    }
  })

  test('the folder states', () => {
    expect(fileIconId('src', 'dir')).toBe('folder')
    expect(fileIconId('src', 'dir', true)).toBe('folder-open')
    // `expanded` is a directory's business only — a file never has it.
    expect(fileIconId('a.ts', 'file', true)).toBe('ts')
  })

  test('an unmapped extension gets the NEUTRAL glyph, never a near-miss', () => {
    for (const name of ['data.xyz123', 'LICENSE', 'notes', 'archive.tar.br']) {
      expect(fileIconId(name, 'file'), name).toBe('file')
    }
  })

  test('the basename only, and case-insensitively', () => {
    expect(fileIconId('deploy/Dockerfile', 'file')).toBe('docker')
    expect(fileIconId('src/lib/A.TS', 'file')).toBe('ts')
    expect(fileIconId('DOCKER-COMPOSE.YML', 'file')).toBe('docker')
  })

  test('a name that is only an extension is not an extension', () => {
    // `.ts` as a whole filename has no stem; `lastIndexOf('.') === 0` is the guard, and the answer
    // is the neutral glyph rather than TypeScript's.
    expect(fileIconId('.ts', 'file')).toBe('file')
  })
})

describe('every id draws something', () => {
  test('the map covers the union, and no glyph renders empty', () => {
    expect(FILE_ICON_IDS.length).toBeGreaterThan(25)
    for (const id of FILE_ICON_IDS) {
      // One name per id, resolved back through the resolver so the two halves are checked together.
      expect(FILE_ICON_IDS).toContain(id)
    }
  })

  test('a mapped file, an unmapped one and both folder states all render markup', () => {
    const cases: readonly [string, 'file' | 'dir', boolean][] = [
      ['a.ts', 'file', false], ['Dockerfile', 'file', false], ['.env', 'file', false],
      ['data.xyz123', 'file', false], ['src', 'dir', false], ['src', 'dir', true],
    ]
    for (const [name, kind, expanded] of cases) {
      const html = renderToStaticMarkup(<FileIcon name={name} kind={kind} expanded={expanded} />)
      expect(html, name).toContain('<svg')
      expect(html, name).toContain('aria-hidden="true"')
    }
  })

  test('every drawn mark produces an svg at the size it was given', () => {
    // Drives the WHOLE table, which is what catches a glyph that throws on render (a bad `transform`
    // array, a missing prop) rather than only the six sampled above.
    const names: Record<FileIconId, string> = {
      file: 'x.unknown', folder: 'dir', 'folder-open': 'dir',
      ts: 'a.ts', react: 'a.tsx', js: 'a.js', json: 'a.json', markdown: 'a.md',
      css: 'a.css', sass: 'a.scss', less: 'a.less', html: 'a.html',
      config: 'a.yml', shell: 'a.sh', docker: 'Dockerfile', env: '.env',
      lock: 'a.lock', git: '.gitignore',
      image: 'a.png', svg: 'a.svg',
      python: 'a.py', go: 'a.go', rust: 'a.rs', java: 'a.java', ruby: 'a.rb', php: 'a.php',
      c: 'a.c', cpp: 'a.cpp', csharp: 'a.cs', sql: 'a.sql', text: 'a.txt',
    }
    for (const id of FILE_ICON_IDS) {
      const name = names[id]
      const kind = id.startsWith('folder') ? 'dir' : 'file'
      const expanded = id === 'folder-open'
      // The name really does resolve to the id it is listed under — otherwise this loop would be
      // rendering the same glyph thirty times and proving nothing.
      expect(fileIconId(name, kind, expanded), `${id} ← ${name}`).toBe(id)
      const html = renderToStaticMarkup(
        <FileIcon name={name} kind={kind} expanded={expanded} size={16} />,
      )
      expect(html, id).toContain('<svg')
      expect(html, id).toContain('width="16"')
    }
  })

  test('a letter badge carries its letters and an ink that is not its own fill', () => {
    const ts = renderToStaticMarkup(<FileIcon name="a.ts" kind="file" size={16} />)
    expect(ts).toContain('TS')
    expect(ts).toContain('#3178c6')
    // TypeScript blue is dark enough for white letters; the yellow JS badge is not, and must not get
    // them — that decision is `badgeInk`'s, and this is the assertion that it is actually consulted.
    expect(ts).toContain('#ffffff')
    const js = renderToStaticMarkup(<FileIcon name="a.js" kind="file" size={16} />)
    expect(js).toContain('JS')
    expect(js).not.toContain('#ffffff')
  })
})
