import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "sonner"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { ThemeProvider } from '@/lib/ThemeContext';
import AppLayout from './components/layout/AppLayout';
import Home from './pages/Home';
import RegisterTask from './pages/RegisterTask';
import Ranking from './pages/Ranking';
import Parents from './pages/Parents';
import Rotinas from './pages/Rotinas';
import Tarefas from './pages/Tarefas';
import Delegar from './pages/Delegar';
import Definicoes from './pages/Definicoes';
import Login from './pages/Login';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';

const AuthenticatedApp = () => {
  const { isLoadingAuth, isAuthenticated } = useAuth();
  useRealtimeSync();

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
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
        <QueryClientProvider client={queryClientInstance}>
          <Router>
            <AuthenticatedApp />
          </Router>
          <Toaster />
          <SonnerToaster position="top-center" richColors />
        </QueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

export default App