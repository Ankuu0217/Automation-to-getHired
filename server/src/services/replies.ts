import type { IApplication } from '../models/Application';
import { EmailEvent } from '../models/EmailEvent';
import { incrementTemplateStat } from '../models/EmailTemplate';
import { stopFollowUpSequence } from './queue';

/**
 * Shared reply bookkeeping (SPEC §5): used by the phase-1 manual
 * "Mark as replied" route and by the phase-2 reply-detection service.
 *
 * Stamps repliedAt on the latest sent email (first reply wins — idempotent),
 * advances stage applied → hr_screen (later stages never clobbered), records
 * the `reply` EmailEvent, bumps the template's replied stat on first reply,
 * and cancels the pending follow-up sequence. Returns whether anything changed.
 */
export async function markLatestEmailReplied(
  application: IApplication,
  meta: Record<string, unknown>,
): Promise<boolean> {
  // Latest sent email subdoc (thread appends, so scan from the end).
  let latestSentIndex = -1;
  for (let i = application.emails.length - 1; i >= 0; i -= 1) {
    if (application.emails[i].sentAt) {
      latestSentIndex = i;
      break;
    }
  }
  if (latestSentIndex < 0 || application.emails[latestSentIndex].repliedAt) return false;

  application.emails[latestSentIndex].repliedAt = new Date();
  if (application.stage === 'applied') application.stage = 'hr_screen';
  await application.save();

  await EmailEvent.create({ applicationId: application._id, kind: 'reply', meta });
  await incrementTemplateStat(application.templateId, 'replied');
  await stopFollowUpSequence(String(application._id));
  return true;
}
