/**
 * copy.ts — EN/PT product copy for the per-central repository-sharing settings panel.
 *
 * Copied VERBATIM from `docs/superpowers/specs/2026-07-28-multi-central-and-repo-sharing-design.md`
 * §9.8. Several rows state limits precisely on purpose — that already-sent data has been seen
 * (`applyConfirmBody`), that a period before the attribution boundary cannot be filtered
 * (`applyConfirmStats`, `applyConfirmStatsProven`, `statsNote`), and that CI and OpenTelemetry are
 * not covered (`ciNote`, `otelWarn`). Do not soften, shorten, "improve" or re-translate any row —
 * that is a product decision, not a formatting one.
 *
 * `plural()` is RE-EXPORTED from `lib/shareRepos.ts` rather than duplicated here: that module
 * already carries the identical two-line helper for the repo picker's own projection (Task 8), and
 * importing it keeps one implementation instead of two copies that could silently drift apart.
 * `lib/` has no dependency on `components/`, so `components/team → lib/shareRepos` is a normal
 * (downward) import direction, not a cycle.
 */
import { plural as sharedPlural } from '../../lib/shareRepos'

export const plural = sharedPlural

/** One `{one, other}` form, in a single language. */
export interface PluralForm {
  one: string
  other: string
}

/** A plain (non-pluralized) copy row. */
export interface CopyEntry {
  en: string
  pt: string
}

/** A `{one, other}` copy row, pluralized independently per language. */
export interface PluralCopyEntry {
  en: PluralForm
  pt: PluralForm
}

/**
 * Substitutes `{name}` placeholders in a copy string with `vars[name]`. A placeholder with no
 * matching var is left untouched rather than throwing — a caller building `vars` incrementally
 * (e.g. formatting `{sessions}` before `{cost}` is known) must never crash the render over it.
 */
export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match))
}

/**
 * Plain (non-pluralized) rows.
 *
 * `satisfies` rather than a `: Record<string, CopyEntry>` annotation — Task 9's own consumer
 * (`copy.test.ts`) only ever iterates via `Object.entries`, so it never needed this, but Task 10's
 * components index by literal key (`COPY.checking[lang]`). With `noUncheckedIndexedAccess` on
 * (tsconfig.json), a widened `Record<string, CopyEntry>` type makes every such access
 * `CopyEntry | undefined`; `satisfies` keeps the literal key types while still checking every row
 * against the same shape.
 */
