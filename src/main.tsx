import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-600.css';
import './styles/app.css';
import './styles/elevation.css';
import './styles/connect.css';
import './lib/theme';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, StrictMode, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createBrowserRouter, createRoutesFromElements, Link, Navigate, Outlet, Route, RouterProvider, useParams,
} from 'react-router';
import { AuthProvider, useAuth } from './app/auth';
import { Shell } from './app/Shell';
import { useMyWorkspaces, useWorkspace, useWorkspaceBySlug, WorkspaceProvider } from './app/workspace';
import { Empty, Loading, Notice, ToastProvider } from './components/ui';
import { LoginPage, SetNewPassword, SetupBrand } from './features/auth/AuthPages';
import { HomePage } from './features/home/HomePage';
import { ChatPage } from './features/inbox/ChatPage';
import { InboxPage } from './features/inbox/InboxPage';
import { LandingPage } from './features/landing/LandingPage';
import { DataDeletionPage, PrivacyPage, TermsPage } from './features/legal/LegalPages';
import { errorMessage } from './lib/errors';

// Less frequent screens load on demand to keep the first load small.
const LeadsPage = lazy(() => import('./features/leads/LeadsPage').then((m) => ({ default: m.LeadsPage })));
const OrdersPage = lazy(() => import('./features/orders/OrdersPage').then((m) => ({ default: m.OrdersPage })));
const BrainPage = lazy(() => import('./features/brain/BrainPage').then((m) => ({ default: m.BrainPage })));
const AnalyticsPage = lazy(() => import('./features/analytics/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })));
const SettingsPage = lazy(() => import('./features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));

// GitHub Pages cannot send frame-ancestors; refuse to render inside a frame.
if (window.top !== window.self) {
  document.documentElement.style.display = 'none';
  throw new Error('Framing is not allowed');
}

// A page animation is cancelled when the phone's address bar resizes the
// viewport mid-slide. Navigation still completes; keep it out of the console.
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason as { name?: string; message?: string } | undefined;
  if ((r?.name === 'InvalidStateError' || r?.name === 'AbortError') && /transition/i.test(r.message ?? '')) e.preventDefault();
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
    mutations: { retry: false },
  },
});

function Splash() {
  return <div className="center-screen" aria-busy="true"><span className="spinner" /></div>;
}

function RequireAuth() {
  const { session, loading, recovering } = useAuth();
  if (loading) return <Splash />;
  if (recovering) return <SetNewPassword />;
  if (!session) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Signed out: landing page. Signed in: straight to the brand. */
function Root() {
  const { session, loading, recovering } = useAuth();
  if (loading) return <Splash />;
  if (recovering) return <SetNewPassword />;
  if (!session) return <LandingPage />;
  return <Home />;
}

function Home() {
  const list = useMyWorkspaces();
  if (list.isPending) return <Splash />;
  if (list.error) return <div className="center-screen"><Notice tone="bad">{errorMessage(list.error)}</Notice></div>;
  if (list.data.length === 0) return <Navigate to="/setup" replace />;
  return <Navigate to={`/b/${list.data[0].workspaces.slug}`} replace />;
}

function WorkspaceLayout() {
  const { slug } = useParams();
  const ctx = useWorkspaceBySlug(slug);
  if (ctx.isPending) return <Splash />;
  if (ctx.error) return <div className="center-screen"><Notice tone="bad">{errorMessage(ctx.error)}</Notice></div>;
  if (!ctx.data) {
    return <div className="center-screen"><Empty title="Brand not found"><Link className="btn" to="/">Go home</Link></Empty></div>;
  }
  return <WorkspaceProvider value={ctx.data}><Shell /></WorkspaceProvider>;
}

function Allow({ perm, children }: { perm: string; children: ReactNode }) {
  const { can } = useWorkspace();
  if (!can(perm)) return <Empty title="No access">Ask the brand owner for access.</Empty>;
  // A skeleton, never a blank screen, while a page's code downloads.
  return <Suspense fallback={<Loading rows={5} />}>{children}</Suspense>;
}

const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      <Route path="/" element={<Root />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/data-deletion" element={<DataDeletionPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/setup" element={<SetupBrand />} />
        <Route path="/b/:slug" element={<WorkspaceLayout />}>
          <Route index element={<Allow perm="inbox.read"><HomePage /></Allow>} />
          <Route path="inbox" element={<Allow perm="inbox.read"><InboxPage /></Allow>} />
          <Route path="inbox/:conversationId" element={<Allow perm="inbox.read"><ChatPage /></Allow>} />
          <Route path="leads" element={<Allow perm="leads.read"><LeadsPage /></Allow>} />
          <Route path="orders" element={<Allow perm="orders.read"><OrdersPage /></Allow>} />
          <Route path="brain" element={<Allow perm="brain.read"><BrainPage /></Allow>} />
          <Route path="analytics" element={<Allow perm="reports.read"><AnalyticsPage /></Allow>} />
          <Route path="settings" element={<Allow perm="staff.read"><SettingsPage /></Allow>} />
          <Route path="*" element={<Empty title="Page not found" />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </>,
  ),
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' },
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
