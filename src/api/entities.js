import { supabase } from './supabaseClient';
import { sameTaskSlot } from '@/lib/taskHelpers';

// Helper to parse Base44-style sort field: '-created_date' → { column: 'created_date', ascending: false }
function parseSort(sortField) {
  if (!sortField) return null;
  const descending = sortField.startsWith('-');
  const column = descending ? sortField.slice(1) : sortField;
  return { column, ascending: !descending };
}

export const TaskService = {
  async list(sortField, limit) {
    let query = supabase.from('tasks').select('*');
    const sort = parseSort(sortField);
    if (sort) query = query.order(sort.column, { ascending: sort.ascending });
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async create(record) {
    const { data, error } = await supabase.from('tasks').insert(record).select().single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (error) throw error;
  },

  async listPending() {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('approval_status', 'pending')
      .order('date', { ascending: false })
      .order('created_date', { ascending: false });
    if (error) throw error;
    return data;
  },

  async approve(id, approverId) {
    const { data, error } = await supabase
      .from('tasks')
      .update({
        approval_status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: approverId ?? null,
      })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`approve: tarefa ${id} não foi atualizada (RLS ou linha inexistente)`);
    return data;
  },

  // Rejection is final: value goes to 0 and completion_type becomes not_done
  // so all existing earnings/bonus/failure logic flows naturally.
  async reject(id, approverId) {
    const { data, error } = await supabase
      .from('tasks')
      .update({
        approval_status: 'rejected',
        approved_at: new Date().toISOString(),
        approved_by: approverId ?? null,
        value: 0,
        completion_type: 'not_done',
      })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`reject: tarefa ${id} não foi atualizada (RLS ou linha inexistente)`);
    return data;
  },

  // Parent bounces a task back to the child to fix a detail. The value is
  // halved once (the `revised` flag prevents re-halving on repeated bounces)
  // and the note is stored for the child. Status becomes 'needs_revision' until
  // the child re-submits.
  async requestRevision(id, note, approverId) {
    const { data: current, error: fetchErr } = await supabase
      .from('tasks')
      .select('value, revised')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!current) throw new Error(`requestRevision: tarefa ${id} não encontrada`);

    const halved = Math.round((current.value / 2) * 100) / 100;
    const newValue = current.revised ? current.value : halved;

    const { data, error } = await supabase
      .from('tasks')
      .update({
        approval_status: 'needs_revision',
        revision_note: note?.trim() || null,
        revised: true,
        value: newValue,
        approved_by: approverId ?? null,
        approved_at: null,
      })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`requestRevision: tarefa ${id} não foi atualizada (RLS ou linha inexistente)`);
    return data;
  },

  // Child re-submits a corrected task with a new photo → back to parents for
  // final approval. Value stays at the already-halved amount.
  async resubmit(id, photo_url) {
    const { data, error } = await supabase
      .from('tasks')
      .update({
        approval_status: 'pending',
        photo_url,
        revision_note: null,
      })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`resubmit: tarefa ${id} não foi atualizada (RLS ou linha inexistente)`);
    return data;
  },

  async bulkApprove(ids, approverId) {
    const { data, error } = await supabase
      .from('tasks')
      .update({
        approval_status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: approverId ?? null,
      })
      .in('id', ids)
      .select();
    if (error) throw error;
    if (!data || data.length < ids.length) {
      throw new Error(`bulkApprove: pedido ${ids.length} tarefas, atualizado ${data?.length ?? 0} (RLS a bloquear UPDATE)`);
    }
    return data;
  },

  // Discharges the oldest undischarged "not_done" tasks for `person` until
  // 3 failures' worth have been consumed. Rows are weighted: a broken
  // delegation carries failure_weight 2, so it alone covers two thirds of a
  // punishment. Returns the rows actually updated (may be fewer than 3 rows,
  // or none if the person has no pending failures).
  async applyPenalty(person, parentId) {
    const { data: pending, error: selErr } = await supabase
      .from('tasks')
      .select('id, task_name, date, end_time, failure_weight')
      .eq('person', person)
      .eq('completion_type', 'not_done')
      .is('penalty_applied_at', null)
      .order('date', { ascending: true })
      .order('created_date', { ascending: true });
    if (selErr) throw selErr;
    if (!pending || pending.length === 0) return [];

    // Exclude occurrences the parents have waived — a cancelled task must
    // never be consumed as a failure, even if a not_done row exists for it.
    const { data: cancels, error: cancelErr } = await supabase
      .from('task_cancellations')
      .select('task_name, task_date, end_time')
      .eq('person', person);
    if (cancelErr) throw cancelErr;

    const notWaived = pending.filter(t => !(cancels || []).some(c =>
      c.task_name === t.task_name &&
      c.task_date === t.date &&
      sameTaskSlot(c.end_time, t.end_time)
    ));

    // Take oldest-first until the accumulated weight reaches 3. The row that
    // crosses the threshold is included whole — we never discharge half a
    // failure, so a 2-weight row consumed at 2/3 still counts as spent.
    const eligible = [];
    let consumed = 0;
    for (const t of notWaived) {
      if (consumed >= 3) break;
      eligible.push(t);
      consumed += t.failure_weight ?? 1;
    }
    if (eligible.length === 0) return [];

    const ids = eligible.map(t => t.id);
    const { data, error } = await supabase
      .from('tasks')
      .update({
        penalty_applied_at: new Date().toISOString(),
        penalty_applied_by: parentId ?? null,
      })
      .in('id', ids)
      .select();
    if (error) throw error;
    return data ?? [];
  },
};

