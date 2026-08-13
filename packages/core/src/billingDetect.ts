/**
 * billingDetect.ts — read the signals a machine already carries and PROPOSE how it is billed.
 *
 * ── A PROPOSAL, NEVER AN AUTHORITY ───────────────────────────────────────────────────────────
 * Nothing here is ever written anywhere. Every result carries `proposalOnly: true`, the user
 * confirms it, and confirming creates an ordinary hand-entered period through the same validation
 * as any other. That is not caution for its own sake: detection can see only the CURRENT state,
 * and the thing the timeline needs most is WHEN a plan started — which no file on the machine
 * records. A confident auto-applied "you are on Max" with a made-up start date would price
 * months the user was on something else.
 *
 * ── THE WHITELIST IS THE SECURITY BOUNDARY ───────────────────────────────────────────────────
 * `BillingSignals` is deliberately a narrow, flat interface rather than "the parsed file". The
 * files these signals come from also hold OAuth access and refresh tokens, an email address,
 * account and organization UUIDs and a display name. The reader on the server side may extract
 * only what appears below, and `billing-detect.test.ts` fails if that module so much as NAMES a
 * forbidden field. A field this type cannot express is a field that cannot leak.
 *
 * `ANTHROPIC_API_KEY` is reduced to the literal `'set'` before it ever reaches this module: its
 * PRESENCE is the signal, and its value is a credential we have no reason to hold.
 *
 * ── ORDER MATTERS, AND IT IS NOT THE ORDER OF CONFIDENCE ─────────────────────────────────────
 * Third-party routing is checked FIRST even though the OAuth block is the richer signal. A user
 * with `ANTHROPIC_BASE_URL` set is billed by whoever runs that endpoint, and their Claude account
 * may still be a perfectly valid Max subscription that has nothing to do with what they pay for
 * this work. Reading the subscription first would confidently price a gateway's traffic against
 * a plan it never touched.
 */

import type { HarnessId } from './types'
import type { BillingMode } from './billing'

/**
 * EXACTLY the fields the reader is allowed to extract. Nothing else may ever be added here —
 * see the header. Every field is optional: an absent signal is absent, never a reason to go
 * looking harder (notably, macOS keeps the credentials in the Keychain and this product does
 * NOT shell out to `security` to read them, because probing it prompts the user).
 */
export interface BillingSignals {
  env: {
    CLAUDE_CODE_USE_BEDROCK?: string
    CLAUDE_CODE_USE_VERTEX?: string
    ANTHROPIC_BASE_URL?: string
    /** PRESENCE only. The reader passes the literal `'set'` or omits the field. */
    ANTHROPIC_API_KEY?: 'set'
  }
  /** `~/.claude/settings.json` declares `apiKeyHelper`. The command string is never read. */
  hasApiKeyHelper: boolean
  /** `~/.claude.json` → `oauthAccount`, these three fields only. */
  oauth?: {
    billingType?: string
    organizationType?: string
    organizationRateLimitTier?: string
  }
  /** `~/.claude/.credentials.json` → `claudeAiOauth`, these two only. Absent on macOS. */
  credentials?: {
    subscriptionType?: string
    rateLimitTier?: string
  }
  /** `stats-cache.json` totals — the heuristic tiebreaker of last resort. */
  usage?: {
    totalCostUSD: number
    totalTokens: number
  }
}

/**
 * Codex's equivalent, and the ONLY other harness whose plan is legible offline.
 *
 * The plan sits in a claim of the OAuth id token — a JWT, and therefore a bearer credential. The
 * reader decodes ONLY its payload segment, lifts this one claim, and lets the token itself go; it
 * never reaches this module, is never stored and is never logged. The other harnesses have no
 * local answer at all: Copilot's tier comes from the GitHub API, Gemini's is inferable only from
 * an OAuth scope string, Kimi is API-key billed by definition and Antigravity's token carries no
 * plan metadata.
 */
