// Instagram's media_publish sometimes answers with an error ("Fatal") although the reel was published. 13 of 13 such failures in
// 24 hours (2026-10-30/31) had a live reel on the account within 30 seconds. Recording them as failed left the story open to a
// second attempt, so the same reel could be posted twice, and under-counted the day's posts. After a publish error this asks Instagram
// whether the container was in fact published and, if so, returns the reel's id. Pure apart from the injected fetch; unit-tested.

type FetchLike = (url: string) => Promise<{ ok: boolean; json: () => Promise<any> }>;

export async function recoverPublishedReel(opts: {
  graph: string; // e.g. https://graph.facebook.com/v21.0
  igUserId: string;
  accessToken: string;
  containerId: string;
  sinceMs: number; // when the publish call started; a reel older than this is not the one
  fetchFn?: FetchLike;
  waits?: number[]; // seconds before each status check (the status can lag the publish by a few seconds)
  sleep?: (ms: number) => Promise<void>;
}): Promise<string | null> {
  const fetchFn: FetchLike = opts.fetchFn ?? ((u) => fetch(u));
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const waits = opts.waits ?? [0, 4, 8];
  const token = encodeURIComponent(opts.accessToken);
  for (const w of waits) {
    if (w) await sleep(w * 1000);
    try {
      const st = await (await fetchFn(`${opts.graph}/${opts.containerId}?fields=status_code&access_token=${token}`)).json();
      if (st?.status_code === "PUBLISHED") {
        // The reel's own id: the account's newest reel since the call started. Without it, the container id still marks it posted.
        const list = await (await fetchFn(`${opts.graph}/${opts.igUserId}/media?fields=id,media_product_type,timestamp&limit=5&access_token=${token}`)).json();
        const mine = (list?.data ?? []).find((m: any) => m.media_product_type === "REELS" && new Date(m.timestamp).getTime() >= opts.sinceMs);
        return (mine?.id as string | undefined) ?? opts.containerId;
      }
      if (st?.status_code === "ERROR" || st?.status_code === "EXPIRED") return null;
    } catch {
      // a failed status check is no proof either way; try again, then give up
    }
  }
  return null;
}

// The parts of a Graph API error worth logging (never the token): code, subcode, type and the trace id Meta asks for in a report.
export function graphErrorDetail(data: any): string {
  const e = data?.error;
  if (!e) return "";
  return JSON.stringify({ code: e.code, subcode: e.error_subcode, type: e.type, trace: e.fbtrace_id, user: e.error_user_msg });
}
