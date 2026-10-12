import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function StudentPassLandingPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    redirect('/login?next=%2Fstudent%2Fpass');
  }

  redirect('/student#student-pass');
}
