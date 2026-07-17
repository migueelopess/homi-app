import { forwardRef, useImperativeHandle, useRef } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { TaskService, TaskReminderService, OccasionalTaskService } from '@/api/entities';
import { sendPushNotification } from '@/api/supabaseClient';
import { uploadTaskPhoto } from '@/api/storage';
import { SIDNEY_TASKS, getTaskValue, getWeekKey, getCurrentMonthKey, getLocalDateStr, sameTaskSlot } from '@/lib/taskHelpers';
import { toast } from 'sonner';

function isWithinTimeWindow(endTime) {
  if (!endTime) return true;
  const now = new Date();
  const [eh, em] = endTime.split(':').map(Number);
  const end = new Date();
  end.setHours(eh, em, 0);
  return now <= end;
}

// Value of a completed task: Sidney tasks earn €0; occasional tasks carry a
// custom reward (halved with a reminder, quartered when late); everything else
// uses the standard scale (with fixed-value overrides like Fatura IQA).
function taskValue(task, completionType) {
  if (SIDNEY_TASKS.includes(task.task_name)) return 0;
  const isOccasional = task._occasional || task._type === 'occasional';
  const reward = isOccasional && task.reward != null ? Number(task.reward) : null;
  if (reward != null) {
    if (completionType === 'on_time_no_reminder') return reward;
    if (completionType === 'on_time_with_reminder') return Math.round(reward * 50) / 100;
    if (completionType === 'late') return Math.round(reward * 25) / 100;
    return 0;
  }
  return getTaskValue(task.task_name, completionType);
}

// One-tap task completion: `capture(task)` opens the OS camera straight from
// the tap, and the photo submits the task immediately — same flow as the
// Registar page. No modal, no confirm button; feedback happens via toasts.
const TaskCapture = forwardRef(function TaskCapture({ person }, ref) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const pendingTaskRef = useRef(null);
  const busyRef = useRef(false);
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
      if (!task || busyRef.current) return;
      pendingTaskRef.current = task;
      fileInputRef.current?.click();
    },
  }));

  const createMutation = useMutation({
    mutationFn: async ({ task, file }) => {
      const photo_url = await uploadTaskPhoto(file);

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

      return { task, value, occasionalTaskId };
    },
    onSuccess: ({ task, value, occasionalTaskId }) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      if (occasionalTaskId) {
        queryClient.invalidateQueries({ queryKey: ['occasionalTasks'] });
        queryClient.invalidateQueries({ queryKey: ['taskDelegations'] });
      }
      toast.success(`"${task.task_name}" enviada — à espera de aprovação 📸 (+€${value.toFixed(2)})`, {
        id: 'task-capture',
        duration: 3500,
      });
    },
    onError: () => {
      toast.error('Não foi possível registar a tarefa. Tenta de novo.', { id: 'task-capture' });
    },
    onSettled: () => {
      busyRef.current = false;
    },
  });

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file later
    const task = pendingTaskRef.current;
    pendingTaskRef.current = null;
    if (!file || !task) return; // camera cancelled — nothing to do
    busyRef.current = true;
    toast.loading(`A registar "${task.task_name}"...`, { id: 'task-capture' });
    createMutation.mutate({ task, file });
  };

  return (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      capture="environment"
      onChange={handlePhotoChange}
      className="hidden"
    />
  );
});

export default TaskCapture;
