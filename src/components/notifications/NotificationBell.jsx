import { useState } from 'react';
import { Bell, BellRing, X, CheckCircle, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getPendingTasks } from '@/lib/useNotifications';
import { TASK_ICONS } from '@/lib/taskHelpers';
import { toast } from 'sonner';

export default function NotificationBell({
  scheduledTasks,
  todayTasks,
  person,
  occasionalTasks = [],
  delegations = [],
  cancellations = [],
  pushSupported = false,
  pushSubscribed = false,
  onEnablePush,
}) {
  const [open, setOpen] = useState(false);
  const [enabling, setEnabling] = useState(false);

  const pending = getPendingTasks(
    scheduledTasks, todayTasks, person, occasionalTasks, delegations, cancellations
  );

  const needsPermission = pushSupported && !pushSubscribed;

  const handleEnablePush = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onEnablePush || enabling) return;
    setEnabling(true);
    console.log('[NotificationBell] Ativar clicked, calling onEnablePush...');
    try {
      const result = await onEnablePush();
      console.log('[NotificationBell] onEnablePush result:', result);
      if (result?.success) {
        toast.success('Notificações ativadas! 🔔');
      } else {
        const msg = result?.detail || result?.reason || 'desconhecido';
        toast.error(`Erro ao ativar: ${msg}`);
        console.error('[NotificationBell] Subscribe failed:', msg);
      }
    } catch (err) {
      console.error('[NotificationBell] Exception:', err);
      toast.error('Erro ao ativar notificações: ' + err.message);
    }
    setEnabling(false);
  };

  if (!person) return null;

  // If push not enabled yet, show a prominent activate button instead of the bell
  if (needsPermission) {
    return (
      <button
        onClick={handleEnablePush}
        disabled={enabling}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
      >
        <BellRing className="w-3.5 h-3.5" />
        {enabling ? 'A ativar...' : 'Ativar 🔔'}
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <Bell className="w-4 h-4" />
        {pending.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-destructive text-destructive-foreground text-[9px] font-bold rounded-full flex items-center justify-center">
            {pending.length}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-10 w-72 bg-card border border-border rounded-2xl shadow-xl z-50 overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-primary" />
                  <span className="font-bold text-sm text-foreground">Tarefas Pendentes</span>
                </div>
                <button onClick={() => setOpen(false)}>
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              <div className="max-h-64 overflow-y-auto">
                {pending.length === 0 ? (
                  <div className="flex flex-col items-center py-8 text-muted-foreground gap-2">
                    <CheckCircle className="w-8 h-8 text-primary" />
                    <p className="text-sm font-medium">Tudo em dia! 🎉</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {pending.map((task) => (
                      <div key={task.id} className="flex items-center gap-3 px-4 py-3">
                        <span className="text-xl">{TASK_ICONS[task.task_name] || '✅'}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{task.task_name}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {task._occasional && (
                              <span className="text-[10px] bg-accent/20 text-accent-foreground px-1.5 py-0.5 rounded-full font-medium">especial</span>
                            )}
                            {task.end_time && (
                              <div className="flex items-center gap-1">
                                <Clock className="w-3 h-3 text-muted-foreground" />
                                <span className="text-[11px] text-muted-foreground">Até às {task.end_time}</span>
                              </div>
                            )}
                            {task.date && task._occasional && (
                              <span className="text-[11px] text-muted-foreground">{task.date}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}