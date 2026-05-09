import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { CheckCheck, Loader2 } from 'lucide-react';
import { TaskService } from '@/api/entities';
import { sendPushNotification } from '@/api/supabaseClient';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PEOPLE, PERSON_AVATARS } from '@/lib/taskHelpers';
import PhotoModal from '@/components/parents/PhotoModal';
import ApprovalCard from '@/components/parents/ApprovalCard';
import { toast } from 'sonner';

export default function ApprovalsTab({ approverId }) {
  const queryClient = useQueryClient();
  const [photoUrl, setPhotoUrl] = useState(null);
  const [pendingIds, setPendingIds] = useState(new Set());

  const { data: pending = [], isLoading } = useQuery({
    queryKey: ['pendingTasks'],
    queryFn: () => TaskService.listPending(),
  });

  const setIdPending = (id, on) => {
    setPendingIds(prev => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['pendingTasks'] });
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
  };

  const approveMutation = useMutation({
    mutationFn: async (task) => {
      setIdPending(task.id, true);
      const result = await TaskService.approve(task.id, approverId);
      sendPushNotification({
        person: task.person,
        title: '✅ Tarefa aprovada',
        body: `${task.task_name} (+€${(task.value || 0).toFixed(2)})`,
        url: '/',
        tag: `approved-${task.id}`,
      });
      return result;
    },
    onSettled: (_data, _err, task) => setIdPending(task.id, false),
    onSuccess: () => {
      invalidate();
      toast.success('Aprovada');
    },
    onError: () => toast.error('Erro a aprovar'),
  });

  const rejectMutation = useMutation({
    mutationFn: async (task) => {
      setIdPending(task.id, true);
      const result = await TaskService.reject(task.id, approverId);
      sendPushNotification({
        person: task.person,
        title: '❌ Tarefa rejeitada',
        body: `${task.task_name} — não conta para esta semana`,
        url: '/',
        tag: `rejected-${task.id}`,
      });
      return result;
    },
    onSettled: (_data, _err, task) => setIdPending(task.id, false),
    onSuccess: () => {
      invalidate();
      toast.success('Rejeitada');
    },
    onError: () => toast.error('Erro a rejeitar'),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: async ({ person, tasks }) => {
      const ids = tasks.map(t => t.id);
      ids.forEach(id => setIdPending(id, true));
      try {
        await TaskService.bulkApprove(ids, approverId);
        const total = tasks.reduce((s, t) => s + (t.value || 0), 0);
        sendPushNotification({
          person,
          title: '✅ Tarefas aprovadas',
          body: `${tasks.length} ${tasks.length === 1 ? 'tarefa aprovada' : 'tarefas aprovadas'} (+€${total.toFixed(2)})`,
          url: '/',
          tag: `bulk-approved-${person}-${Date.now()}`,
        });
      } finally {
        ids.forEach(id => setIdPending(id, false));
      }
    },
    onSuccess: (_data, vars) => {
      invalidate();
      toast.success(`${vars.tasks.length} tarefas aprovadas`);
    },
    onError: () => toast.error('Erro a aprovar todas'),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const byPerson = PEOPLE
    .map(person => ({ person, tasks: pending.filter(t => t.person === person) }))
    .filter(group => group.tasks.length > 0);

  if (byPerson.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-3xl mb-2">🎉</p>
        <p className="font-semibold text-foreground">Nada por aprovar</p>
        <p className="text-xs text-muted-foreground mt-1">
          Todas as fotos foram revistas. Bom trabalho!
        </p>
      </Card>
    );
  }

  const total = pending.length;

  return (
    <>
      <div className="space-y-4">
        <Card className="p-3 bg-amber-500/10 border-amber-500/30">
          <p className="text-sm font-semibold text-foreground">
            📋 {total} {total === 1 ? 'tarefa por aprovar' : 'tarefas por aprovar'}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Toca na foto para a ver em grande. Rejeitar fica em €0 e não pode ser revertido.
          </p>
        </Card>

        {byPerson.map(({ person, tasks }) => {
          const allPending = tasks.every(t => pendingIds.has(t.id));
          return (
            <div key={person} className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{PERSON_AVATARS[person]}</span>
                  <span className="font-bold text-foreground">{person}</span>
                  <Badge className="bg-muted text-muted-foreground text-[10px] border-0">
                    {tasks.length}
                  </Badge>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={allPending || bulkApproveMutation.isPending}
                  onClick={() => bulkApproveMutation.mutate({ person, tasks })}
                  className="h-8 gap-1 text-xs"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  Aprovar todas
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <AnimatePresence>
                  {tasks.map(task => (
                    <ApprovalCard
                      key={task.id}
                      task={task}
                      isPending={pendingIds.has(task.id)}
                      onApprove={(t) => approveMutation.mutate(t)}
                      onReject={(t) => rejectMutation.mutate(t)}
                      onPhotoClick={setPhotoUrl}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </div>
          );
        })}
      </div>

      <PhotoModal url={photoUrl} onClose={() => setPhotoUrl(null)} />
    </>
  );
}
