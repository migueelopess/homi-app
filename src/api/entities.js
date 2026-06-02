import { supabase } from './supabaseClient';

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

  // Marks the 3 oldest undischarged "not_done" tasks for `person` as having
  // had the punishment applied. Returns the rows actually updated (usually 3,
  // could be fewer if the person doesn't have 3 pending failures).
  async applyPenalty(person, parentId) {
    const { data: pending, error: selErr } = await supabase
      .from('tasks')
      .select('id')
      .eq('person', person)
      .eq('completion_type', 'not_done')
      .is('penalty_applied_at', null)
      .order('date', { ascending: true })
      .order('created_date', { ascending: true })
      .limit(3);
    if (selErr) throw selErr;
    if (!pending || pending.length === 0) return [];

    const ids = pending.map(t => t.id);
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

  // Returns { [person]: 'YYYY-MM-DD' } for the latest paid_through_date per person
  async getLastPaidDates() {
    const { data, error } = await supabase
      .from('payments')
      .select('person, paid_through_date');
    if (error) throw error;
    const map = {};
    for (const row of data || []) {
      if (!map[row.person] || row.paid_through_date > map[row.person]) {
        map[row.person] = row.paid_through_date;
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
