import { COMMON_TASKS, TASK_ICONS } from '@/lib/taskHelpers';
import { motion } from 'framer-motion';

export default function TaskGrid({ selectedTask, onSelect }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {COMMON_TASKS.map((task, i) => {
        const isSelected = selectedTask === task;
        return (
          <motion.button
            key={task}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.02 }}
            onClick={() => onSelect(isSelected ? '' : task)}
            className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl border-2 transition-all text-center ${
              isSelected
                ? 'border-primary bg-primary/8 scale-[1.03] shadow-sm shadow-primary/20'
                : 'border-border bg-card hover:border-primary/30'
            }`}
          >
            <span className="text-2xl">{TASK_ICONS[task] || '✅'}</span>
            <span className={`text-[10px] font-semibold leading-tight ${isSelected ? 'text-primary' : 'text-foreground'}`}>
              {task}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}
