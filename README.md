<p align="center">
  <img src="public/logoDoc.png" alt="Claude Stats" width="180" />
</p>

<h1 align="center">Claude Stats</h1>

<p align="center">
  <strong>Track · Analyze · Improve</strong><br/>
  Dashboard completo de análise de uso do Claude Code
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Bun-runtime-f9f1e1?logo=bun" alt="Bun" />
  <img src="https://img.shields.io/badge/React-19-61dafb?logo=react" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-8-646cff?logo=vite" alt="Vite" />
</p>

---

## Sumário

- [Visão Geral](#visão-geral)
- [Instalação e Execução](#instalação-e-execução)
- [Fontes de Dados](#fontes-de-dados)
- [Cálculos e Métricas](#cálculos-e-métricas)
- [Filtros Disponíveis](#filtros-disponíveis)
- [Visualizações e Gráficos](#visualizações-e-gráficos)
- [Cards de Estatísticas](#cards-de-estatísticas)
- [Exportação PDF](#exportação-pdf)
- [Temas e Idiomas](#temas-e-idiomas)
- [Arquitetura e Tech Stack](#arquitetura-e-tech-stack)
- [Estrutura de Componentes](#estrutura-de-componentes)
- [Configuração Avançada](#configuração-avançada)

---

## Visão Geral

Claude Stats é um dashboard local de analytics para uso do **Claude Code**. Ele lê diretamente os arquivos de histórico gerados pelo Claude Code em `~/.claude/` e transforma esses dados brutos em visualizações ricas: tokens consumidos, custo estimado, atividade por hora, projetos mais ativos, commits realizados via Claude, e muito mais.

**Destaques:**

- Análise de tokens por modelo com custo estimado em USD ou BRL
- Heatmap de atividade estilo GitHub
- Breakdown por hora do dia
- Top projetos e sessões recentes com busca e paginação
- Exportação de relatório completo em PDF
- Interface bilíngue (Português / English) com tema claro e escuro
- Cards reordenáveis via drag-and-drop com posição persistida

---

## Instalação e Execução

**Pré-requisito:** [Bun](https://bun.sh) instalado.

```bash
# Clone o repositório
git clone <url-do-repositório>
cd claude-stats

# Instale as dependências
bun install

# Inicie o servidor de API e a UI simultaneamente
bun run dev
```

| Serviço | Endereço padrão |
|---------|----------------|
| API (Bun) | `http://localhost:3001` |
| UI (Vite) | `http://localhost:5173` |

Para build de produção:

```bash
bun run build    # Gera dist/
bun run preview  # Serve o build localmente
```

---

## Fontes de Dados

O servidor (`server.ts`) lê os seguintes caminhos no sistema local:

| Fonte | Caminho | Descrição |
|-------|---------|-----------|
| **Stats Cache** | `~/.claude/stats-cache.json` | Agregados pré-computados (atividade diária, tokens por modelo, streak) |
| **Session Meta** | `~/.claude/usage-data/session-meta/*.json` | Metadados detalhados por sessão (tokens, ferramentas, git, projetos) |
| **JSONL brutos** | `~/.claude/projects/**/*.jsonl` | Logs de conversa brutos, usados como fallback quando session-meta não existe |
| **Git local** | `git log --numstat` | Commits, arquivos modificados e linhas alteradas dentro da janela da sessão |

### Pipeline de Parsing (JSONL)

Quando a session-meta não está disponível, cada arquivo `.jsonl` é parseado linha a linha:

```
Arquivo .jsonl
  ├── Extrai start_time e duration (timestamps da 1ª e última mensagem)
  ├── Conta mensagens do usuário (excluindo tool_result)
  ├── Conta mensagens do assistente (type: 'assistant')
  ├── Mapeia tool_use → tool_counts { Bash: N, Read: N, Edit: N, ... }
  ├── Extrai tokens do campo usage (input, output, cacheRead, cacheWrite)
  ├── Detecta commits: regex /^git commit\b/ em inputs do Bash
  ├── Detecta pushes: regex /^git push\b/ em inputs do Bash
  ├── Detecta linguagens por extensão de arquivo (Read, Edit, Write)
  ├── Conta erros de ferramentas (tool_result.is_error = true)
  ├── Captura primeiro prompt (primeiros 200 chars)
  ├── Registra horas das mensagens (array 0–23)
  └── Retorna objeto SessionMeta
```

### Estrutura SessionMeta

```typescript
interface SessionMeta {
  session_id: string              // UUID da sessão
  project_path: string            // Diretório do projeto
  start_time: string              // ISO 8601
  duration_minutes: number        // Duração total
  user_message_count: number      // Mensagens reais do usuário
  assistant_message_count: number // Respostas do modelo
  tool_counts: Record<string, number>  // ex: { Bash: 12, Read: 8 }
  languages: string[]             // Linguagens detectadas
  git_commits: number             // Commits via Claude
  git_pushes: number              // Pushes via Claude
  input_tokens: number            // Tokens enviados ao modelo
  output_tokens: number           // Tokens gerados
  lines_added: number             // Linhas adicionadas (git)
  lines_removed: number           // Linhas removidas (git)
  files_modified: number          // Arquivos únicos modificados
  message_hours: number[]         // Horas dos turnos (0–23)
  first_prompt: string            // Primeiros 200 chars do prompt
  tool_errors: number             // Total de erros de ferramentas
  uses_task_agent: boolean        // Usou subagente Task/Agent
  uses_mcp: boolean               // Usou ferramentas MCP
  _source: 'meta' | 'jsonl' | 'subdir'  // Origem do dado
}
```

---

## Cálculos e Métricas

### Precificação por Modelo

Todos os preços são por **1 milhão de tokens (1M)**:

| Modelo | Input | Output | Cache Read | Cache Write |
|--------|-------|--------|------------|-------------|
| Claude Opus 4.6 / 4.5 | $5,00 | $25,00 | $0,50 | $6,25 |
| Claude Opus 4.1 / 4.0 | $15,00 | $75,00 | $1,50 | $18,75 |
| Claude Sonnet 4.6 / 4.5 / 4.0 | $3,00 | $15,00 | $0,30 | $3,75 |
| Claude Haiku 4.5 | $0,80 | $4,00 | $0,08 | $1,00 |
| Claude Haiku 3.5 / 3.0 | $0,25 | $1,25 | $0,03 | $0,30 |

### Fórmula de Custo

```
Custo Total = Σ por modelo [
  (inputTokens    / 1.000.000 × preço_input)     +
  (outputTokens   / 1.000.000 × preço_output)    +
  (cacheReadTokens/ 1.000.000 × preço_cache_read)+
  (cacheWriteTokens/1.000.000 × preço_cache_write)
]
```

### Taxa Mista (Blended Rate)

Quando um filtro de **projeto** está ativo, os dados de session-meta não contêm o breakdown por modelo. Neste caso, aplica-se uma taxa média ponderada:

```
taxa_media_input  = Σ(input_tokens_modelo  × preço_modelo) / Σ input_tokens
taxa_media_output = Σ(output_tokens_modelo × preço_modelo) / Σ output_tokens
... (idem para cache)

Custo Filtrado = sessões_filtradas × taxa_media
```

### Tipos de Token

| Tipo | Descrição | Custo Relativo |
|------|-----------|----------------|
| **Input** | Contexto + prompt enviado ao modelo | Base |
| **Output** | Tokens gerados pelo modelo | ~5× mais caro que input |
| **Cache Read** | Lido do prompt cache | ~10× mais barato que input |
| **Cache Write** | Criação/atualização do prompt cache | ~1,25× mais caro que input |

### Streak (Sequência de Dias)

O streak é calculado globalmente (ignorando filtros de data/projeto):

```
streak = 0
data_atual = hoje
enquanto data_atual tem atividade no stats-cache:
    streak++
    data_atual = data_atual - 1 dia
```

### Duração de Sessão

```
duration_minutes = (timestamp_última_mensagem - timestamp_primeira_mensagem) / 60
```

### Commits Git

Detectados via análise dos inputs do Bash tool em tempo de parsing:

```
/^git commit\b/  → gitCommits++
/^git push\b/    → gitPushes++
```

Linhas e arquivos modificados são obtidos via:
```bash
git -C <project_path> log --numstat --after="<start>" --before="<end>"
```

---

## Filtros Disponíveis

### Período

| Opção | Comportamento |
|-------|---------------|
| **7d** | Últimos 7 dias |
| **30d** | Últimos 30 dias |
| **90d** | Últimos 90 dias |
| **Tudo / All** | Todo o histórico |
| **Data Personalizada** | Intervalo De/Até com calendário (DD/MM/YY) |

### Projetos

- Modal de seleção múltipla com busca por nome
- Selecionar/limpar todos de uma vez
- Badge mostrando quantidade de projetos ativos
- Quando filtro de projeto ativo → usa blended rate e session-meta

### Modelo

- Dropdown com todos os modelos detectados no histórico
- Seleção única: "Todos" ou um modelo específico

### Reset

- Botão aparece automaticamente quando qualquer filtro está ativo
- Reseta: período → Tudo, datas → vazias, projetos → nenhum, modelo → todos

---

## Visualizações e Gráficos

### Atividade ao Longo do Tempo

Gráfico de área (Recharts) com as métricas:

- **Mensagens** — total de mensagens (usuário + assistente)
- **Sessões** — contagem de sessões
- **Ferramentas** — total de chamadas de tools
- **Sobreposição** — as três métricas normalizadas (0–100%) sobrepostas

Funcionalidades: tooltip interativo, alternância de eixos/legenda, escala automática.

### Heatmap de Atividade

Grid estilo GitHub com 26 semanas (configurável):

- Células coloridas por intensidade de mensagens
- Colunas = semanas, linhas = dias da semana
- Tooltip mostra: data, mensagens, sessões, tool calls
- Legenda: Menos → Mais

### Uso por Hora

Gráfico de barras horizontais com 24 horas agrupadas em períodos:

| Período | Horas | Cor |
|---------|-------|-----|
| Noite | 00h–05h | Roxo |
| Manhã | 06h–11h | Amarelo |
| Tarde | 12h–17h | Laranja |
| Noite | 18h–23h | Azul |

Destaque visual na hora de pico. Toggle entre formato 12h/24h.

### Breakdown por Modelo

Cards por modelo com:
- Tokens: Input / Output / Cache Read / Cache Write
- Barra de progresso (% do total)
- Custo estimado por modelo
- Rodapé com custo total quando múltiplos modelos presentes

### Top Projetos

Grid de 2 colunas com os 12 projetos mais ativos:
- Barra de progresso relativa ao projeto com mais sessões
- Clicável → aplica filtro de projeto automaticamente
- Exibe sessões + mensagens por projeto

### Sessões Recentes

Tabela paginada com:

**Colunas:** Projeto · Data · Duração · Mensagens · Tokens · Ferramentas · Commits · Arquivos

**Ordenação:** Data, Tokens, Mensagens, Ferramentas, Arquivos

**Filtros inline:**
- Tokens mínimos
- Mensagens mínimas
- Busca por texto no primeiro prompt

**Indicador de fonte:**
- 🟠 Orange = session-meta (dado completo)
- 🔵 Blue = JSONL direto
- 🟣 Purple = subdiretório

### Destaques (Highlights)

6 cards de recordes do período:
1. Sessão mais longa (minutos)
2. Mais tokens de input
3. Mais tokens de output
4. Mais mensagens
5. Mais tool calls
6. Projeto mais ativo

Cada card exibe: data, projeto, duração e um multiplicador "Nx a média" quando o recorde é ≥1,5× a média.

---

## Cards de Estatísticas

Todos os cards são **drag-and-drop** e a ordem é salva em `localStorage`. Cada um tem um botão `ℹ` que abre um modal explicando a fonte, fórmula e observações.

| Card | Métrica | Observação |
|------|---------|-----------|
| **Mensagens** | Total usuário + assistente | Exibe média por sessão |
| **Sessões** | Contagem de sessões | Exibe média de mensagens/sessão |
| **Ferramentas** | Total de tool calls | Exibe ferramenta mais usada |
| **Tokens Input** | Tokens enviados ao modelo | Com breakdown de cache |
| **Tokens Output** | Tokens gerados | |
| **Custo Estimado** | USD/BRL (toggle) | Usa preços oficiais da Anthropic |
| **Streak** | Dias consecutivos com atividade | Calculado globalmente, ignora filtros |
| **Sessão Mais Longa** | Duração em minutos | Com contagem de mensagens |
| **Commits** | Commits + pushes via Claude | Detectados nos inputs do Bash |
| **Arquivos Modificados** | Arquivos únicos + linhas +/- | Via git --numstat |

---

## Exportação PDF

O modal de exportação permite configurar um relatório completo:

**Seções selecionáveis:**
- Resumo (cards de estatísticas)
- Atividade ao longo do tempo
- Heatmap
- Uso por hora
- Breakdown por modelo
- Top projetos
- Ferramentas
- Sessões recentes
- Destaques / Recordes

**Opções:**
- Período independente dos filtros ativos (7d / 30d / 90d / Tudo)
- Tema do PDF: Claro ou Escuro
- Preview ao vivo das seleções

**Tecnologia:** `html2canvas` captura cada seção como imagem + `jspdf` monta o PDF final.

---

## Temas e Idiomas

### Temas

Implementado via CSS custom properties:

```css
:root { /* Tema escuro (padrão) */ }
[data-theme="light"] { /* Tema claro */ }
```

Alternado via `document.documentElement.setAttribute('data-theme', theme)`.

A logo no header muda automaticamente:
- Tema escuro → `logoDarkMode.png`
- Tema claro → `logoLightMode.png`

### Idiomas

Suporte a **Português (pt-BR)** e **English**:

- Todas as strings traduzidas em `src/lib/i18n.ts`
- Toggle PT/EN no header
- Ao selecionar PT → moeda padrão muda para BRL
- Ao selecionar EN → moeda muda para USD (se estava em BRL)
- Formato de data: `dd/MM/yyyy` em ambos os idiomas

### Moedas

- **USD** — dólar americano
- **BRL** — real brasileiro (usa taxa de câmbio obtida via API pública)

---

## Arquitetura e Tech Stack

```
claude-stats/
├── public/
│   ├── logoDoc.png          # Logo para documentação
│   ├── logoDarkMode.png     # Logo tema escuro
│   └── logoLightMode.png    # Logo tema claro
├── src/
│   ├── App.tsx              # Componente raiz: estado global, layout, header
│   ├── main.tsx             # Entry point React
│   ├── index.css            # CSS variables, reset, tipografia
│   ├── components/          # Componentes de UI
│   │   ├── ActivityChart.tsx
│   │   ├── ActivityHeatmap.tsx
│   │   ├── DatePicker.tsx
│   │   ├── FiltersBar.tsx
│   │   ├── HealthWarnings.tsx
│   │   ├── HighlightsBoard.tsx
│   │   ├── HourChart.tsx
│   │   ├── InfoModal.tsx
│   │   ├── ModelBreakdown.tsx
│   │   ├── PDFExportModal.tsx
│   │   ├── ProjectsList.tsx
│   │   ├── ProjectsModal.tsx
│   │   ├── RecentSessions.tsx
│   │   └── StatCard.tsx
│   └── lib/
│       ├── types.ts         # Tipos TypeScript + MODEL_PRICING
│       ├── i18n.ts          # Traduções PT/EN
│       └── hooks/           # Hooks customizados (se houver)
├── server.ts                # API Bun: parsing JSONL, git stats, cache
├── package.json
├── tsconfig.json
└── vite.config.ts
```

### Frontend

| Biblioteca | Versão | Uso |
|------------|--------|-----|
| React | 19.2 | UI declarativa |
| Vite | 8.0 | Build tool e dev server |
| TypeScript | 5 | Tipagem estrita |
| Recharts | 3.8 | Gráficos (área, barra, tooltip) |
| lucide-react | 1.7 | Ícones SVG |
| date-fns | 4.1 | Manipulação de datas |
| html2canvas | 1.4 | Captura de HTML para PDF |
| jspdf | 4.2 | Geração de PDF |

### Backend

| Tecnologia | Uso |
|-----------|-----|
| Bun | Runtime do servidor HTTP |
| Node.js fs/path | Leitura de arquivos locais |
| child_process (execAsync) | Execução de comandos git |

### Persistência no Browser

| Chave localStorage | Conteúdo |
|--------------------|---------|
| `claude-stats-card-order` | Ordem dos cards (JSON array) |
| `claude-stats-dismissed-health` | IDs de avisos de saúde dispensados |

---

## Estrutura de Componentes

```
App.tsx
├── HealthWarnings          # Painel de avisos colapsável
├── Header
│   ├── Logo (img)          # logoDarkMode / logoLightMode
│   ├── Language Toggle     # PT ↔ EN
│   ├── Currency Toggle     # USD ↔ BRL
│   ├── Theme Toggle        # Dark ↔ Light
│   ├── Refresh Button
│   └── PDF Export Button → PDFExportModal
├── FiltersBar
│   ├── Presets (7d/30d/90d/All)
│   ├── DatePicker (De/From)
│   ├── DatePicker (Até/To)
│   ├── ProjectsModal
│   └── Model Select
├── Stats Grid (drag-and-drop)
│   └── StatCard × 10       # Com InfoModal
├── ActivityChart
├── ActivityHeatmap
├── HourChart
├── ModelBreakdown
├── ProjectsList
├── RecentSessions
└── HighlightsBoard
```

---

## Configuração Avançada

### Variáveis de Ambiente (servidor)

O servidor usa as seguintes variáveis de ambiente:

```bash
HOME          # Diretório home do usuário (Linux/Mac)
USERPROFILE   # Alternativa para Windows
```

Caminhos derivados:

```
~/.claude/                          → CLAUDE_DIR
~/.claude/projects/                 → PROJECTS_DIR
~/.claude/usage-data/session-meta/  → SESSION_META_DIR
~/.claude/stats-cache.json          → STATS_CACHE_FILE
```

### Porta da API

Por padrão a API roda na porta `3001`. O Vite proxy redireciona `/api/*` automaticamente no desenvolvimento.

### Atualização de Preços

A API expõe o endpoint `GET /api/rates` que pode retornar preços atualizados. O frontend mescla os preços do servidor com os hardcoded em `MODEL_PRICING` (o servidor tem prioridade).

### Health Checks

O sistema detecta automaticamente problemas como:
- `stats-cache.json` ausente ou desatualizado
- Session-meta não encontrada (modo degradado com JSONL)
- Incompatibilidade de versão do Claude Code
- Dados de sessão incompletos

Alertas têm 3 níveis de severidade: **erro** (vermelho) · **aviso** (amarelo) · **info** (azul). Cada aviso pode ser dispensado individualmente e o estado é persistido.

---

## Changelog

Veja as [releases](../../releases) para o histórico completo de versões.

---

<p align="center">
  Feito com ♥ para a comunidade Claude Code
</p>
