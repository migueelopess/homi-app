import { useState } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { TaskDelegationService, TaskExtensionService, TaskCancellationService } from '@/api/entities';
import { sendPushNotification } from '@/api/supabaseClient';
import { Clock, CheckCircle2, Circle, Star, ArrowRightLeft } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import { TASK_ICONS, PEOPLE, PERSON_AVATARS, getLocalDateStr, sameTaskSlot } from '@/lib/taskHelpers';
import TaskCompleteModal from './TaskCompleteModal';
import { toast } from 'sonner';

const DAYS_MAP = {
  monday: 'Segunda', tuesday: 'Terça', wednesday: 'Quarta',
  thursday: 'Quinta', friday: 'Sexta', saturday: 'Sábado', sunday: 'Domingo',
};

function getTodayKey() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
}

function isTaskDone(scheduledTask, todayTasks) {
  return todayTasks.some(t =>
    t.task_name === scheduledTask.task_name && sameTaskSlot(t.end_time, scheduledTask.end_time)
  );
}

function isOverdue(endTime) {
  if (!endTime) return false;
  const now = new Date();
  const [h, m] = endTime.split(':').map(Number);
  const end = new Date();
  end.setHours(h, m, 0);
  return now > end;
}

function isActive(startTime, endTime) {
  if (!endTime) return true;
  const now = new Date();
  const [eh, em] = endTime.split(':').map(Number);
  const end = new Date(); end.setHours(eh, em, 0);
  return now <= end;
}

