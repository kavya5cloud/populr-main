// robots.txt, read the way crawlers read it (RFC 9309, and Google's documented behaviour).
//
// The free check only asks "is the whole site blocked?". The AI crawler checker needs the
// real answer for any path, so this follows the standard properly:
//
//   - A crawler obeys the one group whose user-agent matches its product token (case
//     doesn't matter). Groups naming the same agent are combined. No match: the "*" group.
//     No "*" group either: no rules apply.
//   - Within that group, the rule with the longest matching path wins. On a tie, Allow wins.
//   - "*" matches any run of characters and a trailing "$" anchors the end. "Disallow:" with
//     no path is not a rule at all.

export type RobotsGroup = { agents: string[]; rules: { allow: boolean; path: string }[] };

export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase(), value = m[2].trim();
    if (field === "user-agent") {
      // Consecutive user-agent lines share one group; a user-agent after rules starts a new one.
      if (!current || current.rules.length) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
    } else if (current && (field === "allow" || field === "disallow")) {
      if (value) current.rules.push({ allow: field === "allow", path: value });
    }
  }
  return groups;
}

/** The rules a crawler with this product token obeys. */
export function rulesFor(groups: RobotsGroup[], agent: string): { rules: RobotsGroup["rules"]; matchedBy: string | null } {
  const token = agent.toLowerCase();
  const own = groups.filter((g) => g.agents.includes(token));
  if (own.length) return { rules: own.flatMap((g) => g.rules), matchedBy: agent };
  const star = groups.filter((g) => g.agents.includes("*"));
  return { rules: star.flatMap((g) => g.rules), matchedBy: star.length ? "*" : null };
}

function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = body.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${re}${anchored ? "$" : ""}`).test(path);
}

export type Verdict = { allowed: boolean; rule: string | null; matchedBy: string | null };

/** Whether a crawler may fetch this path, and which line decided it. */
export function verdictFor(groups: RobotsGroup[], agent: string, path = "/"): Verdict {
  const { rules, matchedBy } = rulesFor(groups, agent);
  let best: { allow: boolean; path: string } | null = null;
  for (const r of rules) {
    if (!patternMatches(r.path, path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow && !best.allow)) best = r;
  }
  return { allowed: best ? best.allow : true, rule: best ? `${best.allow ? "Allow" : "Disallow"}: ${best.path}` : null, matchedBy };
}

/**
 * The crawlers behind AI search and AI models, and what each one is for. "answers" crawlers
 * decide whether an assistant can find and quote a site; "training" ones only decide whether
 * the site's text is used to train models — blocking those is a choice, blocking the first
 * kind makes a business invisible to the assistant.
 */
export type Crawler = { agent: string; owner: string; kind: "answers" | "training" | "search"; purpose: string };

export const CRAWLERS: Crawler[] = [
  { agent: "OAI-SearchBot", owner: "OpenAI", kind: "answers", purpose: "Finds pages to show and link in ChatGPT search" },
  { agent: "ChatGPT-User", owner: "OpenAI", kind: "answers", purpose: "Opens a page when someone asks ChatGPT to" },
  { agent: "Claude-SearchBot", owner: "Anthropic", kind: "answers", purpose: "Finds pages for Claude's search results" },
  { agent: "Claude-User", owner: "Anthropic", kind: "answers", purpose: "Opens a page when someone asks Claude to" },
  { agent: "PerplexityBot", owner: "Perplexity", kind: "answers", purpose: "Indexes pages Perplexity cites in its answers" },
  { agent: "Perplexity-User", owner: "Perplexity", kind: "answers", purpose: "Opens a page when someone asks Perplexity to" },
  { agent: "DuckAssistBot", owner: "DuckDuckGo", kind: "answers", purpose: "Finds pages for DuckDuckGo's AI answers" },
  { agent: "GPTBot", owner: "OpenAI", kind: "training", purpose: "Collects pages to train OpenAI's models" },
  { agent: "ClaudeBot", owner: "Anthropic", kind: "training", purpose: "Collects pages to train Anthropic's models" },
  { agent: "Google-Extended", owner: "Google", kind: "training", purpose: "Controls use in Gemini — not a crawler, and doesn't affect Google Search" },
  { agent: "Applebot-Extended", owner: "Apple", kind: "training", purpose: "Controls use in Apple's AI models — doesn't affect Siri or Spotlight search" },
  { agent: "CCBot", owner: "Common Crawl", kind: "training", purpose: "Builds the open web archive many AI models are trained on" },
  { agent: "Meta-ExternalAgent", owner: "Meta", kind: "training", purpose: "Collects pages to train Meta's AI models" },
  { agent: "Bytespider", owner: "ByteDance", kind: "training", purpose: "Collects pages for ByteDance's AI models" },
  { agent: "Googlebot", owner: "Google", kind: "search", purpose: "Google Search — and the pages Google's AI Overviews draw on" },
  { agent: "Bingbot", owner: "Microsoft", kind: "search", purpose: "Bing — which also feeds Microsoft Copilot's answers" },
];

export type CrawlerReport = Crawler & Verdict;

export type RobotsReport = {
  origin: string;
  /** "missing": no robots.txt (everything allowed). "unreachable": crawlers treat the site as off limits. */
  file: "found" | "missing" | "unreachable";
  path: string;
  crawlers: CrawlerReport[];
};

/** Status codes per RFC 9309: 4xx means no rules; 5xx or no answer means "assume blocked". */
export function reportFor(origin: string, fetched: { status: number; text: string } | null, path = "/"): RobotsReport {
  if (!fetched || fetched.status >= 500) {
    return { origin, file: "unreachable", path, crawlers: CRAWLERS.map((c) => ({ ...c, allowed: false, rule: null, matchedBy: null })) };
  }
  const groups = fetched.status >= 400 ? [] : parseRobots(fetched.text);
  return {
    origin,
    file: fetched.status >= 400 ? "missing" : "found",
    path,
    crawlers: CRAWLERS.map((c) => ({ ...c, ...verdictFor(groups, c.agent, path) })),
  };
}
