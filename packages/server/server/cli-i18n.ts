/**
 * cli-i18n.ts — English/Portuguese strings the HOST produces.
 *
 * The CLI is English by default. The language follows `preferences.lang` (shared with the web
 * toggle), an in-app toggle that persists there, or a `--lang en|pt` flag. These strings are
 * CLI-specific (the @agentistics/core i18n keys are web-focused), kept here so the control center
 * stays self-contained and bundles cleanly into the binary.
 *
 * The division of labour: everything here is something `cli-start.ts` PRODUCES — a service label, a
 * mode sentence, the outcome of an action, a line printed by a non-interactive subcommand. The
 * words the control center's own screens are made of live in `tui/src/control/i18n.ts`, because the
 * host hands the TUI a `ControlStatus`, not a string table.
 *
 * The flat arrow-key launcher this file was written for is gone, and with it forty entries that
 * named its menu items and its "stop which?" submenus. They were deleted rather than left in place:
 * a string table is documentation of what the program can say, and entries for a menu that no
 * longer exists document a program that no longer exists.
 */

export type CliLang = 'en' | 'pt'

export interface CliStrings {
  tagline: string
  configSolo: string
  /** The member sentence WITHOUT the endpoint, for surfaces that print the endpoint themselves. */
  configMemberBare: string
  configMember: (endpoint: string) => string
  configMembers: (n: number) => string
  configMemberLine: (endpoint: string, suffix: string) => string
  deniedSuffix: (n: number) => string
  configCentral: string
  nothingRunning: string

  confirmKill: string
  alreadyRunning: (url: string) => string
  leftRunning: string
  pauseMsg: string

  startedBg: string
  logsLabel: string
  webLabel: string
  bootLabel: string
  bootNote: string
  containerUp: string
  stoppingLocal: string
  stoppingCentral: string
  stoppingMachine: string
  restartingLocal: string
  restartingCentral: string
  restartingMachine: string
  rebuildingCentral: string
  rebuildingMachine: string
  rebuildingLocal: string
  localRebuildHint: string
  localRebuildFailed: string
  restartedAll: string
  restartedDone: string
  noComposeFrom: (dir: string) => string
  runFromRepo: string
  buildingMachine: string

  // control center — service rows, action outcomes and the reasons a state is unknown.
  // Everything the control center shows comes from the host already localized, so every sentence
  // it can print has to exist here.
  /** The browser-open outcome. */
  urlOpened: (url: string) => string
  urlOpenFailed: string

  /** The two LOGICAL service names — one row each, whichever runtime they happen to be using. */
  svcAgentistics: string
  svcCentral: string
  /**
   * More than one runtime of the same logical service is up.
   *
   * Takes the runtime words so both are NAMED: the row is painted in the danger colour, and a
   * colour on its own carries no meaning on a terminal that flattens it. It is the one service
   * state the screen must never tidy away — the two copies share the port and the files.
   *
   * The word and both names come FIRST, before the advice. The sentence is drawn into the detail
   * pane, which on a narrow terminal is under thirty columns wide and truncates from the right —
   * so a sentence that reached its second runtime at column thirty was, at exactly the sizes where
   * the services row can say least, a red line that named one runtime.
   */
  svcConflict: (runtimes: string[]) => string
  /** A stop/restart named something that is not running. */
  svcNotRunning: string
  dockerMissing: string
  dockerUnreachable: string
  foregroundLater: string
  useRestartInstead: string

  /**
   * The start options a service offers while it is down — the host composes them because only it
   * knows what this box can run, and a running service offers NONE of them.
   */
  optForeground: string
  optForegroundHint: string
  optBackground: string
  optBackgroundHint: string
  /** `machine` runtime, attached — `docker compose up --build` with no `-d`, Ctrl-C stops it. */
  optDockerForeground: string
  optDockerForegroundHint: string
  /** `machine` runtime, detached — the same, in the background. */
  optDockerBackground: string
  optDockerBackgroundHint: string
  optCentral: string
  optCentralHint: string
  /** A native central (external Mongo, standalone path) — foreground, Ctrl-C to stop. */
  optCentralNativeForeground: string
  optCentralNativeForegroundHint: string
  /** Same, detached — returns immediately, runs in the background. */
  optCentralNativeBackground: string
  optCentralNativeBackgroundHint: string
  /** `Stop (native)` / `Stop (docker)` — offered only to break a conflict. */
  stopRuntime: (runtime: string) => string

