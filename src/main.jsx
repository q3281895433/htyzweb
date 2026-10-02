import React from 'react'
import ReactDOM from 'react-dom/client'
import './fonts.css'
import './styles.css'
import './tech-effects.css'
import App from './App.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary><App /></ErrorBoundary>
  </React.StrictMode>
)
