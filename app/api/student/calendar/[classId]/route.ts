import { handleStudentCalendarDownload } from '../../../../../lib/calendar/download-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ classId: string }> }
) {
  return handleStudentCalendarDownload(request, context);
}
