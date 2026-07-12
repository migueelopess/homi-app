import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { ArrowLeft, Sun, Moon, Monitor, LogOut, Check, Loader2, Bell } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useCurrentUser, isParent } from '@/lib/useCurrentUser';
import { useTheme } from '@/lib/ThemeContext';
import { usePushSubscription } from '@/lib/usePushSubscription';
import { PERSON_AVATARS } from '@/lib/taskHelpers';

const THEME_OPTIONS = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Escuro', icon: Moon },
  { value: 'system', label: 'Sistema', icon: Monitor },
];

function SectionLabel({ children }) {
  return (
    <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2 px-1">
      {children}
    </p>
  );
}

export default function Definicoes() {
  const navigate = useNavigate();
  const { logout, updateProfile } = useAuth();
  const { data: user, isLoading } = useCurrentUser();
  const { theme, setTheme } = useTheme();
  const { pushSupported, pushSubscribed, pushLoading, subscribe, unsubscribe } = usePushSubscription(user);

  const userIsParent = isParent(user);
  const avatar = userIsParent ? '👨‍👩‍👧' : (PERSON_AVATARS[user?.linked_name] || '👤');
  const displayName = userIsParent ? (user?.full_name || 'Pais') : (user?.linked_name || user?.full_name);

  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [email, setEmail] = useState('');
  const [remember, setRemember] = useState(() => localStorage.getItem('homi_remember') !== '0');

  useEffect(() => {
    if (user?.full_name != null) setName(user.full_name);
  }, [user?.full_name]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data?.user?.email || ''));
  }, []);

  const nameChanged = name.trim() && name.trim() !== (user?.full_name || '');

  const handleSaveName = async () => {
    if (!nameChanged) return;
    setSavingName(true);
    const { error } = await updateProfile({ full_name: name.trim() });
    setSavingName(false);
    if (error) toast.error('Não foi possível guardar o nome.');
    else toast.success('Nome atualizado ✓');
  };

  const handlePushToggle = async (checked) => {
    if (checked) {
      const result = await subscribe();
      if (!result?.success) toast.error('Não foi possível ativar as notificações.');
    } else {
      await unsubscribe();
    }
  };

  const handleRememberToggle = (checked) => {
    setRemember(checked);
    localStorage.setItem('homi_remember', checked ? '1' : '0');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-5 pb-10">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          aria-label="Voltar"
          className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Definições</h1>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-7"
      >
        {/* Profile hero */}
        <div className="flex flex-col items-center text-center">
          <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center text-4xl mb-3">
            {avatar}
          </div>
          <h2 className="text-lg font-bold text-foreground">{displayName}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {userIsParent ? 'Conta de Pais' : 'Conta de Filho'}
          </p>
        </div>

        {/* Profile */}
        <section>
          <SectionLabel>Perfil</SectionLabel>
          <div className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
            <div className="p-4">
              <label className="text-xs text-muted-foreground mb-1.5 block">Nome</label>
              <div className="flex items-center gap-2">
                <Input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="O teu nome"
                  className="h-11 rounded-xl"
                />
                <button
                  onClick={handleSaveName}
                  disabled={!nameChanged || savingName}
                  className="shrink-0 h-11 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-40 flex items-center gap-1.5 transition"
                >
                  {savingName ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Guardar
                </button>
              </div>
            </div>

            {!userIsParent && (
              <div className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">O teu nome no Homi</p>
                  <p className="text-xs text-muted-foreground">Definido pelos pais</p>
                </div>
                <span className="text-sm font-semibold text-muted-foreground">{user?.linked_name || '—'}</span>
              </div>
            )}

            {email && (
              <div className="p-4 flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">Email</p>
                <span className="text-sm text-muted-foreground truncate max-w-[55%] text-right">{email}</span>
              </div>
            )}
          </div>
        </section>

        {/* Appearance */}
        <section>
          <SectionLabel>Aparência</SectionLabel>
          <div className="rounded-2xl border border-border bg-card p-3">
            <div className="grid grid-cols-3 gap-2">
              {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
                const active = theme === value;
                return (
                  <button
                    key={value}
                    onClick={() => setTheme(value)}
                    className={`flex flex-col items-center gap-2 py-4 rounded-xl border-2 transition-all ${
                      active
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-border bg-background text-muted-foreground hover:border-primary/30'
                    }`}
                  >
                    <Icon className={`w-6 h-6 ${active ? 'stroke-[2.4]' : ''}`} />
                    <span className="text-xs font-semibold">{label}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-3 px-1">
              "Sistema" segue automaticamente o tema do teu telemóvel.
            </p>
          </div>
        </section>

        {/* Notifications */}
        <section>
          <SectionLabel>Notificações</SectionLabel>
          <div className="rounded-2xl border border-border bg-card p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center shrink-0">
                <Bell className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Notificações push</p>
                <p className="text-xs text-muted-foreground">
                  {pushSupported ? 'Recebe avisos de tarefas e aprovações' : 'Não suportado neste dispositivo'}
                </p>
              </div>
            </div>
            <Switch
              checked={pushSubscribed}
              onCheckedChange={handlePushToggle}
              disabled={!pushSupported || pushLoading}
            />
          </div>
        </section>

        {/* Session */}
        <section>
          <SectionLabel>Sessão</SectionLabel>
          <div className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
            <div className="p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Manter sessão iniciada</p>
                <p className="text-xs text-muted-foreground">Não pedir login sempre que abres a app</p>
              </div>
              <Switch checked={remember} onCheckedChange={handleRememberToggle} />
            </div>
            <button
              onClick={() => logout()}
              className="w-full p-4 flex items-center gap-3 text-destructive hover:bg-destructive/5 transition-colors"
            >
              <div className="w-9 h-9 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
                <LogOut className="w-4 h-4" />
              </div>
              <span className="text-sm font-semibold">Terminar sessão</span>
            </button>
          </div>
        </section>

        <p className="text-center text-xs text-muted-foreground/70 pt-2">Homi</p>
      </motion.div>
    </div>
  );
}
