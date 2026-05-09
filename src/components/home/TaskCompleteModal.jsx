import { useState, useRef, useEffect } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { TaskService, TaskReminderService, OccasionalTaskService } from '@/api/entities';
import { sendPushNotification } from '@/api/supabaseClient';
import { uploadTaskPhoto } from '@/api/storage';
import { COMPLETION_TYPES, SIDNEY_TASKS, getWeekKey, getCurrentMonthKey, TASK_ICONS, PERSON_AVATARS, getLocalDateStr } from '@/lib/taskHelpers';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Camera, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

function isWithinTimeWindow(startTime, endTime) {
  if (!endTime) return true;
  const now = new Date();
  const [eh, em] = endTime.split(':').map(Number);
  const end = new Date(); end.setHours(eh, em, 0);
  return now <= end;
}

export default function TaskCompleteModal({ task, person, isExtended = false, occasionalTaskId, onClose }) {
  const queryClient = useQueryClient();
  const today = getLocalDateStr();
  // If parent extended this task, treat it as still within time window
  const inTime = isExtended || isWithinTimeWindow(task?.start_time, task?.end_time);
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const fileInputRef = useRef(null);

  // Check if a parent sent a reminder for this task today
  const { data: reminders = [] } = useQuery({
    queryKey: ['taskReminders', person, today],
    queryFn: () => TaskReminderService.getByPersonAndDate(person, today),
    enabled: !!task && !!person,
  });

  const hasReminder = task
    ? reminders.some(r => r.task_name === task.task_name)
    : false;

  // Delegation info
  const isDelegated = task?._delegated;
  const delegatedFrom = task?._from;

  // Determine value for occasional tasks with custom reward
  const isOccasional = task?._occasional || task?._type === 'occasional';
  const occasionalReward = isOccasional && task?.reward != null ? Number(task.reward) : null;

  // Build completion type overrides for occasional tasks with reminders
  const isSidney = SIDNEY_TASKS.includes(task?.task_name);

  const getDisplayValue = (key) => {
    if (isSidney) return 0;
    if (occasionalReward != null) {
      if (key === 'on_time_no_reminder') return occasionalReward;
      if (key === 'on_time_with_reminder') return Math.round(occasionalReward * 50) / 100;
      if (key === 'late') return Math.round(occasionalReward * 25) / 100;
    }
    return COMPLETION_TYPES[key].value;
  };

  const getActualValue = (key) => {
    return getDisplayValue(key);
  };

  const createMutation = useMutation({
    mutationFn: async (completionType) => {
      let photo_url = '';
      if (photo) {
        photo_url = await uploadTaskPhoto(photo);
      }
      const promises = [
        TaskService.create({
          person,
          task_name: task.task_name,
          completion_type: completionType,
          value: getActualValue(completionType),
          date: today,
          week_key: getWeekKey(new Date()),
          month_key: getCurrentMonthKey(),
          photo_url,
        }),
      ];
      if (occasionalTaskId) {
        promises.push(OccasionalTaskService.update(occasionalTaskId, { completed: true }));
      }
      const result = await Promise.all(promises);

      // Notify parents that the child submitted a task (awaiting their approval).
      sendPushNotification({
        person: '__parents__',
        title: '📸 Tarefa para aprovar',
        body: `${person} fez "${task.task_name}"`,
        url: '/pais',
        tag: `task-submitted-${person}-${task.task_name}-${today}`,
      });

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      if (occasionalTaskId) {
        queryClient.invalidateQueries({ queryKey: ['occasionalTasks'] });
        queryClient.invalidateQueries({ queryKey: ['taskDelegations'] });
      }
      toast.success('Tarefa enviada — à espera de aprovação 📸');
      handleClose();
    },
  });

  const handleClose = () => {
    setPhoto(null);
    setPhotoPreview(null);
    onClose();
  };

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhoto(file);
      setPhotoPreview(URL.createObjectURL(file));
    }
  };

  const completionType = hasReminder
    ? (inTime ? 'on_time_with_reminder' : 'late')
    : (inTime ? 'on_time_no_reminder' : 'late');
  const completionMeta = COMPLETION_TYPES[completionType];
  const completionValue = getDisplayValue(completionType);

  // Auto-open the camera the first time the modal renders for a task
  useEffect(() => {
    if (!task) return;
    if (photoPreview) return;
    const t = setTimeout(() => fileInputRef.current?.click(), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.task_name, task?.id]);

  return (
    <AnimatePresence>
      {task && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-40"
            onClick={handleClose}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-card rounded-t-3xl p-6 pb-24 shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-start justify-between mb-5">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{TASK_ICONS[task.task_name] || '✅'}</span>
                <div>
                  <h3 className="font-bold text-lg text-foreground">{task.task_name}</h3>
                  {task.end_time && (
                    <p className="text-xs text-muted-foreground">Até às {task.end_time}</p>
                  )}
                  {task.notes && (
                    <p className="text-xs text-muted-foreground mt-0.5">{task.notes}</p>
                  )}
                </div>
              </div>
              <button onClick={handleClose} className="p-1 rounded-full hover:bg-muted">
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>

            {!inTime && !isExtended && task.end_time && (
              <div className="bg-destructive/10 rounded-xl p-3 mb-4 text-sm text-destructive text-center font-medium">
                ⚠️ Fora do horário — será registado como atrasado
              </div>
            )}

            {isExtended && (
              <div className="bg-amber-500/10 rounded-xl p-3 mb-4 text-sm text-amber-600 text-center font-medium">
                ⏰ Os teus pais deram-te mais tempo para esta tarefa!
              </div>
            )}

            {hasReminder && (
              <div className="bg-amber-500/10 rounded-xl p-3 mb-4 text-sm text-amber-600 text-center font-medium">
                🔔 Recebeste um lembrete dos pais — o valor desta tarefa é reduzido
              </div>
            )}

            {isDelegated && (
              <div className="bg-blue-500/10 rounded-xl p-3 mb-4 text-sm text-blue-600 text-center font-medium">
                📥 Tarefa delegada por {PERSON_AVATARS[delegatedFrom]} {delegatedFrom} — a recompensa é tua!
              </div>
            )}

            {/* Auto-derived completion type — single tap flow */}
            <div className="flex items-center gap-3 p-3 rounded-2xl border border-border bg-muted/40 mb-4">
              <span className="text-2xl">{completionMeta.emoji}</span>
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">Vai ser registado como</p>
                <p className="font-semibold text-sm text-foreground">{completionMeta.label}</p>
              </div>
              <span className={`text-sm font-bold ${completionMeta.color}`}>+€{completionValue.toFixed(2)}</span>
            </div>

            <p className="text-sm font-semibold text-foreground mb-1">📸 Foto de prova obrigatória</p>
            <p className="text-xs text-muted-foreground mb-4">Tira uma foto a comprovar que fizeste a tarefa.</p>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoChange}
              className="hidden"
            />

            {photoPreview ? (
              <div className="mb-4">
                <img src={photoPreview} alt="preview" className="w-full rounded-2xl object-cover max-h-52" />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-2 w-full py-2 rounded-xl border border-border text-xs text-muted-foreground hover:bg-muted transition-colors"
                >
                  Tirar outra foto
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex flex-col items-center gap-3 p-8 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 mb-4"
              >
                <Camera className="w-8 h-8 text-primary" />
                <span className="text-sm font-medium text-primary">Toca para abrir a câmara</span>
              </button>
            )}

            <button
              disabled={!photo || createMutation.isPending}
              onClick={() => createMutation.mutate(completionType)}
              className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {createMutation.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> A guardar...</>
              ) : (
                '✅ Confirmar Tarefa'
              )}
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}