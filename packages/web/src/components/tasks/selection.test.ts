import { describe, expect, it } from 'bun:test'
import {
  clearTicks, escapeLeavesMode, groupCheck, leaveMode, NO_SELECTION, selectedVisible, setRows,
  toggleMode, toggleRow,
} from './selection'

const on = () => toggleMode(NO_SELECTION)

describe('selection mode', () => {
  it('starts OFF, and a row cannot be ticked while the checkboxes are hidden', () => {
    expect(NO_SELECTION.on).toBe(false)
    expect(toggleRow(NO_SELECTION, 'a')).toBe(NO_SELECTION)
    expect(setRows(NO_SELECTION, ['a', 'b'], true)).toBe(NO_SELECTION)
  })

  it('turning it on shows the checkboxes with nothing ticked', () => {
    const s = on()
    expect(s.on).toBe(true)
    expect(s.ids.size).toBe(0)
  })

  it('turning it OFF clears every tick — a selection nobody can see must not survive', () => {
    const ticked = toggleRow(toggleRow(on(), 'a'), 'b')
    expect(ticked.ids.size).toBe(2)
    const off = toggleMode(ticked)
    expect(off.on).toBe(false)
    expect(off.ids.size).toBe(0)
    // and coming back on starts empty, not with yesterday's ticks
    expect(toggleMode(off).ids.size).toBe(0)
    expect(leaveMode().ids.size).toBe(0)
  })

  it('ticks and unticks one row, and a whole group at once', () => {
    let s = toggleRow(on(), 'a')
    expect(s.ids.has('a')).toBe(true)
    s = toggleRow(s, 'a')
    expect(s.ids.has('a')).toBe(false)
    s = setRows(s, ['a', 'b', 'c'], true)
    expect([...s.ids].sort()).toEqual(['a', 'b', 'c'])
    s = setRows(s, ['a', 'b'], false)
    expect([...s.ids]).toEqual(['c'])
  })

  it('never mutates the previous state', () => {
    const s = on()
    toggleRow(s, 'a')
    expect(s.ids.size).toBe(0)
  })

  it('a completed batch verb clears the ticks but stays in the mode', () => {
    const s = clearTicks(toggleRow(on(), 'a'))
    expect(s.on).toBe(true)
    expect(s.ids.size).toBe(0)
    expect(clearTicks(NO_SELECTION)).toBe(NO_SELECTION)
  })

  it('the selection that ACTS is the one on screen', () => {
    const s = setRows(on(), ['a', 'hidden', 'gone'], true)
    expect(selectedVisible(s, ['a', 'b'])).toEqual(['a'])
    // mode off → nothing acts, whatever is stored
    expect(selectedVisible({ on: false, ids: new Set(['a']) }, ['a'])).toEqual([])
  })

  it('reports a group checkbox as all / some / none', () => {
    const s = setRows(on(), ['a', 'b'], true)
    expect(groupCheck(s, ['a', 'b'])).toBe('all')
    expect(groupCheck(s, ['a', 'b', 'c'])).toBe('some')
    expect(groupCheck(s, ['x'])).toBe('none')
    expect(groupCheck(s, [])).toBe('none')
    expect(groupCheck(NO_SELECTION, ['a'])).toBe('none')
  })

  it('Escape leaves the mode, unless it was meant for a text field or already handled', () => {
    const s = on()
    const esc = { key: 'Escape', defaultPrevented: false }
    expect(escapeLeavesMode(s, esc)).toBe(true)
    expect(escapeLeavesMode(s, { ...esc, targetTag: 'INPUT' })).toBe(false) // no type = text
    expect(escapeLeavesMode(s, { ...esc, targetTag: 'INPUT', targetType: 'search' })).toBe(false)
    expect(escapeLeavesMode(s, { ...esc, targetTag: 'textarea' })).toBe(false)
    // focus is on a CHECKBOX right after a row is ticked — that is not a text field
    expect(escapeLeavesMode(s, { ...esc, targetTag: 'INPUT', targetType: 'checkbox' })).toBe(true)
    expect(escapeLeavesMode(s, { ...esc, targetTag: 'BUTTON' })).toBe(true)
    expect(escapeLeavesMode(s, { ...esc, targetEditable: true })).toBe(false)
    expect(escapeLeavesMode(s, { ...esc, defaultPrevented: true })).toBe(false)
    expect(escapeLeavesMode(s, { key: 'Enter', defaultPrevented: false })).toBe(false)
    expect(escapeLeavesMode(NO_SELECTION, esc)).toBe(false)
  })
})
