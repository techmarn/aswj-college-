import { buildAppleStudentPass } from '../../../../../lib/wallet/apple';
import { getAppleWalletConfigurationStatus } from '../../../../../lib/wallet/config';
import { loadAuthenticatedStudentPass } from '../../../../../lib/wallet/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Disposition': 'attachment; filename="aswj-student-pass.pkpass"',
  'Pragma': 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

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

    const configuration = getAppleWalletConfigurationStatus();
    if (configuration.state !== 'ready') {
      return portalRedirect(request, 'apple_setup');
    }

    const signedPass = await buildAppleStudentPass(student.pass, configuration.config);
    return signedPass.toResponse({ headers: PRIVATE_HEADERS });
  } catch {
    return portalRedirect(request, 'apple_failed');
  }
}