export const COPY = {
  pageIntro: {
    en: 'Connect this machine to one or more centrals. You choose, per central, which repositories it may see.',
    pt: 'Conecte esta máquina a uma ou mais centrais. Você escolhe, por central, quais repositórios ela pode ver.',
  },
  connectedCentrals: {
    en: 'Connected centrals',
    pt: 'Centrais conectadas',
  },
  addCentral: {
    en: 'Add central',
    pt: 'Adicionar central',
  },
  emptyTitle: {
    en: 'Not connected to any central',
    pt: 'Sem conexão com nenhuma central',
  },
  emptyBody: {
    en: 'All data stays on this machine. Add a central to start sharing your metrics.',
    pt: 'Todos os dados ficam nesta máquina. Adicione uma central para começar a compartilhar suas métricas.',
  },
  checking: {
    en: 'Checking…',
    pt: 'Verificando…',
  },
  connecting: {
    en: 'Connecting…',
    pt: 'Conectando…',
  },
  connected: {
    en: 'Connected',
    pt: 'Conectado',
  },
  reconnecting: {
    en: 'Reconnecting…',
    pt: 'Reconectando…',
  },
  unauthorized: {
    en: 'Unauthorized',
    pt: 'Não autorizado',
  },
  noIdentity: {
    en: 'Not yet identified by this central',
    pt: 'Ainda não identificado por esta central',
  },
  retry: {
    en: 'Retry',
    pt: 'Tentar novamente',
  },
  authHelp: {
    en: "This central rejected the token. Rotate it in the central's Machines panel, then run `agentop member connect` again with the new token.",
    pt: 'A central rejeitou o token. Rotacione-o no painel de Máquinas da central e rode `agentop member connect` de novo com o novo token.',
  },
  lastSync: {
    en: 'last sync {t}',
    pt: 'último envio {t}',
  },
  lastActiveT: {
    en: 'last active {t}',
    pt: 'ativo há {t}',
  },
  centralsN: {
    en: '{n} centrals',
    pt: '{n} centrais',
  },
  nReconnecting: {
    en: '{n} reconnecting',
    pt: '{n} reconectando',
  },
  nUnauthorized: {
    en: '{n} unauthorized',
    pt: '{n} não autorizadas',
  },
  nResyncing: {
    en: '{n} re-syncing',
    pt: '{n} ressincronizando',
  },
  sharedRepos: {
    en: 'Shared repositories',
    pt: 'Repositórios compartilhados',
  },
  sharingAll: {
    en: 'Sharing every repository on this machine, including new ones.',
    pt: 'Compartilhando todos os repositórios desta máquina, inclusive os novos.',
  },
  newRepoNote: {
    en: 'A repository that appears later is shared by default.',
    pt: 'Um repositório que aparecer depois é compartilhado por padrão.',
  },
  searchRepos: {
    en: 'Search repositories…',
    pt: 'Buscar repositórios…',
  },
  shareAll: {
    en: 'Share all',
    pt: 'Compartilhar todos',
  },
  blockAll: {
    en: 'Block all',
    pt: 'Bloquear todos',
  },
  groupBlocked: {
    en: 'Blocked ({n})',
    pt: 'Bloqueados ({n})',
  },
  groupShared: {
    en: 'Shared ({n})',
    pt: 'Compartilhados ({n})',
  },
  showAllRepos: {
    en: 'Show all {n}',
    pt: 'Mostrar todos ({n})',
  },
  noRepoTitle: {
    en: 'No repository',
    pt: 'Sem repositório',
  },
  noRepoSub: {
    en: "Sessions with no detected git remote — including sessions from CLIs that don't record one. Blocked automatically when you block anything else.",
    pt: 'Sessões sem remote git detectado — inclusive de CLIs que não registram um. Bloqueadas automaticamente quando você bloqueia qualquer outra coisa.',
  },
  mixedRepoWarn: {
    en: "This folder contains more than one repository, so sessions in it can't be split. It is blocked as a whole.",
    pt: 'Esta pasta contém mais de um repositório, então as sessões nela não podem ser separadas. Ela é bloqueada por inteiro.',
  },
  staleHint: {
    en: 'Still blocked. If the repository comes back, it stays hidden from this central.',
    pt: 'Continuam bloqueados. Se o repositório voltar, ele segue oculto desta central.',
  },
  applyImpact: {
    en: 'Removes {sessions} sessions (~{cost}) from this central.',
    pt: 'Remove {sessions} sessões (~{cost}) desta central.',
  },
  applyConfirmTitle: {
    en: 'Apply sharing rules?',
    pt: 'Aplicar regras de compartilhamento?',
  },
  applyConfirmBody: {
    en: 'The sessions you are blocking are deleted from this central right away. Anything already sent has been seen — whoever runs this central can tell that data was removed, and what it was.',
    pt: 'As sessões que você está bloqueando são apagadas desta central imediatamente. O que já foi enviado já foi visto — quem opera a central consegue perceber que algo foi removido, e o quê.',
  },
  applyConfirmStats: {
    en: 'Your totals stay whole. Claude has already summarised everything up to {boundary} into a single aggregate ({n} sessions) that cannot be split by repository — if a blocked repository was active back then, that volume stays in it and no rule can remove it. Everything after {boundary} is filtered exactly, and stays filtered as Claude summarises it.',
    pt: 'Seus totais continuam completos. O Claude já resumiu tudo até {boundary} num agregado único ({n} sessões) que não pode ser separado por repositório — se um repositório bloqueado teve atividade naquele período, esse volume fica lá e nenhuma regra o remove. Depois de {boundary} o filtro é exato, e continua valendo conforme o Claude vai resumindo.',
  },
  applyConfirmStatsProven: {
    en: 'One or more repositories you are blocking have sessions before {boundary}. Their volume from that period stays in the aggregate and cannot be removed.',
    pt: 'Um ou mais repositórios que você está bloqueando têm sessões anteriores a {boundary}. O volume daquele período fica no agregado e não pode ser removido.',
  },
  applyConfirmBtn: {
    en: 'Apply and resend',
    pt: 'Aplicar e reenviar',
  },
  applyingForget: {
    en: 'Removing {done} of {total} sessions from the central…',
    pt: 'Removendo {done} de {total} sessões da central…',
  },
  applyingPush: {
    en: "Updating this central's totals…",
    pt: 'Atualizando os totais desta central…',
  },
  applyingSafeToLeave: {
    en: 'You can leave this page — this continues in the background.',
    pt: 'Você pode sair desta página — isso continua em segundo plano.',
  },
  applyingDone: {
    en: 'Done — re-syncing finished',
    pt: 'Pronto — ressincronização concluída',
  },
  applyErr: {
    en: 'Could not apply the rules',
    pt: 'Não foi possível aplicar as regras',
  },
  applyQueued: {
    en: 'Rules saved. The central is unreachable — they will be applied on the next successful sync.',
    pt: 'Regras salvas. A central está inacessível — elas serão aplicadas no próximo envio bem-sucedido.',
  },
  statsNote: {
    en: 'Filtered exactly after {boundary}. Earlier days ({n} sessions) were already summarised by Claude into one aggregate that no rule can split.',
    pt: 'Filtrado com exatidão depois de {boundary}. Os dias anteriores ({n} sessões) já foram resumidos pelo Claude num agregado único que nenhuma regra separa.',
  },
  ciNote: {
    en: 'This only covers sessions from this machine. If the repository also pushes from GitHub Actions, it stays visible on the central.',
    pt: 'Isto cobre apenas as sessões desta máquina. Se o repositório também envia pelo GitHub Actions, ele continua visível na central.',
  },
  otelWarn: {
    en: 'OpenTelemetry export is on. It sends unfiltered totals and is not covered by these rules.',
    pt: 'A exportação OpenTelemetry está ligada. Ela envia totais sem filtro e não é coberta por estas regras.',
  },
  centralTooOld: {
    en: 'This central cannot remove specific sessions on request. Upgrade it to use sharing rules.',
    pt: 'Esta central não consegue remover sessões específicas sob demanda. Atualize-a para usar regras de compartilhamento.',
  },
  archiveOffNote: {
    en: 'Sharing rules need session archiving. Open Settings → Sessions and choose "Consolidate metrics".',
    pt: 'As regras de compartilhamento exigem o arquivamento de sessões. Abra Configurações → Sessões e escolha "Consolidar métricas".',
  },
  syncNow: {
    en: 'Sync now',
    pt: 'Sincronizar agora',
  },
  disconnect: {
    en: 'Disconnect',
    pt: 'Desconectar',
  },
  disconnectBtn: {
    en: 'Disconnect',
    pt: 'Desconectar',
  },
  cancel: {
    en: 'Cancel',
    pt: 'Cancelar',
  },
  disconnectTitle: {
    en: 'Disconnect from {central}?',
    pt: 'Desconectar de {central}?',
  },
  disconnectBody: {
    en: 'Your data is deleted from this central and this machine stops pushing to it. Other centrals are unaffected.',
    pt: 'Seus dados são apagados desta central e esta máquina para de enviar para ela. As outras centrais não são afetadas.',
  },
  disconnectHint: {
    en: 'Type "{central}" to confirm',
    pt: 'Digite "{central}" para confirmar',
  },
  brokenConn: {
    en: "This connection's address can't be read. Disconnect and add it again.",
    pt: 'Não foi possível ler o endereço desta conexão. Desconecte e adicione de novo.',
  },
  addTitle: {
    en: 'Add a central',
    pt: 'Adicionar uma central',
  },
  addTokenLabel: {
    en: 'Machine token',
    pt: 'Token da máquina',
  },
  addTokenSub: {
    en: 'The token minted for this machine on the central (Settings → Machines). The URL is filled in from it.',
    pt: 'O token gerado para esta máquina na central (Configurações → Máquinas). A URL é preenchida a partir dele.',
  },
  addEndpointLabel: {
    en: 'Central URL',
    pt: 'URL da central',
  },
  addLabelLabel: {
    en: 'Name (optional)',
    pt: 'Nome (opcional)',
  },
  addLabelSub: {
    en: 'Only for you — the central never sees it.',
    pt: 'Só para você — a central nunca vê isso.',
  },
  addRulesIntro: {
    en: 'Choose what this central may see. Nothing is sent until you finish — a repository you block here is never shared with it.',
    pt: 'Escolha o que esta central pode ver. Nada é enviado até você concluir — um repositório bloqueado aqui nunca é compartilhado com ela.',
  },
  dupCentral: {
    en: 'This machine is already connected to that central. Replace the token on the existing connection?',
    pt: 'Esta máquina já está conectada a essa central. Substituir o token da conexão existente?',
  },
  tokenInUse: {
    en: 'That token is already used by {central}.',
    pt: 'Esse token já é usado por {central}.',
  },
  connectBtn: {
    en: 'Connect',
    pt: 'Conectar',
  },
  whatIsPushed: {
    en: 'Only computed session metrics (tokens, cost, duration) are pushed — no conversation content.',
    pt: 'Apenas métricas computadas (tokens, custo, duração) são enviadas — nenhum conteúdo de conversa.',
  },
  // Added for Task 10 (the connection card list) — the design doc's §9.5 wording ("appears as
  // <user>", the identity panel's read-only rows) was not yet in this table under Task 9.
  appearsAs: {
    en: 'appears as',
    pt: 'aparece como',
  },
  rename: {
    en: 'Rename',
    pt: 'Renomear',
  },
  syncing: {
    en: 'Syncing…',
    pt: 'Sincronizando…',
  },
  identityUrl: {
    en: 'URL',
    pt: 'URL',
  },
  identityToken: {
    en: 'Token',
    pt: 'Token',
  },
  identityUser: {
    en: 'User',
    pt: 'Usuário',
  },
  identityOrg: {
    en: 'Organization',
    pt: 'Organização',
  },
  identityLatency: {
    en: 'Latency',
    pt: 'Latência',
  },
  networkError: {
    en: 'Network error',
    pt: 'Erro de rede',
  },
  couldNotIdentify: {
    en: 'Could not identify',
    pt: 'Não foi possível identificar',
  },
} satisfies Record<string, CopyEntry>

