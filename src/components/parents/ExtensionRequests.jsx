import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Hourglass, Check, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { ExtensionRequestService, TaskExtensionService, TaskReminderService, TaskService } from '@/api/entities';
import { sendPushNotification } from '@/api/supabaseClient';
import { INVALIDATE } from '@/lib/queries';
import {
  PERSON_AVATARS, TASK_ICONS, EXTENSION_REQUEST_STATUS,
  pendingExtensionRequests, extensionRequestOrdinal, untilLabel, correctedForExtension, completionValue,
  sameTaskSlot, settlesSlot, scheduledOccurrence, occasionalOccurrence,
} from '@/lib/taskHelpers';

// The occurrence a request is about, to find a row already submitted for it.
const occurrenceOfRequest = (r) => r.task_type === 'occasional'
  ? occasionalOccurrence({ id: r.occasional_task_id, task_name: r.task_name, end_time: r.end_time })
  : scheduledOccurrence({ id: r.scheduled_task_id, task_name: r.task_name, end_time: r.end_time });

/**
 * Requests for more time, waiting for a parent.
 *
 * A child asked — before or after the deadline — for a new time on one of
 * today's tasks. Granting writes the extension (the new deadline for that
 * day); refusing leaves the original one. If the child already sent the photo
 * while waiting and it was filed as late, granting corrects it to on time:
 * they asked in time, the answer just came later.
 */
export default function ExtensionRequests({ requests = [], tasks = [], deciderId }) {
  const queryClient = useQueryClient();
  const waiting = pendingExtensionRequests(requests)
    .sort((a, b) => (a.end_time || '').localeCompare(b.end_time || ''));

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: INVALIDATE.extensionRequests });
    queryClient.invalidateQueries({ queryKey: INVALIDATE.extensions });
    queryClient.invalidateQueries({ queryKey: INVALIDATE.tasks });
    queryClient.invalidateQueries({ queryKey: INVALIDATE.pendingTasks });
  };

  const grantMutation = useMutation({
    mutationFn: async (r) => {
      // Extension first: if the second write fails the time is still given,
      // and answering again just finds it there.
      try {
        await TaskExtensionService.create({
          person: r.person,
          task_name: r.task_name,
          task_date: r.task_date,
          end_time: r.end_time ?? null,
          until_time: r.until_time ?? null,
          with_reminder: false,
          granted_by: deciderId ?? null,
        });
      } catch (err) {
        if (err?.code !== '23505') throw err; // more time already given — fine
      }
      const decided = await ExtensionRequestService.decide(r.id, EXTENSION_REQUEST_STATUS.GRANTED, deciderId);
      if (!decided) return { decided: null, corrected: 0 };

      // Already submitted as late while the request was waiting?
      let corrected = 0;
      const occurrence = occurrenceOfRequest(r);
      const late = tasks.filter(t =>
        t.person === r.person && t.date === r.task_date && t.completion_type === 'late' && settlesSlot(t, occurrence));
      if (late.length) {
        const reminders = await TaskReminderService.getByDate(r.task_date);
        const hasReminder = (reminders ?? []).some(rem =>
          rem.person === r.person && rem.task_name === r.task_name && sameTaskSlot(rem.end_time, r.end_time));
        for (const row of late) {
          const completionType = correctedForExtension(row, r.until_time, hasReminder);
          if (!completionType) continue;
          const updated = await TaskService.reclassifyLate(row, completionType,
            completionValue({ taskName: r.task_name, completionType, reward: r.reward }));
          if (updated) corrected++;
        }
      }

      sendPushNotification({
        person: r.person,
        title: `✅ Mais tempo: ${r.task_name}`,
        body: corrected
          ? 'Os pais deram-te mais tempo — a tarefa que já fizeste passou a contar como a tempo.'
          : `Os pais deram-te mais tempo: tens ${untilLabel(r.until_time)}.`,
        url: '/',
        tag: `extension-decided-${r.id}`,
      });
      return { decided, corrected };
    },
    onSuccess: ({ decided, corrected }, r) => {
      refresh();
      if (!decided) return toast.info('Este pedido já tinha sido respondido');
      toast.success(`Mais tempo dado a ${r.person} ${untilLabel(r.until_time)}${corrected ? ' (tarefa corrigida para a tempo)' : ''}`);
    },
    onError: () => toast.error('Erro ao dar mais tempo'),
  });

  const refuseMutation = useMutation({
    mutationFn: async (r) => {
      const decided = await ExtensionRequestService.decide(r.id, EXTENSION_REQUEST_STATUS.REFUSED, deciderId);
      if (decided) {
        sendPushNotification({
          person: r.person,
          title: `❌ Sem mais tempo: ${r.task_name}`,
          body: `Os pais disseram que não — o prazo continua a ser às ${r.end_time}.`,
          url: '/',
          tag: `extension-decided-${r.id}`,
        });
      }
      return decided;
    },
    onSuccess: (decided, r) => {
      refresh();
      toast[decided ? 'success' : 'info'](decided ? `Pedido de ${r.person} recusado` : 'Este pedido já tinha sido respondido');
    },
    onError: () => toast.error('Erro ao guardar a decisão'),
  });

  if (waiting.length === 0) return null;

  const busy = grantMutation.isPending || refuseMutation.isPending;

  return (
    <Card className="p-4 border-amber-500/30 bg-amber-500/5">
      <div className="flex items-center gap-2 mb-1">
        <Hourglass className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        <h3 className="text-sm font-bold text-foreground">Pedidos de mais tempo</h3>
        <span className="ml-auto text-xs font-bold text-amber-700 dark:text-amber-300">{waiting.length}</span>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        Se deres, feita até à nova hora conta como a tempo. Se não for feita hoje, continua a ser falha.
      </p>

      <div className="space-y-2">
        {waiting.map(r => {
          const nth = extensionRequestOrdinal(requests, r);
          const thisOneBusy = busy && (grantMutation.variables?.id === r.id || refuseMutation.variables?.id === r.id);
          return (
            <div key={r.id} className="rounded-xl bg-card border border-border p-3">
              <div className="flex items-start gap-2.5">
                <span className="text-xl leading-none mt-0.5">{TASK_ICONS[r.task_name] || '✅'}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground leading-snug">
                    {PERSON_AVATARS[r.person]} <strong>{r.person}</strong> pede mais tempo para{' '}
                    <strong>{r.task_name}</strong>
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {r.end_time} → <strong className="text-foreground">{r.until_time ?? 'fim do dia'}</strong>
                    {nth > 1 && <> · <span className="text-amber-700 dark:text-amber-300 font-semibold">{nth}.º pedido esta semana</span></>}
                  </p>
                  {r.reason && <p className="text-xs text-foreground/80 mt-1 italic">“{r.reason}”</p>}
                </div>
                {thisOneBusy && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2.5">
                <button
                  disabled={busy}
                  onClick={() => grantMutation.mutate(r)}
                  className="h-9 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 bg-green-600/15 text-green-700 dark:text-green-400 disabled:opacity-40"
                >
                  <Check className="w-3.5 h-3.5" />
                  Dar
                </button>
                <button
                  disabled={busy}
                  onClick={() => refuseMutation.mutate(r)}
                  className="h-9 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 bg-red-500/15 text-red-600 dark:text-red-400 disabled:opacity-40"
                >
                  <X className="w-3.5 h-3.5" />
                  Recusar
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
