import { readFromGithub, writeToGithub, isGithubStoreEnabled } from "./githubStore";
/**
 * שאיבת מקורות מחיר-מבוקש דרך Apify — יד2 · יד1 · מדלן · פייסבוק.
 *
 * למה דרך Apify ולא מהמחשב: ליד2/מדלן יש הגנות אנטי-בוט (Radware) שחוסמות
 * דפדפן מונחה-אוטומציה, ולפייסבוק אין API רשמי ל-Marketplace כלל. Apify מריצים
 * את התשתית אצלם, ולכן: אין קאפצ'ה במחשב שלך, לא נדרשת התחברות לחשבונות שלך,
 * ואין סיכון לחסימת ה-IP או השעיית חשבון. המחשב שלך גם לא צריך להיות דלוק.
 *
 * הטוקן נשאר בשרת בלבד (process.env.APIFY_TOKEN) ולעולם לא מגיע לדפדפן.
 */

const APIFY_BASE = "https://api.apify.com/v2/acts";

const ACTORS = {
  yad2: "swerve~yad2-scraper",
  madlan: "swerve~madlan-analytics",
  facebook: "apify~facebook-marketplace-scraper",
  // עסקאות סגורות של רשות המסים (GovMap). עד יוני 2026 נשאבו ישירות
  // מהדפדפן, אך govmap הוסיפו reCAPTCHA ל-API והחסימו שאיבה ישירה.
  // האקטור מריץ דפדפן אמיתי אצל Apify, שם ה-reCAPTCHA נפתר כדין.
  nadlan: "swerve~nadlan-deals",
} as const;

/**
 * האקטורים מצפים לשם עיר באנגלית. המשתמש מקליד עברית, ולכן נדרש מיפוי.
 * ערים שאינן ברשימה מועברות כמו שהן — חלק מהאקטורים מזהים גם עברית.
 */
const CITY_EN: Record<string, string> = {
  "תל אביב": "Tel Aviv", "תל אביב יפו": "Tel Aviv", "תל אביב-יפו": "Tel Aviv",
  "ירושלים": "Jerusalem", "חיפה": "Haifa", "ראשון לציון": "Rishon LeZion",
  "פתח תקווה": "Petah Tikva", "אשדוד": "Ashdod", "נתניה": "Netanya",
  "באר שבע": "Beer Sheva", "בני ברק": "Bnei Brak", "חולון": "Holon",
  "רמת גן": "Ramat Gan", "אשקלון": "Ashkelon", "רחובות": "Rehovot",
  "בת ים": "Bat Yam", "הרצליה": "Herzliya", "כפר סבא": "Kfar Saba",
  "רעננה": "Raanana", "מודיעין": "Modiin", "גבעתיים": "Givatayim",
  "הוד השרון": "Hod Hasharon", "ראש העין": "Rosh Haayin",
  "נס ציונה": "Ness Ziona", "לוד": "Lod", "רמלה": "Ramla",
  "כרמיאל": "Karmiel", "עפולה": "Afula", "טבריה": "Tiberias",
  "נהריה": "Nahariya", "אילת": "Eilat", "דימונה": "Dimona",
  "קרית גת": "Kiryat Gat", "קרית אונו": "Kiryat Ono", "יבנה": "Yavne",
  "בית שמש": "Beit Shemesh", "אור יהודה": "Or Yehuda", "צפת": "Safed",
};

export function toEnglishCity(city: string): string {
  const clean = (city || "").trim();
  return CITY_EN[clean] || clean;
}

