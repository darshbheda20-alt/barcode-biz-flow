-- Add INSERT policy for profiles table as defense-in-depth measure
-- This works in conjunction with the handle_new_user() trigger
CREATE POLICY "Users can create own profile" 
ON public.profiles 
FOR INSERT 
WITH CHECK (auth.uid() = id);