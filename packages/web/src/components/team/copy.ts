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
  // Fix 1 (Plan 4 Task 1): the read view used to put the HIDDEN chips directly under a heading
  // that said "shared" — two polarities in one box. This is the chip block's own explicit label,
  // separate from the plain-text shared count below it.
  hiddenBlockTitle: {
    en: 'Hidden from this central ({n})',
    pt: 'Ocultos desta central ({n})',
  },
  // Plan 4 Task 7 — the allowlist read view's positive counterpart: what IS listed, never framed
  // as "hidden" (shared-positive discipline; "N hidden" stays the one negative surface, and it
  // never applies to an allowlist's own list).
  allowedBlockTitle: {
    en: 'Shared with this central ({n})',
    pt: 'Compartilhado com esta central ({n})',
  },
  // A repository whose switch is ON while at least one project under it is OFF. Stated on the row
  // so the two tabs cannot disagree: the Projects tab already shows those projects as blocked.
  repoPartialSub: {
    en: 'Partly shared — some projects in it are blocked.',
    pt: 'Parcialmente compartilhado — alguns projetos dele estão bloqueados.',
  },
  // Under an allowlist a partly-shared repository is NOT listed as a repository at all (listing it
  // would re-share the very projects switched off), so only the projects named today travel — a
  // new folder cloned from it later is not shared until it is chosen. That is the fail-closed
  // reading of "share only…", and the user has to be told, or the row reads as a plain ON.
  repoPartialAllowSub: {
    en: 'Partly shared — only the projects listed; a new folder in it is not shared automatically.',
    pt: 'Parcialmente compartilhado — só os projetos listados; uma pasta nova dele não é compartilhada automaticamente.',
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
  // Fix 4 (Plan 4 Task 1): "no repository" read as opaque on its own ("todos os Projetos sem git?
  // sessões sem git em pastas soltas?"). Names both halves of what it covers: a folder that isn't
  // a git repository, AND every session from a CLI that records no remote at all.
  noRepoSub: {
    en: "Sessions with no git remote: a folder that isn't a git repository, or any session from a CLI that doesn't record one (Codex, Gemini, Kimi, Antigravity). Blocked automatically when you block anything else.",
    pt: 'Sessões sem remote git: pasta que não é um repositório git, ou qualquer sessão de um CLI que não registra um remote (Codex, Gemini, Kimi, Antigravity). Bloqueadas automaticamente quando você bloqueia qualquer outra coisa.',
  },
  mixedRepoWarn: {
    en: "This folder contains more than one repository, so sessions in it can't be split. It is blocked as a whole.",
    pt: 'Esta pasta contém mais de um repositório, então as sessões nela não podem ser separadas. Ela é bloqueada por inteiro.',
  },
  lockedNoRepoWarn: {
    en: 'Sessions with no git remote cannot be split. Blocked as a whole.',
    pt: 'Sessões sem remote git não podem ser separadas. Bloqueadas por inteiro.',
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
  // Fix 2 (Plan 4 Task 1): rewritten as "right now" / "can't be undone" — every fact the old copy
  // stated is kept verbatim (already-sent data has been seen; the pre-boundary aggregate cannot be
  // split by repository), only the structure and phrasing changed. Do not drop a fact here.
  applyConfirmBody: {
    en: "Right now: the sessions you're blocking are deleted from this central immediately. This part can't be undone: anything already sent has already been seen — whoever runs this central can tell that data was removed, and what it was.",
    pt: 'Agora: as sessões que você está bloqueando são apagadas desta central imediatamente. Isso não pode ser desfeito: o que já foi enviado já foi visto — quem opera a central consegue perceber que algo foi removido, e o quê.',
  },
  applyConfirmStats: {
    en: "Also can't be undone: Claude already summarised everything up to {boundary} into one aggregate ({n} sessions) that can't be split by repository — if a blocked repository was active back then, that volume stays in your totals on this central and no rule can remove it. Everything after {boundary} is filtered exactly, and stays filtered as Claude keeps summarising it.",
    pt: 'Também não pode ser desfeito: o Claude já resumiu tudo até {boundary} num agregado único ({n} sessões) que não pode ser separado por repositório — se um repositório bloqueado teve atividade naquele período, esse volume continua nos seus totais nesta central e nenhuma regra o remove. Depois de {boundary} o filtro é exato, e continua valendo conforme o Claude for resumindo.',
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
  /** The apply window BEFORE the first post-apply poll has said anything — the PATCH has returned
   *  but no `resync` (and no `pendingRules`) has been observed yet. Never a success sentence.
   *  Fix 5 (Plan 4 Task 1): `handlePatchConnection` already calls `pushNow` the instant rules
   *  change, but nothing on screen said so — this wording makes the sync itself visible instead of
   *  adding a second control. */
  applyingWait: {
    en: 'Sending the new rules to the central…',
    pt: 'Enviando as novas regras para a central…',
  },
  applyingSafeToLeave: {
    en: 'You can leave this page — this continues in the background.',
    pt: 'Você pode sair desta página — isso continua em segundo plano.',
  },
  applyingDone: {
    en: 'Done — re-syncing finished',
    pt: 'Pronto — ressincronização concluída',
  },
  /** Deliberately COUNT-FREE. The banner used to render `plural(PLURAL_COPY.applyOk, 1)` — "1
   *  session re-sent" for every apply, whatever actually happened. Neither number the client holds
   *  means "sessions re-sent" (`status.resync.total` is the FORGET count, `impact.sessions` a
   *  pre-submit estimate of what the rule removes), and the no-resync path — the grace-window
   *  `done` — has no number at all. Stating an invented one on the confirmation of a privacy
   *  action is the same dishonesty the `null`-means-unknowable rule exists to prevent. */
  applyOk: {
    en: 'Rules applied — sent to the central',
    pt: 'Regras aplicadas — enviadas à central',
  },
  applyErr: {
    en: 'Could not apply the rules',
    pt: 'Não foi possível aplicar as regras',
  },
  applyQueued: {
    en: 'Rules saved. The central is unreachable — they will be applied on the next successful sync.',
    pt: 'Regras salvas. A central está inacessível — elas serão aplicadas no próximo envio bem-sucedido.',
  },
  elsewhereTitle: {
    en: 'Another of your machines still shares this',
    pt: 'Outra máquina sua ainda compartilha isto',
  },
  elsewhereBody: {
    en: 'These repositories are hidden here, but this central still receives them from another machine signed in to your account. Repository rules are per machine — apply them there too.',
    pt: 'Estes repositórios estão ocultos aqui, mas esta central ainda os recebe de outra máquina conectada à sua conta. As regras de repositório são por máquina — aplique-as lá também.',
  },
  elsewhereNoRepo: {
    en: 'no linked repository',
    pt: 'sem repositório vinculado',
  },
  // The REVERSE of the three `elsewhere*` rows above. That warning is about data the central
  // demonstrably holds; this one is about a sibling's own sealed testimony, which is a weaker kind
  // of evidence — hence `siblingWithholdBestEffort`, which is the load-bearing row here and must
  // never be dropped for space, softened, or moved out of sight of the list it qualifies.
  siblingWithholdTitle: {
    en: 'Another of your machines does not share this',
    pt: 'Outra máquina sua não compartilha isto',
  },
  siblingWithholdBody: {
    en: 'You are about to start sharing these with this central. Another machine signed in to your account has told this one that it withholds them. Rules are per machine — nothing changes there, and nothing here is blocked.',
    pt: 'Você está prestes a começar a compartilhar isto com esta central. Outra máquina conectada à sua conta informou a esta que não os compartilha. As regras são por máquina — nada muda lá, e nada aqui é bloqueado.',
  },
  siblingWithholdBestEffort: {
    en: 'This machine only knows what your other machines have announced to it, and only since encrypted machine-to-machine messages began. No warning here does not mean no machine restricts it.',
    pt: 'Esta máquina só sabe o que as suas outras máquinas anunciaram a ela, e apenas desde que as mensagens criptografadas entre máquinas começaram. A ausência de aviso aqui não significa que nenhuma máquina restringe isto.',
  },
  siblingWithholdRow: {
    en: 'not shared on {machines}',
    pt: 'não compartilhado em {machines}',
  },
  // The PROJECT dimension is correlated across machines by FOLDER NAME, because the same project
  // sits at a different path on each one. That is a heuristic — `api`, `web` and `docs` collide
  // constantly — so these rows say "a project with this name" and never "this project". Softening
  // that back into the definite article turns a helpful hint into a confident accusation that a
  // colleague is withholding work they may never have had.
  siblingWithholdTitleProject: {
    en: 'Another of your machines does not share a project with this name',
    pt: 'Outra máquina sua não compartilha um projeto com este nome',
  },
  siblingWithholdRowProject: {
    en: 'a project with this name is not shared on {machines}',
    pt: 'um projeto com este nome não é compartilhado em {machines}',
  },
  siblingWithholdProjectNote: {
    en: 'The same project sits at a different path on each machine, so projects are matched by folder name. A project with the same name on another machine may not be the same project.',
    pt: 'O mesmo projeto fica em um caminho diferente em cada máquina, então projetos são correspondidos pelo nome da pasta. Um projeto com o mesmo nome em outra máquina pode não ser o mesmo projeto.',
  },
  proposalTitle: {
    en: '{name} restricted repositories for this central',
    pt: '{name} restringiu repositórios nesta central',
  },
  proposalDenylist: {
    en: 'It now hides:',
    pt: 'Agora oculta:',
  },
  proposalAllowlist: {
    en: 'It now shares only:',
    pt: 'Agora compartilha apenas:',
  },
  proposalNoSources: {
    en: 'nothing',
    pt: 'nada',
  },
  proposalNotApplied: {
    en: 'Nothing has changed on this machine. Rules are per machine — apply it only if you want the same here.',
    pt: 'Nada mudou nesta máquina. As regras são por máquina — aplique apenas se quiser o mesmo aqui.',
  },
  // The card's notices affordance and the modal behind it. The card STATES the state; the
  // explanation and the decision live in the modal.
  // The read view's three standing caveats (new repositories, the attribution boundary, CI) are
  // precise and stay verbatim — they just stop being four stacked tertiary lines on a card whose
  // job is "what am I sharing". The OTel warning is NOT in here: a warning behind a disclosure is
  // a warning nobody reads.
  caveatsToggle: {
    en: 'What these rules do and do not cover',
    pt: 'O que estas regras cobrem e não cobrem',
  },
  noticesBtn: {
    en: 'Notices',
    pt: 'Avisos',
  },
  noticesTitle: {
    en: 'Notices',
    pt: 'Avisos',
  },
  noticesEmpty: {
    en: 'Nothing waiting for you.',
    pt: 'Nada esperando por você.',
  },
  // The useful sentence is the diff against YOUR rules, not a restatement of the sibling's.
  proposalWouldHide: {
    en: 'Applying it here stops sharing:',
    pt: 'Aplicar aqui deixa de compartilhar:',
  },
  // Rows the merge restricts but whose outcome the rules alone cannot settle (a project dropped
  // from an allowlist whose repository is still allowed). Weaker words on purpose — "stops sharing"
  // would be a false statement in the reassuring direction, which is the one thing this feature
  // exists to avoid.
  proposalPartlyRestricts: {
    en: 'No longer listed (sessions in these may still be shared through another rule):',
    pt: 'Deixa de estar listado (sessões nestes podem continuar sendo compartilhadas por outra regra):',
  },
  proposalNothingToApply: {
    en: 'This machine already restricts everything this proposal asks for — there is nothing to apply.',
    pt: 'Esta máquina já restringe tudo o que esta proposta pede — não há nada a aplicar.',
  },
  // The narrowing-only guarantee, stated where the decision is made. Applying can only ever hide
  // more; anything the sibling shares and you hide stays hidden.
  proposalWouldWiden: {
    en: 'Applied exactly as sent it would start sharing {sources}, which this machine hides. It will not: applying can only hide more, never less.',
    pt: 'Aplicada exatamente como enviada, ela passaria a compartilhar {sources}, que esta máquina oculta. Isso não acontecerá: aplicar só pode ocultar mais, nunca menos.',
  },
  proposalWidensUnlisted: {
    en: 'Applied exactly as sent it would also share everything it does not list. It will not: applying can only hide more, never less.',
    pt: 'Aplicada exatamente como enviada, ela também compartilharia tudo o que não lista. Isso não acontecerá: aplicar só pode ocultar mais, nunca menos.',
  },
  proposalHidesUnlisted: {
    en: 'Afterwards only the listed sources stay shared with this central; everything else stops.',
    pt: 'Depois, só as fontes listadas continuam compartilhadas com esta central; o resto para.',
  },
  proposalApply: {
    en: 'Apply here',
    pt: 'Aplicar aqui',
  },
  proposalDismiss: {
    en: 'Dismiss',
    pt: 'Dispensar',
  },
  peersTitle: {
    en: 'Machines that receive your rules',
    pt: 'Máquinas que recebem suas regras',
  },
  peersBody: {
    en: 'The central hands over these keys. If you do not recognise a machine, compare its fingerprint with the one that machine shows for itself.',
    pt: 'A central fornece essas chaves. Se você não reconhece uma máquina, compare a impressão digital com a que aquela máquina mostra de si mesma.',
  },
  // The collapsed line: the FACT, one row. The explanation and the fingerprints live behind it —
  // they are a verification tool used once, not standing information.
  peersCount: {
    en: '{n} machine(s) receive your rules',
    pt: '{n} máquina(s) recebem suas regras',
  },
  peersShow: {
    en: 'Fingerprints',
    pt: 'Impressões digitais',
  },
  peersSelf: {
    en: 'This machine',
    pt: 'Esta máquina',
  },
  proposalAge: {
    en: 'Sent {age}',
    pt: 'Enviado {age}',
  },
  ageJustNow: {
    en: 'just now',
    pt: 'agora mesmo',
  },
  ageHours: {
    en: '{n}h ago',
    pt: 'há {n}h',
  },
  ageDays: {
    en: '{n} day(s) ago',
    pt: 'há {n} dia(s)',
  },
  proposalStale: {
    en: 'This is not recent. Check with that machine before applying it.',
    pt: 'Isto não é recente. Confirme com aquela máquina antes de aplicar.',
  },
  keyChangedTitle: {
    en: 'A machine\'s key changed — messages from it were not opened',
    pt: 'A chave de uma máquina mudou — as mensagens dela não foram abertas',
  },
  keyChangedBody: {
    en: 'The key published for {name} is not the one this machine pinned — a reinstall and a substituted key look the same from here, so nothing from it was decrypted. Compare the fingerprints on both machines.',
    pt: 'A chave publicada para {name} não é a que esta máquina fixou — uma reinstalação e uma chave substituída são indistinguíveis daqui, então nada dela foi descriptografado. Compare as impressões digitais nas duas máquinas.',
  },
  keyChangedDismiss: {
    en: 'I checked — clear this warning',
    pt: 'Já verifiquei — limpar este aviso',
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
  // The collapsed card's meta row. It used to read `appears as <user>` — one unlabelled name where
  // the MACHINE name belonged, next to a title that a local nickname could mask. Machine, central
  // and account are three different things, so each is now labelled and shown as its own value.
  cardMachine: {
    en: 'Machine',
    pt: 'Máquina',
  },
  cardUser: {
    en: 'User',
    pt: 'Usuário',
  },
  // Tooltips on the machine name — the one fact the card must never leave ambiguous.
  machineNameByCentral: {
    en: 'Name assigned by the central. Only the central can change it.',
    pt: 'Nome definido pela central. Só a central pode alterá-lo.',
  },
  machineNamePending: {
    en: 'The central has not reported a name for this machine yet — showing the endpoint host.',
    pt: 'A central ainda não informou um nome para esta máquina — exibindo o host do endpoint.',
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
  // Fix 6 (Plan 4 Task 1): the name the CENTRAL gave this machine (the token's label), forwarded
  // by `handleProbeConnection` — distinct from `identityUser` (the account this token
  // authenticates as). There is no local nickname anymore (save-and-rename fix 2) — the machine
  // may not name itself, so this is the only name shown.
  identityMachineName: {
    en: 'Machine name',
    pt: 'Nome da máquina',
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
  // Added for Task 11 (the per-central repository denylist editor) — `Section`'s default labels
  // are English-only, so a caller localizing its own content must supply its own edit/save labels.
  editRules: {
    en: 'Edit',
    pt: 'Editar',
  },
  saveRules: {
    en: 'Save',
    pt: 'Salvar',
  },
  // Added for Task 12 (the two-step add-central wizard) — the step machine's own labels: the
  // "Test connection" action, its identity confirmation, the step-2 header, and the back/continue
  // navigation between the two steps.
  addStep1Title: {
    en: 'Step 1 of 2 — Identify the central',
    pt: 'Passo 1 de 2 — Identificar a central',
  },
  addStep2Title: {
    en: 'Step 2 of 2 — Choose what it may see',
    pt: 'Passo 2 de 2 — Escolher o que ela pode ver',
  },
  testConnBtn: {
    en: 'Test connection',
    pt: 'Testar conexão',
  },
  testingConn: {
    en: 'Testing…',
    pt: 'Testando…',
  },
  // The primary action's transient success state (save-and-rename fix 1): pressing "Continue" now
  // tests the connection itself — this is the brief label between "Testing…" and the step
  // actually advancing, so the click reads as one action with a visible outcome, not a silent
  // jump. `testOkIdentity`/`testOkIdentityNoOrg` (the inline note) still state WHO answered; this
  // is only the button's own momentary word.
  testSuccess: {
    en: 'Success!',
    pt: 'Sucesso!',
  },
  testOkIdentity: {
    en: 'Connected as {user} ({org})',
    pt: 'Conectado como {user} ({org})',
  },
  testOkIdentityNoOrg: {
    en: 'Connected as {user}',
    pt: 'Conectado como {user}',
  },
  continueBtn: {
    en: 'Continue',
    pt: 'Continuar',
  },
  backBtn: {
    en: 'Back',
    pt: 'Voltar',
  },
  addEndpointRequired: {
    en: 'Enter the central URL, or paste a token that carries one.',
    pt: 'Digite a URL da central, ou cole um token que já contenha uma.',
  },
  // Plan 4 Task 6 — the two-tab picker. "Projetos" is the FIRST tab: the user's own words were
  // "parece que só tem repo, mas a ideia é todos os projetos", so Projects leads and Repositories
  // is the second lens over the same rules.
  tabProjects: {
    en: 'Projects',
    pt: 'Projetos',
  },
  tabRepos: {
    en: 'Repositories',
    pt: 'Repositórios',
  },
  searchProjects: {
    en: 'Search projects…',
    pt: 'Buscar projetos…',
  },
  // "repo + projeto são a mesma coisa" (the user's own words) — a project whose repository is
  // blocked in the OTHER tab renders blocked-and-locked, naming the repository responsible, so no
  // contradictory pair (project shared, its repo blocked) can ever exist on screen.
  lockedByRepo: {
    en: 'Blocked by repository {repo}',
    pt: 'Bloqueado pelo repositório {repo}',
  },
  // Plan 4 Task 7 — the per-connection mode selector.
  modeExceptLabel: {
    en: 'Share everything, except…',
    pt: 'Compartilhar tudo, exceto…',
  },
  modeExceptSub: {
    en: 'The default. A new project or repository is shared automatically.',
    pt: 'O padrão. Um novo projeto ou repositório é compartilhado automaticamente.',
  },
  modeOnlyLabel: {
    en: 'Share only…',
    pt: 'Compartilhar apenas…',
  },
  modeOnlySub: {
    en: 'A new project or repository is hidden automatically — the safer default for a central you trust less.',
    pt: 'Um novo projeto ou repositório fica oculto automaticamente — o padrão mais seguro para uma central em que você confia menos.',
  },
  // The confirm modal must state the consequence in the DIRECTION being chosen — switching to
  // "apenas" is usually a large removal, switching back widens sharing back open.
  modeConfirmToAllowlist: {
    en: 'Switching to "Share only…" hides everything not listed below — for most machines, that removes far more than it keeps.',
    pt: 'Mudar para "Compartilhar apenas…" oculta tudo que não estiver listado abaixo — na maioria das máquinas, isso remove muito mais do que mantém.',
  },
  modeConfirmToDenylist: {
    en: 'Switching to "Share everything, except…" shares everything not explicitly blocked below, including anything new from now on.',
    pt: 'Mudar para "Compartilhar tudo, exceto…" compartilha tudo que não estiver bloqueado explicitamente abaixo, inclusive o que surgir depois.',
  },
  // An allowlist naming nothing on either dimension would silently share nothing — refused in the
  // UI with this explanation rather than saved as-is.
  emptyAllowlistWarning: {
    en: 'Choose at least one project or repository to share. An empty "Share only…" list would share nothing at all.',
    pt: 'Escolha ao menos um projeto ou repositório para compartilhar. Uma lista vazia em "Compartilhar apenas…" não compartilharia nada.',
  },
} satisfies Record<string, CopyEntry>

/** `{one, other}` rows — pass through `plural(entry, n)` before interpolating any placeholders.
 *  `satisfies`, not an annotation — same reasoning as `COPY` above. */
export const PLURAL_COPY = {
  blockedPill: {
    en: { one: '1 hidden', other: '{n} hidden' },
    pt: { one: '1 oculto', other: '{n} ocultos' },
  },
  // The collapsed card's pill in ALLOWLIST mode — the same count, framed the way that mode reads.
  // `deniedCount` is `allowedCount` there (see `ruleCountsOf`), so the negative pill reported a
  // connection sharing 3 of 40 repositories as "3 hidden".
  allowedPill: {
    en: { one: '1 shared', other: '{n} shared' },
    pt: { one: '1 compartilhado', other: '{n} compartilhados' },
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
} satisfies Record<string, PluralCopyEntry>
