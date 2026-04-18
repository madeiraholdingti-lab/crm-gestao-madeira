-- Create storage bucket for task attachments (audios, files, etc.)
INSERT INTO storage.buckets (id, name, public)
VALUES ('task-attachments', 'task-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- Policy: Anyone can view task attachments (public bucket)
CREATE POLICY "Task attachments are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'task-attachments');

-- Policy: Authenticated users can upload task attachments
CREATE POLICY "Authenticated users can upload task attachments"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'task-attachments' AND auth.role() = 'authenticated');

-- Policy: Authenticated users can update their uploads
CREATE POLICY "Authenticated users can update task attachments"
ON storage.objects FOR UPDATE
USING (bucket_id = 'task-attachments' AND auth.role() = 'authenticated');

-- Policy: Authenticated users can delete task attachments
CREATE POLICY "Authenticated users can delete task attachments"
ON storage.objects FOR DELETE
USING (bucket_id = 'task-attachments' AND auth.role() = 'authenticated');