export default function TodaySchedule({ scheduledTasks, todayTasks, person, occasionalTasks = [] }) {
  const [selectedTask, setSelectedTask] = useState(null);
  const [delegateConfirm, setDelegateConfirm] = useState(null);
  const queryClient = useQueryClient();
  const todayKey = getTodayKey();
  const today = getLocalDateStr();

  // Fetch delegations for today
  const { data: delegations = [] } = useQuery({
    queryKey: ['taskDelegations'],
    queryFn: () => TaskDelegationService.list('-created_at'),
  });

  // Fetch extensions for today (granted by parents)
  const { data: extensions = [] } = useQuery({
    queryKey: ['taskExtensions', today],
    queryFn: () => TaskExtensionService.getByDate(today),
  });

  // Fetch cancellations for today (parents may cancel a task for a child)
  const { data: cancellations = [] } = useQuery({
    queryKey: ['taskCancellations', today],
    queryFn: () => TaskCancellationService.getByDate(today),
  });

  const isCancelled = (task) =>
    cancellations.some(c =>
      c.person === person && c.task_name === task.task_name && sameTaskSlot(c.end_time, task.end_time)
    );

  const todayDelegations = delegations.filter(d => d.task_date === today);

  // Tasks I delegated away (pending or accepted) — hide from my schedule
  const myDelegatedAway = todayDelegations.filter(
    d => d.from_person === person && (d.status === 'pending' || d.status === 'accepted')
  );

  // Tasks delegated TO me and accepted — show in my schedule
  const delegatedToMe = todayDelegations.filter(
    d => d.to_person === person && d.status === 'accepted'
  );

  const todaySchedule = scheduledTasks
    .filter(t => t.person === person && t.days_of_week?.includes(todayKey))
    // Hide tasks I delegated away
    .filter(t => !myDelegatedAway.some(d => d.task_type === 'scheduled' && d.scheduled_task_id === t.id))
    // Hide tasks cancelled by parents for today
    .filter(t => !isCancelled(t))
    .sort((a, b) => (a.start_time || '00:00').localeCompare(b.start_time || '00:00'));

  const todayOccasional = occasionalTasks
    .filter(t => t.person === person && t.date === today && !t.completed)
    // Hide occasional tasks I delegated away
    .filter(t => !myDelegatedAway.some(d => d.task_type === 'occasional' && d.occasional_task_id === t.id))
    // Hide tasks cancelled by parents for today
    .filter(t => !isCancelled(t))
    .sort((a, b) => (a.end_time || '99:99').localeCompare(b.end_time || '99:99'));

  // Build delegated-to-me tasks as card items
  const delegatedScheduledToMe = delegatedToMe
    .filter(d => d.task_type === 'scheduled')
    .map(d => {
      const original = scheduledTasks.find(t => t.id === d.scheduled_task_id);
      return { ...d, _delegated: true, _from: d.from_person, end_time: d.end_time || original?.end_time };
    });

  const delegatedOccasionalToMe = delegatedToMe
    .filter(d => d.task_type === 'occasional')
    .map(d => ({ ...d, _delegated: true, _from: d.from_person }));

  const delegateMutation = useMutation({
    mutationFn: async ({ taskType, scheduledTaskId, occasionalTaskId, taskName, endTime, reward }) => {
      return TaskDelegationService.create({
        from_person: person,
        task_type: taskType,
        scheduled_task_id: scheduledTaskId || null,
        occasional_task_id: occasionalTaskId || null,
        task_name: taskName,
        task_date: today,
        end_time: endTime || null,
        reward: reward || 0,
        status: 'pending',
      });
    },
    onSuccess: (data, { taskName }) => {
      queryClient.invalidateQueries({ queryKey: ['taskDelegations'] });
      toast.success(`Pedido de delegação enviado para "${taskName}"!`);
      setDelegateConfirm(null);
      // Send push to all other siblings
      const siblings = PEOPLE.filter(p => p !== person);
      for (const sibling of siblings) {
        sendPushNotification({
          person: sibling,
          title: '📥 Pedido de ajuda!',
          body: `${person} precisa de ajuda com: ${taskName}`,
          url: '/delegar',
          tag: `delegation-request-${data.id}`,
        });
      }
    },
    onError: (err) => {
      if (err?.code === '23505') {
        toast.error('Já delegaste esta tarefa.');
      } else {
        toast.error('Erro ao delegar tarefa.');
      }
      setDelegateConfirm(null);
    },
  });


  const totalAll = todaySchedule.length + todayOccasional.length + delegatedScheduledToMe.length + delegatedOccasionalToMe.length;
  const doneScheduled = todaySchedule.filter(t => isTaskDone(t, todayTasks)).length;
  const doneDelegatedScheduled = delegatedScheduledToMe.filter(d =>
    todayTasks.some(t => t.task_name === d.task_name && t.person === person && sameTaskSlot(t.end_time, d.end_time))
  ).length;
  const totalDone = doneScheduled + doneDelegatedScheduled;

  if (totalAll === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <p className="text-sm">Sem tarefas agendadas para hoje 🎉</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">{totalDone}/{totalAll} concluídas</span>
          <div className="flex-1 mx-3 bg-muted rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${totalAll > 0 ? (totalDone / totalAll) * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* Occasional tasks for today */}
        {todayOccasional.map((task, i) => {
          const overdue = isOverdue(task.end_time);
          return (
            <motion.div
              key={`occ-${task.id}`}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card
                className={`p-3 flex items-center gap-3 transition-all border-accent/40 bg-accent/5 ${
                  overdue ? 'border-destructive/40 bg-destructive/5' : ''
                }`}
              >
                <div className="text-xl flex-shrink-0 cursor-pointer" onClick={() => setSelectedTask({ ...task, _occasional: true })}>{TASK_ICONS[task.task_name] || '✅'}</div>
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setSelectedTask({ ...task, _occasional: true })}>
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold text-foreground">{task.task_name}</p>
                    <Star className="w-3 h-3 text-accent fill-accent" />
                  </div>
                  {task.end_time && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3 text-muted-foreground" />
                      <span className="text-[11px] text-muted-foreground">Até às {task.end_time}</span>
                    </div>
                  )}
                  {task.notes && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{task.notes}</p>}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); setDelegateConfirm({ taskType: 'occasional', occasionalTaskId: task.id, taskName: task.task_name, endTime: task.end_time, reward: task.reward }); }}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                    title="Delegar tarefa"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5" />
                  </button>
                  {overdue ? (
                    <Badge variant="destructive" className="text-[10px]">Atrasado</Badge>
                  ) : (
                    <Badge className="bg-accent/20 text-accent-foreground border-0 text-[10px]">Especial</Badge>
                  )}
                </div>
              </Card>
            </motion.div>
          );
        })}

        {/* Delegated occasional tasks TO me */}
        {delegatedOccasionalToMe.map((d, i) => {
          const isExtended = extensions.some(e => e.task_name === d.task_name && (e.person === d.from_person || e.person === person) && sameTaskSlot(e.end_time, d.end_time));
          const overdue = !isExtended && isOverdue(d.end_time);
          const isDone = todayTasks.some(t => t.task_name === d.task_name && t.person === person && sameTaskSlot(t.end_time, d.end_time));
          if (isDone) return null;
          return (
            <motion.div
              key={`deleg-occ-${d.id}`}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card
                onClick={() => setSelectedTask({ ...d, person, _delegated: true, _from: d.from_person, _occasional: true, _isExtended: isExtended })}
                className={`p-3 flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-all border-blue-500/30 bg-blue-500/5 ${
                  overdue ? 'border-destructive/40 bg-destructive/5' : ''
                }`}
              >
                <div className="text-xl flex-shrink-0">{TASK_ICONS[d.task_name] || '✅'}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold text-foreground">{d.task_name}</p>
                    <Star className="w-3 h-3 text-accent fill-accent" />
                  </div>
                  <span className="text-[11px] text-blue-600">📥 Delegada por {PERSON_AVATARS[d._from]} {d._from}</span>
                  {d.end_time && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3 text-muted-foreground" />
                      <span className="text-[11px] text-muted-foreground">Até às {d.end_time}</span>
                    </div>
                  )}
                </div>
                <div className="flex-shrink-0">
                  {isExtended ? (
                    <Badge className="bg-amber-500/10 text-amber-600 border-0 text-[10px]">Extendida</Badge>
                  ) : overdue ? (
                    <Badge variant="destructive" className="text-[10px]">Atrasado</Badge>
                  ) : (
                    <Badge className="bg-blue-500/15 text-blue-600 border-0 text-[10px]">Delegada</Badge>
                  )}
                </div>
              </Card>
            </motion.div>
          );
        })}

        {todaySchedule.map((task, i) => {
          const isDone = isTaskDone(task, todayTasks);
          const isExtended = extensions.some(e => e.person === person && e.task_name === task.task_name && sameTaskSlot(e.end_time, task.end_time));
          const overdue = !isDone && !isExtended && isOverdue(task.end_time);
          const active = isActive(task.start_time, task.end_time);

          return (
            <motion.div
              key={task.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card
                className={`p-3 flex items-center gap-3 transition-all ${
                  isDone ? 'opacity-60 bg-muted/50' :
                  overdue ? 'border-destructive/40 bg-destructive/5 cursor-pointer active:scale-[0.98]' :
                  active ? 'border-primary/30 bg-primary/5 cursor-pointer active:scale-[0.98]' :
                  'cursor-pointer hover:border-primary/20 active:scale-[0.98]'
                }`}
              >
                <div className="text-xl flex-shrink-0" onClick={() => !isDone && setSelectedTask({ ...task, _isExtended: isExtended })}>{TASK_ICONS[task.task_name] || '✅'}</div>
                <div className="flex-1 min-w-0" onClick={() => !isDone && setSelectedTask({ ...task, _isExtended: isExtended })}>
                  <p className={`text-sm font-semibold ${isDone ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                    {task.task_name}
                  </p>
                  {task.end_time && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3 text-muted-foreground" />
                      <span className="text-[11px] text-muted-foreground">Até às {task.end_time}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {!isDone && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setDelegateConfirm({ taskType: 'scheduled', scheduledTaskId: task.id, taskName: task.task_name, endTime: task.end_time }); }}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                      title="Delegar tarefa"
                    >
                      <ArrowRightLeft className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {isDone ? (
                    <CheckCircle2 className="w-5 h-5 text-primary" />
                  ) : overdue ? (
                    <Badge variant="destructive" className="text-[10px]">Atrasado</Badge>
                  ) : active ? (
                    <Badge className="bg-primary/15 text-primary border-0 text-[10px]">Agora</Badge>
                  ) : (
                    <Circle className="w-5 h-5 text-muted-foreground/40" />
                  )}
                </div>
              </Card>
            </motion.div>
          );
        })}

        {/* Delegated scheduled tasks TO me */}
        {delegatedScheduledToMe.map((d, i) => {
          const isDone = todayTasks.some(t => t.task_name === d.task_name && t.person === person && sameTaskSlot(t.end_time, d.end_time));
          const isExtended = extensions.some(e => e.task_name === d.task_name && (e.person === d.from_person || e.person === person) && sameTaskSlot(e.end_time, d.end_time));
          const overdue = !isDone && !isExtended && isOverdue(d.end_time);
          const active = isActive(null, d.end_time);

          return (
            <motion.div
              key={`deleg-${d.id}`}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card
                onClick={() => !isDone && setSelectedTask({ ...d, person, _delegated: true, _from: d.from_person, task_name: d.task_name, end_time: d.end_time, _isExtended: isExtended })}
                className={`p-3 flex items-center gap-3 transition-all ${
                  isDone ? 'opacity-60 bg-muted/50' :
                  overdue ? 'border-destructive/40 bg-destructive/5 cursor-pointer active:scale-[0.98]' :
                  'border-blue-500/30 bg-blue-500/5 cursor-pointer active:scale-[0.98]'
                }`}
              >
                <div className="text-xl flex-shrink-0">{TASK_ICONS[d.task_name] || '✅'}</div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${isDone ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                    {d.task_name}
                  </p>
                  <span className="text-[11px] text-blue-600">📥 Delegada por {PERSON_AVATARS[d._from]} {d._from}</span>
                  {d.end_time && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3 text-muted-foreground" />
                      <span className="text-[11px] text-muted-foreground">Até às {d.end_time}</span>
                    </div>
                  )}
                </div>
                <div className="flex-shrink-0">
                  {isDone ? (
                    <CheckCircle2 className="w-5 h-5 text-primary" />
                  ) : isExtended ? (
                    <Badge className="bg-amber-500/10 text-amber-600 border-0 text-[10px]">Extendida</Badge>
                  ) : overdue ? (
                    <Badge variant="destructive" className="text-[10px]">Atrasado</Badge>
                  ) : (
                    <Badge className="bg-blue-500/15 text-blue-600 border-0 text-[10px]">Delegada</Badge>
                  )}
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>

      <TaskCompleteModal
        task={selectedTask}
        person={person}
        isExtended={selectedTask?._isExtended ?? false}
        occasionalTaskId={
          selectedTask?._occasional
            ? (selectedTask?._delegated ? selectedTask?.occasional_task_id : selectedTask?.id)
            : undefined
        }
        onClose={() => setSelectedTask(null)}
      />

      {/* Delegation confirmation dialog */}
      {delegateConfirm && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-end" onClick={() => setDelegateConfirm(null)}>
          <div className="w-full bg-card rounded-t-3xl p-6 pb-24 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-5">
              <span className="text-3xl">{TASK_ICONS[delegateConfirm.taskName] || '✅'}</span>
              <div>
                <h3 className="font-bold text-lg text-foreground">Delegar tarefa</h3>
                <p className="text-sm text-muted-foreground">{delegateConfirm.taskName}</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-5">
              Tens a certeza que queres pedir ajuda aos teus irmãos? A tarefa será transferida para quem aceitar, incluindo a recompensa.
            </p>
            <button
              disabled={delegateMutation.isPending}
              onClick={() => delegateMutation.mutate(delegateConfirm)}
              className="w-full py-3 rounded-2xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {delegateMutation.isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  A enviar...
                </>
              ) : (
                <>
                  <ArrowRightLeft className="w-4 h-4" />
                  Confirmar delegação
                </>
              )}
            </button>
            <button
              onClick={() => setDelegateConfirm(null)}
              className="w-full py-3 mt-2 rounded-2xl bg-muted text-muted-foreground font-medium text-sm"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </>
  );
}