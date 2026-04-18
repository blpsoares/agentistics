export type Lang = 'pt' | 'en';

export const translations: Record<Lang, Record<string, string>> = {
  pt: {
    // App
    'app.title': 'Claude Stats',
    'app.subtitle': 'Estatísticas de uso do Claude Code',
    'app.since': 'Desde',
    'app.total_sessions': 'Total de sessões',
    'app.refresh': 'Atualizar',

    // Nav
    'nav.light': 'Claro',
    'nav.dark': 'Escuro',
    'nav.language': 'Idioma',

    // Filter
    'filter.period': 'Período',
    'filter.from': 'De',
    'filter.to': 'Até',
    'filter.all_time': 'Todo o período',
    'filter.project': 'Projeto',
    'filter.model': 'Modelo',
    'filter.reset': 'Redefinir',
    'filter.select_projects': 'Selecionar projetos',
    'filter.search_projects': 'Buscar projetos...',
    'filter.all_projects': 'Todos os projetos',
    'filter.all_models': 'Todos os modelos',
    'filter.selected': 'selecionado(s)',

    // Cards
    'card.total_messages': 'Total de mensagens',
    'card.sessions': 'Sessões',
    'card.tool_calls': 'Chamadas de ferramentas',
    'card.streak': 'Sequência',
    'card.streak_sub': 'dias consecutivos',
    'card.longest_session': 'Sessão mais longa',
    'card.est_cost': 'Custo estimado',
    'card.est_cost_sub': 'baseado em tokens',
    'card.commits': 'Commits',
    'card.files_modified': 'Arquivos modificados',

    // Card info
    'card.info.source': 'Fonte',
    'card.info.formula': 'Fórmula',
    'card.info.note': 'Nota',

    // Sections
    'section.activity_chart': 'Atividade ao longo do tempo',
    'section.activity_heatmap': 'Heatmap de atividade',
    'section.usage_by_hour': 'Uso por hora do dia',
    'section.model_usage': 'Uso por modelo',
    'section.top_projects': 'Principais projetos',
    'section.recent_sessions': 'Sessões recentes',
    'section.tools': 'Ferramentas',
    'section.tool_metrics': 'Métricas de ferramentas',
    'section.languages': 'Linguagens',

    // Tool metrics
    'tools.by_calls': 'Por chamadas',
    'tools.by_tokens': 'Por tokens gastos',
    'tools.calls': 'chamadas',
    'tools.no_data': 'Sem dados',
    'tools.total': 'Total',
    'tools.agent_file_reads': 'Leituras de arquivos de instrução',
    'tools.agent_file_tip': 'Dica: Cada leitura de arquivo de instrução adiciona tokens ao contexto. Consolide arquivos quando possível.',

    // Sessions
    'sessions.filter': 'Filtrar',
    'sessions.sort_by': 'Ordenar por',
    'sessions.sort_date': 'Data',
    'sessions.sort_tokens': 'Tokens',
    'sessions.sort_messages': 'Mensagens',
    'sessions.sort_tools': 'Ferramentas',
    'sessions.sort_files': 'Arquivos',
    'sessions.min_tokens': 'Mín. tokens',
    'sessions.min_messages': 'Mín. mensagens',
    'sessions.search': 'Buscar sessões...',
    'sessions.no_results': 'Nenhuma sessão encontrada',
    'sessions.showing': 'Exibindo',
    'sessions.of': 'de',
    'sessions.page': 'Página',
    'sessions.per_page': 'por página',

    // Sessions columns
    'sessions.col_project': 'Projeto',
    'sessions.col_date': 'Data',
    'sessions.col_duration': 'Duração',
    'sessions.col_messages': 'Mensagens',
    'sessions.col_tokens': 'Tokens',
    'sessions.col_tools': 'Ferramentas',
    'sessions.col_commits': 'Commits',
    'sessions.col_files': 'Arquivos',

    // Modal
    'modal.projects_title': 'Selecionar projetos',
    'modal.select_all': 'Selecionar todos',
    'modal.clear_all': 'Limpar tudo',
    'modal.apply': 'Aplicar',
    'modal.cancel': 'Cancelar',
    'modal.showing': 'Exibindo',
    'modal.no_projects': 'Nenhum projeto encontrado',

    // Modal info
    'modal.info_title': 'Informações',
    'modal.info_source': 'Fonte dos dados',
    'modal.info_formula': 'Fórmula de cálculo',
    'modal.info_note': 'Observação',
    'modal.info_nav_prev': 'Anterior',
    'modal.info_nav_next': 'Próximo',
    'modal.info_of': 'de',

    // Source
    'source.meta': 'Metadados da sessão',
    'source.jsonl': 'Arquivo JSONL',
    'source.subdir': 'Subdiretório',

    // Heatmap
    'heatmap.less': 'Menos',
    'heatmap.more': 'Mais',
    'heatmap.messages': 'mensagens',
    'heatmap.sessions_count': 'sessões',
    'heatmap.tool_calls': 'chamadas de ferramentas',

    // Hour
    'hour.night': 'Madrugada',
    'hour.morning': 'Manhã',
    'hour.afternoon': 'Tarde',
    'hour.evening': 'Noite',
    'hour.peak': 'Pico',

    // Project
    'project.sessions_count': 'sessões',
    'project.messages_count': 'mensagens',
    'project.tools_count': 'ferramentas',
    'project.click_filter': 'Clique para filtrar',

    // Cost
    'cost.blended_note': 'Custo calculado com base em preços médios ponderados',
    'cost.no_data': 'Sem dados de custo disponíveis',
    'cost.input': 'Entrada',
    'cost.output': 'Saída',
    'cost.cache_read': 'Leitura de cache',
    'cost.cache_write': 'Escrita de cache',
    'cost.total': 'Total',

    // Chat filter change dialog
    'chat.filter_change_title': 'Filtro será alterado',
    'chat.filter_change_body': 'Seu filtro atual será alterado para refletir o resultado da busca.',
    'chat.filter_change_confirm': 'Aplicar e navegar',
    'chat.filter_change_cancel': 'Cancelar',
    'chat.filter_change_new': 'Novo filtro',
    'chat.filter_change_current': 'Filtro atual',
    'chat.filter_change_projects': 'Projetos',
    'chat.filter_change_all': 'Todos',
  },

  en: {
    // App
    'app.title': 'Claude Stats',
    'app.subtitle': 'Claude Code usage statistics',
    'app.since': 'Since',
    'app.total_sessions': 'Total sessions',
    'app.refresh': 'Refresh',

    // Nav
    'nav.light': 'Light',
    'nav.dark': 'Dark',
    'nav.language': 'Language',

    // Filter
    'filter.period': 'Period',
    'filter.from': 'From',
    'filter.to': 'To',
    'filter.all_time': 'All time',
    'filter.project': 'Project',
    'filter.model': 'Model',
    'filter.reset': 'Reset',
    'filter.select_projects': 'Select projects',
    'filter.search_projects': 'Search projects...',
    'filter.all_projects': 'All projects',
    'filter.all_models': 'All models',
    'filter.selected': 'selected',

    // Cards
    'card.total_messages': 'Total messages',
    'card.sessions': 'Sessions',
    'card.tool_calls': 'Tool calls',
    'card.streak': 'Streak',
    'card.streak_sub': 'consecutive days',
    'card.longest_session': 'Longest session',
    'card.est_cost': 'Estimated cost',
    'card.est_cost_sub': 'token-based',
    'card.commits': 'Commits',
    'card.files_modified': 'Files modified',

    // Card info
    'card.info.source': 'Source',
    'card.info.formula': 'Formula',
    'card.info.note': 'Note',

    // Sections
    'section.activity_chart': 'Activity over time',
    'section.activity_heatmap': 'Activity heatmap',
    'section.usage_by_hour': 'Usage by hour of day',
    'section.model_usage': 'Usage by model',
    'section.top_projects': 'Top projects',
    'section.recent_sessions': 'Recent sessions',
    'section.tools': 'Tools',
    'section.tool_metrics': 'Tool metrics',
    'section.languages': 'Languages',

    // Tool metrics
    'tools.by_calls': 'By calls',
    'tools.by_tokens': 'By token spend',
    'tools.calls': 'calls',
    'tools.no_data': 'No data',
    'tools.total': 'Total',
    'tools.agent_file_reads': 'Agent instruction file reads',
    'tools.agent_file_tip': 'Tip: Each instruction file read adds tokens to context. Consolidate files when possible.',

    // Sessions
    'sessions.filter': 'Filter',
    'sessions.sort_by': 'Sort by',
    'sessions.sort_date': 'Date',
    'sessions.sort_tokens': 'Tokens',
    'sessions.sort_messages': 'Messages',
    'sessions.sort_tools': 'Tools',
    'sessions.sort_files': 'Files',
    'sessions.min_tokens': 'Min. tokens',
    'sessions.min_messages': 'Min. messages',
    'sessions.search': 'Search sessions...',
    'sessions.no_results': 'No sessions found',
    'sessions.showing': 'Showing',
    'sessions.of': 'of',
    'sessions.page': 'Page',
    'sessions.per_page': 'per page',

    // Sessions columns
    'sessions.col_project': 'Project',
    'sessions.col_date': 'Date',
    'sessions.col_duration': 'Duration',
    'sessions.col_messages': 'Messages',
    'sessions.col_tokens': 'Tokens',
    'sessions.col_tools': 'Tools',
    'sessions.col_commits': 'Commits',
    'sessions.col_files': 'Files',

    // Modal
    'modal.projects_title': 'Select projects',
    'modal.select_all': 'Select all',
    'modal.clear_all': 'Clear all',
    'modal.apply': 'Apply',
    'modal.cancel': 'Cancel',
    'modal.showing': 'Showing',
    'modal.no_projects': 'No projects found',

    // Modal info
    'modal.info_title': 'Information',
    'modal.info_source': 'Data source',
    'modal.info_formula': 'Calculation formula',
    'modal.info_note': 'Note',
    'modal.info_nav_prev': 'Previous',
    'modal.info_nav_next': 'Next',
    'modal.info_of': 'of',

    // Source
    'source.meta': 'Session metadata',
    'source.jsonl': 'JSONL file',
    'source.subdir': 'Subdirectory',

    // Heatmap
    'heatmap.less': 'Less',
    'heatmap.more': 'More',
    'heatmap.messages': 'messages',
    'heatmap.sessions_count': 'sessions',
    'heatmap.tool_calls': 'tool calls',

    // Hour
    'hour.night': 'Night',
    'hour.morning': 'Morning',
    'hour.afternoon': 'Afternoon',
    'hour.evening': 'Evening',
    'hour.peak': 'Peak',

    // Project
    'project.sessions_count': 'sessions',
    'project.messages_count': 'messages',
    'project.tools_count': 'tools',
    'project.click_filter': 'Click to filter',

    // Cost
    'cost.blended_note': 'Cost calculated based on weighted average prices',
    'cost.no_data': 'No cost data available',
    'cost.input': 'Input',
    'cost.output': 'Output',
    'cost.cache_read': 'Cache read',
    'cost.cache_write': 'Cache write',
    'cost.total': 'Total',

    // Chat filter change dialog
    'chat.filter_change_title': 'Filter will change',
    'chat.filter_change_body': 'Your current filter will be changed to reflect the search result.',
    'chat.filter_change_confirm': 'Apply and navigate',
    'chat.filter_change_cancel': 'Cancel',
    'chat.filter_change_new': 'New filter',
    'chat.filter_change_current': 'Current filter',
    'chat.filter_change_projects': 'Projects',
    'chat.filter_change_all': 'All',
  },
};

export function t(key: string, lang: Lang): string {
  return translations[lang]?.[key] ?? translations['pt']?.[key] ?? key;
}
