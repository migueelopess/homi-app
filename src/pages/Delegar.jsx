import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TaskDelegationService } from '@/api/entities';
import { sendPushNotification } from '@/api/supabaseClient';
import { useCurrentUser, isParent } from '@/lib/useCurrentUser';
import { PERSON_AVATARS, TASK_ICONS, getLocalDateStr } from '@/lib/taskHelpers';
import { Lock, Handshake, Clock, Inbox, Send, CheckCircle2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { PageSkeleton } from '@/components/layout/PageSkeleton';

export default function Delegar() {
  const { data: user, isLoading: loadingUser } = useCurrentUser();
  const queryClient = useQueryClient();
  const userIsParent = isParent(user);
  const person = user?.linked_name;
  const today = getLocalDateStr();

  const { data: delegations = [], isLoading: loadingDelegations } = useQuery({
    queryKey: ['taskDelegations'],
    queryFn: () => TaskDelegationService.list('-created_at'),
    enabled: !!person,
  });

  const acceptMutation = useMutation({
    mutationFn: ({ id, fromPerson, taskName }) =>
      TaskDelegationService.accept(id, person),
    onSuccess: (data, { fromPerson, taskName }) => {
      queryClient.invalidateQueries({ queryKey: ['taskDelegations'] });
      toast.success(`Aceitaste a tarefa "${taskName}"!`);
      // Notify the person who delegated
      sendPushNotification({
        person: fromPerson,
        title: '✅ Tarefa aceite!',
        body: `${person} aceitou fazer: ${taskName}`,
        url: '/delegar',
        tag: `delegation-accepted-${data.id}`,
      });
    },
    onError: (err) => {
      if (err?.code === 'PGRST116') {
        toast.error('Este pedido já foi aceite por outra pessoa.');
      } else {
        toast.error('Erro ao aceitar o pedido.');
      }
      queryClient.invalidateQueries({ queryKey: ['taskDelegations'] });
    },
  });

  if (loadingUser || loadingDelegations) {
    return <PageSkeleton />;
  }

  if (userIsParent || !person) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-16 flex flex-col items-center text-center">
        <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-4">
          <Lock className="w-9 h-9 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2">Área dos Filhos</h2>
        <p className="text-sm text-muted-foreground">Esta página é apenas para os filhos.</p>
      </div>
    );
  }

  // Incoming requests: pending delegations from siblings (not from me)
  const incomingRequests = delegations.filter(
    d => d.status === 'pending' && d.from_person !== person && d.task_date >= today
  );

  // My outgoing requests (today and recent)
  const myRequests = delegations.filter(
    d => d.from_person === person && d.task_date >= today
  );

  // Tasks I accepted
  const acceptedByMe = delegations.filter(
    d => d.to_person === person && d.status === 'accepted' && d.task_date >= today
  );

  return (
    <div className="max-w-lg mx-auto px-4 pt-6 pb-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <div className="flex items-center gap-2 mb-1">
          <Handshake className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Delegar</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-6">Pede ajuda aos teus irmãos ou aceita os pedidos deles</p>
      </motion.div>

      {/* Incoming requests */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <Inbox className="w-4 h-4 text-primary" />
          <h2 className="text-base font-bold text-foreground">Pedidos recebidos</h2>
          {incomingRequests.length > 0 && (
            <Badge className="bg-primary/15 text-primary border-0 text-xs ml-auto">
              {incomingRequests.length}
            </Badge>
          )}
        </div>

        {incomingRequests.length === 0 ? (
          <Card className="p-6 text-center">
            <p className="text-sm text-muted-foreground">Nenhum pedido de ajuda pendente 🎉</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {incomingRequests.map((d, i) => (
              <motion.div
                key={d.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <Card className="p-3 border-primary/20 bg-primary/5">
                  <div className="flex items-center gap-3">
                    <span className="text-xl flex-shrink-0">{TASK_ICONS[d.task_name] || '✅'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground">{d.task_name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">
                          {PERSON_AVATARS[d.from_person]} {d.from_person} precisa de ajuda
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {d.end_time && (
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3 text-muted-foreground" />
                            <span className="text-[11px] text-muted-foreground">Até às {d.end_time}</span>
                          </div>
                        )}
                        {d.task_type === 'occasional' && d.reward > 0 && (
                          <span className="text-[11px] text-primary font-medium">+€{Number(d.reward).toFixed(2)}</span>
                        )}
                      </div>
                    </div>
                    <button
                      disabled={acceptMutation.isPending}
                      onClick={() => acceptMutation.mutate({
                        id: d.id,
                        fromPerson: d.from_person,
                        taskName: d.task_name,
                      })}
                      className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold flex-shrink-0 disabled:opacity-50"
                    >
                      Aceitar
                    </button>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Tasks I accepted from others */}
      {acceptedByMe.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <h2 className="text-base font-bold text-foreground">Tarefas que aceitei</h2>
          </div>
          <div className="space-y-2">
            {acceptedByMe.map((d, i) => (
              <motion.div
                key={d.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <Card className="p-3 border-green-500/20 bg-green-500/5">
                  <div className="flex items-center gap-3">
                    <span className="text-xl flex-shrink-0">{TASK_ICONS[d.task_name] || '✅'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground">{d.task_name}</p>
                      <span className="text-xs text-muted-foreground">
                        📥 Delegada por {PERSON_AVATARS[d.from_person]} {d.from_person}
                      </span>
                      {d.end_time && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3 text-muted-foreground" />
                          <span className="text-[11px] text-muted-foreground">Até às {d.end_time}</span>
                        </div>
                      )}
                    </div>
                    <Badge className="bg-green-500/15 text-green-600 border-0 text-[10px]">Aceite</Badge>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* My outgoing requests */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <Send className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-base font-bold text-foreground">Meus pedidos</h2>
        </div>

        {myRequests.length === 0 ? (
          <Card className="p-6 text-center">
            <p className="text-sm text-muted-foreground">Ainda não delegaste nenhuma tarefa</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {myRequests.map((d, i) => (
              <motion.div
                key={d.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <Card className={`p-3 ${d.status === 'accepted' ? 'border-green-500/20 bg-green-500/5' : ''}`}>
                  <div className="flex items-center gap-3">
                    <span className="text-xl flex-shrink-0">{TASK_ICONS[d.task_name] || '✅'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground">{d.task_name}</p>
                      {d.end_time && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3 text-muted-foreground" />
                          <span className="text-[11px] text-muted-foreground">Até às {d.end_time}</span>
                        </div>
                      )}
                    </div>
                    {d.status === 'pending' ? (
                      <Badge variant="outline" className="text-[10px]">Pendente ⏳</Badge>
                    ) : d.status === 'accepted' ? (
                      <Badge className="bg-green-500/15 text-green-600 border-0 text-[10px]">
                        {PERSON_AVATARS[d.to_person]} {d.to_person} ✅
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">Expirado</Badge>
                    )}
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
