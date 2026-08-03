import { test, expect } from 'bun:test'
import { parseOpenAiPricing, parseGooglePricing, googleModelId } from './pricing-official'

/** OpenAI publishes the same models four times over. Standard first, then Batch at half price —
 *  the shape that made picking "the first table" unsafe. Note the "-" cell: that is how the page
 *  writes "no cache-write charge", and counting dollar signs instead of cells reads the OUTPUT out
 *  of the wrong column. */
const OPENAI_HTML = `
<table><tbody>
  <tr><th>Model</th><th>Input</th><th>Cached</th><th>Cache write</th><th>Output</th></tr>
  <tr><td>gpt-5.5</td><td>$5.00</td><td>$0.50</td><td>-</td><td>$30.00</td><td>$10.00</td></tr>
  <tr><td>gpt-5.6-terra</td><td>$2.50</td><td>$0.25</td><td>$3.125</td><td>$15.00</td><td>$5.00</td></tr>
  <tr><td>gpt-5.4</td><td>$2.50</td><td>$0.25</td><td>$3.125</td><td>$15.00</td><td>$5.00</td></tr>
</tbody></table>
<table><tbody>
  <tr><td>gpt-5.5</td><td>$2.50</td><td>$0.25</td><td>-</td><td>$15.00</td></tr>
  <tr><td>gpt-5.6-terra</td><td>$1.25</td><td>$0.125</td><td>$1.5625</td><td>$7.50</td></tr>
  <tr><td>gpt-5.4</td><td>$1.25</td><td>$0.125</td><td>$1.5625</td><td>$7.50</td></tr>
</tbody></table>`

test('OpenAI: the standard table is taken and the half-price batch table ignored', () => {
  const p = parseOpenAiPricing(OPENAI_HTML)!
  expect(p['gpt-5.5']).toEqual({ input: 5, output: 30, cacheRead: 0.5, cacheWrite: 5 })
  expect(p['gpt-5.6-terra']!.input).toBe(2.5)
  expect(p['gpt-5.6-terra']!.output).toBe(15)
})

test('OpenAI: a "-" cell keeps the columns aligned', () => {
  // Counting dollar amounts would read $10.00 (the next tier's input) as gpt-5.5's output.
  expect(parseOpenAiPricing(OPENAI_HTML)!['gpt-5.5']!.output).toBe(30)
})

test('OpenAI: a page whose standard block moved yields nothing rather than half prices', () => {
  // Batch only. The anchor (gpt-5.5 at 5/30) never matches, so nothing is adopted.
  const batchOnly = OPENAI_HTML.slice(OPENAI_HTML.indexOf('<table', 10))
  expect(parseOpenAiPricing(batchOnly)).toBeNull()
})

test('OpenAI: junk yields null', () => {
  expect(parseOpenAiPricing('')).toBeNull()
  expect(parseOpenAiPricing('<table><tr><td>nope</td></tr></table>')).toBeNull()
})

/** Google names the model in a heading and repeats a table per tier underneath it. */
const GOOGLE_HTML = `
<h2>Gemini 3.6 Flash</h2>
<h3>Standard</h3>
<table><tbody>
  <tr><td>Input price</td><td>Free of charge</td><td>$1.50</td></tr>
  <tr><td>Output price (including thinking tokens)</td><td>Free of charge</td><td>$7.50</td></tr>
  <tr><td>Context caching price</td><td>Free of charge</td><td>$0.15</td></tr>
</tbody></table>
<h3>Batch</h3>
<table><tbody>
  <tr><td>Input price</td><td>Not available</td><td>$0.75</td></tr>
  <tr><td>Output price (including thinking tokens)</td><td>Not available</td><td>$3.75</td></tr>
</tbody></table>
<h2>Gemini 3.5 Flash-Lite</h2>
<h3>Standard</h3>
<table><tbody>
  <tr><td>Input price</td><td>Free of charge</td><td>$0.30</td></tr>
  <tr><td>Output price (including thinking tokens)</td><td>Free of charge</td><td>$2.50</td></tr>
  <tr><td>Context caching price</td><td>Free of charge</td><td>$0.03</td></tr>
</tbody></table>
<h2>Gemini 3.5 Flash</h2>
<h3>Standard</h3>
<table><tbody>
  <tr><td>Input price</td><td>Free of charge</td><td>$1.50</td></tr>
  <tr><td>Output price (including thinking tokens)</td><td>Free of charge</td><td>$9.00</td></tr>
</tbody></table>`

test('Google: each model takes its own standard table, not the batch one below it', () => {
  const p = parseGooglePricing(GOOGLE_HTML)!
  expect(p['gemini-3.6-flash']).toEqual({ input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 1.5 })
  expect(p['gemini-3.5-flash-lite']!.output).toBe(2.5)
  // Flash and Flash-Lite differ only in the suffix; mixing them up would misprice both.
  expect(p['gemini-3.5-flash']!.output).toBe(9)
})

test('Google: the free-tier column never becomes the price', () => {
  expect(parseGooglePricing(GOOGLE_HTML)!['gemini-3.6-flash']!.input).toBe(1.5)
})

test('Google: a page that no longer matches the anchor yields nothing', () => {
  const shifted = GOOGLE_HTML.replace('$1.50', '$99.00')
  expect(parseGooglePricing(shifted)).toBeNull()
})

test('googleModelId converts a heading to the id harnesses report', () => {
  expect(googleModelId('Gemini 3.5 Flash-Lite')).toBe('gemini-3.5-flash-lite')
  expect(googleModelId('Gemini 3.6 Flash')).toBe('gemini-3.6-flash')
  expect(googleModelId('Imagen 4')).toBeNull()
  expect(googleModelId('Standard')).toBeNull()
})