/** `{one, other}` rows — pass through `plural(entry, n)` before interpolating any placeholders.
 *  `satisfies`, not an annotation — same reasoning as `COPY` above. */
export const PLURAL_COPY = {
  blockedPill: {
    en: { one: '1 hidden', other: '{n} hidden' },
    pt: { one: '1 oculto', other: '{n} ocultos' },
  },
  hiddenFromN: {
    en: { one: 'Hidden from 1 central', other: 'Hidden from {n} centrals' },
    pt: { one: 'Oculto de 1 central', other: 'Oculto de {n} centrais' },
  },
  nShared: {
    en: { one: '1 of {total} shared', other: '{n} of {total} shared' },
    pt: { one: '1 de {total} compartilhado', other: '{n} de {total} compartilhados' },
  },
  sessionsN: {
    en: { one: '1 session', other: '{n} sessions' },
    pt: { one: '1 sessão', other: '{n} sessões' },
  },
  staleGroup: {
    en: {
      one: '1 blocked repository with no sessions on this machine',
      other: '{n} blocked repositories with no sessions on this machine',
    },
    pt: {
      one: '1 repositório bloqueado sem sessões nesta máquina',
      other: '{n} repositórios bloqueados sem sessões nesta máquina',
    },
  },
  applyOk: {
    en: { one: 'Rules applied — 1 session re-sent', other: 'Rules applied — {n} sessions re-sent' },
    pt: { one: 'Regras aplicadas — 1 sessão reenviada', other: 'Regras aplicadas — {n} sessões reenviadas' },
  },
} satisfies Record<string, PluralCopyEntry>
