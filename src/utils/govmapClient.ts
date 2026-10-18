/**
 * לקוח נתוני נדל"ן אמיתי — GovMap (govmap.gov.il) / רשות המסים.
 *
 * מושך עסקאות נדל"ן אמיתיות לפי כתובת (עיר + רחוב) ממאגר הנתונים הממשלתי,
 * מסנן לפי רדיוס/תאריך, ומחשב סטטיסטיקה (ממוצע, חציון, מחיר למ"ר).
 *
 * החוזה מבוסס על ה-API הציבורי של GovMap. שים לב: ה-API מוגבל בקצב
 * (rate-limited) ולא רשמי — ייתכנו שינויים בצד השרת של govmap.
 *
 * הזרימה:
 *   1. autocompleteAddress  → ממיר "רחוב עיר" לקואורדינטות ITM.
 *   2. getDealsByRadius     → מחזיר polygon_id של רחובות/שכונות סמוכים.
 *   3. getStreetDeals / getNeighborhoodDeals → עסקאות אמיתיות לכל polygon.
 *   4. findRecentDealsForAddress → מאחד, מסנן, ממיין ומחזיר עסקאות.
 */

const BASE_URL = "https://www.govmap.gov.il/api";
const USER_AGENT = "Nadlan360/1.0 (+market-survey)";

// ---- טיפוסים ----

export interface RawDeal {
  objectid: number;
  dealAmount: number; // מחיר בש"ח
  dealDate: string; // תאריך עסקה
  assetArea?: number; // שטח במ"ר
  settlementNameHeb?: string; // עיר
  propertyTypeDescription?: string; // סוג נכס (דירה, בית...)
  neighborhood?: string;
  streetName?: string;
  streetNameHeb?: string;
  houseNumber?: string;
  houseNum?: string;
  floor?: string;
  floorNo?: string; // תיאור קומה בעברית, למשל "קומה 3"
  floorNumber?: number;
  assetRoomNum?: number; // מספר חדרים
  dealNatureDescription?: string;
  shape?: string;
}

export interface Deal {
  objectid: number;
  price: number;
  date: string; // YYYY-MM-DD
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
  /** סיווג העסקה: "new" = חדש מקבלן (dealType 1) · "second" = יד שנייה (dealType 2). */
  saleClass?: "new" | "second";
  /** קואורדינטת מרכז העסקה (Web Mercator / ITM) — לצורך מיקום על המפה. */
  coord?: [number, number];
  /** זיהוי קדסטרלי רשמי (גוש / חלקה / תת-חלקה) מרשות המסים. */
  gush?: string;
  helka?: string;
  tatHelka?: string;
}

interface PolygonMeta {
  polygon_id: string;
  distance: number;
  raw: any;
}

export interface DealStatistics {
  count: number;
  meanPrice: number;
  medianPrice: number;
  minPrice: number;
  maxPrice: number;
  meanPricePerSqm: number | null;
  medianPricePerSqm: number | null;
  byRooms: Record<string, { count: number; medianPrice: number; medianPricePerSqm: number | null }>;
  dateRange: { from: string; to: string } | null;
}

// ---- עזרי רשת ----

async function postJson(url: string, body: any, timeoutMs = 30000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url: string, timeoutMs = 30000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ריטריי עם השהיה מעריכית + הגבלת קצב עדינה
async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const wait = Math.min(1000 * 2 ** attempt, 8000);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

// ---- ITM helpers ----

// הקואורדינטות מ-GovMap הן Web Mercator (EPSG:3857). בקו הרוחב של ישראל
// (~31.8°) מטר מרקטור מנופח פי ~1/cos(31.8°). מכפלה ב-cos מחזירה מטרים אמיתיים.
const MERCATOR_TO_METERS = Math.cos((31.8 * Math.PI) / 180); // ≈ 0.85

/** מרחק אמיתי במטרים בין שתי נקודות Web Mercator. */
function distanceMeters(a: [number, number], b: [number, number]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy) * MERCATOR_TO_METERS;
}

/** מפענח "POINT(lon lat)" לקואורדינטות ITM. */
function parsePoint(shape?: string): [number, number] | null {
  if (!shape || !shape.startsWith("POINT(")) return null;
  const inner = shape.slice(6, -1).trim().split(/\s+/);
  if (inner.length !== 2) return null;
  const x = parseFloat(inner[0]);
  const y = parseFloat(inner[1]);
  if (Number.isNaN(x) || Number.isNaN(y)) return null;
  return [x, y];
}

/** מרכז משוער של MULTIPOLYGON/POLYGON — ממוצע הקואורדינטות הראשונות. */
function shapeCentroid(shape?: string): [number, number] | null {
  if (!shape) return null;
  const nums = shape.match(/-?\d+\.?\d*/g);
  if (!nums || nums.length < 2) return null;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    sx += parseFloat(nums[i]);
    sy += parseFloat(nums[i + 1]);
    n++;
  }
  if (n === 0) return null;
  return [sx / n, sy / n];
}

// ---- API calls ----

export interface AutocompleteMatch {
  text: string;
  type: string;
  score: number;
  point: [number, number] | null;
  /** שם הרחוב הנקי מתוך ה-id (למשל "דיזנגוף"), כשזו תוצאת רחוב/כתובת. */
  streetName?: string;
  /** שם העיר הנקי מתוך ה-id (למשל "תל אביב"). */
  cityName?: string;
}

/**
 * מפענח את ה-id של govmap לשמות נקיים. דוגמאות:
 *   "street|STREET_MID_POINT|36627|דיזנגוף|תל אביב"  → street=דיזנגוף, city=תל אביב
 *   "address|...|דיזנגוף 100|תל אביב"               → street=דיזנגוף 100, city=תל אביב
 *   "settlement|...|תל אביב-יפו"                     → city=תל אביב-יפו
 */
function parseAutoId(id: unknown, type: string): { streetName?: string; cityName?: string } {
  const parts = String(id || "").split("|");
  if (!parts.length) return {};
  if (type === "street" || type === "address") {
    // שני השדות האחרונים: רחוב ואז עיר.
    const cityName = parts[parts.length - 1] || undefined;
    const streetName = parts[parts.length - 2] || undefined;
    return { streetName, cityName };
  }
  // יישוב/עיר: השדה האחרון הוא שם העיר.
  return { cityName: parts[parts.length - 1] || undefined };
}

