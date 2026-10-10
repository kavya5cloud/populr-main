// The landing page in the languages Populr writes in.
//
// Real pages, not machine-swapped labels: each one says what Populr does, how it works,
// what it costs and answers the questions people actually ask, in that language. Search
// engines treat a translated page as its own page only when it carries its own substance,
// and Indian- and European-language searches for marketing tools are far less contested
// than English ones.
//
// Only languages the product itself can write in are listed — a landing page in German for
// a product that can't write German would be a promise the signup breaks.
//
// Written carefully but not by native speakers. Have a native speaker read the headline
// and FAQ of any language before promoting it.

export type LandingCopy = {
  /** BCP 47 for <html lang>/hreflang. */
  hreflang: string;
  /** The language's own name, for the switcher. */
  name: string;
  title: string;
  description: string;
  eyebrow: string;
  h1: string;
  h1Tail: string;
  sub: string;
  placeholder: string;
  cta: string;
  ctaShort: string;
  under: string;
  nav: { how: string; pricing: string; start: string };
  tags: [string, string, string];
  howTitle: string;
  steps: [{ t: string; d: string }, { t: string; d: string }, { t: string; d: string }];
  languagesLine: string;
  pricingTitle: string;
  pricing: string;
  faqTitle: string;
  faq: { q: string; a: string }[];
  otherLanguages: string;
};

export const LANDING_LOCALES = ["hi", "mr", "fr", "de", "es", "pt", "it", "nl", "pl"] as const;
export type LandingLocale = (typeof LANDING_LOCALES)[number];

