"use client";

import { useMemo, useState } from "react";
import { buildJsonLd, SCHEMA_TYPES, type BusinessDetails, type SchemaType } from "@/lib/seo/autopilot";

// The same builder Populr's autopilot uses, so the free tool and the product agree on what
// good markup is: only the fields you fill in, nothing guessed, FAQs only on the home page.

const TYPE_LABEL: Record<SchemaType, string> = {
  LocalBusiness: "Local business (a shop, clinic, studio…)",
  Store: "Store",
  Restaurant: "Restaurant, café or bakery",
  ProfessionalService: "Professional service (lawyer, accountant, agency…)",
  Organization: "Organization (no place customers visit)",
};

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

function origin(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return /\./.test(u.hostname) ? u.origin : null;
  } catch { return null; }
}

export default function SchemaGenerator() {
  const [site, setSite] = useState("");
  const [type, setType] = useState<SchemaType>("LocalBusiness");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [telephone, setTelephone] = useState("");
  const [email, setEmail] = useState("");
  const [logo, setLogo] = useState("");
  const [street, setStreet] = useState("");
  const [locality, setLocality] = useState("");
  const [region, setRegion] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("");
  const [hours, setHours] = useState("");
  const [profiles, setProfiles] = useState("");
  const [faq, setFaq] = useState<{ q: string; a: string }[]>([]);
  const [copied, setCopied] = useState(false);

  const siteOrigin = origin(site);
  const code = useMemo(() => {
    if (!siteOrigin || !name.trim()) return "";
    const business: BusinessDetails = {
      type, name: name.trim(), description, telephone, email, logo,
      address: { street, locality, region, postalCode, country },
      openingHours: lines(hours), sameAs: lines(profiles),
    };
    const ld = buildJsonLd({ site: siteOrigin, business, faq }, "/");
    return ld.map((j) => `<script type="application/ld+json">\n${JSON.stringify(j, null, 2).replace(/</g, "\\u003c")}\n</script>`).join("\n");
  }, [siteOrigin, type, name, description, telephone, email, logo, street, locality, region, postalCode, country, hours, profiles, faq]);

  return (
    <div className="tl-tool tl-split">
      <div className="tl-form">
        <label>Website<input value={site} onChange={(e) => setSite(e.target.value)} placeholder="yourbusiness.com" inputMode="url" spellCheck={false} /></label>
        <label>Type of business
          <select value={type} onChange={(e) => setType(e.target.value as SchemaType)}>
            {SCHEMA_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </label>
        <label>Business name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rao's Bakery" /></label>
        <label className="wide">What you do, in a sentence or two<textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Fresh bread, cakes and custom orders in Koregaon Park, Pune." /></label>
        <label>Phone<input value={telephone} onChange={(e) => setTelephone(e.target.value)} placeholder="+91 98765 43210" inputMode="tel" /></label>
        <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="hello@yourbusiness.com" inputMode="email" /></label>
        <label className="wide">Logo URL<input value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://yourbusiness.com/logo.png" inputMode="url" spellCheck={false} /></label>
        <label className="wide">Street address<input value={street} onChange={(e) => setStreet(e.target.value)} /></label>
        <label>City<input value={locality} onChange={(e) => setLocality(e.target.value)} /></label>
        <label>State<input value={region} onChange={(e) => setRegion(e.target.value)} /></label>
        <label>PIN / postal code<input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} /></label>
        <label>Country<input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="IN" /></label>
        <label className="wide">Opening hours, one per line<textarea rows={2} value={hours} onChange={(e) => setHours(e.target.value)} placeholder={"Mo-Sa 09:00-21:00\nSu 10:00-14:00"} spellCheck={false} /></label>
        <label className="wide">Your profiles elsewhere, one link per line<textarea rows={2} value={profiles} onChange={(e) => setProfiles(e.target.value)} placeholder={"https://instagram.com/yourbusiness\nhttps://maps.google.com/…"} spellCheck={false} /></label>
        <div className="wide tl-faqs">
          <p className="tl-label">Questions customers ask <small>(optional — added to your home page only)</small></p>
          {faq.map((f, i) => (
            <div key={i} className="tl-faq-row">
              <input value={f.q} onChange={(e) => setFaq(faq.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} placeholder="Do you deliver?" aria-label={`Question ${i + 1}`} />
              <textarea rows={2} value={f.a} onChange={(e) => setFaq(faq.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} placeholder="Yes, within 5 km, free over ₹500." aria-label={`Answer ${i + 1}`} />
              <button type="button" className="tl-link" onClick={() => setFaq(faq.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          {faq.length < 10 && <button type="button" className="tl-link" onClick={() => setFaq([...faq, { q: "", a: "" }])}>+ Add a question</button>}
        </div>
      </div>

      <div className="tl-output">
        <div className="dv-code">
          <div className="dv-code-head">
            <span className="dv-code-label">Paste into your home page&apos;s &lt;head&gt;</span>
            <button className="dv-copybtn" disabled={!code} onClick={() => navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>{copied ? "Copied" : "Copy"}</button>
          </div>
          <pre>{code || (site && !siteOrigin ? "Enter your website as an address, like yourbusiness.com." : "Fill in your website and business name — the markup appears here as you type.")}</pre>
        </div>
        {code && <p className="ck-hint">Then test it in <a href="https://search.google.com/test/rich-results" target="_blank" rel="noopener">Google&apos;s Rich Results Test</a> and <a href="https://validator.schema.org" target="_blank" rel="noopener">the Schema.org validator</a>.</p>}
      </div>
    </div>
  );
}