/** ממיר טקסט כתובת חופשי לרשימת התאמות עם קואורדינטות ITM. */
export async function autocompleteAddress(searchText: string): Promise<AutocompleteMatch[]> {
  const url = `${BASE_URL}/search-service/autocomplete`;
  const payload = { searchText, language: "he", isAccurate: false, maxResults: 10 };
  const data = await withRetry(() => postJson(url, payload));
  const results = Array.isArray(data?.results) ? data.results : [];
  return results.map((r: any) => {
    const type = r.type || "";
    const ids = parseAutoId(r.id, type);
    return {
      text: r.text || "",
      type,
      score: r.score || 0,
      point: parsePoint(r.shape),
      streetName: ids.streetName,
      cityName: ids.cityName,
    };
  });
}

/** מחזיר metadata של פוליגונים (רחובות/שכונות) ברדיוס נתון סביב נקודה. */
export async function getDealsByRadius(
  point: [number, number],
  radius = 50,
): Promise<any[]> {
  const url = `${BASE_URL}/real-estate/deals/${point[0]},${point[1]}/${radius}`;
  const data = await withRetry(() => getJson(url));
  return Array.isArray(data) ? data : [];
}

async function getPolygonDeals(
  kind: "street-deals" | "neighborhood-deals",
  polygonId: string,
  opts: { limit?: number; dealType?: number; startDate?: string; endDate?: string },
): Promise<RawDeal[]> {
  const params = new URLSearchParams();
  params.set("limit", String(opts.limit ?? 100));
  params.set("dealType", String(opts.dealType ?? 2));
  if (opts.startDate) params.set("startDate", opts.startDate);
  if (opts.endDate) params.set("endDate", opts.endDate);
  const url = `${BASE_URL}/real-estate/${kind}/${polygonId}?${params.toString()}`;
  const data = await withRetry(() => getJson(url));
  if (Array.isArray(data)) return data as RawDeal[];
  if (data && Array.isArray(data.data)) return data.data as RawDeal[];
  return [];
}

// ---- נירמול ----

