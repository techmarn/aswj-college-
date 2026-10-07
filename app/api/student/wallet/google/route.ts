import { getGoogleWalletConfigurationStatus } from '../../../../../lib/wallet/config';
import { buildGoogleStudentPassSaveUrl } from '../../../../../lib/wallet/google';
import { loadAuthenticatedStudentPass } from '../../../../../lib/wallet/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Pragma': 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

function privateRedirect(destination: URL) {
  return new Response(null, {
    status: 303,
    headers: { ...NO_STORE_HEADERS, 'Location': destination.toString() },
  });
}

function portalRedirect(request: Request, status: string) {
  const destination = new URL('/student', request.url);
  destination.searchParams.set('wallet', status);
  destination.hash = 'student-pass';
  return privateRedirect(destination);
}

export async function GET(request: Request) {
  try {
    const student = await loadAuthenticatedStudentPass();
    if (student.state === 'unauthenticated') {
      return privateRedirect(new URL('/login', request.url));
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
        ...NO_STORE_HEADERS,
        'Location': saveUrl,
      },
    });
  } catch {
    return portalRedirect(request, 'google_failed');
  }
}
