import { Outlet, Link, useLocation } from 'react-router-dom';
import { Home, PlusCircle, Trophy, LogOut, CalendarDays, BarChart2, Bell, ClipboardList, Handshake } from 'lucide-react';
import { useCurrentUser, isParent } from '@/lib/useCurrentUser';
import { useAuth } from '@/lib/AuthContext';
import { TaskService, ScheduledTaskService, OccasionalTaskService, TaskDelegationService } from '@/api/entities';
import { PERSON_AVATARS, getLocalDateStr } from '@/lib/taskHelpers';
import { useQuery } from '@tanstack/react-query';
import NotificationBell from '@/components/notifications/NotificationBell';
import { usePushSubscription } from '@/lib/usePushSubscription';

export default function AppLayout() {
  const location = useLocation();
  const { data: user } = useCurrentUser();
  const { logout } = useAuth();
  const userIsParent = isParent(user);
  const person = user?.linked_name;
  const { pushSupported, pushSubscribed, subscribe: pushSubscribe } = usePushSubscription(user);

  const { data: scheduledTasks = [] } = useQuery({
    queryKey: ['scheduledTasks'],
    queryFn: () => ScheduledTaskService.list(),
    enabled: !userIsParent && !!person,
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => TaskService.list('-created_date', 500),
    enabled: !userIsParent && !!person,
  });

  const { data: occasionalTasks = [] } = useQuery({
    queryKey: ['occasionalTasks'],
    queryFn: () => OccasionalTaskService.list('-date', 200),
    enabled: !userIsParent && !!person,
  });

  const today = getLocalDateStr();
  const todayTasks = tasks.filter(t => t.date === today && t.person === person);

  const { data: delegations = [] } = useQuery({
    queryKey: ['taskDelegations'],
    queryFn: () => TaskDelegationService.list('-created_at'),
    enabled: !userIsParent && !!person,
  });

  const pendingIncomingCount = delegations.filter(
    d => d.status === 'pending' && d.from_person !== person && d.task_date >= today
  ).length;

  const navItems = [
    { path: '/', icon: Home, label: 'Início' },
    ...(!userIsParent ? [
      { path: '/registar', icon: PlusCircle, label: 'Registar' },
      { path: '/delegar', icon: Handshake, label: 'Delegar', badge: pendingIncomingCount },
      { path: '/ranking', icon: Trophy, label: 'Ranking' },
    ] : []),
    ...(userIsParent ? [
      { path: '/tarefas', icon: ClipboardList, label: 'Tarefas' },
      { path: '/rotinas', icon: CalendarDays, label: 'Rotinas' },
      { path: '/pais', icon: BarChart2, label: 'Relatório' },
    ] : []),
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top header */}
      <header className="sticky top-0 z-50 bg-card/80 backdrop-blur-sm border-b border-border">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-foreground tracking-tight">Homi</span>
          </div>
          {user && (
            <div className="flex items-center gap-2">
              <Link
                to="/definicoes"
                aria-label="Definições"
                className="flex items-center gap-1.5 bg-muted rounded-full px-3 py-1 hover:bg-muted/70 active:scale-95 transition"
              >
                <span className="text-sm">
                  {userIsParent ? '👨‍👩‍👧' : (PERSON_AVATARS[user.linked_name] || '👤')}
                </span>
                <span className="text-xs font-semibold text-foreground">
                  {userIsParent ? 'Pais' : (user.linked_name || user.full_name)}
                </span>
              </Link>
              {!userIsParent && person && (
                <NotificationBell
                  scheduledTasks={scheduledTasks}
                  todayTasks={todayTasks}
                  person={person}
                  occasionalTasks={occasionalTasks}
                  pushSupported={pushSupported}
                  pushSubscribed={pushSubscribed}
                  onEnablePush={pushSubscribe}
                />
              )}
              {userIsParent && pushSupported && !pushSubscribed && (
                <button
                  onClick={pushSubscribe}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Ativar notificações"
                >
                  <Bell className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => logout()}
                className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 pb-20">
        <Outlet />
      </div>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-card/90 backdrop-blur-sm border-t border-border z-50">
        <div className="max-w-lg mx-auto flex justify-around items-center h-16 px-2">
          {navItems.map(({ path, icon: Icon, label, badge }) => {
            const isActive = location.pathname === path;
            return (
              <Link
                key={path}
                to={path}
                className={`flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-xl transition-all duration-200 relative ${
                  isActive
                    ? 'text-primary scale-105'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5]' : ''}`} />
                {badge > 0 && (
                  <span className="absolute -top-0.5 right-1 w-4 h-4 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center">
                    {badge}
                  </span>
                )}
                <span className={`text-[10px] font-medium ${isActive ? 'font-semibold' : ''}`}>
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}