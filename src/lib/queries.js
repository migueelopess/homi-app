import {
  TaskService, ScheduledTaskService, OccasionalTaskService,
  TaskDelegationService, TaskCancellationService, TaskExtensionService,
  TaskReminderService, PaymentService,
} from '@/api/entities';

// Single source of truth for the shared server queries.
//
// These used to be spelled out at every call site, and two pages asking for
// the "same" data under the same key with different arguments is a silent bug:
// React Query keeps one cache entry per key, so whichever page mounted first
// decided what everybody got. Tarefas asked for 2000 task rows while every
// other page asked for 500 — open Início first and Tarefas quietly rendered
// off a truncated list, showing work as not done when it had been done.
//
// The same applies to invalidation: a page that writes must invalidate the key
// the readers actually use. Keeping the keys here, next to each other, is what
// makes that checkable.

// Comfortably more than a month of family activity, and under PostgREST's
// default ceiling. The monthly cleanup keeps the table well inside it.
export const TASKS_LIMIT = 1000;

export const tasksQuery = () => ({
  queryKey: ['tasks'],
  queryFn: () => TaskService.list('-created_date', TASKS_LIMIT),
});

// One calendar day. Prefixed with 'tasks' on purpose: invalidating ['tasks']
// refreshes this too.
export const tasksByDateQuery = (date) => ({
  queryKey: ['tasks', 'byDate', date],
  queryFn: () => TaskService.listByDate(date),
});

export const pendingTasksQuery = () => ({
  queryKey: ['pendingTasks'],
  queryFn: () => TaskService.listPending(),
});

export const scheduledTasksQuery = () => ({
  queryKey: ['scheduledTasks'],
  queryFn: () => ScheduledTaskService.list(),
});

export const occasionalTasksQuery = () => ({
  queryKey: ['occasionalTasks'],
  queryFn: () => OccasionalTaskService.list('-date', 500),
});

export const delegationsQuery = () => ({
  queryKey: ['taskDelegations'],
  queryFn: () => TaskDelegationService.list('-created_at'),
});

export const cancellationsQuery = () => ({
  queryKey: ['taskCancellations', 'all'],
  queryFn: () => TaskCancellationService.list(),
});

export const cancellationsByDateQuery = (date) => ({
  queryKey: ['taskCancellations', 'byDate', date],
  queryFn: () => TaskCancellationService.getByDate(date),
});

export const extensionsByDateQuery = (date) => ({
  queryKey: ['taskExtensions', 'byDate', date],
  queryFn: () => TaskExtensionService.getByDate(date),
});

// One key for everyone. This was the sharpest of the mismatches: the children's
// screens read reminders under ['taskReminders', person, date] while the
// parents' page invalidated ['taskReminders', date], which matches neither. A
// reminder sent by a parent therefore never reached the child's cache, and the
// child registered the task at full value instead of half. RLS already limits
// a child to their own reminders, so fetching by date alone is equivalent.
export const remindersByDateQuery = (date) => ({
  queryKey: ['taskReminders', 'byDate', date],
  queryFn: () => TaskReminderService.getByDate(date),
});

export const lastPaidAtQuery = () => ({
  queryKey: ['payments', 'last-at'],
  queryFn: () => PaymentService.getLastPaidAt(),
});

// Invalidate by prefix, never by an exact dated key: the same table is read
// under several keys ('all', 'byDate', ...) and only the prefix reaches them
// all.
export const INVALIDATE = {
  tasks: ['tasks'],
  pendingTasks: ['pendingTasks'],
  scheduledTasks: ['scheduledTasks'],
  occasionalTasks: ['occasionalTasks'],
  delegations: ['taskDelegations'],
  cancellations: ['taskCancellations'],
  extensions: ['taskExtensions'],
  reminders: ['taskReminders'],
  payments: ['payments'],
};
