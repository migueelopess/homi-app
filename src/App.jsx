import { lazy, Suspense, useEffect } from 'react';
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { queryClientInstance, queryPersister, QUERY_CACHE_BUSTER } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { ThemeProvider } from '@/lib/ThemeContext';
import AppLayout from './components/layout/AppLayout';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';

// Route-level code splitting: each page is its own chunk so the initial
// bundle stays small. The remaining chunks are prefetched on idle below,
// making later navigations instant.
const pageImports = {
  Home: () => import('./pages/Home'),
  RegisterTask: () => import('./pages/RegisterTask'),
  Ranking: () => import('./pages/Ranking'),
  Parents: () => import('./pages/Parents'),
  Rotinas: () => import('./pages/Rotinas'),
  Tarefas: () => import('./pages/Tarefas'),
  Delegar: () => import('./pages/Delegar'),
  Definicoes: () => import('./pages/Definicoes'),
  Login: () => import('./pages/Login'),
};

const Home = lazy(pageImports.Home);
const RegisterTask = lazy(pageImports.RegisterTask);
const Ranking = lazy(pageImports.Ranking);
const Parents = lazy(pageImports.Parents);
const Rotinas = lazy(pageImports.Rotinas);
const Tarefas = lazy(pageImports.Tarefas);
const Delegar = lazy(pageImports.Delegar);
const Definicoes = lazy(pageImports.Definicoes);
const Login = lazy(pageImports.Login);

function usePrefetchPagesOnIdle() {
  useEffect(() => {
    const prefetchAll = () => Object.values(pageImports).forEach((load) => load());
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(prefetchAll, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(prefetchAll, 2500);
    return () => clearTimeout(id);
  }, []);
}

const AuthenticatedApp = () => {
  const { isLoadingAuth, isAuthenticated } = useAuth();
  useRealtimeSync();
  usePrefetchPagesOnIdle();

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Suspense fallback={null}>
        <Routes>
          <Route path="*" element={<Login />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/registar" element={<RegisterTask />} />
        <Route path="/ranking" element={<Ranking />} />
        <Route path="/pais" element={<Parents />} />
        <Route path="/rotinas" element={<Rotinas />} />
        <Route path="/tarefas" element={<Tarefas />} />
        <Route path="/delegar" element={<Delegar />} />
        <Route path="/definicoes" element={<Definicoes />} />
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <PersistQueryClientProvider
          client={queryClientInstance}
          persistOptions={{
            persister: queryPersister,
            maxAge: 24 * 60 * 60 * 1000,
            buster: QUERY_CACHE_BUSTER,
          }}
        >
          <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <AuthenticatedApp />
          </Router>
          <Toaster />
          <SonnerToaster position="top-center" richColors />
        </PersistQueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App
