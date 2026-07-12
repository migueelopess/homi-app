import { useRef, useState } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { TaskService, TaskReminderService } from '@/api/entities';
import { sendPushNotification } from '@/api/supabaseClient';
import { uploadTaskPhoto } from '@/api/storage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { CheckCircle2, Camera, Loader2, Lock, Plus } from 'lucide-react';
import { COMPLETION_TYPES, PERSON_AVATARS, getTaskValue, getWeekKey, getCurrentMonthKey, getLocalDateStr } from '@/lib/taskHelpers';
import { useCurrentUser, isParent } from '@/lib/useCurrentUser';
import TaskGrid from '@/components/register/TaskGrid';

export default function RegisterTask() {
  const queryClient = useQueryClient();
  const { data: user, isLoading: loadingUser } = useCurrentUser();

  const [taskName, setTaskName] = useState('');
  const [customTask, setCustomTask] = useState('');
  const [success, setSuccess] = useState(null); // { name, completion_type } after a successful register
  const fileInputRef = useRef(null);
  const pendingNameRef = useRef(''); // task name awaiting the camera photo

  const today = getLocalDateStr();

  // Determine person from logged-in user
  const person = user?.linked_name;
  const userIsParent = isParent(user);

  // Reminders sent to this person today — used to auto-derive the value.
  const { data: reminders = [] } = useQuery({
    queryKey: ['taskReminders', person, today],
    queryFn: () => TaskReminderService.getByPersonAndDate(person, today),
    enabled: !!person,
  });

  const createMutation = useMutation({
    mutationFn: async ({ name, file }) => {
      const photo_url = await uploadTaskPhoto(file);
      // Auto-derive completion type: these ad-hoc tasks have no time window, so
      // they're always "on time" — reduced only if a parent nagged about it today.
      const hasReminder = reminders.some(r => r.task_name === name);
      const completion_type = hasReminder ? 'on_time_with_reminder' : 'on_time_no_reminder';

      await TaskService.create({
        person,
        task_name: name,
        completion_type,
        value: getTaskValue(name, completion_type),
        date: today,
        end_time: null,
        week_key: getWeekKey(new Date()),
        month_key: getCurrentMonthKey(),
        photo_url,
      });

      // Notify parents that a task is waiting for their approval.
      sendPushNotification({
        person: '__parents__',
        title: '📸 Tarefa para aprovar',
        body: `${person} fez "${name}"`,
        url: '/pais',
        tag: `task-submitted-${person}-${name}-${today}`,
      });

      return { name, completion_type };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setTaskName('');
      setCustomTask('');
      pendingNameRef.current = '';
      setSuccess(result);
      setTimeout(() => setSuccess(null), 2500);
    },
    onError: () => {
      pendingNameRef.current = '';
      setTaskName('');
      toast.error('Não foi possível registar a tarefa. Tenta de novo.');
    },
  });

  // Open the OS camera for the given task name. Must run inside the tap handler
  // so the browser treats it as a user gesture.
  const startCapture = (name) => {
    if (!name) return;
    pendingNameRef.current = name;
    fileInputRef.current?.click();
  };

  const handleSelect = (name) => {
    if (!name) { setTaskName(''); return; }        // deselect
    if (name === 'custom') { setTaskName('custom'); return; } // show the name input first
    setTaskName(name);
    startCapture(name);
  };

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file later
    const name = pendingNameRef.current;
    if (!file || !name) {
      // Camera cancelled — clear the selection.
      pendingNameRef.current = '';
      setTaskName('');
      return;
    }
    createMutation.mutate({ name, file });
  };

  if (loadingUser) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  // Parents can't register tasks
  if (userIsParent) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-16 flex flex-col items-center text-center">
        <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-4">
          <Lock className="w-9 h-9 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2">Área dos Filhos</h2>
        <p className="text-sm text-muted-foreground">Os pais não registam tarefas.<br />Usa o painel para ver os relatórios.</p>
      </div>
    );
  }

  // Child without linked_name configured
  if (!person) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-16 flex flex-col items-center text-center">
        <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-4 text-4xl">⚙️</div>
        <h2 className="text-xl font-bold text-foreground mb-2">Conta não configurada</h2>
        <p className="text-sm text-muted-foreground">Pede a um pai para ligar esta conta ao teu nome no painel de utilizadores.</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-6 pb-4">
      {/* Hidden camera input, triggered when a task is tapped */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handlePhotoChange}
        className="hidden"
      />

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        {/* Header with current user */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-2xl">
            {PERSON_AVATARS[person]}
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Registar Tarefa</h1>
            <p className="text-sm text-muted-foreground">Olá, <span className="font-semibold text-primary">{person}</span>! 👋</p>
          </div>
        </div>
      </motion.div>

      <AnimatePresence mode="wait">
        {success ? (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="flex flex-col items-center justify-center py-20"
          >
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-10 h-10 text-primary" />
            </div>
            <h2 className="text-xl font-bold text-foreground">Tarefa Registada!</h2>
            <p className="text-sm text-muted-foreground mt-1">À espera de aprovação dos pais 📸</p>
            <div className="mt-4 flex items-center gap-2 px-4 py-2 rounded-full bg-muted/60">
              <span className="text-lg">{COMPLETION_TYPES[success.completion_type].emoji}</span>
              <span className={`text-sm font-bold ${COMPLETION_TYPES[success.completion_type].color}`}>
                +€{getTaskValue(success.name, success.completion_type).toFixed(2)}
              </span>
            </div>
          </motion.div>
        ) : createMutation.isPending ? (
          <motion.div
            key="saving"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-20"
          >
            <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
            <p className="text-sm text-muted-foreground">A registar a tarefa...</p>
          </motion.div>
        ) : (
          <motion.div key="form" className="space-y-5">
            {/* Task Selection Grid — tapping a task opens the camera immediately */}
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1 block">
                Que tarefa fizeste?
              </Label>
              <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
                <Camera className="w-3.5 h-3.5" /> Toca numa tarefa para tirar a foto de prova e registar.
              </p>
              <TaskGrid selectedTask={taskName} onSelect={handleSelect} />

              {/* Clean custom-task button below the whole grid */}
              <button
                onClick={() => setTaskName(taskName === 'custom' ? '' : 'custom')}
                className={`w-full mt-2.5 flex items-center justify-center gap-2 h-12 rounded-2xl border border-dashed text-sm font-semibold transition-colors ${
                  taskName === 'custom'
                    ? 'border-primary/50 text-primary bg-primary/5'
                    : 'border-border text-muted-foreground hover:border-primary/40 hover:text-primary'
                }`}
              >
                <Plus className="w-4 h-4" /> Adicionar tarefa personalizada
              </button>

              {taskName === 'custom' && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-3 space-y-2">
                  <Input
                    placeholder="Escreve a tarefa..."
                    value={customTask}
                    onChange={e => setCustomTask(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && customTask.trim()) startCapture(customTask.trim()); }}
                    className="h-12 rounded-xl"
                    autoFocus
                  />
                  <Button
                    onClick={() => startCapture(customTask.trim())}
                    disabled={!customTask.trim()}
                    className="w-full h-12 rounded-xl text-sm font-bold bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-40"
                  >
                    <Camera className="w-4 h-4 mr-2" /> Tirar foto e registar
                  </Button>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
