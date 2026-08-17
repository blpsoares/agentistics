/**
 * hardwareNotice.ts — PURE: turning what the hardware probe COULD NOT measure into a sentence.
 *
 * The same rule `liveEmptyNotice` exists for, applied to a second surface: an empty list and an
 * absent number have several causes, and exactly one of them is "there is nothing". A confident
 * `0 active sessions` on a machine running six, or an `Off` badge on a daemon that is running
 * inside the very process answering the request, are not small inaccuracies — they are the reading
 * that makes the rest of the panel unbelievable.
 *
 * EN + PT, no React, so every branch is testable.
 */

export type ServiceRunState = 'running' | 'stopped' | 'unknown'
export type ServiceHosting = 'in-process' | 'separate'
export type HardwareSessionsReason = 'backend-unavailable' | 'read-failed'
export type HardwareSessionMetricsReason = 'no-proc' | 'no-pid' | 'first-sample'

export type Lang2 = 'pt' | 'en'

/** The badge over a service card: the word, and whether it should read as good, bad or unknown. */
export interface ServiceBadge {
  label: string
  tone: 'ok' | 'off' | 'unknown'
}

export function serviceBadge(state: ServiceRunState | undefined, lang: Lang2): ServiceBadge {
  const pt = lang === 'pt'
  // An older server sends no `state`. It also never sent a truthful one, so the honest reading of
  // its silence is "cannot tell" rather than a word this build would be inventing.
  if (state === undefined) return { label: pt ? 'Desconhecido' : 'Unknown', tone: 'unknown' }
  if (state === 'running') return { label: pt ? 'Em execução' : 'Running', tone: 'ok' }
  if (state === 'stopped') return { label: pt ? 'Parado' : 'Stopped', tone: 'off' }
  return { label: pt ? 'Não foi possível verificar' : 'Cannot tell', tone: 'unknown' }
}

/**
 * The sentence under a service card — why its numbers read as they do.
 *
 * `in-process` is the one that most needed saying: under `agentop server` the OTel watcher is an
 * import into the server's own process, so it has no pid, no CPU and no RSS of its own. Those
 * figures are not missing; they are the row above.
 */
export function serviceNote(
  o: { state?: ServiceRunState; hosting?: ServiceHosting; serverName: string },
  lang: Lang2,
): string | null {
  const pt = lang === 'pt'
  if (o.state === 'running' && o.hosting === 'in-process') {
    return pt
      ? `Roda dentro do processo ${o.serverName} — CPU e memória já contam ali.`
      : `Runs inside the ${o.serverName} process — its CPU and memory are counted there.`
  }
  if (o.state === 'unknown') {
    return pt
      ? 'Esta máquina não consegue ler a lista de processos, então um daemon separado seria invisível aqui.'
      : 'This machine cannot read the process list, so a separate daemon would be invisible here.'
  }
  if (o.state === 'stopped') {
    return pt
      ? 'Nenhum processo deste daemon foi encontrado, e ele não está rodando dentro deste servidor.'
      : 'No process for this daemon was found, and it is not running inside this server.'
  }
  return null
}

/** What the managed-sessions table says when it has no rows. `null` when it has some. */
export interface SessionsEmptyNotice {
  title: string
  detail: string
}

export function sessionsEmptyNotice(o: {
  count: number
  unavailable?: HardwareSessionsReason
  unavailableDetail?: string
  lang: Lang2
}): SessionsEmptyNotice | null {
  if (o.count > 0) return null
  const pt = o.lang === 'pt'
  if (o.unavailable === 'backend-unavailable') {
    return {
      title: pt ? 'Não foi possível listar as sessões' : 'The fleet could not be listed',
      // The backend states the actual remedy (e.g. "run agentop inside WSL"); carry its words.
      detail: o.unavailableDetail
        ?? (pt
          ? 'O backend de sessões não pode rodar nesta máquina.'
          : 'The session backend cannot run on this machine.'),
    }
  }
  if (o.unavailable === 'read-failed') {
    return {
      title: pt ? 'Não foi possível listar as sessões' : 'The fleet could not be listed',
      detail: pt
        ? 'A leitura falhou — isto não quer dizer que não há sessões rodando. Tente atualizar.'
        : 'The read failed — that is not the same as there being none. Try refreshing.',
    }
  }
  return {
    title: pt ? 'Nenhuma sessão gerenciada rodando' : 'No managed session is running',
    detail: pt
      ? 'Sessões encerradas continuam listadas no cockpit; aqui só aparecem as que ainda têm um processo vivo.'
      : 'Sessions that have ended stay listed in the cockpit; only ones with a living process appear here.',
  }
}

/** Why one row shows N/A where a number belongs. Rendered as the cell's tooltip. */
export function metricsReasonText(reason: HardwareSessionMetricsReason | undefined, lang: Lang2): string | null {
  const pt = lang === 'pt'
  if (reason === 'no-proc') {
    return pt
      ? 'Sem /proc nesta máquina — nenhuma medida por processo é legível.'
      : 'No /proc on this machine — nothing per-process is readable.'
  }
  if (reason === 'no-pid') {
    return pt
      ? 'O backend não informou um PID para este painel, então não há o que medir.'
      : 'The backend reported no pid for this pane, so there is nothing to measure.'
  }
  if (reason === 'first-sample') {
    return pt
      ? 'CPU é a diferença entre duas leituras; a primeira ainda não tem par.'
      : 'CPU is a delta between two readings, and the first one has no predecessor yet.'
  }
  return null
}
