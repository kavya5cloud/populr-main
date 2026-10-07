import { SITE_DESCRIPTION, SITE_NAME, SITE_URL, url } from "@/lib/seo";

// Structured data for the public site.
//
// Every value here is checked against what the page actually says. Nothing is asserted that
// a visitor could not verify — in particular there is no aggregateRating and no review
// markup, because Populr has no published reviews to describe. Inventing them is the kind
// of structured data that gets a site a manual action, not a rich result.

const organization = {
  "@type": "Organization",
  "@id": url("/#organization"),
  name: SITE_NAME,
  url: SITE_URL,
  // Raster and square. Google's logo guidance asks for at least 112×112 in a format Google
  // Images indexes, and an SVG is the format most often rejected in practice. app/apple-icon
  // is already 180×180 and already served at this path by Next's file convention.
  logo: { "@type": "ImageObject", url: url("/apple-icon.png"), width: 180, height: 180 },
  description: SITE_DESCRIPTION,
  email: "team@trypopulr.in",
};

const website = {
  "@type": "WebSite",
  "@id": url("/#website"),
  url: SITE_URL,
  name: SITE_NAME,
  description: SITE_DESCRIPTION,
  publisher: { "@id": url("/#organization") },
  inLanguage: "en",
};

/**
 * The product itself. Price mirrors the pricing section exactly: $15/month after a free
 * first month. If that copy changes, this has to change with it — a mismatch between
 * markup and the visible page is a structured-data violation, not a rounding error.
 */
const software = {
  "@type": "SoftwareApplication",
  "@id": url("/#software"),
  name: SITE_NAME,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  publisher: { "@id": url("/#organization") },
  offers: {
    "@type": "Offer",
    price: "15",
    priceCurrency: "USD",
    url: url("/"),
    availability: "https://schema.org/InStock",
    description: "First month free, then $15/month. Cancel anytime.",
  },
};

const graph = { "@context": "https://schema.org", "@graph": [organization, website, software] };

export default function JsonLd() {
  return (
    <script
      type="application/ld+json"
      // Static, author-controlled object — no user input reaches this string.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}
