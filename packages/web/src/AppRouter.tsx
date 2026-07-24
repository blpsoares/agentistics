import React, { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
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
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage'))
const PreferencesSettings = lazy(() => import('./pages/settings/PreferencesSettings'))
const SessionsSettings = lazy(() => import('./pages/settings/SessionsSettings'))
const DataSourcesSettings = lazy(() => import('./pages/settings/DataSourcesSettings'))
const HarnessesSettings = lazy(() => import('./pages/settings/HarnessesSettings'))
const InstallSettings = lazy(() => import('./pages/settings/InstallSettings'))
const ConnectionSettings = lazy(() => import('./pages/settings/ConnectionSettings'))
const LiveSettings = lazy(() => import('./pages/settings/LiveSettings'))
const UsersSettings = lazy(() => import('./pages/settings/UsersSettings'))
const TeamsSettings = lazy(() => import('./pages/settings/TeamsSettings'))
const MachinesSettings = lazy(() => import('./pages/settings/MachinesSettings'))
const ReposSettingsPage = lazy(() => import('./pages/settings/ReposSettingsPage'))

function PageFallback() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 340, padding: 40 }}>
      <div className="ag-loader" role="status" aria-label="Loading">
        <div className="ag-loader-bars" aria-hidden="true">
          <span /><span /><span /><span /><span />
        </div>
        <div className="ag-loader-label">agentistics</div>
      </div>
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
          <Route path="settings" element={<Suspense fallback={<PageFallback />}><SettingsPage /></Suspense>}>
            <Route index element={<Navigate to="preferences" replace />} />
            <Route path="preferences" element={<Suspense fallback={<PageFallback />}><PreferencesSettings /></Suspense>} />
            <Route path="sessions" element={<Suspense fallback={<PageFallback />}><SessionsSettings /></Suspense>} />
            <Route path="data-sources" element={<Suspense fallback={<PageFallback />}><DataSourcesSettings /></Suspense>} />
            <Route path="harnesses" element={<Suspense fallback={<PageFallback />}><HarnessesSettings /></Suspense>} />
            <Route path="install" element={<Suspense fallback={<PageFallback />}><InstallSettings /></Suspense>} />
            <Route path="connection" element={<Suspense fallback={<PageFallback />}><ConnectionSettings /></Suspense>} />
            <Route path="live" element={<Suspense fallback={<PageFallback />}><LiveSettings /></Suspense>} />
            <Route path="users" element={<Suspense fallback={<PageFallback />}><UsersSettings /></Suspense>} />
            <Route path="teams" element={<Suspense fallback={<PageFallback />}><TeamsSettings /></Suspense>} />
            <Route path="machines" element={<Suspense fallback={<PageFallback />}><MachinesSettings /></Suspense>} />
            <Route path="repositories" element={<Suspense fallback={<PageFallback />}><ReposSettingsPage /></Suspense>} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
