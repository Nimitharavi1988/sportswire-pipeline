// Every request to ESPN's public API goes through here. ESPN's edge refuses
// requests without ordinary client headers — confirmed 2026-09-26: no
// User-Agent, or a bare custom one, gets 403; the same request with
// Accept / Accept-Language / Sec-Fetch-Mode gets 200. Cloudflare Workers
// send no User-Agent at all, which is why ESPN calls made while rendering
// pages failed silently on the live site. Identifies the site honestly.
const ESPN_HEADERS: Record<string, string> = {
  // Plain product token: ESPN also refuses a User-Agent containing a URL
  // ("SportsWireLive/1.0 (+https://...)" -> 403, 2026-09-26).
  "User-Agent": "SportsWireLive/1.0",
  Accept: "application/json, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Mode": "cors",
};

export function espnFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, headers: { ...ESPN_HEADERS, ...(init.headers as Record<string, string> | undefined) } });
}
