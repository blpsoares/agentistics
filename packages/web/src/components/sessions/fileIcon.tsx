/**
 * fileIcon.tsx — the glyph beside a name in the repository tree: a `.ts` file wearing a TypeScript
 * mark, a `Dockerfile` wearing a whale, `.env` wearing a key.
 *
 * **NO ICON PACKAGE, and that is the whole design constraint.** `material-icon-theme` and friends
 * ship a few thousand SVGs; this web bundle is compiled into the `agentop` binary every user
 * downloads, and the task immediately before this one cut 6.9 MB out of Monaco for exactly that
 * reason. So the marks below are drawn HERE, inline, and only for extensions that actually occur in
 * a repository — about thirty glyphs, every one of them a handful of path commands.
 *
 * **THEY ARE DRAWN, NOT COPIED.** Unlike `HarnessMark.tsx`, which inlines vendor files recorded in
 * `public/harness/SOURCES.md`, nothing here is a vendor asset: each mark is a simplified silhouette
 * or a letter badge authored in this file to be recognisable at 13-16px — a shield for the
 * web-platform trio, a whale with containers for Docker, `{ }` for JSON. No copyrighted artwork is
 * reproduced. The HUES are the languages' own (GitHub Linguist's colours as the starting point,
 * deepened where a pale one would vanish on the light theme), because recognition is the entire
 * point: an icon in the app's own accent palette would be decoration, not information.
 *
 * **AN UNMAPPED EXTENSION GETS THE NEUTRAL GLYPH — never a near-miss.** `fileIconId` answers
 * `'file'`, which renders lucide's `File` in `--text-tertiary`: exactly the glyph this tree drew
 * before this module existed. A wrong icon is a statement about a file's contents, and the reader
 * cannot tell it from a right one; a neutral icon says nothing, which is the truth. Folders are the
 * same rule: they keep lucide's `Folder`/`FolderOpen` in the brand orange, unchanged, because those
 * two already read as the two states and lucide is the icon set the rest of this application uses.
 *
 * **THE RESOLUTION IS A PURE FUNCTION, and it is where the tests are.** `fileIconId(name, kind,
 * expanded)` takes a basename and returns an id; `ICONS` maps the id to a glyph. That split is what
 * lets `fileIcon.test.tsx` assert the parts that can be wrong — a compound name beating its own
 * extension (`docker-compose.yml` is Docker, not YAML), case-insensitivity, `.env.production`, and
 * that no id the resolver can return is missing a glyph — in a repo with no jsdom.
 */

import { File, Folder, FolderOpen } from 'lucide-react'
import type { ReactNode } from 'react'
import { contrastRatio } from '../../lib/monacoTheme'

// --- which glyph ---------------------------------------------------------------------------------

/**
 * Every glyph this module can draw. `'file'` is the fallback and `'folder'`/`'folder-open'` are the
 * two directory states; the rest are earned by a name.
 */
export type FileIconId =
  | 'file' | 'folder' | 'folder-open'
  | 'ts' | 'react' | 'js' | 'json' | 'markdown'
  | 'css' | 'sass' | 'less' | 'html'
  | 'config' | 'shell' | 'docker' | 'env' | 'lock' | 'git'
  | 'image' | 'svg'
  | 'python' | 'go' | 'rust' | 'java' | 'ruby' | 'php' | 'c' | 'cpp' | 'csharp' | 'sql' | 'text'

/** Whole basenames. Checked FIRST, so `.env` beats every extension rule. */
const BY_NAME: Record<string, FileIconId> = {
  'dockerfile': 'docker',
  '.dockerignore': 'docker',
  '.env': 'env',
  '.gitignore': 'git',
  '.gitattributes': 'git',
  '.gitmodules': 'git',
  '.gitconfig': 'git',
  '.gitkeep': 'git',
  'go.sum': 'lock',
  // A Makefile is a file of COMMANDS, so it wears the terminal rather than the sliders: `config` is
  // for a file that is read as settings, and a near-miss is the one thing this module must not do.
  'makefile': 'shell',
  '.editorconfig': 'config',
  '.npmrc': 'config',
  '.nvmrc': 'config',
  // `LICENSE` is deliberately ABSENT. It has no extension and it is not a `.txt`; a TXT badge on it
  // would be a claim about a format nobody declared, and the neutral glyph is the honest answer.
}