  /**
   * The restarts a RUNNING service offers — composed here for the same reason the starts are: only
   * this side knows whether a rebuild has what it needs on this box.
   *
   * The rebuild is a second verb rather than a flag on the first because the two do different
   * amounts of work and the difference is the whole point of offering it: a bounce serves the build
   * that is already there, a rebuild makes a new one first.
   */
  optRestart: string
  optRestartHint: string
  optRebuild: string
  /** `Rebuild & restart (native)` — the conflict case, where each copy is rebuilt on its own. */
  optRebuildRuntime: (runtime: string) => string
  /** What a rebuild MEANS, per runtime: recompile the binary, or rebuild the image. */
  optRebuildNativeHint: string
  optRebuildDockerHint: string
  archiveUnsetHint: string
  dockerStartFailed: string
  centralStarted: string
  centralFailed: string
  centralInitDone: string
  centralInitFailed: string
  connected: string
  connectFailed: string
  /** The one-line outcome of a disconnect that left the machine with no central at all. */
  disconnected: string
  disconnectFailed: string
  stoppedAll: string
  stoppedDone: string
  soloSet: string
  archiveSet: (mode: string) => string
  prefsWriteFailed: string

  // critical (unattended) update — printed by `agentop check-update`
  updateCriticalTitle: string
  updateCriticalInstalling: (version: string) => string
  updateCriticalLog: (path: string) => string
  updateCriticalRunning: string
  updateCriticalManualTitle: string
  updateCriticalManualHow: (cmd: string) => string
  updateCriticalUnsupported: (target: string) => string
  updateCriticalRetryLater: string

  // `agentop upgrade` — install safety (verification, rollback, restart failures)
  upgradeVerifying: string
  upgradeFromSource: (execPath: string) => string
  upgradeInProgress: (pid: number) => string
  upgradeLockUnavailable: string
  upgradeUnsupported: (target: string) => string
  upgradeManualHow: (url: string) => string
  upgradeVerifyFailed: (reason: string) => string
  upgradeRolledBack: (backup: string) => string
  upgradeUntouched: string
  upgradeBackupKept: (backup: string) => string
  upgradeRestartFailed: (version: string) => string
  upgradeRestartHint: string

  // multi-central member commands (Task 6 — spec §8.2)
  cancel: string
  leaveWhich: string
  leaveAll: string
  leftOne: (endpoint: string) => string
  leftAll: (n: number) => string
  stillConnected: (n: number) => string
  noConnections: string
  ambiguousLeave: (n: number) => string
  connectedAs: (user: string, n: number) => string
  updatedExisting: (endpoint: string) => string
  tokenInUse: (endpoint: string) => string
  noMatchEndpoint: (endpoint: string) => string
  localServerUnknown: string
  stateAuthRejected: string
  stateNetUnreachable: string
  stateOk: string
  neverSynced: string
}