export interface CodexSignals {
  /** The `chatgpt_plan_type` claim, lowercased. Never the token it came from. */
  planType?: string
  /** PRESENCE only: an API key is configured, so this machine bills per token. */
  apiKey?: 'set'
}

export type BillingDetectionSource =
  | 'env_thirdparty'
  | 'claude_json_oauth'
  | 'credentials'
  | 'env_api_key'
  | 'zero_cost_heuristic'
  | 'codex_id_token'
  | 'none'

export interface BillingDetection {
  harness: HarnessId
  mode: BillingMode
  /** A `plan-catalog.ts` id, when the signal pinned an exact tier. */
  planId?: string
  source: BillingDetectionSource
  /** Names the file and field that decided it, so the confirmation dialog is auditable. May
   *  contain only whitelisted field names and their (non-secret) values. */
  evidenceEn: string
  evidencePt: string
  /** `exact` — the signal names the tier. `likely` — it names the family but not the tier.
   *  `guess` — inferred from behaviour, not from a declared field. */
  confidence: 'exact' | 'likely' | 'guess'
  /** Always true. Kept as a field rather than left implicit so every consumer must see it. */
  proposalOnly: true
}

const has = (value: string | undefined): boolean =>
  typeof value === 'string' && value !== '' && value !== '0' && value.toLowerCase() !== 'false'

/** A rate-limit tier string → the catalog id it names, or `undefined`. Matches on a substring
 *  because the field has carried both `default_claude_max_5x` and bare `max_5x` shapes. */
function planFromTier(tier: string | undefined): string | undefined {
  if (typeof tier !== 'string') return undefined
  const t = tier.toLowerCase()
  if (t.includes('max_20x') || t.includes('max20x')) return 'anthropic-max-20x'
  if (t.includes('max_5x') || t.includes('max5x')) return 'anthropic-max-5x'
  return undefined
}

/**
 * The signal chain, first hit wins.
 *
 * Only Claude has a detector today — every signal above comes from `~/.claude`. Other harnesses
 * return `source: 'none'` from the server rather than being omitted, so the UI can say "nothing
 * detected for Codex" instead of leaving a silent gap the user reads as "already handled".
 */