/** מחלץ מספר קומה מתיאור עברי כמו "קומה 3" או "קומה -1, קומה 0". */
function parseFloor(raw: RawDeal): number | null {
  if (raw.floorNumber != null && !Number.isNaN(Number(raw.floorNumber))) {
    return Number(raw.floorNumber);
  }
  const txt = raw.floorNo || raw.floor;
  if (!txt) return null;
  const m = String(txt).match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

function normalizeDeal(
  raw: RawDeal,
  source: Deal["source"],
  distance: number,
  saleClass?: Deal["saleClass"],
  coord?: [number, number],
): Deal | null {
  const price = Number(raw.dealAmount) || 0;
  if (!price) return null;
  const sqm = raw.assetArea ? Number(raw.assetArea) : null;
  const date = (raw.dealDate || "").split("T")[0];
  return {
    objectid: raw.objectid,
    price,
    date,
    sqm,
    pricePerSqm: sqm && sqm > 0 ? Math.round(price / sqm) : null,
    rooms: raw.assetRoomNum != null ? Number(raw.assetRoomNum) : null,
    floor: parseFloor(raw),
    city: raw.settlementNameHeb || "",
    neighborhood: raw.neighborhood || "",
    street: raw.streetNameHeb || raw.streetName || "",
    houseNumber: String(raw.houseNum || raw.houseNumber || ""),
    propertyType: raw.propertyTypeDescription || raw.dealNatureDescription || "",
    source,
    distanceMeters: Math.round(distance),
    saleClass,
    coord,
  };
}

// ---- גוש וחלקה ----

/**
 * מזהה קלט של גוש/חלקה ומחזיר אותו בפורמט ש-GovMap מבין.
 * נתמך: "גוש 6638 חלקה 45", "6638/45", "6638 45".
 * מחזיר null אם זו לא נראית בקשת גוש/חלקה — ואז מטופל ככתובת רגילה.
 */
export function parseGushHelka(input: string): { gush: number; helka: number; query: string } | null {
  const t = (input || "").trim();
  if (!t) return null;

  const labeled = t.match(/גוש\s*(\d{1,6})\D+(?:חלקה\s*)?(\d{1,5})/);
  const slashed = t.match(/^(\d{3,6})\s*[\/\-\s]\s*(\d{1,5})$/);
  const m = labeled || slashed;
  if (!m) return null;

  const gush = parseInt(m[1], 10);
  const helka = parseInt(m[2], 10);
  if (!gush || !helka) return null;
  return { gush, helka, query: `גוש ${gush} חלקה ${helka}` };
}

/**
 * מאתר עסקאות רשות המסים לפי גוש/חלקה. האקטור שואב ברמת עיר ומחזיר גוש/חלקה
 * בכל עסקה, ולכן נדרשת גם עיר — הסינון לגוש/חלקה נעשה על עסקאות אותה עיר.
 */
export async function findDealsByGushHelka(
  gushHelka: { gush: number; helka: number; query: string },
  options: FindDealsOptions = {},
): Promise<Deal[]> {
  return findRecentDealsForAddress(gushHelka.query, {
    ...options,
    gush: gushHelka.gush,
    helka: gushHelka.helka,
  });
}

// ---- הזרימה המרכזית ----

export interface FindDealsOptions {
  yearsBack?: number;
  radius?: number;
  maxDeals?: number;
  /** 1=חדש מקבלן · 2=יד שנייה · "both"=שניהם (כל עסקה מתויגת ב-saleClass). */
  dealType?: 1 | 2 | "both";
  maxPolygons?: number;
  /**
   * טווח תאריכים מותאם (YYYY-MM או YYYY-MM-DD). כשמסופק — גובר על yearsBack.
   * מאפשר למשתמש לבחור חלון מדויק במקום קפיצות של חצי שנה.
   */
  startDate?: string;
  endDate?: string;
  /**
   * העיר לשאיבה דרך אקטור nadlan-deals. השאיבה היא ברמת עיר, ולכן העיר
   * נדרשת. אם לא סופקה — נגזרת מתוך מחרוזת הכתובת (המילה/ים האחרונות).
   */
  city?: string;
  /** שם הרחוב (ואולי מספר בית) לסינון מדויק אחרי השאיבה ברמת העיר. */
  street?: string;
  /** סינון קדסטרלי לפי גוש/חלקה אחרי השאיבה (האקטור שולף ברמת עיר). */
  gush?: number;
  helka?: number;
  /** "חיפוש טרי" — מדלג על המטמון ושואב מהמקור, לבדיקת עדכונים. */
  forceFresh?: boolean;
}

/** מנרמל שם רחוב להשוואת כפילויות: מסיר "רחוב"/"רח׳", פסיקים ורווחים כפולים. */
function normStreetKey(s: string): string {
  return String(s || "")
    .replace(/רח['׳]?\s*/g, "")
    .replace(/רחוב\s*/g, "")
    .replace(/[",]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * מאחד עסקאות כפולות מרשות המסים. אותה דירה יכולה לחזור מפוליגונים שכנים,
 * ובשליפת "both" אף בשני סיווגים — מה שנראה למשתמש ככפילות.
 * מפתח הזיהוי: רחוב + מספר + חדרים + מ"ר + מחיר. מחיר זהה בדיוק לאותה דירה
 * הוא כמעט בוודאות אותה עסקה (מכירה חוזרת אמיתית תהיה במחיר אחר), ולכן
 * אפשר לאחד בלי לחשוש שנמזג שתי עסקאות לגיטימיות. נשמר המופע הראשון
 * (הקרוב/העדכני ביותר לפי המיון הקיים).
 */
function dedupeDeals(deals: Deal[]): Deal[] {
  const seen = new Set<string>();
  const out: Deal[] = [];
  for (const d of deals) {
    const street = normStreetKey(d.street);
    // בלי מחיר וגם בלי שטח אין די מידע לזהות כפילות — משאירים כמות שהוא.
    if (!d.price || (!street && d.sqm == null)) {
      out.push(d);
      continue;
    }
    const key = `${street}|${d.houseNumber}|${d.rooms ?? ""}|${d.sqm ?? ""}|${d.price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

/** גוזר שם עיר מתוך מחרוזת כתובת כשלא סופקה עיר במפורש (המילים אחרי המספר). */
function deriveCityFromAddress(address: string): string {
  const t = (address || "").trim();
  if (!t) return "";
  const afterNum = t.match(/\d+\s+([^\d]+)$/);
  if (afterNum) return afterNum[1].trim();
  const words = t.split(/\s+/);
  return words.length > 1 ? words[words.length - 1] : t;
}

/** מפריד שם רחוב ומספר בית מקלט הרחוב ("הרצל 40" → {name:"הרצל", house:"40"}). */
function parseStreetInput(street: string): { name: string; house: string } {
  const s = (street || "").trim();
  const m = s.match(/^(.*?)[\s,]+(\d+[א-ת]?)\s*$/);
  if (m) return { name: normStreetKey(m[1]), house: m[2] };
  return { name: normStreetKey(s), house: "" };
}

/** מתרגם חלון חודשים לדלי שהשרת/האקטור תומך בו — מפתח מטמון יציב לכל עיר. */
function monthsBucket(monthsBack: number): string {
  if (monthsBack <= 3) return "3";
  if (monthsBack <= 6) return "6";
  if (monthsBack <= 12) return "12";
  if (monthsBack <= 60) return "60";
  return "all";
}

/**
 * שואב עסקאות סגורות ברמת עיר דרך השרת (אקטור nadlan-deals), עם מטמון
 * מקומי + גיבוי seed. השאיבה ברמת עיר בכוונה — כך חיפוש חוזר באותה עיר
 * (גם ברחוב/חדרים/טווח אחרים) מוגש חינם מהמטמון. הסינון העדין נעשה בלקוח.
 */
async function fetchCityDeals(city: string, monthsBack: number, forceFresh = false, area = ""): Promise<Deal[]> {
  const areaKey = area.trim();
  // המפתח כולל את האזור: מיקוד לשכונה/רחוב מחזיר עסקאות אחרות מ"כל העיר",
  // ולכן נשמר בנפרד — כך חיפוש חוזר לאותו אזור מוגש חינם מהמטמון.
  const cacheKey = `deals_${city.trim()}_${areaKey}_${monthsBucket(monthsBack)}`;
  // חיפוש טרי: מדלגים על המטמון המקומי ועל ה-seed, ושואבים מהשרת מחדש.
  if (!forceFresh) {
    const cached = readLocalCache<Deal[]>(cacheKey);
    if (cached) return cached;
  }

  try {
    const url = `${API_BASE}/api/deals?city=${encodeURIComponent(city)}&months=${monthsBack}&maxItems=120${
      areaKey ? `&area=${encodeURIComponent(areaKey)}` : ""
    }${forceFresh ? "&fresh=1" : ""}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(300000) });
    if (r.ok) {
      const d = await r.json();
      if (d && !d.error && Array.isArray(d.deals)) {
        if (d.deals.length) writeLocalCache(cacheKey, d.deals);
        return d.deals as Deal[];
      }
    }
  } catch {
    // ממשיכים ל-seed
  }
  // גיבוי seed מ-Git: עסקאות שנשמרו פעם אחת, מוגשות לכל מכשיר בחינם.
  // בחיפוש טרי לא נופלים ל-seed (רוצים דווקא נתון עדכני).
  if (forceFresh) return [];
  return (await readSeedCache<Deal[]>(LOCAL_CACHE_PREFIX + cacheKey)) || [];
}

/**
 * מוצא עסקאות נדל"ן אמיתיות (מחירי סגירה, רשות המסים) עבור כתובת.
 *
 * מאז שגוֹvmap הוסיפו reCAPTCHA ל-API, השאיבה הישירה מהדפדפן נחסמה.
 * כעת העסקאות נשאבות ברמת עיר דרך השרת (אקטור nadlan-deals שמריץ דפדפן
 * אמיתי אצל Apify), והסינון לרחוב/חדרים/גוש-חלקה/טווח-תאריכים נעשה כאן.
 */
export async function findRecentDealsForAddress(
  address: string,
  options: FindDealsOptions = {},
): Promise<Deal[]> {
  const yearsBack = options.yearsBack ?? 2;
  const maxDeals = options.maxDeals ?? 100;
  const dealType = options.dealType ?? 2;

  // חיפוש גוש/חלקה אינו מכיל עיר בטקסט, ולכן אסור לנחש עיר מתוכו —
  // נדרשת עיר מפורשת. בכתובת רגילה אפשר לגזור עיר מהטקסט.
  const city = (options.city || (options.gush ? "" : deriveCityFromAddress(address))).trim();
  if (!city) {
    throw new Error(
      options.gush
        ? "חיפוש לפי גוש/חלקה דורש גם עיר — הזינו את שם העיר שבה נמצא הגוש."
        : `לא זוהתה עיר עבור: ${address}. הזינו את שם העיר.`,
    );
  }

  // חלון התאריכים המדויק לסינון. טווח מותאם גובר על yearsBack.
  const now = new Date();
  const toStr = (options.endDate || now.toISOString()).slice(0, 10);
  let fromStr: string;
  if (options.startDate) {
    fromStr = options.startDate.length === 7 ? `${options.startDate}-01` : options.startDate.slice(0, 10);
  } else {
    const from = new Date(now);
    from.setMonth(now.getMonth() - Math.round(yearsBack * 12));
    fromStr = from.toISOString().slice(0, 10);
  }
  const monthsBack = Math.max(
    1,
    Math.round((now.getTime() - new Date(fromStr).getTime()) / (30 * 24 * 3600 * 1000)),
  );

  // האזור למיקוד השאיבה: שם הרחוב/השכונה ללא מספר בית (בעברית מקורית).
  // בלעדיו שאיבת "עיר" מחזירה שכונה אקראית אחת ולא את המקום המבוקש.
  const areaText = (options.street || "").replace(/[\s,]+\d+[א-ת]?\s*$/, "").trim();

  // שאיבה ממוקדת-אזור (מטמון + seed), ואז סינון מקומי מדויק.
  const all = await fetchCityDeals(city, monthsBack, options.forceFresh, areaText);
  if (!all.length) return [];

  // 1) חלון תאריכים (השוואת מחרוזות YYYY-MM-DD בטוחה).
  let deals = all.filter((d) => d.date && d.date >= fromStr && d.date <= toStr);

  // 2) סוג עסקה. isFirstHand לרוב חסר במקור, ולכן "לא ידוע" נחשב יד שנייה
  //    (ברירת המחדל) ונכלל; "חדש בלבד" מצמצם למה שסומן במפורש כחדש.
  if (dealType === 1) deals = deals.filter((d) => d.saleClass === "new");
  else if (dealType === 2) deals = deals.filter((d) => d.saleClass !== "new");

  // 3) סינון קדסטרלי גוש/חלקה.
  if (options.gush) {
    deals = deals.filter((d) => String(d.gush || "") === String(options.gush));
    if (options.helka) deals = deals.filter((d) => String(d.helka || "") === String(options.helka));
  }

  // 4) סינון/תיוג רחוב. פחות מ-3 התאמות אינו מדגם — נשארים ברמת עיר.
  const { name: streetName, house: streetHouse } = parseStreetInput(options.street || "");
  if (streetName && streetName.length >= 2) {
    const tagged = deals.map((d) => {
      const dStreet = normStreetKey(d.street);
      if (!dStreet) return d;
      const match = dStreet.includes(streetName) || streetName.includes(dStreet);
      if (!match) return d;
      const sameBuilding = !!streetHouse && String(d.houseNumber).trim() === streetHouse;
      return { ...d, source: (sameBuilding ? "same_building" : "street") as Deal["source"] };
    });
    const onStreet = tagged.filter((d) => d.source === "same_building" || d.source === "street");
    deals = onStreet.length >= 3 ? onStreet : tagged;
  }

  // מיון: בניין → רחוב → שכונה, ואז תאריך (חדש קודם).
  const priorityOf = (s: Deal["source"]) => (s === "same_building" ? 0 : s === "street" ? 1 : 2);
  deals.sort((a, b) => {
    const p = priorityOf(a.source) - priorityOf(b.source);
    if (p !== 0) return p;
    return (b.date || "").localeCompare(a.date || "");
  });

  // איחוד כפילויות (אותה דירה עשויה לחזור) וחיתוך לתקרה.
  return dedupeDeals(deals).slice(0, maxDeals);
}

// ---- סטטיסטיקה ----

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
}

// ---- מקורות מחיר-מבוקש (יד2 · יד1 · מדלן · פייסבוק דרך השרת) ----

/**
 * הכתובת של ה-API. ריק = אותו מקור של האתר (פיתוח מקומי / הגשה מהשרת).
 * באתר סטטי (GitHub Pages) יש להצביע על השרת המאוחסן דרך VITE_API_URL.
 */
const API_BASE = (import.meta as any).env?.VITE_API_URL || "";

/** מודעה בודדת ממקור מחיר-מבוקש, להצגה ברשימה לפי תאריך. */
export interface SourceListing {
  source: string;
  price: number;
  sqm: number | null;
  pricePerSqm: number | null;
  rooms: number | null;
  floor: number | null;
  street: string;
  neighbourhood: string;
  date: string;
  url: string;
  title: string;
  isAgent: boolean;
}

export interface BridgeResult {
  source: string;
  /** "street" = סונן לרחוב המבוקש · "city" = רמת עיר (לא נמצאו מספיק ברחוב). */
  scope?: "street" | "city";
  count: number;
  cityCount?: number;
  streetCount?: number;
  medianPrice: number;
  medianPricePerSqm: number | null;
  /** המודעות עצמן, ממוינות מהחדשה לישנה. */
  listings?: SourceListing[];
}

/**
 * מטמון בדפדפן — שכבה שנייה מעל המטמון שבשרת.
 *
 * למה צריך את שתיהן: המטמון בשרת משותף לכל המכשירים, אבל באירוח בשכבה
 * חינמית השרת נרדם אחרי רבע שעה והזיכרון שלו נמחק — כך שחיפוש חוזר למחרת
 * היה מחויב שוב. המטמון כאן שורד סגירת דפדפן וכיבוי מחשב, ולכן חיפוש חוזר
 * של אותה עיר לא עולה כלום גם אחרי שהשרת התאפס.
 */
const LOCAL_CACHE_PREFIX = "nadlan360_cache_";
// שבועיים — תואם למטמון שבשרת. שאיבה עולה קרדיט ומחירים זזים לאט, ולכן
// עדיף נתון שמור בחינם מאשר חיוב חוזר על אותה עיר. יש "חיפוש טרי" לעדכון מיידי.
const LOCAL_CACHE_TTL_MS = 336 * 60 * 60 * 1000; // שבועיים (336 שעות)

function readLocalCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || Date.now() - parsed.at > LOCAL_CACHE_TTL_MS) {
      localStorage.removeItem(LOCAL_CACHE_PREFIX + key);
      return null;
    }
    return parsed.data as T;
  } catch {
    return null;
  }
}

