// The guides.
//
// Populr had five indexable URLs, two of which were legal pages. The technical SEO was
// clean — canonicals, sitemap, robots, structured data all correct — and had nothing to
// rank. A search engine cannot send traffic to pages that do not exist.
//
// These are written, not generated. That is a deliberate line: this product's whole
// argument is that AI content should be grounded in something real, and a site that
// publishes generated filler about generated filler would be arguing against itself. Every
// guide here is about something we actually did or actually know.
//
// Content is typed data rather than MDX because the dependency list is short on purpose and
// a markdown pipeline is not worth a build step for a handful of pages.

export type Block =
  | { kind: "p"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] };

export type Guide = {
  slug: string;
  /** Under 60 characters where possible — longer gets truncated in results. */
  title: string;
  /** 140–160 characters. This is the snippet, so it is a promise, not a summary. */
  description: string;
  /** The question this page answers, in the words someone would type. */
  intent: string;
  published: string;   // ISO date
  updated: string;
  readingMinutes: number;
  blocks: Block[];
  /** Rendered into FAQPage structured data. Real questions with real answers only. */
  faq?: { q: string; a: string }[];
};

const p = (text: string): Block => ({ kind: "p", text });
const h2 = (text: string): Block => ({ kind: "h2", text });
const h3 = (text: string): Block => ({ kind: "h3", text });
const ul = (items: string[]): Block => ({ kind: "ul", items });
const ol = (items: string[]): Block => ({ kind: "ol", items });
const quote = (text: string): Block => ({ kind: "quote", text });
const table = (head: string[], rows: string[][]): Block => ({ kind: "table", head, rows });
const code = (text: string): Block => ({ kind: "code", text });

