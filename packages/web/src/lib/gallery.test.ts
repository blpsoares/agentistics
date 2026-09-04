import { describe, expect, it } from 'bun:test'
import {
  fileFormat, formatBytes, galleryFileCount, galleryGroups, galleryImages, type GalleryTurn,
} from './gallery'

const DIR = '/home/u/.agentistics/attachments'
const shot = `${DIR}/724e7aa8-image.png`
const other = `${DIR}/9f0b1c22-layout.png`
const notes = `${DIR}/aa11bb22-notes.txt`

function user(text: string, at?: string): GalleryTurn {
  return at ? { role: 'user', text, at } : { role: 'user', text }
}

describe('galleryGroups', () => {
  it('groups the files of one message together, keeping the words', () => {
    const groups = galleryGroups([
      user(`${shot}\n${other}\nnuma view menor ficou tudo empilhado ainda rs`, '2026-09-04T10:00:00Z'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.files.map(f => f.name)).toEqual(['724e7aa8-image.png', '9f0b1c22-layout.png'])
    expect(groups[0]!.text).toBe('numa view menor ficou tudo empilhado ainda rs')
    expect(groups[0]!.at).toBe('2026-09-04T10:00:00Z')
  })

  it('keeps a message that carried files and no words', () => {
    const groups = galleryGroups([user(shot)])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.text).toBe('')
    expect(groups[0]!.files).toHaveLength(1)
  })

  it('leaves a message with words and no files OUT of the gallery entirely', () => {
    expect(galleryGroups([user('roda os testes por favor')])).toEqual([])
  })

  it('gives the same file sent in two messages two entries', () => {
    const groups = galleryGroups([user(`${shot}\nolha isso`), user(`${shot}\ne agora?`)])
    expect(groups).toHaveLength(2)
    expect(groups[0]!.files[0]!.path).toBe(shot)
    expect(groups[1]!.files[0]!.path).toBe(shot)
  })

  it('carries the turn INDEX, so the anchor points at the bubble that was rendered', () => {
    const groups = galleryGroups([
      user('sem anexo'),
      { role: 'assistant', text: 'ok' },
      user(`${shot}\ncom anexo`),
    ])
    expect(groups.map(g => g.index)).toEqual([2])
  })

  it('keeps the transcript order', () => {
    const groups = galleryGroups([user(`${other}\nb`), user(`${shot}\na`)])
    expect(groups.map(g => g.files[0]!.name)).toEqual(['9f0b1c22-layout.png', '724e7aa8-image.png'])
  })

  it('never claims a turn nobody typed', () => {
    expect(galleryGroups([{ role: 'user', text: shot, system: 'reminder' }])).toEqual([])
    expect(galleryGroups([{ role: 'user', text: shot, task: { label: 'x', running: false } }])).toEqual([])
    expect(galleryGroups([{ role: 'assistant', text: shot }])).toEqual([])
  })

  it('marks a file that cannot be previewed rather than promising a thumbnail', () => {
    const groups = galleryGroups([user(`${notes}\nleia`)])
    expect(groups[0]!.files[0]).toEqual({
      path: notes, name: 'aa11bb22-notes.txt', image: false, format: 'TXT',
    })
  })

  it('omits `at` when the transcript carried none', () => {
    expect(galleryGroups([user(shot)])[0]!.at).toBeUndefined()
  })
})

describe('galleryImages', () => {
  it('flattens only the previewable ones, in reading order, each knowing its message', () => {
    const groups = galleryGroups([user(`${shot}\n${notes}\na`), user(`${other}\nb`)])
    const images = galleryImages(groups)
    expect(images.map(i => i.path)).toEqual([shot, other])
    expect(images[0]!.group.index).toBe(0)
    expect(images[1]!.group.index).toBe(1)
  })
})

describe('galleryFileCount', () => {
  it('counts files, not messages', () => {
    expect(galleryFileCount(galleryGroups([user(`${shot}\n${notes}\na`), user(`${other}\nb`)]))).toBe(3)
  })
})

describe('fileFormat', () => {
  it('reads the extension', () => {
    expect(fileFormat('a.PNG')).toBe('PNG')
    expect(fileFormat('a.tar.gz')).toBe('GZ')
  })
  it('says nothing when there is no extension to read', () => {
    expect(fileFormat('README')).toBe('')
    expect(fileFormat('.bashrc')).toBe('')
    expect(fileFormat('trailing.')).toBe('')
  })
})

describe('formatBytes', () => {
  it('scales', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(200 * 1024)).toBe('200 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })
  it('shows NOTHING for a size it does not have — never a zero', () => {
    expect(formatBytes(undefined)).toBe('')
    expect(formatBytes(Number.NaN)).toBe('')
    expect(formatBytes(-1)).toBe('')
  })
})
