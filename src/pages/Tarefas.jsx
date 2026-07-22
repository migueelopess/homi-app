import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ScheduledTaskService, OccasionalTaskService, TaskService, TaskReminderService, TaskDelegationService, TaskExtensionService, TaskCancellationService } from '@/api/entities';
import { sendTaskReminder } from '@/api/pushNotifications';
import { useCurrentUser, isParent } from '@/lib/useCurrentUser';
import { useAuth } from '@/lib/AuthContext';
import { PEOPLE, PERSON_AVATARS, TASK_ICONS, COMPLETION_TYPES, SIDNEY_TASKS, getLocalDateStr, sameTaskSlot } from '@/lib/taskHelpers';
import { Lock, ChevronLeft, ChevronRight, Bell, BellRing, Clock, X, ArrowRightLeft, TimerReset, Ban } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { format, addDays, subDays, isToday } from 'date-fns';
import { pt } from 'date-fns/locale';
import { PageSkeleton } from '@/components/layout/PageSkeleton';
import Portal from '@/components/layout/Portal';

const DAYS_MAP_REVERSE = {
  0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday',
  4: 'thursday', 5: 'friday', 6: 'saturday',
};

function isOverdue(endTime, dateStr) {
  const today = getLocalDateStr();
  if (dateStr < today) return true;
  if (dateStr > today) return false;
  if (!endTime) return false;
  const now = new Date();
  const [h, m] = endTime.split(':').map(Number);
  const end = new Date();
  end.setHours(h, m, 0);
  return now > end;
}

// What a task is worth if completed on time — used to label the
// "give more time" buttons so they reflect the actual reward.
// Occasional tasks carry a custom reward (halved with a reminder),
// scheduled tasks use the standard scale, and Sidney tasks are worth €0.
function extensionRewards(task) {
  if (!task) return { full: 0, half: 0 };
  if (SIDNEY_TASKS.includes(task.task_name)) return { full: 0, half: 0 };
  if (task._type === 'occasional' && task.reward != null) {
    const r = Number(task.reward);
    return { full: r, half: Math.round(r * 50) / 100 };
  }
  return {
    full: COMPLETION_TYPES.on_time_no_reminder.value,
    half: COMPLETION_TYPES.on_time_with_reminder.value,
  };
}

