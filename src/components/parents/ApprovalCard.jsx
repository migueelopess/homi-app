import { motion } from 'framer-motion';
import { Check, X, Loader2, ImageOff } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { COMPLETION_TYPES, getTaskIcon } from '@/lib/taskHelpers';
import { format, parse } from 'date-fns';
import { pt } from 'date-fns/locale';

export default function ApprovalCard({ task, onApprove, onReject, onPhotoClick, isPending }) {
  const ct = COMPLETION_TYPES[task.completion_type];
  const dateLabel = task.date
    ? format(parse(task.date, 'yyyy-MM-dd', new Date()), "d MMM", { locale: pt })
    : '';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
    >
      <Card className="overflow-hidden">
        {task.photo_url ? (
          <button
            onClick={() => onPhotoClick(task.photo_url)}
            className="block w-full"
          >
            <img
              src={task.photo_url}
              alt={task.task_name}
              className="w-full aspect-video object-cover"
            />
          </button>
        ) : (
          <div className="w-full aspect-video bg-muted flex items-center justify-center text-muted-foreground gap-2">
            <ImageOff className="w-5 h-5" />
            <span className="text-sm">Sem foto</span>
          </div>
        )}

        <div className="p-3">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xl shrink-0">{getTaskIcon(task.task_name)}</span>
              <div className="min-w-0">
                <p className="font-semibold text-sm text-foreground truncate">{task.task_name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {dateLabel} · {ct?.emoji} {ct?.label}
                </p>
              </div>
            </div>
            <span className={`text-sm font-bold whitespace-nowrap ${ct?.color}`}>
              €{(task.value || 0).toFixed(2)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => onReject(task)}
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
              Rejeitar
            </Button>
            <Button
              size="sm"
              disabled={isPending}
              onClick={() => onApprove(task)}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Aprovar
            </Button>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
