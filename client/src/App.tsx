import { lazy, Suspense, type ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { AppLayout } from '@/components/AppLayout';
import { RequireAuth } from '@/components/RequireAuth';
import { Landing } from '@/pages/Landing';
import { Login } from '@/pages/Login';
import { Privacy } from '@/pages/Privacy';
import { Register } from '@/pages/Register';

// Route-level code splitting: the public pages above ship in the main bundle;
// every signed-in page (and its heavy deps — recharts, dnd-kit) loads on demand.
const named = <K extends string>(loader: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => loader().then((m) => ({ default: m[name] })));

const Analytics = named(() => import('@/pages/Analytics'), 'Analytics');
const BatchUpload = named(() => import('@/pages/BatchUpload'), 'BatchUpload');
const ImportCsv = named(() => import('@/pages/ImportCsv'), 'ImportCsv');
const Contacts = named(() => import('@/pages/Contacts'), 'Contacts');
const Dashboard = named(() => import('@/pages/Dashboard'), 'Dashboard');
const Dispatches = named(() => import('@/pages/Dispatches'), 'Dispatches');
const NewApplication = named(() => import('@/pages/NewApplication'), 'NewApplication');
const Onboarding = named(() => import('@/pages/Onboarding'), 'Onboarding');
const Pipeline = named(() => import('@/pages/Pipeline'), 'Pipeline');
const Settings = named(() => import('@/pages/Settings'), 'Settings');
const Templates = named(() => import('@/pages/Templates'), 'Templates');
const VerifyEmail = named(() => import('@/pages/VerifyEmail'), 'VerifyEmail');

/** Blank, theme-coloured placeholder while a route chunk downloads (usually <100 ms). */
export function RouteFallback() {
  return <div className="min-h-[50vh] bg-background" aria-busy="true" />;
}

export function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/verify-email" element={<VerifyEmail />} />

      <Route
        path="/onboarding"
        element={
          <RequireAuth>
            <Onboarding />
          </RequireAuth>
        }
      />

      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/apps/new" element={<NewApplication />} />
        <Route path="/apps/batch" element={<BatchUpload />} />
        <Route path="/apps/import" element={<ImportCsv />} />
        <Route path="/pipeline" element={<Pipeline />} />
        <Route path="/dispatches" element={<Dispatches />} />
        <Route path="/contacts" element={<Contacts />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/settings" element={<Settings />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
