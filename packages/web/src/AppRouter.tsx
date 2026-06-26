import React, { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import AppLayout from './App'

const HomePage = lazy(() => import('./pages/HomePage'))
const CostsPage = lazy(() => import('./pages/CostsPage'))
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'))
const ToolsPage = lazy(() => import('./pages/ToolsPage'))
const CustomPage = lazy(() => import('./pages/CustomPage'))
const HarnessPage = lazy(() => import('./pages/HarnessPage'))
const ComparePage = lazy(() => import('./pages/ComparePage'))
const ExportPage = lazy(() => import('./pages/ExportPage'))

function PageFallback() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: 240, color: 'var(--text-tertiary)', fontSize: 13,
    }}>
      Loading…
    </div>
  )
}

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Suspense fallback={<PageFallback />}><HomePage /></Suspense>} />
          <Route path="costs" element={<Suspense fallback={<PageFallback />}><CostsPage /></Suspense>} />
          <Route path="projects" element={<Suspense fallback={<PageFallback />}><ProjectsPage /></Suspense>} />
          <Route path="tools" element={<Suspense fallback={<PageFallback />}><ToolsPage /></Suspense>} />
          <Route path="custom" element={<Suspense fallback={<PageFallback />}><CustomPage /></Suspense>} />
          <Route path="h/:harness" element={<Suspense fallback={<PageFallback />}><HarnessPage /></Suspense>} />
          <Route path="compare" element={<Suspense fallback={<PageFallback />}><ComparePage /></Suspense>} />
          <Route path="export" element={<Suspense fallback={<PageFallback />}><ExportPage /></Suspense>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
