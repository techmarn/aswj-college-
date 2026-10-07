import { getGoogleWalletConfigurationStatus } from '../../../../../lib/wallet/config';
import { buildGoogleStudentPassSaveUrl } from '../../../../../lib/wallet/google';
import { loadAuthenticatedStudentPass } from '../../../../../lib/wallet/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function portalRedirect(request: Request, status: string) {
  const destination = new URL('/student', request.url);
  destination.searchParams.set('wallet', status);
  destination.hash = 'student-pass';
  return Response.redirect(destination, 303);
}

export async function GET(request: Request) {
  try {
    const student = await loadAuthenticatedStudentPass();
    if (student.state === 'unauthenticated') {
      return Response.redirect(new URL('/login', request.url), 303);
    }
    if (student.state !== 'ready') {
      return portalRedirect(request, 'not_eligible');
    }

    const configuration = getGoogleWalletConfigurationStatus();
    if (configuration.state !== 'ready') {
      return portalRedirect(request, 'google_setup');
    }

    const saveUrl = await buildGoogleStudentPassSaveUrl(
      student.pass,
      configuration.config
    );
    return new Response(null, {
      status: 303,
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
        'Location': saveUrl,
        'Pragma': 'no-cache',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return portalRedirect(request, 'google_failed');
  }
}