function writeLocalCache(key: string, data: unknown) {
  try {
    localStorage.setItem(LOCAL_CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    // מכסת האחסון מלאה: מפנים רשומות ישנות ומנסים פעם אחת נוספת.
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith(LOCAL_CACHE_PREFIX)) localStorage.removeItem(k);
      }
      localStorage.setItem(LOCAL_CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), data }));
    } catch {
      // עדיין לא נכנס — מוותרים בשקט; המטמון הוא אופטימיזציה, לא תנאי.
    }
  }
}

/** מוחק את המטמון המקומי, כדי לאלץ שאיבה טרייה. */
export function clearLocalCache(): number {
  let n = 0;
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(LOCAL_CACHE_PREFIX)) {
        localStorage.removeItem(k);
        n += 1;
      }
    }
  } catch {}
  return n;
}

// ---- Seed מ-Git: מטמון קבוע המשותף לכל המכשירים ----
/**
 * נתונים שיוצאו פעם אחת מדפדפן והוכנסו ל-public/seed-cache.json (נכנס ל-Git).
 * משמשים גיבוי כשאין מטמון מקומי והשרת אינו יכול לספק (נגמר הקרדיט או שהמטמון
 * בזיכרון נמחק) — כך כל מכשיר, וכל משתמש, רואה את אותם נתונים בלי קרדיט
 * ובלי תלות בשרת. המפתחות זהים למפתחות המטמון המקומי (LOCAL_CACHE_PREFIX + key).
 */
