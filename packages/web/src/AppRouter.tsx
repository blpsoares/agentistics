import React, { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import AppLayout from './App'

const HomePage = lazy(() => import('./pages/HomePage'))
const CostsPage = lazy(() => import('./pages/CostsPage'))
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'))
const RepositoriesPage = lazy(() => import('./pages/RepositoriesPage'))
const RepoDetailPage = lazy(() => import('./pages/RepoDetailPage'))
const ActionsPage = lazy(() => import('./pages/ActionsPage'))
const ToolsPage = lazy(() => import('./pages/ToolsPage'))
const CustomPage = lazy(() => import('./pages/CustomPage'))
const ComparePage = lazy(() => import('./pages/ComparePage'))
const ExportPage = lazy(() => import('./pages/ExportPage'))
const SessionsPage = lazy(() => import('./pages/SessionsPage'))
const WorkflowsPage = lazy(() => import('./pages/WorkflowsPage'))

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
          <Route path="sessions" element={<Suspense fallback={<PageFallback />}><SessionsPage /></Suspense>} />
          <Route path="workflows" element={<Suspense fallback={<PageFallback />}><WorkflowsPage /></Suspense>} />
          <Route path="projects" element={<Suspense fallback={<PageFallback />}><ProjectsPage /></Suspense>} />
          <Route path="repositories" element={<Suspense fallback={<PageFallback />}><RepositoriesPage /></Suspense>} />
          <Route path="repositories/actions" element={<Suspense fallback={<PageFallback />}><ActionsPage /></Suspense>} />
          <Route path="repo/:id" element={<Suspense fallback={<PageFallback />}><RepoDetailPage /></Suspense>} />
          <Route path="tools" element={<Suspense fallback={<PageFallback />}><ToolsPage /></Suspense>} />
          <Route path="custom" element={<Suspense fallback={<PageFallback />}><CustomPage /></Suspense>} />
          <Route path="compare" element={<Suspense fallback={<PageFallback />}><ComparePage /></Suspense>} />
          <Route path="export" element={<Suspense fallback={<PageFallback />}><ExportPage /></Suspense>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
