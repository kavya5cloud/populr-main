// What Populr sells, in one place.
//
// Every price, limit and trial length on the site reads from here, so the pricing section,
// the structured data, the billing panel and the gate cannot quietly disagree. Pure, and safe
// to import from a client component.

export const PRICE = { monthly: 15, yearly: 150, currency: "USD" } as const;

/** Two months free, stated as a sum rather than typed in. */
export const YEARLY_MONTHS_FREE = Math.round((PRICE.monthly * 12 - PRICE.yearly) / PRICE.monthly);

export const TRIAL_DAYS = 14;

/**
 * Accounts that signed up on the promise of a free month keep it, and so does anyone who
 * arrives through a referral link, which says "your first month is free" in as many words.
 */
export const LONG_TRIAL_DAYS = 30;
export const TRIAL_CUTOVER = Date.UTC(2026, 10, 4);

export function trialDaysFor(createdAt: number, referred: boolean): number {
  return referred || createdAt < TRIAL_CUTOVER ? LONG_TRIAL_DAYS : TRIAL_DAYS;
}

/** What an account keeps once its trial is over and nobody is paying. Resets each month. */
export const FREE_AI_ACTIONS = 25;

/**
 * What a visitor gets with no account at all: enough for one site analysis, which is three to
 * five model calls and one retry. The sign-in screen appears after that anyway; this is what
 * stops someone skipping it by calling the API.
 */
export const ANON_AI_ACTIONS = 8;

/**
 * The same limit by network, per day, for someone who clears their cookies. Set well above
 * the per-browser limit because Indian mobile networks put many people behind one address.
 */
export const ANON_IP_PER_DAY = 40;
