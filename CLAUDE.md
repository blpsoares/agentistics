# Claude Stats — CLAUDE.md

Painel local de analytics para Claude Code. Visualiza tokens, custos, atividade e projetos com base nos dados em `~/.claude/`.

## Arquitetura

Dois serviços independentes:

```
server.ts (Bun, porta 3001)
  ├── Lê ~/.claude/usage-data/session-meta/ → sessões enriquecidas (fonte preferida)
  ├── Fallback: parseia JSONL de ~/.claude/projects/*/**/*.jsonl
  ├── Serve /api/data, /api/events (SSE), /api/rates
  └── Monitorado por chokidar para atualizações em tempo real

src/ (React + Vite, porta 5173)
  ├── useData.ts → fetch de /api/data + subscrição SSE
  ├── useDerivedStats() → toda lógica de filtro e agregação
  └── components/ → UI (gráficos, cards, heatmap, exportação PDF)
```

## Lógica de negócio crítica

| Função | Arquivo | O que faz |
|--------|---------|-----------|
| `calcCost()` | `src/lib/types.ts` | Custo USD por uso de modelo (preço por 1M tokens) |
| `getModelPrice()` | `src/lib/types.ts` | Resolve preço para modelo por ID (com fallback para Sonnet) |
| `MODEL_PRICING` | `src/lib/types.ts` | Tabela de preços — atualizar quando Anthropic alterar preços |
| `calcStreak()` | `src/hooks/useData.ts` | Streak de dias consecutivos (hoje sem atividade não quebra) |
| `getDateRangeFilter()` | `src/hooks/useData.ts` | Converte filtro de data em intervalo `{start, end}` |
| `parseSessionJsonl()` | `server.ts` | Parser de sessão JSONL → `SessionMeta` completo |
| `blendedCostPerToken()` | `src/hooks/useData.ts` | Custo combinado por token quando filtro de projeto está ativo |

## Fluxo de dados

```
~/.claude/
  ├── stats-cache.json          → dados agregados (tokens/dia, modelo, atividade)
  ├── usage-data/session-meta/  → sessões enriquecidas (fonte preferida)
  └── projects/**/*.jsonl       → arquivos brutos (fallback quando meta não existe)
         ↓
    server.ts (agrega e serve)
         ↓
    /api/data → useData() → useDerivedStats() → componentes React
```

## Regras importantes

- **`stats-cache.json`** não tem granularidade por projeto — filtros de projeto recalculam somando sessões individuais
- **Tokens por modelo/data**: `dailyModelTokens` só tem total; o split input/output usa proporções globais do statsCache como aproximação
- **Streak**: conta de hoje para trás; se hoje não tiver atividade, começa de ontem — comportamento intencional para não penalizar quem ainda não trabalhou hoje
- **Custos em BRL**: conversão via `/api/rates` (busca câmbio externo); fallback para taxa fixa se a API falhar
- **Fonte das sessões**: `_source: 'meta'` são as mais completas; `'jsonl'` e `'subdir'` são fallbacks com dados parciais (sem git lines, sem cache tokens)

## Desenvolvimento

```bash
bun run dev      # API (3001) + UI (5173) em paralelo
bun run watch    # Daemon OpenTelemetry (opcional)
bun test         # Testes unitários das funções puras
```

## Testes

Testes unitários cobrem as funções puras críticas:

- `src/lib/types.test.ts` → `calcCost()`, `getModelPrice()`
- `src/hooks/useData.test.ts` → `calcStreak()`, `getDateRangeFilter()`

Não mockar filesystem — as funções testadas são puras e não têm efeitos colaterais.
