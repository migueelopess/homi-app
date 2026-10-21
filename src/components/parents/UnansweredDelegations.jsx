import { useMutation, useQueryClient } from '@tanstack/react-query';
import { HandHelping, Ban, UserCheck, Loader2 } from 'lucide-react';
import { format, parse } from 'date-fns';
import { pt } from 'date-fns/locale';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { TaskCancellationService, TaskDelegationService } from '@/api/entities';
import { sendPushNotification } from '@/api/supabaseClient';
import { INVALIDATE } from '@/lib/queries';
import {
  PERSON_AVATARS, TASK_ICONS, DELEGATION_STATUS, DELEGATION_ACCEPT_WINDOW_LABEL,
  delegationNeedsParents, getLocalDateStr, siblingAnswers,
} from '@/lib/taskHelpers';

// "Pedro recusou · Inês não respondeu", "os irmãos recusaram", "ninguém respondeu".
function answersText(delegation) {
  const { refused, silent } = siblingAnswers(delegation);
  if (silent.length === 0) return 'os irmãos recusaram';
  if (refused.length === 0) return 'ninguém respondeu';
  return `${refused.join(' e ')} recusou · ${silent.join(' e ')} não respondeu`;
}

/**
 * Requests for help that no sibling accepted within the window.
 *
 * The child said they could not do the task and nobody took it over, so the
 * parents decide: either the task is cancelled (no failure for anyone), or the
 * child could have done it after all and it is theirs again — left undone, it
 * becomes an ordinary failure overnight. Only the request's own day is shown
 * (see delegationNeedsParents): one left undecided stays the child's task.
 */
export default function UnansweredDelegations({ delegations = [], tasks = [], deciderId }) {
  const queryClient = useQueryClient();
  const today = getLocalDateStr();

  const waiting = delegations
    .filter(d => delegationNeedsParents(d, tasks))
    .sort((a, b) => (a.task_date + (a.end_time || '')).localeCompare(b.task_date + (b.end_time || '')));

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: INVALIDATE.delegations });
    queryClient.invalidateQueries({ queryKey: INVALIDATE.cancellations });
    queryClient.invalidateQueries({ queryKey: INVALIDATE.tasks });
  };

  const cancelMutation = useMutation({
    mutationFn: async (d) => {
      // Tombstone first: if the second write fails the task is still waived,
      // and retrying just finds the tombstone already there.
      try {
        await TaskCancellationService.create({
          person: d.from_person,
          task_name: d.task_name,
          task_date: d.task_date,
          end_time: d.end_time ?? null,
          cancelled_by: deciderId ?? null,
          scheduled_task_id: d.task_type === 'scheduled' ? d.scheduled_task_id : null,
          occasional_task_id: d.task_type === 'occasional' ? d.occasional_task_id : null,
        });
      } catch (err) {
        if (err?.code !== '23505') throw err; // already cancelled — fine
      }
      const decided = await TaskDelegationService.decide(d.id, DELEGATION_STATUS.PARENT_CANCELLED, deciderId);
      if (decided) {
        sendPushNotification({
          person: d.from_person,
          title: '✅ Tarefa cancelada',
          body: `Os pais cancelaram "${d.task_name}" — não precisas de a fazer.`,
          url: '/',
          tag: `delegation-decided-${d.id}`,
        });
      }
      return decided;
    },
    onSuccess: (decided, d) => {
      refresh();
      toast[decided ? 'success' : 'info'](
        decided ? `"${d.task_name}" cancelada para ${d.from_person}` : 'Este pedido já tinha sido decidido'
      );
    },
    onError: () => toast.error('Erro ao cancelar a tarefa'),
  });

  const rejectMutation = useMutation({
    mutationFn: async (d) => {
      const decided = await TaskDelegationService.decide(d.id, DELEGATION_STATUS.PARENT_REJECTED, deciderId);
      if (decided) {
        sendPushNotification({
          person: d.from_person,
          title: `👀 Tens de fazer: ${d.task_name}`,
          body: d.task_date === today
            ? 'Os pais acham que consegues. Continua na tua lista de hoje.'
            : 'Os pais acham que conseguias — conta como não feita.',
          url: '/',
          tag: `delegation-decided-${d.id}`,
        });
      }
      return decided;
    },
    onSuccess: (decided, d) => {
      refresh();
      toast[decided ? 'success' : 'info'](
        decided ? `${d.from_person} tem de fazer "${d.task_name}"` : 'Este pedido já tinha sido decidido'
      );
    },
    onError: () => toast.error('Erro ao guardar a decisão'),
  });

  if (waiting.length === 0) return null;

  const busy = cancelMutation.isPending || rejectMutation.isPending;

  return (
    <Card className="p-4 border-amber-500/30 bg-amber-500/5">
      <div className="flex items-center gap-2 mb-1">
        <HandHelping className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        <h3 className="text-sm font-bold text-foreground">Pedidos de ajuda sem resposta</h3>
        <span className="ml-auto text-xs font-bold text-amber-700 dark:text-amber-300">{waiting.length}</span>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        Disseram que não conseguiam e nenhum irmão aceitou (recusaram, ou passaram {DELEGATION_ACCEPT_WINDOW_LABEL} sem resposta).
        Cancelas a tarefa, ou tinham de a fazer?
      </p>

      <div className="space-y-2">
        {waiting.map(d => {
          const dayLabel = d.task_date === today
            ? 'hoje'
            : format(parse(d.task_date, 'yyyy-MM-dd', new Date()), "d MMM", { locale: pt });
          const thisOneBusy = busy && (cancelMutation.variables?.id === d.id || rejectMutation.variables?.id === d.id);
          return (
            <div key={d.id} className="rounded-xl bg-card border border-border p-3">
              <div className="flex items-start gap-2.5">
                <span className="text-xl leading-none mt-0.5">{TASK_ICONS[d.task_name] || '✅'}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground leading-snug">
                    {PERSON_AVATARS[d.from_person]} <strong>{d.from_person}</strong> não consegue fazer{' '}
                    <strong>{d.task_name}</strong>
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {dayLabel}{d.end_time ? ` · até às ${d.end_time}` : ''} · {answersText(d)}
                  </p>
                </div>
                {thisOneBusy && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2.5">
                <button
                  disabled={busy}
                  onClick={() => cancelMutation.mutate(d)}
                  className="h-9 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 bg-green-600/15 text-green-700 dark:text-green-400 disabled:opacity-40"
                >
                  <Ban className="w-3.5 h-3.5" />
                  Cancelar tarefa
                </button>
                <button
                  disabled={busy}
                  onClick={() => rejectMutation.mutate(d)}
                  className="h-9 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 bg-red-500/15 text-red-600 dark:text-red-400 disabled:opacity-40"
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  Tinha de a fazer
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
