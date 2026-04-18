-- Add user_id column to task_flow_profiles to link with system users
ALTER TABLE public.task_flow_profiles 
ADD COLUMN user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Create index for better query performance
CREATE INDEX idx_task_flow_profiles_user_id ON public.task_flow_profiles(user_id);