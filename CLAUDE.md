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

## Funções de cálculo — fonte única de verdade

**Todas as camadas** usam as mesmas funções de `src/lib/types.ts`. Nunca recalcule preços inline.

### `MODEL_PRICING` — tabela de preços (USD por 1M tokens)

```
src/lib/types.ts — linhas 133-146
```

Atualizar aqui quando a Anthropic alterar preços ou lançar novos modelos. O fallback (Sonnet 4.6: $3/$15) está na linha 153.

### `getModelPrice(modelId)` — resolve preço por ID

```
src/lib/types.ts — linha 148
```

Faz match exato, depois match parcial por `startsWith` em ambas as direções. Retorna fallback Sonnet se nenhum match.

### `calcCost(usage, modelId)` — custo total de um uso

```
src/lib/types.ts — linha 156
```

Recebe um `ModelUsage` (input, output, cacheRead, cacheWrite em tokens) e retorna custo em USD.

### `blendedCostPerToken(modelUsage)` — taxa combinada ponderada

```
src/hooks/useData.ts — após linha 62
```

Usada quando não há modelo por sessão (filtro de projeto ativo ou custo por sessão no PDF). Pondera a taxa de cada modelo pelo seu volume de tokens no uso global.

---

## Onde cada camada calcula custo

| Camada | O que calcula | Como |
|--------|--------------|------|
| `useData.ts / useDerivedStats` | `totalCostUSD` filtrado | `calcCost()` por modelo; `blendedCostPerToken()` quando filtro de projeto ativo |
| `ModelBreakdown.tsx` | Custo por modelo na UI | `calcCost()` |
| `PDFExportModal.tsx` | Custo por modelo no PDF | `calcCost()` |
| `PDFExportModal.tsx` | Custo por sessão no PDF | `blendedCostPerToken(data.statsCache.modelUsage)` — sessões não têm modelo individual |
| `watcher.ts` | Custo total exportado via OTel | `calcCost()` importado de `src/lib/types.ts` |
| `watch-cli.ts` | Custo no terminal | `calcCost()` |
| `server.ts` | — | Não calcula custo; apenas busca/cacheia tabela de preços externa (`/api/rates`) |

---

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
- **Sessões não têm modelo individual** — use `blendedCostPerToken` para estimativa de custo por sessão
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
