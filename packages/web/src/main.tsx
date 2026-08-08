import React from 'react'
import ReactDOM from 'react-dom/client'
import AppRouter from './AppRouter'
import { RootErrorBoundary } from './components/RootErrorBoundary'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <AppRouter />
    </RootErrorBoundary>
  </React.StrictMode>
)