let seedPromise: Promise<Record<string, any>> | null = null;
function loadSeed(): Promise<Record<string, any>> {
  if (!seedPromise) {
    const base = (import.meta as any).env?.BASE_URL || "/";
    seedPromise = fetch(`${base}seed-cache.json`)
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return seedPromise;
}
async function readSeedCache<T>(fullKey: string): Promise<T | null> {
  try {
    const seed = await loadSeed();
    return (seed[fullKey] as T) ?? null;
  } catch {
    return null;
  }
}

/** קורא מקור בודד מה-seed בלבד (בלי פנייה לשרת) — לשימוש כשהשרת אינו זמין. */
export async function seedSource(
  source: string,
  city: string,
  street: string,
): Promise<BridgeResult | null> {
  const cacheKey = `src_${source}_${city.trim()}_${street.trim()}`;
  return readSeedCache<BridgeResult>(LOCAL_CACHE_PREFIX + cacheKey);
}

/** קורא אנליטיקת מדלן מה-seed בלבד. */
export async function seedMadlan(city: string): Promise<MadlanAnalytics | null> {
  return readSeedCache<MadlanAnalytics>(LOCAL_CACHE_PREFIX + `madlan_${city.trim()}`);
}


/**
 * בודק שהשרת זמין ושמוגדר בו טוקן Apify.
 *
 * הפסקת זמן ארוכה בכוונה: באירוח בשכבה חינמית השרת נרדם אחרי חוסר פעילות,
 * וההתעוררות אורכת חצי דקה. המתנה קצרה החזירה "השרת לא זמין" גם כשהכול תקין.
 */
export async function bridgeHealth(): Promise<boolean> {
  try {
    const r = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) return false;
    const d = await r.json();
    return !!d?.hasApifyToken;
  } catch {
    return false;
  }
}

/**
 * שואב מקור אחד דרך השרת. השאיבה עצמה רצה בשרתי Apify, ולכן אין צורך
 * בדפדפן פתוח, בהתחברות לחשבונות, או במחשב דלוק.
 */
export async function bridgeScrape(
  source: string,
  city: string,
  street: string,
  cacheOnly = false,
  forceFresh = false,
): Promise<BridgeResult | null> {
  const cacheKey = `src_${source}_${city.trim()}_${street.trim()}`;
  if (!forceFresh) {
    const cached = readLocalCache<BridgeResult>(cacheKey);
    if (cached) return cached;
  }

  try {
    const url = `${API_BASE}/api/sources/${encodeURIComponent(source)}?city=${encodeURIComponent(
      city,
    )}&street=${encodeURIComponent(street)}${cacheOnly ? "&cacheOnly=1" : ""}${forceFresh ? "&fresh=1" : ""}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(280000) });
    if (r.ok) {
      const d = await r.json();
      if (d && !d.error && d.count) {
        writeLocalCache(cacheKey, d);
        return d as BridgeResult;
      }
    }
  } catch {
    // ממשיכים ל-seed
  }
  // גיבוי seed מ-Git: נתונים שנשמרו פעם אחת, מוגשים לכל מכשיר בחינם.
  return await readSeedCache<BridgeResult>(LOCAL_CACHE_PREFIX + cacheKey);
}

// ---- התחברות מול השרת ----

export interface LoginResult {
  ok: boolean;
  error?: string;
  /** true = השרת לא זמין ויש להשתמש בבדיקה המקומית כגיבוי. */
  offline?: boolean;
  usingDefaultPassword?: boolean;
}

/** מאמת מול השרת. אם השרת לא זמין מסמן offline כדי שהאתר יישאר שמיש. */
export async function serverLogin(user: string, pass: string): Promise<LoginResult> {
  try {
    const r = await fetch(`${API_BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, pass }),
      // השרת עשוי להיות רדום — נותנים לו זמן להתעורר לפני שנכריז על כישלון.
      signal: AbortSignal.timeout(60000),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d?.ok) return { ok: true, usingDefaultPassword: d.usingDefaultPassword };
    return { ok: false, error: d?.error || "שם משתמש או סיסמה שגויים." };
  } catch {
    return { ok: false, offline: true };
  }
}

