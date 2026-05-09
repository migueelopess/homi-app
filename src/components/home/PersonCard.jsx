import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PERSON_AVATARS, PENALTIES, calculateEarnings, countFailures, getLocalDateStr, getCurrentMonthKey, getCurrentWeekKey, checkWeeklyBonus, isBonusTask, WEEKLY_BONUS } from '@/lib/taskHelpers';
import { TrendingUp, AlertTriangle, Trophy } from 'lucide-react';

export default function PersonCard({ person, tasks, weekTasks, index }) {
  const personTasks = tasks.filter(t => t.person === person);
  const personWeekTasks = weekTasks.filter(t => t.person === person);
  const currentMonth = getCurrentMonthKey();
  const currentWeek = getCurrentWeekKey();
  const personMonthTasks = personTasks.filter(t => t.date && t.date.startsWith(currentMonth));
  const monthEarnings = calculateEarnings(personMonthTasks);
  const weekEarnings = calculateEarnings(personWeekTasks);
  const failures = countFailures(tasks, person);
  const todayTasks = personTasks.filter(t => t.date === getLocalDateStr());

  // Pending bonus for the current week — only count if not already persisted
  const currentWeekBonusAlreadyPersisted = personWeekTasks.some(t => isBonusTask(t) && t.week_key === currentWeek);
  const pendingBonus = !currentWeekBonusAlreadyPersisted && checkWeeklyBonus(tasks, person, currentWeek)
    ? WEEKLY_BONUS
    : 0;
  const weekTotal = weekEarnings + pendingBonus;
  const monthTotal = monthEarnings + pendingBonus;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
    >
      <Card className="p-4 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-full -translate-y-8 translate-x-8" />
        
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-2xl">
              {PERSON_AVATARS[person]}
            </div>
            <div>
              <h3 className="font-bold text-lg text-foreground">{person}</h3>
              <p className="text-xs text-muted-foreground">{todayTasks.length} tarefas hoje</p>
            </div>
          </div>
          {failures >= 3 && (
            <Badge variant="destructive" className="text-[10px] gap-1">
              <AlertTriangle className="w-3 h-3" />
              {PENALTIES[person]}
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-muted rounded-xl p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Esta semana</p>
            <p className="text-xl font-bold text-primary mt-0.5">€{weekTotal.toFixed(2)}</p>
            {pendingBonus > 0 && (
              <p className="text-[9px] text-accent font-semibold mt-0.5 flex items-center gap-0.5">
                <Trophy className="w-2.5 h-2.5" />
                inclui +€{pendingBonus.toFixed(2)} bónus
              </p>
            )}
          </div>
          <div className="bg-muted rounded-xl p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Este mês</p>
            <p className="text-xl font-bold text-foreground mt-0.5">€{monthTotal.toFixed(2)}</p>
            {pendingBonus > 0 && (
              <p className="text-[9px] text-accent font-semibold mt-0.5 flex items-center gap-0.5">
                <Trophy className="w-2.5 h-2.5" />
                inclui +€{pendingBonus.toFixed(2)} bónus
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 mt-3">
          <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
            <div 
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${Math.min((failures / 3) * 100, 100)}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground font-medium">{failures}/3 falhas</span>
        </div>
      </Card>
    </motion.div>
  );
}