/** Extensions. The long tail of a repository, and the last thing consulted before the fallback. */
const BY_EXT: Record<string, FileIconId> = {
  ts: 'ts', mts: 'ts', cts: 'ts',
  tsx: 'react', jsx: 'react',
  js: 'js', mjs: 'js', cjs: 'js',
  json: 'json', jsonc: 'json',
  md: 'markdown', mdx: 'markdown',
  css: 'css', scss: 'sass', sass: 'sass', less: 'less',
  html: 'html', htm: 'html', vue: 'html', svelte: 'html',
  yml: 'config', yaml: 'config', toml: 'config', ini: 'config',
  conf: 'config', cfg: 'config', properties: 'config',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
  lock: 'lock',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
  avif: 'image', bmp: 'image', ico: 'image',
  svg: 'svg',
  py: 'python', go: 'go', rs: 'rust',
  java: 'java', kt: 'java',
  rb: 'ruby', php: 'php',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp',
  cs: 'csharp', sql: 'sql',
  txt: 'text', log: 'text', csv: 'text',
}

/**
 * A compound name whose own extension would answer WRONG: `docker-compose.yml` is a Docker file
 * that happens to be YAML, and `pnpm-lock.yaml` is a lockfile that happens to be YAML. A prefix
 * test, because the real ones in the wild carry a middle part (`docker-compose.override.yml`).
 *
 * `.env.*` is here for the same reason `monacoLanguage.ts` has it: the suffix of a dotenv file is an
 * environment NAME, so there is no list of them to enumerate — and the trailing dot is what keeps
 * `.envrc` (a shell script) and `.environment` out.
 */
function compoundIconId(base: string): FileIconId | null {
  if (base.startsWith('.env.')) return 'env'
  if (base.startsWith('dockerfile.') || base.startsWith('docker-compose')) return 'docker'
  if (base === 'compose.yml' || base === 'compose.yaml') return 'docker'
  // `package-lock.json`, `bun.lockb`, `Cargo.lock`, `Gemfile.lock`, `poetry.lock`, `uv.lock`…
  if (base.includes('-lock.') || base.endsWith('.lock') || base.endsWith('.lockb')) return 'lock'
  return null
}

/**
 * Which glyph one row gets. Pure; never throws; the basename only — a path says nothing about a
 * file's type that its own name does not.
 */
export function fileIconId(name: string, kind: 'file' | 'dir', expanded = false): FileIconId {
  if (kind === 'dir') return expanded ? 'folder-open' : 'folder'
  const base = (name.split('/').pop() ?? name).toLowerCase()
  const byName = BY_NAME[base]
  if (byName !== undefined) return byName
  const compound = compoundIconId(base)
  if (compound !== null) return compound
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return 'file'
  return BY_EXT[base.slice(dot + 1)] ?? 'file'
}

// --- the marks -----------------------------------------------------------------------------------

/**
 * The hues. GitHub Linguist's language colours where they are legible on BOTH of this app's
 * backgrounds (`#0a0a0f` and `#f4f4f7`), deepened where they are not — Linguist's JavaScript
 * `#f1e05a` and React `#61dafb` are pale enough to disappear on the light theme, so they are carried
 * down into mid-tone. Fixed in both themes on purpose: a mark whose colour follows the theme is no
 * longer the language's mark.
 */
const HUE = {
  ts: '#3178c6',
  react: '#2aa7c4',
  js: '#d6a400',
  json: '#c08b12',
  markdown: '#4a8ed6',
  css: '#2d6cb5',
  sass: '#cd6799',
  less: '#2f5d9e',
  html: '#e2642a',
  config: '#9a6cd4',
  shell: '#3f9c52',
  docker: '#1f8fd6',
  env: '#d1a02a',
  lock: '#8b8b94',
  git: '#e2683c',
  image: '#a169d8',
  svg: '#d98a2b',
  python: '#3572a5',
  go: '#1f9fc7',
  rust: '#c4763a',
  java: '#b07219',
  ruby: '#cc342d',
  php: '#6272a4',
  c: '#6a737d',
  cpp: '#d1527a',
  csharp: '#2f8f2f',
  sql: '#2f8f8f',
  text: '#8b8b94',
} as const satisfies Record<string, string>