export interface ChangePasswordResult {
  ok: boolean;
  error?: string;
  note?: string;
  offline?: boolean;
}

export async function serverChangePassword(
  user: string,
  currentPass: string,
  newPass: string,
): Promise<ChangePasswordResult> {
  try {
    const r = await fetch(`${API_BASE}/api/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, currentPass, newPass }),
      signal: AbortSignal.timeout(60000),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d?.ok) return { ok: true, note: d.note };
    return { ok: false, error: d?.error || "שינוי הסיסמה נכשל." };
  } catch {
    return { ok: false, offline: true, error: "השרת אינו זמין — לא ניתן לשנות סיסמה כרגע." };
  }
}

// ---- מצב הקרדיט ב-Apify ----

export interface CreditStatus {
  configured: boolean;
  usedUsd?: number;
  capUsd?: number | null;
  exhausted?: boolean;
  unknown?: boolean;
  /** true = השרת עצמו אינו זמין (אתר סטטי ללא שרת). */
  offline?: boolean;
}

/**
 * בודק כמה קרדיט נשאר. משמש להסביר למשתמש למה מקורות חסרים,
 * במקום שהם פשוט ייעלמו מהמסך בלי הסבר.
 */
export async function fetchCreditStatus(): Promise<CreditStatus> {
  try {
    const r = await fetch(`${API_BASE}/api/credit`, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) return { configured: false, offline: true };
    return (await r.json()) as CreditStatus;
  } catch {
    return { configured: false, offline: true };
  }
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
  yearlyChangePct: number | null;
}

/** אנליטיקת מדלן ברמת עיר — מחיר למ"ר, מגמה שנתית, היצע ומדד חברתי. */
export async function fetchMadlanAnalytics(city: string, cacheOnly = false, forceFresh = false): Promise<MadlanAnalytics | null> {
  const cacheKey = `madlan_${city.trim()}`;
  if (!forceFresh) {
    const cached = readLocalCache<MadlanAnalytics>(cacheKey);
    if (cached) return cached;
  }

  try {
    const suffix = `${cacheOnly ? "&cacheOnly=1" : ""}${forceFresh ? "&fresh=1" : ""}`;
    const r = await fetch(`${API_BASE}/api/sources/madlan?city=${encodeURIComponent(city)}${suffix}`, {
      signal: AbortSignal.timeout(280000),
    });
    if (r.ok) {
      const d = await r.json();
      if (d && !d.error) {
        writeLocalCache(cacheKey, d);
        return d as MadlanAnalytics;
      }
    }
  } catch {
    // ממשיכים ל-seed
  }
  // גיבוי seed מ-Git.
  return await readSeedCache<MadlanAnalytics>(LOCAL_CACHE_PREFIX + cacheKey);
}

// ---- מדד חברתי-כלכלי (הלמ"ס דרך data.gov.il) ----

const SOCIO_RESOURCE = "b6dcbb4c-4102-43d2-a5a1-8e049457fe7a";

export interface SocioEconomic {
  name: string;
  cluster: number; // אשכול 1–10 (1=נמוך, 10=גבוה)
  label: string; // נמוך / בינוני / גבוה / גבוה מאוד
}

/** שולף את המדד החברתי-כלכלי (אשכול הלמ"ס 1–10) לעיר מנתוני data.gov.il. */
export async function getSocioEconomic(city: string): Promise<SocioEconomic | null> {
  const url = `https://data.gov.il/api/3/action/datastore_search?resource_id=${SOCIO_RESOURCE}&q=${encodeURIComponent(
    city.trim(),
  )}&limit=8`;
  try {
    const data = await withRetry(() => getJson(url), 1);
    const recs: any[] = data?.result?.records || [];
    if (!recs.length) return null;
    const target = city.trim();
    const exact =
      recs.find((r) => String(r["שם רשות"]).trim() === target) ||
      recs.find((r) => String(r["שם רשות"]).includes(target)) ||
      recs[0];
    const cluster = Number(exact["אשכול חברתי כלכלי"]);
    if (!cluster || Number.isNaN(cluster)) return null;
    const label = cluster <= 3 ? "נמוך" : cluster <= 6 ? "בינוני" : cluster <= 8 ? "גבוה" : "גבוה מאוד";
    return { name: String(exact["שם רשות"]).trim(), cluster, label };
  } catch {
    return null;
  }
}

// ---- ניתוח השקעה (מדד לחברת בנייה) ----

export interface TrendPoint {
  period: string; // שנה, למשל "2024"
  medianPricePerSqm: number;
  medianPrice: number;
  count: number;
}

export interface InvestmentAnalysis {
  trend: TrendPoint[]; // מגמה לפי שנה
  appreciationPerYear: number; // שיעור עליית ערך שנתי ממוצע (%)
  totalAppreciation: number; // עליית ערך כוללת בתקופה (%)
  dealsPerMonth: number; // נזילות — מספר עסקאות בחודש
  volatility: number; // תנודתיות בין שנים (%)
  verdict: "recommended" | "neutral" | "caution";
  verdictLabel: string;
  reason: string;
}

/** מנתח פוטנציאל השקעה: מגמת מחיר למ"ר לאורך זמן, נזילות ותנודתיות. */
export function analyzeInvestment(deals: Deal[]): InvestmentAnalysis | null {
  const withPpsm = deals.filter((d) => d.pricePerSqm && d.pricePerSqm > 0 && d.date);
  if (withPpsm.length < 3) return null;

  // קיבוץ לפי שנה
  const byYear = new Map<string, Deal[]>();
  for (const d of withPpsm) {
    const year = d.date.slice(0, 4);
    (byYear.get(year) ?? byYear.set(year, []).get(year)!).push(d);
  }
  const trend: TrendPoint[] = Array.from(byYear.entries())
    .map(([period, ds]) => ({
      period,
      medianPricePerSqm: median(ds.map((d) => d.pricePerSqm!).filter((n) => n > 0)),
      medianPrice: median(ds.map((d) => d.price).filter((n) => n > 0)),
      count: ds.length,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));

  if (trend.length < 2) {
    // אין מספיק שנים למגמה — מחזירים נזילות בלבד
    const months = monthSpan(withPpsm);
    return {
      trend,
      appreciationPerYear: 0,
      totalAppreciation: 0,
      dealsPerMonth: months > 0 ? +(withPpsm.length / months).toFixed(1) : withPpsm.length,
      volatility: 0,
      verdict: "neutral",
      verdictLabel: "נתונים חלקיים",
      reason: "אין מספיק שנים עם עסקאות כדי לזהות מגמת מחירים ברורה. מומלץ להרחיב את טווח החיפוש.",
    };
  }

  const first = trend[0].medianPricePerSqm;
  const last = trend[trend.length - 1].medianPricePerSqm;
  const yearsSpan = Math.max(1, parseInt(trend[trend.length - 1].period) - parseInt(trend[0].period));
  const totalAppreciation = first > 0 ? ((last - first) / first) * 100 : 0;
  const appreciationPerYear = totalAppreciation / yearsSpan;

  // תנודתיות: סטיית שינויי המחיר בין שנים עוקבות
  const changes: number[] = [];
  for (let i = 1; i < trend.length; i++) {
    const prev = trend[i - 1].medianPricePerSqm;
    if (prev > 0) changes.push(((trend[i].medianPricePerSqm - prev) / prev) * 100);
  }
  const volatility = changes.length ? stdDev(changes) : 0;

  const months = monthSpan(withPpsm);
  const dealsPerMonth = months > 0 ? +(withPpsm.length / months).toFixed(1) : withPpsm.length;

  // המלצה — היוריסטיקה שקופה: עלייה יציבה + נזילות סבירה = מומלץ
  let verdict: InvestmentAnalysis["verdict"];
  let verdictLabel: string;
  let reason: string;
  if (appreciationPerYear >= 4 && dealsPerMonth >= 0.5 && volatility < 25) {
    verdict = "recommended";
    verdictLabel = "מומלץ להשקעה";
    reason = `מחיר למ"ר עלה בכ-${appreciationPerYear.toFixed(1)}% בשנה בממוצע, עם שוק פעיל (${dealsPerMonth} עסקאות בחודש) ותנודתיות נמוכה. מגמה חיובית ויציבה.`;
  } else if (appreciationPerYear < 0 || dealsPerMonth < 0.2) {
    verdict = "caution";
    verdictLabel = "דורש זהירות";
    reason =
      appreciationPerYear < 0
        ? `מחיר למ"ר ירד בכ-${Math.abs(appreciationPerYear).toFixed(1)}% בשנה בממוצע — מגמה שלילית. יש לבחון היטב לפני רכישה.`
        : `שוק דליל מאוד (${dealsPerMonth} עסקאות בחודש) — קשה להעריך שווי ונזילות. סיכון גבוה יותר.`;
  } else {
    verdict = "neutral";
    verdictLabel = "ניטרלי";
    reason = `מחיר למ"ר עלה בכ-${appreciationPerYear.toFixed(1)}% בשנה, עם ${dealsPerMonth} עסקאות בחודש. מגמה מתונה — כדאי להשוות לאזורים חלופיים.`;
  }

  return {
    trend,
    appreciationPerYear: +appreciationPerYear.toFixed(1),
    totalAppreciation: +totalAppreciation.toFixed(1),
    dealsPerMonth,
    volatility: +volatility.toFixed(1),
    verdict,
    verdictLabel,
    reason,
  };
}

