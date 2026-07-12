import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, Loader2, ImageOff, PencilLine } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { COMPLETION_TYPES, getTaskIcon } from '@/lib/taskHelpers';
import { format, parse } from 'date-fns';
import { pt } from 'date-fns/locale';

export default function ApprovalCard({ task, onApprove, onReject, onRequestRevision, onPhotoClick, isPending }) {
  const ct = COMPLETION_TYPES[task.completion_type];
  const dateLabel = task.date
    ? format(parse(task.date, 'yyyy-MM-dd', new Date()), "d MMM", { locale: pt })
    : '';

  const [revising, setRevising] = useState(false);
  const [note, setNote] = useState('');

  const value = task.value || 0;
  const willHalve = !task.revised;            // value is only halved on the first bounce
  const halvedValue = Math.round((value / 2) * 100) / 100;
  const nextValue = willHalve ? halvedValue : value;
  const isResubmission = task.revised;

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
                <p className="font-semibold text-sm text-foreground truncate">
                  {task.task_name}
                  {isResubmission && (
                    <span className="ml-1.5 text-[10px] font-semibold text-orange-600 dark:text-orange-400">· corrigida</span>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {task.person} · {dateLabel} · {ct?.emoji} {ct?.label}
                </p>
              </div>
            </div>
            <span className={`text-sm font-bold whitespace-nowrap ${ct?.color}`}>
              €{value.toFixed(2)}
            </span>
          </div>

          <AnimatePresence mode="wait">
            {revising ? (
              <motion.div
                key="revising"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-2"
              >
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder={`O que ${task.person} tem de corrigir?`}
                  rows={2}
                  autoFocus
                  className="w-full text-sm rounded-xl border border-border bg-background p-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <p className="text-[11px] text-muted-foreground px-0.5">
                  {willHalve
                    ? <>Volta para {task.person} corrigir. Valor: <span className="font-semibold text-foreground">€{value.toFixed(2)} → €{nextValue.toFixed(2)}</span> (metade).</>
                    : <>Volta para {task.person} corrigir. Valor mantém-se em <span className="font-semibold text-foreground">€{value.toFixed(2)}</span> (já reduzido).</>}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={() => { setRevising(false); setNote(''); }}
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    disabled={isPending || !note.trim()}
                    onClick={() => onRequestRevision(task, note.trim())}
                    className="bg-orange-500 text-white hover:bg-orange-500/90"
                  >
                    {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <PencilLine className="w-4 h-4" />}
                    Enviar
                  </Button>
                </div>
              </motion.div>
            ) : (
              <motion.div key="actions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
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
                <button
                  disabled={isPending}
                  onClick={() => setRevising(true)}
                  className="w-full mt-2 flex items-center justify-center gap-1.5 h-9 rounded-lg text-xs font-semibold text-orange-600 dark:text-orange-400 hover:bg-orange-500/10 transition-colors disabled:opacity-40"
                >
                  <PencilLine className="w-3.5 h-3.5" /> Mandar corrigir (½ valor)
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Card>
    </motion.div>
  );
}