const EN: CliStrings = {
  tagline: 'AI coding-assistant analytics · agentop',
  configSolo: 'solo — nothing leaves this machine',
  configMemberBare: 'member — sends metrics to a central',
  configMember: (e) => `member — sends metrics to a central at ${e}`,
  configMembers: (n) => `member — sends metrics to ${n} centrals`,
  configMemberLine: (endpoint, suffix) => `  ↳ ${endpoint}${suffix}`,
  deniedSuffix: (n) => ` · ${n} repo(s) blocked`,
  configCentral: 'central — this machine hosts the team central',
  nothingRunning: 'nothing running',

  confirmKill: 'Kill it and start fresh?',
  alreadyRunning: (url) => `A server is already running on ${url}.`,
  leftRunning: 'left the running server as-is.',
  pauseMsg: 'Press Enter to go back',

  startedBg: 'started in the background.',
  logsLabel: 'logs',
  webLabel: 'web',
  bootLabel: 'boot',
  bootNote: 'it already restarts with Docker (restart: unless-stopped)',
  containerUp: 'machine container is up.',
  stoppingLocal: 'stopping the local server…',
  stoppingCentral: 'stopping the central container…',
  stoppingMachine: 'stopping the machine container…',
  restartingLocal: 'restarting the local server…',
  restartingCentral: 'restarting the central container…',
  restartingMachine: 'restarting the machine container…',
  rebuildingCentral: 'rebuilding the central image and recreating…',
  rebuildingMachine: 'rebuilding the machine image and recreating…',
  rebuildingLocal: 'rebuilding the native server (bun run bin)…',
  localRebuildHint: '--rebuild needs the repo to rebuild the native server. Run this from the agentistics checkout, or `agentop upgrade`. Restarting the existing build.',
  localRebuildFailed: 'native rebuild failed — restarting the existing build.',
  restartedAll: 'restarted all running services.',
  restartedDone: 'service restarted.',
  noComposeFrom: (dir) => `couldn't find docker-compose.machine.yml in ${dir}.`,
  runFromRepo: 'Run agentop start from the agentistics repo to use Docker.',
  buildingMachine: 'building & starting the machine container…',

  urlOpened: url => `opened ${url}`,
  urlOpenFailed: 'could not open a browser from here',

  svcAgentistics: 'agentistics',
  svcCentral: 'agentistics central',
  svcConflict: (runtimes) => `conflict: ${runtimes.join(' + ')} both running — stop one`,
  svcNotRunning: 'that service is not running.',
  dockerMissing: 'docker not installed',
  dockerUnreachable: 'docker is installed but not answering',
  foregroundLater: 'foreground starts once this screen closes.',
  useRestartInstead: 'Use Restart to replace it.',

  optForeground: 'Start (this terminal)',
  optForegroundHint: 'runs here until you quit',
  optBackground: 'Start (background)',
  optBackgroundHint: 'detached — keeps running',
  optDockerForeground: 'Start (docker, this terminal)',
  optDockerForegroundHint: 'attached — Ctrl-C stops it',
  optDockerBackground: 'Start (docker, background)',
  optDockerBackgroundHint: 'detached — the same server, in a container',
  optCentral: 'Start',
  optCentralHint: 'the team central, in Docker',
  optCentralNativeForeground: 'Start (this terminal)',
  optCentralNativeForegroundHint: 'runs here until you quit — no Docker needed',
  optCentralNativeBackground: 'Start (background)',
  optCentralNativeBackgroundHint: 'detached — keeps running, no Docker needed',
  stopRuntime: (runtime) => `Stop (${runtime})`,
  optRestart: 'Restart',
  optRestartHint: 'bounce it — same build',
  optRebuild: 'Rebuild & restart',
  optRebuildRuntime: (runtime) => `Rebuild & restart (${runtime})`,
  optRebuildNativeHint: 'recompile the binary first (bun run bin), then restart',
  optRebuildDockerHint: 'rebuild the image and recreate the container',
  archiveUnsetHint: 'history preservation is still unset — see the Setup tab',
  dockerStartFailed: 'the machine container did not start.',
  centralStarted: 'agentistics central is up.',
  centralFailed: 'the central did not start.',
  centralInitDone: 'central configured.',
  centralInitFailed: 'central init did not complete.',
  connected: 'connected — this machine is now a member.',
  connectFailed: 'could not connect to the central.',
  disconnected: 'disconnected — this machine is back to solo.',
  disconnectFailed: 'could not disconnect from the central.',
  stoppedAll: 'stopped every running service.',
  stoppedDone: 'service stopped.',
  soloSet: 'solo mode set — nothing leaves this machine.',
  archiveSet: (mode) => `history preservation set to ${mode}.`,
  prefsWriteFailed: 'could not write preferences.',

  updateCriticalTitle: 'Critical update — installing automatically',
  updateCriticalInstalling: (v) => `v${v} is being installed in the background; your terminal is free.`,
  updateCriticalLog: (p) => `Progress: ${p}`,
  updateCriticalRunning: 'A critical update is already being installed in the background.',
  updateCriticalManualTitle: 'Critical update available',
  updateCriticalManualHow: (cmd) => `Install it with ${cmd} — automatic install is opt-in (AGENTISTICS_AUTO_UPGRADE=1).`,
  updateCriticalUnsupported: (target) => `Automatic install is not available for ${target} — install it by hand.`,
  updateCriticalRetryLater: 'A critical update failed to install earlier; it will be retried later.',

  upgradeVerifying: '  Verifying the downloaded binary…',
  upgradeFromSource: (execPath) => `Refusing to upgrade: this is a source checkout, so upgrading would overwrite ${execPath}. Build/install the binary instead (bun run build:binary).`,
  upgradeInProgress: (pid) => `An upgrade is already running (pid ${pid}) — nothing to do.`,
  upgradeLockUnavailable: 'Could not write the upgrade lock; continuing without it.',
  upgradeUnsupported: (target) => `No agentop release is published for ${target}, so it cannot upgrade itself.`,
  upgradeManualHow: (url) => `Download the right binary for your platform and replace it by hand: ${url}`,
  upgradeVerifyFailed: (reason) => `Upgrade aborted: ${reason}.`,
  upgradeRolledBack: (backup) => `The previous binary was restored from ${backup}.`,
  upgradeUntouched: 'The installed binary was left untouched.',
  upgradeBackupKept: (backup) => `Previous binary kept at ${backup}.`,
  upgradeRestartFailed: (version) => `v${version} is installed, but some services were NOT restarted onto it:`,
  upgradeRestartHint: 'Restart them by hand (e.g. `agentop restart --all`) — they still run the old version.',

  cancel: 'Cancel',
  leaveWhich: 'Leave which central?',
  leaveAll: 'Leave all centrals',
  leftOne: (endpoint) => `left ${endpoint}`,
  leftAll: (n) => `left all ${n} central${n === 1 ? '' : 's'} — back to solo.`,
  stillConnected: (n) => `still connected to ${n} central(s).`,
  noConnections: 'not connected to any central.',
  ambiguousLeave: (n) => `connected to ${n} centrals — pass --endpoint <url> or --all.`,
  connectedAs: (user, n) => `connected as ${user} — ${n} central(s) total.`,
  updatedExisting: (endpoint) => `updated the existing connection to ${endpoint}`,
  tokenInUse: (endpoint) => `that token already belongs to ${endpoint}`,
  noMatchEndpoint: (endpoint) => `no connection matches endpoint ${endpoint}`,
  localServerUnknown: 'unknown (local server not running)',
  stateAuthRejected: 'token rejected by central',
  stateNetUnreachable: 'central unreachable',
  stateOk: 'ok',
  neverSynced: 'never',
}