const AUTHORED: Omit<Guide, "readingMinutes">[] = [
  {
    slug: "ai-cmo-vs-marketing-agency",
    title: "AI CMO vs marketing agency: the real numbers",
    description:
      "What a marketing agency, a first marketing hire, and an AI CMO actually cost a startup — and the specific work each one is genuinely better at.",
    intent: "should I hire a marketing agency or use an AI marketing tool",
    published: "2026-08-10",
    updated: "2026-08-10",
    blocks: [
      p("Most comparisons of this kind are written by whoever is selling one of the options. This one is too — we build an AI CMO. So here is the part that usually gets left out: there is work an agency does that no AI tool can do today, and if that is the work you need, the price comparison is irrelevant."),
      p("What follows is the actual arithmetic, then the honest boundary."),

      h2("What each one costs"),
      p("Figures are typical ranges for early-stage B2B software companies. Your market will vary; the shape does not."),
      table(
        ["Option", "Typical monthly cost", "What you get"],
        [
          ["Full-service agency", "$4,000–$10,000", "Strategy, content, paid media, reporting. A team, but rarely senior attention on a small account."],
          ["Freelance marketer", "$1,500–$4,000", "One person, part-time, usually strong in one channel and thin elsewhere."],
          ["First marketing hire", "$5,000–$9,000 plus equity", "Full-time ownership. Three to six months before output compounds."],
          ["AI CMO tooling", "$15–$200", "Strategy and content generated and scheduled. No judgement about your market that you did not supply."],
        ],
      ),
      p("The gap is two orders of magnitude, which is why the comparison gets made at all. But cost per month is the wrong denominator. The right one is cost per decision that turns out to be correct."),

      h2("What an agency is genuinely better at"),
      p("Being specific about this is more useful than pretending otherwise."),
      ul([
        "Relationships. A publicist who knows an editor personally is not a capability you can buy in software.",
        "Paid media at scale. Once you are spending real money on ads, an experienced buyer earns their fee in avoided waste.",
        "Taste under uncertainty. Deciding that a category is about to shift, and betting the positioning on it, is judgement — and judgement is exactly what a language model does not have.",
        "Accountability. You can fire an agency. You cannot fire a tool, and it will never tell you your idea is bad.",
      ]),

      h2("What software is genuinely better at"),
      ul([
        "Consistency. The fourth month looks like the first. Agencies front-load their best people onto new accounts and quietly rotate them off.",
        "Volume at low stakes. Twenty variations of a post, every day, costs nothing and needs no meeting.",
        "Memory. Every decision, every outcome, in one place, permanently — rather than in a shared drive someone leaves behind.",
        "Speed. Something written and scheduled in ten minutes rather than in a Thursday review cycle.",
      ]),

      h2("The honest decision rule"),
      p("If you do not yet know who your buyer is or what makes you different, no amount of content helps. That is a positioning problem, and it is solved by talking to customers — not by an agency and not by a tool. Spend the month on interviews instead."),
      p("If you know your positioning and simply are not shipping, that is a throughput problem, and it is the one software actually solves."),
      p("If you are spending more than about $10,000 a month on paid acquisition, hire the human. The fee is small relative to what a bad media buy costs you."),

      h2("What we would not claim"),
      p("An AI CMO does not know your market. It knows what you told it and what it can read on your site. It will produce a competent post about a strategy you chose, and it will produce an equally competent post about a bad strategy you chose, with no change in tone to warn you. That is the real limitation, and it is not one that a better model fixes."),
    ],
    faq: [
      {
        q: "Is an AI CMO a replacement for a marketing agency?",
        a: "For content production and scheduling, largely yes. For paid media at scale, press relationships, and positioning judgement, no. The practical split is that software handles throughput and an experienced human handles bets that are expensive to get wrong.",
      },
      {
        q: "How much does a marketing agency cost for a startup?",
        a: "Full-service agencies typically run $4,000–$10,000 a month for early-stage B2B software, and freelancers $1,500–$4,000. A first in-house marketing hire is usually $5,000–$9,000 a month plus equity.",
      },
      {
        q: "When should a startup hire a marketer instead of using software?",
        a: "When the bottleneck is judgement rather than throughput — unclear positioning, a category shift, or paid spend above roughly $10,000 a month, where an experienced buyer's fee is small against the cost of a bad media buy.",
      },
    ],
  },

  {
    slug: "what-is-geo-generative-engine-optimization",
    title: "What is GEO? Getting named by AI assistants",
    description:
      "GEO is getting named when someone asks ChatGPT or Claude what to use. How it differs from SEO, and how to measure whether you appear in AI answers at all.",
    intent: "what is generative engine optimization and how do I rank in AI answers",
    published: "2026-08-10",
    updated: "2026-08-10",
    blocks: [
      p("A growing share of buyers no longer open ten blue links. They ask an assistant what to use and act on the answer. If your product is not named in that answer, you were not in the running — and unlike a search result, there is no page two to be on."),
      p("Generative Engine Optimization is the work of being named. It overlaps with SEO, but the thing being optimised for is different, and so is the way you check whether it worked."),

      h2("How it differs from SEO"),
      table(
        ["", "SEO", "GEO"],
        [
          ["Goal", "Rank in a list of links", "Be named inside an answer"],
          ["Unit of success", "Position for a keyword", "Whether you are mentioned, and how"],
          ["Rewards", "Depth, authority, backlinks", "Being quotable and unambiguous"],
          ["Feedback", "Search Console, daily", "No dashboard exists — you have to ask"],
        ],
      ),
      p("The last row is the one that catches people. There is no Search Console for AI answers. Nobody sends you a report saying you were mentioned in four thousand conversations last month. If you want to know, you have to ask the models yourself, repeatedly, and record what came back."),

      h2("What actually makes a product citable"),
      p("Models reach for things they can state without hedging. That has practical consequences for how a page is written."),
      ul([
        "A one-sentence definition on the page. If a model has to infer what you are, it will reach for something it can describe in one line instead.",
        "An explicit category and differentiator. \"An AI CMO for founders without a marketing hire\" is quotable. \"A growth platform\" is not.",
        "Comparison tables. A model asked to compare options will lift a structured comparison almost verbatim.",
        "Real numbers and dates. Specifics get cited; adjectives get paraphrased into nothing.",
        "FAQ markup answering what a buyer asks before trusting you.",
      ]),
      p("Notice that none of this is a trick. It is the same thing that makes a page useful to a person in a hurry, which is roughly what a model is."),

      h2("How to measure it"),
      p("The measurement is simple to describe and easy to get wrong in one specific way."),
      ol([
        "Write the questions a buyer would actually type — \"what is the best X for Y\", not \"tell me about your brand\".",
        "Ask a model each one, in a fresh context, with no mention of your company.",
        "Record whether your name appears, and which products appeared instead.",
        "Repeat on a schedule, because the answer changes as models are retrained.",
      ]),
      quote("The query must never contain your brand name. Ask a model about your company and it will describe your company — whether or not it has ever heard of you. That question always returns good news, which is exactly why it is worthless."),
      p("The names that appear instead of yours are the useful output. They are who the model currently reaches for in your category, which tells you what you are actually competing against in that channel."),

      h2("What GEO cannot do"),
      p("Model weights are not a search index. You cannot submit a page and appear tomorrow. Changes propagate when models retrain, on a timescale you do not control and nobody publishes. Anyone selling guaranteed AI-answer placement is selling something that does not exist."),
      p("What you can control is whether, when a model does encounter your page, there is a clear sentence to quote — and whether you know your current position well enough to tell if it moves."),
    ],
    faq: [
      {
        q: "What does GEO stand for?",
        a: "Generative Engine Optimization — the practice of getting a product cited inside AI assistant answers, rather than ranked in a list of search results.",
      },
      {
        q: "Is GEO different from SEO?",
        a: "They overlap but optimise for different things. SEO rewards depth, authority and links to earn a position in a list. GEO rewards being quotable and unambiguous so a model can name you inside an answer. GEO also has no equivalent of Search Console, so visibility has to be measured by asking models directly.",
      },
      {
        q: "How do I check whether ChatGPT mentions my company?",
        a: "Ask it the questions a buyer would type about your category — never naming your company — and record whether you appear and which competitors do. Repeat on a schedule, since answers change as models are retrained. A query that names your brand always returns a mention and measures nothing.",
      },
    ],
  },

  {
    slug: "why-ai-marketing-tools-invent-statistics",
    title: "Why AI marketing tools invent statistics",
    description:
      "Our own AI wrote a statistic that does not exist. Why every AI writing tool does this, why it is hard to notice, and the specific checks that stop it.",
    intent: "why does AI make up statistics and how do I stop it",
    published: "2026-08-10",
    updated: "2026-08-10",
    blocks: [
      p("Last week our own product wrote this for a customer:"),
      quote("Did you know that Europeans are 2.5x more likely to engage with content that's relevant to their interests?"),
      p("There is no such study. The number does not exist. It was one click from being published under someone else's name."),
      p("We build AI marketing software, and we are describing our own failure, because the alternative — everyone in this category quietly patching this and saying nothing — is worse for the people buying it."),

      h2("The number is fake. It is also meaningless."),
      p("Read it again. Europeans are more likely to engage with content relevant to their interests. Compared to what? Content irrelevant to their interests? Everyone on earth engages more with things they care about. It is a tautology wearing a lab coat."),
      p("That is what makes it dangerous. It is not a wild hallucination anyone would catch. It sounds like something you read once, it has a decimal point in it, and it survives a skim. A founder pastes it into a deck, an investor asks for the source, and the problem is now theirs."),

      h2("Why models do this"),
      p("A language model predicts plausible continuations. In marketing prose, a persuasive claim is very often followed by a supporting statistic — so when you ask for persuasive copy, a statistic is the statistically likely next thing, and one gets produced. The model is not lying. It has no concept of a citation to omit."),
      p("Which means prompting alone cannot fix it. \"Be accurate\" competes against the pattern; it does not remove it."),

      h2("What actually stops it"),
      p("Three things, in increasing order of how much they help."),
      h3("1. Name the shape, not the principle"),
      p("\"Do not invent statistics\" gets ignored. \"Never write '2.5x more likely', '68% of buyers', or 'studies show'\" gets matched, because it gives the model a concrete pattern to avoid rather than an abstraction to interpret."),
      h3("2. Put the rule everywhere, once"),
      p("We had this rule. It lived in the conversational path and not in the three paths that write the posts customers actually publish — so it covered chat and not content, which is exactly backwards. One shared module, imported by every prompt builder, is the fix. If a rule lives in one of four places, it does not exist."),
      h3("3. Check the output, do not just ask nicely"),
      p("A prompt is a request. A deterministic check is a contract. Scanning finished text for unsourced-claim patterns costs nothing, cannot be talked out of it, and catches what the prompt missed. Asking a second model to grade the first does not count — that is the same system marking its own homework, and it fails quietly when the grader is agreeable."),

      h2("How to test the tool you are using"),
      p("Ask it to write a persuasive post about a topic it has no data on. Then ask where each number came from. A tool worth using will either cite something you provided or will have written the argument without a number at all. Most will produce a figure and, when pressed, produce a plausible source for it too."),
      p("If your AI writing tool has never once told you it does not know enough to answer, it is not being confident. It is being unfalsifiable."),
    ],
    faq: [
      {
        q: "Why does AI make up statistics?",
        a: "A language model predicts plausible continuations. In persuasive marketing prose, a claim is usually followed by a supporting figure, so asking for persuasive copy makes a statistic the likely next thing — and one gets produced. There is no citation being omitted, because there was never a source.",
      },
      {
        q: "Can prompting stop AI from inventing data?",
        a: "Only partly. Vague instructions like \"be accurate\" compete with the pattern rather than removing it. Naming concrete shapes — \"never write '68% of buyers' or 'studies show'\" — works better, and a deterministic check on the finished text is what actually enforces it.",
      },
      {
        q: "How do I check whether an AI tool is fabricating figures?",
        a: "Ask it to write persuasively about something it has no data on, then ask where each number came from. A trustworthy tool either cites data you supplied or makes the argument without a figure. Be wary of one that produces both a statistic and, on request, a plausible-sounding source for it.",
      },
    ],
  },

  {
    slug: "what-is-llms-txt",
    title: "What is llms.txt, and does your site need one?",
    description:
      "llms.txt is a plain map of your site written for AI models. What goes in it, what it cannot do for rankings, and the one way to stop it quietly lying.",
    intent: "what is llms.txt and do I need one",
    published: "2026-10-07",
    updated: "2026-10-07",
    blocks: [
      p("llms.txt is a markdown file at the root of a website — yoursite.com/llms.txt — that describes the site for a language model: what it is, and which pages are worth reading. It was proposed in September 2024 by Jeremy Howard of Answer.AI, on the reasoning that a model reading a web page spends most of its attention on navigation, scripts and layout, when what it wanted was a short list of the pages that matter."),
      p("We publish one. This is what we learned building it, including the part where we found ours was pointing at a page it should not have been."),

      h2("What goes in it"),
      p("The format is deliberately small. A heading with the site's name, a one-paragraph summary in a blockquote, then sections of links, each followed by a sentence saying what is behind it. The shape of ours:"),
      code("# Populr\n\n> Populr is your AI CMO. It reads your site, runs SEO, AI-search\n> visibility, Reddit and content daily, and sends you only what\n> is worth approving.\n\n## Guides\n- [What is GEO? Getting named by AI assistants](https://www.trypopulr.in/guides/what-is-geo-generative-engine-optimization): ...\n\n## Site\n- [Home](https://www.trypopulr.in)\n- [Early Access](https://www.trypopulr.in/early-access)"),
      p("There is an optional companion, llms-full.txt, which inlines the full text of those pages so a model can take in everything in one request. It earns its place when your important content is long and stable, like documentation. For a marketing site it mostly repeats the sitemap."),

      h2("What it cannot do"),
      p("It is not a ranking factor. Google has said publicly that its search systems do not use the file, and no major AI assistant has committed to reading it. A model that already crawls your site will go on crawling your site. Anyone promising that llms.txt will get you cited by ChatGPT is selling you a text file."),
      p("Treat it the way you would a good README: cheap to write, occasionally read, and embarrassing only when it is wrong."),

      h2("The one way it goes wrong"),
      p("A hand-written llms.txt is accurate on the day it is written and drifts from then on. Pages get renamed, removed, or turn out weaker than you thought, and the file keeps describing the site as it used to be. Any model that reads it is then told something false by the one document whose only job is to be true."),
      p("So ours is not written by hand. It is generated from the same list of public routes that produces our sitemap and robots.txt, and from the same data that produces each guide's title and description. Add a guide and it appears in all three. Remove a route and it leaves all three."),
      p("That is how we caught our own mistake. We noticed our results page — the screen that shows a signed-in customer which of our recommendations moved their numbers — was listed in both the sitemap and llms.txt. To a logged-out visitor, which is what every crawler is, it rendered a back link, a loading message and an empty table. We had been pointing machines at our thinnest page and labelling it as proof. Taking it out of the route list took it out of both files in one change."),

      h2("Should you have one?"),
      ul([
        "Yes, if it can be generated. If your sitemap is built from code, building llms.txt from the same source is an hour's work and cannot go stale.",
        "Probably not, if someone would have to remember to update it. A stale llms.txt is worse than none.",
        "Either way, it is not where AI visibility comes from. Models name products they have read about in places they trust: documentation, comparisons, forums, other people's articles. A file you publish about yourself is the weakest evidence there is.",
      ]),
      p("If you want to know whether AI assistants mention you at all, ask them the question your customer would ask and see whose name comes back. Our guide to GEO covers how to do that systematically."),
    ],
    faq: [
      {
        q: "What is llms.txt?",
        a: "A markdown file at a website's root that summarises the site for language models and lists its important pages, each with a one-line description. It was proposed in September 2024 by Jeremy Howard of Answer.AI.",
      },
      {
        q: "Does llms.txt improve SEO or AI rankings?",
        a: "Not directly. Google has said its search systems do not use it, and no major AI assistant has committed to reading it. It is inexpensive documentation for machines, not a ranking lever.",
      },
      {
        q: "How do I keep llms.txt from going out of date?",
        a: "Generate it from the same source as your sitemap instead of writing it by hand, so adding or removing a page updates both at once. A hand-maintained file drifts and ends up describing pages that no longer exist.",
      },
    ],
  },

  {
    slug: "marketing-in-indian-languages",
    title: "Marketing in Indian languages: why translation fails",
    description:
      "Translated marketing reads as translated. What changes when you write natively in Hindi, Tamil or Marathi — register, script, mixing — and the limits it hits.",
    intent: "how to do marketing in Hindi and regional Indian languages",
    published: "2026-10-07",
    updated: "2026-10-07",
    blocks: [
      p("Populr writes marketing in 32 languages, 12 of them Indian. The easy way to build that is to write everything in English and run it through translation. We chose not to, and the reasons are most of what we know about marketing in Indian languages."),

      h2("Translated copy reads as translated"),
      p("Translation is faithful to words. Marketing has to be faithful to how people talk, and those are different targets. A translated post keeps English sentence order, swaps idioms for their literal meaning, and lands in a register nobody uses with a shopkeeper they know."),
      p("Register is what gives it away fastest. Hindi has three levels of \"you\" — tu, tum and aap — and choosing one is choosing a relationship. A bakery writing to its regulars and a bank writing to account holders should not sound alike, and an English source sentence carries no information about which one it meant. Translation has to guess. It usually guesses formal, which is how a neighbourhood shop ends up sounding like an insurance circular."),

      h2("People do not write in one language"),
      p("Much of Indian social media is written in more than one language at once: Hindi in Latin script, English nouns inside Marathi sentences, a Tamil post with an English call to action. That is not an error to be cleaned up. It is how the audience writes, and copy that refuses to mix reads like a brochure."),
      p("Script is a decision too. Some audiences read Devanagari comfortably on a phone but search in Latin letters; others are the reverse. There is no universal right answer, which is exactly why a pipeline that silently picks one will be wrong for someone."),

      h2("The limits are not where you expect"),
      p("A platform that limits characters counts the characters that are stored, not the letters you see. A Devanagari word that looks like three syllables can be seven characters to a counter. क्षेत्र (kshetra, \"area\") is stored as क, ्, ष, े, त, ्, र: consonants joined by a virama, plus a vowel sign, each counted on its own."),
      p("So posts in Indian scripts reach length limits sooner than their visible length suggests, and copy trimmed by eye gets cut mid-word by the platform. Count the way the machine counts."),

      h2("What writing natively actually took"),
      p("Writing natively meant using a model trained on Indian languages, and that model taught us something we did not expect. Our first attempt handed it the same detailed brief our English writer gets — around two thousand tokens of rules, examples and structure. It came back with nothing at all."),
      p("It was a reasoning model: it spends part of its output budget thinking before it writes, and a long, dense brief gave it a great deal to think about. In our measurements it needed roughly six thousand tokens of output budget to finish, and we had allowed four. It ran out while still reasoning and never wrote the post."),
      p("Two changes fixed it, and both were needed. A compact brief of about 280 tokens that keeps the language, audience, brand voice, platform limits and the rule against inventing facts, and drops the long craft guidance. And a larger output budget for that model alone. The English path was left byte-for-byte unchanged, because it was working."),
      p("The general lesson outlasts the specific bug: the instructions that make one model better can make another fail outright. A multilingual product cannot have one prompt. It needs a brief per model, tested per model."),

      h2("If you are writing in an Indian language yourself"),
      ul([
        "Write in the language from the first word. Translating a finished English post is where the stiffness comes from.",
        "Choose the register on purpose — who is speaking, and to whom — before the first sentence.",
        "Match the script your audience types and searches in, not the one that looks most formal.",
        "Check length in the platform's own composer rather than by eye.",
        "Have a native speaker read it aloud. Where they stumble, your audience will too.",
      ]),
    ],
    faq: [
      {
        q: "Is translating English marketing into Hindi good enough?",
        a: "Usually not. Translation preserves the words but not the register, idiom or rhythm, so translated posts read as translated. Writing in the target language from the start produces copy that sounds like the audience it is for.",
      },
      {
        q: "Should Hindi marketing use Devanagari or Latin script?",
        a: "It depends on the audience. Some readers are comfortable with Devanagari but search in Latin letters; others are the reverse. Match how your particular audience types and searches rather than defaulting to either.",
      },
      {
        q: "Why do posts in Indian languages hit character limits early?",
        a: "Platforms count stored characters, and Indian scripts build what looks like a single syllable out of consonants, viramas and vowel signs. A short-looking word can be several characters long, so posts reach the limit sooner than they appear to.",
      },
    ],
  },

  {
    slug: "how-to-tell-if-marketing-worked",
    title: "How to tell if your marketing actually worked",
    description:
      "Traffic went up after you posted. That does not mean the post did it. How to read Search Console before and after an action without fooling yourself.",
    intent: "how do I know if my marketing or SEO worked",
    published: "2026-10-07",
    updated: "2026-10-07",
    blocks: [
      p("You published something, and a week later traffic was up. It is very tempting to decide the post did it. Most of the time you cannot know that, and the most useful thing a tool can do is tell you how much it does not know."),
      p("Populr measures what happens after every action it recommends, using Google Search Console. This is the method, including the parts that make the numbers weaker than they look."),

      h2("Compare windows, not moments"),
      p("A single day tells you almost nothing. Search traffic moves with the day of the week, the season, the news, and ranking changes you will never be told about. The useful comparison is a window before the action against an equal window after it, with the same number of each weekday in both."),
      p("Search Console helps and hinders here. Its performance data arrives a couple of days late, so the after-window is never quite as fresh as it looks. It also keeps sixteen months of history, which is enough to check whether the same weeks last year did the same thing without you."),

      h2("Read the four numbers together"),
      table(["Metric", "What it tells you", "How it misleads"], [
        ["Impressions", "How often you appeared in results", "Rises when you start ranking for searches nobody clicks, or the wrong ones"],
        ["Clicks", "How often someone chose you", "Small numbers swing hard: ten to fifteen is +50% and means almost nothing"],
        ["CTR", "Clicks per impression", "Falls when impressions grow faster than clicks, which can be good news"],
        ["Position", "Average rank where you appeared", "An average over every query; one new low-ranking query drags it down"],
      ]),
      p("None of these is the result on its own. A page whose impressions doubled while clicks stayed flat has probably started appearing for searches it does not answer. A page whose position got \"worse\" may simply have started ranking for more things. Read them together or not at all."),

      h2("Association is not causation, and we say so"),
      p("Even a clean before-and-after only shows that something changed after you acted. It does not show your action changed it. A competitor may have dropped out of the results. Google may have changed how it ranks. Your topic may have been in the news that week."),
      p("So we report an association score, not an attribution. In our product, 50 means no movement and above 50 means the metrics improved after the action, and every score carries a confidence that reflects how much data was behind it. A score built on thirty clicks is shown with low confidence because it deserves it."),
      p("Associations become useful in aggregate. If posts on one channel are reliably followed by improvement and posts on another are not, that pattern is worth acting on, even though no single post proves anything. That is the level we make claims at — channels, over time — rather than individual posts."),

      h2("A checklist you can use without us"),
      ol([
        "Write down what you expect to change, and on which pages, before you act.",
        "Pick equal before and after windows of at least two weeks each, aligned by weekday.",
        "Wait for Search Console to catch up before reading the after-window.",
        "Look at clicks, impressions, CTR and position together, per page, filtered to the queries that matter.",
        "Check the same weeks last year for a seasonal pattern.",
        "If the numbers are small, write \"inconclusive\" and mean it.",
      ]),
    ],
    faq: [
      {
        q: "How do I know if a blog post increased my traffic?",
        a: "Compare equal before and after windows in Search Console for that page, aligned by weekday. Even then you have an association, not proof — rankings, competitors and seasonality all move independently of your post.",
      },
      {
        q: "Why did my CTR drop when my traffic went up?",
        a: "CTR is clicks divided by impressions. If you start appearing for many more searches, impressions can grow faster than clicks, which lowers CTR even while clicks rise. Read the metrics together rather than one at a time.",
      },
      {
        q: "How long should I wait before measuring SEO results?",
        a: "At least two weeks after the change, plus a couple of days for Search Console's data to arrive. Shorter windows are dominated by day-to-day noise rather than by anything you did.",
      },
    ],
  },

  {
    slug: "what-ai-marketing-should-refuse",
    title: "What an AI marketing tool should refuse to do",
    description:
      "Most AI marketing tools are judged on how much they produce. Ours keeps a ledger of what it declined to do and why, and is graded on whether it was right.",
    intent: "what should an AI marketing tool not do",
    published: "2026-10-07",
    updated: "2026-10-07",
    blocks: [
      p("Our homepage says: thirty-one things it could do, three worth doing. This guide is about the other twenty-eight."),
      p("Every AI marketing tool can produce more. That is the cheapest thing a language model does. The scarce thing — what a good CMO is actually paid for — is deciding what not to do, and being accountable when that call turns out wrong."),

      h2("The refusal ledger"),
      p("When Populr decides against an action, it does not just leave it off the list. It records the refusal and its reason in a ledger the founder can read. Today it gives one of four reasons:"),
      ul([
        "Wrong audience — the channel reaches people who are not the customer.",
        "Low intent — the people there are not looking to buy anything.",
        "Better use of time — it might work, but something else would work more.",
        "No evidence — nothing in the business's own data supports it.",
      ]),
      p("The reasons are a closed set rather than free text, on purpose. Free-text reasons cannot be counted, and a reason that cannot be counted cannot be checked. \"Felt off\" tells you nothing next month. \"Low intent, eleven times, on one channel\" is a pattern you can act on."),

      h2("Grading the refusals"),
      p("A refusal is a prediction: this would not have worked, or something else would have worked better. Predictions can be checked."),
      p("Each refusal carries a verdict that starts as unknown. If outcome data later shows the declined action would have worked — say the founder tried it anyway and it performed — the verdict becomes wrong. If the evidence shows declining was right, it becomes held. Most refusals stay unknown for good, because you rarely find out what the road not taken would have done, and we would rather show that honestly than fill the gap with a guess."),
      p("A tool that is only ever graded on what it produced will always produce more. Grading it on what it declined is the only way to learn whether its judgment is any good."),

      h2("Two grades, not one"),
      p("A refusal usually comes with an alternative: not that, do this instead. So there are two things to grade, and they are easy to confuse. Did the declined action deserve declining? And did the thing done instead work?"),
      p("They are independent, and the ledger keeps them apart. The alternative can work brilliantly while the declined channel would have worked too — the refusal was still a mistake, just a cheap one. Or the alternative can flop while the refusal was entirely right. Counting a successful alternative as proof the refusal was correct is the most natural error in this whole area, and it would make the tool look wiser than it is every time something it chose went well."),

      h2("Why this is rare"),
      p("Refusing is bad for engagement. A tool that does less looks less busy, and a dashboard full of drafts feels like progress even when none of them should ship. Nearly every incentive in this category points toward volume."),
      p("But volume is not what a small business is short of. It is short of time and attention, and every unnecessary post spends both — the founder's to review it, and the audience's to scroll past it."),

      h2("What to ask your own tools"),
      ul([
        "When did it last recommend not doing something?",
        "Can it tell you why, in terms you could check later?",
        "Does anything ever measure whether its recommendations — including the negative ones — were right?",
      ]),
      p("If the answers are never, no and no, you have a content generator. That can be useful. It is not a CMO."),
    ],
    faq: [
      {
        q: "Why would an AI marketing tool refuse to create content?",
        a: "Because the scarce resource for a small business is attention, not output. Declining channels with the wrong audience, low buying intent or no supporting evidence saves the founder's review time and the audience's patience.",
      },
      {
        q: "How can you tell whether an AI's refusal was correct?",
        a: "Treat each refusal as a prediction and check it against outcomes later. Populr records a verdict for each — held, wrong or unknown — and most stay unknown, because what would have happened on the untried channel is usually never observed.",
      },
      {
        q: "Why use a fixed list of refusal reasons instead of explanations?",
        a: "A closed set of reasons can be counted and compared over time. Free-text explanations cannot be aggregated, so patterns — such as one channel being declined repeatedly for low intent — never become visible.",
      },
    ],
  },
];

