import { useState, useRef } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { TaskDelegationService, ExtensionRequestService } from '@/api/entities';
import { delegationsQuery, extensionsByDateQuery, extensionRequestsQuery, cancellationsQuery, INVALIDATE } from '@/lib/queries';
import { sendPushNotification } from '@/api/supabaseClient';
import { Clock, CheckCircle2, Circle, Star, ArrowRightLeft, Hourglass } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import {
  TASK_ICONS, PEOPLE, PERSON_AVATARS, getLocalDateStr, DELEGATION_PARENTS_NOTICE_LABEL, DELEGATION_STATUS, parentsNotified,
  scheduledOccurrence, occasionalOccurrence, delegationOccurrence, settlesSlot,
  EXTENSION_REQUEST_STATUS, EXTRA_TIME_OPTIONS, effectiveDeadline, requestedUntil, untilLabel,
  extensionFor, extensionRequestFor,
} from '@/lib/taskHelpers';
import TaskCapture from './TaskCapture';
import Portal from '@/components/layout/Portal';
import { toast } from 'sonner';

const DAYS_MAP = {
  monday: 'Segunda', tuesday: 'Terça', wednesday: 'Quarta',
  thursday: 'Quinta', friday: 'Sexta', saturday: 'Sábado', sunday: 'Domingo',
};

function getTodayKey() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
}

// Only a record that settles *this* occurrence counts. A chore registered from
// the Registar page settles none, and a sibling's delegated copy of the same
// task at the same hour is a different occurrence entirely.
function isTaskDone(scheduledTask, todayTasks) {
  const occurrence = scheduledOccurrence(scheduledTask);
  return todayTasks.some(t => settlesSlot(t, occurrence));
}

function isOverdue(endTime) {
  if (!endTime) return false;
  const now = new Date();
  const [h, m] = endTime.split(':').map(Number);
  const end = new Date();
  end.setHours(h, m, 0);
  return now > end;
}

// The deadline line on a card. With more time given it shows the new one and
// what it was: "Até às 20:00 (era 19:00)".
function DeadlineLine({ endTime, extension }) {
  if (!endTime && !extension) return null;
  const deadline = effectiveDeadline(endTime, extension);
  return (
    <div className="flex items-center gap-1 mt-0.5">
      <Clock className="w-3 h-3 text-muted-foreground" />
      <span className="text-[11px] text-muted-foreground">
        {extension
          ? <>{deadline ? `Até às ${deadline}` : 'Até ao fim do dia'}{endTime && <span className="opacity-70"> (era {endTime})</span>}</>
          : `Até às ${endTime}`}
      </span>
    </div>
  );
}

// Where my request for more time stands. Once granted the deadline line above
// already shows the new time; this says who gave it.
function ExtensionNote({ request, extension }) {
  const status = request?.status;
  if (status === EXTENSION_REQUEST_STATUS.PENDING) {
    return (
      <p className="text-[11px] font-medium mt-0.5 text-amber-600 dark:text-amber-400">
        ⏳ Pediste mais tempo {untilLabel(request.until_time)} — à espera dos pais
      </p>
    );
  }
  if (status === EXTENSION_REQUEST_STATUS.REFUSED) {
    return (
      <p className="text-[11px] font-medium mt-0.5 text-red-600 dark:text-red-400">
        ❌ Os pais disseram que não — o prazo mantém-se
      </p>
    );
  }
  if (extension) {
    return (
      <p className="text-[11px] font-medium mt-0.5 text-green-700 dark:text-green-400">
        ✅ Os pais deram-te mais tempo
      </p>
    );
  }
  return null;
}

function isActive(startTime, endTime) {
  if (!endTime) return true;
  const now = new Date();
  const [eh, em] = endTime.split(':').map(Number);
  const end = new Date(); end.setHours(eh, em, 0);
  return now <= end;
}

