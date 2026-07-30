/**
 * cli-i18n.ts — English/Portuguese strings for the interactive `agentop start` launcher.
 *
 * The CLI is English by default. The language follows `preferences.lang` (shared with the web
 * toggle), an in-launcher toggle that persists there, or a `--lang en|pt` flag. These strings are
 * CLI-specific (the @agentistics/core i18n keys are web-focused), kept here so the launcher stays
 * self-contained and bundles cleanly into the binary.
 */

export type CliLang = 'en' | 'pt'

export interface CliStrings {
  tagline: string
  configLabel: string
  runningLabel: string
  configSolo: string
  configMember: (endpoint: string) => string
  configMembers: (n: number) => string
  configMemberLine: (endpoint: string, suffix: string) => string
  deniedSuffix: (n: number) => string
  configCentral: string
  runAgentistics: string
  runCentral: string
  runMachine: string
  nothingRunning: string

  menuTitle: string
  itemAgentistics: string
  itemAgentisticsHint: string
  itemCentral: string
  itemCentralHint: string
  itemConnect: string
  itemConnectHint: string
  itemConnectMore: string
  itemDisconnect: string
  itemDisconnectHint: string
  itemDisconnectMultiHint: string
  itemStop: string
  itemRestart: string
  itemRestartHint: string
  itemLanguage: string
  quit: string
  back: string

  howTitle: string
  foreground: string
  foregroundHint: string
  background: string
  backgroundHint: string
  docker: string
  dockerHint: string
  centralDockerHint: string

  promptEndpoint: string
  promptToken: string
  promptOrg: string
  confirmBoot: string
  confirmKill: string
  alreadyRunning: (url: string) => string
  leftRunning: string
  pauseMsg: string

  stopWhich: string
  stopLocal: string
  stopCentral: string
  stopMachine: string
  stopEverything: string
  cancel: string

  startedBg: string
  logsLabel: string
  webLabel: string
  bootLabel: string
  bootNote: string
  containerUp: string
  stoppingLocal: string
  stoppingCentral: string
  stoppingMachine: string
  restartWhich: string
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
}

const EN: CliStrings = {
  tagline: 'AI coding-assistant analytics · agentop',
  configLabel: 'config',
  runningLabel: 'running',
  configSolo: 'solo — nothing leaves this machine',
  configMember: (e) => `member — sends metrics to a central at ${e}`,
  configMembers: (n) => `member — sends metrics to ${n} centrals`,
  configMemberLine: (endpoint, suffix) => `  ↳ ${endpoint}${suffix}`,
  deniedSuffix: (n) => ` · ${n} repo(s) blocked`,
  configCentral: 'central — this machine hosts the team central',
  runAgentistics: 'agentistics    (this machine)',
  runCentral: 'agentistics central    (docker)',
  runMachine: 'agentistics    (docker)',
  nothingRunning: 'nothing running',

  menuTitle: 'What would you like to start?',
  itemAgentistics: 'agentistics',
  itemAgentisticsHint: 'this machine',
  itemCentral: 'agentistics central',
  itemCentralHint: 'team aggregator · :48080',
  itemConnect: 'Connect to a central',
  itemConnectHint: 'send my metrics (become a member)',
  itemConnectMore: 'Add another central',
  itemDisconnect: 'Disconnect from the central',
  itemDisconnectHint: 'back to solo',
  itemDisconnectMultiHint: 'pick a central to leave',
  itemStop: 'Stop a running service…',
  itemRestart: 'Restart a running service…',
  itemRestartHint: 'one, or all',
  itemLanguage: 'Switch to Português',
  quit: 'Quit',
  back: 'Back',

  howTitle: 'How should it run?',
  foreground: 'Foreground',
  foregroundHint: 'this terminal',
  background: 'Background',
  backgroundHint: 'detached',
  docker: 'Docker',
  dockerHint: 'container',
  centralDockerHint: 'bundles MongoDB · :48080',

  promptEndpoint: 'Central endpoint URL (e.g. http://host:48080)',
  promptToken: "Member token (from the central's Team Manager)",
  promptOrg: 'Org',
  confirmBoot: 'Also start it on every boot (systemd service)?',
  confirmKill: 'Kill it and start fresh?',
  alreadyRunning: (url) => `A server is already running on ${url}.`,
  leftRunning: 'left the running server as-is.',
  pauseMsg: 'Press Enter to go back',

  stopWhich: 'Stop which?',
  stopLocal: 'agentistics (local server)',
  stopCentral: 'agentistics central (docker)',
  stopMachine: 'agentistics (docker)',
  stopEverything: 'Everything',
  cancel: 'Cancel',

  startedBg: 'started in the background.',
  logsLabel: 'logs',
  webLabel: 'web',
  bootLabel: 'boot',
  bootNote: 'it already restarts with Docker (restart: unless-stopped)',
  containerUp: 'machine container is up.',
  stoppingLocal: 'stopping the local server…',
  stoppingCentral: 'stopping the central container…',
  stoppingMachine: 'stopping the machine container…',
  restartWhich: 'Restart which?',
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

  leaveWhich: 'Leave which central?',
  leaveAll: 'Leave all centrals',
  leftOne: (endpoint) => `left ${endpoint}`,
  leftAll: (n) => `left all ${n} centrals — back to solo.`,
  stillConnected: (n) => `still connected to ${n} central(s).`,
  noConnections: 'not connected to any central.',
  ambiguousLeave: (n) => `connected to ${n} centrals — pass --endpoint <url> or --all.`,
  connectedAs: (user, n) => `connected as ${user} — ${n} central(s) total.`,
  updatedExisting: (endpoint) => `updated the existing connection to ${endpoint}`,
  tokenInUse: (endpoint) => `that token already belongs to ${endpoint}`,
}

