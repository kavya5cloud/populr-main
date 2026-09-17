"use client";
import { useEffect, useRef } from "react";
import { captureReferral } from "@/lib/referral-client";

/**
 * The team, as a studio would list it.
 *
 * Was thirteen flip cards with brand-coloured icons — Reddit, Hacker News, a Link Broker,
 * a UGC Videos agent — which reads as a trading-card set rather than a marketing team, and
 * two of them sold work this product cannot do. An agency's site does not enumerate its
 * staff; it says what it takes responsibility for.
 *
 * Four, because that is what the product genuinely does end to end today. No video, no
 * clips: nothing here renders a file, and a role named for an output we cannot produce is
 * the most expensive line on the page.
 */
const TEAM: { role: string; does: string }[] = [
  { role: "Strategy", does: "Reads the site, the analytics and the search data, then decides what the week is for." },
  { role: "Editorial", does: "Writes the posts and pages in your voice, and rejects its own drafts before you see them." },
  { role: "Search", does: "Finds the terms worth winning, and says plainly which ones are already lost." },
  { role: "Publishing", does: "Sends approved work through your own accounts, at the hour it is most likely to be read." },
];

// What a daily run decides, shown as the product shows it.
//
// This replaced a fake terminal that typed itself out character by character. The terminal
// was a costume: Populr has no command line, so the one thing the hero demonstrated was
// something the product does not do. Worse, the format put the interesting part — the
// reason a task was skipped — in a trailing `# comment`, which is where the eye goes last.
//
// The frame below shows the same decisions as rows, which is the shape the dashboard
// actually uses. `verdict` drives the styling; nothing here is styled by hand.
const PLAN_ROWS: { verdict: "skip" | "do"; task: string; why: string }[] = [
  { verdict: "skip", task: 'Write 4 articles for "best crm"', why: "Won't rank — three incumbents own the page one" },
  { verdict: "skip", task: "Daily LinkedIn posts", why: "Your buyers aren't reading LinkedIn this week" },
  { verdict: "skip", task: "Reply to 14 Reddit threads", why: "11 are low-intent — 3 are queued instead" },
  { verdict: "do", task: "Fix the pricing page", why: "61% bounce within 9 seconds. Draft attached." },
];

