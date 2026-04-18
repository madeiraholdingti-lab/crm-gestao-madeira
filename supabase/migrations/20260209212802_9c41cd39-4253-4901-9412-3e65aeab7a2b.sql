
-- Add soft-delete columns to task_flow_tasks
ALTER TABLE public.task_flow_tasks 
  ADD COLUMN deleted_at timestamptz DEFAULT NULL,
  ADD COLUMN deleted_by uuid DEFAULT NULL;

-- Index for filtering active tasks efficiently
CREATE INDEX idx_task_flow_tasks_deleted_at ON public.task_flow_tasks(deleted_at) WHERE deleted_at IS NULL;

-- Create a table to store deleted tasks info for the history view
-- (the task itself stays in task_flow_tasks with deleted_at set)

-- Function to auto-cleanup tasks deleted more than 30 days ago
CREATE OR REPLACE FUNCTION public.cleanup_deleted_tasks()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete related data first
  DELETE FROM task_flow_comments WHERE task_id IN (
    SELECT id FROM task_flow_tasks WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM task_flow_checklists WHERE task_id IN (
    SELECT id FROM task_flow_tasks WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM task_flow_history WHERE task_id IN (
    SELECT id FROM task_flow_tasks WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM task_flow_task_tags WHERE task_id IN (
    SELECT id FROM task_flow_tasks WHERE deleted_at < now() - interval '30 days'
  );
  DELETE FROM task_flow_attachments WHERE task_id IN (
    SELECT id FROM task_flow_tasks WHERE deleted_at < now() - interval '30 days'
  );
  -- Finally delete the tasks
  DELETE FROM task_flow_tasks WHERE deleted_at < now() - interval '30 days';
END;
$$;

-- Schedule cleanup via pg_cron (run daily at 3am)
SELECT cron.schedule(
  'cleanup-deleted-tasks',
  '0 3 * * *',
  $$SELECT public.cleanup_deleted_tasks()$$
);
