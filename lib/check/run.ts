import { safeFetchText } from "@/lib/net/safe-fetch";
import { runChecks, scoreChecks, type CheckResult, type Fetched } from "./checks";

// Fetch what the checks read — the home page, robots.txt, /llms.txt, /sitemap.xml — through
// the SSRF-guarded fetcher (public addresses only, redirects re-checked, sizes capped).

type Fetch = typeof safeFetchText;

async function ok200(fetch: Fetch, url: string, maxBytes: number): Promise<string | null> {
  try {
    const r = await fetch(url, { timeoutMs: 6_000, maxBytes, headers: { "User-Agent": "PopulrCheck/1.0 (+https://www.trypopulr.in/check)" } });
    return r.status === 200 ? r.text : null;
  } catch {
    return null;
  }
}

export class CheckFetchError extends Error {}

export async function checkSite(site: { domain: string; url: string }, opts: { fetch?: Fetch; now?: number } = {}): Promise<CheckResult> {
  const fetch = opts.fetch ?? safeFetchText;
  let home: { url: string; status: number; text: string };
  try {
    home = await fetch(site.url, { timeoutMs: 12_000, maxBytes: 3_000_000, headers: { "User-Agent": "PopulrCheck/1.0 (+https://www.trypopulr.in/check)" } });
  } catch {
    throw new CheckFetchError(`Couldn't reach ${site.domain}. Check the address — it has to be a public website.`);
  }
  if (home.status >= 400 || !home.text) throw new CheckFetchError(`${site.domain} answered with an error (HTTP ${home.status}), so there was nothing to check.`);

  const origin = new URL(home.url).origin;
  const [robots, llms, sitemap] = await Promise.all([
    ok200(fetch, `${origin}/robots.txt`, 200_000),
    ok200(fetch, `${origin}/llms.txt`, 200_000),
    ok200(fetch, `${origin}/sitemap.xml`, 500_000),
  ]);
  const fetched: Fetched = { finalUrl: home.url, html: home.text, robots, llms, sitemap };
  return scoreChecks(site.domain, home.url, runChecks(fetched), opts.now ?? Date.now());
}
