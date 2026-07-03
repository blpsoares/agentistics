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
  itemDisconnect: string
  itemDisconnectHint: string
  itemStop: string
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
  disconnected: string
  noComposeFrom: (dir: string) => string
  runFromRepo: string
  buildingMachine: string
}

const EN: CliStrings = {
  tagline: 'AI coding-assistant analytics · agentop',
  configLabel: 'config',
  runningLabel: 'running',
  configSolo: 'solo — nothing leaves this machine',
  configMember: (e) => `member — sends metrics to a central at ${e}`,
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
  itemDisconnect: 'Disconnect from the central',
  itemDisconnectHint: 'back to solo',
  itemStop: 'Stop a running service…',
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
  disconnected: 'disconnected — this machine is back to solo.',
  noComposeFrom: (dir) => `couldn't find docker-compose.machine.yml in ${dir}.`,
  runFromRepo: 'Run agentop start from the agentistics repo to use Docker.',
  buildingMachine: 'building & starting the machine container…',
}

const PT: CliStrings = {
  tagline: 'Analytics de assistentes de código IA · agentop',
  configLabel: 'config',
  runningLabel: 'no ar',
  configSolo: 'solo — nada sai desta máquina',
  configMember: (e) => `member — envia métricas para uma central em ${e}`,
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
  itemDisconnect: 'Desconectar da central',
  itemDisconnectHint: 'voltar para solo',
  itemStop: 'Parar um serviço…',
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
  disconnected: 'desconectado — esta máquina voltou para solo.',
  noComposeFrom: (dir) => `não achei docker-compose.machine.yml em ${dir}.`,
  runFromRepo: 'Rode agentop start de dentro do repo agentistics para usar Docker.',
  buildingMachine: 'buildando & subindo o container da máquina…',
}

const TABLE: Record<CliLang, CliStrings> = { en: EN, pt: PT }

export function cliStrings(lang: CliLang): CliStrings {
  return TABLE[lang] ?? EN
}
