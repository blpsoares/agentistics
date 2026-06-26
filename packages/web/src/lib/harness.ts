import type { HarnessId, HarnessCapabilities } from '@agentistics/core'
import { HARNESS_CAPABILITIES } from '@agentistics/core'

export const HARNESS_LABELS: Record<HarnessId, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
  copilot: 'Copilot CLI',
}

export const HARNESS_COLORS: Record<HarnessId, string> = {
  claude: '#D97706',
  codex: '#10a37f',
  gemini: '#4285f4',
  copilot: '#6e7681',
}

/** Provider name shown in pricing links. */
export const HARNESS_PROVIDERS: Record<HarnessId, string> = {
  claude: 'Anthropic',
  codex: 'OpenAI',
  gemini: 'Google',
  copilot: 'GitHub Copilot',
}

export function capable(harness: HarnessId, metric: keyof HarnessCapabilities): boolean {
  return HARNESS_CAPABILITIES[harness][metric]
}

/** Bilingual text pair. */
export interface Loc {
  pt: string
  en: string
}

export interface HarnessInfo {
  source: string[]
  contains: Loc[]
  missing: { item: Loc; why: Loc }[]
  note?: Loc
  /** Short description of the on-disk format agentistics parses. */
  format?: Loc
  /** How long the data sticks around (cleanup/retention behavior). */
  retention?: Loc
  /** One-line summary of the harness shown at the top of the panel. */
  blurb?: Loc
  /** Link to the provider's official pricing page. */
  pricingUrl?: string
}