/**
 * The ink on a letter badge: white when the badge is dark enough to carry it, near-black otherwise.
 *
 * `contrastRatio` is imported from `monacoTheme.ts` rather than re-derived. It is generic colour
 * arithmetic, the repo already has exactly one implementation of it, and a second one here would be
 * a second answer to "is this legible" — the duplication this codebase refuses elsewhere. The floor
 * is 3:1, the non-text/large-glyph floor: a badge letter at 13px is a SHAPE more than a word.
 */
function badgeInk(badge: string): string {
  return contrastRatio('#ffffff', badge) >= 3 ? '#ffffff' : '#15151a'
}

interface GlyphProps { size: number }

/** The frame every drawn mark shares: a 16-unit square, scaled to the row's glyph size. */
function Svg({ size, children }: GlyphProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {children}
    </svg>
  )
}

/**
 * A rounded badge carrying one or two (at most three) characters — the shape the eye reads as "a
 * file of this language" without any logo being involved, and the reason thirty glyphs did not have
 * to be thirty drawings.
 */
function LetterBadge({ size, label, badge }: GlyphProps & { label: string; badge: string }) {
  // Three characters have to give up width to fit between the badge's rounded corners.
  const fontSize = label.length >= 3 ? 5.6 : label.length === 2 ? 7 : 8.4
  return (
    <Svg size={size}>
      <rect x="1" y="2.2" width="14" height="11.6" rx="2.4" fill={badge} />
      <text
        x="8"
        y="8"
        fill={badgeInk(badge)}
        fontSize={fontSize}
        fontWeight="700"
        fontFamily="'Inter', -apple-system, 'Segoe UI', sans-serif"
        textAnchor="middle"
        dominantBaseline="central"
        // The letters are drawn type, not a label: the row's own text already names the file, and a
        // screen reader reading "TS" before every filename would be noise.
        aria-hidden="true"
      >
        {label}
      </text>
    </Svg>
  )
}

/** The web platform's shield silhouette — CSS, Sass, Less and HTML, one shape, four hues. */
function Shield({ size, hue }: GlyphProps & { hue: string }) {
  return (
    <Svg size={size}>
      <path d="M2.4 2h11.2l-1.1 10.2L8 14.5 3.5 12.2z" fill={hue} />
      {/* The lighter half is what makes it read as a shield rather than a blob at 13px. */}
      <path d="M8 3.6v9.4l3.2-1.6.8-7.8z" fill="#ffffff" opacity="0.22" />
    </Svg>
  )
}

/** React's atom: a nucleus and three orbits. `.tsx` wears it in TypeScript blue, `.jsx` in cyan. */
function Atom({ size, hue }: GlyphProps & { hue: string }) {
  return (
    <Svg size={size}>
      <circle cx="8" cy="8" r="1.6" fill={hue} />
      {[0, 60, 120].map(deg => (
        <ellipse
          key={deg}
          cx="8"
          cy="8"
          rx="6.4"
          ry="2.5"
          stroke={hue}
          strokeWidth="1"
          transform={`rotate(${deg} 8 8)`}
        />
      ))}
    </Svg>
  )
}

/** The Markdown mark: a framed `M` with the down-arrow beside it. */
function MarkdownMark({ size }: GlyphProps) {
  const hue = HUE.markdown
  return (
    <Svg size={size}>
      <rect x="0.8" y="3.4" width="14.4" height="9.2" rx="1.8" stroke={hue} strokeWidth="1.2" />
      <path
        d="M3.4 10.6V5.8l2.3 2.9 2.3-2.9v4.8"
        stroke={hue}
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M11.8 5.6v3.2" stroke={hue} strokeWidth="1.2" strokeLinecap="round" />
      <path d="M10.2 8.2h3.2l-1.6 2.4z" fill={hue} />
    </Svg>
  )
}

