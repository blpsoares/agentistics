/**
 * machineConsentView.ts — PURE: what a machine row says about session management.
 *
 * The central cannot read a machine's preferences and never asks. A machine ANNOUNCES its consent
 * over the reverse channel, the central holds it in memory for as long as the socket lives, and the
 * `/api/iam/machines` row carries it ONLY for the machine's own accounts (`machineOwnedBy`) — an
 * instance owner who is not this machine's user sees the field absent, not `null`.
 *
 * Four states, and the two that look alike are the reason this is its own module:
 *
 * - **absent** — you may not ask. The row says nothing at all.
 * - **`null`** — this machine has not said. Not a refusal: a machine that is off, or one running a
 *   build that predates the announcement, is silent in exactly the same way. Reporting silence as
 *   "this machine refuses" would send someone to a switch to change something already set.
 * - **`{sessions:false}`** — this machine says no. THAT is a refusal, and it names the switch.
 * - **`{sessions:true, …}`** — agreed, with or without the screen.
 *
 * `online` is threaded in because it is what separates the two readings of silence for a person:
 * an offline machine has an obvious reason not to have spoken, and a machine that is online and
 * still silent is the interesting case (an older build, or one that has not finished connecting).
 */

export interface MachineConsentFacts {
  sessions: boolean
  screens: boolean
  atMs: number
}

export type MachineConsentTone = 'granted' | 'refused' | 'silent'

export interface MachineConsentView {
  tone: MachineConsentTone
  /** Already-resolved sentence, EN/PT. Never an empty string — a state with no words is a state
   *  the reader has to guess at, and this one is about access to their machine. */
  text: string
  /** Whether the SCREEN half is in force. Only ever true under `granted`. */
  screens: boolean
  /** A few words for the dense desktop row, where the sentence does not fit. It is a LABEL, never
   *  the whole message — the full `text` rides along as the cell's title, and the mobile card
   *  prints it in full, because a table that can only be understood by hovering is a table a
   *  touch device cannot read at all. */
  short: string
}

/**
 * `consent === undefined` means the caller may not ask, and yields `null` — the row draws nothing.
 * That is deliberately distinct from `consent === null`, which is a machine that has not spoken and
 * DOES get a sentence.
 */
export function machineConsentView(
  consent: MachineConsentFacts | null | undefined,
  online: boolean,
  lang: 'en' | 'pt',
): MachineConsentView | null {
  if (consent === undefined) return null
  const pt = lang === 'pt'
  if (consent === null) {
    return {
      tone: 'silent',
      screens: false,
      short: online ? (pt ? 'não informou' : 'not said') : (pt ? 'offline' : 'offline'),
      text: online
        ? (pt
          ? 'Esta máquina ainda não informou se permite gerenciar sessões daqui.'
          : 'This machine has not said whether it allows session management from here.')
        : (pt
          ? 'Máquina offline — ela informa isso ao conectar.'
          : 'Machine offline — it says so when it connects.'),
    }
  }
  if (!consent.sessions) {
    return {
      tone: 'refused',
      screens: false,
      short: pt ? 'sessões: não' : 'sessions: no',
      text: pt
        ? 'Esta máquina não permite gerenciar sessões daqui.'
        : 'This machine does not allow session management from here.',
    }
  }
  return {
    tone: 'granted',
    screens: consent.screens,
    short: consent.screens
      ? (pt ? 'sessões + tela' : 'sessions + screen')
      : (pt ? 'sessões' : 'sessions'),
    text: consent.screens
      ? (pt
        ? 'Permite gerenciar sessões daqui, incluindo a tela da sessão.'
        : 'Allows session management from here, including the session screen.')
      : (pt
        ? 'Permite gerenciar sessões daqui. A tela da sessão não é enviada.'
        : 'Allows session management from here. The session screen is not sent.'),
  }
}
