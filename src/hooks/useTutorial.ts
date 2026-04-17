import { useCallback, useEffect, useState } from 'react'
import type { TutorialStep } from '../components/TutorialOverlay'

// ─── Step definitions ───────────────────────────────────────────────────────
// featureKey drives persistence — add a new key for each new feature group.
// "onboarding-v1" is the first-time full tour. Additional keys appear once.

export const TUTORIAL_STEPS: TutorialStep[] = [
  // ── Welcome ──────────────────────────────────────────────────────────────
  {
    id: 'welcome',
    featureKey: 'onboarding-v1',
    targetSelector: null,
    placement: 'center',
    titleEn: 'Welcome to agentistics!',
    titlePt: 'Bem-vindo ao agentistics!',
    descEn:
      'A local analytics dashboard for your AI coding assistant — Claude. It visualizes your token usage, costs, activity patterns, and agent metrics from your ~/.claude/ directory. This quick tour will show you the key features.',
    descPt:
      'Um painel de analytics local para seu assistente de IA — Claude. Ele visualiza uso de tokens, custos, padrões de atividade e métricas de agentes a partir do seu diretório ~/.claude/. Este tour rápido mostrará os principais recursos.',
  },

  // ── Stats cards ──────────────────────────────────────────────────────────
  {
    id: 'stats-cards',
    featureKey: 'onboarding-v1',
    targetSelector: '[data-tutorial-id="stats-cards"]',
    placement: 'bottom',
    titleEn: 'Key metrics at a glance',
    titlePt: 'Métricas principais em destaque',
    descEn:
      'These cards show your most important stats: messages sent, sessions, tool calls, tokens consumed, total cost, current streak, longest session, commits and files changed. Click a card to see more detail.',
    descPt:
      'Esses cartões mostram suas estatísticas mais importantes: mensagens enviadas, sessões, chamadas de ferramentas, tokens consumidos, custo total, sequência atual, sessão mais longa, commits e arquivos alterados. Clique em um cartão para mais detalhes.',
  },

  // ── Filters bar ──────────────────────────────────────────────────────────
  {
    id: 'filters',
    featureKey: 'onboarding-v1',
    targetSelector: '[data-tutorial-id="filters-bar"]',
    placement: 'bottom',
    titleEn: 'Filter your data',
    titlePt: 'Filtre seus dados',
    descEn:
      'Filter by date range (today, this week, this month, custom), project, or model. All charts and cards update instantly to reflect your selection.',
    descPt:
      'Filtre por período (hoje, esta semana, este mês, personalizado), projeto ou modelo. Todos os gráficos e cartões atualizam instantaneamente para refletir sua seleção.',
  },

  // ── Activity heatmap ─────────────────────────────────────────────────────
  {
    id: 'heatmap',
    featureKey: 'onboarding-v1',
    targetSelector: '[data-tutorial-id="activity-heatmap"]',
    placement: 'top',
    titleEn: 'Activity heatmap',
    titlePt: 'Mapa de calor de atividade',
    descEn:
      'A GitHub-style heatmap of your coding sessions. Each square represents one day — darker means more activity. Hover a square to see the exact token count and cost for that day.',
    descPt:
      'Um mapa de calor estilo GitHub das suas sessões de codificação. Cada quadrado representa um dia — mais escuro significa mais atividade. Passe o mouse sobre um quadrado para ver a contagem exata de tokens e custo naquele dia.',
  },

  // ── Navigation tabs ──────────────────────────────────────────────────────
  {
    id: 'nav-tabs',
    featureKey: 'onboarding-v1',
    targetSelector: '[data-tutorial-id="nav-tabs"]',
    placement: 'bottom',
    titleEn: 'Navigate between views',
    titlePt: 'Navegue entre as visões',
    descEn:
      'Five pages: Home (overview), Costs (spend breakdown by model), Projects (per-project usage + git stats), Tools (tool call breakdown + agent metrics), and Custom (build your own dashboard).',
    descPt:
      'Cinco páginas: Home (visão geral), Costs (gastos por modelo), Projects (uso por projeto + estatísticas git), Tools (breakdown de ferramentas + métricas de agentes) e Custom (monte seu próprio painel).',
  },

  // ── Live updates ─────────────────────────────────────────────────────────
  {
    id: 'live-updates',
    featureKey: 'onboarding-v1',
    targetSelector: '[data-tutorial-id="live-updates"]',
    placement: 'bottom',
    titleEn: 'Live updates',
    titlePt: 'Atualizações em tempo real',
    descEn:
      'Toggle live updates on/off and configure the polling interval. When enabled, the dashboard refreshes automatically as you use Claude — perfect for monitoring active sessions.',
    descPt:
      'Ative/desative atualizações em tempo real e configure o intervalo. Quando ativo, o painel atualiza automaticamente enquanto você usa o Claude — perfeito para monitorar sessões ativas.',
  },

  // ── Export PDF ───────────────────────────────────────────────────────────
  {
    id: 'export-pdf',
    featureKey: 'onboarding-v1',
    targetSelector: '[data-tutorial-id="export-pdf"]',
    placement: 'bottom',
    titleEn: 'Export PDF report',
    titlePt: 'Exportar relatório PDF',
    descEn:
      'Generate a comprehensive PDF report of your usage statistics. Includes KPI summary, cost breakdown per model, per-session cost table, and your activity heatmap — great for sharing or archiving.',
    descPt:
      'Gere um relatório PDF completo das suas estatísticas de uso. Inclui resumo de KPIs, breakdown de custos por modelo, tabela de custo por sessão e seu mapa de calor de atividade — ótimo para compartilhar ou arquivar.',
  },

  // ── Preferences ──────────────────────────────────────────────────────────
  {
    id: 'preferences',
    featureKey: 'onboarding-v1',
    targetSelector: '[data-tutorial-id="prefs-btn"]',
    placement: 'bottom',
    titleEn: 'Preferences',
    titlePt: 'Preferências',
    descEn:
      'Configure a monthly budget limit (shows a progress bar on the cost card), reorder the stat cards via drag-and-drop, switch between USD/BRL, and toggle between dark and light themes.',
    descPt:
      'Configure um limite de orçamento mensal (exibe uma barra de progresso no cartão de custo), reordene os cartões via drag-and-drop, alterne entre USD/BRL e escolha entre tema escuro e claro.',
  },

  // ── Language / Theme ─────────────────────────────────────────────────────
  {
    id: 'lang-theme',
    featureKey: 'onboarding-v1',
    targetSelector: '[data-tutorial-id="lang-toggle"]',
    placement: 'bottom',
    titleEn: 'Language & theme',
    titlePt: 'Idioma e tema',
    descEn:
      'Switch the interface between English and Portuguese. The sun/moon button next to it toggles between light and dark themes. Your preference is saved automatically.',
    descPt:
      'Alterne a interface entre inglês e português. O botão sol/lua ao lado alterna entre tema claro e escuro. Sua preferência é salva automaticamente.',
  },

  // ── Costs page ───────────────────────────────────────────────────────────
  {
    id: 'costs-page',
    featureKey: 'onboarding-v1',
    targetSelector: null,
    placement: 'center',
    titleEn: 'Costs page',
    titlePt: 'Página de Costs',
    descEn:
      'The Costs page deep-dives into your spending: model-by-model cost breakdown, cache hit rate (which directly reduces costs), and a live pricing table. Set a monthly budget to track your burn rate.',
    descPt:
      'A página Costs aprofunda seus gastos: breakdown de custo por modelo, taxa de acertos do cache (que reduz custos diretamente) e tabela de preços ao vivo. Defina um orçamento mensal para acompanhar seu ritmo de gasto.',
  },

  // ── Projects page ────────────────────────────────────────────────────────
  {
    id: 'projects-page',
    featureKey: 'onboarding-v1',
    targetSelector: null,
    placement: 'center',
    titleEn: 'Projects page',
    titlePt: 'Página de Projects',
    descEn:
      'The Projects page shows token and cost usage per project, alongside git statistics (commits, files changed, lines added/removed). Great for understanding which projects consume the most AI time.',
    descPt:
      'A página Projects mostra uso de tokens e custo por projeto, junto com estatísticas git (commits, arquivos alterados, linhas adicionadas/removidas). Ótimo para entender quais projetos consomem mais tempo de IA.',
  },

  // ── Tools page ───────────────────────────────────────────────────────────
  {
    id: 'tools-page',
    featureKey: 'onboarding-v1',
    targetSelector: null,
    placement: 'center',
    titleEn: 'Tools page',
    titlePt: 'Página de Tools',
    descEn:
      'The Tools page breaks down every tool Claude used (Read, Write, Bash, Grep, etc.), how many times, and the Agent sub-invocations with their token cost. Understand exactly what Claude does under the hood.',
    descPt:
      'A página Tools detalha cada ferramenta usada pelo Claude (Read, Write, Bash, Grep, etc.), quantas vezes, e as sub-invocações de Agentes com seu custo em tokens. Entenda exatamente o que o Claude faz por baixo.',
  },

  // ── Custom page intro ────────────────────────────────────────────────────
  {
    id: 'custom-page-teaser',
    featureKey: 'onboarding-v1',
    targetSelector: null,
    placement: 'center',
    titleEn: 'Custom dashboard',
    titlePt: 'Painel customizado',
    descEn:
      'The Custom page lets you build a personalized dashboard: pick the widgets you want, resize and rearrange them freely, pin specific projects, and save multiple named layouts. Visit it next!',
    descPt:
      'A página Custom permite montar um painel personalizado: escolha os widgets que quer, redimensione e reorganize livremente, fixe projetos específicos e salve múltiplos layouts nomeados. Visite-a em seguida!',
  },
]

