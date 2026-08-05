import { Navigate, Route, Routes } from 'react-router-dom';

import { AppLayout } from '@/components/AppLayout';
import { RequireAuth } from '@/components/RequireAuth';
import { Analytics } from '@/pages/Analytics';
import { Dashboard } from '@/pages/Dashboard';
import { Dispatches } from '@/pages/Dispatches';
import { Landing } from '@/pages/Landing';
import { Login } from '@/pages/Login';
import { NewApplication } from '@/pages/NewApplication';
import { Onboarding } from '@/pages/Onboarding';
import { Pipeline } from '@/pages/Pipeline';
import { Register } from '@/pages/Register';
import { Settings } from '@/pages/Settings';
import { Templates } from '@/pages/Templates';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

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
        <Route path="/pipeline" element={<Pipeline />} />
        <Route path="/dispatches" element={<Dispatches />} />
        <Route path="/templates" element={<Templates />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/settings" element={<Settings />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
