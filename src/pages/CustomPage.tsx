import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { GridLayout, useContainerWidth, type Layout, type LayoutItem } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import {
  Layers, X, RotateCcw, Search, ChevronDown, ChevronRight,
  PanelLeftClose, PanelLeftOpen, Plus, Trash2, Pencil, Check,
} from 'lucide-react'
import type { AppContext } from '../lib/app-context'
import { CATALOG, CATEGORY_LABELS, getCatalogItem, type CatalogItem, type CatalogCategory } from '../lib/componentCatalog'
import { useCustomLayout, type GridItem } from '../hooks/useCustomLayout'

const GRID_COLS = 12
const GRID_ROW_HEIGHT = 40
const ASIDE_WIDTH = 300

export default function CustomPage() {
  const ctx = useOutletContext<AppContext>()
  const { lang } = ctx
  const {
    items, setItems, addItem, removeItem, reset, loaded,
    layoutNames, activeLayout,
    switchLayout, createLayout, renameLayout, deleteLayout,
  } = useCustomLayout()

  const [draggedCatalogItem, setDraggedCatalogItem] = useState<CatalogItem | null>(null)
  const draggedCatalogItemRef = useRef<CatalogItem | null>(null)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<CatalogCategory, boolean>>({
    kpi: false, activity: false, costs: false, projects: false, tools: false, sessions: false,
  })
  const nextIdRef = useRef(Date.now())

  // Aside open/close
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // Layout rename state
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  // Sync rename input when active layout changes
  useEffect(() => { setRenameValue(activeLayout) }, [activeLayout])

  const { width: gridWidth, containerRef, mounted } = useContainerWidth()
  const pt = lang === 'pt'

  // Grouped catalog for the aside palette
  const groupedCatalog = useMemo(() => {
    const q = query.trim().toLowerCase()
    const groups: Record<CatalogCategory, CatalogItem[]> = {
      kpi: [], activity: [], costs: [], projects: [], tools: [], sessions: [],
    }
    for (const item of CATALOG) {
      const label = (pt ? item.labelPt : item.labelEn).toLowerCase()
      if (q && !label.includes(q)) continue
      groups[item.category].push(item)
    }
    return groups
  }, [pt, query])

  // Convert items to RGL Layout format
  const layout: Layout = useMemo(
    () => items.map(it => ({ i: it.i, x: it.x, y: it.y, w: it.w, h: it.h, minW: it.minW, minH: it.minH })),
    [items]
  )

  // onLayoutChange: only updates positions, never removes items (guards against
  // RGL firing with intermediate empty layouts during external drop)
  function onLayoutChange(next: Layout) {
    const merged: GridItem[] = next.map(l => {
      const existing = items.find(it => it.i === l.i)
      return {
        i: l.i,
        x: l.x, y: l.y, w: l.w, h: l.h,
        minW: l.minW, minH: l.minH,
        componentId: existing?.componentId ?? '',
      }
    }).filter(it => it.componentId !== '')
    if (merged.length < items.length) return
    const changed = merged.length !== items.length
      || merged.some(m => {
        const prev = items.find(x => x.i === m.i)
        return !prev || prev.x !== m.x || prev.y !== m.y || prev.w !== m.w || prev.h !== m.h
      })
    if (changed) setItems(merged)
  }

  function onDrop(_layout: Layout, item: LayoutItem | undefined, _e: Event) {
    const catalog = draggedCatalogItemRef.current
    draggedCatalogItemRef.current = null
    setDraggedCatalogItem(null)
    if (!catalog || !item) return
    const instanceId = `${catalog.id}__${nextIdRef.current++}`
    addItem({
      i: instanceId,
      x: item.x,
      y: item.y,
      w: catalog.defaultW,
      h: catalog.defaultH,
      minW: catalog.minW,
      minH: catalog.minH,
      componentId: catalog.id,
    })
  }

  function handlePaletteDragStart(e: React.DragEvent, catalog: CatalogItem) {
    draggedCatalogItemRef.current = catalog
    setDraggedCatalogItem(catalog)
    e.dataTransfer.setData('text/plain', catalog.id)
    e.dataTransfer.effectAllowed = 'copy'
  }

  function handlePaletteDragEnd() {
    draggedCatalogItemRef.current = null
    setDraggedCatalogItem(null)
  }

  // Layout management helpers
  function handleNewLayout() {
    const base = pt ? 'Layout' : 'Layout'
    let n = layoutNames.length + 1
    let name = `${base} ${n}`
    while (layoutNames.includes(name)) name = `${base} ${++n}`
    createLayout(name)
  }

  function handleStartRename() {
    setRenameValue(activeLayout)
    setRenaming(true)
    setTimeout(() => renameInputRef.current?.select(), 30)
  }

  function handleCommitRename() {
    renameLayout(activeLayout, renameValue)
    setRenaming(false)
  }

  function handleDeleteLayout() {
    if (layoutNames.length <= 1) return
    const hasItems = items.length > 0
    const msg = pt
      ? `Deletar o layout "${activeLayout}"?${hasItems ? ' Todos os componentes serão removidos.' : ''}`
      : `Delete layout "${activeLayout}"?${hasItems ? ' All components will be removed.' : ''}`
    if (confirm(msg)) deleteLayout(activeLayout)
  }

  if (!loaded) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: 'var(--text-tertiary)', fontSize: 13 }}>
        {pt ? 'Carregando layout personalizado…' : 'Loading custom layout…'}
      </div>
    )
  }

  const droppingItem: LayoutItem | undefined = draggedCatalogItem ? {
    i: '__dropping__', x: 0, y: 0,
    w: draggedCatalogItem.defaultW,
    h: draggedCatalogItem.defaultH,
  } : undefined

  return (
    <div style={{ display: 'flex', gap: sidebarOpen ? 16 : 0, alignItems: 'flex-start', minHeight: 'calc(100vh - 250px)' }}>
      {/* CSS */}
      <style>{`
        .custom-grid .react-grid-item.react-grid-placeholder {
          background: var(--anthropic-orange) !important;
          opacity: 0.18;
          border-radius: var(--radius-lg);
          transition: all 120ms ease;
        }
        .custom-grid .react-grid-item > .react-resizable-handle {
          background-image: none;
          width: 18px; height: 18px;
          right: 2px; bottom: 2px;
          opacity: 0.3;
          transition: opacity 0.15s;
        }
        .custom-grid .react-grid-item > .react-resizable-handle::after {
          border-right: 2px solid var(--text-secondary);
          border-bottom: 2px solid var(--text-secondary);
          width: 8px; height: 8px;
          right: 4px; bottom: 4px;
          content: ''; position: absolute;
        }
        .custom-grid .react-grid-item:hover > .react-resizable-handle { opacity: 1; }
        .custom-grid .react-grid-item { transition: transform 180ms ease, box-shadow 120ms ease; }
        .custom-grid .react-grid-item.cssTransforms { transition-property: transform, width, height; }
        .custom-grid .react-grid-item.react-draggable-dragging {
          box-shadow: 0 12px 32px rgba(0,0,0,0.35); z-index: 10; cursor: grabbing !important;
        }
        .custom-grid .react-grid-item.resizing { opacity: 0.85; z-index: 10; }
        .palette-item { transition: transform 0.12s, background 0.12s, border-color 0.12s; user-select: none; }
        .palette-item:hover { transform: translateY(-1px); background: var(--bg-elevated); border-color: var(--anthropic-orange) !important; }
        .palette-item[data-dragging="true"] { opacity: 0.5; transform: scale(0.96); }
        .grid-item-remove { opacity: 0; transition: opacity 0.12s; }
        .grid-item-wrap:hover .grid-item-remove { opacity: 1; }
        .layout-rename-input {
          background: var(--bg-elevated); border: 1px solid var(--anthropic-orange)60;
          border-radius: 6px; color: var(--text-primary); font-family: inherit;
          font-size: 12px; font-weight: 600; padding: 4px 8px; outline: none; width: 100%;
          box-sizing: border-box;
        }
        .icon-btn {
          display: flex; align-items: center; justify-content: center;
          width: 26px; height: 26px; border-radius: 6px; border: 1px solid var(--border);
          background: transparent; cursor: pointer; color: var(--text-tertiary);
          transition: background 0.12s, color 0.12s, border-color 0.12s;
          flex-shrink: 0;
        }
        .icon-btn:hover { background: var(--bg-elevated); color: var(--text-primary); border-color: var(--border); }
        .icon-btn.danger:hover { color: #ef4444; border-color: #ef444440; }
        .icon-btn.accent { color: var(--anthropic-orange); border-color: var(--anthropic-orange)40; }
        .icon-btn.accent:hover { background: var(--anthropic-orange-dim); }
        .icon-btn:disabled { opacity: 0.35; cursor: not-allowed; }
      `}</style>

      {/* ─── Sidebar reopen button (shown when sidebar is closed) ─── */}
      {!sidebarOpen && (
        <button
          className="icon-btn"
          onClick={() => setSidebarOpen(true)}
          title={pt ? 'Abrir paleta' : 'Open palette'}
          style={{ position: 'sticky', top: 180, flexShrink: 0, width: 32, height: 32 }}
        >
          <PanelLeftOpen size={15} />
        </button>
      )}

      {/* ─── Aside / Palette ─── */}
      {sidebarOpen && (
        <aside style={{
          width: ASIDE_WIDTH,
          flexShrink: 0,
          position: 'sticky',
          top: 180,
          maxHeight: 'calc(100vh - 200px)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}>

          {/* ── Layout management card ── */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '12px 14px',
          }}>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <Layers size={13} style={{ color: 'var(--anthropic-orange)', flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-tertiary)', flex: 1 }}>
                {pt ? 'Layouts' : 'Layouts'}
              </span>
              <button
                className="icon-btn"
                onClick={() => setSidebarOpen(false)}
                title={pt ? 'Fechar paleta' : 'Close palette'}
              >
                <PanelLeftClose size={13} />
              </button>
            </div>

            {/* Active layout name (editable) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              {renaming ? (
                <>
                  <input
                    ref={renameInputRef}
                    className="layout-rename-input"
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleCommitRename(); if (e.key === 'Escape') setRenaming(false) }}
                    onBlur={handleCommitRename}
                    autoFocus
                  />
                  <button className="icon-btn accent" onClick={handleCommitRename} title={pt ? 'Salvar' : 'Save'}>
                    <Check size={12} />
                  </button>
                </>
              ) : (
                <>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {layoutNames.length > 1 ? (
                      <select
                        value={activeLayout}
                        onChange={e => switchLayout(e.target.value)}
                        style={{
                          width: '100%', background: 'var(--bg-elevated)',
                          border: '1px solid var(--border-subtle)', borderRadius: 6,
                          color: 'var(--text-primary)', fontFamily: 'inherit',
                          fontSize: 12, fontWeight: 600, padding: '5px 8px', cursor: 'pointer',
                          outline: 'none',
                        }}
                      >
                        {layoutNames.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    ) : (
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', padding: '5px 0' }}>
                        {activeLayout}
                      </div>
                    )}
                  </div>
                  <button className="icon-btn" onClick={handleStartRename} title={pt ? 'Renomear' : 'Rename'}>
                    <Pencil size={12} />
                  </button>
                </>
              )}
            </div>

            {/* Action row */}
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className="icon-btn accent"
                onClick={handleNewLayout}
                title={pt ? 'Novo layout' : 'New layout'}
                style={{ flex: 1, width: 'auto', gap: 5, fontSize: 11, fontWeight: 600 }}
              >
                <Plus size={12} />
                {pt ? 'Novo' : 'New'}
              </button>
              <button
                className="icon-btn danger"
                onClick={handleDeleteLayout}
                title={pt ? 'Deletar layout' : 'Delete layout'}
                disabled={layoutNames.length <= 1}
                style={{ opacity: layoutNames.length <= 1 ? 0.3 : 1 }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>

          {/* ── Palette header + search ── */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '12px 14px 10px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <Layers size={14} style={{ color: 'var(--anthropic-orange)' }} />
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                {pt ? 'Componentes' : 'Components'}
              </div>
            </div>
            <div style={{ position: 'relative' }}>
              <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
              <input
                type="text"
                placeholder={pt ? 'Buscar…' : 'Search…'}
                value={query}
                onChange={e => setQuery(e.target.value)}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '7px 10px 7px 30px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8, fontSize: 12,
                  color: 'var(--text-primary)', fontFamily: 'inherit', outline: 'none',
                }}
                onFocus={e => e.currentTarget.style.borderColor = 'var(--anthropic-orange)40'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border-subtle)'}
              />
            </div>
          </div>

          {/* ── Palette item list ── */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '6px',
            overflow: 'auto',
            flex: 1,
          }}>
            {(Object.keys(groupedCatalog) as CatalogCategory[]).map(cat => {
              const catItems = groupedCatalog[cat]
              if (catItems.length === 0) return null
              const isCollapsed = collapsed[cat]
              return (
                <div key={cat} style={{ marginBottom: 4 }}>
                  <button
                    onClick={() => setCollapsed(prev => ({ ...prev, [cat]: !prev[cat] }))}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 6,
                      padding: '8px 10px', background: 'transparent', border: 'none',
                      cursor: 'pointer', fontFamily: 'inherit', fontSize: 11,
                      fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                      color: 'var(--text-tertiary)', borderRadius: 6,
                    }}
                  >
                    {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                    {pt ? CATEGORY_LABELS[cat].pt : CATEGORY_LABELS[cat].en}
                    <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.6 }}>{catItems.length}</span>
                  </button>
                  {!isCollapsed && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '2px 4px 6px' }}>
                      {catItems.map(item => {
                        const Icon = item.icon
                        const isVariant = !!item.parentId
                        return (
                          <div
                            key={item.id}
                            className="droppable-element palette-item"
                            draggable
                            data-dragging={draggedCatalogItem?.id === item.id ? 'true' : 'false'}
                            onDragStart={e => handlePaletteDragStart(e, item)}
                            onDragEnd={handlePaletteDragEnd}
                            title={pt
                              ? `Arraste para o canvas. Tamanho padrão: ${item.defaultW}×${item.defaultH}.`
                              : `Drag onto the canvas. Default size: ${item.defaultW}×${item.defaultH}.`}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              padding: '7px 10px',
                              marginLeft: isVariant ? 14 : 0,
                              background: 'transparent',
                              border: '1px dashed var(--border)',
                              borderRadius: 8, cursor: 'grab',
                              fontSize: 12, color: 'var(--text-secondary)',
                            }}
                          >
                            <Icon size={13} />
                            <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {pt ? item.labelPt : item.labelEn}
                            </span>
                            {isVariant && (
                              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', padding: '1px 5px', background: 'var(--bg-elevated)', borderRadius: 4, letterSpacing: '0.05em' }}>
                                VAR
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {items.length > 0 && (
            <button
              onClick={() => {
                if (confirm(pt ? 'Remover todos os componentes do canvas?' : 'Remove all components from the canvas?')) reset()
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center',
                padding: '8px 12px', background: 'transparent',
                border: '1px solid var(--border)', borderRadius: 8,
                color: 'var(--text-tertiary)', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 12, fontWeight: 500, transition: 'all 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#ef4444'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#ef444460' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-tertiary)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)' }}
            >
              <RotateCcw size={12} />
              {pt ? 'Limpar canvas' : 'Clear canvas'}
            </button>
          )}
        </aside>
      )}

      {/* ─── Main canvas ─── */}
      <div ref={containerRef} style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          position: 'relative',
          background: 'var(--bg-base)',
          border: '1px dashed var(--border)',
          borderRadius: 'var(--radius-lg)',
          minHeight: 400,
          padding: 8,
        }}>
          {items.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
              <EmptyState pt={pt} />
            </div>
          )}
          {mounted && gridWidth > 0 && (
            <GridLayout
              className="custom-grid"
              width={gridWidth}
              layout={layout}
              style={items.length === 0 ? { minHeight: 380 } : undefined}
              gridConfig={{
                cols: GRID_COLS,
                rowHeight: GRID_ROW_HEIGHT,
                margin: [12, 12],
                containerPadding: null,
                maxRows: Infinity,
              }}
              dragConfig={{ enabled: true, bounded: false, handle: '.grid-drag-handle', threshold: 3 }}
              resizeConfig={{ enabled: true, handles: ['se'] }}
              dropConfig={{ enabled: true, defaultItem: { w: 4, h: 3 } }}
              droppingItem={droppingItem}
              onLayoutChange={onLayoutChange}
              onDrop={onDrop}
              autoSize
            >
              {items.map(item => {
                const catalog = getCatalogItem(item.componentId)
                if (!catalog) return <div key={item.i} />
                return (
                  <div key={item.i} className="grid-item-wrap" style={{ overflow: 'hidden', borderRadius: 'var(--radius-lg)' }}>
                    <div
                      className="grid-drag-handle"
                      title={pt ? 'Arrastar' : 'Drag'}
                      style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 24, zIndex: 3, cursor: 'grab' }}
                    />
                    <button
                      className="grid-item-remove"
                      onClick={() => removeItem(item.i)}
                      title={pt ? 'Remover' : 'Remove'}
                      style={{
                        position: 'absolute', top: 6, right: 6, zIndex: 4,
                        width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                        borderRadius: 6, color: 'var(--text-tertiary)', cursor: 'pointer', padding: 0,
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#ef4444'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#ef4444' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-tertiary)'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)' }}
                    >
                      <X size={12} />
                    </button>
                    <div style={{ width: '100%', height: '100%', overflow: 'auto' }}>
                      {catalog.render(ctx)}
                    </div>
                  </div>
                )
              })}
            </GridLayout>
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyState({ pt }: { pt: boolean }) {
  return (
    <div style={{
      height: '100%', padding: '60px 40px', textAlign: 'center',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16,
    }}>
      <div style={{
        width: 56, height: 56,
        background: 'var(--anthropic-orange-dim)', border: '1px solid var(--anthropic-orange)40',
        borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Layers size={24} color="var(--anthropic-orange)" />
      </div>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
          {pt ? 'Monte sua página' : 'Build your own page'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6, maxWidth: 440 }}>
          {pt
            ? 'Arraste componentes da paleta para esta área. Redimensione pelo canto inferior direito de cada card.'
            : 'Drag components from the palette onto this area. Resize using the bottom-right corner of each card.'}
        </div>
      </div>
    </div>
  )
}
