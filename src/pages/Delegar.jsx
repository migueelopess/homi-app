import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TaskDelegationService, TaskService, TaskCancellationService } from '@/api/entities';
import { sendPushNotification } from '@/api/supabaseClient';
import { useCurrentUser, isParent } from '@/lib/useCurrentUser';
import {
  PERSON_AVATARS, TASK_ICONS, getLocalDateStr, getCurrentMonthKey,
  getDelegationStats, rankDelegations, getAcceptBlock,
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

const MEDALS = ['🥇', '🥈', '🥉'];

export default function Delegar() {
  const { data: user, isLoading: loadingUser } = useCurrentUser();
  const queryClient = useQueryClient();
  const userIsParent = isParent(user);
  const person = user?.linked_name;
  const today = getLocalDateStr();

  const [confirmAccept, setConfirmAccept] = useState(null);

  const { data: delegations = [], isLoading: loadingDelegations } = useQuery({
    queryKey: ['taskDelegations'],
    queryFn: () => TaskDelegationService.list('-created_at'),
    enabled: !!person,
  });

  // Needed to tell a delivered delegation from a broken one.
  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => TaskService.list('-created_date', 500),
  });

  const { data: cancellations = [] } = useQuery({
    queryKey: ['taskCancellations', 'all'],
    queryFn: () => TaskCancellationService.list(),
  });

  const acceptMutation = useMutation({
    mutationFn: ({ id, fromPerson, taskName }) =>
      TaskDelegationService.accept(id, person),
    onSuccess: (data, { fromPerson, taskName }) => {
      queryClient.invalidateQueries({ queryKey: ['taskDelegations'] });
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
    },
    onError: (err) => {
      if (err?.code === 'PGRST116') {
        toast.error('Este pedido já foi aceite por outra pessoa.');
      } else {
        toast.error('Erro ao aceitar o pedido.');
      }
      setConfirmAccept(null);
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

  // This month's standings, and whether I'm currently barred from accepting
  // because I broke a promise.
  const currentMonth = getCurrentMonthKey();
  const monthStats = getDelegationStats(delegations, tasks, { monthKey: currentMonth, cancellations });
  const ranking = rankDelegations(monthStats);
  const leaderScore = ranking[0]?.completed ?? 0;
  const acceptBlock = getAcceptBlock(delegations, tasks, person, cancellations);

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
      <Card className="p-4 mb-6 bg-gradient-to-r from-primary/5 to-accent/5 border-primary/20">
        <div className="flex items-center gap-2 mb-1">
          <Trophy className="w-4 h-4 text-accent" />
          <h2 className="text-base font-bold text-foreground">Ranking de ajudas</h2>
          <Badge className="bg-accent/20 text-accent-foreground border-0 text-[10px] ml-auto">
            {format(new Date(), 'MMMM', { locale: pt })}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Quem cumprir mais tarefas que aceitou dos irmãos ganha{' '}
          <strong className="text-primary">€{DELEGATION_CHAMPION_BONUS.toFixed(2)}</strong> no fim do mês.
        </p>

        <div className="space-y-2">
          {ranking.map((r, i) => {
            const isLeader = r.completed > 0 && r.completed === leaderScore;
            const isMe = r.person === person;
            return (
              <div
                key={r.person}
                className={`flex items-center gap-2 p-2 rounded-xl ${
                  isLeader ? 'bg-accent/10 ring-1 ring-accent/30' : 'bg-muted/50'
                }`}
              >
                <span className="w-5 text-center text-sm">{r.completed > 0 ? (MEDALS[i] || '') : ''}</span>
                <span>{PERSON_AVATARS[r.person]}</span>
                <span className={`text-sm ${isMe ? 'font-bold text-foreground' : 'text-foreground'}`}>
                  {r.person}{isMe && <span className="text-muted-foreground font-normal"> (tu)</span>}
                </span>

                <div className="ml-auto flex items-center gap-1.5">
                  {r.open > 0 && (
                    <Badge className="bg-blue-500/15 text-blue-600 border-0 text-[10px]">
                      {r.open} por fazer
                    </Badge>
                  )}
                  {r.broken > 0 && (
                    <Badge className="bg-destructive/15 text-destructive border-0 text-[10px] gap-1">
                      <AlertTriangle className="w-2.5 h-2.5" />
                      {r.broken}
                    </Badge>
                  )}
                  <span className="text-base font-extrabold text-primary tabular-nums">{r.completed}</span>
                </div>
              </div>
            );
          })}
        </div>

        {leaderScore === 0 && (
          <p className="text-[11px] text-muted-foreground text-center mt-3">
            Ainda ninguém cumpriu nenhuma. Sê o primeiro 💪
          </p>
        )}
      </Card>

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
                        {d.task_type === 'occasional' && d.reward > 0 && (
                          <span className="text-[11px] text-primary font-medium">+€{Number(d.reward).toFixed(2)}</span>
                        )}
                      </div>
                    </div>
                    <button
                      disabled={acceptMutation.isPending || acceptBlock.blocked}
                      onClick={() => setConfirmAccept(d)}
                      className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold flex-shrink-0 disabled:opacity-40"
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
