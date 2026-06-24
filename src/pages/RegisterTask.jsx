import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TaskService } from '@/api/entities';
import { uploadTaskPhoto } from '@/api/storage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { CheckCircle2, Camera, Loader2, Lock } from 'lucide-react';
import { COMPLETION_TYPES, COMMON_TASKS, PERSON_AVATARS, TASK_ICONS, SIDNEY_TASKS, getTaskValue, getWeekKey, getCurrentMonthKey, getLocalDateStr } from '@/lib/taskHelpers';
import { useCurrentUser, isParent } from '@/lib/useCurrentUser';
import TaskGrid from '@/components/register/TaskGrid';

export default function RegisterTask() {
  const queryClient = useQueryClient();
  const { data: user, isLoading: loadingUser } = useCurrentUser();

  const [taskName, setTaskName] = useState('');
  const [customTask, setCustomTask] = useState('');
  const [completionType, setCompletionType] = useState('');
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [success, setSuccess] = useState(false);

  const today = getLocalDateStr();

  // Determine person from logged-in user
  const person = user?.linked_name;
  const userIsParent = isParent(user);

  const createMutation = useMutation({
    mutationFn: async (data) => {
      let photo_url = '';
      if (photo) {
        photo_url = await uploadTaskPhoto(photo);
      }
      return TaskService.create({ ...data, photo_url, month_key: getCurrentMonthKey() });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setTaskName('');
        setCustomTask('');
        setCompletionType('');
        setPhoto(null);
        setPhotoPreview(null);
      }, 2500);
    },
  });

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhoto(file);
      setPhotoPreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = () => {
    const finalTaskName = taskName === 'custom' ? customTask : taskName;
    if (!finalTaskName || !completionType || !photo) {
      if (!photo) toast.error('A foto de prova é obrigatória!');
      if (!finalTaskName || !completionType) toast.error('Preenche todos os campos!');
      return;
    }
    createMutation.mutate({
      person,
      task_name: finalTaskName,
      completion_type: completionType,
      value: getTaskValue(finalTaskName, completionType),
      date: today,
      week_key: getWeekKey(new Date()),
    });
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
            <p className="text-sm text-muted-foreground mt-1">Bom trabalho {PERSON_AVATARS[person]} 💪</p>
          </motion.div>
        ) : (
          <motion.div key="form" className="space-y-5">
            {/* Task Selection Grid */}
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3 block">
                Que tarefa fizeste?
              </Label>
              <TaskGrid selectedTask={taskName} onSelect={setTaskName} />
              {taskName === 'custom' && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-3">
                  <Input
                    placeholder="Escreve a tarefa..."
                    value={customTask}
                    onChange={e => setCustomTask(e.target.value)}
                    className="h-12 rounded-xl"
                  />
                </motion.div>
              )}
            </div>

            {/* Completion Type */}
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2 block">
                Como foi feita?
              </Label>
              <div className="space-y-2">
                {Object.entries(COMPLETION_TYPES).filter(([key]) => key !== 'not_done' && key !== 'cancelled').map(([key, ct]) => {
                  const finalName = taskName === 'custom' ? customTask : taskName;
                  const displayValue = getTaskValue(finalName, key);
                  return (
                    <button
                      key={key}
                      onClick={() => setCompletionType(key)}
                      className={`w-full flex items-center gap-3 p-3.5 rounded-xl border-2 transition-all text-left ${
                        completionType === key
                          ? 'border-primary bg-primary/5'
                          : 'border-border bg-card hover:border-primary/20'
                      }`}
                    >
                      <span className="text-xl">{ct.emoji}</span>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">{ct.label}</p>
                      </div>
                      <span className={`text-sm font-bold ${ct.color}`}>+€{displayValue.toFixed(2)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Photo Upload */}
            <div>
              <Label className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2 block">
                Foto de prova (obrigatória)
              </Label>
              <label className="flex items-center gap-3 p-4 rounded-xl border-2 border-dashed border-border hover:border-primary/30 cursor-pointer transition-colors bg-card">
                <Camera className="w-5 h-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {photoPreview ? 'Foto selecionada ✓' : 'Toca para tirar ou escolher foto'}
                </span>
                <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} className="hidden" />
              </label>
              {photoPreview && (
                <img src={photoPreview} alt="preview" className="mt-2 rounded-xl h-32 w-full object-cover" />
              )}
            </div>

            {/* Submit */}
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || !taskName || !completionType || !photo}
              className="w-full h-14 rounded-2xl text-base font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 disabled:opacity-40"
            >
              {createMutation.isPending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                'Registar Tarefa ✓'
              )}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}