// Custom-page-specific tutorial (featureKey: 'custom-page-v1')
export const CUSTOM_PAGE_STEPS: TutorialStep[] = [
  {
    id: 'custom-welcome',
    featureKey: 'custom-page-v1',
    targetSelector: null,
    placement: 'center',
    titleEn: 'Custom Dashboard Builder',
    titlePt: 'Construtor de Painel Customizado',
    descEn:
      'Build your own dashboard with exactly the widgets you want. This is a fully flexible canvas — drag to rearrange, resize handles to change size, and the panel on the left to add new components.',
    descPt:
      'Monte seu próprio painel com exatamente os widgets que você quer. Este é um canvas totalmente flexível — arraste para reorganizar, handles para redimensionar e o painel à esquerda para adicionar novos componentes.',
  },
  {
    id: 'custom-aside',
    featureKey: 'custom-page-v1',
    targetSelector: '[data-tutorial-id="custom-aside"]',
    placement: 'right',
    titleEn: 'Component panel',
    titlePt: 'Painel de componentes',
    descEn:
      'Browse all available widgets grouped by category: KPIs, Activity, Costs, Projects, Tools, Sessions, and Highlights. Click any item to add it to the canvas instantly. Use the search box to find a specific component.',
    descPt:
      'Navegue por todos os widgets disponíveis agrupados por categoria: KPIs, Atividade, Custos, Projetos, Ferramentas, Sessões e Destaques. Clique em qualquer item para adicioná-lo ao canvas instantaneamente. Use a caixa de busca para encontrar um componente específico.',
  },
  {
    id: 'custom-layout-name',
    featureKey: 'custom-page-v1',
    targetSelector: '[data-tutorial-id="custom-layout-name"]',
    placement: 'bottom',
    titleEn: 'Named layouts',
    titlePt: 'Layouts nomeados',
    descEn:
      'Save multiple named layouts and switch between them instantly. Create a "Daily check" layout with just KPIs, and a "Deep dive" layout with all the charts. Your layouts persist across restarts.',
    descPt:
      'Salve múltiplos layouts nomeados e alterne entre eles instantaneamente. Crie um layout "Verificação diária" só com KPIs e um "Análise detalhada" com todos os gráficos. Seus layouts persistem entre reinicializações.',
  },
  {
    id: 'custom-toolbar',
    featureKey: 'custom-page-v1',
    targetSelector: '[data-tutorial-id="custom-toolbar"]',
    placement: 'bottom',
    titleEn: 'Layout controls',
    titlePt: 'Controles do layout',
    descEn:
      'The toolbar gives you undo/redo for layout changes, a random layout generator to inspire you, lock mode to prevent accidental changes, and options to export/import layouts as JSON files to share with others.',
    descPt:
      'A barra de ferramentas oferece desfazer/refazer alterações de layout, um gerador de layouts aleatórios para inspirar, modo de bloqueio para evitar alterações acidentais e opções para exportar/importar layouts como arquivos JSON para compartilhar.',
  },
  {
    id: 'custom-pinned-project',
    featureKey: 'custom-page-v1',
    targetSelector: '[data-tutorial-id="custom-layout-name"]',
    placement: 'bottom',
    titleEn: 'Pinned projects per layout',
    titlePt: 'Projetos fixados por layout',
    descEn:
      'Each named layout can have its own set of pinned projects. When you create a duplicate layout (Layout menu → Duplicate), you choose which projects to pin. Switching layouts swaps the project filter automatically.',
    descPt:
      'Cada layout nomeado pode ter seu próprio conjunto de projetos fixados. Ao criar um layout duplicado (menu Layout → Duplicar), você escolhe quais projetos fixar. Trocar de layout muda o filtro de projeto automaticamente.',
  },
  {
    id: 'custom-filters',
    featureKey: 'custom-page-v1',
    targetSelector: '[data-tutorial-id="custom-filters-bar"]',
    placement: 'bottom',
    titleEn: 'Filters in the sidebar',
    titlePt: 'Filtros no sidebar',
    descEn:
      'On the Custom page, the date range and project filters live inside the sidebar — keeping the canvas clean. The active filter applies to all non-pinned widgets simultaneously.',
    descPt:
      'Na página Custom, os filtros de período e projeto ficam dentro do sidebar — mantendo o canvas limpo. O filtro ativo se aplica a todos os widgets não fixados simultaneamente.',
  },
  {
    id: 'custom-pdf',
    featureKey: 'custom-page-v1',
    targetSelector: '[data-tutorial-id="export-pdf"]',
    placement: 'bottom',
    titleEn: 'Export your report',
    titlePt: 'Exporte seu relatório',
    descEn:
      'Use the Export PDF button to capture the current state of your analytics as a PDF. The report includes a model breakdown table, per-session costs, KPI summary, and your activity heatmap — all formatted for sharing.',
    descPt:
      'Use o botão Exportar PDF para capturar o estado atual das suas análises como PDF. O relatório inclui tabela de breakdown por modelo, custos por sessão, resumo de KPIs e seu mapa de calor de atividade — tudo formatado para compartilhar.',
  },
]

