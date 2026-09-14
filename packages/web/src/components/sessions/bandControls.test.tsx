import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { BAND_CONTROL_H, BandLabeledButton, BandSegment, BandSegmentTab } from './bandControls'

/**
 * Design item 3 (screenshot 1: "the buttons are non-standard sizes and it is very confusing") —
 * the ONE thing this module exists to guarantee is that every control it exports renders at the
 * SAME height. A live browser pass measures the real `getBoundingClientRect()`; this file pins the
 * STYLE STRINGS that measurement depends on, so a future edit that reintroduces a mismatch (a
 * `minHeight` swapped back in for `height`, a wrapper's padding added back on top of its own fixed
 * height) fails here before it ever needs a browser to catch.
 */

describe('every desktop control renders the same height', () => {
  test('BandLabeledButton', () => {
    const html = renderToStaticMarkup(
      <BandLabeledButton label="Move to the right" visibleText="Move to the right" isMobile={false} onClick={() => {}}>
        <span />
      </BandLabeledButton>,
    )
    expect(html).toContain(`height:${BAND_CONTROL_H}px`)
    expect(html).toContain('box-sizing:border-box')
  })

  test('BandSegment (the wrapper itself, not just its tabs)', () => {
    const html = renderToStaticMarkup(
      <BandSegment label="Which terminal" isMobile={false}><span /></BandSegment>,
    )
    expect(html).toContain(`height:${BAND_CONTROL_H}px`)
    expect(html).toContain('box-sizing:border-box')
  })

  // Plant: drop `boxSizing: 'border-box'` from `BandSegment`'s style (revert to the original defect
  // — a content-sized wrapper whose padding is ADDED on top of its children's height, measuring
  // taller than the pills beside it). This test would then still find `height:26px` in the markup
  // (the property survives) but the ACTUAL rendered box no longer equals it — which is exactly why
  // the browser pass, not only this string check, is what item 3's verification asks for. This test
  // instead guards the one thing a unit test CAN prove: the property is still there at all.
  test('mobile targets are 44px on every one of them, never 26px', () => {
    const labeled = renderToStaticMarkup(
      <BandLabeledButton label="x" visibleText="x" isMobile={true} onClick={() => {}}><span /></BandLabeledButton>,
    )
    const segment = renderToStaticMarkup(<BandSegment label="x" isMobile={true}><span /></BandSegment>)
    for (const html of [labeled, segment]) {
      expect(html).toContain('height:44px')
      expect(html).not.toContain(`height:${BAND_CONTROL_H}px`)
    }
  })

  test('BandSegmentTab fills the wrapper via height:100%, never a second fixed number', () => {
    const html = renderToStaticMarkup(
      <BandSegmentTab on={false} onClick={() => {}} label="Shell" />,
    )
    expect(html).toContain('height:100%')
  })
})

describe('BandSegmentTab — on/off styling matches the band segment\'s own visual language', () => {
  test('on: bg-surface / text-primary, role="tab" aria-selected="true"', () => {
    const html = renderToStaticMarkup(<BandSegmentTab on={true} onClick={() => {}} label="Shell" />)
    expect(html).toContain('role="tab"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('background:var(--bg-surface)')
    expect(html).toContain('color:var(--text-primary)')
  })

  test('off: transparent / text-tertiary, aria-selected="false"', () => {
    const html = renderToStaticMarkup(<BandSegmentTab on={false} onClick={() => {}} label="Shell" />)
    expect(html).toContain('aria-selected="false"')
    expect(html).toContain('background:transparent')
    expect(html).toContain('color:var(--text-tertiary)')
  })
})

describe('BandLabeledButton — pressed is optional, and only rendered when given', () => {
  test('omitted entirely: no aria-pressed attribute at all', () => {
    const html = renderToStaticMarkup(
      <BandLabeledButton label="x" visibleText="x" isMobile={false} onClick={() => {}}><span /></BandLabeledButton>,
    )
    expect(html).not.toContain('aria-pressed')
  })

  test('given: renders the exact boolean', () => {
    const on = renderToStaticMarkup(
      <BandLabeledButton label="x" visibleText="x" isMobile={false} onClick={() => {}} pressed={true}><span /></BandLabeledButton>,
    )
    const off = renderToStaticMarkup(
      <BandLabeledButton label="x" visibleText="x" isMobile={false} onClick={() => {}} pressed={false}><span /></BandLabeledButton>,
    )
    expect(on).toContain('aria-pressed="true"')
    expect(off).toContain('aria-pressed="false"')
  })
})
