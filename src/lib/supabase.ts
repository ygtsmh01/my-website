import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://lhgkfgwtmpfxyxwyaroh.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_ZElENBh86p0cWQDAnSbNWw_EcOQHmDV';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
