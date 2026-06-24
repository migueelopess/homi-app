import { useQuery } from '@tanstack/react-query';
import { TaskService, TaskCancellationService } from '@/api/entities';
import { PEOPLE, PERSON_AVATARS, COMPLETION_TYPES, getCurrentWeekKey, getCurrentMonthKey, getWeekTasks, getMonthTasks, calculateEarnings, checkWeeklyBonus, WEEKLY_BONUS, isBonusTask, applyCancellations } from '@/lib/taskHelpers';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { motion } from 'framer-motion';
import { Crown, Medal, Star, TrendingUp } from 'lucide-react';

export default function Ranking() {
  const currentWeek = getCurrentWeekKey();
  const currentMonth = getCurrentMonthKey();
  
  const { data: rawTasks = [], isLoading } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => TaskService.list('-created_date', 500),
  });

  const { data: cancellations = [] } = useQuery({
    queryKey: ['taskCancellations', 'all'],
    queryFn: () => TaskCancellationService.list(),
  });

  // Waived occurrences shouldn't block the weekly bonus in the ranking.
  const tasks = applyCancellations(rawTasks, cancellations);

  const getRanking = (filteredTasks) => {
    return PEOPLE.map(person => {
      const personTasks = filteredTasks.filter(t => t.person === person);
      const realTasks = personTasks.filter(t => !isBonusTask(t));
      const bonusTasks = personTasks.filter(t => isBonusTask(t));

      const earnings = calculateEarnings(realTasks);
      const persistedBonus = calculateEarnings(bonusTasks);
      const currentWeekBonusAlreadyPersisted = bonusTasks.some(t => t.week_key === currentWeek);
      const pendingBonus = !currentWeekBonusAlreadyPersisted && checkWeeklyBonus(filteredTasks, person, currentWeek)
        ? WEEKLY_BONUS
        : 0;
      const bonus = persistedBonus + pendingBonus;

      const perfectTasks = realTasks.filter(t => t.completion_type === 'on_time_no_reminder').length;
      return { person, earnings, bonus, total: earnings + bonus, taskCount: realTasks.length, perfectTasks };
    }).sort((a, b) => b.total - a.total);
  };

  const weekRanking = getRanking(getWeekTasks(tasks, currentWeek));
  const monthRanking = getRanking(getMonthTasks(tasks, currentMonth));

  const medals = [
    { icon: Crown, color: 'text-yellow-500' },
    { icon: Medal, color: 'text-gray-400' },
    { icon: Medal, color: 'text-amber-700' },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const RankingList = ({ ranking }) => (
    <div className="space-y-3">
      {ranking.map((entry, i) => {
        const MedalIcon = medals[i]?.icon || Star;
        const medalColor = medals[i]?.color || 'text-muted-foreground';
        return (
          <motion.div
            key={entry.person}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            <Card className={`p-4 ${i === 0 ? 'border-primary/30 bg-primary/5' : ''}`}>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 text-center">
                    <MedalIcon className={`w-6 h-6 mx-auto ${medalColor}`} />
                  </div>
                  <span className="text-3xl">{PERSON_AVATARS[entry.person]}</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-foreground">{entry.person}</h3>
                    {entry.bonus > 0 && (
                      <Badge className="bg-accent/20 text-accent-foreground text-[10px] font-bold border-0">
                        +BÓNUS
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {entry.taskCount} tarefas · {entry.perfectTasks} perfeitas
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-extrabold text-primary">€{entry.total.toFixed(2)}</p>
                  {entry.bonus > 0 && (
                    <p className="text-[10px] text-accent">+€{entry.bonus.toFixed(2)} bónus</p>
                  )}
                </div>
              </div>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );

  return (
    <div className="max-w-lg mx-auto px-4 pt-6 pb-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp className="w-5 h-5 text-primary" />
          <h1 className="text-2xl font-extrabold text-foreground tracking-tight">Ranking</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-6">Quem está a ganhar mais?</p>
      </motion.div>

      <Tabs defaultValue="week" className="w-full">
        <TabsList className="w-full grid grid-cols-2 mb-5 h-11 rounded-xl">
          <TabsTrigger value="week" className="rounded-lg font-semibold">Esta Semana</TabsTrigger>
          <TabsTrigger value="month" className="rounded-lg font-semibold">Este Mês</TabsTrigger>
        </TabsList>
        <TabsContent value="week">
          <RankingList ranking={weekRanking} />
        </TabsContent>
        <TabsContent value="month">
          <RankingList ranking={monthRanking} />
        </TabsContent>
      </Tabs>
    </div>
  );
}