import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, ChevronRight, SkipForward } from 'lucide-react'

export interface TutorialStep {
  id: string
  featureKey: string
  targetSelector: string | null
  titleEn: string
  titlePt: string
  descEn: string
  descPt: string
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center'
}

interface Props {
  steps: TutorialStep[]
  stepIndex: number
  lang: 'en' | 'pt'
  onNext: () => void
  onSkip: () => void
  onSkipAll: () => void
}

const SPOTLIGHT_PADDING = 8
const TOOLTIP_WIDTH = 340
const TOOLTIP_GAP = 16

interface Rect { top: number; left: number; width: number; height: number }

function getTargetRect(selector: string | null): Rect | null {
  if (!selector) return null
  const el = document.querySelector(selector) as HTMLElement | null
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

function computeTooltipPosition(
  rect: Rect | null,
  placement: TutorialStep['placement'],
  win: { w: number; h: number },
): { top: number; left: number } {
  if (!rect || placement === 'center' || !placement) {
    return {
      top: win.h / 2 - 120,
      left: win.w / 2 - TOOLTIP_WIDTH / 2,
    }
  }

  const sp = SPOTLIGHT_PADDING
  const gap = TOOLTIP_GAP

  const spotTop = rect.top - sp
  const spotLeft = rect.left - sp
  const spotRight = rect.left + rect.width + sp
  const spotBottom = rect.top + rect.height + sp

  const TOOLTIP_HEIGHT_ESTIMATE = 200

  if (placement === 'bottom') {
    const top = Math.min(spotBottom + gap, win.h - TOOLTIP_HEIGHT_ESTIMATE - 16)
    const left = Math.max(16, Math.min(spotLeft + rect.width / 2 - TOOLTIP_WIDTH / 2, win.w - TOOLTIP_WIDTH - 16))
    return { top, left }
  }
  if (placement === 'top') {
    const top = Math.max(16, spotTop - gap - TOOLTIP_HEIGHT_ESTIMATE)
    const left = Math.max(16, Math.min(spotLeft + rect.width / 2 - TOOLTIP_WIDTH / 2, win.w - TOOLTIP_WIDTH - 16))
    return { top, left }
  }
  if (placement === 'left') {
    const top = Math.max(16, Math.min(rect.top + rect.height / 2 - TOOLTIP_HEIGHT_ESTIMATE / 2, win.h - TOOLTIP_HEIGHT_ESTIMATE - 16))
    const left = Math.max(16, spotLeft - gap - TOOLTIP_WIDTH)
    return { top, left }
  }
  // right
  const top = Math.max(16, Math.min(rect.top + rect.height / 2 - TOOLTIP_HEIGHT_ESTIMATE / 2, win.h - TOOLTIP_HEIGHT_ESTIMATE - 16))
  const left = Math.min(spotRight + gap, win.w - TOOLTIP_WIDTH - 16)
  return { top, left }
}

export function TutorialOverlay({ steps, stepIndex, lang, onNext, onSkip, onSkipAll }: Props) {
  const step = steps[stepIndex]
  const [targetRect, setTargetRect] = useState<Rect | null>(null)
  const [win, setWin] = useState({ w: window.innerWidth, h: window.innerHeight })
  const tooltipRef = useRef<HTMLDivElement>(null)
  const isLast = stepIndex === steps.length - 1

  useLayoutEffect(() => {
    function update() {
      setWin({ w: window.innerWidth, h: window.innerHeight })
      if (step?.targetSelector) {
        setTargetRect(getTargetRect(step.targetSelector))
      } else {
        setTargetRect(null)
      }
    }
    update()

    // Retry a few times in case the element isn't mounted yet
    const timers = [
      setTimeout(update, 80),
      setTimeout(update, 200),
      setTimeout(update, 500),
    ]
    window.addEventListener('resize', update)
    return () => {
      timers.forEach(clearTimeout)
      window.removeEventListener('resize', update)
    }
  }, [step?.targetSelector, stepIndex])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onSkipAll()
      if (e.key === 'ArrowRight' || e.key === 'Enter') onNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onNext, onSkipAll])

  if (!step) return null

  const sp = SPOTLIGHT_PADDING
  const spotRect = targetRect
    ? {
        x: targetRect.left - sp,
        y: targetRect.top - sp,
        w: targetRect.width + sp * 2,
        h: targetRect.height + sp * 2,
      }
    : null

  const tooltipPos = computeTooltipPosition(targetRect, step.placement, win)
  const title = lang === 'pt' ? step.titlePt : step.titleEn
  const desc = lang === 'pt' ? step.descPt : step.descEn
  const progress = `${stepIndex + 1} / ${steps.length}`
  const nextLabel = isLast
    ? (lang === 'pt' ? 'Concluir' : 'Done')
    : (lang === 'pt' ? 'Próximo' : 'Next')

  return createPortal(
    <>
      {/* SVG overlay — dims everything except spotlight */}
      <svg
        style={{
          position: 'fixed',
          inset: 0,
          width: '100vw',
          height: '100vh',
          zIndex: 9998,
          pointerEvents: 'none',
        }}
      >
        <defs>
          <mask id="tutorial-spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            {spotRect && (
              <rect
                x={spotRect.x}
                y={spotRect.y}
                width={spotRect.w}
                height={spotRect.h}
                rx={8}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.72)"
          mask="url(#tutorial-spotlight-mask)"
        />
        {/* Highlight ring around spotlight */}
        {spotRect && (
          <rect
            x={spotRect.x - 2}
            y={spotRect.y - 2}
            width={spotRect.w + 4}
            height={spotRect.h + 4}
            rx={10}
            fill="none"
            stroke="var(--anthropic-orange, #d97706)"
            strokeWidth={2}
            opacity={0.9}
          />
        )}
      </svg>

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        style={{
          position: 'fixed',
          top: tooltipPos.top,
          left: tooltipPos.left,
          width: TOOLTIP_WIDTH,
          zIndex: 9999,
          background: 'var(--bg-surface, #1c1c1e)',
          border: '1px solid var(--anthropic-orange, #d97706)',
          borderRadius: 14,
          boxShadow: '0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(217,119,6,0.1)',
          padding: '20px 20px 16px',
          animation: 'tutorialFadeIn 0.2s ease-out',
        }}
      >
        <style>{`
          @keyframes tutorialFadeIn {
            from { opacity: 0; transform: translateY(6px); }
            to   { opacity: 1; transform: translateY(0); }
          }
        `}</style>

        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--anthropic-orange, #d97706)',
              opacity: 0.9,
            }}>
              {lang === 'pt' ? 'Tutorial' : 'Tour'} · {progress}
            </span>
            <h3 style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 700,
              color: 'var(--text-primary, #f5f5f5)',
              lineHeight: 1.3,
            }}>
              {title}
            </h3>
          </div>
          <button
            onClick={onSkipAll}
            title={lang === 'pt' ? 'Fechar tutorial' : 'Close tour'}
            style={{
              flexShrink: 0,
              width: 26,
              height: 26,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              color: 'var(--text-tertiary, #888)',
              marginTop: -2,
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary, #f5f5f5)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary, #888)')}
          >
            <X size={14} />
          </button>
        </div>

        {/* Description */}
        <p style={{
          margin: '0 0 16px',
          fontSize: 13,
          lineHeight: 1.6,
          color: 'var(--text-secondary, #aaa)',
        }}>
          {desc}
        </p>

        {/* Step indicator dots */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 14 }}>
          {steps.map((_, i) => (
            <div
              key={i}
              style={{
                width: i === stepIndex ? 16 : 6,
                height: 6,
                borderRadius: 3,
                background: i === stepIndex
                  ? 'var(--anthropic-orange, #d97706)'
                  : i < stepIndex
                    ? 'var(--text-tertiary, #888)'
                    : 'var(--border, #333)',
                transition: 'all 0.2s',
              }}
            />
          ))}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={onSkipAll}
            style={{
              flex: 1,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              background: 'transparent',
              border: '1px solid var(--border, #333)',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 12,
              color: 'var(--text-tertiary, #888)',
              fontFamily: 'inherit',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--text-tertiary, #888)'
              e.currentTarget.style.color = 'var(--text-primary, #f5f5f5)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--border, #333)'
              e.currentTarget.style.color = 'var(--text-tertiary, #888)'
            }}
          >
            <SkipForward size={12} />
            {lang === 'pt' ? 'Pular tudo' : 'Skip all'}
          </button>

          {!isLast && (
            <button
              onClick={onSkip}
              style={{
                flex: 1,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                border: '1px solid var(--border, #333)',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 12,
                color: 'var(--text-secondary, #aaa)',
                fontFamily: 'inherit',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'var(--text-tertiary, #888)'
                e.currentTarget.style.color = 'var(--text-primary, #f5f5f5)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--border, #333)'
                e.currentTarget.style.color = 'var(--text-secondary, #aaa)'
              }}
            >
              {lang === 'pt' ? 'Pular' : 'Skip'}
            </button>
          )}

          <button
            onClick={onNext}
            style={{
              flex: 2,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              background: 'var(--anthropic-orange, #d97706)',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              color: '#fff',
              fontFamily: 'inherit',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.88')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            {nextLabel}
            {!isLast && <ChevronRight size={14} />}
          </button>
        </div>

        <div style={{ marginTop: 10, fontSize: 10, color: 'var(--text-tertiary, #888)', textAlign: 'center', opacity: 0.7 }}>
          {lang === 'pt' ? 'Esc para fechar · → para avançar' : 'Esc to close · → to advance'}
        </div>
      </div>
    </>,
    document.body
  )
}
