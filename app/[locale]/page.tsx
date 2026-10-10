import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { LANDING, LANDING_LOCALES, homeAlternates, type LandingLocale } from "@/lib/i18n/landing";
import { SITE_NAME, url } from "@/lib/seo";

// The landing page in another language: /hi, /mr, /fr, /de, /es, /pt, /it, /nl, /pl.
//
// Server-rendered and static, so a crawler gets the full text in one response. Every
// version names every other one (hreflang), with English as the default — Google ignores
// hreflang that isn't reciprocal, so the English home lists these too.
//
// Only these nine paths exist: dynamicParams is off, so /anything-else is still a 404 and
// this segment can't swallow routes that don't exist yet.

export const dynamicParams = false;
export function generateStaticParams() {
  return LANDING_LOCALES.map((locale) => ({ locale }));
}

const isLocale = (l: string): l is LandingLocale => (LANDING_LOCALES as readonly string[]).includes(l);

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const c = LANDING[locale];
  return {
    // Absolute: the copy already carries the brand, and the template would add it twice.
    title: { absolute: c.title },
    description: c.description,
    alternates: { canonical: `/${locale}`, languages: homeAlternates() },
    openGraph: {
      type: "website", siteName: SITE_NAME, url: url(`/${locale}`),
      title: c.title, description: c.description, locale: c.hreflang.replace("-", "_"),
    },
    twitter: { card: "summary_large_image", title: c.title, description: c.description },
  };
}

export default async function LocalizedLanding({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const c = LANDING[locale];

  // FAQ markup mirrors the questions printed below, word for word.
  const faqLd = {
    "@context": "https://schema.org", "@type": "FAQPage", inLanguage: c.hreflang,
    mainEntity: c.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };

  return (
    <div className="landing hero-visible lx" lang={c.hreflang}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd).replace(/</g, "\\u003c") }} />

      <header className="hero-clean">
        <div className="hc-frame">
          <div className="hc-left">
            <div className="hc-nav">
              <a href={`/${locale}`} className="hc-logo" aria-label="Populr">Populr.</a>
              <div className="hc-pills" role="navigation" aria-label="Main">
                <a href="#how">{c.nav.how}</a>
                <a href="#pricing">{c.nav.pricing}</a>
                <a href="/app" className="on">{c.nav.start}</a>
              </div>
            </div>
            <div className="hc-copy">
              <p className="hc-eyebrow"><i aria-hidden="true" />{c.eyebrow}</p>
              <h1>{c.h1} <span>{c.h1Tail}</span></h1>
              <hr />
              <p className="hc-sub">{c.sub}</p>
              <form className="hc-form" action="/app" method="get">
                <input type="text" name="url" placeholder={c.placeholder} aria-label={c.placeholder}
                  inputMode="url" autoComplete="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="go" required />
                <input type="hidden" name="lang" value={locale} />
                {/* Both labels, swapped by width. Slicing the long label at the short one's
                    length assumed the short label is its start — true in French, not in Hindi,
                    Marathi, German or Polish, where it produced garbled text. */}
                <button type="submit"><span className="hc-btn-full">{c.cta}</span><span className="hc-btn-short">{c.ctaShort}</span></button>
              </form>
              <p className="hc-under">{c.under}</p>
            </div>
          </div>
          <div className="hc-media" aria-hidden="true">
            <Image src="/hero/park-trees.jpg" alt="" fill priority sizes="(min-width: 960px) 50vw, 100vw" className="hc-photo" />
            <div className="hc-tags">
              <span>{c.tags[0]}</span><span>{c.tags[1]}</span><span className="wide">{c.tags[2]}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="lx-body">
        <section id="how" className="lx-sec">
          <h2>{c.howTitle}</h2>
          <ol className="lx-steps">
            {c.steps.map((s, i) => (
              <li key={i}><span className="lx-n">{i + 1}</span><h3>{s.t}</h3><p>{s.d}</p></li>
            ))}
          </ol>
          <p className="lx-langs">{c.languagesLine}</p>
        </section>

        <section id="pricing" className="lx-sec">
          <h2>{c.pricingTitle}</h2>
          <p className="lx-price">{c.pricing}</p>
          <a href="/app" className="lx-cta">{c.nav.start}</a>
        </section>

        <section className="lx-sec">
          <h2>{c.faqTitle}</h2>
          <dl className="lx-faq">
            {c.faq.map((f) => (<div key={f.q}><dt>{f.q}</dt><dd>{f.a}</dd></div>))}
          </dl>
        </section>

        {/* A div with role="navigation", not <nav>: `.landing nav` rules fix and hide the
            site nav, and would do the same to this. */}
        <div className="lx-switch" role="navigation" aria-label={c.otherLanguages}>
          <span>{c.otherLanguages}:</span>
          <a href="/" hrefLang="en" lang="en">English</a>
          {LANDING_LOCALES.filter((l) => l !== locale).map((l) => (
            <a key={l} href={`/${l}`} hrefLang={LANDING[l].hreflang} lang={LANDING[l].hreflang}>{LANDING[l].name}</a>
          ))}
        </div>
      </main>
    </div>
  );
}
