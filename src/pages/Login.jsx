import { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Mail, Lock, AlertCircle, Check } from 'lucide-react';
import HomiMark from '@/components/layout/HomiMark';

const RING_SIZES = [700, 560, 420, 300];
const RING_OPACITIES = [0.07, 0.11, 0.15, 0.19];

function useThemeColor(color) {
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const prevMeta = meta?.getAttribute('content');
    const prevBody = document.body.style.backgroundColor;
    meta?.setAttribute('content', color);
    document.body.style.backgroundColor = '#123f3f';
    return () => {
      if (prevMeta) meta?.setAttribute('content', prevMeta);
      document.body.style.backgroundColor = prevBody;
    };
  }, [color]);
}

export default function Login() {
  useThemeColor('#123f3f');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    localStorage.setItem('homi_remember', rememberMe ? '1' : '0');

    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError('Email ou password incorretos.');
      setLoading(false);
    }
    // On success, AuthContext's onAuthStateChange listener handles the rest
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center relative overflow-hidden px-4"
      style={{
        background: 'linear-gradient(145deg, #1a5858 0%, #0c2e2e 50%, #071818 100%)',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* Decorative concentric rings — mirrors the logo motif */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
        {RING_SIZES.map((size, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              width: size,
              height: size,
              border: `1.2px solid rgba(80,180,160,${RING_OPACITIES[i]})`,
            }}
          />
        ))}
      </div>

      {/* Glow blob */}
      <div
        className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
        style={{
          width: 320,
          height: 320,
          background: 'radial-gradient(circle, rgba(61,217,160,0.12) 0%, transparent 70%)',
        }}
      />

      <div className="relative w-full max-w-sm z-10">
        {/* Logo */}
        <div className="text-center mb-10">
          <HomiMark
            className="w-20 h-20 mx-auto mb-4"
            style={{ color: '#3dd9a0', filter: 'drop-shadow(0 8px 24px rgba(61,217,160,0.35))' }}
          />
          <h1
            className="text-5xl font-semibold tracking-tight"
            style={{ color: '#3dd9a0', fontFamily: "'Nunito', 'Inter', sans-serif", letterSpacing: '-0.5px' }}
          >
            Homi
          </h1>
          <p className="text-sm mt-2 font-medium" style={{ color: 'rgba(61,217,160,0.55)' }}>
            Organiza a tua família
          </p>
        </div>

        {/* Glass card */}
        <div
          className="rounded-2xl p-7 space-y-6"
          style={{
            background: 'rgba(255,255,255,0.05)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid rgba(255,255,255,0.09)',
            boxShadow: '0 32px 64px rgba(0,0,0,0.45), 0 0 0 1px rgba(61,217,160,0.06)',
          }}
        >
          <div>
            <h2 className="text-lg font-bold text-white">Bem-vindo de volta</h2>
            <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
              Entra na tua conta para continuar
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div className="space-y-1.5">
              <Label
                htmlFor="email"
                className="text-xs font-semibold uppercase tracking-widest"
                style={{ color: 'rgba(255,255,255,0.5)' }}
              >
                Email
              </Label>
              <div className="relative">
                <Mail
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
                  style={{ color: 'rgba(61,217,160,0.5)' }}
                />
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="o-teu-email@exemplo.com"
                  required
                  autoComplete="email"
                  className="pl-10 h-11 placeholder:text-white/20 focus-visible:outline-none"
                  style={{
                    background: 'rgba(255,255,255,0.07)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: 'white',
                    borderRadius: '0.625rem',
                    boxShadow: 'none',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = 'rgba(61,217,160,0.5)')}
                  onBlur={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <Label
                htmlFor="password"
                className="text-xs font-semibold uppercase tracking-widest"
                style={{ color: 'rgba(255,255,255,0.5)' }}
              >
                Password
              </Label>
              <div className="relative">
                <Lock
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
                  style={{ color: 'rgba(61,217,160,0.5)' }}
                />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="pl-10 h-11 placeholder:text-white/20 focus-visible:outline-none"
                  style={{
                    background: 'rgba(255,255,255,0.07)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: 'white',
                    borderRadius: '0.625rem',
                    boxShadow: 'none',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = 'rgba(61,217,160,0.5)')}
                  onBlur={(e) => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')}
                />
              </div>
            </div>

            {/* Remember me */}
            <button
              type="button"
              onClick={() => setRememberMe((v) => !v)}
              className="flex items-center gap-2.5 w-fit group"
            >
              <span
                className="flex items-center justify-center w-4.5 h-4.5 rounded transition-all"
                style={{
                  width: 18,
                  height: 18,
                  minWidth: 18,
                  background: rememberMe ? 'rgba(61,217,160,0.85)' : 'rgba(255,255,255,0.07)',
                  border: rememberMe ? '1.5px solid #3dd9a0' : '1.5px solid rgba(255,255,255,0.2)',
                  borderRadius: 5,
                  transition: 'all 0.15s',
                }}
              >
                {rememberMe && <Check className="w-3 h-3" style={{ color: '#071818', strokeWidth: 3 }} />}
              </span>
              <span className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
                Manter sessão iniciada
              </span>
            </button>

            {/* Error */}
            {error && (
              <div
                className="flex items-center gap-2.5 rounded-xl px-3.5 py-2.5"
                style={{
                  background: 'rgba(220,38,38,0.15)',
                  border: '1px solid rgba(220,38,38,0.25)',
                }}
              >
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                <p className="text-sm text-red-300">{error}</p>
              </div>
            )}

            {/* Submit */}
            <Button
              type="submit"
              className="w-full h-11 font-bold text-sm tracking-wide mt-1 border-0 transition-opacity hover:opacity-90 active:opacity-80"
              disabled={loading}
              style={{
                background: 'linear-gradient(135deg, #3dd9a0 0%, #2ab07d 100%)',
                color: '#071818',
                boxShadow: '0 4px 20px rgba(61,217,160,0.35)',
              }}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Entrar
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