/** Two sliders — configuration, for the `.yml`/`.toml`/`.ini`/`Makefile` family. */
function Sliders({ size }: GlyphProps) {
  const hue = HUE.config
  return (
    <Svg size={size}>
      <path d="M2 5.4h3.2M8.4 5.4h5.6M2 10.6h5.6M10.8 10.6H14" stroke={hue} strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="6.8" cy="5.4" r="1.8" fill={hue} />
      <circle cx="9.2" cy="10.6" r="1.8" fill={hue} />
    </Svg>
  )
}

/** A terminal: the prompt and a line of input. */
function Terminal({ size }: GlyphProps) {
  const hue = HUE.shell
  return (
    <Svg size={size}>
      <rect x="1" y="2.4" width="14" height="11.2" rx="2.2" fill={hue} opacity="0.16" />
      <rect x="1" y="2.4" width="14" height="11.2" rx="2.2" stroke={hue} strokeWidth="1.1" />
      <path
        d="M4 6.2l2 1.9-2 1.9"
        stroke={hue}
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8 10.2h4" stroke={hue} strokeWidth="1.3" strokeLinecap="round" />
    </Svg>
  )
}

/** Docker: the whale, with its stack of containers. */
function Whale({ size }: GlyphProps) {
  const hue = HUE.docker
  return (
    <Svg size={size}>
      <g fill={hue}>
        <rect x="3.4" y="6.6" width="2.1" height="2.1" rx="0.3" />
        <rect x="5.9" y="6.6" width="2.1" height="2.1" rx="0.3" />
        <rect x="8.4" y="6.6" width="2.1" height="2.1" rx="0.3" />
        <rect x="5.9" y="4.1" width="2.1" height="2.1" rx="0.3" />
      </g>
      <path
        d="M1.2 9.4h11.4c.5 1.9-.7 3.8-3.5 3.8H5.2C3 13.2 1.4 11.8 1.2 9.4z"
        fill={hue}
      />
      {/* The spout, which is what makes the shape read as a whale and not a barge. */}
      <path d="M13.2 8.4c.8-.6 1.6-.3 2 .3" stroke={hue} strokeWidth="1.1" strokeLinecap="round" />
    </Svg>
  )
}

/** A key — `.env` and its variants. The file that holds secrets is the one worth spotting fast. */
function Key({ size }: GlyphProps) {
  const hue = HUE.env
  return (
    <Svg size={size}>
      <circle cx="5.2" cy="10.8" r="2.6" stroke={hue} strokeWidth="1.4" />
      <path d="M7.1 9 13 3.1" stroke={hue} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M10.2 5.9l1.5 1.5M11.6 4.5l1.5 1.5" stroke={hue} strokeWidth="1.4" strokeLinecap="round" />
    </Svg>
  )
}

/** A padlock — a lockfile is generated and not meant to be edited by hand. */
function Padlock({ size }: GlyphProps) {
  const hue = HUE.lock
  return (
    <Svg size={size}>
      <path d="M5.4 7.2V5.6a2.6 2.6 0 0 1 5.2 0v1.6" stroke={hue} strokeWidth="1.4" strokeLinecap="round" />
      <rect x="3" y="7" width="10" height="7" rx="1.8" fill={hue} />
    </Svg>
  )
}

/** A branch — the `.git*` files. */
function Branch({ size }: GlyphProps) {
  const hue = HUE.git
  return (
    <Svg size={size}>
      <path d="M4.6 3.4v6.4" stroke={hue} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M11.6 6.6a5 5 0 0 1-5 5" stroke={hue} strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="4.6" cy="3" r="1.9" fill={hue} />
      <circle cx="11.6" cy="4.8" r="1.9" fill={hue} />
      <circle cx="4.6" cy="12.4" r="1.9" fill={hue} />
    </Svg>
  )
}

/** A picture — raster images, and (in its own hue) SVG. */
function Picture({ size, hue }: GlyphProps & { hue: string }) {
  return (
    <Svg size={size}>
      <rect x="1.2" y="2.6" width="13.6" height="10.8" rx="2" fill={hue} opacity="0.18" />
      <rect x="1.2" y="2.6" width="13.6" height="10.8" rx="2" stroke={hue} strokeWidth="1.1" />
      <circle cx="5.3" cy="6.2" r="1.3" fill={hue} />
      <path d="M2.2 12.6l3.9-3.9 2.2 2.2 2.3-2.6 3.2 4.3z" fill={hue} />
    </Svg>
  )
}

