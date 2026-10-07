import 'server-only';

import { createSupabaseServerClient } from '../supabase/server';
import { loadStudentWalletPassData } from './student-pass-data';

export async function loadAuthenticatedStudentPass() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return { state: 'unauthenticated' as const };
  }

  const pass = await loadStudentWalletPassData(supabase, user.id);
  if (!pass) {
    return { state: 'ineligible' as const };
  }

  return { state: 'ready' as const, pass };
}
