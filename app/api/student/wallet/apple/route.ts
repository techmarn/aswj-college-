import { buildAppleStudentPass } from '../../../../../lib/wallet/apple';
import { getAppleWalletConfigurationStatus } from '../../../../../lib/wallet/config';
import { loadAuthenticatedStudentPass } from '../../../../../lib/wallet/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Pragma': 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

const PASS_HEADERS = {
  ...NO_STORE_HEADERS,
  'Content-Disposition': 'attachment; filename="aswj-student-pass.pkpass"',
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

    const configuration = getAppleWalletConfigurationStatus();
    if (configuration.state !== 'ready') {
      return portalRedirect(request, 'apple_setup');
    }

    const signedPass = await buildAppleStudentPass(student.pass, configuration.config);
    return signedPass.toResponse({ headers: PASS_HEADERS });
  } catch {
    return portalRedirect(request, 'apple_failed');
  }
}
