import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { OccasionalTaskService } from '@/api/entities';
import { INVALIDATE } from '@/lib/queries';
import { sendPushNotification } from '@/api/supabaseClient';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Trash2, Plus, Clock, Calendar, Euro } from 'lucide-react';
import { toast } from 'sonner';
import { PEOPLE, PERSON_AVATARS, COMMON_TASKS, TASK_ICONS, getLocalDateStr } from '@/lib/taskHelpers';

function formatTaskDateLabel(dateStr) {
  const today = getLocalDateStr();
  const tmrDate = new Date();
  tmrDate.setDate(tmrDate.getDate() + 1);
  const tomorrow = getLocalDateStr(tmrDate);
  if (dateStr === today) return 'hoje';
  if (dateStr === tomorrow) return 'amanhã';
  const [y, m, d] = dateStr.split('-');
  return `${d}-${m}-${y}`;
}
import { format, parse } from 'date-fns';
import { pt } from 'date-fns/locale';

export default function OccasionalTaskManager({ occasionalTasks }) {
  const queryClient = useQueryClient();
  const [selectedPersons, setSelectedPersons] = useState([PEOPLE[0]]);

  const togglePerson = (p) => {
    setSelectedPersons(prev =>
      prev.includes(p) ? (prev.length > 1 ? prev.filter(x => x !== p) : prev) : [...prev, p]
    );
  };
  const [form, setForm] = useState({
    task_name: '',
    custom_task: '',
    date: getLocalDateStr(),
    end_time: '',
    notes: '',
    reward: '',
  });
  const [showCustom, setShowCustom] = useState(false);

  const createMutation = useMutation({
    mutationFn: (data) => OccasionalTaskService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INVALIDATE.occasionalTasks });
      setForm({ task_name: '', custom_task: '', date: getLocalDateStr(), end_time: '', notes: '', reward: '' });
      setShowCustom(false);
      toast.success('Tarefa ocasional criada!');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => OccasionalTaskService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INVALIDATE.occasionalTasks });
      toast.success('Tarefa removida');
    },
  });

  const handleSubmit = () => {
    const taskName = form.task_name === 'custom' ? form.custom_task : form.task_name;
    if (!taskName || !form.date) {
      toast.error('Preenche a tarefa e a data!');
      return;
    }
    selectedPersons.forEach(person => {
      createMutation.mutate({
        person,
        task_name: taskName,
        date: form.date,
        end_time: form.end_time || null,
        notes: form.notes || null,
        reward: form.reward ? parseFloat(form.reward) : 0,
        completed: false,
      });

      // Notify the assigned person via push
      sendPushNotification({
        person,
        title: `📋 Nova tarefa: ${taskName}`,
        body: form.end_time ? `Até às ${form.end_time} — ${formatTaskDateLabel(form.date)}` : `Para ${formatTaskDateLabel(form.date)}`,
        tag: `new-task-${person}-${form.date}`,
      });
    });
    setForm({ task_name: '', custom_task: '', date: getLocalDateStr(), end_time: '', notes: '', reward: '' });
    setShowCustom(false);
  };

  const today = getLocalDateStr();
  const [viewPerson, setViewPerson] = useState(PEOPLE[0]);
  const personTasks = occasionalTasks
    .filter(t => t.person === viewPerson)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const upcoming = personTasks.filter(t => t.date >= today);
  const past = personTasks.filter(t => t.date < today);

  return (
    <div className="space-y-4">
      {/* Person selector for assigning */}
      <div className="mb-1">
        <p className="text-xs text-muted-foreground mb-1.5 font-medium">Atribuir a:</p>
        <div className="flex gap-2">
          {PEOPLE.map(p => (
            <button
              key={p}
              onClick={() => togglePerson(p)}
              className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-xl border-2 transition-all ${
                selectedPersons.includes(p) ? 'border-primary bg-primary/5' : 'border-border opacity-50'
              }`}
            >
              <span className="text-xl">{PERSON_AVATARS[p]}</span>
              <span className="text-xs font-semibold">{p}</span>
            </button>
          ))}
        </div>
        {selectedPersons.length > 1 && (
          <p className="text-xs text-primary font-medium mt-1.5 text-center">A tarefa será criada para {selectedPersons.join(', ')}</p>
        )}
      </div>

      {/* Add form */}
      <Card className="p-4 space-y-3">
        <h4 className="text-sm font-bold text-foreground flex items-center gap-2">
          <Plus className="w-4 h-4" /> Nova tarefa para {selectedPersons.join(', ')}
        </h4>

        {/* Task name */}
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Tarefa</Label>
          <div className="grid grid-cols-3 gap-1.5 mb-2">
            {COMMON_TASKS.slice(0, 9).map(task => (
              <button
                key={task}
                onClick={() => { setForm(f => ({ ...f, task_name: task })); setShowCustom(false); }}
                className={`flex flex-col items-center gap-1 p-2 rounded-xl border text-center transition-all ${
                  form.task_name === task ? 'border-primary bg-primary/5' : 'border-border'
                }`}
              >
                <span className="text-lg">{TASK_ICONS[task] || '✅'}</span>
                <span className="text-[9px] font-medium leading-tight">{task}</span>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1.5 mb-2">
            {COMMON_TASKS.slice(9, 18).map(task => (
              <button
                key={task}
                onClick={() => { setForm(f => ({ ...f, task_name: task })); setShowCustom(false); }}
                className={`flex flex-col items-center gap-1 p-2 rounded-xl border text-center transition-all ${
                  form.task_name === task ? 'border-primary bg-primary/5' : 'border-border'
                }`}
              >
                <span className="text-lg">{TASK_ICONS[task] || '✅'}</span>
                <span className="text-[9px] font-medium leading-tight">{task}</span>
              </button>
            ))}
          </div>
          <button
            onClick={() => { setShowCustom(true); setForm(f => ({ ...f, task_name: 'custom' })); }}
            className={`w-full p-2 rounded-xl border text-xs text-muted-foreground transition-all ${
              form.task_name === 'custom' ? 'border-primary bg-primary/5' : 'border-dashed border-border'
            }`}
          >
            + Outra tarefa
          </button>
          {showCustom && (
            <Input
              className="mt-2 h-10 rounded-xl"
              placeholder="Nome da tarefa..."
              value={form.custom_task}
              onChange={e => setForm(f => ({ ...f, custom_task: e.target.value }))}
            />
          )}
        </div>

        {/* Date */}
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block flex items-center gap-1">
            <Calendar className="w-3 h-3" /> Data
          </Label>
          <Input
            type="date"
            value={form.date}
            onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
            className="h-10 rounded-xl"
          />
        </div>

        {/* Time */}
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block flex items-center gap-1">
            <Clock className="w-3 h-3" /> Até que horas? (opcional)
          </Label>
          <Input
            type="time"
            value={form.end_time}
            onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))}
            className="h-10 rounded-xl"
          />
        </div>

        {/* Reward */}
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block flex items-center gap-1">
            <Euro className="w-3 h-3" /> Recompensa (€)
          </Label>
          <div className="flex gap-1.5">
            {[0.25, 0.50, 1.00, 1.50, 2.00].map(v => (
              <button
                key={v}
                type="button"
                onClick={() => setForm(f => ({ ...f, reward: String(v) }))}
                className={`flex-1 py-2 rounded-xl border text-xs font-semibold transition-all ${
                  parseFloat(form.reward) === v ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'
                }`}
              >
                €{v.toFixed(2)}
              </button>
            ))}
          </div>
          <Input
            type="number"
            min="0"
            step="0.25"
            className="mt-2 h-10 rounded-xl"
            placeholder="Outro valor..."
            value={form.reward}
            onChange={e => setForm(f => ({ ...f, reward: e.target.value }))}
          />
        </div>

        {/* Notes */}
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">Notas (opcional)</Label>
          <Input
            className="h-10 rounded-xl"
            placeholder="Ex: lavar o carro antes das 18h..."
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          />
        </div>

        <Button
          onClick={handleSubmit}
          disabled={createMutation.isPending}
          className="w-full h-10 rounded-xl font-semibold"
        >
          Adicionar Tarefa
        </Button>
      </Card>

      {/* View person selector */}
      <div className="flex gap-2">
        {PEOPLE.map(p => (
          <button
            key={p}
            onClick={() => setViewPerson(p)}
            className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-xl border-2 transition-all ${
              viewPerson === p ? 'border-primary bg-primary/5' : 'border-border'
            }`}
          >
            <span className="text-xl">{PERSON_AVATARS[p]}</span>
            <span className="text-xs font-semibold">{p}</span>
          </button>
        ))}
      </div>

      {/* Upcoming tasks */}
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-foreground">
          📌 A fazer — {viewPerson} ({upcoming.length})
        </h4>
        {upcoming.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">Sem tarefas agendadas</p>
        ) : (
          upcoming.map(task => (
            <Card key={task.id} className="p-3 flex items-center gap-3">
              <span className="text-xl">{TASK_ICONS[task.task_name] || '✅'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">{task.task_name}</p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-[11px] text-primary font-medium">
                    {format(parse(task.date, 'yyyy-MM-dd', new Date()), "d MMM", { locale: pt })}
                  </span>
                  {task.end_time && (
                    <span className="text-[11px] text-muted-foreground flex items-center gap-0.5">
                      <Clock className="w-3 h-3" /> até às {task.end_time}
                    </span>
                  )}
                </div>
                {task.notes && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{task.notes}</p>}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={() => deleteMutation.mutate(task.id)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </Card>
          ))
        )}
      </div>

      {/* Past tasks */}
      {past.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-bold text-muted-foreground">Anteriores ({past.length})</h4>
          {past.slice(-5).reverse().map(task => (
            <Card key={task.id} className="p-3 flex items-center gap-3 opacity-60">
              <span className="text-xl">{TASK_ICONS[task.task_name] || '✅'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground line-through">{task.task_name}</p>
                <span className="text-[11px] text-muted-foreground">
                  {format(parse(task.date, 'yyyy-MM-dd', new Date()), "d MMM", { locale: pt })}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={() => deleteMutation.mutate(task.id)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}