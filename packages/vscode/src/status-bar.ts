/**
 * status-bar.ts — today's spend, and how many sessions are waiting on a person.
 *
 * Two numbers with two different refresh rates, on purpose. The fleet is polled every 5 seconds
 * (the cockpit's own interval, so the two stay in step) and is a few kilobytes. `/api/data` is the
 * whole metrics payload — megabytes on a well-used machine — so it is re-read on a much slower
 * timer that the user can lengthen. Polling the large one at the small one's rate would spend a
 * megabyte a minute to move a figure that changes once a turn.
 *
 * **An unreachable server prints a sentence, never a zero.** `R$ 0,00` from a machine whose server
 * is not running is a confident, wrong answer to the one question this item exists to answer — the
 * same N/A-versus-a-real-0 rule the dashboard applies to a harness that cannot produce a metric.
 */

import * as vscode from 'vscode'
import { fill } from './i18n'
import { shortTokens, type TodayTotals } from './today'

export class StatusBar {
  private readonly item: vscode.StatusBarItem
  private totals: TodayTotals | null = null
  /** `null` until the first read has come back — "not asked yet" is not "no answer". */
  private read = false
  private attention = 0

  constructor(private strings: Record<string, string>) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
    this.item.command = 'agentistics.openDashboard'
    this.item.name = 'Agentistics'
  }

  setStrings(strings: Record<string, string>): void {
    this.strings = strings
    this.render()
  }

  setTotals(totals: TodayTotals | null): void {
    this.totals = totals
    this.read = true
    this.render()
  }

  setAttention(count: number): void {
    this.attention = count
    this.render()
  }

  show(visible: boolean): void {
    if (visible) this.item.show()
    else this.item.hide()
  }

  dispose(): void {
    this.item.dispose()
  }

  private render(): void {
    const waiting = this.attention > 0
      ? ` $(bell-dot) ${fill(this.strings.statusWaiting ?? '{0}', this.attention)}`
      : ''

    if (!this.read || !this.totals) {
      // Before the first answer, and after one that never came, the item says what it does not
      // know. The waiting count still shows: it comes from the other, cheaper, poll.
      this.item.text = `$(pulse) ${this.strings.statusUnknown ?? '—'}${waiting}`
      this.item.tooltip = this.strings.statusTitle ?? 'Agentistics'
      // Amber, not red: a server that is not running is not a fault, it is a machine at rest.
      this.item.backgroundColor = this.attention > 0
        ? new vscode.ThemeColor('statusBarItem.warningBackground')
        : undefined
      return
    }

    const cost = this.totals.costUSD.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    })
    this.item.text = `$(pulse) ${fill(
      this.strings.statusToday ?? '{0} {1} {2}',
      cost,
      shortTokens(this.totals.tokens),
      this.totals.sessions,
    )}${waiting}`
    this.item.tooltip = this.strings.statusTitle ?? 'Agentistics'
    this.item.backgroundColor = this.attention > 0
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined
  }
}
