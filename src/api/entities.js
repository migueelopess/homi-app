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
      .single();
    if (error) throw error;
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
      .single();
    if (error) throw error;
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
    return data;
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
