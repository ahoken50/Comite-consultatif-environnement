import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { ThemeProvider, CssBaseline } from '@mui/material'
import { QueryClientProvider } from '@tanstack/react-query'
import { store } from './store/store'
import { theme } from './utils/theme'
import { queryClient } from './lib/queryClient'
import App from './App'
import './index.css'

// [NEW] Sentry Initialization
import * as Sentry from "@sentry/react";
import SentryErrorBoundary from './components/ErrorBoundary';

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN || "https://placeholder@sentry.io/123", // Placeholder
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  // Performance Monitoring
  tracesSampleRate: 1.0,
  // Session Replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <SentryErrorBoundary>
            <App />
          </SentryErrorBoundary>
        </ThemeProvider>
      </Provider>
    </QueryClientProvider>
  </React.StrictMode>,
)
