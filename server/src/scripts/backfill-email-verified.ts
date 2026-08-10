import mongoose from 'mongoose';
import { env } from '../config/env';
import { User } from '../models/User';
import { logger } from '../utils/logger';

/**
 * Backfill: grandfather existing accounts through the new email-verification
 * sending gate.
 *
 * The gate blocks outreach whenever `emailVerified` is falsy. Accounts created
 * before this feature have no `emailVerified` field at all, so without this
 * backfill every pre-existing user would suddenly be unable to send. We treat
 * "field absent" as "already trusted" and set it to true — only NEW signups
 * (created with the model default of `false`) must verify.
 *
 * Idempotent: it only matches documents where `emailVerified` does not exist,
 * so re-running it is a no-op. Run once after deploying:
 *   pnpm --filter @jobmail/server backfill:email-verified
 */
async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  logger.info(
    { uri: env.MONGODB_URI.replace(/\/\/.*@/, '//<credentials>@') },
    'Connected to MongoDB',
  );

  const res = await User.updateMany(
    { emailVerified: { $exists: false } },
    { $set: { emailVerified: true } },
  );

  logger.info(
    { matched: res.matchedCount, modified: res.modifiedCount },
    'Backfill complete — pre-existing accounts grandfathered as verified',
  );
  // eslint-disable-next-line no-console
  console.log(
    `\n✅ Email-verified backfill done.\n   Matched:  ${res.matchedCount}\n   Modified: ${res.modifiedCount}\n`,
  );
}

main()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error({ err }, 'Backfill failed');
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
