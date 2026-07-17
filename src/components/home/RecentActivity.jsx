import { COMPLETION_TYPES, getTaskIcon, isBonusTask } from '@/lib/taskHelpers';
import { format, parse } from 'date-fns';
import { pt } from 'date-fns/locale';
import { motion } from 'framer-motion';

export default function RecentActivity({ tasks }) {
  const recent = [...tasks]
    .sort((a, b) => b.date.localeCompare(a.date) || new Date(b.created_date) - new Date(a.created_date))
    .slice(0, 8);

  if (recent.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p className="text-sm">Ainda não há tarefas registadas</p>
        <p className="text-xs mt-1">Regista a tua primeira tarefa!</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {recent.map((task, i) => {
        const ct = COMPLETION_TYPES[task.completion_type];
        const bonus = isBonusTask(task);
        const cancelled = task.completion_type === 'cancelled';
        const missed = task.completion_type === 'not_done';
        return (
          <motion.div
            key={task.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
              bonus
                ? 'bg-accent/10 border-accent/30'
                : missed
                  ? 'bg-destructive/5 border-destructive/30'
                  : 'bg-card border-border hover:border-primary/20'
            }`}
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0 ${
              bonus ? 'bg-accent/20' : missed ? 'bg-destructive/10' : 'bg-muted'
            }`}>
              {getTaskIcon(task.task_name)}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium truncate ${missed ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{task.task_name}</p>
              <p className="text-[11px] text-muted-foreground">
                {task.person} · {task.date ? format(parse(task.date, 'yyyy-MM-dd', new Date()), "d MMM", { locale: pt }) : ''}
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              {cancelled ? (
                <p className="text-[11px] font-semibold text-muted-foreground leading-none">🚫 Cancelada</p>
              ) : missed ? (
                <p className="text-base font-extrabold text-destructive leading-none">✕</p>
              ) : (
                <>
                  <p className={`text-sm font-bold ${bonus ? 'text-accent' : (ct?.color || 'text-foreground')}`}>
                    +€{(task.value || 0).toFixed(2)}
                  </p>
                  <p className="text-[10px]">{bonus ? '🏆' : ct?.emoji}</p>
                </>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}