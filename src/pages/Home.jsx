import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  tasksQuery, scheduledTasksQuery, occasionalTasksQuery,
  delegationsQuery, cancellationsQuery, lastPaidAtQuery,
} from '@/lib/queries';
import { useCurrentUser, isParent } from '@/lib/useCurrentUser';
import { PEOPLE, getCurrentWeekKey, getWeekTasks, getLocalDateStr, applyCancellations } from '@/lib/taskHelpers';
import PersonCard from '@/components/home/PersonCard';
import WeeklyBonusBanner from '@/components/home/WeeklyBonusBanner';
import RecentActivity from '@/components/home/RecentActivity';
import RevisionTasks from '@/components/home/RevisionTasks';
import TodaySchedule from '@/components/home/TodaySchedule';
import { useNotifications } from '@/lib/useNotifications';
import { useMarkMissedTasks } from '@/lib/useMarkMissedTasks';
import { useMaterializeBonuses } from '@/lib/useMaterializeBonuses';
import { useMaterializeDelegationChampion } from '@/lib/useMaterializeDelegationChampion';
import { Calendar } from 'lucide-react';
import { HomeSkeleton } from '@/components/layout/PageSkeleton';

// Stable empty array — a fresh [] on every render would defeat the memoisation
// of everything downstream of it.
const EMPTY = [];

export default function Home() {
  const currentWeek = getCurrentWeekKey();
  const { data: user } = useCurrentUser();
  const userIsParent = isParent(user);
  const person = user?.linked_name;

  const {
    data: rawTasks = [],
    isLoading: isLoadingTasks,
    isFetchedAfterMount: tasksAreFresh,
  } = useQuery(tasksQuery());

  const { data: cancellations = [], isFetchedAfterMount: cancellationsAreFresh } =
    useQuery(cancellationsQuery());

  // Treat parent-cancelled occurrences as 'cancelled' (not failures) everywhere.
  //
  // Memoised, and so is everything derived from it below. These arrays feed the
  // dependency lists of effects that write to the database (the bonus and
  // delegation-prize materializers) and that schedule notification timers. A
  // fresh array on every render made all of them re-run on every render —
  // re-scanning hundreds of rows and tearing down and rebuilding every timer
  // each time the page painted.
  const tasks = useMemo(
    () => applyCancellations(rawTasks, cancellations),
    [rawTasks, cancellations],
  );

  const { data: scheduledTasks = [], isLoading: isLoadingScheduled } =
    useQuery(scheduledTasksQuery());

  const { data: occasionalTasks = [] } = useQuery({
    ...occasionalTasksQuery(),
    enabled: !userIsParent && !!person,
  });

  const { data: allDelegations = [], isFetchedAfterMount: delegationsAreFresh } =
    useQuery(delegationsQuery());

  const { data: lastPaidAts = {} } = useQuery(lastPaidAtQuery());

  const weekTasks = useMemo(() => getWeekTasks(tasks, currentWeek), [tasks, currentWeek]);

  const today = getLocalDateStr();
  const todayTasks = useMemo(() => tasks.filter(t => t.date === today), [tasks, today]);
  const myTodayTasks = useMemo(
    () => (userIsParent || !person ? [] : todayTasks.filter(t => t.person === person)),
    [todayTasks, userIsParent, person],
  );
  const myRevisionTasks = useMemo(
    () => tasks.filter(t => t.person === person && t.approval_status === 'needs_revision'),
    [tasks, person],
  );
  const myOccasionalTasks = userIsParent ? EMPTY : occasionalTasks;
  const recentTasks = useMemo(
    () => (userIsParent ? tasks : tasks.filter(t => t.person === person)),
    [tasks, userIsParent, person],
  );

  // No cached data is passed in on purpose — the hook reads its own
  // authoritative snapshot from the DB before deciding anything.
  useMarkMissedTasks({
    person: userIsParent ? null : person,
    enabled: !userIsParent && !!person,
  });

  // These two write bonus rows (and delete ones that are no longer deserved),
  // so they must never run off a restored cache — `isFetchedAfterMount` means
  // the data actually came from the network during this mount.
  useMaterializeBonuses({ tasks, enabled: tasksAreFresh && cancellationsAreFresh });

  useMaterializeDelegationChampion({
    tasks,
    delegations: allDelegations,
    cancellations,
    enabled: tasksAreFresh && cancellationsAreFresh && delegationsAreFresh,
  });

  useNotifications({
    scheduledTasks,
    todayTasks: myTodayTasks,
    person: userIsParent ? null : person,
    occasionalTasks: myOccasionalTasks,
    delegations: allDelegations,
    cancellations,
  });

  const isLoading = isLoadingTasks || isLoadingScheduled;

  if (isLoading) {
    return <HomeSkeleton />;
  }

  return (
    <div className="max-w-lg mx-auto px-4 pt-6 pb-4">
      <p className="text-base font-bold text-foreground mb-6">Semana {currentWeek.split('-W')[1]} de {new Date().toLocaleString('pt-PT', { month: 'long' })} <span className="font-normal text-sm text-muted-foreground">· Sistema Familiar</span></p>

      {/* Tasks a parent sent back to be corrected */}
      {!userIsParent && person && (
        <RevisionTasks tasks={myRevisionTasks} person={person} />
      )}

      {/* Today's Schedule for logged-in child */}
      {!userIsParent && person && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="w-4 h-4 text-primary" />
            <h2 className="text-base font-bold text-foreground">As tuas tarefas de hoje</h2>
          </div>
          <TodaySchedule
            scheduledTasks={scheduledTasks}
            todayTasks={myTodayTasks}
            person={person}
            occasionalTasks={occasionalTasks}
          />
        </div>
      )}

      {/* Weekly Bonus */}
      <div className="mb-5">
        <WeeklyBonusBanner tasks={tasks} currentWeek={currentWeek} />
      </div>

      {/* Person Cards */}
      <div className="space-y-3 mb-6">
        {PEOPLE.map((person, i) => (
          <PersonCard
            key={person}
            person={person}
            tasks={tasks}
            weekTasks={weekTasks}
            lastPaidAt={lastPaidAts[person] || null}
            index={i}
          />
        ))}
      </div>

      {/* Recent Activity */}
      <div className="mb-4">
        <h2 className="text-lg font-bold text-foreground mb-3">Atividade Recente</h2>
        <RecentActivity tasks={recentTasks} />
      </div>
    </div>
  );
}