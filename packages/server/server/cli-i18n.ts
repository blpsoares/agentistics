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
  disconnected: string
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
  optDocker: string
  optDockerHint: string
  optCentral: string
  optCentralHint: string
  /** `Stop (native)` / `Stop (docker)` — offered only to break a conflict. */
  stopRuntime: (runtime: string) => string
  archiveUnsetHint: string
  dockerStartFailed: string
  centralStarted: string
  centralFailed: string
  centralInitDone: string
  centralInitFailed: string
  connected: string
  connectFailed: string
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
}

const EN: CliStrings = {
  tagline: 'AI coding-assistant analytics · agentop',
  configSolo: 'solo — nothing leaves this machine',
  configMemberBare: 'member — sends metrics to a central',
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
  disconnected: 'disconnected — this machine is back to solo.',
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
  optDocker: 'Start (docker)',
  optDockerHint: 'the same server, in a container',
  optCentral: 'Start',
  optCentralHint: 'the team central, in Docker',
  stopRuntime: (runtime) => `Stop (${runtime})`,
  archiveUnsetHint: 'history preservation is still unset — see the Setup tab',
  dockerStartFailed: 'the machine container did not start.',
  centralStarted: 'agentistics central is up.',
  centralFailed: 'the central did not start.',
  centralInitDone: 'central configured.',
  centralInitFailed: 'central init did not complete.',
  connected: 'connected — this machine is now a member.',
  connectFailed: 'could not connect to the central.',
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
}

const PT: CliStrings = {
  tagline: 'Analytics de assistentes de código IA · agentop',
  configSolo: 'solo — nada sai desta máquina',
  configMemberBare: 'member — envia métricas para uma central',
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
  disconnected: 'desconectado — esta máquina voltou para solo.',
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
  optDocker: 'Iniciar (docker)',
  optDockerHint: 'o mesmo server, em um container',
  optCentral: 'Iniciar',
  optCentralHint: 'a central do time, em Docker',
  stopRuntime: (runtime) => `Parar (${runtime})`,
  archiveUnsetHint: 'a preservação do histórico ainda não foi definida — veja a aba Setup',
  dockerStartFailed: 'o container da máquina não subiu.',
  centralStarted: 'agentistics central está no ar.',
  centralFailed: 'a central não subiu.',
  centralInitDone: 'central configurada.',
  centralInitFailed: 'o init da central não terminou.',
  connected: 'conectado — esta máquina agora é member.',
  connectFailed: 'não consegui conectar na central.',
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
}

const TABLE: Record<CliLang, CliStrings> = { en: EN, pt: PT }

export function cliStrings(lang: CliLang): CliStrings {
  return TABLE[lang] ?? EN
}