export default function Tarefas() {
  const { data: user, isLoading: loadingUser } = useCurrentUser();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedTask, setSelectedTask] = useState(null);

  const dateStr = getLocalDateStr(selectedDate);
  const dayKey = DAYS_MAP_REVERSE[selectedDate.getDay()];

  const { data: scheduledTasks = [], isLoading: loadingSched } = useQuery({
    queryKey: ['scheduledTasks'],
    queryFn: () => ScheduledTaskService.list(),
  });

  const { data: occasionalTasks = [], isLoading: loadingOcc } = useQuery({
    queryKey: ['occasionalTasks'],
    queryFn: () => OccasionalTaskService.list('-date', 500),
  });

  const { data: completedTasks = [], isLoading: loadingTasks } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => TaskService.list('-created_date', 2000),
  });

  const { data: reminders = [], isLoading: loadingReminders } = useQuery({
    queryKey: ['taskReminders', dateStr],
    queryFn: () => TaskReminderService.getByDate(dateStr),
  });

  const { data: delegations = [], isLoading: loadingDelegations } = useQuery({
    queryKey: ['taskDelegations'],
    queryFn: () => TaskDelegationService.list('-created_at'),
  });

  const { data: extensions = [], isLoading: loadingExtensions } = useQuery({
    queryKey: ['taskExtensions', dateStr],
    queryFn: () => TaskExtensionService.getByDate(dateStr),
  });

  const { data: cancellations = [], isLoading: loadingCancellations } = useQuery({
    queryKey: ['taskCancellations', dateStr],
    queryFn: () => TaskCancellationService.getByDate(dateStr),
  });

  const todayDelegations = delegations.filter(d => d.task_date === dateStr);

  const extendTaskMutation = useMutation({
    mutationFn: ({ person, taskName, endTime, withReminder }) =>
      TaskExtensionService.create({
        person,
        task_name: taskName,
        task_date: dateStr,
        end_time: endTime ?? null,
        with_reminder: withReminder,
        granted_by: session?.user?.id,
      }),
    onSuccess: async (_, { person, taskName, endTime, withReminder }) => {
      queryClient.invalidateQueries({ queryKey: ['taskExtensions', dateStr] });
      if (withReminder) {
        try {
          await sendTaskReminder({
            person,
            taskName,
            endTime,
            taskType: selectedTask?._type,
            taskDate: dateStr,
            sentBy: session?.user?.id,
          });
          queryClient.invalidateQueries({ queryKey: ['taskReminders', dateStr] });
        } catch (_) {
          // reminder already sent — that's fine
        }
      }
      toast.success(`Mais tempo dado a ${person} para "${taskName}"!`);
      setSelectedTask(null);
    },
    onError: (err) => {
      if (err?.code === '23505') {
        toast.error('Já foi dado mais tempo para esta tarefa hoje.');
      } else {
        toast.error('Erro ao estender tarefa');
      }
    },
  });

  const cancelTaskMutation = useMutation({
    mutationFn: ({ person, taskName, endTime }) =>
      TaskCancellationService.create({
        person,
        task_name: taskName,
        task_date: dateStr,
        end_time: endTime ?? null,
        cancelled_by: session?.user?.id,
      }),
    onSuccess: (_, { person, taskName }) => {
      queryClient.invalidateQueries({ queryKey: ['taskCancellations', dateStr] });
      toast.success(`Tarefa "${taskName}" cancelada para ${person}`);
      setSelectedTask(null);
    },
    onError: (err) => {
      if (err?.code === '23505') {
        toast.error('Esta tarefa já foi cancelada hoje.');
      } else {
        toast.error('Erro ao cancelar tarefa');
      }
    },
  });

  const uncancelTaskMutation = useMutation({
    mutationFn: ({ id }) => TaskCancellationService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['taskCancellations', dateStr] });
      toast.success('Cancelamento removido');
      setSelectedTask(null);
    },
    onError: () => toast.error('Erro ao reativar tarefa'),
  });

  const sendReminderMutation = useMutation({
    mutationFn: ({ person, taskName, endTime, taskType }) =>
      sendTaskReminder({
        person,
        taskName,
        endTime,
        taskType,
        taskDate: dateStr,
        sentBy: session?.user?.id,
      }),
    onSuccess: (_, { person, taskName }) => {
      queryClient.invalidateQueries({ queryKey: ['taskReminders', dateStr] });
      toast.success(`Lembrete enviado para ${person}!`);
      setSelectedTask(null);
    },
    onError: (err) => {
      if (err?.code === '23505') {
        toast.error('Já enviaste um lembrete para esta tarefa hoje.');
      } else {
        toast.error('Erro ao enviar lembrete');
      }
    },
  });

  const tasksByPerson = useMemo(() => {
    const result = {};

    const acceptedScheduledIds = new Set(
      todayDelegations
        .filter(d => d.status === 'accepted' && d.task_type === 'scheduled')
        .map(d => d.scheduled_task_id)
    );
    const acceptedOccasionalIds = new Set(
      todayDelegations
        .filter(d => d.status === 'accepted' && d.task_type === 'occasional')
        .map(d => d.occasional_task_id)
    );

    for (const person of PEOPLE) {
      const scheduled = scheduledTasks
        .filter(t => t.person === person && t.days_of_week?.includes(dayKey) && !acceptedScheduledIds.has(t.id))
        .map(t => {
          const delegation = todayDelegations.find(
            d => d.task_type === 'scheduled' && d.scheduled_task_id === t.id && d.from_person === person
          );
          const extension = extensions.find(e => e.person === person && e.task_name === t.task_name && sameTaskSlot(e.end_time, t.end_time));
          const cancellation = cancellations.find(c => c.person === person && c.task_name === t.task_name && sameTaskSlot(c.end_time, t.end_time));
          const overdue = isOverdue(t.end_time, dateStr);
          return {
            ...t,
            _type: 'scheduled',
            _done: completedTasks.some(ct => ct.person === person && ct.task_name === t.task_name && ct.date === dateStr && sameTaskSlot(ct.end_time, t.end_time)),
            _reminded: reminders.some(r => r.person === person && r.task_name === t.task_name && sameTaskSlot(r.end_time, t.end_time)),
            _overdue: extension ? false : overdue,
            _extended: !!extension,
            _extension: extension || null,
            _delegation: delegation || null,
            _cancelled: !!cancellation,
            _cancellation: cancellation || null,
          };
        });

      const occasional = occasionalTasks
        .filter(t => t.person === person && t.date === dateStr && !acceptedOccasionalIds.has(t.id))
        .map(t => {
          const delegation = todayDelegations.find(
            d => d.task_type === 'occasional' && d.occasional_task_id === t.id && d.from_person === person
          );
          const extension = extensions.find(e => e.person === person && e.task_name === t.task_name && sameTaskSlot(e.end_time, t.end_time));
          const cancellation = cancellations.find(c => c.person === person && c.task_name === t.task_name && sameTaskSlot(c.end_time, t.end_time));
          const overdue = isOverdue(t.end_time, dateStr);
          return {
            ...t,
            _type: 'occasional',
            _done: t.completed || completedTasks.some(ct => ct.person === person && ct.task_name === t.task_name && ct.date === dateStr && sameTaskSlot(ct.end_time, t.end_time)),
            _reminded: reminders.some(r => r.person === person && r.task_name === t.task_name && sameTaskSlot(r.end_time, t.end_time)),
            _overdue: extension ? false : overdue,
            _extended: !!extension,
            _extension: extension || null,
            _delegation: delegation || null,
            _cancelled: !!cancellation,
            _cancellation: cancellation || null,
          };
        });

      const delegatedIn = todayDelegations
        .filter(d => d.to_person === person && d.status === 'accepted')
        .map(d => {
          const originalTask = d.task_type === 'scheduled'
            ? scheduledTasks.find(t => t.id === d.scheduled_task_id)
            : occasionalTasks.find(t => t.id === d.occasional_task_id);
          if (!originalTask) return null;

          const extension = extensions.find(e => e.person === person && e.task_name === d.task_name && sameTaskSlot(e.end_time, originalTask.end_time));
          const cancellation = cancellations.find(c => c.person === person && c.task_name === d.task_name && sameTaskSlot(c.end_time, originalTask.end_time));
          const overdue = isOverdue(originalTask.end_time, dateStr);

          return {
            ...originalTask,
            person,
            task_name: d.task_name,
            _type: d.task_type,
            _done: completedTasks.some(ct => ct.person === person && ct.task_name === d.task_name && ct.date === dateStr && sameTaskSlot(ct.end_time, originalTask.end_time)),
            _reminded: reminders.some(r => r.person === person && r.task_name === d.task_name && sameTaskSlot(r.end_time, originalTask.end_time)),
            _overdue: extension ? false : overdue,
            _extended: !!extension,
            _extension: extension || null,
            _delegation: { ...d, _isReceived: true },
            _cancelled: !!cancellation,
            _cancellation: cancellation || null,
          };
        })
        .filter(Boolean);

      result[person] = [...scheduled, ...occasional, ...delegatedIn].sort((a, b) =>
        (a.end_time || '23:59').localeCompare(b.end_time || '23:59')
      );
    }
    return result;
  }, [scheduledTasks, occasionalTasks, completedTasks, reminders, extensions, cancellations, todayDelegations, dayKey, dateStr]);

  if (loadingUser || loadingSched || loadingOcc || loadingTasks || loadingReminders || loadingDelegations || loadingExtensions || loadingCancellations) {
    return <PageSkeleton />;
  }

  if (!isParent(user)) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-16 flex flex-col items-center text-center">
        <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-4">
          <Lock className="w-9 h-9 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2">Área Restrita</h2>
        <p className="text-sm text-muted-foreground">Este painel é apenas para os pais.</p>
      </div>
    );
  }

  const isTodaySelected = isToday(selectedDate);
  const formattedDate = format(selectedDate, "EEEE, d 'de' MMMM", { locale: pt });

  return (
    <div className="max-w-lg mx-auto px-4 pt-6 pb-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <div className="flex items-center gap-2 mb-1">
          <Bell className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Tarefas</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-5">Consulta e envia lembretes</p>
      </motion.div>

      {/* Date navigator */}
      <div className="flex items-center justify-between bg-card rounded-2xl border border-border p-3 mb-6">
        <button
          onClick={() => setSelectedDate(d => subDays(d, 1))}
          className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-muted transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="text-center">
          <p className="text-sm font-bold text-foreground capitalize">{formattedDate}</p>
          {isTodaySelected && (
            <Badge variant="secondary" className="text-[10px] mt-0.5">Hoje</Badge>
          )}
        </div>
        <button
          onClick={() => setSelectedDate(d => addDays(d, 1))}
          className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-muted transition-colors"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Per-person sections */}
      {PEOPLE.map(person => {
        const tasks = tasksByPerson[person] || [];
        const doneCount = tasks.filter(t => t._done).length;

        return (
          <motion.div
            key={person}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6"
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xl">{PERSON_AVATARS[person]}</span>
              <h2 className="font-bold text-foreground">{person}</h2>
              <Badge variant="outline" className="ml-auto text-xs">
                {doneCount}/{tasks.length}
              </Badge>
            </div>

            {tasks.length === 0 ? (
              <Card className="p-4 text-center">
                <p className="text-sm text-muted-foreground">Sem tarefas para este dia</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {tasks.map((task, idx) => (
                  <Card
                    key={`${task.task_name}-${idx}`}
                    onClick={() => !task._done && setSelectedTask({ ...task, person })}
                    className={`p-3 flex items-center gap-3 transition-all ${
                      task._done || task._cancelled
                        ? 'opacity-50 cursor-pointer'
                        : 'cursor-pointer hover:border-primary/40 active:scale-[0.98]'
                    }`}
                  >
                    {/* Task info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{TASK_ICONS[task.task_name] || '✅'}</span>
                        <p className={`font-semibold text-sm truncate ${task._done ? 'line-through' : ''}`}>
                          {task.task_name}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {task.end_time && (
                          <span className="text-[11px] text-muted-foreground">Até {task.end_time}</span>
                        )}
                        {task._type === 'occasional' && (
                          <Badge variant="secondary" className="text-[10px]">Especial</Badge>
                        )}
                        {task._type === 'occasional' && task.reward != null && (
                          <span className="text-[11px] text-muted-foreground">€{Number(task.reward).toFixed(2)}</span>
                        )}
                      </div>
                    </div>

                    {/* Delegation badge */}
                    {task._delegation && (
                      <Badge className="bg-blue-500/10 text-blue-600 text-[10px] flex items-center gap-1 flex-shrink-0 border-0">
                        <ArrowRightLeft className="w-3 h-3" />
                        {task._delegation._isReceived
                          ? `← ${task._delegation.from_person}`
                          : task._delegation.status === 'accepted'
                            ? `→ ${task._delegation.to_person}`
                            : 'Pendente'}
                      </Badge>
                    )}

                    {/* Reminder badge */}
                    {task._reminded && (
                      <Badge variant="destructive" className="text-[10px] flex items-center gap-1 flex-shrink-0">
                        <BellRing className="w-3 h-3" />
                        Lembrado
                      </Badge>
                    )}

                    {/* Status badge */}
                    {task._done ? (
                      <Badge className="bg-green-500/10 text-green-600 text-[10px] flex-shrink-0">
                        Feita
                      </Badge>
                    ) : task._cancelled ? (
                      <Badge className="bg-muted text-muted-foreground text-[10px] flex-shrink-0 flex items-center gap-1">
                        <Ban className="w-3 h-3" />
                        Cancelada
                      </Badge>
                    ) : task._extended ? (
                      <Badge className="bg-amber-500/10 text-amber-600 text-[10px] flex-shrink-0">
                        Extendida
                      </Badge>
                    ) : task._overdue ? (
                      <Badge variant="destructive" className="text-[10px] flex-shrink-0">
                        Atrasada
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] flex-shrink-0">
                        Pendente
                      </Badge>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </motion.div>
        );
      })}

      {/* Task detail sheet / send reminder — portaled so the fixed overlay
          isn't trapped by a transformed ancestor. */}
      <Portal>
      <AnimatePresence>
        {selectedTask && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-[60]"
              onClick={() => setSelectedTask(null)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-[61] bg-card rounded-t-3xl p-6 pb-12 shadow-2xl max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{TASK_ICONS[selectedTask.task_name] || '✅'}</span>
                  <div>
                    <h3 className="font-bold text-lg text-foreground">{selectedTask.task_name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {PERSON_AVATARS[selectedTask.person]} {selectedTask.person}
                    </p>
                  </div>
                </div>
                <button onClick={() => setSelectedTask(null)} className="p-1 rounded-full hover:bg-muted">
                  <X className="w-5 h-5 text-muted-foreground" />
                </button>
              </div>

              <div className="space-y-3 mb-5">
                {selectedTask.end_time && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="w-4 h-4" />
                    <span>Prazo: {selectedTask.end_time}</span>
                  </div>
                )}
                {selectedTask._type === 'occasional' && selectedTask.reward != null && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>💰</span>
                    <span>Recompensa: €{Number(selectedTask.reward).toFixed(2)}</span>
                  </div>
                )}
                {selectedTask._extended && (
                  <div className="bg-amber-500/10 rounded-xl p-3 text-sm text-amber-600 text-center font-medium">
                    ✅ Já foi dado mais tempo para esta tarefa
                    {selectedTask._extension?.with_reminder && ' (com lembrete)'}
                  </div>
                )}
                {selectedTask._cancelled && (
                  <div className="bg-muted rounded-xl p-3 text-sm text-muted-foreground text-center font-medium">
                    🚫 Esta tarefa foi cancelada para hoje
                  </div>
                )}
                {selectedTask._reminded && (
                  <div className="bg-amber-500/10 rounded-xl p-3 text-sm text-amber-600 text-center font-medium">
                    🔔 Já enviaste um lembrete para esta tarefa
                  </div>
                )}
              </div>

              {/* Overdue: show extension options */}
              {!selectedTask._cancelled && selectedTask._overdue && !selectedTask._extended && (
                <div className="space-y-2 mb-3">
                  <p className="text-xs text-muted-foreground text-center font-medium mb-2">
                    Dar mais tempo a {selectedTask.person} para concluir:
                  </p>
                  <button
                    disabled={extendTaskMutation.isPending}
                    onClick={() =>
                      extendTaskMutation.mutate({
                        person: selectedTask.person,
                        taskName: selectedTask.task_name,
                        endTime: selectedTask.end_time,
                        withReminder: false,
                      })
                    }
                    className="w-full py-3 rounded-2xl bg-amber-500 text-white font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    <TimerReset className="w-4 h-4" />
                    Dar mais tempo (sem lembrete) — €{extensionRewards(selectedTask).full.toFixed(2)}
                  </button>
                  <button
                    disabled={extendTaskMutation.isPending || selectedTask._reminded}
                    onClick={() =>
                      extendTaskMutation.mutate({
                        person: selectedTask.person,
                        taskName: selectedTask.task_name,
                        endTime: selectedTask.end_time,
                        withReminder: true,
                      })
                    }
                    className="w-full py-3 rounded-2xl bg-amber-500/70 text-white font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    <Bell className="w-4 h-4" />
                    Dar mais tempo (com lembrete) — €{extensionRewards(selectedTask).half.toFixed(2)}
                  </button>
                </div>
              )}

              {/* Non-overdue or already extended: show reminder button */}
              {!selectedTask._cancelled && (!selectedTask._overdue || selectedTask._extended) && (
                <>
                  <button
                    disabled={selectedTask._reminded || selectedTask._done || sendReminderMutation.isPending}
                    onClick={() =>
                      sendReminderMutation.mutate({
                        person: selectedTask.person,
                        taskName: selectedTask.task_name,
                        endTime: selectedTask.end_time,
                        taskType: selectedTask._type,
                      })
                    }
                    className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {sendReminderMutation.isPending ? (
                      <>
                        <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                        A enviar...
                      </>
                    ) : selectedTask._reminded ? (
                      <>
                        <BellRing className="w-4 h-4" />
                        Lembrete já enviado
                      </>
                    ) : (
                      <>
                        <Bell className="w-4 h-4" />
                        Enviar Lembrete
                      </>
                    )}
                  </button>
                  {!selectedTask._reminded && !selectedTask._done && (
                    <p className="text-xs text-muted-foreground text-center mt-3">
                      O valor da tarefa será reduzido para {selectedTask.person} ao concluir com lembrete
                    </p>
                  )}
                </>
              )}

              {/* Cancel / Uncancel task for this day */}
              {!selectedTask._done && (
                <div className="mt-3 pt-3 border-t border-border">
                  {selectedTask._cancelled ? (
                    <button
                      disabled={uncancelTaskMutation.isPending}
                      onClick={() => uncancelTaskMutation.mutate({ id: selectedTask._cancellation.id })}
                      className="w-full py-3 rounded-2xl bg-muted text-foreground font-medium text-sm disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                      <TimerReset className="w-4 h-4" />
                      Reativar tarefa
                    </button>
                  ) : (
                    <button
                      disabled={cancelTaskMutation.isPending}
                      onClick={() =>
                        cancelTaskMutation.mutate({
                          person: selectedTask.person,
                          taskName: selectedTask.task_name,
                          endTime: selectedTask.end_time,
                        })
                      }
                      className="w-full py-3 rounded-2xl bg-destructive/10 text-destructive font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                      <Ban className="w-4 h-4" />
                      Cancelar tarefa hoje
                    </button>
                  )}
                  <p className="text-[11px] text-muted-foreground text-center mt-2">
                    {selectedTask._cancelled
                      ? 'A tarefa volta a aparecer no horário.'
                      : `${selectedTask.person} não vai ver esta tarefa e não conta como falhada.`}
                  </p>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
      </Portal>
    </div>
  );
}
