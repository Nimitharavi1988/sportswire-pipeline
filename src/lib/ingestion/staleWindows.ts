// How long a story may wait for a photo / a write-up before autoApprove.ts rejects it (the reasons for 12 hours are kept next to their
// use in autoApprove.ts). In a file of their own (2026-11-13) so the admin page's pipeline health panel (pipelineHealth.ts) can read
// them without importing autoApprove.ts and with it the whole reel and social-posting code: on the Worker that import made /admin fail
// with "Failed to load external module sharp" once the data reel code joined it.
export const STALE_NO_IMAGE_HOURS = 12;
export const STALE_NO_BODY_HOURS = 12;