export const HARNESS_INFO: Record<HarnessId, HarnessInfo> = {
  claude: {
    blurb: {
      en: 'The richest source — full token, cost, model, tool, sub-agent and git data, with aggregate history that outlives transcript cleanup.',
      pt: 'A fonte mais completa — dados de tokens, custos, modelo, ferramentas, sub-agentes e Git, com histórico agregado que sobrevive à limpeza de transcrições.',
    },
    format: {
      en: 'JSONL transcripts (one event per line) plus a pre-aggregated stats-cache.json and per-session meta files.',
      pt: 'Transcrições JSONL (um evento por linha), além de stats-cache.json pré-agregado e arquivos de metadados por sessão.',
    },
    retention: {
      en: 'Transcripts are deleted after the cleanup window (default 30 days), but stats-cache.json keeps the aggregate totals indefinitely.',
      pt: 'As transcrições são excluídas após a janela de limpeza (padrão 30 dias), mas o stats-cache.json mantém os totais agregados indefinidamente.',
    },
    source: [
      '~/.claude/stats-cache.json (aggregate history)',
      '~/.claude/projects/**/*.jsonl (transcripts)',
      '~/.claude/usage-data/session-meta/',
    ],
    contains: [
      { en: 'Tokens (input, output, cache read/write)', pt: 'Tokens (entrada, saída, leitura/escrita de cache)' },
      { en: 'Cost (USD)', pt: 'Custo (USD)' },
      { en: 'Model per session', pt: 'Modelo por sessão' },
      { en: 'Tool usage', pt: 'Uso de ferramentas' },
      { en: 'Sub-agent metrics', pt: 'Métricas de sub-agentes' },
      { en: 'Git line counts', pt: 'Contagem de linhas Git' },
      { en: 'Full session history', pt: 'Histórico completo de sessões' },
    ],
    missing: [],
    note: {
      en: 'The stats cache retains aggregate totals even after Claude Code deletes transcripts older than its cleanup window (default 30 days), so historical session/token/cost totals survive.',
      pt: 'O cache de estatísticas retém os totais agregados mesmo após o Claude Code excluir transcrições mais antigas que sua janela de limpeza (padrão 30 dias), portanto os totais históricos de sessões/tokens/custos sobrevivem.',
    },
    pricingUrl: 'https://www.anthropic.com/pricing',
  },
  codex: {
    blurb: {
      en: 'Near-parity with Claude — real tokens, cost, model and tool usage from full rollout transcripts.',
      pt: 'Paridade quase total com o Claude — tokens reais, custo, modelo e uso de ferramentas a partir de transcrições completas de rollout.',
    },
    format: {
      en: 'Envelope JSONL rollouts (event_msg / response_item wrappers); token usage at payload.info.total_token_usage (cumulative).',
      pt: 'JSONL envelope de rollouts (invólucros event_msg / response_item); uso de tokens em payload.info.total_token_usage (cumulativo).',
    },
    retention: {
      en: 'Codex prunes old rollouts over time; agentistics consolidates per-session metrics so they survive cleanup.',
      pt: 'O Codex remove rollouts antigos ao longo do tempo; o agentistics consolida métricas por sessão para que sobrevivam à limpeza.',
    },
    source: [
      '~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl',
    ],
    contains: [
      { en: 'Tokens (input, cached, output)', pt: 'Tokens (entrada, cache, saída)' },
      { en: 'Cost (USD)', pt: 'Custo (USD)' },
      { en: 'Model (e.g. gpt-5.5)', pt: 'Modelo (ex.: gpt-5.5)' },
      { en: 'Tool usage (e.g. web search)', pt: 'Uso de ferramentas (ex.: pesquisa web)' },
      { en: 'Messages', pt: 'Mensagens' },
      { en: 'Project (working directory)', pt: 'Projeto (diretório de trabalho)' },
    ],
    missing: [
      {
        item: { en: 'Sub-agent metrics', pt: 'Métricas de sub-agentes' },
        why: { en: 'Codex does not record per-subagent breakdowns in its transcripts.', pt: 'O Codex não registra detalhamentos por sub-agente em suas transcrições.' },
      },
      {
        item: { en: 'Git line counts', pt: 'Contagem de linhas Git' },
        why: { en: 'Not present in Codex transcripts.', pt: 'Não está presente nas transcrições do Codex.' },
      },
    ],
    note: {
      en: 'Codex reports input_tokens including the cached portion; agentistics stores the non-cached input separately from cache reads so cost is not double-counted.',
      pt: 'O Codex reporta input_tokens incluindo a parcela em cache; o agentistics armazena a entrada não cacheada separadamente das leituras de cache para evitar dupla contagem nos custos.',
    },
    pricingUrl: 'https://platform.openai.com/docs/pricing',
  },
  gemini: {
    blurb: {
      en: 'Real token/cost/model data from the rich local chat format — but only genuine sessions count (most local files are bootstrap stubs).',
      pt: 'Dados reais de tokens/custo/modelo a partir do rico formato de chat local — mas apenas sessões genuínas são contadas (a maioria dos arquivos locais são stubs de bootstrap).',
    },
    format: {
      en: 'Rich JSON chat files with per-message tokens{input,output,cached} and model; legacy JSONL stubs are filtered out.',
      pt: 'Arquivos JSON ricos de chat com tokens por mensagem {entrada,saída,cache} e modelo; stubs JSONL legados são filtrados.',
    },
    retention: {
      en: 'Gemini CLI applies a session retention window (~30 days) similar to Claude.',
      pt: 'O Gemini CLI aplica uma janela de retenção de sessão (~30 dias) similar ao Claude.',
    },
    source: [
      '~/.gemini/tmp/<project>/chats/*.json (rich session format)',
      '~/.gemini/projects.json (project names)',
    ],
    contains: [
      { en: 'Sessions', pt: 'Sessões' },
      { en: 'Projects', pt: 'Projetos' },
      { en: 'Messages', pt: 'Mensagens' },
      { en: 'Tokens (input, output, cache)', pt: 'Tokens (entrada, saída, cache)' },
      { en: 'Cost (USD)', pt: 'Custo (USD)' },
      { en: 'Model per session', pt: 'Modelo por sessão' },
      { en: 'Tool usage', pt: 'Uso de ferramentas' },
      { en: 'Activity (real-content sessions only)', pt: 'Atividade (somente sessões com conteúdo real)' },
    ],
    missing: [
      {
        item: { en: 'Sub-agent metrics', pt: 'Métricas de sub-agentes' },
        why: { en: 'Gemini CLI does not record per-subagent breakdowns.', pt: 'O Gemini CLI não registra detalhamentos por sub-agente.' },
      },
      {
        item: { en: 'Git line counts', pt: 'Contagem de linhas Git' },
        why: { en: 'Not present in Gemini session files.', pt: 'Não está presente nos arquivos de sessão do Gemini.' },
      },
    ],
    note: {
      en: 'Many local Gemini files are bootstrap-only stubs with no real conversation — only sessions containing genuine user messages are counted. Token/cost/model data comes from the rich ~/.gemini/tmp/<project>/chats/*.json format. Agent metrics and git line counts are N/A.',
      pt: 'Muitos arquivos locais do Gemini são stubs somente de bootstrap sem conversa real — apenas sessões com mensagens genuínas de usuário são contadas. Dados de tokens/custo/modelo vêm do formato rico ~/.gemini/tmp/<projeto>/chats/*.json. Métricas de agentes e contagem de linhas Git são N/A.',
    },
    pricingUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
  },
  copilot: {
    blurb: {
      en: 'Sessions, project/branch, messages and assistant turns — plus tokens/cost/model/git-lines on a clean exit.',
      pt: 'Sessões, projeto/branch, mensagens e turnos do assistente — além de tokens/custo/modelo/linhas-Git em saída limpa.',
    },
    format: {
      en: 'events.jsonl (session.start, user.message, assistant.message/turns, session.shutdown with per-model metrics).',
      pt: 'events.jsonl (session.start, user.message, assistant.message/turns, session.shutdown com métricas por modelo).',
    },
    retention: {
      en: 'Local session-state persists per session; token/cost/model/line data is only present when the session shut down cleanly.',
      pt: 'O estado da sessão local persiste por sessão; dados de tokens/custo/modelo/linhas só estão presentes quando a sessão encerrou normalmente.',
    },
    source: [
      '~/.copilot/session-state/<id>/events.jsonl',
      '~/.copilot/session-state/<id>/workspace.yaml',
    ],
    contains: [
      { en: 'Sessions', pt: 'Sessões' },
      { en: 'Project / repository / branch', pt: 'Projeto / repositório / branch' },
      { en: 'Messages', pt: 'Mensagens' },
      { en: 'Assistant turns', pt: 'Turnos do assistente' },
      { en: 'Tokens (input, output)', pt: 'Tokens (entrada, saída)' },
      { en: 'Cost (USD)', pt: 'Custo (USD)' },
      { en: 'Model per session', pt: 'Modelo por sessão' },
      { en: 'Git line counts', pt: 'Contagem de linhas Git' },
      { en: 'MCP usage', pt: 'Uso de MCP' },
      { en: 'Activity', pt: 'Atividade' },
    ],
    missing: [
      {
        item: { en: 'Tool usage', pt: 'Uso de ferramentas' },
        why: { en: 'Copilot CLI does not record per-tool call breakdowns.', pt: 'O Copilot CLI não registra detalhamentos por chamada de ferramenta.' },
      },
      {
        item: { en: 'Sub-agent metrics', pt: 'Métricas de sub-agentes' },
        why: { en: 'Not available in Copilot local event logs.', pt: 'Não disponível nos logs de eventos locais do Copilot.' },
      },
    ],
    note: {
      en: 'Token/cost/model/git-lines data is emitted in the session.shutdown event on clean exit only — sessions that crashed will show 0 for those fields.',
      pt: 'Dados de tokens/custo/modelo/linhas-Git são emitidos no evento session.shutdown somente em saída limpa — sessões que travaram exibirão 0 nesses campos.',
    },
    pricingUrl: 'https://docs.github.com/en/copilot/about-github-copilot/plans-for-github-copilot',
  },
}
