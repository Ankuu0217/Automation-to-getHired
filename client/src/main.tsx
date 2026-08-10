import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';

import { App } from '@/App';
import { ErrorBoundary } from '@/components/ErrorBoundary';

import '@/index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

// A page restored from the back/forward cache — e.g. hitting Back after the
// external Gmail-OAuth redirect — can come back as a stale/blank frame. Force a
// clean reload on any bfcache restore so the app always re-renders fresh.
// (Only fires on full-page back/forward, never on in-app SPA navigation.)
window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <MotionConfig reducedMotion="user">
            <App />
          </MotionConfig>
          <Toaster theme="dark" position="bottom-right" richColors closeButton />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