export const ALL_TUTORIAL_STEPS = [...TUTORIAL_STEPS, ...CUSTOM_PAGE_STEPS]

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface UseTutorialReturn {
  visible: boolean
  steps: TutorialStep[]
  stepIndex: number
  onNext: () => void
  onSkip: () => void
  onSkipAll: () => void
}

export function useTutorial(
  lang: 'en' | 'pt',
  isCustomPage: boolean,
): UseTutorialReturn {
  const [completedFeatures, setCompletedFeatures] = useState<Set<string>>(new Set())
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [activeFeatureKey, setActiveFeatureKey] = useState<string | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [steps, setSteps] = useState<TutorialStep[]>([])

  // Load completed features from preferences
  useEffect(() => {
    fetch('/api/preferences')
      .then(r => r.ok ? r.json() : null)
      .then((prefs: { tutorialCompletedFeatures?: string[] } | null) => {
        if (prefs?.tutorialCompletedFeatures) {
          setCompletedFeatures(new Set(prefs.tutorialCompletedFeatures))
        }
        setPrefsLoaded(true)
      })
      .catch(() => setPrefsLoaded(true))
  }, [])

  // Decide which tutorial to show once prefs are loaded
  useEffect(() => {
    if (!prefsLoaded) return

    const featureKey = isCustomPage ? 'custom-page-v1' : 'onboarding-v1'
    if (completedFeatures.has(featureKey)) return

    const relevantSteps = ALL_TUTORIAL_STEPS.filter(s => s.featureKey === featureKey)
    if (relevantSteps.length === 0) return

    setActiveFeatureKey(featureKey)
    setSteps(relevantSteps)
    setStepIndex(0)
  }, [prefsLoaded, isCustomPage, completedFeatures])

  const markComplete = useCallback((featureKey: string) => {
    setCompletedFeatures(prev => {
      const next = new Set(prev)
      next.add(featureKey)
      const arr = Array.from(next)
      fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tutorialCompletedFeatures: arr }),
      }).catch(() => {})
      return next
    })
    setActiveFeatureKey(null)
    setSteps([])
    setStepIndex(0)
  }, [])

  const onNext = useCallback(() => {
    setStepIndex(prev => {
      const next = prev + 1
      if (next >= steps.length) {
        if (activeFeatureKey) markComplete(activeFeatureKey)
        return prev
      }
      return next
    })
  }, [steps.length, activeFeatureKey, markComplete])

  const onSkip = useCallback(() => {
    setStepIndex(prev => {
      const next = prev + 1
      if (next >= steps.length) {
        if (activeFeatureKey) markComplete(activeFeatureKey)
        return prev
      }
      return next
    })
  }, [steps.length, activeFeatureKey, markComplete])

  const onSkipAll = useCallback(() => {
    if (activeFeatureKey) markComplete(activeFeatureKey)
  }, [activeFeatureKey, markComplete])

  return {
    visible: activeFeatureKey !== null && steps.length > 0,
    steps,
    stepIndex,
    onNext,
    onSkip,
    onSkipAll,
  }
}
