import { User } from '../../models/User';
import { decrypt } from '../../utils/crypto';
import { clearAccessTokenCache, isInvalidGrant } from '../mailer';
import { createOAuthClient, isOAuthConfigured } from './oauth';
import { logger } from '../../utils/logger';

/**
 * Proactive Gmail connection health (Gap H). A daily sweep validates each
 * connected user's refresh token against Google and flips revoked/expired ones
 * to `needsReconnect`, so users get an in-app "reconnect Gmail" prompt BEFORE
 * their next campaign silently fails — instead of discovering it on a failed send.
 *
 * Best-effort per user: a transient error (network, rate limit) is skipped and
 * retried next sweep; only a definitive invalid_grant flips the flag. At large
 * scale this should paginate + rate-limit the Google calls; today the connected
 * cohort is small enough for a single daily pass.
 */
export async function processGmailHealthCheck(): Promise<void> {
  if (!isOAuthConfigured()) return;

  const users = await User.find({
    'gmailAuth.connectedEmail': { $ne: null },
    'gmailAuth.needsReconnect': { $ne: true },
  }).select('+gmailAuth.refreshTokenEnc');

  let flagged = 0;
  for (const user of users) {
    const enc = user.gmailAuth?.refreshTokenEnc;
    if (!enc) continue;
    try {
      const client = createOAuthClient();
      client.setCredentials({ refresh_token: decrypt(enc) });
      await client.getAccessToken(); // throws invalid_grant if the grant is dead
    } catch (err) {
      if (isInvalidGrant(err)) {
        // Guard on the exact token we validated so a reconnect that landed during
        // this sweep isn't clobbered back to needs_reconnect.
        const res = await User.updateOne(
          { _id: user._id, 'gmailAuth.refreshTokenEnc': enc },
          { $set: { 'gmailAuth.needsReconnect': true } },
        );
        if (res.modifiedCount > 0) {
          clearAccessTokenCache(String(user._id));
          flagged += 1;
        }
      } else {
        logger.warn({ err, userId: String(user._id) }, 'Gmail health check: transient error — will retry');
      }
    }
  }

  if (flagged > 0) {
    logger.info({ flagged }, 'Gmail health check flagged connections needing reconnect');
  }
}