export function detectBilling(signals: BillingSignals): BillingDetection {
  const harness: HarnessId = 'claude'
  const base = { harness, proposalOnly: true } as const

  // 1 — third-party routing. Checked first: it decides who bills this work, and it overrides a
  // perfectly valid subscription sitting in the same account.
  const { CLAUDE_CODE_USE_BEDROCK, CLAUDE_CODE_USE_VERTEX, ANTHROPIC_BASE_URL } = signals.env
  if (has(CLAUDE_CODE_USE_BEDROCK) || has(CLAUDE_CODE_USE_VERTEX) || has(ANTHROPIC_BASE_URL)) {
    const which = has(CLAUDE_CODE_USE_BEDROCK)
      ? 'CLAUDE_CODE_USE_BEDROCK'
      : has(CLAUDE_CODE_USE_VERTEX)
        ? 'CLAUDE_CODE_USE_VERTEX'
        : 'ANTHROPIC_BASE_URL'
    return {
      ...base,
      mode: 'thirdparty',
      source: 'env_thirdparty',
      confidence: 'exact',
      evidenceEn: `${which} is set, so this machine's usage is billed by that provider, not by Anthropic.`,
      evidencePt: `${which} está definido, então o uso desta máquina é cobrado por esse provedor, não pela Anthropic.`,
    }
  }

  // 2 — the OAuth profile in ~/.claude.json. The richest non-secret signal, and the only one that
  // names the exact tier.
  const oauth = signals.oauth
  if (oauth?.billingType === 'stripe_subscription' || oauth?.organizationType) {
    const fromTier = planFromTier(oauth.organizationRateLimitTier)
    if (fromTier) {
      return {
        ...base,
        mode: 'subscription',
        planId: fromTier,
        source: 'claude_json_oauth',
        confidence: 'exact',
        evidenceEn: `~/.claude.json names organizationRateLimitTier "${oauth.organizationRateLimitTier}".`,
        evidencePt: `~/.claude.json informa organizationRateLimitTier "${oauth.organizationRateLimitTier}".`,
      }
    }
    const orgType = (oauth.organizationType ?? '').toLowerCase()
    if (orgType.includes('pro')) {
      return {
        ...base,
        mode: 'subscription',
        planId: 'anthropic-pro',
        source: 'claude_json_oauth',
        confidence: 'exact',
        evidenceEn: `~/.claude.json names organizationType "${oauth.organizationType}".`,
        evidencePt: `~/.claude.json informa organizationType "${oauth.organizationType}".`,
      }
    }
    if (orgType.includes('max')) {
      return {
        ...base,
        mode: 'subscription',
        planId: 'anthropic-max-5x',
        source: 'claude_json_oauth',
        confidence: 'likely',
        evidenceEn: `~/.claude.json names organizationType "${oauth.organizationType}" but no tier — 5x is the entry tier, so confirm which Max you are on.`,
        evidencePt: `~/.claude.json informa organizationType "${oauth.organizationType}" mas nenhum nível — 5x é o de entrada, então confirme qual Max você tem.`,
      }
    }
    if (oauth.billingType === 'stripe_subscription') {
      return {
        ...base,
        mode: 'subscription',
        source: 'claude_json_oauth',
        confidence: 'likely',
        evidenceEn: '~/.claude.json reports billingType "stripe_subscription" but names no plan — pick the one you pay for.',
        evidencePt: '~/.claude.json informa billingType "stripe_subscription" mas não nomeia o plano — escolha o que você paga.',
      }
    }
  }

  // 3 — the credentials file. Same shape, Linux/WSL only.
  const creds = signals.credentials
  const credType = (creds?.subscriptionType ?? '').toLowerCase()
  if (credType) {
    const fromTier = planFromTier(creds?.rateLimitTier)
    if (credType === 'pro') {
      return {
        ...base,
        mode: 'subscription',
        planId: 'anthropic-pro',
        source: 'credentials',
        confidence: 'exact',
        evidenceEn: '~/.claude/.credentials.json reports subscriptionType "pro".',
        evidencePt: '~/.claude/.credentials.json informa subscriptionType "pro".',
      }
    }
    if (credType === 'max') {
      return {
        ...base,
        mode: 'subscription',
        planId: fromTier ?? 'anthropic-max-5x',
        source: 'credentials',
        confidence: fromTier ? 'exact' : 'likely',
        evidenceEn: fromTier
          ? `~/.claude/.credentials.json reports rateLimitTier "${creds?.rateLimitTier}".`
          : '~/.claude/.credentials.json reports subscriptionType "max" but no tier — confirm which Max you are on.',
        evidencePt: fromTier
          ? `~/.claude/.credentials.json informa rateLimitTier "${creds?.rateLimitTier}".`
          : '~/.claude/.credentials.json informa subscriptionType "max" mas nenhum nível — confirme qual Max você tem.',
      }
    }
    if (credType === 'team' || credType === 'enterprise') {
      return {
        ...base,
        mode: 'subscription',
        planId: credType === 'team' ? 'anthropic-team' : undefined,
        source: 'credentials',
        confidence: 'likely',
        evidenceEn: `~/.claude/.credentials.json reports subscriptionType "${credType}" — enter the per-seat amount you are charged.`,
        evidencePt: `~/.claude/.credentials.json informa subscriptionType "${credType}" — informe o valor por assento cobrado de você.`,
      }
    }
  }

  // 4 — an API key, or a helper that mints one.
  if (signals.env.ANTHROPIC_API_KEY === 'set' || signals.hasApiKeyHelper) {
    const which = signals.env.ANTHROPIC_API_KEY === 'set' ? 'ANTHROPIC_API_KEY' : 'apiKeyHelper'
    return {
      ...base,
      mode: 'api',
      planId: 'api-payg',
      source: 'env_api_key',
      confidence: 'likely',
      evidenceEn: `${which} is configured, so this machine bills per token through the console.`,
      evidencePt: `${which} está configurado, então esta máquina é cobrada por token no console.`,
    }
  }

  // 5 — the behavioural tiebreaker. Claude Code stops tracking cost when the account is on a
  // subscription, so real tokens with a zero cost is a strong hint and a weak fact.
  const usage = signals.usage
  if (usage && usage.totalTokens > 0 && usage.totalCostUSD === 0) {
    return {
      ...base,
      mode: 'subscription',
      source: 'zero_cost_heuristic',
      confidence: 'guess',
      evidenceEn: 'stats-cache.json records real token usage with zero cost, which Claude Code does on a subscription — but it does not say which plan.',
      evidencePt: 'stats-cache.json registra uso real de tokens com custo zero, o que o Claude Code faz numa assinatura — mas não diz qual plano.',
    }
  }

  return {
    ...base,
    mode: 'unknown',
    source: 'none',
    confidence: 'guess',
    evidenceEn: 'No billing signal was found on this machine.',
    evidencePt: 'Nenhum sinal de cobrança foi encontrado nesta máquina.',
  }
}