/** משווה שם רחוב אחרי הסרת "רחוב"/"רח׳", פסיקים ומספר בית. */
function normStreet(s: unknown): string {
  return String(s || "")
    .replace(/רח['׳]?\s*/g, "")
    .replace(/רחוב\s*/g, "")
    .replace(/[",]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function streetMatches(itemStreet: unknown, query: string): boolean {
  const name = normStreet(query).replace(/\d+.*$/, "").trim();
  if (name.length < 2) return false;
  return normStreet(itemStreet).includes(name);
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * מטמון תוצאות — החיסכון העיקרי בעלות.
 *
 * כל קריאה ל-Apify עולה כסף, ומחירי נדל"ן אינם משתנים תוך שעות. שמירת
 * התוצאה לכל צירוף (אקטור + קלט) הופכת חיפוש חוזר באותה עיר לחינמי לגמרי.
 * המטמון בזיכרון בלבד: הוא מתאפס בהפעלה מחדש של השרת, וזה מקובל — לכל
 * היותר נשלם שוב על החיפוש הראשון.
 */
/**
 * שבועיים. איזון בין טריות לחיסכון: שאיבה עולה קרדיט, אבל מחירי נדל"ן
 * זזים לאט — נתון בן שבועיים עדיין מייצג, ומוגש חינם מהמטמון במקום לחייב
 * שוב על אותה עיר. יש גם "חיפוש טרי" למי שרוצה לבדוק עדכונים מיד.
 */
const CACHE_TTL_MS = 336 * 60 * 60 * 1000; // שבועיים (336 שעות)
const MAX_CACHE_ENTRIES = 300; // תקרה כדי שהזיכרון לא יגדל ללא הגבלה

interface CacheEntry {
  at: number;
  rows: any[];
}
const resultCache = new Map<string, CacheEntry>();

/** מנקה רשומות שפג תוקפן, ואם עדיין צפוף — מוחק את הישנות ביותר. */
function pruneCache() {
  const now = Date.now();
  for (const [key, entry] of resultCache) {
    if (now - entry.at > CACHE_TTL_MS) resultCache.delete(key);
  }
  if (resultCache.size <= MAX_CACHE_ENTRIES) return;
  const byAge = [...resultCache.entries()].sort((a, b) => a[1].at - b[1].at);
  for (const [key] of byAge.slice(0, resultCache.size - MAX_CACHE_ENTRIES)) {
    resultCache.delete(key);
  }
}

/**
 * מסיר פרטים אישיים של מפרסמים לפני עיבוד ואחסון.
 *
 * מודעות יד2 מגיעות עם טלפון ושם של המוכר, ופייסבוק עם פרטי מוכר. האתר
 * אינו מציג אותם ואינו זקוק להם, ואחסונם — במיוחד מחוץ לשרת — היה הופך
 * שמירת מטמון לפרסום מידע אישי של אנשים אמיתיים. מוסרים אותם במקור.
 */
const PERSONAL_FIELDS = [
  "contactPhone",
  "contactName",
  "phone",
  "sellerName",
  "seller",
  "userName",
  "profileUrl",
  "actorId",
  "listingVideo",
];

function stripPersonalData<T extends Record<string, any>>(row: T): T {
  if (!row || typeof row !== "object") return row;
  const clean: Record<string, any> = { ...row };
  for (const f of PERSONAL_FIELDS) delete clean[f];
  return clean as T;
}

/** נזרקת כשהתבקש מטמון בלבד ואין רשומה מתאימה — כדי להבדיל מכשל אמיתי. */
export class CacheMissError extends Error {
  constructor(actor: string) {
    super(`אין נתונים שמורים עבור ${actor}`);
    this.name = "CacheMissError";
  }
}

/**
 * רוטציית חשבונות Apify: אוסף את כל הטוקנים המוגדרים, וכשאחד מוצה את
 * הקרדיט החינמי שלו (402 / מגבלת שימוש) עובר אוטומטית לבא. כך אפשר לצבור
 * את הקרדיט החינמי של כמה חשבונות (למשל 4×$5 = $20 בחודש).
 *
 * מקורות הטוקנים (לפי סדר עדיפות): APIFY_TOKENS (מופרד בפסיקים),
 * APIFY_TOKEN, ואז APIFY_TOKEN_2 ... APIFY_TOKEN_8.
 */
export function getTokens(): string[] {
  const list: string[] = [];
  if (process.env.APIFY_TOKENS) {
    list.push(...process.env.APIFY_TOKENS.split(",").map((t) => t.trim()).filter(Boolean));
  }
  if (process.env.APIFY_TOKEN) list.push(process.env.APIFY_TOKEN.trim());
  for (let i = 2; i <= 8; i++) {
    const t = process.env[`APIFY_TOKEN_${i}`];
    if (t && t.trim()) list.push(t.trim());
  }
  return [...new Set(list)]; // דה-דופ תוך שמירת הסדר
}

/** טוקנים שסומנו כמוצו (בזיכרון). מתאפס באתחול השרת ובתחילת מחזור החיוב. */
const exhaustedTokens = new Set<string>();

/** מזהה תשובת "נגמר הקרדיט/מגבלת שימוש" של Apify (402/403 או הודעה מתאימה). */
function isQuotaError(status: number, body: string): boolean {
  if (status === 402 || status === 403) return true;
  return /usage|limit|exceeded|quota|payment|insufficient/i.test(body);
}

/**
 * מריץ אקטור וממתין לתוצאות.
 * cacheOnly=true מחזיר רק מהמטמון ולעולם לא פונה ל-Apify — כך שכשנגמר
 * הקרדיט עדיין אפשר להציג את מה שכבר נשאב, במקום מסך ריק.
 */
async function runActor(
  actor: string,
  input: unknown,
  timeoutMs = 240000,
  cacheOnly = false,
  forceFresh = false,
): Promise<any[]> {
  const allTokens = getTokens();
  if (!allTokens.length && !cacheOnly) throw new Error("אין טוקן Apify מוגדר (APIFY_TOKEN)");

  const cacheKey = `${actor}|${JSON.stringify(input)}`;
  // forceFresh: המשתמש ביקש "חיפוש טרי" — מדלגים על קריאות המטמון ושואבים
  // מהמקור, ואז דורסים את המטמון בתוצאה החדשה (כך בדיקה אם יצאו עדכונים).
  if (!forceFresh) {
    const cached = resultCache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      const ageMin = Math.round((Date.now() - cached.at) / 60000);
      console.log(`[apify] מטמון: ${actor} (גיל ${ageMin} דק׳) — לא חויב`);
      return cached.rows;
    }
    // המטמון בזיכרון מת עם כל אתחול של השרת. לפני שמשלמים על שאיבה,
    // בודקים את האחסון המתמיד — שם התוצאה שורדת אתחולים ופריסות.
    if (isGithubStoreEnabled()) {
      const stored = await readFromGithub(cacheKey, CACHE_TTL_MS);
      if (stored) {
        resultCache.set(cacheKey, { at: stored.at, rows: stored.rows });
        const ageH = Math.round((Date.now() - stored.at) / 3600000);
        console.log(`[apify] אחסון מתמיד: ${actor} (גיל ${ageH} ש׳) — לא חויב`);
        return stored.rows;
      }
    }
  }

  // חיפוש טרי אינו יכול להתקיים יחד עם "מטמון בלבד": אם אין קרדיט, אין
  // אפשרות לשאיבה טרייה, ולכן נשארים עם מה שיש (ולא זורקים).
  if (cacheOnly) throw new CacheMissError(actor);

  // רוטציה: מנסים טוקנים לפי הסדר, מדלגים על אלה שכבר סומנו כמוצו.
  const tokens = allTokens.filter((t) => !exhaustedTokens.has(t));
  if (!tokens.length) {
    throw new Error("כל חשבונות Apify מיצו את הקרדיט החודשי. יתחדש בתחילת החודש הבא.");
  }

  let data: any = null;
  let lastErr: any = null;

  for (const token of tokens) {
    const url = `${APIFY_BASE}/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
    const tag = `...${token.slice(-4)}`;

    // ה-DNS של api.apify.com מחזיר כמה כתובות ולא כולן מגיבות, מה שמייצר
    // UND_ERR_CONNECT_TIMEOUT אקראי. ניסיון חוזר בוחר כתובת אחרת ופותר את זה.
    let res: Response | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(timeoutMs),
        });
        break;
      } catch (err: any) {
        lastErr = err;
        if (err?.name === "TimeoutError") break;
        if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1000));
      }
    }
    if (!res) continue; // תקלת רשת בטוקן הזה — מנסים את הבא

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (isQuotaError(res.status, body)) {
        // החשבון מיצה את הקרדיט — מסמנים ועוברים אוטומטית לחשבון הבא.
        exhaustedTokens.add(token);
        console.log(`[apify] חשבון ${tag} מוצה (${res.status}) — עובר לחשבון הבא`);
        continue;
      }
      lastErr = new Error(`Apify ${actor} החזיר ${res.status}: ${body.slice(0, 200)}`);
      continue; // שגיאה אחרת — ננסה חשבון אחר לפני שנכשל
    }

    data = await res.json();
    console.log(`[apify] חויב על חשבון ${tag}: ${actor}`);
    break;
  }

  if (data == null) {
    const cause = lastErr?.cause?.code || lastErr?.message || "כל החשבונות מוצו/נכשלו";
    throw new Error(`חיבור ל-Apify נכשל (${actor}): ${cause}`.trim());
  }

  const rows = (Array.isArray(data) ? data : []).map(stripPersonalData);

  // שומרים גם תוצאה ריקה: אם המקור לא מכסה את העיר, אין טעם לשלם על
  // אותה תשובה שוב ושוב באותו יום.
  resultCache.set(cacheKey, { at: Date.now(), rows });
  pruneCache();
  console.log(`[apify] חויב: ${actor} — ${rows.length} תוצאות`);

  // כתיבה לאחסון המתמיד. ממתינים לה (best-effort) כדי להבטיח שהתוצאה
  // תישמר לפני שהשרת עלול להירדם — שאיבה איטית (עד 2.5 דק׳) עלולה שלא
  // להספיק להשלים כתיבת-רקע לפני שהתהליך מושהה, ואז היינו מחויבים שוב.
  if (isGithubStoreEnabled() && rows.length > 0) {
    try {
      await writeToGithub(cacheKey, rows);
    } catch {
      // כישלון אחסון אינו מפיל בקשה — לכל היותר שאיבה חוזרת בעתיד.
    }
  }

  return rows;
}

/** מודעה בודדת, כדי שאפשר יהיה להציג רשימה לפי תאריך ולא רק חציון. */
export interface SourceListing {
  source: string;
  price: number;
  sqm: number | null;
  pricePerSqm: number | null;
  rooms: number | null;
  floor: number | null;
  street: string;
  neighbourhood: string;
  /** תאריך פרסום המודעה (YYYY-MM-DD). ריק כשהמקור אינו מספק אותו. */
  date: string;
  url: string;
  title: string;
  isAgent: boolean;
}

export interface SourceResult {
  source: string;
  /** "street" = סונן לרחוב המבוקש · "city" = רמת עיר. */
  scope: "street" | "city";
  count: number;
  cityCount: number;
  streetCount: number;
  medianPrice: number;
  medianPricePerSqm: number | null;
  /** המודעות עצמן, ממוינות מהחדשה לישנה. */
  listings: SourceListing[];
}

/** ממיר רשימת מודעות גולמית לסיכום, עם סינון לרחוב כשיש מספיק התאמות. */
/** מנרמל תאריך פרסום לפורמט YYYY-MM-DD; מחזיר ריק כשאין תאריך תקין. */
function toDateStr(value: unknown): string {
  if (!value) return "";
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function summarize(
  rows: any[],
  source: string,
  street: string,
  getStreet: (r: any) => unknown,
  getPrice: (r: any) => number | null,
  getSqm: (r: any) => number | null,
): SourceResult {
  const onStreet = street ? rows.filter((r) => streetMatches(getStreet(r), street)) : [];
  // פחות מ-3 התאמות ברחוב אינו מדגם — נופלים לרמת עיר ומסמנים זאת.
  const useStreet = onStreet.length >= 3;
  const items = useStreet ? onStreet : rows;

  const prices = items.map(getPrice).filter((n): n is number => !!n && n > 0);
  const ppsm = items
    .map((r) => {
      const p = getPrice(r);
      const a = getSqm(r);
      return p && a && a > 0 ? Math.round(p / a) : null;
    })
    .filter((n): n is number => n != null);

  // המודעות עצמן — ממוינות מהחדשה לישנה. מודעה ללא תאריך יורדת לסוף,
  // כדי שהמיון לא ייראה שרירותי.
  const listings: SourceListing[] = items
    .map((r) => {
      const price = getPrice(r);
      if (!price) return null;
      const sqm = getSqm(r);
      return {
        source,
        price,
        sqm: sqm ?? null,
        pricePerSqm: sqm && sqm > 0 ? Math.round(price / sqm) : null,
        rooms: r.rooms != null && !Number.isNaN(Number(r.rooms)) ? Number(r.rooms) : null,
        floor: r.floor != null && !Number.isNaN(Number(r.floor)) ? Number(r.floor) : null,
        street: String(getStreet(r) ?? "").slice(0, 80),
        neighbourhood: String(r.neighbourhood ?? "").slice(0, 60),
        date: toDateStr(r.publishedAt ?? r.updatedAt ?? r.creation_time),
        url: String(r.url ?? r.listingUrl ?? ""),
        title: String(r.listingDescription ?? r.marketplace_listing_title ?? r.title ?? "").slice(0, 120),
        isAgent: !!(r.hasAgent || r.agencyName),
      } as SourceListing;
    })
    .filter((x): x is SourceListing => x !== null)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  return {
    source,
    scope: useStreet ? "street" : "city",
    count: items.length,
    cityCount: rows.length,
    streetCount: onStreet.length,
    medianPrice: median(prices),
    medianPricePerSqm: ppsm.length ? median(ppsm) : null,
    listings,
  };
}

/** יד2 — מודעות מכירה אמיתיות, כולל שם רחוב (מאפשר חיפוש מדויק). */
export async function fetchYad2(
  city: string,
  street: string,
  maxItems = 120,
  cacheOnly = false,
  forceFresh = false,
): Promise<SourceResult> {
  const rows = await runActor(
    ACTORS.yad2,
    { city: toEnglishCity(city), dealType: "buy", maxItems },
    240000,
    cacheOnly,
    forceFresh,
  );
  return summarize(rows, "yad2", street, (r) => r.streetName || r.address, (r) => r.price, (r) => r.areaSqm);
}

/**
 * יד1 — פרויקטים מקבלן. אותו אקטור, adType מסמן מודעות קבלן/פרויקט;
 * אם אין כאלה נחזיר 0 ולא ניפול לרמת עיר מטעה.
 */
export async function fetchYad1(
  city: string,
  street: string,
  maxItems = 120,
  cacheOnly = false,
  forceFresh = false,
): Promise<SourceResult> {
  const rows = await runActor(
    ACTORS.yad2,
    { city: toEnglishCity(city), dealType: "buy", maxItems },
    240000,
    cacheOnly,
    forceFresh,
  );
  const fromDeveloper = rows.filter(
    (r) => r.adType === "project" || r.adType === "agency" || r.hasAgent === true,
  );
  return summarize(fromDeveloper, "yad1", street, (r) => r.streetName || r.address, (r) => r.price, (r) => r.areaSqm);
}

export interface MadlanAnalytics {
  source: "madlan";
  cityHebrew: string | null;
  pricePerSqm: number | null;
  yearlyDeals: number | null;
  bulletinsForSale: number | null;
  bulletinsForRent: number | null;
  socioeconomicIndex: number | null;
  pricesByRooms: { rooms: string; medianBuyPrice: number | null; previousBuyPrice: number | null }[];
  /** שינוי שנתי משוקלל באחוזים — מחושב מהחציונים הנוכחיים מול הקודמים. */
  yearlyChangePct: number | null;
}

/** מדלן — אנליטיקה עירונית מה-GraphQL הציבורי שלהם (ללא עקיפת הגנות). */
export async function fetchMadlan(
  city: string,
  neighbourhood?: string,
  cacheOnly = false,
  forceFresh = false,
): Promise<MadlanAnalytics> {
  const input: Record<string, unknown> = { city: toEnglishCity(city), dataTypes: ["all"] };
  if (neighbourhood) input.neighbourhood = neighbourhood;
  const rows = await runActor(ACTORS.madlan, input, 240000, cacheOnly, forceFresh);
  const d = rows[0] || {};

  const byRooms = Array.isArray(d.pricesByRooms) ? d.pricesByRooms : [];
  const withBoth = byRooms.filter((r: any) => r.medianBuyPrice > 0 && r.previousBuyPrice > 0);
  const yearlyChangePct = withBoth.length
    ? Math.round(
        (withBoth.reduce((s: number, r: any) => s + (r.medianBuyPrice / r.previousBuyPrice - 1), 0) /
          withBoth.length) *
          1000,
      ) / 10
    : null;

  return {
    source: "madlan",
    cityHebrew: d.cityHebrew ?? null,
    pricePerSqm: d.pricePerSqm ?? null,
    yearlyDeals: d.yearlyDeals ?? null,
    bulletinsForSale: d.bulletinsForSale ?? null,
    bulletinsForRent: d.bulletinsForRent ?? null,
    socioeconomicIndex: d.demographics?.socioeconomicIndex ?? d.demographicIndex ?? null,
    pricesByRooms: byRooms.map((r: any) => ({
      rooms: String(r.rooms ?? ""),
      medianBuyPrice: r.medianBuyPrice ?? null,
      previousBuyPrice: r.previousBuyPrice ?? null,
    })),
    yearlyChangePct,
  };
}

/**
 * פייסבוק Marketplace — אין API רשמי, ולכן דרך Apify בלבד.
 * הערה: התוצאות עשויות לכלול פרטים אישיים של מוכרים; אנחנו שומרים רק
 * מחיר/שטח/כותרת לצורך החציון, ולא שם או קשר.
 */
export async function fetchFacebook(
  city: string,
  street: string,
  maxItems = 140,
  cacheOnly = false,
  forceFresh = false,
): Promise<SourceResult> {
  // חיפוש חופשי (search/?query=) מתעלם מהמיקום ומחזיר מודעות אמריקאיות
  // בדולרים. כתובת מיקום ישראלית מחזירה מודעות בשקלים — אך הן ארציות,
  // כי רוב מפרסמי הנדל"ן בפייסבוק מכסים את כל הארץ. הסינון לעיר נעשה כאן.
  const rows = await runActor(
    ACTORS.facebook,
    {
      startUrls: [{ url: "https://www.facebook.com/marketplace/telaviv/propertyforsale" }],
      resultsLimit: maxItems,
    },
    240000,
    cacheOnly,
    forceFresh,
  );
  // חיפוש חופשי ב-Marketplace מחזיר גם רהיטים ורכבים, שמושכים את החציון
  // מטה עד לחוסר משמעות. שומרים רק פריטים שגם נראים כמו דירה בכותרת וגם
  // מתומחרים בטווח דירות סביר.
  const HOME_WORDS = /דירה|דירת|פנטהאוז|פנטהאוס|קוטג|וילה|בית פרטי|יחידת דיור|נכס|חדרים|חד['׳]/;
  const MIN_HOME_PRICE = 500_000; // מתחת לזה: מבנים ניידים, מגרשים חקלאיים ותקלות תמחור
  const MAX_HOME_PRICE = 40_000_000;

  const titleOf = (r: any) => String(r.marketplace_listing_title ?? r.title ?? r.custom_title ?? r.name ?? "");
  const toPrice = (r: any) => {
    const lp = r.listing_price;
    const raw = (lp && typeof lp === "object" ? lp.formatted_amount ?? lp.amount : lp) ?? r.price;
    const n = parseInt(String(raw ?? "").replace(/[^\d]/g, ""), 10);
    if (Number.isNaN(n) || n < MIN_HOME_PRICE || n > MAX_HOME_PRICE) return null;
    return HOME_WORDS.test(titleOf(r)) ? n : null;
  };

  /**
   * הפיד ארצי, ולכן חייבים לסנן לעיר — אחרת החציון מערבב ערים ואיננו אומר כלום.
   * ההשוואה סלחנית: פייסבוק כתובה בשפה חופשית ("ת״א", "תל אביב יפו", "רמת-גן"),
   * והשוואה מדויקת פספסה מודעות אמיתיות והחזירה רשימה ריקה.
   */
  const cityName = (city || "").trim();
  const cityAliases = new Set<string>([cityName]);
  const noHyphen = cityName.replace(/[-־]/g, " ");
  cityAliases.add(noHyphen);
  if (/^תל אביב/.test(noHyphen)) ["תל אביב", "תל-אביב", "ת\"א", "תא"].forEach((a) => cityAliases.add(a));
  // "רמת גן" צריך להימצא גם ב"רמת-גן"; משווים מול טקסט מנורמל.
  const normalize = (t: string) => t.replace(/[-־]/g, " ").replace(/\s+/g, " ");

  const matchesCity = (r: any) => {
    if (!cityName) return true;
    const t = normalize(titleOf(r));
    for (const alias of cityAliases) if (alias && t.includes(normalize(alias))) return true;
    // המיקום שפייסבוק מדווח עליו, כשקיים, אמין יותר מהכותרת.
    const loc = r.location?.reverse_geocode?.city || r.location?.text || "";
    return !!loc && normalize(String(loc)).includes(normalize(cityName));
  };

  const inCity = rows.filter((r) => toPrice(r) != null && matchesCity(r));
  return summarize(inCity, "facebook", street, titleOf, toPrice, () => null);
}

// ---- עסקאות סגורות (רשות המסים / GovMap) דרך אקטור swerve/nadlan-deals ----

/**
 * רשימת הערים שהאקטור מכיר בתפריט (enum). ערים אלו עוברות בשדה cities
 * — המסלול שנבדק ומדויק ביותר. כל יישוב אחר מועבר כטקסט חופשי ב-customCities.
 */
const NADLAN_ENUM_CITIES = [
  "ירושלים", "תל אביב -יפו", "חיפה", "ראשון לציון", "פתח תקווה", "אשדוד",
  "באר שבע", "נתניה", "חולון", "בני ברק", "רמת גן", "בת ים", "רחובות",
  "אשקלון", "בית שמש", "כפר סבא", "הרצלייה", "מודיעין-מכבים-רעות", "חדרה",
  "נצרת", "לוד", "רעננה", "רמלה", "מודיעין עילית", "רהט", "גבעתיים",
  "קריית אתא", "נהרייה", "הוד השרון", "אום אל-פחם", "קריית גת", "אילת",
  "עכו", "ביתר עילית", "נס ציונה", "כרמיאל", "רמת השרון", "עפולה", "אלעד",
  "טבריה", "ראש העין", "נצרת עילית", "טייבה", "קריית מוצקין", "שפרעם",
  "קריית ים", "קריית ביאליק", "מעלה אדומים", "יבנה", "פרדס חנה-כרכור",
  "קריית אונו", "אור יהודה", "דימונה", "צפת", "טמרה", "נתיבות",
  "יהוד-מונוסון", "סח'נין", "באקה אל-גרביה", "גדרה", "אופקים", "מגדל העמק",
  "מבשרת ציון", "ערד", "גבעת שמואל", "טירה", "ערערה", "נשר", "קריית שמונה",
  "עראבה", "שדרות", "זכרון יעקב", "קריית מלאכי", "גן יבנה", "מעלות-תרשיחא",
  "מגאר", "כפר קאסם", "יקנעם עילית", "קלנסווה", "כפר יונה", "כפר כנא",
] as const;

/** מנרמל שם עיר להשוואה: מסיר רווחים סביב מקפים, מאחד רווחים, חותך. */
function normCityKey(s: string): string {
  return String(s || "")
    .replace(/["'`׳״]/g, "")
    .replace(/\s*[-־]\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** מחזיר את השם הקנוני מהתפריט אם העיר מוכרת, אחרת null (→ טקסט חופשי). */
function canonicalCity(city: string): string | null {
  const key = normCityKey(city);
  if (!key) return null;
  for (const c of NADLAN_ENUM_CITIES) {
    if (normCityKey(c) === key) return c;
  }
  // "תל אביב" / "תל אביב יפו" → "תל אביב -יפו"; התאמה גמישה לקידומת.
  for (const c of NADLAN_ENUM_CITIES) {
    const ck = normCityKey(c);
    if (ck.startsWith(key) || key.startsWith(ck.split("-")[0])) {
      if (ck.replace(/-.*/, "") === key.replace(/-.*/, "")) return c;
    }
  }
  return null;
}

/**
 * ממפה חלון חודשים לטווח שהאקטור תומך בו (enum). האקטור שולף את הטווח
 * הכולל, והסינון המדויק לחלון המבוקש נעשה אצלנו — כך אותה עיר באותו דלי
 * זמן נשמרת פעם אחת במטמון ומשרתת כל גרסאות הסינון בחינם.
 */
function monthsToNadlanRange(months: number): "3" | "6" | "12" | "60" | "all" {
  if (!months || months <= 0) return "all";
  if (months <= 3) return "3";
  if (months <= 6) return "6";
  if (months <= 12) return "12";
  if (months <= 60) return "60";
  return "all";
}

/** WGS84 (lat/lng) → Web Mercator (EPSG:3857), כפי ש-govmap החזיר במקור. */
function latLngToMercator(lat: unknown, lng: unknown): [number, number] | undefined {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || (la === 0 && ln === 0)) return undefined;
  const x = (ln * 20037508.34) / 180;
  let y = Math.log(Math.tan(((90 + la) * Math.PI) / 360)) / (Math.PI / 180);
  y = (y * 20037508.34) / 180;
  return [x, y];
}

/**
 * מחלץ קואורדינטה מהשורה הגולמית — שמות השדות משתנים בין גרסאות האקטור,
 * ולכן בודקים כמה מועמדים: lat/lng, נגזרות שלהם, קינון, מערך ו-WKT POINT.
 */
function extractCoord(r: any): [number, number] | undefined {
  let la = r?.lat ?? r?.latitude ?? r?.Lat ?? r?.y ?? null;
  let ln = r?.lng ?? r?.lon ?? r?.long ?? r?.longitude ?? r?.Lng ?? r?.x ?? null;
  if ((la == null || ln == null) && r?.location && typeof r.location === "object") {
    la = r.location.lat ?? r.location.latitude ?? la;
    ln = r.location.lng ?? r.location.lon ?? r.location.longitude ?? ln;
  }
  if ((la == null || ln == null) && Array.isArray(r?.coordinates) && r.coordinates.length >= 2) {
    ln = r.coordinates[0];
    la = r.coordinates[1];
  }
  if (la != null && ln != null) {
    const laN = Number(la);
    // קואורדינטות ישראל: lat ~29–34, lng ~34–36. אם הערכים גדולים — כבר מרקטור.
    if (Number.isFinite(laN) && Math.abs(laN) <= 90) return latLngToMercator(la, ln);
    const lnN = Number(ln);
    if (Number.isFinite(laN) && Number.isFinite(lnN)) return [lnN, laN];
  }
  const wkt = r?.shape || r?.geometry || r?.wkt;
  if (typeof wkt === "string" && wkt.startsWith("POINT(")) {
    const n = wkt.slice(6, -1).trim().split(/\s+/).map(Number);
    if (n.length === 2 && n.every(Number.isFinite)) {
      // POINT של govmap הוא מרקטור (ערכים גדולים); של lon/lat — קטנים.
      return Math.abs(n[1]) <= 90 ? latLngToMercator(n[1], n[0]) : [n[0], n[1]];
    }
  }
  return undefined;
}

/** מפצל "לוי אשכול 86" ל-{ street, house }. */
function splitAddress(addr: unknown): { street: string; house: string } {
  const s = String(addr ?? "").trim();
  const m = s.match(/^(.*?)[\s,]+(\d+[א-ת]?)\s*$/);
  if (m) return { street: m[1].trim(), house: m[2] };
  return { street: s, house: "" };
}

/** עסקה סגורה בפורמט שהלקוח (govmapClient.Deal) מצפה לו. */
export interface NadlanDeal {
  objectid: number;
  price: number;
  date: string;
  sqm: number | null;
  pricePerSqm: number | null;
  rooms: number | null;
  floor: number | null;
  city: string;
  neighborhood: string;
  street: string;
  houseNumber: string;
  propertyType: string;
  source: "same_building" | "street" | "neighborhood";
  distanceMeters: number;
  saleClass?: "new" | "second";
  coord?: [number, number];
  gush?: string;
  helka?: string;
  tatHelka?: string;
}

function mapNadlanRow(r: any, i: number): NadlanDeal | null {
  const price = Number(r?.dealAmount) || 0;
  if (!price) return null;
  const area = r?.area != null && Number(r.area) > 0 ? Number(r.area) : null;
  const ppsmRaw = r?.pricePerSqm != null ? Number(r.pricePerSqm) : null;
  const pricePerSqm = ppsmRaw && ppsmRaw > 0 ? Math.round(ppsmRaw) : area ? Math.round(price / area) : null;
  const floorNum = r?.floor != null && String(r.floor).match(/-?\d+/)
    ? parseInt(String(r.floor).match(/-?\d+/)![0], 10)
    : null;
  const addr = splitAddress(r?.address);
  const firstHand = r?.isFirstHand;
  const saleClass = firstHand === true ? "new" : firstHand === false ? "second" : undefined;
  return {
    objectid: Number(r?.assetId) || i + 1,
    price,
    date: String(r?.dealDate ?? "").slice(0, 10),
    sqm: area,
    pricePerSqm,
    rooms: r?.rooms != null && !Number.isNaN(Number(r.rooms)) ? Number(r.rooms) : null,
    floor: floorNum,
    city: String(r?.cityName ?? ""),
    neighborhood: String(r?.neighborhoodName ?? ""),
    street: addr.street || String(r?.address ?? ""),
    houseNumber: addr.house,
    propertyType: String(r?.propertyType ?? ""),
    source: "neighborhood",
    distanceMeters: 0,
    saleClass,
    coord: extractCoord(r),
    gush: r?.gush != null ? String(r.gush) : undefined,
    helka: r?.helka != null ? String(r.helka) : undefined,
    tatHelka: r?.tatHelka != null ? String(r.tatHelka) : undefined,
  };
}

/**
 * שואב עסקאות סגורות ברמת עיר. הקלט מכוון לשיעור פגיעות מטמון מרבי:
 * עיר + דלי-זמן בלבד, בלי רחוב/חדרים/טווח מדויק — הסינון העדין נעשה בלקוח.
 * כך חיפוש חוזר באותה עיר (גם ברחוב/חדרים אחרים) מוגש חינם מהמטמון.
 */
export async function fetchNadlanDealsRaw(
  city: string,
  monthsBack = 24,
  maxItems = 120,
  cacheOnly = false,
  forceFresh = false,
  neighborhood = "",
): Promise<any[]> {
  const canonical = canonicalCity(city);
  const input: Record<string, unknown> = {
    dealDateRange: monthsToNadlanRange(monthsBack),
    maxItems,
  };
  if (canonical) input.cities = [canonical];
  else input.customCities = [city.trim()];
  // מיקוד לאזור המבוקש: האקטור מגאוקד את השכונה/רחוב ואוסף עסקאות סביבה.
  // בלי זה שאיבת "עיר" מחזירה שכונה אקראית אחת (מפתח לתיקון חיפוש לפי מקום).
  if (neighborhood && neighborhood.trim()) input.neighborhoods = [neighborhood.trim()];

  return runActor(ACTORS.nadlan, input, 300000, cacheOnly, forceFresh);
}

export async function fetchNadlanDeals(
  city: string,
  monthsBack = 24,
  maxItems = 120,
  cacheOnly = false,
  forceFresh = false,
  neighborhood = "",
): Promise<NadlanDeal[]> {
  const rows = await fetchNadlanDealsRaw(city, monthsBack, maxItems, cacheOnly, forceFresh, neighborhood);
  return rows
    .map(mapNadlanRow)
    .filter((d): d is NadlanDeal => d !== null);
}