export const ScheduledTaskService = {
  async list() {
    const { data, error } = await supabase.from('scheduled_tasks').select('*');
    if (error) throw error;
    return data;
  },

  async create(record) {
    const { data, error } = await supabase.from('scheduled_tasks').insert(record).select().single();
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase.from('scheduled_tasks').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase.from('scheduled_tasks').delete().eq('id', id);
    if (error) throw error;
  },
};

export const OccasionalTaskService = {
  async list(sortField, limit) {
    let query = supabase.from('occasional_tasks').select('*');
    const sort = parseSort(sortField);
    if (sort) query = query.order(sort.column, { ascending: sort.ascending });
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async create(record) {
    const { data, error } = await supabase.from('occasional_tasks').insert(record).select().single();
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase.from('occasional_tasks').update(updates).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase.from('occasional_tasks').delete().eq('id', id);
    if (error) throw error;
  },
};

export const TaskReminderService = {
  async create(record) {
    const { data, error } = await supabase.from('task_reminders').insert(record).select().single();
    if (error) throw error;
    return data;
  },

  async getByPersonAndDate(person, date) {
    const { data, error } = await supabase
      .from('task_reminders')
      .select('*')
      .eq('person', person)
      .eq('task_date', date);
    if (error) throw error;
    return data;
  },

  async getByDate(date) {
    const { data, error } = await supabase
      .from('task_reminders')
      .select('*')
      .eq('task_date', date);
    if (error) throw error;
    return data;
  },
};

export const TaskDelegationService = {
  async list(sortField, limit) {
    let query = supabase.from('task_delegations').select('*');
    const sort = parseSort(sortField);
    if (sort) query = query.order(sort.column, { ascending: sort.ascending });
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async create(record) {
    const { data, error } = await supabase.from('task_delegations').insert(record).select().single();
    if (error) throw error;
    return data;
  },

  async accept(id, toPerson) {
    // Only accept if still pending (race condition guard)
    const { data, error } = await supabase
      .from('task_delegations')
      .update({ to_person: toPerson, status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'pending')
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getByDate(date) {
    const { data, error } = await supabase
      .from('task_delegations')
      .select('*')
      .eq('task_date', date);
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase.from('task_delegations').delete().eq('id', id);
    if (error) throw error;
  },
};

export const TaskExtensionService = {
  async getByDate(date) {
    const { data, error } = await supabase
      .from('task_extensions')
      .select('*')
      .eq('task_date', date);
    if (error) throw error;
    return data;
  },

  async create(record) {
    const { data, error } = await supabase
      .from('task_extensions')
      .insert(record)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};

export const TaskCancellationService = {
  async getByDate(date) {
    const { data, error } = await supabase
      .from('task_cancellations')
      .select('*')
      .eq('task_date', date);
    if (error) throw error;
    return data;
  },

  async list() {
    const { data, error } = await supabase
      .from('task_cancellations')
      .select('*');
    if (error) throw error;
    return data;
  },

  async create(record) {
    const { data, error } = await supabase
      .from('task_cancellations')
      .insert(record)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase.from('task_cancellations').delete().eq('id', id);
    if (error) throw error;
  },
};

export const PaymentService = {
  async list() {
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .order('paid_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  // Returns { [person]: 'ISO timestamp' } for the latest payment *moment* per
  // person. The boundary is when the parent paid (paid_at), not the calendar
  // day (paid_through_date): otherwise a task completed later the same day as a
  // payment would be wrongly treated as already paid. ISO strings are lexically
  // ordered, so a string compare finds the latest correctly.
  async getLastPaidAt() {
    const { data, error } = await supabase
      .from('payments')
      .select('person, paid_at');
    if (error) throw error;
    const map = {};
    for (const row of data || []) {
      if (row.paid_at && (!map[row.person] || row.paid_at > map[row.person])) {
        map[row.person] = row.paid_at;
      }
    }
    return map;
  },

  async create({ person, paid_through_date, paid_by }) {
    const { data, error } = await supabase
      .from('payments')
      .insert({ person, paid_through_date, paid_by: paid_by ?? null })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async createBulk(rows) {
    const { data, error } = await supabase
      .from('payments')
      .insert(rows)
      .select();
    if (error) throw error;
    return data;
  },
};

export const CleanupLogService = {
  async getLastCleanupDate() {
    const { data, error } = await supabase
      .from('cleanup_log')
      .select('cleaned_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data?.cleaned_at || null;
  },
};
