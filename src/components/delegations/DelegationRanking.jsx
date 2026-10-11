import { useMemo } from 'react';
import { Trophy, AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import {
  PERSON_AVATARS, DELEGATION_CHAMPION_BONUS, getCurrentMonthKey,
  getDelegationStats, rankDelegations, getDelegationChampions,
} from '@/lib/taskHelpers';

const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * This month's delegation standings: who actually delivers on the tasks they
 * took over from a sibling.
 *
 * Shared by the children's Delegar page and the parents' Relatório. `viewer` is
 * the child looking at it — their row is marked "(tu)" — or null for a parent,
 * who also sees how many each child accepted and who would take the prize if
 * the month ended today, since they are the ones who pay it.
 */
export default function DelegationRanking({ delegations = [], tasks = [], cancellations = [], viewer = null, className = '' }) {
  const isParentView = !viewer;
  const monthKey = getCurrentMonthKey();

  const { ranking, champions } = useMemo(() => {
    const stats = getDelegationStats(delegations, tasks, { monthKey, cancellations });
    return {
      ranking: rankDelegations(stats),
      champions: getDelegationChampions(stats).map(c => c.person),
    };
  }, [delegations, tasks, cancellations, monthKey]);

  const leaderScore = ranking[0]?.completed ?? 0;

  return (
    <Card className={`p-4 bg-gradient-to-r from-primary/5 to-accent/5 border-primary/20 ${className}`}>
      <div className="flex items-center gap-2 mb-1">
        <Trophy className="w-4 h-4 text-accent" />
        <h2 className="text-base font-bold text-foreground">Ranking de ajudas</h2>
        <Badge className="bg-accent/20 text-accent-foreground border-0 text-[10px] ml-auto">
          {format(new Date(), 'MMMM', { locale: pt })}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        {isParentView
          ? 'O filho que cumprir mais tarefas aceites dos irmãos ganha'
          : 'Quem cumprir mais tarefas que aceitou dos irmãos ganha'}{' '}
        <strong className="text-primary">€{DELEGATION_CHAMPION_BONUS.toFixed(2)}</strong> no fim do mês.
      </p>

      <div className="space-y-2">
        {ranking.map((r, i) => {
          const isLeader = r.completed > 0 && r.completed === leaderScore;
          const isMe = r.person === viewer;
          return (
            <div
              key={r.person}
              className={`flex items-center gap-2 p-2 rounded-xl ${
                isLeader ? 'bg-accent/10 ring-1 ring-accent/30' : 'bg-muted/50'
              }`}
            >
              <span className="w-5 text-center text-sm">{r.completed > 0 ? (MEDALS[i] || '') : ''}</span>
              <span>{PERSON_AVATARS[r.person]}</span>
              <div className="min-w-0">
                <p className={`text-sm leading-tight ${isMe ? 'font-bold text-foreground' : 'text-foreground'}`}>
                  {r.person}{isMe && <span className="text-muted-foreground font-normal"> (tu)</span>}
                </p>
                {isParentView && (
                  <p className="text-[10px] text-muted-foreground leading-tight">
                    {r.accepted === 0
                      ? 'nenhuma aceite'
                      : `${r.completed} de ${r.accepted} ${r.accepted === 1 ? 'aceite' : 'aceites'}`}
                  </p>
                )}
              </div>

              <div className="ml-auto flex items-center gap-1.5">
                {r.open > 0 && (
                  <Badge className="bg-blue-500/15 text-blue-600 border-0 text-[10px]">
                    {r.open} por fazer
                  </Badge>
                )}
                {r.broken > 0 && (
                  <Badge className="bg-destructive/15 text-destructive border-0 text-[10px] gap-1">
                    <AlertTriangle className="w-2.5 h-2.5" />
                    {r.broken}{isParentView && (r.broken === 1 ? ' falhada' : ' falhadas')}
                  </Badge>
                )}
                <span className="text-base font-extrabold text-primary tabular-nums">{r.completed}</span>
              </div>
            </div>
          );
        })}
      </div>

      {leaderScore === 0 ? (
        <p className="text-[11px] text-muted-foreground text-center mt-3">
          {isParentView ? 'Ainda ninguém cumpriu nenhuma delegação este mês.' : 'Ainda ninguém cumpriu nenhuma. Sê o primeiro 💪'}
        </p>
      ) : isParentView && (
        <p className="text-[11px] text-muted-foreground text-center mt-3">
          Se o mês acabasse hoje:{' '}
          <strong className="text-foreground">{champions.join(' e ')}</strong>{' '}
          {champions.length > 1 ? 'ganhavam' : 'ganhava'} €{DELEGATION_CHAMPION_BONUS.toFixed(2)}
          {champions.length > 1 && ' cada'}.
        </p>
      )}
    </Card>
  );
}
