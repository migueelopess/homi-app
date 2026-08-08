import { forwardRef, useImperativeHandle, useRef, useState, useEffect } from 'react';
import Portal from '@/components/layout/Portal';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { TaskService, TaskReminderService, OccasionalTaskService } from '@/api/entities';
import { sendPushNotification } from '@/api/supabaseClient';
import { uploadTaskPhoto } from '@/api/storage';
import { COMPLETION_TYPES, getTaskValue, getWeekKey, getCurrentMonthKey, getLocalDateStr, sameTaskSlot } from '@/lib/taskHelpers';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Loader2, RefreshCw, WifiOff } from 'lucide-react';

function isWithinTimeWindow(endTime) {
  if (!endTime) return true;
  const now = new Date();
  const [eh, em] = endTime.split(':').map(Number);
  const end = new Date();
  end.setHours(eh, em, 0);
  return now <= end;
}

// Value of a completed task. An occasional task carries its own explicit
// reward (halved with a reminder, quartered when late) and that always wins;
// everything else follows the standard scale, which is also where Sidney
// chores get paid €0 unless this person took the task on from a sibling.
function taskValue(task, completionType) {
  const isOccasional = task._occasional || task._type === 'occasional';
  const reward = isOccasional && task.reward != null ? Number(task.reward) : null;
  if (reward != null) {
    if (completionType === 'on_time_no_reminder') return reward;
    if (completionType === 'on_time_with_reminder') return Math.round(reward * 50) / 100;
    if (completionType === 'late') return Math.round(reward * 25) / 100;
    return 0;
  }
  return getTaskValue(task.task_name, completionType, { delegated: !!task._delegated });
}

