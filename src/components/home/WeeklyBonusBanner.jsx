import { motion } from 'framer-motion';
import { Star, Trophy } from 'lucide-react';
import { PEOPLE, WEEKLY_BONUS, checkWeeklyBonus } from '@/lib/taskHelpers';

export default function WeeklyBonusBanner({ tasks, currentWeek }) {
  const bonusStatus = PEOPLE.map(person => ({
    person,
    earned: checkWeeklyBonus(tasks, person, currentWeek),
  }));

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-gradient-to-br from-primary/10 via-accent/10 to-primary/5 rounded-2xl p-5 border border-primary/20"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center">
          <Trophy className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h3 className="font-bold text-foreground">Bónus Semanal</h3>
          <p className="text-xs text-muted-foreground">+€{WEEKLY_BONUS.toFixed(2)} para quem cumprir tudo</p>
        </div>
      </div>
      <div className="flex gap-2">
        {bonusStatus.map(({ person, earned }) => (
          <div
            key={person}
            className={`flex-1 rounded-xl py-2.5 px-3 text-center transition-all ${
              earned
                ? 'bg-primary/15 border border-primary/30'
                : 'bg-muted/60 border border-transparent'
            }`}
          >
            <Star className={`w-4 h-4 mx-auto mb-1 ${earned ? 'text-accent fill-accent' : 'text-muted-foreground'}`} />
            <p className={`text-xs font-semibold ${earned ? 'text-primary' : 'text-muted-foreground'}`}>
              {person}
            </p>
          </div>
        ))}
      </div>
    </motion.div>
  );
}