import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { Camera, Loader2, PencilLine } from 'lucide-react';
import { TaskService } from '@/api/entities';
import { uploadTaskPhoto } from '@/api/storage';
import { sendPushNotification } from '@/api/supabaseClient';
import { getTaskIcon } from '@/lib/taskHelpers';

// Shown on the child's Home: tasks a parent bounced back to be corrected.
// Tapping "Corrigir" opens the camera; the new photo re-submits the task.
export default function RevisionTasks({ tasks = [], person }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const pendingIdRef = useRef(null);

  const resubmitMutation = useMutation({
    mutationFn: async ({ id, file, task_name }) => {
      const photo_url = await uploadTaskPhoto(file);
      await TaskService.resubmit(id, photo_url);
      sendPushNotification({
        person: '__parents__',
        title: '🔄 Tarefa corrigida',
        body: `${person} corrigiu "${task_name}" — pronta para aprovar`,
        url: '/pais',
        tag: `resubmit-${id}`,
      });
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['pendingTasks'] });
      toast.success('Corrigida — à espera de aprovação 📸');
    },
    onError: () => toast.error('Não foi possível reenviar. Tenta de novo.'),
  });

  const startCapture = (task) => {
    pendingIdRef.current = task;
    fileInputRef.current?.click();
  };

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const task = pendingIdRef.current;
    pendingIdRef.current = null;
    if (!file || !task) return;
    resubmitMutation.mutate({ id: task.id, file, task_name: task.task_name });
  };

  if (tasks.length === 0) return null;

  return (
    <div className="mb-6">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handlePhotoChange}
        className="hidden"
      />

      <div className="flex items-center gap-2 mb-3">
        <PencilLine className="w-4 h-4 text-orange-500" />
        <h2 className="text-base font-bold text-foreground">Para corrigir</h2>
      </div>

      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {tasks.map(task => {
            const busy = resubmitMutation.isPending && resubmitMutation.variables?.id === task.id;
            return (
              <motion.div
                key={task.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="rounded-2xl border border-orange-500/30 bg-orange-500/5 p-3"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center text-xl shrink-0">
                    {getTaskIcon(task.task_name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-foreground truncate">{task.task_name}</p>
                      <span className="text-sm font-bold text-orange-600 dark:text-orange-400 whitespace-nowrap">
                        €{(task.value || 0).toFixed(2)}
                      </span>
                    </div>
                    {task.revision_note && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        <span className="font-medium text-foreground">Corrige:</span> {task.revision_note}
                      </p>
                    )}
                    <button
                      onClick={() => startCapture(task)}
                      disabled={busy}
                      className="mt-2.5 w-full h-10 rounded-xl bg-orange-500 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-95 transition"
                    >
                      {busy
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> A reenviar...</>
                        : <><Camera className="w-4 h-4" /> Corrigir e reenviar</>}
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