function monthSpan(deals: Deal[]): number {
  const dates = deals.map((d) => d.date).filter(Boolean).sort();
  if (dates.length < 2) return 1;
  const a = new Date(dates[0]);
  const b = new Date(dates[dates.length - 1]);
  return Math.max(1, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1);
}

function stdDev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const m = nums.reduce((s, n) => s + n, 0) / nums.length;
  const variance = nums.reduce((s, n) => s + (n - m) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

/** מחשב סטטיסטיקה על עסקאות, כולל פילוח לפי מספר חדרים. */
export function calculateStatistics(deals: Deal[]): DealStatistics {
  const prices = deals.map((d) => d.price).filter((p) => p > 0);
  const ppsm = deals.map((d) => d.pricePerSqm).filter((p): p is number => p != null && p > 0);

  const byRooms: DealStatistics["byRooms"] = {};
  for (const d of deals) {
    if (d.rooms == null) continue;
    const k = String(d.rooms);
    (byRooms[k] ??= { count: 0, medianPrice: 0, medianPricePerSqm: null }).count++;
  }
  for (const k of Object.keys(byRooms)) {
    const group = deals.filter((d) => String(d.rooms) === k);
    byRooms[k].medianPrice = median(group.map((d) => d.price).filter((p) => p > 0));
    const gp = group.map((d) => d.pricePerSqm).filter((p): p is number => p != null && p > 0);
    byRooms[k].medianPricePerSqm = gp.length ? median(gp) : null;
  }

  const dates = deals.map((d) => d.date).filter(Boolean).sort();

  return {
    count: deals.length,
    meanPrice: mean(prices),
    medianPrice: median(prices),
    minPrice: prices.length ? Math.min(...prices) : 0,
    maxPrice: prices.length ? Math.max(...prices) : 0,
    meanPricePerSqm: ppsm.length ? mean(ppsm) : null,
    medianPricePerSqm: ppsm.length ? median(ppsm) : null,
    byRooms,
    dateRange: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
  };
}

// ---- מפת הזדמנויות: ניקוד שכונות ----

/**
 * ציון אטרקטיביות לשכונה — מאחד את כל הפרמטרים למספר אחד להחלטה.
 * שקוף בכוונה: כל רכיב מוסבר ב-reasons, כדי שאיש כספים יבין למה שכונה
 * קיבלה את הציון שלה ולא יסתמך על "קופסה שחורה".
 */
export interface NeighborhoodScore {
  neighborhood: string;
  city: string;
  count: number;
  medianPrice: number;
  medianPpsm: number | null;
  trendPct: number | null; // שינוי שנתי במחיר למ"ר (אם יש מספיק שנים)
  groundShare: number; // אחוז קומת קרקע/גן
  penthouseShare: number; // אחוז פנטהאוז/גג
  newShare: number; // אחוז חדש מקבלן
  coord: [number, number] | null; // מרכז השכונה (מרקטור) למיקום על המפה
  score: number; // 0–100
  tier: "hot" | "warm" | "cool";
  reasons: string[];
}

const GROUND_RE = /קרקע|דירת גן|גינה/;
const PENTHOUSE_RE = /פנטהאוז|פנטהאוס|דירת גג|גג/;

/** נירמול min-max לרשימת ערכים; כשכולם שווים מחזיר 0.5 לכולם (ניטרלי). */
function minMaxNorm(values: (number | null)[]): (number | null)[] {
  const nums = values.filter((v): v is number => v != null);
  if (!nums.length) return values.map(() => null);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (max === min) return values.map((v) => (v == null ? null : 0.5));
  return values.map((v) => (v == null ? null : (v - min) / (max - min)));
}

/** שינוי שנתי במחיר למ"ר בתוך קבוצת עסקאות (חיובי = עלייה). null אם אין 2 שנים. */
function trendOf(group: Deal[]): number | null {
  const byYear = new Map<string, number[]>();
  for (const d of group) {
    if (d.pricePerSqm && d.pricePerSqm > 0 && d.date) {
      const y = d.date.slice(0, 4);
      (byYear.get(y) ?? byYear.set(y, []).get(y)!).push(d.pricePerSqm);
    }
  }
  const pts = Array.from(byYear.entries())
    .map(([y, arr]) => ({ y, m: median(arr) }))
    .sort((a, b) => a.y.localeCompare(b.y));
  if (pts.length < 2) return null;
  const first = pts[0].m;
  const last = pts[pts.length - 1].m;
  const years = Math.max(1, parseInt(pts[pts.length - 1].y) - parseInt(pts[0].y));
  return first > 0 ? Math.round(((last - first) / first / years) * 1000) / 10 : null;
}

/**
 * מקבץ עסקאות לפי שכונה ומדרג לפי מדד הזדמנות משוקלל.
 * המדד: מומנטום מחיר (45%) + נזילות/היקף עסקאות (30%) + מרווח מחיר —
 * ככל שמחיר המ"ר נמוך יותר יש יותר מקום לעליית ערך (25%). הכל מנורמל
 * יחסית לשכונות שנמצאו בחיפוש הזה, ולכן הציון הוא השוואתי בין האזורים.
 */
export function scoreNeighborhoods(deals: Deal[]): NeighborhoodScore[] {
  // בוחרים את רמת הקיבוץ שנותנת יותר הבחנה: שכונה או רחוב. govmap לעיתים
  // מסווג רחובות רבים תחת שכונה אחת (למשל "לב העיר"), ואז קיבוץ לפי רחוב
  // הוא שמייצר אזורים בני-השוואה.
  const distinct = (fn: (d: Deal) => string) =>
    new Set(deals.map(fn).map((s) => s.trim()).filter(Boolean)).size;
  const useStreet = distinct((d) => d.street) > distinct((d) => d.neighborhood);
  const areaKey = (d: Deal) =>
    (useStreet ? d.street || d.neighborhood : d.neighborhood || d.street || d.city || "כללי").trim() || "כללי";

  const groups = new Map<string, Deal[]>();
  for (const d of deals) {
    const key = areaKey(d);
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(d);
  }

  const base = Array.from(groups.entries())
    .map(([neighborhood, group]) => {
      const ppsm = group.map((d) => d.pricePerSqm).filter((n): n is number => n != null && n > 0);
      const coords = group.map((d) => d.coord).filter((c): c is [number, number] => !!c);
      const coord: [number, number] | null = coords.length
        ? [
            coords.reduce((s, c) => s + c[0], 0) / coords.length,
            coords.reduce((s, c) => s + c[1], 0) / coords.length,
          ]
        : null;
      return {
        neighborhood,
        city: group[0]?.city || "",
        count: group.length,
        medianPrice: median(group.map((d) => d.price).filter((p) => p > 0)),
        medianPpsm: ppsm.length ? median(ppsm) : null,
        trendPct: trendOf(group),
        groundShare: group.filter((d) => GROUND_RE.test(d.propertyType || "")).length / group.length,
        penthouseShare: group.filter((d) => PENTHOUSE_RE.test(d.propertyType || "")).length / group.length,
        newShare: group.filter((d) => d.saleClass === "new").length / group.length,
        coord,
      };
    })
    // שכונה עם עסקה בודדת אינה מדגם — לא מדרגים אותה.
    .filter((n) => n.count >= 2);

  if (!base.length) return [];

  // נירמול הרכיבים יחסית לשכונות שנמצאו.
  const nMomentum = minMaxNorm(base.map((n) => n.trendPct));
  const nLiquidity = minMaxNorm(base.map((n) => n.count));
  // מרווח מחיר: מחיר נמוך = מרווח גבוה, ולכן היפוך.
  const nPpsm = minMaxNorm(base.map((n) => n.medianPpsm));

  const scored: NeighborhoodScore[] = base.map((n, i) => {
    const momentum = nMomentum[i] ?? 0.5;
    const liquidity = nLiquidity[i] ?? 0.5;
    const headroom = nPpsm[i] == null ? 0.5 : 1 - (nPpsm[i] as number);
    const raw = 0.45 * momentum + 0.3 * liquidity + 0.25 * headroom;
    const score = Math.round(raw * 100);

    const reasons: string[] = [];
    if (n.trendPct != null && momentum >= 0.66) reasons.push(`מגמת מחיר חזקה (+${n.trendPct}%/שנה)`);
    else if (n.trendPct != null && momentum <= 0.33) reasons.push(`מגמת מחיר חלשה (${n.trendPct}%/שנה)`);
    if (liquidity >= 0.66) reasons.push(`שוק פעיל (${n.count} עסקאות)`);
    else if (liquidity <= 0.33) reasons.push(`מעט עסקאות (${n.count})`);
    if (headroom >= 0.66) reasons.push("מחיר למ״ר נמוך יחסית — מרווח לעליית ערך");
    else if (headroom <= 0.33) reasons.push("מחיר למ״ר גבוה יחסית לאזור");
    if (n.groundShare >= 0.25) reasons.push("ריכוז דירות קרקע/גן");

    return {
      ...n,
      score,
      tier: score >= 66 ? "hot" : score >= 40 ? "warm" : "cool",
      reasons,
    };
  });

  return scored.sort((a, b) => b.score - a.score);
}
