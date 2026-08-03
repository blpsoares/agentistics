/**
 * pricing-official.ts — read OpenAI's and Google's own pricing pages.
 *
 * Both pages publish the SAME model several times at different rates: OpenAI has 16 tables
 * (Standard / Batch / Flex / Priority) and Google repeats a four-table block per model. Batch is
 * half price and Priority is double, so picking the wrong block silently halves or doubles every
 * cost — the exact failure that had `gpt-5.6-terra` billed at half its rate.
 *
 * Neither page marks the standard block in a way that survives HTML changes, so parsing here is
 * ANCHORED: a block is accepted only if a model whose price we have independently verified comes
 * out at the expected figure. A page redesign that shifts the tables therefore yields nothing and
 * the caller falls back, instead of yielding numbers that look plausible and are half wrong.
 */
import type { PriceEntry } from '@agentistics/core'

const strip = (html: string): string =>
  html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

const tablesOf = (html: string): string[] => html.match(/<table[\s\S]*?<\/table>/gi) ?? []
const rowsOf = (table: string): string[] => table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []
/** Cells, positionally. Counting dollar signs instead loses the column when a cell holds "-",
 *  which is how OpenAI writes "no cache-write charge" — and then output is read out of the
 *  wrong column. */
const cellsOf = (row: string): string[] =>
  [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => strip(m[1]!))
/** The dollar amount in a single cell, or null for "-", "Free of charge", "Not available". */
const cellAmount = (cell: string): number | null => {
  const m = /\$\s?([\d,]+(?:\.\d+)?)/.exec(cell)
  return m ? Number(m[1]!.replace(/,/g, '')) : null
}
const dollars = (text: string): number[] =>
  [...text.matchAll(/\$\s?([\d,]+(?:\.\d+)?)/g)].map(m => Number(m[1]!.replace(/,/g, '')))

/** Verified 2026-07-27 against each vendor's own page. A parsed block must reproduce these. */
const OPENAI_ANCHOR = { model: 'gpt-5.5', input: 5, output: 30 }
const GOOGLE_ANCHOR = { model: 'gemini-3.6-flash', input: 1.5, output: 7.5 }

const closeEnough = (a: number, b: number): boolean => Math.abs(a - b) < 0.001

// ---------------------------------------------------------------------------------------------
// OpenAI — one row per model. Columns start: input, cached input, cache write, output.
// ---------------------------------------------------------------------------------------------

export function parseOpenAiPricing(html: string): Record<string, PriceEntry> | null {
  for (const table of tablesOf(html)) {
    const parsed: Record<string, PriceEntry> = {}
    for (const row of rowsOf(table)) {
      const cells = cellsOf(row)
      if (cells.length < 5) continue
      const id = /^((?:gpt|o[134]|chatgpt)[\w.\-]*)$/.exec(cells[0]!)?.[1]
      if (!id) continue
      // Columns: model | input | cached input | cache write | output | (further tiers ignored).
      const input = cellAmount(cells[1]!)
      const cacheRead = cellAmount(cells[2]!)
      const cacheWrite = cellAmount(cells[3]!)
      const output = cellAmount(cells[4]!)
      if (input === null || output === null || input <= 0 || output <= 0) continue
      parsed[id] = { input, output, cacheRead: cacheRead ?? input * 0.1, cacheWrite: cacheWrite ?? input }
    }
    const anchor = parsed[OPENAI_ANCHOR.model]
    if (anchor && closeEnough(anchor.input, OPENAI_ANCHOR.input) && closeEnough(anchor.output, OPENAI_ANCHOR.output)) {
      return Object.keys(parsed).length >= 3 ? parsed : null
    }
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// Google — a heading names the model, then one table per tier. The model's own name never appears
// inside its table, so the headings have to be walked in document order alongside the tables.
// ---------------------------------------------------------------------------------------------

const TIERS = new Set(['standard', 'batch', 'flex', 'priority'])

/** "Gemini 3.5 Flash-Lite" → "gemini-3.5-flash-lite", the id the harnesses report. */
export function googleModelId(heading: string): string | null {
  const t = heading.trim()
  if (!/^gemini[\s-]/i.test(t)) return null
  return t.toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-')
}

export function parseGooglePricing(html: string): Record<string, PriceEntry> | null {
  // Headings and tables interleaved, in the order they appear.
  const marks: Array<{ pos: number; kind: 'heading' | 'table'; text: string }> = []
  for (const m of html.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi)) {
    marks.push({ pos: m.index!, kind: 'heading', text: strip(m[1]!) })
  }
  for (const m of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    marks.push({ pos: m.index!, kind: 'table', text: m[0] })
  }
  marks.sort((a, b) => a.pos - b.pos)

  const parsed: Record<string, PriceEntry> = {}
  let model: string | null = null
  let tier: string | null = null

  for (const mark of marks) {
    if (mark.kind === 'heading') {
      const lower = mark.text.toLowerCase()
      if (TIERS.has(lower)) tier = lower
      else {
        const id = googleModelId(mark.text)
        if (id) { model = id; tier = null }
      }
      continue
    }
    // Only the standard tier is what a normal API call is billed at.
    if (!model || tier !== 'standard') continue

    let input = 0, output = 0, cacheRead = 0
    for (const row of rowsOf(mark.text)) {
      const text = strip(row)
      // The free-tier column reads "Free of charge" or "Not available"; the paid figure is the
      // first dollar amount on the row.
      const n = dollars(text)
      if (n.length === 0) continue
      if (/^input price/i.test(text)) input = n[0]!
      else if (/^output price/i.test(text)) output = n[0]!
      else if (/^context caching price/i.test(text)) cacheRead = n[0]!
    }
    if (input > 0 && output > 0) {
      parsed[model] = { input, output, cacheRead: cacheRead || input * 0.1, cacheWrite: input }
    }
    tier = null // one standard table per model
  }

  const anchor = parsed[GOOGLE_ANCHOR.model]
  if (!anchor || !closeEnough(anchor.input, GOOGLE_ANCHOR.input) || !closeEnough(anchor.output, GOOGLE_ANCHOR.output)) {
    return null
  }
  return Object.keys(parsed).length >= 3 ? parsed : null
}

// ---------------------------------------------------------------------------------------------

async function fetchAndParse(
  url: string,
  parse: (html: string) => Record<string, PriceEntry> | null,
  label: string,
): Promise<Record<string, PriceEntry> | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; agentistics/1.0; +https://github.com)' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null
    const parsed = parse(await res.text())
    if (!parsed) {
      console.warn(`[rates] ${label} pricing did not match its anchor — ignoring this fetch`)
      return null
    }
    return parsed
  } catch (err) {
    console.warn(`[rates] ${label} pricing fetch failed:`, String(err))
    return null
  }
}

export const OPENAI_PRICING_URL = 'https://developers.openai.com/api/docs/pricing'
export const GOOGLE_PRICING_URL = 'https://ai.google.dev/gemini-api/docs/pricing'

export function fetchOpenAiPricing(): Promise<Record<string, PriceEntry> | null> {
  return fetchAndParse(OPENAI_PRICING_URL, parseOpenAiPricing, 'OpenAI')
}

export function fetchGooglePricing(): Promise<Record<string, PriceEntry> | null> {
  return fetchAndParse(GOOGLE_PRICING_URL, parseGooglePricing, 'Google')
}
