// True when both VAPID keys are present. Callers that run outside the Worker
// (GitHub Actions) check this first, so a missing key skips quietly instead of
// logging a failed push for every push-worthy story. Kept free of imports so
// it is cheap to test.
export function pushIsConfigured(): boolean {
  return Boolean(process.env.VAPID_PRIVATE_KEY && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
}