/** `{ }` — JSON. */
function Braces({ size }: GlyphProps) {
  const hue = HUE.json
  return (
    <Svg size={size}>
      <path
        d="M6.6 2.8C5 2.8 5.6 7.2 3.7 8c1.9.8 1.3 5.2 2.9 5.2"
        stroke={hue}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M9.4 2.8c1.6 0 1 4.4 2.9 5.2-1.9.8-1.3 5.2-2.9 5.2"
        stroke={hue}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </Svg>
  )
}

/**
 * Id → glyph. A `Record`, so a new `FileIconId` is a compile error here until it is drawn — the same
 * reason `HARNESS_CAPABILITIES` is one.
 */
const ICONS: Record<FileIconId, (size: number) => ReactNode> = {
  // The two delegated families. See the header: these are the glyphs the tree already used, and the
  // ones the rest of the application uses for the same two ideas.
  file: size => <File size={size} />,
  folder: size => <Folder size={size} />,
  'folder-open': size => <FolderOpen size={size} />,

  ts: size => <LetterBadge size={size} label="TS" badge={HUE.ts} />,
  react: size => <Atom size={size} hue={HUE.react} />,
  js: size => <LetterBadge size={size} label="JS" badge={HUE.js} />,
  json: size => <Braces size={size} />,
  markdown: size => <MarkdownMark size={size} />,

  css: size => <Shield size={size} hue={HUE.css} />,
  sass: size => <Shield size={size} hue={HUE.sass} />,
  less: size => <Shield size={size} hue={HUE.less} />,
  html: size => <Shield size={size} hue={HUE.html} />,

  config: size => <Sliders size={size} />,
  shell: size => <Terminal size={size} />,
  docker: size => <Whale size={size} />,
  env: size => <Key size={size} />,
  lock: size => <Padlock size={size} />,
  git: size => <Branch size={size} />,

  image: size => <Picture size={size} hue={HUE.image} />,
  svg: size => <Picture size={size} hue={HUE.svg} />,

  python: size => <LetterBadge size={size} label="PY" badge={HUE.python} />,
  go: size => <LetterBadge size={size} label="GO" badge={HUE.go} />,
  rust: size => <LetterBadge size={size} label="RS" badge={HUE.rust} />,
  java: size => <LetterBadge size={size} label="JV" badge={HUE.java} />,
  ruby: size => <LetterBadge size={size} label="RB" badge={HUE.ruby} />,
  php: size => <LetterBadge size={size} label="PHP" badge={HUE.php} />,
  c: size => <LetterBadge size={size} label="C" badge={HUE.c} />,
  cpp: size => <LetterBadge size={size} label="C++" badge={HUE.cpp} />,
  csharp: size => <LetterBadge size={size} label="C#" badge={HUE.csharp} />,
  sql: size => <LetterBadge size={size} label="SQL" badge={HUE.sql} />,
  text: size => <LetterBadge size={size} label="TXT" badge={HUE.text} />,
}

/** Every id, for the test that proves each of them draws something. */
export const FILE_ICON_IDS = Object.keys(ICONS) as FileIconId[]

export interface FileIconProps {
  /** The file or directory's own name (a full path works too — only the basename is read). */
  name: string
  kind: 'file' | 'dir'
  /** Directories only; ignored for a file. */
  expanded?: boolean
  size?: number
}

/**
 * The glyph for one row.
 *
 * The COLOUR is the mark's own, except for the three delegated glyphs, which inherit `currentColor`
 * from the row — so an unmapped file stays `--text-tertiary` and a folder stays the brand orange,
 * exactly as they were. A caller therefore sets the fallback colour by setting its own, and sets
 * nothing for a mapped file.
 */
export function FileIcon({ name, kind, expanded = false, size = 13 }: FileIconProps) {
  return <>{ICONS[fileIconId(name, kind, expanded)](size)}</>
}
