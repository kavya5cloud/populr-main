---
name: set-up-seo
description: Set up Populr SEO for this project from scratch — site, business details, approved fixes, applied in code — asking before saving anything
---

# Set up Populr SEO

Ask me before saving anything to Populr.

1. Call `seo_status`. If no site is set up, find the site's public address in the project (Next.js `metadataBase`, a sitemap, the package's homepage, deploy config), confirm it with me, then call `setup_site`.
2. Find the business facts the site itself states — name, what it offers and where, phone, email, address, opening hours, social profiles. Show me what you'll save, then call `set_business_details`. Don't guess.
3. Call `draft_page_fix` for the home page and up to four other key pages. Show me each draft; call `approve_page_fix` for the ones I accept, with my edits.
4. Call `get_seo_fixes` and apply everything approved in the code, replacing existing tags. Add JSON-LD exactly as given.
5. Call `generate_llms_txt` and save it at `public/llms.txt`.
6. Summarise what changed. After I deploy, call `verify_page` for each page.