// What became of a request I made for one of my own tasks, once it is back
// on my list. A request still waiting on the 3 hours, or accepted, keeps the
// task off my list altogether; once the parents have been told, it comes back
// so I can still do it myself — while a sibling can still take it.
function RequestOutcome({ request }) {
  if (!request) return null;
  const waiting = request.status === DELEGATION_STATUS.PENDING || request.status === DELEGATION_STATUS.UNANSWERED;
  const text = waiting
    ? '🙋 Ninguém aceitou ainda — os pais foram avisados (os irmãos ainda podem aceitar)'
    : {
      parent_rejected: '👀 Os pais acham que consegues — é tua para fazer',
    }[request.status];
  if (!text) return null;
  return (
    <p className={`text-[11px] font-medium mt-0.5 ${
      request.status === 'parent_rejected' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'
    }`}>
      {text}
    </p>
  );
}

export default function TodaySchedule({ scheduledTasks, todayTasks, person, occasionalTasks = [] }) {
  const captureRef = useRef(null);
  const [delegateConfirm, setDelegateConfirm] = useState(null);
  // The task I am asking more time for, and what I picked.
  const [askTime, setAskTime] = useState(null);
  const [askMinutes, setAskMinutes] = useState(EXTRA_TIME_OPTIONS[1].minutes);
  const [askReason, setAskReason] = useState('');
  const queryClient = useQueryClient();
  const todayKey = getTodayKey();
  const today = getLocalDateStr();

  const { data: delegations = [] } = useQuery(delegationsQuery());
  // Extensions and cancellations the parents granted for today.
  const { data: extensions = [] } = useQuery(extensionsByDateQuery(today));
  // My requests for more time — polled, so the parents' answer shows up.
  const { data: extensionRequests = [] } = useQuery(extensionRequestsQuery());
  const extensionOf = (task) => extensionFor({
    extensions, requests: extensionRequests, person, taskName: task.task_name, endTime: task.end_time, date: today,
  });
  const extensionRequestOf = (task) =>
    extensionRequestFor(extensionRequests, person, task.task_name, task.end_time, today);
  // Asking for more time needs a deadline to move, and is one or the other
  // with delegating: no request if the task was delegated, extended or asked.
  const canAskTime = (task, delegationRequest) =>
    !!task.end_time && !delegationRequest && !extensionOf(task) && !extensionRequestOf(task);
  // The full list is already loaded by the Home page itself, so reading it here
  // costs no extra request on opening the app; a per-day query did.
  const { data: cancellations = [] } = useQuery(cancellationsQuery());

  // Waived for this exact occurrence. Matching by name and hour alone meant a
  // single cancellation silenced every same-named task at that time.
  const isCancelled = (occurrence) =>
    cancellations.some(c => c.task_date === today && c.person === person && settlesSlot(c, occurrence));

  const todayDelegations = delegations.filter(d => d.task_date === today);

  // Tasks I delegated away and that are out of my hands for now — a sibling
  // took them, or the request is fresh — are hidden from my schedule. Once
  // the parents have been told nobody took it, the task comes back to me,
  // flagged (a sibling can still accept it, which hides it again).
  const myDelegatedAway = todayDelegations.filter(
    d => d.from_person === person &&
      (d.status === DELEGATION_STATUS.ACCEPTED || (d.status === DELEGATION_STATUS.PENDING && !parentsNotified(d)))
  );

  // My own request for this occurrence, if I made one today. A task can only
  // be delegated once a day (unique in the database), so once a request exists
  // the "delegate" button goes and its outcome is shown instead.
  const myRequestFor = (type, id) => todayDelegations.find(d =>
    d.from_person === person && d.task_type === type &&
    (type === 'scheduled' ? d.scheduled_task_id === id : d.occasional_task_id === id)
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
    .filter(t => !isCancelled(scheduledOccurrence(t)))
    .sort((a, b) => (a.start_time || '00:00').localeCompare(b.start_time || '00:00'));

  const todayOccasional = occasionalTasks
    .filter(t => t.person === person && t.date === today && !t.completed)
    // Hide occasional tasks I delegated away
    .filter(t => !myDelegatedAway.some(d => d.task_type === 'occasional' && d.occasional_task_id === t.id))
    // Hide tasks cancelled by parents for today
    .filter(t => !isCancelled(occasionalOccurrence(t)))
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
      queryClient.invalidateQueries({ queryKey: INVALIDATE.delegations });
      toast.success(`Pedido de delegação enviado para "${taskName}"!`);
      setDelegateConfirm(null);
      // Send push to all other siblings
      const siblings = PEOPLE.filter(p => p !== person);
      for (const sibling of siblings) {
        sendPushNotification({
          person: sibling,
          title: '📥 Pedido de ajuda!',
          body: `${person} precisa de ajuda com: ${taskName}. Aceita ou recusa — podes aceitar até ao fim do dia.`,
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

  const askTimeMutation = useMutation({
    mutationFn: ({ taskType, scheduledTaskId, occasionalTaskId, taskName, endTime, reward, untilTime, reason }) =>
      ExtensionRequestService.create({
        person,
        task_type: taskType,
        scheduled_task_id: scheduledTaskId || null,
        occasional_task_id: occasionalTaskId || null,
        task_name: taskName,
        task_date: today,
        end_time: endTime || null,
        until_time: untilTime,
        reward: taskType === 'occasional' && reward != null ? reward : null,
        reason: reason || null,
      }),
    onSuccess: (data, { taskName, endTime, untilTime, reason }) => {
      queryClient.invalidateQueries({ queryKey: INVALIDATE.extensionRequests });
      toast.success('Pedido enviado aos pais!');
      setAskTime(null);
      sendPushNotification({
        person: '__parents__',
        title: `⏰ ${person} pede mais tempo`,
        body: `"${taskName}" (${endTime} → ${untilTime ?? 'fim do dia'})${reason ? ` — ${reason}` : ''}`,
        url: '/pais',
        tag: `extension-request-${data.id}`,
      });
    },
    onError: (err) => {
      toast.error(err?.code === '23505' ? 'Já pediste mais tempo para esta tarefa.' : 'Erro ao enviar o pedido.');
      setAskTime(null);
    },
  });

  const openAskTime = (task) => {
    setAskMinutes(EXTRA_TIME_OPTIONS[1].minutes);
    setAskReason('');
    setAskTime(task);
  };

  const totalAll = todaySchedule.length + todayOccasional.length + delegatedScheduledToMe.length + delegatedOccasionalToMe.length;
  const doneScheduled = todaySchedule.filter(t => isTaskDone(t, todayTasks)).length;
  const doneDelegatedScheduled = delegatedScheduledToMe.filter(d =>
    todayTasks.some(t => t.person === person && settlesSlot(t, delegationOccurrence(d)))
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
          const extension = extensionOf(task);
          const overdue = isOverdue(effectiveDeadline(task.end_time, extension));
          const delegationRequest = myRequestFor('occasional', task.id);
          const timeRequest = extensionRequestOf(task);
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
                <div className="text-xl flex-shrink-0 cursor-pointer" onClick={() => captureRef.current?.capture({ ...task, _occasional: true, _extension: extension })}>{TASK_ICONS[task.task_name] || '✅'}</div>
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => captureRef.current?.capture({ ...task, _occasional: true, _extension: extension })}>
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold text-foreground">{task.task_name}</p>
                    <Star className="w-3 h-3 text-accent fill-accent" />
                  </div>
                  <DeadlineLine endTime={task.end_time} extension={extension} />
                  {task.notes && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{task.notes}</p>}
                  <RequestOutcome request={delegationRequest} />
                  <ExtensionNote request={timeRequest} extension={extension} />
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {canAskTime(task, delegationRequest) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); openAskTime({ taskType: 'occasional', occasionalTaskId: task.id, taskName: task.task_name, endTime: task.end_time, reward: task.reward }); }}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-amber-600 hover:bg-amber-500/10 transition-colors"
                      title="Pedir mais tempo"
                    >
                      <Hourglass className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {!delegationRequest && !timeRequest && !extension && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setDelegateConfirm({ taskType: 'occasional', occasionalTaskId: task.id, taskName: task.task_name, endTime: task.end_time, reward: task.reward }); }}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                      title="Delegar tarefa"
                    >
                      <ArrowRightLeft className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {overdue ? (
                    <Badge variant="destructive" className="text-[10px]">Atrasado</Badge>
                  ) : extension ? (
                    <Badge className="bg-amber-500/10 text-amber-600 border-0 text-[10px]">Mais tempo</Badge>
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
          // Never "late" for the one who took it over — see completionTypeFor.
          const isDone = todayTasks.some(t => t.person === person && settlesSlot(t, delegationOccurrence(d)));
          if (isDone) return null;
          return (
            <motion.div
              key={`deleg-occ-${d.id}`}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card
                onClick={() => captureRef.current?.capture({ ...d, person, _delegated: true, _from: d.from_person, _occasional: true })}
                className="p-3 flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-all border-blue-500/30 bg-blue-500/5"
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
                      <span className="text-[11px] text-muted-foreground">Pedida para as {d.end_time} · sem atraso</span>
                    </div>
                  )}
                </div>
                <div className="flex-shrink-0">
                  <Badge className="bg-blue-500/15 text-blue-600 border-0 text-[10px]">Delegada</Badge>
                </div>
              </Card>
            </motion.div>
          );
        })}

        {todaySchedule.map((task, i) => {
          const isDone = isTaskDone(task, todayTasks);
          const extension = extensionOf(task);
          const deadline = effectiveDeadline(task.end_time, extension);
          const overdue = !isDone && isOverdue(deadline);
          const active = isActive(task.start_time, deadline);
          const delegationRequest = myRequestFor('scheduled', task.id);
          const timeRequest = extensionRequestOf(task);

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
                <div className="text-xl flex-shrink-0" onClick={() => !isDone && captureRef.current?.capture({ ...task, _extension: extension })}>{TASK_ICONS[task.task_name] || '✅'}</div>
                <div className="flex-1 min-w-0" onClick={() => !isDone && captureRef.current?.capture({ ...task, _extension: extension })}>
                  <p className={`text-sm font-semibold ${isDone ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                    {task.task_name}
                  </p>
                  <DeadlineLine endTime={task.end_time} extension={extension} />
                  {!isDone && <RequestOutcome request={delegationRequest} />}
                  {!isDone && <ExtensionNote request={timeRequest} extension={extension} />}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {!isDone && canAskTime(task, delegationRequest) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); openAskTime({ taskType: 'scheduled', scheduledTaskId: task.id, taskName: task.task_name, endTime: task.end_time }); }}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-amber-600 hover:bg-amber-500/10 transition-colors"
                      title="Pedir mais tempo"
                    >
                      <Hourglass className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {!isDone && !delegationRequest && !timeRequest && !extension && (
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
                  ) : extension ? (
                    <Badge className="bg-amber-500/10 text-amber-600 border-0 text-[10px]">Mais tempo</Badge>
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
          // Never "late" for the one who took it over — see completionTypeFor.
          const isDone = todayTasks.some(t => t.person === person && settlesSlot(t, delegationOccurrence(d)));

          return (
            <motion.div
              key={`deleg-${d.id}`}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card
                onClick={() => !isDone && captureRef.current?.capture({ ...d, person, _delegated: true, _from: d.from_person, task_name: d.task_name, end_time: d.end_time })}
                className={`p-3 flex items-center gap-3 transition-all ${
                  isDone ? 'opacity-60 bg-muted/50' : 'border-blue-500/30 bg-blue-500/5 cursor-pointer active:scale-[0.98]'
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
                      <span className="text-[11px] text-muted-foreground">Pedida para as {d.end_time} · sem atraso</span>
                    </div>
                  )}
                </div>
                <div className="flex-shrink-0">
                  {isDone ? (
                    <CheckCircle2 className="w-5 h-5 text-primary" />
                  ) : (
                    <Badge className="bg-blue-500/15 text-blue-600 border-0 text-[10px]">Delegada</Badge>
                  )}
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {/* Hidden camera input — tap a task, take the photo, done. */}
      <TaskCapture ref={captureRef} person={person} />

      {/* Ask the parents for more time. */}
      {askTime && (
        <Portal>
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-end" onClick={() => setAskTime(null)}>
          <div className="w-full bg-card rounded-t-3xl p-6 pb-24 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <span className="text-3xl">{TASK_ICONS[askTime.taskName] || '✅'}</span>
              <div>
                <h3 className="font-bold text-lg text-foreground">Pedir mais tempo</h3>
                <p className="text-sm text-muted-foreground">{askTime.taskName} · até às {askTime.endTime}</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Os pais decidem. Se disserem que sim, feita até à nova hora conta como a tempo.
            </p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {EXTRA_TIME_OPTIONS
                // Late in the evening +1 h and +2 h both stop at 23:59 — one is enough.
                .filter((opt, i, all) => i === 0 || opt.minutes == null ||
                  requestedUntil(askTime.endTime, opt.minutes) !== requestedUntil(askTime.endTime, all[i - 1].minutes))
                .map(opt => {
                const until = requestedUntil(askTime.endTime, opt.minutes);
                const selected = askMinutes === opt.minutes;
                return (
                  <button
                    key={opt.label}
                    onClick={() => setAskMinutes(opt.minutes)}
                    className={`py-2.5 rounded-xl text-sm font-bold border transition-colors ${
                      selected ? 'bg-amber-500 text-white border-amber-500' : 'bg-muted/50 text-foreground border-border'
                    }`}
                  >
                    {opt.label}
                    {until && <span className={`block text-[11px] font-medium ${selected ? 'text-white/85' : 'text-muted-foreground'}`}>até às {until}</span>}
                  </button>
                );
              })}
            </div>
            <input
              type="text"
              value={askReason}
              maxLength={120}
              onChange={e => setAskReason(e.target.value)}
              placeholder="Porquê? (opcional) — ex.: estou no treino"
              className="w-full h-11 px-3 mb-4 rounded-xl bg-muted/50 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-amber-500/40"
            />
            <button
              disabled={askTimeMutation.isPending}
              onClick={() => askTimeMutation.mutate({
                ...askTime,
                untilTime: requestedUntil(askTime.endTime, askMinutes),
                reason: askReason.trim(),
              })}
              className="w-full py-3 rounded-2xl bg-amber-500 text-white font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {askTimeMutation.isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  A enviar...
                </>
              ) : (
                <>
                  <Hourglass className="w-4 h-4" />
                  Pedir aos pais
                </>
              )}
            </button>
            <button
              onClick={() => setAskTime(null)}
              className="w-full py-3 mt-2 rounded-2xl bg-muted text-muted-foreground font-medium text-sm"
            >
              Cancelar
            </button>
          </div>
        </div>
        </Portal>
      )}

      {/* Delegation confirmation dialog — portaled so the fixed overlay can't be
          trapped by a transformed ancestor (framer-motion card / page wrapper). */}
      {delegateConfirm && (
        <Portal>
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-end" onClick={() => setDelegateConfirm(null)}>
          <div className="w-full bg-card rounded-t-3xl p-6 pb-24 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-5">
              <span className="text-3xl">{TASK_ICONS[delegateConfirm.taskName] || '✅'}</span>
              <div>
                <h3 className="font-bold text-lg text-foreground">Delegar tarefa</h3>
                <p className="text-sm text-muted-foreground">{delegateConfirm.taskName}</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-5">
              Os teus irmãos podem aceitar até ao fim do dia — quem aceitar fica com a tarefa e a recompensa. Se ninguém aceitar em {DELEGATION_PARENTS_NOTICE_LABEL}, os pais são avisados e podem cancelá-la. Se o dia acabar sem ninguém aceitar e sem decisão dos pais, não conta como falha.
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
        </Portal>
      )}
    </>
  );
}