const PT: CliStrings = {
  tagline: 'Analytics de assistentes de código IA · agentop',
  configLabel: 'config',
  runningLabel: 'no ar',
  configSolo: 'solo — nada sai desta máquina',
  configMember: (e) => `member — envia métricas para uma central em ${e}`,
  configMembers: (n) => `member — envia métricas para ${n} centrais`,
  configMemberLine: (endpoint, suffix) => `  ↳ ${endpoint}${suffix}`,
  deniedSuffix: (n) => ` · ${n} repo(s) bloqueado(s)`,
  configCentral: 'central — esta máquina hospeda a central do time',
  runAgentistics: 'agentistics    (esta máquina)',
  runCentral: 'agentistics central    (docker)',
  runMachine: 'agentistics    (docker)',
  nothingRunning: 'nada rodando',

  menuTitle: 'O que você quer iniciar?',
  itemAgentistics: 'agentistics',
  itemAgentisticsHint: 'esta máquina',
  itemCentral: 'agentistics central',
  itemCentralHint: 'agregador do time · :48080',
  itemConnect: 'Conectar a uma central',
  itemConnectHint: 'enviar minhas métricas (virar member)',
  itemConnectMore: 'Adicionar outra central',
  itemDisconnect: 'Desconectar da central',
  itemDisconnectHint: 'voltar para solo',
  itemDisconnectMultiHint: 'escolher de qual central sair',
  itemStop: 'Parar um serviço…',
  itemRestart: 'Reiniciar um serviço…',
  itemRestartHint: 'um, ou todos',
  itemLanguage: 'Trocar para English',
  quit: 'Sair',
  back: 'Voltar',

  howTitle: 'Como rodar?',
  foreground: 'Foreground',
  foregroundHint: 'neste terminal',
  background: 'Background',
  backgroundHint: 'destacado',
  docker: 'Docker',
  dockerHint: 'container',
  centralDockerHint: 'embute o MongoDB · :48080',

  promptEndpoint: 'URL da central (ex.: http://host:48080)',
  promptToken: 'Token do member (no Team Manager da central)',
  promptOrg: 'Org',
  confirmBoot: 'Iniciar também no boot (serviço systemd)?',
  confirmKill: 'Matar e subir de novo?',
  alreadyRunning: (url) => `Já tem um server rodando em ${url}.`,
  leftRunning: 'mantive o server que já estava rodando.',
  pauseMsg: 'Pressione Enter para voltar',

  stopWhich: 'Parar o quê?',
  stopLocal: 'agentistics (server local)',
  stopCentral: 'agentistics central (docker)',
  stopMachine: 'agentistics (docker)',
  stopEverything: 'Tudo',
  cancel: 'Cancelar',

  startedBg: 'iniciado em background.',
  logsLabel: 'logs',
  webLabel: 'web',
  bootLabel: 'boot',
  bootNote: 'já reinicia com o Docker (restart: unless-stopped)',
  containerUp: 'container da máquina está no ar.',
  stoppingLocal: 'parando o server local…',
  stoppingCentral: 'parando o container da central…',
  stoppingMachine: 'parando o container da máquina…',
  restartWhich: 'Reiniciar o quê?',
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

  leaveWhich: 'Sair de qual central?',
  leaveAll: 'Sair de todas as centrais',
  leftOne: (endpoint) => `saiu de ${endpoint}`,
  leftAll: (n) => `saiu de todas as ${n} centrais — de volta para solo.`,
  stillConnected: (n) => `ainda conectado a ${n} central(is).`,
  noConnections: 'sem conexão com nenhuma central.',
  ambiguousLeave: (n) => `conectado a ${n} centrais — use --endpoint <url> ou --all.`,
  connectedAs: (user, n) => `conectado como ${user} — ${n} central(is) no total.`,
  updatedExisting: (endpoint) => `atualizou a conexão existente com ${endpoint}`,
  tokenInUse: (endpoint) => `esse token já pertence a ${endpoint}`,
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