// One-tap task completion: `capture(task)` opens the OS camera straight from
// the tap, and the photo submits the task immediately — same flow and same
// saving/success screens as the Registar page (no toasts).
const TaskCapture = forwardRef(function TaskCapture({ person }, ref) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const pendingTaskRef = useRef(null);
  // null | 'saving' | { completion_type, value } (success)
  const [phase, setPhase] = useState(null);
  // What the upload is doing right now, so a slow connection shows progress
  // instead of a mute spinner: { phase: 'compressing'|'uploading', attempt }
  const [stage, setStage] = useState(null);
  // The captured photo is kept so "tentar novamente" never asks for a new one —
  // the child has already walked away from whatever they photographed.
  const retryRef = useRef(null);
  const [failure, setFailure] = useState(null);
  const today = getLocalDateStr();

  // Reminders sent to this person today — reduce the task's value.
  const { data: reminders = [] } = useQuery({
    queryKey: ['taskReminders', person, today],
    queryFn: () => TaskReminderService.getByPersonAndDate(person, today),
    enabled: !!person,
  });

  useImperativeHandle(ref, () => ({
    // Must be called synchronously inside the tap handler so the browser
    // treats the camera open as a user gesture.
    capture(task) {
      if (!task || phase || failure) return;
      pendingTaskRef.current = task;
      fileInputRef.current?.click();
    },
  }));

  const createMutation = useMutation({
    mutationFn: async ({ task, file }) => {
      const photo_url = await uploadTaskPhoto(file, setStage);

      const hasReminder = reminders.some(
        r => r.task_name === task.task_name && sameTaskSlot(r.end_time, task.end_time)
      );
      const inTime = task._isExtended || isWithinTimeWindow(task.end_time);
      const completion_type = inTime
        ? (hasReminder ? 'on_time_with_reminder' : 'on_time_no_reminder')
        : 'late';
      const value = taskValue(task, completion_type);
      const occasionalTaskId = (task._occasional || task._type === 'occasional')
        ? (task._delegated ? task.occasional_task_id : task.id)
        : null;

      const promises = [
        TaskService.create({
          person,
          task_name: task.task_name,
          completion_type,
          value,
          date: today,
          end_time: task.end_time ?? null,
          week_key: getWeekKey(new Date()),
          month_key: getCurrentMonthKey(),
          photo_url,
        }),
      ];
      if (occasionalTaskId) {
        promises.push(OccasionalTaskService.update(occasionalTaskId, { completed: true }));
      }
      await Promise.all(promises);

      // Notify parents that a task is waiting for their approval.
      sendPushNotification({
        person: '__parents__',
        title: '📸 Tarefa para aprovar',
        body: `${person} fez "${task.task_name}"`,
        url: '/pais',
        tag: `task-submitted-${person}-${task.task_name}-${today}`,
      });

      return { completion_type, value, occasionalTaskId };
    },
    onSuccess: ({ completion_type, value, occasionalTaskId }) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      if (occasionalTaskId) {
        queryClient.invalidateQueries({ queryKey: ['occasionalTasks'] });
        queryClient.invalidateQueries({ queryKey: ['taskDelegations'] });
      }
      retryRef.current = null;
      setStage(null);
      setFailure(null);
      setPhase({ completion_type, value });
    },
    onError: (err) => {
      // Stay on screen with the photo still in hand — restarting the app to
      // try again is exactly what this replaces.
      setStage(null);
      setPhase(null);
      setFailure({
        message: err?.message || 'Não foi possível registar a tarefa.',
        taskName: retryRef.current?.task?.task_name,
      });
    },
  });

  // Auto-dismiss the success screen (same 2.5s as the Registar page).
  useEffect(() => {
    if (!phase || phase === 'saving') return;
    const t = setTimeout(() => setPhase(null), 2500);
    return () => clearTimeout(t);
  }, [phase]);

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file later
    const task = pendingTaskRef.current;
    pendingTaskRef.current = null;
    if (!file || !task) return; // camera cancelled — nothing to do
    retryRef.current = { task, file };
    setFailure(null);
    setPhase('saving');
    createMutation.mutate({ task, file });
  };

  const retry = () => {
    if (!retryRef.current) return;
    setFailure(null);
    setPhase('saving');
    createMutation.mutate(retryRef.current);
  };

  const discard = () => {
    retryRef.current = null;
    setFailure(null);
    setStage(null);
    setPhase(null);
  };

  const success = phase && phase !== 'saving' ? phase : null;

  const savingLabel = stage?.phase === 'compressing'
    ? 'A preparar a foto...'
    : stage && stage.attempt > 1
      ? `Ligação fraca — a tentar de novo (${stage.attempt}/${stage.attempts})`
      : 'A registar a tarefa...';

  // Portaled: see the note in components/layout/Portal.jsx — a fixed overlay
  // rendered inline inside a page gets trapped by transformed ancestors.
  const overlay = (
    <AnimatePresence>
      {failure && (
        <motion.div
          key="capture-failure"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] bg-background flex flex-col items-center justify-center px-6"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center text-center w-full max-w-xs"
          >
            <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <WifiOff className="w-9 h-9 text-destructive" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Não deu para enviar</h2>
            <p className="text-sm text-muted-foreground mt-1.5">{failure.message}</p>
            <p className="text-xs text-muted-foreground mt-3">
              A tua foto não se perdeu{failure.taskName ? ` — "${failure.taskName}"` : ''}. Chega-te ao router ou liga os dados e tenta outra vez.
            </p>

            <button
              onClick={retry}
              className="w-full mt-6 py-3.5 rounded-2xl bg-primary text-primary-foreground font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
            >
              <RefreshCw className="w-4 h-4" />
              Tentar novamente
            </button>
            <button
              onClick={discard}
              className="w-full py-3 mt-2 rounded-2xl bg-muted text-muted-foreground font-medium text-sm"
            >
              Cancelar
            </button>
          </motion.div>
        </motion.div>
      )}

      {phase && (
        <motion.div
          key="capture-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] bg-background flex flex-col items-center justify-center px-4"
        >
          {success ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center justify-center"
            >
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <CheckCircle2 className="w-10 h-10 text-primary" />
              </div>
              <h2 className="text-xl font-bold text-foreground">Tarefa Registada!</h2>
              <p className="text-sm text-muted-foreground mt-1">À espera de aprovação dos pais 📸</p>
              <div className="mt-4 flex items-center gap-2 px-4 py-2 rounded-full bg-muted/60">
                <span className="text-lg">{COMPLETION_TYPES[success.completion_type].emoji}</span>
                <span className={`text-sm font-bold ${COMPLETION_TYPES[success.completion_type].color}`}>
                  +€{success.value.toFixed(2)}
                </span>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="saving"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center"
            >
              <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
              <p className="text-sm text-muted-foreground">{savingLabel}</p>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handlePhotoChange}
        className="hidden"
      />
      <Portal>{overlay}</Portal>
    </>
  );
});

export default TaskCapture;