/** ChatGPT plan claim → catalog id. Only the tiers the catalog names; anything else is a
 *  subscription with no id, which the form then asks the user to pick. */
const CHATGPT_PLANS: Record<string, string> = {
  plus: 'openai-plus',
  pro: 'openai-pro',
  go: 'openai-go',
  business: 'openai-business',
  team: 'openai-business',
  enterprise: 'openai-business',
}

/**
 * Codex's chain. Shorter than Claude's because there is less to read: an API key, or the plan
 * claim, or nothing.
 *
 * A FREE plan is reported as `unknown`, not as a subscription of zero. Zero is not a price — a
 * period priced at nothing would make every multiple infinite — and "you are on the free tier,
 * there is no subscription to register" is the honest sentence.
 */
export function detectCodexBilling(signals: CodexSignals): BillingDetection {
  const base = { harness: 'codex' as HarnessId, proposalOnly: true } as const

  if (signals.apiKey === 'set') {
    return {
      ...base,
      mode: 'api',
      planId: 'api-payg',
      source: 'env_api_key',
      confidence: 'likely',
      evidenceEn: '~/.codex/auth.json holds an API key, so this machine bills per token.',
      evidencePt: '~/.codex/auth.json tem uma chave de API, então esta máquina é cobrada por token.',
    }
  }

  const plan = (signals.planType ?? '').toLowerCase()
  if (plan === 'free') {
    return {
      ...base,
      mode: 'unknown',
      source: 'codex_id_token',
      confidence: 'exact',
      evidenceEn: 'Your ChatGPT account is on the free tier — there is no subscription cost to register.',
      evidencePt: 'Sua conta ChatGPT está no plano gratuito — não há custo de assinatura a cadastrar.',
    }
  }
  if (plan) {
    const planId = CHATGPT_PLANS[plan]
    return {
      ...base,
      mode: 'subscription',
      ...(planId ? { planId } : {}),
      source: 'codex_id_token',
      confidence: planId ? 'exact' : 'likely',
      evidenceEn: `Your ChatGPT sign-in reports the "${plan}" plan.`,
      evidencePt: `Seu login do ChatGPT informa o plano "${plan}".`,
    }
  }

  return {
    ...base,
    mode: 'unknown',
    source: 'none',
    confidence: 'guess',
    evidenceEn: 'No billing signal was found for Codex on this machine.',
    evidencePt: 'Nenhum sinal de cobrança do Codex foi encontrado nesta máquina.',
  }
}
