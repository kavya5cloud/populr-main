---
name: apply-seo-fixes
description: Apply the SEO fixes approved in Populr to this codebase, then verify them once deployed
---

# Apply my Populr SEO fixes

1. Call `seo_status` to see which pages have approved fixes.
2. Call `get_seo_fixes` and apply each change in the page's `<head>` or the framework's metadata API. Replace existing tags rather than adding duplicates. Add approved JSON-LD exactly as given.
3. Summarise what changed for each page.
4. After I deploy, call `verify_page` with each live URL and tell me if anything is missing.
