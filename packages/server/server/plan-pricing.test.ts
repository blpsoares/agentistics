import { describe, test, expect } from 'bun:test'
import { htmlToText, monthlyPriceNear, parseAnthropicPlans, parseCopilotPlans } from './plan-pricing'

/**
 * The fixtures below are the REAL text patterns from the vendors' pages, verified on 2026-08-12.
 * They are kept verbatim on purpose: every awkward thing in the parser is here because of one of
 * these, and a prettified fixture would let the parser regress while the tests stayed green.
 */
const anthropicPage = `
  <nav>Pricing Individual Team &amp; Enterprise API</nav>
  <div><h3>Free</h3><p>$0 Free for everyone</p></div>
  <div><h3>Pro</h3><p>For everyday productivity $17 Per month with annual subscription
     discount ( $200 billed up front). $20 if billed monthly.</p></div>
  <div><h3>Max</h3><p>Get the most out of Claude From $100 Per month</p></div>
  <div><h4>Standard seat</h4><p>All Claude features, plus more usage than Pro*
     $20 Per seat / month if billed annually. $25 if billed monthly.</p></div>
`
const copilotPage = `
  <nav>Product Solutions Resources Open Source Enterprise Pricing</nav>
  <li><h2>Free</h2><p>$ 0 USD Get started</p></li>
  <li><h2>Pro</h2><p>For everyday coding with agents. $ 10 USD per user / month Get started</p></li>
  <li><h2>Pro+</h2><p>For more complex development. $ 39 USD per user / month Get started</p></li>
  <li><h2>Max</h2><p>For sustained, high-volume workflows. $ 100 USD per user / month Get started</p></li>
`

describe('htmlToText', () => {
  test('drops tags, scripts and styles and collapses whitespace', () => {
    expect(htmlToText('<style>a{}</style><script>var x=1</script><p>Pro</p>\n\n  <b>$20</b>')).toBe('Pro $20')
  })

  test('decodes the entities these pages actually use', () => {
    expect(htmlToText('<p>Team&nbsp;&amp;&nbsp;Enterprise</p>')).toBe('Team & Enterprise')
  })
})

describe('monthlyPriceNear', () => {
  test('the ANNUAL price listed first is not mistaken for the monthly one', () => {
    // The exact trap on claude.com. Taking the first amount reports $17 as the monthly price.
    const text = 'Pro For everyday productivity $17 Per month with annual subscription discount ( $200 billed up front). $20 if billed monthly.'
    expect(monthlyPriceNear(text, 'Pro')).toEqual({ amount: 20, currency: 'USD' })
  })

  test('a qualifier belonging to the NEXT amount is never claimed by this one', () => {
    // Without the next-`$` boundary, "$200 billed up front" sees the "$20 if billed monthly" that
    // follows and reports the up-front annual total as the monthly price — ten times over.
    const text = 'Seat $200 billed up front. $20 if billed monthly.'
    expect(monthlyPriceNear(text, 'Seat')?.amount).toBe(20)
  })

  test('the label matches on word boundaries, so navigation does not hijack it', () => {
    // `indexOf('pro')` finds "Product" in GitHub's nav, hundreds of characters before any card.
    const text = 'Product Solutions Pricing Pro For everyday coding $10 per month'
    expect(monthlyPriceNear(text, 'Pro')?.amount).toBe(10)
  })

  test('reads the currency from the page and understands both conventions', () => {
    // These pages are geolocalized; a Brazilian request gets reais and Portuguese.
    expect(monthlyPriceNear('Pro R$ 110,00 por mês', 'Pro')).toEqual({ amount: 110, currency: 'BRL' })
    expect(monthlyPriceNear('Pro R$ 1.234,56 por mês', 'Pro')?.amount).toBeCloseTo(1234.56, 9)
    expect(monthlyPriceNear('Pro $1,234.56 per month', 'Pro')?.amount).toBeCloseTo(1234.56, 9)
  })

  test('an annual qualifier in Portuguese is refused too', () => {
    expect(monthlyPriceNear('Pro R$ 90,00 por mês na assinatura anual. R$ 110,00 mensal.', 'Pro')?.amount).toBe(110)
  })

  test('an amount with no period qualifier at all is not a monthly price', () => {
    expect(monthlyPriceNear('Pro $200 billed up front. Learn more', 'Pro')).toBeNull()
  })

  test('a missing label yields null, never a guess', () => {
    expect(monthlyPriceNear('Pro $20 per month', 'Enterprise')).toBeNull()
  })
})

describe('parseAnthropicPlans', () => {
  test('reads the MONTHLY Pro and seat prices', () => {
    const out = parseAnthropicPlans(anthropicPage)
    expect(out.find(p => p.planId === 'anthropic-pro')).toMatchObject({ amount: 20, currency: 'USD' })
    expect(out.find(p => p.planId === 'anthropic-team')).toMatchObject({ amount: 25, currency: 'USD' })
    expect(out[0]!.source).toContain('claude.com')
  })

  test('never returns a Max price — the page publishes none per tier', () => {
    // It gives one "From $100" for the whole tier. Reading that floor as the 5x price is an
    // inference the user cannot audit; attaching it to 20x is simply wrong.
    expect(parseAnthropicPlans(anthropicPage).some(p => p.planId.includes('max'))).toBe(false)
  })

  test('a redesign that moves the anchor yields NOTHING, not half-right numbers', () => {
    expect(parseAnthropicPlans(anthropicPage.replace('$20 if billed monthly', '$24 if billed monthly'))).toEqual([])
  })

  test('junk yields nothing rather than throwing', () => {
    for (const bad of ['', '<html></html>', 'not a pricing page at all']) {
      expect(parseAnthropicPlans(bad)).toEqual([])
    }
  })
})

describe('parseCopilotPlans', () => {
  test('reads every published tier when the anchor holds', () => {
    const by = Object.fromEntries(parseCopilotPlans(copilotPage).map(p => [p.planId, p.amount]))
    expect(by['copilot-pro']).toBe(10)
    expect(by['copilot-pro-plus']).toBe(39)
    expect(by['copilot-max']).toBe(100)
  })

  test('Pro+ is matched before Pro, so they never share a figure', () => {
    const out = parseCopilotPlans(copilotPage)
    expect(out.find(p => p.planId === 'copilot-pro')!.amount)
      .not.toBe(out.find(p => p.planId === 'copilot-pro-plus')!.amount)
  })

  test('never returns Business or Enterprise — the page states no figure', () => {
    expect(parseCopilotPlans(copilotPage).some(p => /business|enterprise/.test(p.planId))).toBe(false)
  })

  test('a moved anchor rejects the whole page', () => {
    expect(parseCopilotPlans(copilotPage.replace('$ 10 USD', '$ 12 USD'))).toEqual([])
  })
})

describe('the guarantee', () => {
  test('every returned price is finite, positive and carries its source', () => {
    for (const out of [parseAnthropicPlans(anthropicPage), parseCopilotPlans(copilotPage)]) {
      expect(out.length).toBeGreaterThan(0)
      for (const p of out) {
        expect(Number.isFinite(p.amount)).toBe(true)
        expect(p.amount).toBeGreaterThan(0)
        expect(p.source.startsWith('http')).toBe(true)
        expect(['USD', 'BRL']).toContain(p.currency)
      }
    }
  })
})
