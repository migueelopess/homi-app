import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TaskService, PaymentService, TaskCancellationService } from '@/api/entities';
import { useCurrentUser, isParent } from '@/lib/useCurrentUser';
import { Lock, ChevronDown, ChevronUp, Eye, Trash2, TrendingUp, Loader2, Check, AlertTriangle } from 'lucide-react';
import PhotoModal from '@/components/parents/PhotoModal';
import ApprovalsTab from '@/components/parents/ApprovalsTab';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { supabase } from '@/api/supabaseClient';
import { PEOPLE, PERSON_AVATARS, PENALTIES, COMPLETION_TYPES, getCurrentWeekKey, getCurrentMonthKey, getWeekTasks, getMonthTasks, calculateEarnings, checkWeeklyBonus, WEEKLY_BONUS, countFailures, getTaskIcon, isBonusTask, isAwaitingDecision, getLocalDateStr, applyCancellations } from '@/lib/taskHelpers';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { motion } from 'framer-motion';
import { format, parse, startOfWeek } from 'date-fns';
import { pt } from 'date-fns/locale';
import { toast } from 'sonner';
import { PageSkeleton } from '@/components/layout/PageSkeleton';

export default function Parents() {
  const queryClient = useQueryClient();
  const currentWeek = getCurrentWeekKey();
  const currentMonth = getCurrentMonthKey();
  const [expandedPerson, setExpandedPerson] = useState(null);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const { data: user, isLoading: loadingUser } = useCurrentUser();

  const { data: rawTasks = [], isLoading } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => TaskService.list('-created_date', 500),
  });

  const { data: cancellations = [] } = useQuery({
    queryKey: ['taskCancellations', 'all'],
    queryFn: () => TaskCancellationService.list(),
    enabled: isParent(user),
  });

  // Parent-cancelled occurrences are relabeled 'cancelled' so they never count
  // as failures (penalties) nor block the weekly bonus.
  const tasks = applyCancellations(rawTasks, cancellations);

  const { data: pendingTasks = [] } = useQuery({
    queryKey: ['pendingTasks'],
    queryFn: () => TaskService.listPending(),
    enabled: isParent(user),
  });
  const pendingCount = pendingTasks.length;

  const { data: lastPaidDates = {} } = useQuery({
    queryKey: ['payments', 'last-dates'],
    queryFn: () => PaymentService.getLastPaidDates(),
    enabled: isParent(user),
  });

  const deleteMutation = useMutation({
    mutationFn: async (task) => {
      await TaskService.delete(task.id);
      // useMarkMissedTasks is self-healing: it recreates any scheduled
      // occurrence that has no record for a past day. Without a tombstone a
      // deleted task is resurrected (as not_done) the next time a child opens
      // the app. A cancellation marks the occurrence as waived, so it is
      // skipped on recreation and never counts as a failure again. The bonus
      // row has no scheduled origin, so it needs no tombstone.
      if (!isBonusTask(task)) {
        try {
          await TaskCancellationService.create({
            person: task.person,
            task_name: task.task_name,
            task_date: task.date,
            end_time: task.end_time ?? null,
            cancelled_by: user?.id ?? null,
          });
        } catch (e) {
          // A tombstone may already exist (unique violation) — that's fine.
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['taskCancellations'] });
      toast.success('Tarefa eliminada permanentemente');
    },
  });

  const payMutation = useMutation({
    mutationFn: async ({ persons }) => {
      const today = getLocalDateStr();
      const rows = persons.map((person) => ({
        person,
        paid_through_date: today,
        paid_by: user?.id ?? null,
      }));
      return PaymentService.createBulk(rows);
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['payments', 'last-dates'] });
      const label = vars.persons.length === 1 ? vars.persons[0] : 'todos os filhos';
      toast.success(`Pagamento registado para ${label}`);
    },
    onError: (err) => {
      console.error('Payment failed:', err);
      toast.error('Erro ao registar pagamento');
    },
  });

  const applyPenaltyMutation = useMutation({
    mutationFn: ({ person }) => TaskService.applyPenalty(person, user?.id),
    onSuccess: (updated, vars) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      if (updated.length === 0) {
        toast.error('Sem falhas pendentes para descontar');
      } else {
        toast.success(`Castigo aplicado a ${vars.person} (${updated.length} ${updated.length === 1 ? 'falha descontada' : 'falhas descontadas'})`);
      }
    },
    onError: (err) => {
      console.error('Apply penalty failed:', err);
      toast.error('Erro ao aplicar castigo');
    },
  });

  const handleCleanup = async () => {
    setCleanupLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('monthly-cleanup', {
        body: { clean_all: true },
      });
      if (error) throw error;

      const total = (data.deleted_tasks || 0) + (data.deleted_photos || 0) +
        (data.deleted_occasional_tasks || 0) + (data.deleted_reminders || 0) +
        (data.deleted_notifications || 0) + (data.deleted_delegations || 0) +
        (data.deleted_cancellations || 0) + (data.deleted_extensions || 0);

      if (total === 0) {
        toast.warning('Nenhum dado foi apagado. Verifica se a Edge Function foi atualizada no Supabase.');
      } else {
        // Clear local cache immediately to reflect the cleanup. Keys must match
        // the ones the app actually queries under.
        queryClient.resetQueries({ queryKey: ['tasks'] });
        queryClient.resetQueries({ queryKey: ['occasionalTasks'] });
        queryClient.resetQueries({ queryKey: ['taskReminders'] });
        queryClient.resetQueries({ queryKey: ['taskDelegations'] });
        queryClient.resetQueries({ queryKey: ['taskCancellations'] });
        queryClient.resetQueries({ queryKey: ['taskExtensions'] });
        toast.success(
          `Limpeza concluída: ${data.deleted_tasks} tarefas, ${data.deleted_photos} fotos, ${data.deleted_occasional_tasks} ocasionais, ${data.deleted_reminders} lembretes, ${data.deleted_delegations} delegações apagados`
        );
      }
    } catch (err) {
      console.error('Cleanup failed:', err);
      toast.error('Erro ao executar limpeza');
    } finally {
      setCleanupLoading(false);
    }
  };

  const weekTasks = getWeekTasks(tasks, currentWeek);
  const monthTasks = getMonthTasks(tasks, currentMonth);

  if (isLoading || loadingUser) {
    return <PageSkeleton />;
  }

  if (!isParent(user)) {
    return (
      <div className="max-w-lg mx-auto px-4 pt-16 flex flex-col items-center text-center">
        <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-4">
          <Lock className="w-9 h-9 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2">Área Restrita</h2>
        <p className="text-sm text-muted-foreground">Este painel é apenas para os pais.</p>
      </div>
    );
  }

  const PersonSummary = ({ person, filteredTasks, periodLabel }) => {
    const earnings = calculateEarnings(filteredTasks.filter(t => t.person === person));
    const personTasks = filteredTasks.filter(t => t.person === person);
    const realTasks = personTasks.filter(t => !isBonusTask(t));
    const perfect = realTasks.filter(t => t.completion_type === 'on_time_no_reminder').length;
    const withReminder = realTasks.filter(t => t.completion_type === 'on_time_with_reminder').length;
    const late = realTasks.filter(t => t.completion_type === 'late').length;
    const hasBonus = checkWeeklyBonus(tasks, person, currentWeek);
    const failures = countFailures(tasks, person);

    return (
      <Card className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-3xl">{PERSON_AVATARS[person]}</span>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-foreground">{person}</h3>
              {failures >= 3 && (
                <Badge variant="destructive" className="text-[9px]">Penalizado</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{realTasks.length} tarefas {periodLabel}</p>
          </div>
          <div className="text-right">
            <p className="text-xl font-extrabold text-primary">€{earnings.toFixed(2)}</p>
            {hasBonus && <p className="text-[10px] text-accent font-semibold">+€{WEEKLY_BONUS.toFixed(2)} bónus</p>}
          </div>
        </div>

        {realTasks.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-primary/8 rounded-xl p-2 text-center">
              <p className="text-lg font-bold text-primary">{perfect}</p>
              <p className="text-[10px] text-muted-foreground">🌟 Perfeitas</p>
            </div>
            <div className="bg-accent/10 rounded-xl p-2 text-center">
              <p className="text-lg font-bold text-accent">{withReminder}</p>
              <p className="text-[10px] text-muted-foreground">⏰ Com aviso</p>
            </div>
            <div className="bg-destructive/8 rounded-xl p-2 text-center">
              <p className="text-lg font-bold text-destructive">{late}</p>
              <p className="text-[10px] text-muted-foreground">⚠️ Atrasadas</p>
            </div>
          </div>
        )}
      </Card>
    );
  };

  const PaymentSummary = ({ filteredTasks, period }) => {
    // Tasks count toward "unpaid" only if approved (or legacy without status) AND dated after the
    // last paid_through_date for that person. Pending tasks are excluded so parents don't pay for
    // work that may still be rejected.
    const isUnpaid = (t, person) => {
      if (t.person !== person) return false;
      if (isAwaitingDecision(t)) return false;
      const lastPaid = lastPaidDates[person];
      return !lastPaid || t.date > lastPaid;
    };

    // Period start date — anything strictly before this is "older / previous period"
    const periodStart = period === 'week'
      ? format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
      : `${currentMonth}-01`;

    const periodUnpaid = {};
    const olderUnpaid = {};
    let periodTotal = 0;
    let olderTotal = 0;
    PEOPLE.forEach((p) => {
      const periodAmt = calculateEarnings(filteredTasks.filter((t) => isUnpaid(t, p)));
      const olderAmt = calculateEarnings(
        tasks.filter((t) => isUnpaid(t, p) && t.date < periodStart)
      );
      periodUnpaid[p] = periodAmt;
      olderUnpaid[p] = olderAmt;
      periodTotal += periodAmt;
      olderTotal += olderAmt;
    });

    const personsWithAnyDebt = PEOPLE.filter((p) => periodUnpaid[p] + olderUnpaid[p] > 0);
    const grandTotal = periodTotal + olderTotal;
    const olderLabel = period === 'week' ? 'semanas anteriores' : 'meses anteriores';
    const periodLabel = period === 'week' ? 'semana' : 'mês';

    return (
      <Card className="p-4 bg-gradient-to-r from-primary/5 to-accent/5 border-primary/20">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-foreground">💰 A Pagar</h3>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                className="h-7 gap-1"
                disabled={personsWithAnyDebt.length === 0 || payMutation.isPending}
              >
                {payMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                Pagar todos
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Pagar a todos os filhos?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2">
                    <p>Vais registar o pagamento de <strong>€{grandTotal.toFixed(2)}</strong> no total:</p>
                    <ul className="text-sm space-y-1 pl-4 list-disc">
                      {personsWithAnyDebt.map((p) => {
                        const t = periodUnpaid[p] + olderUnpaid[p];
                        return (
                          <li key={p}>
                            {p}: €{t.toFixed(2)}
                            {olderUnpaid[p] > 0 && ` (inclui €${olderUnpaid[p].toFixed(2)} de ${olderLabel})`}
                          </li>
                        );
                      })}
                    </ul>
                    <p className="text-xs text-muted-foreground">
                      Todas as tarefas até hoje ({format(new Date(), 'd MMM yyyy', { locale: pt })}) ficam marcadas como pagas.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => payMutation.mutate({ persons: personsWithAnyDebt })}>
                  Confirmar pagamento
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div className="space-y-2">
          {PEOPLE.map((person) => {
            const periodAmt = periodUnpaid[person];
            const olderAmt = olderUnpaid[person];
            const totalAmt = periodAmt + olderAmt;
            return (
              <div key={person} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span>{PERSON_AVATARS[person]}</span>
                  <span className="text-sm text-foreground">{person}</span>
                  {olderAmt > 0 && (
                    <span className="text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-500/15 border border-amber-500/40 px-1.5 py-0.5 rounded-md inline-flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      +€{olderAmt.toFixed(2)} antigo
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-primary">€{periodAmt.toFixed(2)}</span>
                  {totalAmt > 0 && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={payMutation.isPending}>
                          Pagar
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Pagar a {person}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Vai registar o pagamento de <strong>€{totalAmt.toFixed(2)}</strong> ao {person}.
                            {olderAmt > 0 && ` Inclui €${olderAmt.toFixed(2)} de ${olderLabel}.`}
                            {' '}Todas as tarefas até hoje ({format(new Date(), 'd MMM yyyy', { locale: pt })}) ficam marcadas como pagas.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction onClick={() => payMutation.mutate({ persons: [person] })}>
                            Confirmar pagamento
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </div>
            );
          })}
          <div className="border-t border-border pt-2 mt-2 flex items-center justify-between">
            <span className="text-sm font-bold text-foreground">Total {periodLabel}</span>
            <span className="text-base font-extrabold text-primary">€{periodTotal.toFixed(2)}</span>
          </div>
        </div>
      </Card>
    );
  };

  return (
    <>
    <div className="max-w-lg mx-auto px-4 pt-6 pb-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Relatório</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-5">Desempenho e valores a pagar</p>
      </motion.div>

      <Tabs defaultValue="approvals" className="w-full">
        <TabsList className="w-full grid grid-cols-3 mb-5 h-11 rounded-xl">
          <TabsTrigger value="approvals" className="rounded-lg font-semibold gap-1.5">
            Aprovações
            {pendingCount > 0 && (
              <Badge className="bg-amber-500 text-white text-[10px] border-0 px-1.5 h-4 leading-none">
                {pendingCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="week" className="rounded-lg font-semibold">Semana</TabsTrigger>
          <TabsTrigger value="month" className="rounded-lg font-semibold">Mês</TabsTrigger>
        </TabsList>

        <TabsContent value="approvals" className="space-y-3">
          <ApprovalsTab approverId={user?.id} />
        </TabsContent>

        <TabsContent value="week" className="space-y-3">
          <PaymentSummary filteredTasks={weekTasks} period="week" />
          {PEOPLE.map(p => <PersonSummary key={p} person={p} filteredTasks={weekTasks} periodLabel="esta semana" />)}
        </TabsContent>

        <TabsContent value="month" className="space-y-3">
          <PaymentSummary filteredTasks={monthTasks} period="month" />
          {PEOPLE.map(p => <PersonSummary key={p} person={p} filteredTasks={monthTasks} periodLabel="este mês" />)}
        </TabsContent>
      </Tabs>

      {/* Penalizações */}
      <Card className="p-4 mt-4 mb-4">
        <h3 className="text-sm font-bold text-foreground mb-3">⚠️ Penalizações (3 falhas/30 dias)</h3>
        <div className="space-y-2">
          {PEOPLE.map(person => {
            const failures = countFailures(tasks, person);
            const canApply = failures >= 3;
            return (
              <div key={person} className="flex items-center justify-between p-2 rounded-lg bg-muted">
                <div className="flex items-center gap-2">
                  <span>{PERSON_AVATARS[person]}</span>
                  <span className="text-sm font-medium">{person}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{failures}/3</span>
                  {canApply ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7 px-3 text-[11px] font-semibold"
                          disabled={applyPenaltyMutation.isPending}
                        >
                          Dar castigo
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Aplicar castigo a {person}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Castigo: <strong>Sem {PENALTIES[person]}</strong>.
                            <br />
                            Vai descontar 3 falhas do contador ({failures}/3 → {failures - 3}/3).
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => applyPenaltyMutation.mutate({ person })}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Confirmar
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : (
                    <Badge className="bg-primary/10 text-primary text-[10px] border-0">OK</Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Limpeza de Dados */}
      <Card className="p-4 mt-4 mb-4">
        <h3 className="text-sm font-bold text-foreground mb-2">🧹 Limpeza de Dados</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Apaga tarefas, fotos, lembretes, notificações, delegações, cancelamentos e extensões. Rotinas e tarefas agendadas não são afetadas. Penalizações e ranking de delegações resetam a 0.
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" className="w-full gap-2" disabled={cleanupLoading}>
              {cleanupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              {cleanupLoading ? 'A limpar...' : 'Executar Limpeza'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Tens a certeza?</AlertDialogTitle>
              <AlertDialogDescription>
                Isto vai apagar permanentemente todas as tarefas, fotos, lembretes, notificações, delegações, cancelamentos e extensões. As rotinas e tarefas agendadas não serão afetadas. As penalizações e o ranking de delegações voltam a 0.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleCleanup} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Sim, apagar tudo
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Card>

      {/* Histórico */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-foreground">📋 Histórico por Filho</h3>
        {PEOPLE.map(person => {
          const personTasks = tasks.filter(t => t.person === person);
          const isExpanded = expandedPerson === person;
          return (
            <Card key={person} className="overflow-hidden">
              <button
                onClick={() => setExpandedPerson(isExpanded ? null : person)}
                className="w-full flex items-center justify-between p-4"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xl">{PERSON_AVATARS[person]}</span>
                  <span className="font-bold text-foreground">{person}</span>
                  <Badge className="bg-muted text-muted-foreground text-[10px] border-0">
                    {personTasks.length} tarefas
                  </Badge>
                </div>
                {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </button>
              {isExpanded && (
                <div className="px-4 pb-4 space-y-2">
                  {personTasks.slice(0, 20).map(task => {
                    const ct = COMPLETION_TYPES[task.completion_type];
                    const isPending = task.approval_status === 'pending';
                    const isRevision = task.approval_status === 'needs_revision';
                    const isRejected = task.approval_status === 'rejected';
                    const isCancelled = task.completion_type === 'cancelled';
                    const isMissed = task.completion_type === 'not_done' && !isRejected;
                    return (
                      <div key={task.id} className={`flex items-center gap-2 p-2 rounded-lg text-sm ${isMissed ? 'bg-destructive/5 border border-destructive/20' : 'bg-muted'}`}>
                        <span>{getTaskIcon(task.task_name)}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className={`font-medium truncate ${isMissed ? 'line-through text-muted-foreground' : ''}`}>{task.task_name}</p>
                            {isPending && (
                              <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-400 text-[9px] border-0 px-1.5 leading-none">Pendente</Badge>
                            )}
                            {isRevision && (
                              <Badge className="bg-orange-500/20 text-orange-700 dark:text-orange-400 text-[9px] border-0 px-1.5 leading-none">A corrigir</Badge>
                            )}
                            {isRejected && (
                              <Badge className="bg-destructive/15 text-destructive text-[9px] border-0 px-1.5 leading-none">Rejeitada</Badge>
                            )}
                            {isMissed && (
                              <Badge className="bg-destructive/15 text-destructive text-[9px] border-0 px-1.5 leading-none">Falhou</Badge>
                            )}
                            {isCancelled && (
                              <Badge className="bg-muted text-muted-foreground text-[9px] border-0 px-1.5 leading-none">Cancelada</Badge>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            {task.date ? format(parse(task.date, 'yyyy-MM-dd', new Date()), "d MMM yyyy", { locale: pt }) : ''}
                          </p>
                        </div>
                        {isMissed ? (
                          <span className="text-base font-extrabold text-destructive leading-none px-1">✕</span>
                        ) : (
                          <span className={`font-bold ${ct?.color} ${isPending ? 'opacity-50' : ''} ${isRejected ? 'line-through opacity-60' : ''}`}>€{(task.value || 0).toFixed(2)}</span>
                        )}
                        <div className="flex gap-1">
                          {task.photo_url && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPhotoUrl(task.photo_url)}>
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Eliminar tarefa?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Vais eliminar <strong>permanentemente</strong> "{task.task_name}" de {task.person}
                                  {task.date ? ` (${format(parse(task.date, 'yyyy-MM-dd', new Date()), "d MMM yyyy", { locale: pt })})` : ''}.
                                  {isMissed && ' Deixa de contar como falha.'} Esta tarefa não volta a aparecer.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteMutation.mutate(task)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Eliminar
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    );
                  })}
                  {personTasks.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">Sem tarefas registadas</p>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
    <PhotoModal url={photoUrl} onClose={() => setPhotoUrl(null)} />
    </>
  );
}