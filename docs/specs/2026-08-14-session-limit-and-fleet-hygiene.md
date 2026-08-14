# Spec — limite do harness, retomada em massa, e a higiene da frota

**Data:** 2026-08-14 · **Base:** `origin/dev` · **Branch sugerida:** `feat/session-limit-resume`

Uma sessão só, ou no máximo duas, implementam tudo isto. O limite de uso do harness é o recurso
escasso — cada sessão paralela extra é uma fração do mesmo limite, e treze delas foi o que fez a
frota inteira parar às 18:30.

---

## 0. O que este documento assume que você já sabe

Leia `CLAUDE.md` (seção **Terminal UI** e a subseção `sessions/`) antes de escrever código. As
regras que mais mordem aqui:

- Toda decisão mora num módulo **puro e testado**; a TUI não decide nada e o host devolve
  `ActionResult` já localizado.
- Padrão de tela é **capturado de um frame real**, com versão da CLI e data. Nunca escrito de
  memória — um padrão plausível que não casa falha em **silêncio**.
- `Record<HarnessId, X | null>` para toda tabela por harness, para o build quebrar quando um
  harness novo aparecer. `null` é a decisão "não sondado", e a UI diz isso **em palavras**.
- N/A nunca é `0` confiante.

---

## 1. Achado que muda o desenho: não foi o contexto, foi o limite de uso

O usuário descreveu como "estourou o contexto". Não é. O que está nas telas, capturado hoje de
três panes vivos (`agentop-6b23834c1a`, `agentop-d41dc788ef`, `agentop-cbf341b8c8`,
claude 2.1.231), lido com `cat -A`:

```
  ⎿ ␣You've hit your session limit · resets 6:30pm (America/Sao_Paulo)
     /upgrade to increase your usage limit.
```

Duas armadilhas de bytes, e as duas seriam adivinhadas errado:

- o espaço antes de `You've` é **NBSP** (U+00A0), não espaço comum;
- o separador é **·** (U+00B7), não `-` nem `*`.

**Consequência de desenho, e é a principal:** isto não é uma sessão bloqueada numa *pessoa*, é uma
sessão bloqueada num **relógio**. Mandar "continue" antes do reset não é só inútil — gasta a
primeira requisição da janela nova num prompt cujo conteúdo é a palavra "continue", e o harness
responde com o mesmo erro. Então o banner é metade do que precisa ser lido; a outra metade é o
**horário de reset**, ou o botão de retomada em massa falha em toda linha que tocar.

Já existe implementação inicial em `packages/server/server/sessions/limit.ts` nesta branch
(`LIMIT_RULES`, `detectLimit`, `parseResetAt`, `limitCleared`). Está **sem testes** — comece por
aí, revise, não assuma que está certa.

### 1.1 Detectar

- Estado novo `limit-blocked` em `SessionActivity` (`sessions/types.ts`) e em `SessionState`
  (`tui/src/control/types.ts`).
- Em `attentionOf`, ele entra **acima** de movimento e **abaixo** de `waiting-approval`: um diálogo
  aberto por cima do banner é o que está bloqueando agora.
- **O banner é lido do TAIL do frame, nunca do frame inteiro.** Ele é conteúdo de transcript: rola
  junto com a conversa e continua na tela muito depois da sessão ter voltado a trabalhar. Ler o
  frame inteiro prende uma sessão viva em `limit-blocked` até o texto sair de cena — que é
  exatamente o bug do `esc to interrupt` que o `MARKER_STALE_MS` existe para corrigir, pela segunda
  vez. Use o `frameTail` que já existe.
- `resetsAtMs` desconhecido conta como **liberado**. A alternativa é uma linha que nada limpa.

### 1.2 Marcar

- Vermelho **claro**, distinto do `COLORS.danger` (`#f43f5e`), que já é a cor de falha em
  `offline`/`unauthorized`/conflito de serviço. Sugestão: `#fca5a5`. Adicione como token nomeado em
  `theme.ts` (ex.: `limit`), nunca um hex solto no componente.
- A linha **diz o horário do reset em palavras** (`limite · volta 18:30`). Cor sozinha não é
  informação: quem não distingue os dois vermelhos fica sem nada.
- Contador no header, ao lado do de "aguardando".

### 1.3 Retomar em massa

Atalho novo na aba de sessões. Abre uma lista com **caixinhas**, todas as `limit-blocked`
**pré-marcadas**, e o usuário desmarca as que não quer. Confirmar manda `continue` em cada uma.

O planejador é puro — `sessions/limit-resume.ts`, `planLimitResume({ rows, selected, nowMs })` — na
mesma linha do `task-reopen.ts`, e precisa distinguir três casos que **não** são o mesmo:

| caso | ação | por quê |
|---|---|---|
| processo **vivo**, limite já resetou | manda `continue` | o limite não mata o processo; a conversa está inteira |
| processo **morto** | reabre pelo `task-reopen` | não há onde digitar |
| reset **ainda no futuro** | **pula, e diz o horário** | mandar agora queima a primeira requisição da janela |

Um item pulado é **contado e nomeado**, nunca silenciosamente omitido — mesma regra do
`planTaskReopen`.

### 1.4 CLI

`agentop session limits` (lista quem está bloqueado e até quando) e
`agentop session resume [ids… | --all]`. Ambos com `--json`. `resume` sem `--all` e sem ids não
faz nada e diz o que faria — um comando em massa que dispara sem alvo explícito é o tipo de coisa
que se roda uma vez e se lamenta.

---