const PT: CliStrings = {
  tagline: 'Analytics de assistentes de código IA · agentop',
  configSolo: 'solo — nada sai desta máquina',
  configMemberBare: 'member — envia métricas para uma central',
  configMember: (e) => `member — envia métricas para uma central em ${e}`,
  configMembers: (n) => `member — envia métricas para ${n} centrais`,
  configMemberLine: (endpoint, suffix) => `  ↳ ${endpoint}${suffix}`,
  deniedSuffix: (n) => ` · ${n} repo(s) bloqueado(s)`,
  configCentral: 'central — esta máquina hospeda a central do time',
  nothingRunning: 'nada rodando',

  confirmKill: 'Matar e subir de novo?',
  alreadyRunning: (url) => `Já tem um server rodando em ${url}.`,
  leftRunning: 'mantive o server que já estava rodando.',
  pauseMsg: 'Pressione Enter para voltar',

  startedBg: 'iniciado em background.',
  logsLabel: 'logs',
  webLabel: 'web',
  bootLabel: 'boot',
  bootNote: 'já reinicia com o Docker (restart: unless-stopped)',
  containerUp: 'container da máquina está no ar.',
  stoppingLocal: 'parando o server local…',
  stoppingCentral: 'parando o container da central…',
  stoppingMachine: 'parando o container da máquina…',
  restartingLocal: 'reiniciando o server local…',
  restartingCentral: 'reiniciando o container da central…',
  restartingMachine: 'reiniciando o container da máquina…',
  rebuildingCentral: 'reconstruindo a imagem da central e recriando…',
  rebuildingMachine: 'reconstruindo a imagem da máquina e recriando…',
  rebuildingLocal: 'reconstruindo o server nativo (bun run bin)…',
  localRebuildHint: '--rebuild precisa do repo para reconstruir o server nativo. Rode de dentro do checkout do agentistics, ou use `agentop upgrade`. Reiniciando o build atual.',
  localRebuildFailed: 'falha ao reconstruir o server nativo — reiniciando o build atual.',
  restartedAll: 'todos os serviços no ar foram reiniciados.',
  restartedDone: 'serviço reiniciado.',
  noComposeFrom: (dir) => `não achei docker-compose.machine.yml em ${dir}.`,
  runFromRepo: 'Rode agentop start de dentro do repo agentistics para usar Docker.',
  buildingMachine: 'buildando & subindo o container da máquina…',

  urlOpened: url => `abriu ${url}`,
  urlOpenFailed: 'não foi possível abrir um navegador daqui',

  svcAgentistics: 'agentistics',
  svcCentral: 'agentistics central',
  svcConflict: (runtimes) => `conflito: ${runtimes.join(' + ')} rodando juntos — pare um`,
  svcNotRunning: 'esse serviço não está rodando.',
  dockerMissing: 'docker não instalado',
  dockerUnreachable: 'docker instalado, mas não responde',
  foregroundLater: 'o foreground sobe assim que esta tela fechar.',
  useRestartInstead: 'Use Reiniciar para trocar.',

  optForeground: 'Iniciar (neste terminal)',
  optForegroundHint: 'roda aqui até você sair',
  optBackground: 'Iniciar (background)',
  optBackgroundHint: 'destacado — continua rodando',
  optDockerForeground: 'Iniciar (docker, neste terminal)',
  optDockerForegroundHint: 'em primeiro plano — Ctrl-C para parar',
  optDockerBackground: 'Iniciar (docker, background)',
  optDockerBackgroundHint: 'destacado — o mesmo server, em um container',
  optCentral: 'Iniciar',
  optCentralHint: 'a central do time, em Docker',
  optCentralNativeForeground: 'Iniciar (neste terminal)',
  optCentralNativeForegroundHint: 'roda aqui até você sair — sem Docker',
  optCentralNativeBackground: 'Iniciar (background)',
  optCentralNativeBackgroundHint: 'destacado — continua rodando, sem Docker',
  stopRuntime: (runtime) => `Parar (${runtime})`,
  optRestart: 'Reiniciar',
  optRestartHint: 'só reinicia — mesmo build',
  optRebuild: 'Reconstruir & reiniciar',
  optRebuildRuntime: (runtime) => `Reconstruir & reiniciar (${runtime})`,
  optRebuildNativeHint: 'recompila o binário (bun run bin) e depois reinicia',
  optRebuildDockerHint: 'reconstrói a imagem e recria o container',
  archiveUnsetHint: 'a preservação do histórico ainda não foi definida — veja a aba Setup',
  dockerStartFailed: 'o container da máquina não subiu.',
  centralStarted: 'agentistics central está no ar.',
  centralFailed: 'a central não subiu.',
  centralInitDone: 'central configurada.',
  centralInitFailed: 'o init da central não terminou.',
  connected: 'conectado — esta máquina agora é member.',
  connectFailed: 'não consegui conectar na central.',
  disconnected: 'desconectado — esta máquina voltou para solo.',
  disconnectFailed: 'não consegui desconectar da central.',
  stoppedAll: 'todos os serviços no ar foram parados.',
  stoppedDone: 'serviço parado.',
  soloSet: 'modo solo definido — nada sai desta máquina.',
  archiveSet: (mode) => `preservação do histórico definida como ${mode}.`,
  prefsWriteFailed: 'não consegui gravar as preferências.',

  updateCriticalTitle: 'Atualização crítica — instalando automaticamente',
  updateCriticalInstalling: (v) => `a v${v} está sendo instalada em segundo plano; seu terminal está livre.`,
  updateCriticalLog: (p) => `Acompanhe em: ${p}`,
  updateCriticalRunning: 'Uma atualização crítica já está sendo instalada em segundo plano.',
  updateCriticalManualTitle: 'Atualização crítica disponível',
  updateCriticalManualHow: (cmd) => `Instale com ${cmd} — a instalação automática é opt-in (AGENTISTICS_AUTO_UPGRADE=1).`,
  updateCriticalUnsupported: (target) => `A instalação automática não está disponível para ${target} — instale manualmente.`,
  updateCriticalRetryLater: 'Uma atualização crítica falhou antes; ela será tentada de novo mais tarde.',

  upgradeVerifying: '  Verificando o binário baixado…',
  upgradeFromSource: (execPath) => `Upgrade recusado: isto é um checkout do código, então atualizar sobrescreveria ${execPath}. Gere/instale o binário (bun run build:binary).`,
  upgradeInProgress: (pid) => `Já existe uma atualização rodando (pid ${pid}) — nada a fazer.`,
  upgradeLockUnavailable: 'Não consegui escrever o lock de upgrade; seguindo sem ele.',
  upgradeUnsupported: (target) => `Não existe release do agentop para ${target}, então ele não pode se atualizar sozinho.`,
  upgradeManualHow: (url) => `Baixe o binário da sua plataforma e troque na mão: ${url}`,
  upgradeVerifyFailed: (reason) => `Upgrade abortado: ${reason}.`,
  upgradeRolledBack: (backup) => `O binário anterior foi restaurado de ${backup}.`,
  upgradeUntouched: 'O binário instalado não foi tocado.',
  upgradeBackupKept: (backup) => `Binário anterior mantido em ${backup}.`,
  upgradeRestartFailed: (version) => `a v${version} foi instalada, mas alguns serviços NÃO foram reiniciados nela:`,
  upgradeRestartHint: 'Reinicie na mão (ex.: `agentop restart --all`) — eles ainda rodam a versão antiga.',

  cancel: 'Cancelar',
  leaveWhich: 'Sair de qual central?',
  leaveAll: 'Sair de todas as centrais',
  leftOne: (endpoint) => `saiu de ${endpoint}`,
  leftAll: (n) => `saiu de todas as ${n} ${n === 1 ? 'central' : 'centrais'} — de volta para solo.`,
  stillConnected: (n) => `ainda conectado a ${n} central(is).`,
  noConnections: 'sem conexão com nenhuma central.',
  ambiguousLeave: (n) => `conectado a ${n} centrais — use --endpoint <url> ou --all.`,
  connectedAs: (user, n) => `conectado como ${user} — ${n} central(is) no total.`,
  updatedExisting: (endpoint) => `atualizou a conexão existente com ${endpoint}`,
  tokenInUse: (endpoint) => `esse token já pertence a ${endpoint}`,
  noMatchEndpoint: (endpoint) => `nenhuma conexão corresponde ao endpoint ${endpoint}`,
  localServerUnknown: 'desconhecido (o server local não está rodando)',
  stateAuthRejected: 'token rejeitado pela central',
  stateNetUnreachable: 'central inacessível',
  stateOk: 'ok',
  neverSynced: 'nunca',
}

const TABLE: Record<CliLang, CliStrings> = { en: EN, pt: PT }

export function cliStrings(lang: CliLang): CliStrings {
  return TABLE[lang] ?? EN
}

/**
 * Resolve the CLI language: `--lang en|pt` wins, else `preferences.lang` (shared with the web
 * toggle), else English. Lives here (not in cli-start.ts, its original home) so cli-member.ts can
 * share it without a circular import — cli-start.ts already imports memberConnect/memberLeave
 * from cli-member.ts, so the reverse import would form a cycle.
 */
export async function resolveLang(): Promise<CliLang> {
  const i = process.argv.indexOf('--lang')
  const flag = i >= 0 ? process.argv[i + 1] : undefined
  if (flag === 'pt' || flag === 'en') return flag
  try {
    const { readPreferences } = await import('./preferences')
    const prefs = await readPreferences()
    return prefs.lang === 'pt' ? 'pt' : 'en'
  } catch {
    return 'en'
  }
}