export default function Landing() {
  // A referral link lands here. Store the code straight away — the account may not be
  // created until several screens later, long after the URL has changed.
  useEffect(() => { captureReferral(window.location.search); }, []);

  const dotsRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

    // The typewriter that used to run here is gone with the terminal. It wrote through
    // innerHTML with a hand-rolled escaper, held a timeout chain no cleanup ever cancelled,
    // and delayed the hero's most concrete content by four seconds. The frame renders as
    // markup now, so React owns it and there is nothing to tear down.

    const dcv = dotsRef.current;
    if (!dcv) return;
    // `alpha: false` is wrong here — the dots sit over the mesh — but telling the browser
    // reads are rare lets it keep the surface on the GPU.
    const dg = dcv.getContext("2d", { desynchronized: true })!;

    // Decoration must never cost the field its smoothness.
    //
    // This drew ~760 dots a frame at 60fps, each one assigning fillStyle a freshly built
    // `rgba(...)` string — 760 allocations and 760 colour parses per frame, on top of
    // clearing two million pixels. On a mid-range Android that is enough main-thread work
    // to make typing in the hero input stutter, which is exactly what it did. The input is
    // the product's first interaction; a background shimmer does not get to degrade it.
    //
    // Four changes, none of them visible: cap the pixel ratio, halve the frame rate, group
    // the fills by opacity, and stop entirely when nobody can see it.
    const DPR = Math.min(devicePixelRatio || 1, 2);
    /** A slow shimmer gains nothing from 60fps and costs twice the work. */
    const FRAME_MS = 1000 / 30;
    /** Opacity buckets. fillStyle is set once per bucket instead of once per dot. */
    const STEPS = 10;

    let DW = 0, DH = 0, GAP = 0, dots: { x: number; y: number; ph: number }[] = [], raf = 0;
    let last = 0, visible = true;
    const buckets: { x: number; y: number; s: number }[][] = Array.from({ length: STEPS }, () => []);

    const dsize = () => {
      if (!dcv.parentElement) return;
      const r = dcv.parentElement.getBoundingClientRect();
      DW = dcv.width = r.width * DPR;
      DH = dcv.height = r.height * DPR;
      GAP = 26 * DPR;
      dots = [];
      for (let y = GAP / 2; y < DH; y += GAP)
        for (let x = GAP / 2; x < DW; x += GAP) dots.push({ x, y, ph: x * 0.011 + y * 0.017 });
    };

    const paint = (t: number) => {
      dg.clearRect(0, 0, DW, DH);
      const tt = t * 0.00028;
      for (const b of buckets) b.length = 0;
      for (const d of dots) {
        const w = Math.sin(d.x * 0.0016 + d.y * 0.0011 + tt * 2 + d.ph) * 0.5 + 0.5;
        const w2 = Math.sin(d.y * 0.002 - tt * 1.4) * 0.5 + 0.5;
        const b = w * 0.7 + w2 * 0.3;
        const s = (1.1 + b * 1.9) * DPR;
        // Quantised, not rounded to a colour string: the difference between 0.031 and 0.034
        // opacity on a 2px dot is not perceivable, and pretending it is costs a parse.
        const step = Math.min(STEPS - 1, (b * STEPS) | 0);
        buckets[step].push({ x: d.x - s / 2, y: d.y - s / 2, s });
      }
      for (let i = 0; i < STEPS; i++) {
        const list = buckets[i];
        if (!list.length) continue;
        dg.fillStyle = `rgba(250,250,250,${(0.03 + (i / STEPS) * 0.1).toFixed(3)})`;
        for (const r of list) dg.fillRect(r.x, r.y, r.s, r.s);
      }
    };

    const ddraw = (t: number) => {
      raf = requestAnimationFrame(ddraw);
      if (!visible || t - last < FRAME_MS) return;
      last = t;
      paint(t);
    };

    dsize();
    addEventListener("resize", dsize);

    // Scrolled past, or the tab is in the background: the loop keeps being scheduled but
    // paints nothing. A canvas animating under content nobody is looking at is pure cost.
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 });
    io.observe(dcv);
    const onHidden = () => { visible = document.visibilityState === "visible"; };
    document.addEventListener("visibilitychange", onHidden);

    if (reduce) paint(0);
    else raf = requestAnimationFrame(ddraw);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", dsize);
      document.removeEventListener("visibilitychange", onHidden);
      io.disconnect();
    };
  }, []);

  return (
    <div className="landing">
      <nav>
        <div className="nav-in">
          <a href="/" className="logo" aria-label="Populr home">Populr.</a>
          {/* One door.
              This held a two-column hover panel with eight destinations — Dashboard, Launch
              workspace, Integrations, Guides — plus an Early access button beside Try free.
              A visitor deciding between four entrances has not been given a choice, they
              have been given homework. The hero input is the way in; everything else here
              is a link for someone who already knows what they want. */}
          <div className="nav-r">
            <a href="#how" className="nav-compact">How it works</a>
            <a href="#pricing">Pricing</a>
            <a href="/app" className="btn">Start free</a>
          </div>
        </div>
      </nav>

      <header>
        {/* Behind the dots: the drifting light. Both are decoration and neither is
            announced to a screen reader. */}
        <div className="hero-mesh" aria-hidden="true"><i /><i /><i /><i /></div>
        <div className="hero-grain" aria-hidden="true" />
        <canvas className="dots" ref={dotsRef} aria-hidden="true" />
        <div className="wrap" style={{ position: "relative", zIndex: 2 }}>
          <span className="pill"><i />now in early access</span>
          <h1>Meet <span className="name">Populr.</span><br /><span className="headline-tail">Your AI CMO.</span></h1>
          <p className="sub">Paste your website. Populr reads it, works out your positioning, and builds today&apos;s plan.</p>

          {/* The input is the hero.
              It used to be two buttons here and the real thing a page away, which asks
              somebody to commit before they have seen anything. The product's whole promise
              is that one URL is enough — so the page should ask for one URL, and the fastest
              way to believe a claim is to watch it happen.

              A plain GET form: no JavaScript needed to submit, and /app reads ?url= and
              starts on arrival. */}
          {/* Still a plain GET form that works with JavaScript off; the handler only tidies
              what gets sent. Someone pasting a URL brings whatever was on the clipboard with
              it — a trailing space, a newline out of a doc — and while canonicalSource trims
              it later, the address bar in between should not show %20%20. */}
          <form
            className="hero-form"
            action="/app"
            method="get"
            onSubmit={(e) => {
              const field = e.currentTarget.elements.namedItem("url") as HTMLInputElement | null;
              if (field) field.value = field.value.trim();
            }}
          >
            {/* type="text", not type="url".
                
                With type="url" the browser refuses "linear.app" before any of our code runs —
                it demands a scheme and shows its own "Please enter a URL" bubble. Nobody types
                https://. canonicalSource() has always prepended it for a bare domain, so the
                only thing rejecting the shorter form was the input itself.
                
                inputMode="url" still gets the URL keyboard on a phone, which is the part of
                type="url" worth keeping. autoCapitalize is off because iOS capitalises the
                first letter of a text field by default and "Linear.app" is not a host. */}
            <input
              type="text"
              name="url"
              placeholder="yourcompany.com"
              aria-label="Your website"
              inputMode="url"
              autoComplete="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              /* "Go" on the phone keyboard rather than a newline glyph. The field submits,
                 so the key that submits it should say so. */
              enterKeyHint="go"
              required
            />
            <button type="submit" aria-label="Analyze my website">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h13M12 5l7 7-7 7" />
              </svg>
            </button>
          </form>
          {/* Kept honest for what ships next.
              This said "nothing publishes without you", which is true today and stops being
              true the moment routine posts publish on their own. A line that has to be
              retracted is worse than a weaker one that holds. */}
          <p className="under">free for a month · no card · you approve anything that matters</p>

          {/* The product frame.
              Arcade's hero ends on a framed screenshot of the app. The frame is the whole
              trick: the same content in a bare div reads as a picture of software, and
              inside a bordered container with its own title bar it reads as software.

              Labelled as an example rather than left to imply real account data — the
              numbers below are illustrative and there is no honest way to present them
              as anything else. */}
          <figure className="frame">
            <div className="frame-bar">
              <span className="frame-live" aria-hidden="true" />
              <span className="frame-title">Today&apos;s plan</span>
              <span className="frame-tag">example</span>
            </div>
            <div className="frame-body">
              <p className="frame-lede">
                Populr checked your site, GA4 and Search Console. Here is what it decided —
                and what it refused to do.
              </p>
              <ul className="plan">
                {PLAN_ROWS.map((r) => (
                  <li key={r.task} className={"plan-row plan-" + r.verdict}>
                    <span className="plan-verdict">{r.verdict === "do" ? "Do today" : "Skipped"}</span>
                    <span className="plan-main">
                      <span className="plan-task">{r.task}</span>
                      <span className="plan-why">{r.why}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <figcaption className="frame-foot">
              Three things skipped, one worth your morning. The reason is always attached.
            </figcaption>
          </figure>
        </div>
      </header>

      {/* How it works, told as three acts rather than three features.
          
          The middle act is the one nobody else in the category has. Every competitor's
          "step 2" is a list of agents producing more; ours is the product deciding what not
          to do and writing down why. That is the whole argument, so it gets the space.
          
          The documents are named as files on purpose. "Populr understands your brand" is a
          claim; product-information.md is a thing you can open and correct. */}
      <section id="how">
        <div className="wrap">
          <p className="label">How it works</p>
          <h2 style={{ marginTop: 14 }}>Read the business. Decide. Then publish.</h2>
          <p className="start-lede">
            Most tools start at step three and generate. Populr will not write a line until it
            can say who your buyers are and what you sell.
          </p>

          <div className="act">
            <div className="act-n mono">01</div>
            <div className="act-b">
              <h3>It reads first</h3>
              <p>
                One URL. Populr reads your site, and your GA4 and Search Console if you connect
                them, then writes four documents about your business — and keeps them where you
                can read and correct them.
              </p>
              {/* Four, not five. Content strategy is not one of them yet, and listing a file
                  that does not exist is the kind of small lie that costs a customer the first
                  time they click it. */}
              <ul className="docs-strip">
                {["product-information.md", "competitor-analysis.md", "brand-voice.md", "marketing-strategy.md"].map((d) => (
                  <li key={d} className="mono">{d}</li>
                ))}
              </ul>
              <p className="act-note">Every agent reads these before it writes a word, so nothing drifts off-message.</p>
            </div>
          </div>

          <div className="act">
            <div className="act-n mono">02</div>
            <div className="act-b">
              <h3>It decides — and says no</h3>
              <p>
                This is the part other tools skip. Populr looks at everything it could do today
                and refuses most of it, with the reason attached. Four articles for a keyword
                three incumbents already own is not work, it is a quarter.
              </p>
              <div className="act-receipt">
                <div><span className="mono">skipped</span> Write 4 articles for &quot;best crm&quot; <em>— won&apos;t rank</em></div>
                <div><span className="mono">skipped</span> Daily LinkedIn posts <em>— your buyers aren&apos;t there this week</em></div>
                <div className="do"><span className="mono">do today</span> Fix the pricing page <em>— 61% leave in 9s</em></div>
              </div>
              <p className="act-note">You can disagree with any of it. The reasoning is always shown.</p>
            </div>
          </div>

          <div className="act">
            <div className="act-n mono">03</div>
            <div className="act-b">
              <h3>You approve. It publishes.</h3>
              <p>
                The few things worth doing arrive written, in your voice, sized for where they
                are going. Approve one and it publishes through your own connected account.
                Nothing leaves without you.
              </p>
              <p className="act-note">Disconnect an account and Populr stops reaching it immediately.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="team">
        <div className="wrap">
          <p className="label">The team</p>
          <h2 style={{ marginTop: 14 }}>Four roles, and one of them is saying no.</h2>
          <p className="start-lede">
            Not a roster to browse. This is who does the work, in the order they do it.
          </p>

          <ol className="team">
            {TEAM.map((t) => (
              <li key={t.role} className="team-row">
                <span className="team-role">{t.role}</span>
                <span className="team-does">{t.does}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* What Populr plugs into.
          Two columns because they are two different kinds of access and conflating them
          would overstate what we do. Reading a site or an analytics property is one-way and
          needs nothing from you beyond a URL. Publishing goes through an account you connect
          yourself, and it is the half people are right to be careful about — so the note
          under it says plainly that nothing leaves without approval.

          The publish list is SOCIAL_PLATFORMS from lib/social/types.ts, in the same order.
          Whether a given platform reaches the real provider depends on app credentials being
          configured, which is an environment fact and not something a static page can claim,
          so the copy says "through your own account" rather than "live". */}
      <section id="integrations" className="integrations">
        <div className="wrap">
          <div style={{ textAlign: "center" }}>
            <p className="label">Connects to</p>
            <h2 style={{ marginTop: 14 }}>Works with the accounts<br />you already have.</h2>
            <p className="sub">No new tool to migrate into. Populr reads what exists and writes back through it.</p>
          </div>

          <div className="int-grid">
            <div className="int-card">
              <p className="label">Reads</p>
              <p className="int-lede">Enough to know what your business is and where revenue comes from.</p>
              <div className="int-chips">
                {["Your website", "Google Analytics 4", "Search Console", "Instagram", "LinkedIn", "X", "YouTube", "Google Business Profile"].map((s) => (
                  <span className="int-chip" key={s}>{s}</span>
                ))}
              </div>
            </div>

            <div className="int-card">
              <p className="label">Publishes through</p>
              <p className="int-lede">Your own connected account — Populr never posts from a Populr page.</p>
              <div className="int-chips">
                {["LinkedIn", "Instagram", "Facebook Pages", "X", "Threads", "Pinterest"].map((s) => (
                  <span className="int-chip" key={s}>{s}</span>
                ))}
              </div>
              <p className="int-note">
                Every post waits for your approval. Disconnect an account and Populr stops
                reaching it immediately.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* borderBottom:0 used to live here to stop the last section drawing a divider above
          the footer. Sections are cards now — that inline style only knocked the bottom out
          of this one. */}
      <section id="pricing">
        <div className="wrap">
          <p className="label">Pricing</p>
          <h2 style={{ marginTop: 14 }}>One plan. First month free.</h2>
          <div className="price">
            <div>
              <div className="amt"><span className="was">$49</span>$15<small> /mo after your free month</small></div>
              <p className="inc">all channels · unlimited drafts · cancel anytime</p>
            </div>
            <a href="/app" className="btn btn-lg">Try free for a month</a>
          </div>
        </div>
      </section>

      {/* Entry point into the existing Launch Workspace (/studio/launch). This is the
          bridge from "I write posts" to "Populr runs my marketing" — it links to the
          workspace that already exists rather than introducing another one. */}
      <footer>
        <div className="wrap" style={{ display: "flex", justifyContent: "space-between", width: "100%", flexWrap: "wrap", gap: 10 }}>
          <a href="/" className="footer-logo" aria-label="Populr home">Populr.</a>
          <span style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <a href="#how" style={{ color: "var(--faint)", textDecoration: "none" }}>how it works</a>
            <a href="#pricing" style={{ color: "var(--faint)", textDecoration: "none" }}>pricing</a>
            {/* Both of these were reachable only from the sitemap. Search Console reported
                them as crawled-but-not-indexed, which is what an orphan page earns: the
                crawler has no signal that anything on the site considers them worth linking
                to. Footer links are the cheapest way to say otherwise. */}
            <a href="/guides" style={{ color: "var(--faint)", textDecoration: "none" }}>guides</a>
            <a href="/worked" style={{ color: "var(--faint)", textDecoration: "none" }}>what worked</a>
            <a href="/early-access" style={{ color: "var(--faint)", textDecoration: "none" }}>early access</a>
            <a href="mailto:team@trypopulr.in" style={{ color: "var(--faint)", textDecoration: "none" }}>contact</a>
            <a href="/privacy" className="foot-btn">Privacy Policy</a>
            <a href="/terms" className="foot-btn">Terms of Service</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