## 2. Bugs achados na varredura de hoje — todos reproduzidos, nenhum é hipótese

### 2.1 Reabrir cria GÊMEOS (alta)

`91f21d7c9f` e `29ca41da44` são duas sessões vivas com a **mesma** task
("Fix token rotation and member connect"). `1da098e5cb` e `44d649269a`, idem para o SQLite.
`planTaskReopen` deveria **aposentar** a linha que substitui — é literalmente o que o CLAUDE.md diz
que ele faz ("everything reopened RETIRES the row it replaced, or a laptop closed twice leaves the
task holding dead twins under one name"). Na prática ficaram os dois vivos. Reproduza com a
frota real antes de mexer no planejador: pode ser o registry, não a aritmética.

### 2.2 Sessão reaberta volta VAZIA e trava na pergunta de onboarding (alta)

**9 das 11 sessões vivas** estão paradas em:

```
Make auto mode your default permission mode?
  ❯ 1. Yes, set auto mode as my default permission mode
    2. No, keep manual mode
```

Sem conversa, sem contexto, sem lembrança da task. Ou seja: a reabertura **não retomou a conversa**
— subiu uma CLI nova no diretório certo e parou na primeira pergunta de primeira execução. Duas
coisas a corrigir, e a segunda é a que importa:

1. essa pergunta é um `waiting-approval` legítimo e o cockpit deveria oferecer resposta (o
   "escolher para responder" do #118 já cobre isso — verifique se está pegando);
2. **a reabertura precisa passar o id da conversa** (`--resume`/`--continue`, lido do `--help` do
   harness, nunca adivinhado). Reabrir sem retomar é perder o trabalho enquanto parece que
   recuperou — o pior dos dois mundos, porque a linha volta verde.

### 2.3 Conflito nativo-vs-nativo não é detectado (média)

Havia **dois `agentop server`** rodando por 1h10: um do systemd (`agentop-server.service`, binário
compilado) e outro do checkout (`bun packages/server/bin/cli.ts server`). O segundo não conseguiu
abrir as portas 47291/47292, mas o watcher e o rebuild não dependem de porta — então ele manteve
**2367 watches de inotify** e recomputou a cada escrita de transcript das 12 sessões, queimando 72%
de um núcleo e 1.1 GB por 70 minutos, servindo nada.

O modelo de conflito conhece `native` vs `docker` e funde os dois numa linha. **Binário compilado
vs `bun run` do checkout são ambos "native"**, então as duas colapsam em uma e o conflito fica
invisível. Precisa de um terceiro runtime, ou de detecção por porta ocupada.

### 2.4 `session list` diz "waiting" para sessão que está trabalhando (média)

Observado em `parse-cache-sqlite` e na sessão do aipe: rodapé com `esc to interrupt` e comando de
3min em andamento, listadas como `waiting`. O veto de rodapé não pegou. Verificar se é só binário
velho (a máquina do usuário está em **v1.13.1**, a main em **v1.13.7**) ou se `prevDigest` sendo
sempre `undefined` numa CLI de tiro único ainda estraga a classificação.

### 2.5 Senha em texto claro num título de sessão (alta, mas é decisão do usuário)

O título da sessão `15f8c5f36d` contém um e-mail e uma senha. Título e `first_prompt` **viajam**
para a central; `redactSecrets` não pega "senha X" em prosa. Duas coisas separadas: a senha precisa
ser trocada (decisão do usuário), e vale avaliar uma regra para `senha|password` seguido de token —
com o cuidado de sempre: o redator é **preciso, não exaustivo**, porque `first_prompt` rotula toda
sessão na UI.

---

## 3. Estado do trabalho — onde cada coisa parou

Só quatro worktrees têm código fora do `dev`. Todo o resto já está mergeado.

| worktree | estado | o que fazer |
|---|---|---|
| `services-setup` | 1 commit **wip** (Setup unificado em Services + toggle de boot, 684 linhas) | **não verificado** — rodar `tsc` + `bun test`, revisar, e abrir PR |
| `parse-cache-sqlite` | 9 commits, o último **wip** | idem; é a maior peça independente |
| `cockpit-remount-flash` | 1 commit | **PR #126 já aberto** |
| `agentop-sessions-tui` | 11 commits, órfão, sem sessão e sem remoto | conteúdo já relandado no dev sob outros SHAs — confirmar e **apagar** |

Os dois `wip` foram commitados hoje com `--no-verify`, só para não ficarem a um `checkout` de
sumir. **Não confie neles**: não passaram por `tsc` nem pelos testes.

---

## 4. Ordem sugerida

1. `limit.ts` + testes (é o pedido, e é o que evita a frota parar de novo)
2. 2.2 — reabrir retomando a conversa (é perda de trabalho)
3. 2.1 — gêmeos
4. Fechar `services-setup` e `parse-cache-sqlite` (verificar e abrir PR)
5. 2.3 e 2.4

---

## 5. Aceitação

- `bun test` verde, `bun tsc --noEmit` limpo.
- `limit.ts` tem teste com a **linha real capturada**, NBSP e `·` inclusos, e um teste que falha se
  o padrão for reescrito com espaço comum.
- `parseResetAt` tem teste para o caso 18:30/18:37 — horário **já passado é hoje**, nunca amanhã.
  Errar isso trava a frota exatamente no instante em que a feature deveria disparar.
- Verificação no **binário compilado** (`bun run build:binary`), não só `bun run` — a TUI tem bug de
  bundle que só aparece compilada.
- `packages/tui/scripts/preview.tsx` a 80 colunas sem nenhuma linha estourando a largura.
