export {};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireAuth after verifying the access JWT. */
      userId?: string;
    }
  }
}
