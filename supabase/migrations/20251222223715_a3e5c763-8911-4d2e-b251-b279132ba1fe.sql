-- Create storage bucket for lead attachments
INSERT INTO storage.buckets (id, name, public)
VALUES ('lead-attachments', 'lead-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for lead-attachments bucket
CREATE POLICY "Authenticated users can upload lead attachments"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'lead-attachments');

CREATE POLICY "Anyone can view lead attachments"
ON storage.objects FOR SELECT
USING (bucket_id = 'lead-attachments');

CREATE POLICY "Authenticated users can delete lead attachments"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'lead-attachments');

-- Create comments table for leads
CREATE TABLE public.lead_comments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  autor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create attachments table for lead comments
CREATE TABLE public.lead_comment_attachments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  comment_id UUID NOT NULL REFERENCES public.lead_comments(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.lead_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_comment_attachments ENABLE ROW LEVEL SECURITY;

-- RLS policies for lead_comments
CREATE POLICY "Authenticated users can view lead comments"
ON public.lead_comments FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can create lead comments"
ON public.lead_comments FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can delete own comments"
ON public.lead_comments FOR DELETE
TO authenticated
USING (autor_id = auth.uid());

-- RLS policies for lead_comment_attachments
CREATE POLICY "Authenticated users can view lead comment attachments"
ON public.lead_comment_attachments FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can create lead comment attachments"
ON public.lead_comment_attachments FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can delete own attachments"
ON public.lead_comment_attachments FOR DELETE
TO authenticated
USING (
  comment_id IN (
    SELECT id FROM public.lead_comments WHERE autor_id = auth.uid()
  )
);