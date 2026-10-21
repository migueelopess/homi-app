import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TaskDelegationService } from '@/api/entities';
import { tasksQuery, cancellationsQuery, delegationsQuery, INVALIDATE } from '@/lib/queries';
import { sendPushNotification } from '@/api/supabaseClient';
import { useCurrentUser, isParent } from '@/lib/useCurrentUser';
import {
  PERSON_AVATARS, TASK_ICONS, SIDNEY_TASKS, getLocalDateStr,
  getAcceptBlock, getDelegationReward, isDelegationOfferedTo, hasRefused, parentsNotified,
  minutesUntilParentsNotice, refusedBy, DELEGATION_STATUS,
  DELEGATION_CHAMPION_BONUS, BROKEN_DELEGATION_WEIGHT,
} from '@/lib/taskHelpers';
import { Lock, Handshake, Clock, Inbox, Send, CheckCircle2, Trophy, ShieldAlert, AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { PageSkeleton } from '@/components/layout/PageSkeleton';
import Portal from '@/components/layout/Portal';
import DelegationRanking from '@/components/delegations/DelegationRanking';

// Where one of my own requests stands, in the child's words.
function MyRequestStatus({ delegation: d }) {
  switch (d.status) {
    case DELEGATION_STATUS.PENDING:
      return parentsNotified(d) ? (
        <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-0 text-[10px] text-right">Ninguém aceitou ainda · pais avisados</Badge>
      ) : (
        <Badge variant="outline" className="text-[10px] whitespace-nowrap">⏳ À espera</Badge>
      );
    case DELEGATION_STATUS.ACCEPTED:
      return (
        <Badge className="bg-green-500/15 text-green-600 border-0 text-[10px] whitespace-nowrap">
          {PERSON_AVATARS[d.to_person]} {d.to_person} ✅
        </Badge>
      );
    case DELEGATION_STATUS.UNANSWERED:
      return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-0 text-[10px] text-right">Ninguém aceitou · pais a decidir</Badge>;
    case DELEGATION_STATUS.PARENT_CANCELLED:
      return <Badge className="bg-green-500/15 text-green-600 border-0 text-[10px] text-right">Pais cancelaram ✅</Badge>;
    case DELEGATION_STATUS.PARENT_REJECTED:
      return <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border-0 text-[10px] text-right">Pais: tens de fazer</Badge>;
    case DELEGATION_STATUS.AUTO_CANCELLED:
      return <Badge className="bg-green-500/15 text-green-600 border-0 text-[10px] text-right">Ninguém aceitou · sem falha ✅</Badge>;
    default:
      return <Badge variant="secondary" className="text-[10px]">Expirado</Badge>;
  }
}

export default function Delegar() {
  const { data: user, isLoading: loadingUser } = useCurrentUser();
  const queryClient = useQueryClient();
  const userIsParent = isParent(user);
  const person = user?.linked_name;
  const today = getLocalDateStr();

  const [confirmAccept, setConfirmAccept] = useState(null);

  const { data: delegations = [], isLoading: loadingDelegations } = useQuery({
    ...delegationsQuery(),
    enabled: !!person,
  });

  // Needed to tell a delivered delegation from a broken one.
  const { data: tasks = [] } = useQuery(tasksQuery());
  const { data: cancellations = [] } = useQuery(cancellationsQuery());

  // Saying no. When this was the last sibling who could have said yes, the
  // parents are told right away — there is no point making them wait out the
  // 3 hours. The request stays open: anyone can still change their mind.
  const refuseMutation = useMutation({
    mutationFn: (d) => TaskDelegationService.refuse(d.id, person),
    onSuccess: (row, d) => {
      queryClient.invalidateQueries({ queryKey: INVALIDATE.delegations });
      if (!row) {
        toast.info('Este pedido já não está disponível.');
        return;
      }
      toast.success(`Recusaste "${d.task_name}"`);
      if (row.parents_notified_at && !d.parents_notified_at) {
        const when = d.end_time ? ` (até às ${d.end_time})` : '';
        sendPushNotification({
          person: '__parents__',
          title: `🙋 ${d.from_person} precisa de uma decisão`,
          body: `${d.from_person} não consegue fazer "${d.task_name}"${when} e os irmãos recusaram (ainda podem mudar de ideias). Cancelas a tarefa ou tinha de a fazer?`,
          url: '/pais',
          tag: `delegation-unanswered-${d.id}`,
        });
        sendPushNotification({
          person: d.from_person,
          title: `⌛ Ninguém aceitou ainda: ${d.task_name}`,
          body: 'Os irmãos recusaram e os pais foram avisados. Se ninguém aceitar, não conta como falha.',
          url: '/',
          tag: `delegation-unanswered-${d.id}`,
        });
      }
    },
    onError: () => toast.error('Erro ao recusar o pedido.'),
  });

  const acceptMutation = useMutation({
    mutationFn: ({ id, fromPerson, taskName }) =>
      TaskDelegationService.accept(id, person),
    onSuccess: (data, { fromPerson, taskName, parentsWereTold }) => {
      queryClient.invalidateQueries({ queryKey: INVALIDATE.delegations });
      setConfirmAccept(null);
      toast.success(`Aceitaste a tarefa "${taskName}"!`);
      // Notify the person who delegated
      sendPushNotification({
        person: fromPerson,
        title: '✅ Tarefa aceite!',
        body: `${person} aceitou fazer: ${taskName}`,
        url: '/delegar',
        tag: `delegation-accepted-${data.id}`,
      });
      // The parents had been asked to decide — they no longer need to.
      if (parentsWereTold) {
        sendPushNotification({
          person: '__parents__',
          title: `🤝 ${person} aceitou afinal: ${taskName}`,
          body: `O pedido de ajuda de ${fromPerson} já não precisa de decisão.`,
          url: '/pais',
          tag: `delegation-unanswered-${data.id}`,
        });
      }
    },
    onError: (err) => {
      if (err?.code === 'PGRST116') {
        toast.error('Este pedido já não está disponível — outro irmão aceitou ou os pais já decidiram.');
      } else {
        toast.error('Erro ao aceitar o pedido.');
      }
      setConfirmAccept(null);
      queryClient.invalidateQueries({ queryKey: INVALIDATE.delegations });
    },
  });

  // This month's standings, and whether I'm currently barred from accepting
  // because I broke a promise. Memoised: both walk every delegation against
  // every task, and this component re-renders on each cache update.
  const acceptBlock = useMemo(
    () => getAcceptBlock(delegations, tasks, person, cancellations),
    [delegations, tasks, cancellations, person],
  );

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

  // Siblings' requests still open. The ones I refused stay reachable, apart
  // and quieter, in case I change my mind.
  const openForMe = delegations.filter(d => isDelegationOfferedTo(d, person, { tasks, cancellations }));
  const incomingRequests = openForMe.filter(d => !hasRefused(d, person));
  const refusedByMe = openForMe.filter(d => hasRefused(d, person));

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

      {/* Monthly standings — who actually delivers on what they take on */}
      <DelegationRanking
        delegations={delegations}
        tasks={tasks}
        cancellations={cancellations}
        viewer={person}
        className="mb-6"
      />

      {/* Cooling-off after breaking a promise */}
      {acceptBlock.blocked && (
        <Card className="p-3 mb-6 border-destructive/40 bg-destructive/5">
          <div className="flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-destructive">
                Não podes aceitar tarefas até {format(acceptBlock.until, "d 'de' MMMM", { locale: pt })}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Aceitaste uma tarefa de um irmão e não a fizeste. Podes voltar a ajudar depois.
              </p>
            </div>
          </div>
        </Card>
      )}

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
                        {getDelegationReward(d) > 0 && (
                          <span className="text-[11px] text-primary font-semibold">
                            +€{getDelegationReward(d).toFixed(2)}
                            {SIDNEY_TASKS.includes(d.task_name) && ' 🐶'}
                          </span>
                        )}
                      </div>
                      {parentsNotified(d) && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium mt-0.5">
                          ⏰ Os pais já foram avisados — ainda podes aceitar
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 flex-shrink-0">
                      <button
                        disabled={acceptMutation.isPending || refuseMutation.isPending || acceptBlock.blocked}
                        onClick={() => setConfirmAccept(d)}
                        className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold disabled:opacity-40"
                      >
                        Aceitar
                      </button>
                      <button
                        disabled={acceptMutation.isPending || refuseMutation.isPending}
                        onClick={() => refuseMutation.mutate(d)}
                        className="px-4 py-1.5 rounded-xl bg-muted text-muted-foreground text-xs font-semibold disabled:opacity-40"
                      >
                        Recusar
                      </button>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Requests I said no to — still open, in case I change my mind */}
      {refusedByMe.length > 0 && (
        <div className="mb-8 -mt-5">
          <p className="text-xs font-semibold text-muted-foreground mb-2">Recusaste, mas ainda estão abertos</p>
          <div className="space-y-2">
            {refusedByMe.map(d => (
              <Card key={d.id} className="p-3 bg-muted/30">
                <div className="flex items-center gap-3">
                  <span className="text-lg flex-shrink-0 opacity-70">{TASK_ICONS[d.task_name] || '✅'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-muted-foreground">{d.task_name}</p>
                    <span className="text-[11px] text-muted-foreground">
                      {PERSON_AVATARS[d.from_person]} {d.from_person}
                      {d.end_time && ` · até às ${d.end_time}`}
                    </span>
                  </div>
                  <button
                    disabled={acceptMutation.isPending || acceptBlock.blocked}
                    onClick={() => setConfirmAccept(d)}
                    className="px-3 py-2 rounded-xl bg-primary/15 text-primary text-xs font-bold disabled:opacity-40 flex-shrink-0"
                  >
                    Afinal aceito
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

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
                      {d.status === DELEGATION_STATUS.PENDING && refusedBy(d).length > 0 && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {refusedBy(d).map(p => `${PERSON_AVATARS[p]} ${p}`).join(' e ')} recusou
                        </p>
                      )}
                      {d.status === DELEGATION_STATUS.PENDING && !parentsNotified(d) && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Se ninguém aceitar, os pais são avisados daqui a {minutesUntilParentsNotice(d)} min
                        </p>
                      )}
                    </div>
                    <MyRequestStatus delegation={d} />
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Commitment sheet — accepting is a promise, so the cost of breaking it
          is stated up front rather than sprung on them afterwards. */}
      {confirmAccept && (
        <Portal>
          <div
            className="fixed inset-0 bg-black/40 z-[60] flex items-end"
            onClick={() => setConfirmAccept(null)}
          >
            <div
              className="w-full bg-card rounded-t-3xl p-6 pb-24 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-5">
                <span className="text-3xl">{TASK_ICONS[confirmAccept.task_name] || '✅'}</span>
                <div>
                  <h3 className="font-bold text-lg text-foreground">Aceitas o compromisso?</h3>
                  <p className="text-sm text-muted-foreground">
                    {confirmAccept.task_name}
                    {confirmAccept.end_time && ` · até às ${confirmAccept.end_time}`}
                  </p>
                </div>
              </div>

              <p className="text-sm text-muted-foreground mb-4">
                Ficas responsável por esta tarefa do {PERSON_AVATARS[confirmAccept.from_person]}{' '}
                <strong className="text-foreground">{confirmAccept.from_person}</strong> — e a recompensa passa a ser tua.
              </p>

              {getDelegationReward(confirmAccept) > 0 && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-primary/10 border border-primary/30 mb-2">
                  <span className="text-lg">💰</span>
                  <p className="text-sm text-foreground leading-snug">
                    Ganhas <strong className="text-primary">€{getDelegationReward(confirmAccept).toFixed(2)}</strong> se a fizeres hoje.
                    {SIDNEY_TASKS.includes(confirmAccept.task_name) && (
                      <span className="text-muted-foreground"> As tarefas do Sidney só pagam quando ajudas um irmão 🐶</span>
                    )}
                  </p>
                </div>
              )}

              <div className="flex items-start gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/30 mb-2">
                <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                <p className="text-sm text-destructive leading-snug">
                  Se aceitares e não fizeres, contam{' '}
                  <strong>{BROKEN_DELEGATION_WEIGHT} falhas</strong> em vez de uma.
                </p>
              </div>
              <div className="flex items-start gap-2 p-3 rounded-xl bg-muted mb-5">
                <Trophy className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
                <p className="text-sm text-muted-foreground leading-snug">
                  Se cumprires, sobes no ranking e ficas mais perto dos{' '}
                  <strong className="text-primary">€{DELEGATION_CHAMPION_BONUS.toFixed(2)}</strong> do fim do mês.
                </p>
              </div>

              <button
                disabled={acceptMutation.isPending}
                onClick={() => acceptMutation.mutate({
                  id: confirmAccept.id,
                  fromPerson: confirmAccept.from_person,
                  taskName: confirmAccept.task_name,
                  parentsWereTold: parentsNotified(confirmAccept),
                })}
                className="w-full py-3 rounded-2xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {acceptMutation.isPending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    A aceitar...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Sim, comprometo-me
                  </>
                )}
              </button>
              <button
                onClick={() => setConfirmAccept(null)}
                className="w-full py-3 mt-2 rounded-2xl bg-muted text-muted-foreground font-medium text-sm"
              >
                Cancelar
              </button>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}