export const LANDING: Record<LandingLocale, LandingCopy> = {
  hi: {
    hreflang: "hi-IN", name: "हिन्दी",
    title: "Populr — आपका AI CMO, हिन्दी में",
    description: "Populr आपकी वेबसाइट पढ़ता है, तय करता है कि कौन-सी मार्केटिंग करने लायक है, और उसे हिन्दी समेत 32 भाषाओं में करता है। पहला महीना मुफ़्त।",
    eyebrow: "अभी अर्ली एक्सेस में",
    h1: "आपका AI CMO।", h1Tail: "यह तय करता है कि क्या करने लायक है — फिर उसे करता है।",
    sub: "अपनी वेबसाइट का पता डालिए। Populr उसे पढ़ता है, आपकी पहचान समझता है और आज की योजना बनाता है — और बताता है कि उसने क्या करने से मना किया।",
    placeholder: "aapkadukaan.in", cta: "मेरी साइट जाँचें", ctaShort: "जाँचें",
    under: "पहला महीना मुफ़्त · कार्ड नहीं चाहिए · ज़रूरी हर चीज़ आपकी मंज़ूरी से",
    nav: { how: "कैसे काम करता है", pricing: "क़ीमत", start: "मुफ़्त शुरू करें" },
    tags: ["आपकी साइट पढ़ता है", "तय करता है", "फिर हर दिन करता है"],
    howTitle: "यह कैसे काम करता है",
    steps: [
      { t: "पढ़ता है", d: "आपकी वेबसाइट, आपके ग्राहक और इस हफ़्ते आपके बाज़ार में क्या चल रहा है।" },
      { t: "तय करता है", d: "कई संभावित कामों में से वे कुछ चुनता है जो सच में असर करेंगे — और बाक़ी को मना करने की वजह बताता है।" },
      { t: "करता है", d: "पोस्ट आपकी भाषा में लिखता है — अनुवाद नहीं — और आपकी मंज़ूरी के बाद प्रकाशित करता है।" },
    ],
    languagesLine: "हिन्दी, मराठी, तमिल, बंगाली समेत 32 भाषाओं में सीधे लिखता है।",
    pricingTitle: "क़ीमत",
    pricing: "पहला महीना मुफ़्त, फिर $15 प्रति माह। कभी भी रद्द करें।",
    faqTitle: "अक्सर पूछे जाने वाले सवाल",
    faq: [
      { q: "क्या Populr हिन्दी में पोस्ट लिख सकता है?", a: "हाँ। Populr हिन्दी में सीधे लिखता है, अंग्रेज़ी से अनुवाद करके नहीं, इसलिए पोस्ट वैसी लगती हैं जैसे आपके ग्राहक बोलते हैं।" },
      { q: "क्या यह मेरी मंज़ूरी के बिना कुछ प्रकाशित करेगा?", a: "ज़रूरी चीज़ें आपकी मंज़ूरी के बिना नहीं जातीं। आप तय करते हैं कि क्या अपने-आप जाए और क्या आपसे पूछकर।" },
      { q: "क्या मुझे मार्केटिंग की जानकारी चाहिए?", a: "नहीं। बस अपनी वेबसाइट का पता डालिए। Populr बताता है कि क्या करना है और क्यों।" },
    ],
    otherLanguages: "दूसरी भाषाएँ",
  },
  mr: {
    hreflang: "mr-IN", name: "मराठी",
    title: "Populr — तुमचा AI CMO, मराठीत",
    description: "Populr तुमची वेबसाइट वाचतो, कोणती मार्केटिंग करण्यासारखी आहे ते ठरवतो, आणि ती मराठीसह 32 भाषांमध्ये करतो. पहिला महिना मोफत.",
    eyebrow: "सध्या अर्ली ॲक्सेसमध्ये",
    h1: "तुमचा AI CMO.", h1Tail: "काय करण्यासारखं आहे ते तो ठरवतो — आणि मग ते करतो.",
    sub: "तुमच्या वेबसाइटचा पत्ता टाका. Populr ती वाचतो, तुमची ओळख समजून घेतो आणि आजची योजना तयार करतो — आणि त्याने काय करायला नकार दिला तेही सांगतो.",
    placeholder: "tumchidukan.in", cta: "माझी साइट तपासा", ctaShort: "तपासा",
    under: "पहिला महिना मोफत · कार्ड नको · महत्त्वाचं सगळं तुमच्या मंजुरीनं",
    nav: { how: "कसं काम करतं", pricing: "किंमत", start: "मोफत सुरू करा" },
    tags: ["तुमची साइट वाचतो", "ठरवतो", "मग रोज करतो"],
    howTitle: "हे कसं काम करतं",
    steps: [
      { t: "वाचतो", d: "तुमची वेबसाइट, तुमचे ग्राहक आणि या आठवड्यात तुमच्या बाजारात काय चाललं आहे." },
      { t: "ठरवतो", d: "अनेक शक्य कामांपैकी खरंच फरक पाडणारी थोडी निवडतो — आणि बाकीची का नाकारली ते सांगतो." },
      { t: "करतो", d: "पोस्ट तुमच्या भाषेत लिहितो — भाषांतर नाही — आणि तुमच्या मंजुरीनंतर प्रकाशित करतो." },
    ],
    languagesLine: "मराठी, हिंदी, तमिळ, बंगाली यांसह 32 भाषांमध्ये थेट लिहितो.",
    pricingTitle: "किंमत",
    pricing: "पहिला महिना मोफत, मग दरमहा $15. कधीही रद्द करा.",
    faqTitle: "नेहमी विचारले जाणारे प्रश्न",
    faq: [
      { q: "Populr मराठीत पोस्ट लिहू शकतो का?", a: "हो. Populr मराठीत थेट लिहितो, इंग्रजीतून भाषांतर करून नाही, त्यामुळे पोस्ट तुमचे ग्राहक जसे बोलतात तशा वाटतात." },
      { q: "माझ्या मंजुरीशिवाय तो काही प्रकाशित करेल का?", a: "महत्त्वाचं काहीही तुमच्या मंजुरीशिवाय जात नाही. काय आपोआप जावं आणि काय विचारून, ते तुम्ही ठरवता." },
      { q: "मला मार्केटिंगचं ज्ञान लागेल का?", a: "नाही. फक्त तुमच्या वेबसाइटचा पत्ता टाका. काय करायचं आणि का, ते Populr सांगतो." },
    ],
    otherLanguages: "इतर भाषा",
  },
  fr: {
    hreflang: "fr", name: "Français",
    title: "Populr — votre directeur marketing IA",
    description: "Populr lit votre site, décide quel marketing vaut la peine d'être fait, puis le fait — en français et dans 31 autres langues. Premier mois offert.",
    eyebrow: "En accès anticipé",
    h1: "Votre CMO IA.", h1Tail: "Il décide de ce qui vaut la peine d'être fait, puis il le fait.",
    sub: "Saisissez l'adresse de votre site. Populr le lit, comprend votre positionnement et prépare le plan du jour — et vous dit ce qu'il a refusé de faire.",
    placeholder: "votreentreprise.fr", cta: "Analyser mon site", ctaShort: "Analyser",
    under: "Premier mois offert · sans carte · vous validez tout ce qui compte",
    nav: { how: "Fonctionnement", pricing: "Tarif", start: "Essai gratuit" },
    tags: ["Lit votre site", "Décide", "Puis agit, chaque jour"],
    howTitle: "Comment ça marche",
    steps: [
      { t: "Il lit", d: "Votre site, vos clients et ce qui se passe cette semaine sur votre marché." },
      { t: "Il décide", d: "Parmi des dizaines d'actions possibles, il retient les quelques-unes qui comptent — et explique pourquoi il écarte les autres." },
      { t: "Il agit", d: "Il rédige vos publications directement dans votre langue — pas en traduction — et les publie une fois validées." },
    ],
    languagesLine: "Écrit directement en français, allemand, espagnol, italien et 28 autres langues.",
    pricingTitle: "Tarif",
    pricing: "Premier mois offert, puis 15 $ par mois. Résiliable à tout moment.",
    faqTitle: "Questions fréquentes",
    faq: [
      { q: "Populr écrit-il vraiment en français ?", a: "Oui. Il écrit directement en français plutôt que de traduire depuis l'anglais, si bien que vos publications sonnent comme vos clients parlent." },
      { q: "Publie-t-il quelque chose sans mon accord ?", a: "Rien d'important ne part sans votre validation. Vous choisissez ce qui peut partir seul et ce qui doit vous être soumis." },
      { q: "Faut-il s'y connaître en marketing ?", a: "Non. Il suffit de saisir l'adresse de votre site : Populr vous dit quoi faire, et pourquoi." },
    ],
    otherLanguages: "Autres langues",
  },
  de: {
    hreflang: "de", name: "Deutsch",
    title: "Populr — Ihr KI-Marketingchef",
    description: "Populr liest Ihre Website, entscheidet, welches Marketing sich lohnt, und setzt es um — auf Deutsch und in 31 weiteren Sprachen. Erster Monat kostenlos.",
    eyebrow: "Jetzt im Early Access",
    h1: "Ihr KI-CMO.", h1Tail: "Er entscheidet, was sich lohnt — und setzt es dann um.",
    sub: "Geben Sie Ihre Website ein. Populr liest sie, versteht Ihre Positionierung und erstellt den Plan für heute — und sagt Ihnen, was es bewusst nicht tut.",
    placeholder: "ihrefirma.de", cta: "Website prüfen", ctaShort: "Prüfen",
    under: "Erster Monat kostenlos · keine Karte · Wichtiges geben Sie selbst frei",
    nav: { how: "So funktioniert's", pricing: "Preis", start: "Kostenlos starten" },
    tags: ["Liest Ihre Website", "Entscheidet", "Und handelt, jeden Tag"],
    howTitle: "So funktioniert es",
    steps: [
      { t: "Lesen", d: "Ihre Website, Ihre Kunden und was diese Woche in Ihrem Markt passiert." },
      { t: "Entscheiden", d: "Aus Dutzenden möglichen Maßnahmen wählt es die wenigen, die wirklich zählen — und begründet, warum es den Rest ablehnt." },
      { t: "Umsetzen", d: "Es schreibt Ihre Beiträge direkt auf Deutsch — nicht übersetzt — und veröffentlicht sie nach Ihrer Freigabe." },
    ],
    languagesLine: "Schreibt direkt auf Deutsch, Französisch, Spanisch, Italienisch und in 28 weiteren Sprachen.",
    pricingTitle: "Preis",
    pricing: "Erster Monat kostenlos, danach 15 $ pro Monat. Jederzeit kündbar.",
    faqTitle: "Häufige Fragen",
    faq: [
      { q: "Schreibt Populr wirklich auf Deutsch?", a: "Ja. Populr schreibt direkt auf Deutsch, statt aus dem Englischen zu übersetzen, damit Ihre Beiträge so klingen, wie Ihre Kunden sprechen." },
      { q: "Veröffentlicht es etwas ohne meine Zustimmung?", a: "Nichts Wichtiges geht ohne Ihre Freigabe raus. Sie legen fest, was automatisch erscheint und was Sie vorher sehen." },
      { q: "Brauche ich Marketing-Kenntnisse?", a: "Nein. Geben Sie einfach Ihre Website ein — Populr sagt Ihnen, was zu tun ist und warum." },
    ],
    otherLanguages: "Weitere Sprachen",
  },
  es: {
    hreflang: "es", name: "Español",
    title: "Populr — tu director de marketing con IA",
    description: "Populr lee tu web, decide qué marketing merece la pena y lo hace — en español y en otros 31 idiomas. Primer mes gratis.",
    eyebrow: "Ya en acceso anticipado",
    h1: "Tu CMO con IA.", h1Tail: "Decide qué merece la pena hacer y luego lo hace.",
    sub: "Escribe la dirección de tu web. Populr la lee, entiende tu posicionamiento y prepara el plan de hoy — y te dice qué ha decidido no hacer.",
    placeholder: "tuempresa.es", cta: "Analizar mi web", ctaShort: "Analizar",
    under: "Primer mes gratis · sin tarjeta · tú apruebas todo lo importante",
    nav: { how: "Cómo funciona", pricing: "Precio", start: "Empieza gratis" },
    tags: ["Lee tu web", "Decide", "Y actúa, cada día"],
    howTitle: "Cómo funciona",
    steps: [
      { t: "Lee", d: "Tu web, tus clientes y lo que está pasando esta semana en tu mercado." },
      { t: "Decide", d: "Entre decenas de acciones posibles elige las pocas que de verdad importan — y explica por qué descarta las demás." },
      { t: "Actúa", d: "Escribe tus publicaciones directamente en tu idioma — sin traducir — y las publica cuando las apruebas." },
    ],
    languagesLine: "Escribe directamente en español, francés, alemán, italiano y otros 28 idiomas.",
    pricingTitle: "Precio",
    pricing: "Primer mes gratis, después 15 $ al mes. Cancela cuando quieras.",
    faqTitle: "Preguntas frecuentes",
    faq: [
      { q: "¿Populr escribe de verdad en español?", a: "Sí. Escribe directamente en español en lugar de traducir del inglés, así que tus publicaciones suenan como hablan tus clientes." },
      { q: "¿Publica algo sin mi permiso?", a: "Nada importante sale sin tu aprobación. Tú decides qué se publica solo y qué te consulta antes." },
      { q: "¿Necesito saber de marketing?", a: "No. Solo escribe la dirección de tu web: Populr te dice qué hacer y por qué." },
    ],
    otherLanguages: "Otros idiomas",
  },
  pt: {
    hreflang: "pt", name: "Português",
    title: "Populr — o seu diretor de marketing com IA",
    description: "O Populr lê o seu site, decide que marketing vale a pena e faz — em português e em mais 31 idiomas. Primeiro mês grátis.",
    eyebrow: "Em acesso antecipado",
    h1: "O seu CMO com IA.", h1Tail: "Decide o que vale a pena fazer — e depois faz.",
    sub: "Escreva o endereço do seu site. O Populr lê-o, percebe o seu posicionamento e prepara o plano de hoje — e diz-lhe o que decidiu não fazer.",
    placeholder: "suaempresa.pt", cta: "Analisar o meu site", ctaShort: "Analisar",
    under: "Primeiro mês grátis · sem cartão · aprova tudo o que importa",
    nav: { how: "Como funciona", pricing: "Preço", start: "Começar grátis" },
    tags: ["Lê o seu site", "Decide", "E age, todos os dias"],
    howTitle: "Como funciona",
    steps: [
      { t: "Lê", d: "O seu site, os seus clientes e o que está a acontecer esta semana no seu mercado." },
      { t: "Decide", d: "Entre dezenas de ações possíveis, escolhe as poucas que contam — e explica porque recusa as restantes." },
      { t: "Age", d: "Escreve as suas publicações diretamente em português — sem tradução — e publica-as depois da sua aprovação." },
    ],
    languagesLine: "Escreve diretamente em português (de Portugal e do Brasil), espanhol, francês e alemão — 32 idiomas no total.",
    pricingTitle: "Preço",
    pricing: "Primeiro mês grátis, depois 15 $ por mês. Cancele quando quiser.",
    faqTitle: "Perguntas frequentes",
    faq: [
      { q: "O Populr escreve mesmo em português?", a: "Sim. Escreve diretamente em português, em vez de traduzir do inglês, por isso as publicações soam como os seus clientes falam." },
      { q: "Publica alguma coisa sem a minha autorização?", a: "Nada importante sai sem a sua aprovação. É o utilizador que decide o que segue automaticamente e o que lhe é mostrado antes." },
      { q: "Preciso de saber de marketing?", a: "Não. Basta escrever o endereço do seu site: o Populr diz-lhe o que fazer e porquê." },
    ],
    otherLanguages: "Outros idiomas",
  },
  it: {
    hreflang: "it", name: "Italiano",
    title: "Populr — il tuo direttore marketing con IA",
    description: "Populr legge il tuo sito, decide quale marketing vale la pena fare e lo fa — in italiano e in altre 31 lingue. Primo mese gratis.",
    eyebrow: "Ora in accesso anticipato",
    h1: "Il tuo CMO con IA.", h1Tail: "Decide cosa vale la pena fare, poi lo fa.",
    sub: "Inserisci l'indirizzo del tuo sito. Populr lo legge, capisce il tuo posizionamento e prepara il piano di oggi — e ti dice cosa ha scelto di non fare.",
    placeholder: "latuaazienda.it", cta: "Analizza il mio sito", ctaShort: "Analizza",
    under: "Primo mese gratis · nessuna carta · approvi tu tutto ciò che conta",
    nav: { how: "Come funziona", pricing: "Prezzo", start: "Inizia gratis" },
    tags: ["Legge il tuo sito", "Decide", "E agisce, ogni giorno"],
    howTitle: "Come funziona",
    steps: [
      { t: "Legge", d: "Il tuo sito, i tuoi clienti e quello che succede questa settimana nel tuo mercato." },
      { t: "Decide", d: "Tra decine di azioni possibili sceglie le poche che contano davvero — e spiega perché scarta le altre." },
      { t: "Agisce", d: "Scrive i tuoi post direttamente in italiano — non tradotti — e li pubblica dopo la tua approvazione." },
    ],
    languagesLine: "Scrive direttamente in italiano, francese, tedesco, spagnolo e in altre 28 lingue.",
    pricingTitle: "Prezzo",
    pricing: "Primo mese gratis, poi 15 $ al mese. Disdici quando vuoi.",
    faqTitle: "Domande frequenti",
    faq: [
      { q: "Populr scrive davvero in italiano?", a: "Sì. Scrive direttamente in italiano invece di tradurre dall'inglese, così i tuoi post suonano come parlano i tuoi clienti." },
      { q: "Pubblica qualcosa senza il mio consenso?", a: "Niente di importante esce senza la tua approvazione. Decidi tu cosa va in automatico e cosa vuoi vedere prima." },
      { q: "Devo intendermi di marketing?", a: "No. Basta inserire l'indirizzo del tuo sito: Populr ti dice cosa fare e perché." },
    ],
    otherLanguages: "Altre lingue",
  },
  nl: {
    hreflang: "nl", name: "Nederlands",
    title: "Populr — jouw AI-marketingdirecteur",
    description: "Populr leest je website, bepaalt welke marketing de moeite waard is en voert die uit — in het Nederlands en 31 andere talen. Eerste maand gratis.",
    eyebrow: "Nu in early access",
    h1: "Jouw AI-CMO.", h1Tail: "Hij bepaalt wat de moeite waard is — en doet het dan.",
    sub: "Vul je website in. Populr leest hem, begrijpt je positionering en maakt het plan voor vandaag — en vertelt je wat hij bewust niet doet.",
    placeholder: "jouwbedrijf.nl", cta: "Analyseer mijn site", ctaShort: "Analyseer",
    under: "Eerste maand gratis · geen creditcard · jij keurt alles goed wat ertoe doet",
    nav: { how: "Hoe het werkt", pricing: "Prijs", start: "Gratis starten" },
    tags: ["Leest je site", "Beslist", "En doet het, elke dag"],
    howTitle: "Hoe het werkt",
    steps: [
      { t: "Lezen", d: "Je website, je klanten en wat er deze week in je markt gebeurt." },
      { t: "Beslissen", d: "Uit tientallen mogelijke acties kiest hij de paar die echt tellen — en legt uit waarom hij de rest afwijst." },
      { t: "Doen", d: "Hij schrijft je berichten direct in het Nederlands — niet vertaald — en publiceert ze na jouw goedkeuring." },
    ],
    languagesLine: "Schrijft direct in het Nederlands, Duits, Frans, Engels en 28 andere talen.",
    pricingTitle: "Prijs",
    pricing: "Eerste maand gratis, daarna $15 per maand. Altijd opzegbaar.",
    faqTitle: "Veelgestelde vragen",
    faq: [
      { q: "Schrijft Populr echt in het Nederlands?", a: "Ja. Populr schrijft direct in het Nederlands in plaats van uit het Engels te vertalen, zodat je berichten klinken zoals je klanten praten." },
      { q: "Publiceert hij iets zonder mijn toestemming?", a: "Niets belangrijks gaat de deur uit zonder jouw goedkeuring. Jij bepaalt wat automatisch mag en wat je eerst wilt zien." },
      { q: "Moet ik verstand hebben van marketing?", a: "Nee. Vul gewoon je website in: Populr vertelt je wat je moet doen en waarom." },
    ],
    otherLanguages: "Andere talen",
  },
  pl: {
    hreflang: "pl", name: "Polski",
    title: "Populr — Twój dyrektor marketingu z AI",
    description: "Populr czyta Twoją stronę, decyduje, który marketing ma sens, i go realizuje — po polsku i w 31 innych językach. Pierwszy miesiąc za darmo.",
    eyebrow: "Teraz we wczesnym dostępie",
    h1: "Twój CMO z AI.", h1Tail: "Decyduje, co warto zrobić — a potem to robi.",
    sub: "Wpisz adres swojej strony. Populr ją przeczyta, zrozumie Twoje pozycjonowanie i przygotuje plan na dziś — i powie, czego postanowił nie robić.",
    placeholder: "twojafirma.pl", cta: "Przeanalizuj moją stronę", ctaShort: "Analizuj",
    under: "Pierwszy miesiąc za darmo · bez karty · wszystko, co ważne, zatwierdzasz Ty",
    nav: { how: "Jak to działa", pricing: "Cena", start: "Zacznij za darmo" },
    tags: ["Czyta Twoją stronę", "Decyduje", "I działa, codziennie"],
    howTitle: "Jak to działa",
    steps: [
      { t: "Czyta", d: "Twoją stronę, Twoich klientów i to, co dzieje się w tym tygodniu na Twoim rynku." },
      { t: "Decyduje", d: "Spośród dziesiątek możliwych działań wybiera kilka, które naprawdę się liczą — i wyjaśnia, dlaczego odrzuca resztę." },
      { t: "Działa", d: "Pisze Twoje posty bezpośrednio po polsku — bez tłumaczenia — i publikuje je po Twojej akceptacji." },
    ],
    languagesLine: "Pisze bezpośrednio po polsku, niemiecku, francusku, hiszpańsku i w 28 innych językach.",
    pricingTitle: "Cena",
    pricing: "Pierwszy miesiąc za darmo, potem 15 $ miesięcznie. Możesz zrezygnować w każdej chwili.",
    faqTitle: "Najczęstsze pytania",
    faq: [
      { q: "Czy Populr naprawdę pisze po polsku?", a: "Tak. Pisze bezpośrednio po polsku zamiast tłumaczyć z angielskiego, więc Twoje posty brzmią tak, jak mówią Twoi klienci." },
      { q: "Czy opublikuje coś bez mojej zgody?", a: "Nic ważnego nie wychodzi bez Twojej akceptacji. To Ty decydujesz, co publikuje się samo, a co chcesz najpierw zobaczyć." },
      { q: "Czy muszę znać się na marketingu?", a: "Nie. Wystarczy wpisać adres strony: Populr powie Ci, co zrobić i dlaczego." },
    ],
    otherLanguages: "Inne języki",
  },
};

/** Every language version of the home page, for hreflang. English is x-default. */
export function homeAlternates(): Record<string, string> {
  return {
    en: "/",
    ...Object.fromEntries(LANDING_LOCALES.map((l) => [LANDING[l].hreflang, `/${l}`])),
    "x-default": "/",
  };
}