/** Words a reader actually reads, counted from the blocks. */
export function wordsIn(blocks: Block[]): number {
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
  return blocks.reduce((n, b) => {
    switch (b.kind) {
      case "ul": case "ol": return n + b.items.reduce((m, s) => m + words(s), 0);
      case "table": return n + [...b.head, ...b.rows.flat()].reduce((m, s) => m + words(s), 0);
      default: return n + words(b.text);
    }
  }, 0);
}

// Reading time is computed, not typed.
//
// It was a hand-entered field, and every guide overstated itself by about double — "7 min
// read" on 562 words. Nobody lied; a number written once and never checked simply drifts.
// It now also feeds the structured data, where an inflated figure is a claim about the page
// rather than a harmless label, so it comes from the same text the reader gets. 200 words a
// minute, rounded up: for prose with tables and lists, that errs slightly long, not short.
const WORDS_PER_MINUTE = 200;

export const GUIDES: Guide[] = AUTHORED.map((g) => ({
  ...g,
  readingMinutes: Math.max(1, Math.ceil(wordsIn(g.blocks) / WORDS_PER_MINUTE)),
}));

export function guideBySlug(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

/** Newest first, for the index and the sitemap. */
export function allGuides(): Guide[] {
  return [...GUIDES].sort((a, b) => b.published.localeCompare(a.published));
}
