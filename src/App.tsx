import { useState, useMemo, useEffect, useRef } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from "recharts";
import * as XLSX from "xlsx";
import {
  Search,
  MapPin,
  Home,
  TrendingUp,
  Building2,
  Download,
  Loader2,
  Info,
  CalendarDays,
  Lock,
  LogOut,
  Gauge,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  FileUp,
  X,
  Scale,
  Layers,
  RefreshCw,
} from "lucide-react";
import {
  findRecentDealsForAddress,
  calculateStatistics,
  analyzeInvestment,
  getSocioEconomic,
  bridgeHealth,
  bridgeScrape,
  fetchMadlanAnalytics,
  fetchCreditStatus,
  clearLocalCache,
  parseGushHelka,
  serverLogin,
  serverChangePassword,
  scoreNeighborhoods,
  seedSource,
  seedMadlan,
  autocompleteAddress,
  fetchAllCities,
  type AutocompleteMatch,
  type Deal,
  type NeighborhoodScore,
  type DealStatistics,
  type InvestmentAnalysis,
  type SocioEconomic,
  type BridgeResult,
  type MadlanAnalytics,
  type SourceListing,
  type CreditStatus,
} from "./utils/govmapClient.ts";

/**
 * פרטי הכניסה לאתר. שנו את הערכים כאן לשם המשתמש והסיסמה שתרצו.
 * הערה: זהו שער כניסה בסיסי (client-side) המרחיק סקרנים — אין באתר סודות,
 * כל הנתונים ציבוריים, ולכן אין צורך באבטחה מתקדמת.
 */
const AUTH = { user: "chananel", pass: "Nadlan#360" };
const AUTH_KEY = "nadlan360_auth";
const AUTH_USER_KEY = "nadlan360_user";

const nf = new Intl.NumberFormat("he-IL");
const shekel = (n: number | null | undefined) =>
  n == null ? "—" : "₪" + nf.format(Math.round(n));

/**
 * מחירי האקטורים ב-Apify (לפי אתר הספק) — לחישוב עלות ויתרה.
 * יד2: $5 ל-1,000 תוצאות · מדלן: $10 ל-1,000. יד1 משתמש באקטור של יד2 (מטמון),
 * ופייסבוק משתנה — לכן האומדן מבוסס על יד2 (עיקר העלות) + מדלן.
 */
const APIFY_RATE = { yad2Per1000: 5, madlanPer1000: 10 };
const EST_YAD2_RESULTS = 120; // כמות מודעות טיפוסית לשאיבת עיר
const EST_COST_PER_SEARCH =
  (EST_YAD2_RESULTS * APIFY_RATE.yad2Per1000) / 1000 + (1 * APIFY_RATE.madlanPer1000) / 1000; // ≈ $0.61

const usd = (n: number) => "$" + (Math.round(n * 100) / 100).toFixed(2);

/** יתרת קרדיט בדולרים, או null אם לא ידוע. */
function creditRemaining(credit: CreditStatus | null): number | null {
  if (!credit || !credit.configured || credit.capUsd == null) return null;
  return Math.max(0, Math.round((credit.capUsd - (credit.usedUsd ?? 0)) * 100) / 100);
}

/** כמה חיפושי ערים חדשות נותרו לפי היתרה והמחיר הממוצע. */
function searchesLeft(credit: CreditStatus | null): number | null {
  const rem = creditRemaining(credit);
  return rem == null ? null : Math.floor(rem / EST_COST_PER_SEARCH);
}

/**
 * רשימת ערים ישראליות להשלמה אוטומטית של שדה העיר. ההשלמה של GovMap חלשה
 * לערים (למחרוזת חלקית היא מחזירה כתובות ולא יישובים), ולכן העיר מושלמת
 * מקומית מרשימה זו — מיידי ואמין. אפשר תמיד להקליד עיר חופשית שאינה ברשימה.
 */
const CITY_LIST = [
  "תל אביב-יפו", "ירושלים", "חיפה", "ראשון לציון", "פתח תקווה", "אשדוד",
  "באר שבע", "נתניה", "חולון", "בני ברק", "רמת גן", "בת ים", "רחובות",
  "אשקלון", "בית שמש", "כפר סבא", "הרצליה", "מודיעין-מכבים-רעות", "חדרה",
  "נצרת", "לוד", "רעננה", "רמלה", "מודיעין עילית", "רהט", "גבעתיים",
  "קריית אתא", "נהריה", "הוד השרון", "אום אל-פחם", "קריית גת", "אילת",
  "עכו", "ביתר עילית", "נס ציונה", "כרמיאל", "רמת השרון", "עפולה", "אלעד",
  "טבריה", "ראש העין", "נוף הגליל", "טייבה", "קריית מוצקין", "שפרעם",
  "קריית ים", "קריית ביאליק", "מעלה אדומים", "יבנה", "פרדס חנה-כרכור",
  "קריית אונו", "אור יהודה", "דימונה", "צפת", "טמרה", "נתיבות",
  "יהוד-מונוסון", "סח'נין", "באקה אל-גרביה", "גדרה", "אופקים", "מגדל העמק",
  "מבשרת ציון", "ערד", "גבעת שמואל", "טירה", "ערערה", "נשר", "קריית שמונה",
  "עראבה", "שדרות", "זכרון יעקב", "קריית מלאכי", "גן יבנה", "מעלות-תרשיחא",
  "מגאר", "כפר קאסם", "יקנעם עילית", "קלנסווה", "כפר יונה", "כפר כנא",
  "אריאל", "גבעת זאב", "אור עקיבא", "יבנאל", "כוכב יאיר", "שוהם",
  "פרדסייה", "כפר ורדים", "מיתר", "להבים", "עומר", "קצרין", "ראש פינה",
];

/** נירמול להשוואת ערים: מסיר רווחים סביב מקפים, גרשיים ורווחים כפולים. */
function normCity(s: string): string {
  return s.replace(/["'`׳״]/g, "").replace(/\s*[-־]\s*/g, "-").replace(/\s+/g, " ").trim();
}

/**
 * מפריד טקסט תוצאה של GovMap ("אדמונד סחייק 11 ירושלים") לשם ועיר, לפי
 * רשימת הערים הידועה. ה-id של GovMap הוא קוד בלבד (בלי שמות), ולכן הניתוח
 * נעשה מהטקסט: מחפשים את העיר הארוכה ביותר שהיא סיומת של הטקסט, ומה שלפניה
 * הוא שם הרחוב/השכונה. מחזיר עיר קנונית מהרשימה (עם "-יפו" וכו').
 */
function splitTextByCity(text: string, cities: string[]): { name: string; city: string } {
  const norm = (s: string) =>
    (s || "").replace(/["'`׳״]/g, "").replace(/[-־]/g, " ").replace(/\s+/g, " ").trim();
  const nt = norm(text);
  let bestCity = "";
  let bestWords = 0;
  for (const c of cities) {
    const nc = norm(c);
    if (!nc) continue;
    // התאמה מלאה או סיומת בגבול מילה — וגם הבסיס בלי "יפו" (GovMap כותב "תל אביב").
    const base = nc.replace(/ יפו$/, "").trim();
    for (const cand of [nc, base]) {
      if (cand.length < 2) continue;
      if (nt === cand || nt.endsWith(" " + cand)) {
        const w = cand.split(" ").length;
        if (w > bestWords) {
          bestWords = w;
          bestCity = c;
        }
      }
    }
  }
  if (bestCity) {
    const words = text.trim().split(/\s+/);
    const name = words.slice(0, Math.max(0, words.length - bestWords)).join(" ").trim();
    return { name: name || text.trim(), city: bestCity };
  }
  return { name: text.trim(), city: "" };
}

/**
 * שדה עם השלמה אוטומטית. kind="city" — רשימת ערים מקומית (אמין);
 * kind="street" — רחובות/כתובות מ-GovMap בדפדפן, ממוקד לעיר שנבחרה.
 * בבחירה מעדכן את השדה בשם הנקי שהמערכת תחפש לפיו.
 */
function AddressAutocomplete({
  value,
  onChange,
  onPickCity,
  onPickAddress,
  placeholder,
  icon,
  ariaLabel,
  disabled,
  kind,
  cityForStreet,
  cityList,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  onPickCity?: (city: string) => void;
  onPickAddress?: (m: AutocompleteMatch) => void;
  placeholder: string;
  icon: React.ReactNode;
  ariaLabel: string;
  disabled?: boolean;
  kind: "city" | "street" | "neighborhood" | "address";
  cityForStreet?: string;
  cityList?: string[];
  onEnter?: () => void;
}) {
  const [items, setItems] = useState<AutocompleteMatch[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  // מונע הצגת הצעות מיד אחרי בחירה (הבחירה משנה את value, שמריץ חיפוש חדש).
  const justPicked = useRef(false);

  useEffect(() => {
    if (justPicked.current) {
      justPicked.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < 2) {
      setItems([]);
      setOpen(false);
      return;
    }

    const list = cityList && cityList.length ? cityList : CITY_LIST;
    const localCityMatches = (limit: number) => {
      const nq = normCity(q);
      return list
        .filter((c) => normCity(c).includes(nq))
        .sort((a, b) => Number(normCity(b).startsWith(nq)) - Number(normCity(a).startsWith(nq)))
        .slice(0, limit)
        .map((c) => ({ text: c, type: "settlement", score: 0, point: null, cityName: c }) as AutocompleteMatch);
    };

    // עיר בלבד: השלמה מקומית מהרשימה המלאה (כל יישובי ישראל).
    if (kind === "city") {
      const matches = localCityMatches(8);
      setItems(matches);
      setOpen(matches.length > 0);
      setActive(-1);
      return;
    }

    // שורת חיפוש אחת: עיר (מקומי) + רחוב/שכונה/כתובת (GovMap), ממוזגים.
    if (kind === "address") {
      const cityMatches = localCityMatches(3);
      setItems(cityMatches);
      setOpen(cityMatches.length > 0);
      setActive(-1);
      const t = setTimeout(async () => {
        try {
          const res = await autocompleteAddress(q);
          const gm = res
            .filter((r) => r.type === "street" || r.type === "address" || r.type === "neighborhood")
            // GovMap מחזיר לעיתים שם עיר באנגלית ("הרצל ASDOD") — מסננים
            // לעברית בלבד כדי שהתצוגה תהיה עקבית ובת-פענוח מול רשימת הערים.
            .filter((r) => !/[A-Za-z]/.test(r.text))
            .slice(0, 7);
          const merged = [...cityMatches, ...gm];
          setItems(merged);
          setOpen(merged.length > 0);
          setActive(-1);
        } catch {
          // משאירים את התאמות הערים המקומיות
        }
      }, 220);
      return () => clearTimeout(t);
    }

    // רחוב/שכונה: השלמה מ-GovMap בדפדפן, ממוקדת לעיר שנבחרה.
    const t = setTimeout(async () => {
      try {
        const searchText = cityForStreet?.trim() ? `${q} ${cityForStreet.trim()}` : q;
        const res = await autocompleteAddress(searchText);
        // שכונה: מקדמים תוצאות מסוג "שכונה"; רחוב: מסוג רחוב/כתובת.
        const wanted =
          kind === "neighborhood"
            ? res.filter((r) => r.type === "neighborhood")
            : res.filter((r) => r.type === "street" || r.type === "address");
        const fallback =
          kind === "neighborhood"
            ? res.filter((r) => r.type === "neighborhood" || r.type === "street" || r.type === "address")
            : res;
        const list = (wanted.length ? wanted : fallback).slice(0, 7);
        setItems(list);
        setOpen(list.length > 0);
        setActive(-1);
      } catch {
        setItems([]);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [value, kind, cityForStreet, cityList]);

  // סגירה בלחיצה מחוץ לרכיב.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(m: AutocompleteMatch) {
    justPicked.current = true;
    if (kind === "city") {
      onChange(m.cityName || m.text);
    } else if (kind === "address") {
      // שורת חיפוש אחת: ההורה מפרק עיר/שכונה/רחוב ומריץ חיפוש.
      onChange(m.text);
      onPickAddress?.(m);
    } else {
      // רחוב/שכונה: ה-id של GovMap הוא קוד בלבד, ולכן מפרקים מהטקסט.
      const parsed = splitTextByCity(m.text, cityList && cityList.length ? cityList : CITY_LIST);
      onChange(parsed.name || m.text);
      if (parsed.city && onPickCity) onPickCity(parsed.city);
    }
    setOpen(false);
    setItems([]);
  }

  return (
    <div ref={boxRef} className="relative flex-1">
      <label className="flex items-center gap-2 rounded-2xl bg-slate-50 border border-slate-200 px-3.5 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 transition">
        {icon}
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => items.length && setOpen(true)}
          onKeyDown={(e) => {
            if (open && items.length) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, items.length - 1));
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
                return;
              }
              if (e.key === "Enter" && active >= 0) {
                e.preventDefault();
                pick(items[active]);
                return;
              }
              if (e.key === "Escape") {
                setOpen(false);
                return;
              }
            }
            if (e.key === "Enter") onEnter?.();
          }}
          placeholder={placeholder}
          className="w-full bg-transparent py-3.5 outline-none text-[15px] placeholder:text-slate-400"
          aria-label={ariaLabel}
          autoComplete="off"
          disabled={disabled}
        />
      </label>
      {open && items.length > 0 && (
        <ul className="absolute z-30 mt-1 w-full max-h-72 overflow-auto rounded-2xl bg-white border border-slate-200 shadow-xl py-1 text-right">
          {items.map((m, i) => (
            <li key={`${m.text}-${i}`}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(m);
                }}
                className={`w-full text-right px-4 py-2.5 text-[14px] transition ${
                  i === active ? "bg-indigo-50 text-indigo-800" : "hover:bg-slate-50 text-slate-700"
                }`}
              >
                {m.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** האם העיר/רחוב כבר שמורים במטמון המקומי (ואז השאיבה חינם). */
function isCityCached(city: string, street: string): boolean {
  try {
    const c = city.trim();
    const s = street.trim();
    return (
      localStorage.getItem(`nadlan360_cache_src_yad2_${c}_${s}`) != null ||
      localStorage.getItem(`nadlan360_cache_madlan_${c}`) != null
    );
  } catch {
    return false;
  }
}

/** התאמת מין דקדוקי: "חצי שנה אחרונה" מול "3 שנים אחרונות". */
function rangeSuffix(years: number): string {
  const plural = years >= 2 && years !== 2.5 ? "אחרונות" : "אחרונה";
  return `${rangeLabel(years)} ${plural}`;
}

/** מתאר טווח זמן בעברית: 0.5 → "חצי שנה", 1.5 → "שנה וחצי", 3 → "3 שנים". */
function rangeLabel(years: number): string {
  if (years === 0.5) return "חצי שנה";
  if (years === 1) return "שנה";
  if (years === 1.5) return "שנה וחצי";
  if (years === 2.5) return "שנתיים וחצי";
  if (years === 2) return "שנתיים";
  return `${years} שנים`;
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return Number.isNaN(n) ? null : n;
}
function medianOf(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface UploadedData {
  source: string;
  count: number;
  medianPrice: number;
  medianPricePerSqm: number | null;
}

/**
 * מזהה דירת גן / פנטהאוז-גג לפי סוג הנכס והקומה.
 * סוג הנכס של רשות המסים הוא המקור המהימן ("דירת גן", "פנטהאוז", "דירת גג");
 * קומה 0 ומטה היא סימן משלים לדירת גן. פנטהאוז אי אפשר להסיק מהקומה לבדה
 * (אין לנו את גובה הבניין), ולכן נשענים על סוג הנכס בלבד.
 */
function floorTag(d: Deal): { label: string; cls: string } | null {
  const t = d.propertyType || "";
  if (/פנטהאוז|פנטהאוס|דירת גג|גג/.test(t))
    return { label: "פנטהאוז", cls: "bg-violet-50 text-violet-700 border-violet-200" };
  if (/דירת גן|גינה/.test(t))
    return { label: "דירת גן", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  // רשות המסים לרוב לא מדווחת מספר קומה, אבל סוג הנכס "קרקע" מציין קומת קרקע.
  if (/קרקע/.test(t) || (d.floor != null && d.floor <= 0))
    return { label: "קומת קרקע", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  return null;
}

/** מזהה פנטהאוז / דירת גן במודעת מחיר-מבוקש לפי הכותרת והכתובת. */
function listingTypeTag(r: SourceListing): { label: string; cls: string } | null {
  const t = `${r.title || ""} ${r.street || ""}`;
  if (/פנטהאוז|פנטהאוס|דירת גג|גג/.test(t))
    return { label: "פנטהאוז", cls: "bg-violet-50 text-violet-700 border-violet-200" };
  if (/דירת גן|גינה/.test(t))
    return { label: "דירת גן", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  return null;
}

/** תווית קצרה לסיווג העסקה: חדש מקבלן / יד שנייה. */
function saleClassTag(d: Deal): { label: string; cls: string } | null {
  if (d.saleClass === "new")
    return { label: "חדש מקבלן", cls: "bg-sky-50 text-sky-700 border-sky-200" };
  if (d.saleClass === "second")
    return { label: "יד שנייה", cls: "bg-slate-100 text-slate-600 border-slate-200" };
  return null;
}

const EXAMPLES = [
  { city: "תל אביב", street: "רוטשילד 1" },
  { city: "תל אביב", street: "נווה צדק" },
  { city: "רמת גן", street: "" },
  { city: "חיפה", street: "כרמל" },
];

/**
 * לוכד את אירוע ההתקנה של כרום (beforeinstallprompt) כדי שנוכל להציג
 * כפתור "התקן אפליקציה" משלנו במקום להסתמך על הבאנר האוטומטי של הדפדפן.
 */
function useInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<any>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onBIP = (e: any) => {
      e.preventDefault(); // מונע את הבאנר האוטומטי; נציג כפתור משלנו.
      setPromptEvent(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };
    // כבר מותקן / רץ במצב אפליקציה — אין טעם להציע התקנה.
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as any).standalone === true;
    if (standalone) setInstalled(true);

    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async () => {
    if (!promptEvent) return;
    promptEvent.prompt();
    try {
      await promptEvent.userChoice;
    } catch {}
    setPromptEvent(null);
  };

  return { canInstall: !!promptEvent && !installed, install };
}

export default function App() {
  const [authed, setAuthed] = useState(
    () => sessionStorage.getItem(AUTH_KEY) === "1",
  );
  if (!authed) return <LoginGate onSuccess={() => setAuthed(true)} />;
  return <Dashboard onLogout={() => { sessionStorage.removeItem(AUTH_KEY); setAuthed(false); }} />;
}

/* ---------- מסך כניסה ---------- */
function LoginGate({ onSuccess }: { onSuccess: () => void }) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState(false);

  const [busy, setBusy] = useState(false);
  const [errText, setErrText] = useState("");
  const [showChange, setShowChange] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(false);
    setErrText("");

    // השרת הוא מקור האמת. אם הוא אינו זמין (אתר סטטי ללא שרת) נופלים
    // לבדיקה המקומית, כדי שהאתר יישאר שמיש גם בלי אירוח שרת.
    const res = await serverLogin(user.trim(), pass);
    setBusy(false);

    if (res.ok) {
      sessionStorage.setItem(AUTH_KEY, "1");
      sessionStorage.setItem(AUTH_USER_KEY, user.trim());
      onSuccess();
      return;
    }
    if (res.offline) {
      if (user.trim() === AUTH.user && pass === AUTH.pass) {
        sessionStorage.setItem(AUTH_KEY, "1");
        sessionStorage.setItem(AUTH_USER_KEY, user.trim());
        onSuccess();
        return;
      }
      setErr(true);
      setErrText("שם משתמש או סיסמה שגויים.");
      return;
    }
    setErr(true);
    setErrText(res.error || "שם משתמש או סיסמה שגויים.");
  }

  return (
    <div className="min-h-screen grid place-items-center px-5 relative" dir="rtl">
      <div className="ambient-ios-bg" />
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="grid place-items-center w-14 h-14 rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200 mb-3">
            <Building2 size={28} />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900">נדל״ן 360</h1>
          <p className="text-slate-500 text-sm mt-1">התחברו כדי להיכנס למערכת</p>
        </div>
        <form onSubmit={submit} className="glass-ios rounded-3xl p-6 space-y-3">
          <input
            value={user}
            onChange={(e) => { setUser(e.target.value); setErr(false); }}
            placeholder="שם משתמש"
            aria-label="שם משתמש"
            className="w-full rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3.5 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition text-[15px]"
          />
          <input
            type="password"
            value={pass}
            onChange={(e) => { setPass(e.target.value); setErr(false); }}
            placeholder="סיסמה"
            aria-label="סיסמה"
            className="w-full rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3.5 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition text-[15px]"
          />
          {err && (
            <div className="text-[13px] text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
              {errText || "שם משתמש או סיסמה שגויים."}
            </div>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-[.98] disabled:opacity-60 text-white font-semibold py-3.5 transition shadow-lg shadow-indigo-200"
          >
            {busy ? <Loader2 size={18} className="animate-spin" /> : <Lock size={18} />} {busy ? "מתחבר…" : "כניסה"}
          </button>
          {busy && (
            <p className="text-center text-[12px] text-slate-400">
              אם השרת היה רדום, ההתחברות הראשונה עשויה לקחת עד דקה.
            </p>
          )}

          <button
            type="button"
            onClick={() => setShowChange(true)}
            className="w-full text-center text-[13px] text-slate-500 hover:text-indigo-600 transition pt-1"
          >
            שכחתי / שינוי סיסמה
          </button>
        </form>

        {showChange && <ChangePasswordCard defaultUser={user} onClose={() => setShowChange(false)} />}
      </div>
    </div>
  );
}

/* ---------- שינוי סיסמה ---------- */
function ChangePasswordCard({ defaultUser, onClose }: { defaultUser: string; onClose: () => void }) {
  const [user, setUser] = useState(defaultUser);
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (newPass !== confirmPass) {
      setMsg({ kind: "err", text: "הסיסמה החדשה ואישור הסיסמה אינם תואמים." });
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await serverChangePassword(user.trim(), currentPass, newPass);
    setBusy(false);
    if (res.ok) {
      setMsg({ kind: "ok", text: res.note || "הסיסמה עודכנה. אפשר להיכנס איתה עכשיו." });
      setCurrentPass("");
      setNewPass("");
      setConfirmPass("");
      return;
    }
    setMsg({ kind: "err", text: res.error || "שינוי הסיסמה נכשל." });
  }

  const field =
    "w-full rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition text-[15px]";

  return (
    <form onSubmit={submit} className="glass-ios rounded-3xl p-6 space-y-3 mt-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-slate-800 text-[15px]">שינוי סיסמה</h2>
        <button type="button" onClick={onClose} aria-label="סגור" className="text-slate-400 hover:text-slate-600">
          <X size={17} />
        </button>
      </div>

      <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="שם משתמש" aria-label="שם משתמש" className={field} />
      <input type="password" value={currentPass} onChange={(e) => setCurrentPass(e.target.value)} placeholder="סיסמה נוכחית" aria-label="סיסמה נוכחית" className={field} />
      <input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder="סיסמה חדשה (6 תווים לפחות)" aria-label="סיסמה חדשה" className={field} />
      <input type="password" value={confirmPass} onChange={(e) => setConfirmPass(e.target.value)} placeholder="אישור סיסמה חדשה" aria-label="אישור סיסמה חדשה" className={field} />

      {msg && (
        <div
          className={`text-[13px] rounded-xl px-3 py-2 border ${
            msg.kind === "ok"
              ? "text-emerald-700 bg-emerald-50 border-emerald-200"
              : "text-rose-600 bg-rose-50 border-rose-200"
          }`}
        >
          {msg.text}
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full flex items-center justify-center gap-2 rounded-2xl bg-slate-800 hover:bg-slate-900 active:scale-[.98] disabled:opacity-60 text-white font-semibold py-3 transition"
      >
        {busy ? <Loader2 size={17} className="animate-spin" /> : <Lock size={17} />} עדכן סיסמה
      </button>

      <p className="text-[11.5px] text-slate-400 leading-relaxed">
        שכחת את הסיסמה? פנה למי שמנהל את השרת — איפוס למצב ההתחלתי נעשה דרך משתני הסביבה{" "}
        <span dir="ltr">AUTH_USER</span> / <span dir="ltr">AUTH_PASSWORD</span>.
      </p>
    </form>
  );
}

/* ---------- הדשבורד ---------- */
function Dashboard({ onLogout }: { onLogout: () => void }) {
  const { canInstall, install } = useInstallPrompt();
  const [city, setCity] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [street, setStreet] = useState("");
  // שורת החיפוש המאוחדת (עיר/שכונה/רחוב בשדה אחד) — הטקסט שמוצג בשדה.
  const [addr, setAddr] = useState("");
  // רשימת כל יישובי ישראל להשלמה אוטומטית מלאה (נטענת פעם אחת, עם גיבוי מובנה).
  const [cityList, setCityList] = useState<string[]>(CITY_LIST);
  useEffect(() => {
    fetchAllCities().then((l) => l.length && setCityList(l)).catch(() => {});
  }, []);
  // "both"=גם חדש וגם יד שנייה, כל עסקה מתויגת. ברירת מחדל: הכל.
  const [dealType, setDealType] = useState<1 | 2 | "both">("both");
  const [yearsBack, setYearsBack] = useState(0.5); // ברירת מחדל: הקצר ביותר (חצי שנה)
  // טווח תאריכים מותאם (YYYY-MM). כשפעיל — גובר על yearsBack.
  const [customRange, setCustomRange] = useState(false);
  const [fromMonth, setFromMonth] = useState("");
  const [toMonth, setToMonth] = useState("");
  const [gushHelka, setGushHelka] = useState(""); // רשות המסים בלבד
  const [hideSubsidized, setHideSubsidized] = useState(true); // הסתר מחיר למשתכן/חריגים
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [socio, setSocio] = useState<SocioEconomic | null>(null);
  const [uploaded, setUploaded] = useState<UploadedData | null>(null);
  const [liveSources, setLiveSources] = useState<BridgeResult[]>([]);
  const [madlan, setMadlan] = useState<MadlanAnalytics | null>(null);
  const [credit, setCredit] = useState<CreditStatus | null>(null);
  // נטען פעם אחת בכניסה, כדי שהמחוון יופיע עוד לפני החיפוש הראשון.
  useEffect(() => {
    fetchCreditStatus().then(setCredit).catch(() => {});
  }, []);
  const [fromCache, setFromCache] = useState(false);
  const [liveLoading, setLiveLoading] = useState(false);
  const [query, setQuery] = useState("");

  // שואב אוטומטית מכל מקורות המחיר-המבוקש דרך השרת (שרץ מול Apify).
  // כל מקור מתעדכן ברגע שהוא חוזר — אין המתנה לאיטי מכולם.
  async function runBridge(city: string, street: string, forceFresh = false) {
    setLiveSources([]);
    setMadlan(null);
    setCredit(null);
    setFromCache(false);
    // מדליקים את המחוון כבר עכשיו: בשכבה חינמית השרת נרדם וההתעוררות
    // אורכת עד חצי דקה, ובלי סימן חיים המסך נראה תקוע.
    setLiveLoading(true);
    const up = await bridgeHealth();
    if (!up) {
      // אין שרת — מנסים seed מ-Git כדי שעדיין יוצג מה שנשמר, מכל מכשיר.
      const [y2, y1, fb, md] = await Promise.all([
        seedSource("yad2", city, street),
        seedSource("yad1", city, street),
        seedSource("facebook", city, street),
        seedMadlan(city),
      ]);
      const seeded = [y2, y1, fb].filter((r): r is BridgeResult => !!r);
      if (seeded.length) setLiveSources(seeded);
      if (md) setMadlan(md);
      setLiveLoading(false);
      // אין שרת — מסמנים זאת כדי שהממשק יסביר, במקום שהמקורות ייעלמו בשקט.
      setCredit({ configured: false, offline: true });
      return;
    }

    // בודקים קרדיט לפני השאיבה: אם הוא נגמר, כל המקורות ייכשלו ממילא,
    // ועדיף לומר זאת מיד מאשר להמתין דקה לארבע שגיאות זהות.
    const creditStatus = await fetchCreditStatus();
    setCredit(creditStatus);

    // כשנגמר הקרדיט לא עוצרים: עדיין מגישים כל מה שכבר שמור — במטמון
    // הדפדפן ובמטמון השרת. cacheOnly מבטיח שלא תצא קריאה בתשלום.
    const cacheOnly = !!creditStatus.exhausted;

    const startedAt = Date.now();
    const listings = ["yad2", "yad1", "facebook"].map((s) =>
      bridgeScrape(s, city, street, cacheOnly, forceFresh).then((res) => {
        if (res && res.count) setLiveSources((prev) => [...prev.filter((p) => p.source !== res.source), res]);
      }),
    );
    // מדלן מחזיר אנליטיקה עירונית (מגמה, היצע, מדד) ולא רשימת מודעות.
    const analytics = fetchMadlanAnalytics(city, cacheOnly, forceFresh).then((d) => {
      if (d && d.pricePerSqm) setMadlan(d);
    });

    await Promise.all([...listings, analytics]);
    // שאיבה אמיתית מ-Apify אורכת עשרות שניות; סיום מהיר פירושו שהתשובה
    // הגיעה ממטמון ולא חויב עליה קרדיט.
    setFromCache(Date.now() - startedAt < 4000);
    setLiveLoading(false);
    // מרעננים את היתרה אחרי השאיבה כדי להציג "כמה נשאר" מדויק.
    fetchCreditStatus().then(setCredit).catch(() => {});
  }

  // סינון מחיר למשתכן / עסקאות חריגות: מסיר עסקאות שמחיר המ"ר בהן נמוך
  // בצורה חריגה מהחציון (מתחת ל-60%) — סימן מובהק לדיור מסובסד או עסקה לא-שוקית.
  const shownDeals: Deal[] | null = useMemo(() => {
    if (!deals) return null;
    if (!hideSubsidized) return deals;
    const ppsm = deals.map((d) => d.pricePerSqm).filter((n): n is number => n != null && n > 0);
    if (ppsm.length < 4) return deals;
    const sorted = [...ppsm].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const med = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const floor = med * 0.6;
    return deals.filter((d) => d.pricePerSqm == null || d.pricePerSqm >= floor);
  }, [deals, hideSubsidized]);

  const removedCount = deals && shownDeals ? deals.length - shownDeals.length : 0;

  const stats: DealStatistics | null = useMemo(
    () => (shownDeals && shownDeals.length ? calculateStatistics(shownDeals) : null),
    [shownDeals],
  );

  const investment: InvestmentAnalysis | null = useMemo(
    () => (shownDeals && shownDeals.length ? analyzeInvestment(shownDeals) : null),
    [shownDeals],
  );

  // מפת הזדמנויות — ניקוד שכונות מכל הפרמטרים יחד.
  const hoods: NeighborhoodScore[] = useMemo(
    () => (shownDeals && shownDeals.length ? scoreNeighborhoods(shownDeals) : []),
    [shownDeals],
  );

  const roomsChart = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.byRooms)
      .map(([rooms, v]) => ({
        rooms: `${rooms} חד׳`,
        roomsNum: parseFloat(rooms),
        pricePerSqm: v.medianPricePerSqm ?? 0,
        count: v.count,
      }))
      .filter((r) => r.pricePerSqm > 0)
      .sort((a, b) => a.roomsNum - b.roomsNum);
  }, [stats]);

  async function runSearch(
    c = city,
    s = street,
    dt = dealType,
    yb = yearsBack,
    gh = gushHelka,
    range = customRange ? { from: fromMonth, to: toMonth } : null,
    fresh = false,
    nb = neighborhood,
  ) {
    const cityClean = c.trim();
    const streetClean = s.trim();
    const nbClean = nb.trim();
    const gushClean = gh.trim();
    const parsedGush = gushClean ? parseGushHelka(gushClean) : null;

    if (gushClean && !parsedGush) {
      setError('גוש/חלקה לא תקין. פורמט: "גוש 6638 חלקה 45" או "6638/45".');
      return;
    }
    // גמיש: אפשר למלא רק שדה אחד — עיר, שכונה, רחוב, כתובת מלאה או גוש/חלקה
    if (!cityClean && !streetClean && !nbClean && !parsedGush) {
      setError("הזינו לפחות עיר, שכונה, רחוב או גוש/חלקה כדי להתחיל לחפש.");
      return;
    }

    // גוש/חלקה הוא איתור קדסטרלי מדויק של רשות המסים — הוא גובר על הכתובת.
    const q = parsedGush
      ? parsedGush.query
      : [streetClean, nbClean, cityClean].filter(Boolean).join(" ");
    setLoading(true);
    setError(null);
    setDeals(null);
    setSocio(null);
    setLiveSources([]);
    setMadlan(null);
    setLiveLoading(false);
    setQuery(q);

    // מקורות המחיר-המבוקש הם ברמת עיר/רחוב ואין להם מושג של גוש/חלקה,
    // ולכן בחיפוש קדסטרלי מציגים אך ורק את נתוני רשות המסים.
    if (cityClean && !parsedGush) {
      getSocioEconomic(cityClean).then(setSocio).catch(() => setSocio(null));
      runBridge(cityClean, streetClean, fresh);
    }
    try {
      // טווח מותאם פעיל רק כששני הצדדים מולאו; אחרת נשענים על yearsBack.
      const useRange = !!(range && range.from && range.to);
      const result = await findRecentDealsForAddress(q, {
        yearsBack: yb,
        maxDeals: 100,
        dealType: dt,
        // השאיבה ממוקדת-אזור (שכונה); הסינון לרחוב/גוש-חלקה נעשה בלקוח.
        city: cityClean,
        neighborhood: nbClean,
        street: streetClean,
        forceFresh: fresh,
        ...(parsedGush ? { gush: parsedGush.gush, helka: parsedGush.helka } : {}),
        ...(useRange ? { startDate: range!.from, endDate: range!.to } : {}),
      });
      setDeals(result);
      if (result.length === 0) {
        const scope = useRange ? "בטווח שנבחר" : `ב-${rangeLabel(yb)} האחרונות`;
        setError(`לא נמצאו עסקאות מדווחות באזור זה ${scope}. נסו טווח ארוך יותר או אזור סמוך.`);
      }
    } catch (e: any) {
      setError(e?.message || "אירעה שגיאה בשליפת הנתונים. נסו שוב בעוד רגע.");
    } finally {
      setLoading(false);
    }
  }

  function exportExcel() {
    if (!shownDeals || !shownDeals.length) return;
    const rows = shownDeals.map((d) => ({
      "מקור": "רשות המסים (מחיר סגירה)",
      "תאריך": d.date,
      "עיר": d.city,
      "שכונה": d.neighborhood,
      "רחוב": d.street,
      "מספר": d.houseNumber,
      "חדרים": d.rooms ?? "",
      'שטח (מ"ר)': d.sqm ?? "",
      "קומה": d.floor ?? "",
      "מיוחד": floorTag(d)?.label ?? "",
      "יד ראשונה/שנייה": d.saleClass === "new" ? "חדש מקבלן" : d.saleClass === "second" ? "יד שנייה" : "",
      "מחיר (₪)": d.price,
      'מחיר למ"ר (₪)': d.pricePerSqm ?? "",
      "סוג נכס": d.propertyType,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "עסקאות");
    XLSX.writeFile(wb, `נדלן-360-${query || "דוח"}.xlsx`);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const rows: any[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      const listings = rows
        .map((r) => {
          const price = toNum(r["מחיר מבוקש (₪)"] ?? r["מחיר (₪)"] ?? r["מחיר מבוקש"] ?? r["מחיר"]);
          const sqm = toNum(r['שטח (מ"ר)'] ?? r["שטח"] ?? r["שטח (מ'ר)"]);
          return { price, ppsm: price && sqm ? Math.round(price / sqm) : null };
        })
        .filter((x) => x.price);
      if (!listings.length) {
        setError("לא נמצאו מודעות עם מחיר בקובץ. ודא שזה קובץ שנוצר על ידי כלי השאיבה.");
        return;
      }
      const source = String(rows.find((r) => r["מקור"])?.["מקור"] || "קובץ שהועלה");
      const prices = listings.map((l) => l.price!) as number[];
      const ppsm = listings.map((l) => l.ppsm).filter((n): n is number => n != null);
      setUploaded({
        source,
        count: listings.length,
        medianPrice: medianOf(prices),
        medianPricePerSqm: ppsm.length ? medianOf(ppsm) : null,
      });
      setError(null);
    } catch {
      setError("שגיאה בקריאת הקובץ. ודא שזה Excel או CSV תקין.");
    } finally {
      e.target.value = "";
    }
  }

  return (
    <div className="min-h-screen text-slate-900 relative" dir="rtl">
      <div className="ambient-ios-bg" />
      <header className="sticky top-0 z-10 glass-ios-bar">
        <div className="mx-auto max-w-5xl px-5 py-3.5 flex items-center gap-2.5">
          <div className="grid place-items-center w-9 h-9 rounded-xl bg-indigo-600 text-white shadow-sm shadow-indigo-200">
            <Building2 size={20} />
          </div>
          <div className="leading-tight">
            <div className="font-bold text-[17px]">נדל״ן 360</div>
            <div className="text-[11px] text-slate-500">נתוני עסקאות אמת · רשות המסים</div>
          </div>
          {credit && <CreditMeter credit={credit} />}
          {canInstall && (
            <button
              onClick={install}
              className={`${credit ? "" : "ms-auto "}flex items-center gap-1.5 text-[13px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-[.98] rounded-xl px-3 py-1.5 transition shadow-sm shadow-indigo-200`}
            >
              <Download size={15} /> התקן אפליקציה
            </button>
          )}
          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-800 rounded-xl px-2.5 py-1.5 transition"
          >
            <LogOut size={15} /> יציאה
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 pb-24">
        <section className="pt-10 pb-6 text-center">
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
            כמה באמת עולה דירה שם?
          </h1>
          <p className="mt-3 text-slate-500 text-[15px] max-w-xl mx-auto">
            הזינו עיר ורחוב וקבלו את העסקאות האמיתיות שדווחו לרשות המסים —
            מחיר חציוני, מחיר למ״ר, וכל העסקאות. מיידי, בלי המצאות.
          </p>

          <div className="mt-7 glass-ios rounded-3xl p-3 sm:p-4">
            <div className="flex flex-col sm:flex-row gap-2.5">
              <AddressAutocomplete
                kind="address"
                value={addr}
                onChange={(v) => {
                  setAddr(v);
                  // כל עוד לא נבחרה הצעה — אין עדיין עיר/רחוב ודאיים.
                  if (!v.trim()) {
                    setCity("");
                    setNeighborhood("");
                    setStreet("");
                  }
                }}
                cityList={cityList}
                onPickAddress={(m) => {
                  let c = "";
                  let st = "";
                  let nb = "";
                  if (m.type === "settlement") {
                    c = m.cityName || m.text;
                  } else {
                    const parsed = splitTextByCity(m.text, cityList);
                    c = parsed.city;
                    if (m.type === "neighborhood") nb = parsed.name;
                    else st = parsed.name;
                  }
                  setCity(c);
                  setNeighborhood(nb);
                  setStreet(st);
                  setAddr(m.text);
                  runSearch(c, st, dealType, yearsBack, "", customRange ? { from: fromMonth, to: toMonth } : null, false, nb);
                }}
                onEnter={() => {
                  // חיפוש חופשי בלי בחירה: מפרקים את הטקסט לעיר + רחוב.
                  const parsed = splitTextByCity(addr.trim(), cityList);
                  if (parsed.city) {
                    setCity(parsed.city);
                    setStreet(parsed.name);
                    setNeighborhood("");
                    runSearch(parsed.city, parsed.name, dealType, yearsBack, "", customRange ? { from: fromMonth, to: toMonth } : null, false, "");
                  } else if (addr.trim()) {
                    setCity(addr.trim());
                    setStreet("");
                    setNeighborhood("");
                    runSearch(addr.trim(), "", dealType, yearsBack, "", customRange ? { from: fromMonth, to: toMonth } : null, false, "");
                  }
                }}
                placeholder="חיפוש — עיר, שכונה או רחוב (למשל: הרצל חיפה / פלורנטין / ירושלים)"
                ariaLabel="חיפוש עיר, שכונה או רחוב"
                disabled={!!gushHelka.trim()}
                icon={<Search size={18} className="text-indigo-500 shrink-0" />}
              />
              <button
                onClick={() => {
                  // כפתור חיפוש: אם נבחרה כבר כתובת — מחפש לפיה; אחרת מפרק את הטקסט.
                  if (city.trim() || gushHelka.trim()) {
                    runSearch();
                  } else if (addr.trim()) {
                    const parsed = splitTextByCity(addr.trim(), cityList);
                    const c = parsed.city || addr.trim();
                    const st = parsed.city ? parsed.name : "";
                    setCity(c);
                    setStreet(st);
                    runSearch(c, st, dealType, yearsBack, "", customRange ? { from: fromMonth, to: toMonth } : null, false, "");
                  }
                }}
                disabled={loading}
                className="shrink-0 flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-[.98] disabled:opacity-60 text-white font-semibold px-6 py-3.5 transition shadow-lg shadow-indigo-200"
              >
                {loading ? <Loader2 size={19} className="animate-spin" /> : <Search size={19} />}
                <span>חיפוש</span>
              </button>
            </div>

            {/* חיפוש טרי — מדלג על המאגר השמור ושואב מהמקור, לבדיקת עדכונים.
                חיפוש רגיל מגיש מהמאגר (חינם, מיידי) עד שבועיים; זה מרענן בתשלום. */}
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() =>
                  runSearch(city, street, dealType, yearsBack, gushHelka, customRange ? { from: fromMonth, to: toMonth } : null, true)
                }
                disabled={loading}
                className="flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 text-indigo-700 font-medium px-3 py-1.5 text-[13px] transition"
              >
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                חיפוש טרי מהמקור
              </button>
              <span className="text-[11.5px] text-slate-400">
                בודק אם יצאו עדכונים חדשים (לא מהמאגר השמור) · צורך מעט קרדיט
              </span>
            </div>

            {/* גוש וחלקה — איתור קדסטרלי מדויק. רק רשות המסים מכירה גוש/חלקה,
                ולכן כשהשדה מלא מוצגות עסקאות בלבד, ללא מקורות מחיר-מבוקש. */}
            <div className="mt-2.5 flex flex-col sm:flex-row gap-2.5">
              <label className="flex-1 flex items-center gap-2 rounded-2xl bg-slate-50 border border-slate-200 px-3.5 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 transition">
                <Layers size={18} className="text-indigo-500 shrink-0" />
                <input
                  value={gushHelka}
                  onChange={(e) => setGushHelka(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runSearch()}
                  placeholder='גוש וחלקה — למשל "6638/45" (רשות המסים בלבד)'
                  className="w-full bg-transparent py-3.5 outline-none text-[15px] placeholder:text-slate-400"
                  aria-label="גוש וחלקה"
                />
                {gushHelka.trim() && (
                  <button
                    onClick={() => setGushHelka("")}
                    aria-label="נקה גוש וחלקה"
                    className="shrink-0 text-slate-400 hover:text-slate-600 transition"
                  >
                    <X size={16} />
                  </button>
                )}
              </label>

              {/* טווח זמן: חצי שנה עד 3 שנים, בקפיצות של חצי שנה */}
              <label className="sm:w-56 flex items-center gap-2 rounded-2xl bg-slate-50 border border-slate-200 px-3.5 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 transition">
                <CalendarDays size={18} className="text-indigo-500 shrink-0" />
                <select
                  value={yearsBack}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setYearsBack(v);
                    if (city.trim() || street.trim() || neighborhood.trim() || gushHelka.trim()) runSearch(city, street, dealType, v);
                  }}
                  className="w-full bg-transparent py-3.5 outline-none text-[15px] cursor-pointer"
                  aria-label="טווח זמן לחיפוש"
                >
                  {[0.5, 1, 1.5, 2, 2.5, 3].map((v) => (
                    <option key={v} value={v}>
                      {rangeSuffix(v)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* טווח תאריכים מותאם — מדליק שדות "מ / עד" ומתעלם מהתפריט הקבוע */}
            <div className="mt-2.5">
              <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
                <button
                  type="button"
                  role="switch"
                  aria-checked={customRange}
                  onClick={() => setCustomRange((v) => !v)}
                  className={`relative w-10 h-6 rounded-full transition ${customRange ? "bg-indigo-600" : "bg-slate-300"}`}
                >
                  <span
                    className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${customRange ? "right-0.5" : "right-[18px]"}`}
                  />
                </button>
                <span className="text-[13px] text-slate-600">טווח תאריכים מותאם</span>
              </label>

              {customRange && (
                <div className="mt-2.5 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                  <label className="flex-1 flex items-center gap-2 rounded-2xl bg-slate-50 border border-slate-200 px-3.5 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 transition">
                    <span className="text-[13px] text-slate-500 shrink-0">מ־</span>
                    <input
                      type="month"
                      value={fromMonth}
                      max={toMonth || undefined}
                      onChange={(e) => setFromMonth(e.target.value)}
                      className="w-full bg-transparent py-3 outline-none text-[15px]"
                      aria-label="מתאריך"
                    />
                  </label>
                  <label className="flex-1 flex items-center gap-2 rounded-2xl bg-slate-50 border border-slate-200 px-3.5 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 transition">
                    <span className="text-[13px] text-slate-500 shrink-0">עד־</span>
                    <input
                      type="month"
                      value={toMonth}
                      min={fromMonth || undefined}
                      onChange={(e) => setToMonth(e.target.value)}
                      className="w-full bg-transparent py-3 outline-none text-[15px]"
                      aria-label="עד תאריך"
                    />
                  </label>
                  <button
                    onClick={() => runSearch(city, street, dealType, yearsBack, gushHelka, { from: fromMonth, to: toMonth })}
                    disabled={!fromMonth || !toMonth || loading}
                    className="shrink-0 rounded-2xl bg-slate-800 hover:bg-slate-900 active:scale-[.98] disabled:opacity-50 text-white font-semibold px-5 py-3 text-[14px] transition"
                  >
                    החל טווח
                  </button>
                </div>
              )}
            </div>

            {/* בורר סוג עסקה */}
            <div className="mt-3 flex items-center justify-center gap-1 rounded-2xl bg-slate-100 p-1 w-fit mx-auto">
              {([
                { v: "both", label: "הכל" },
                { v: 2, label: "יד שנייה" },
                { v: 1, label: "חדש מקבלן" },
              ] as const).map((opt) => (
                <button
                  key={String(opt.v)}
                  onClick={() => {
                    setDealType(opt.v);
                    if (city.trim() || street.trim() || neighborhood.trim() || gushHelka.trim()) runSearch(city, street, opt.v);
                  }}
                  className={`px-4 py-1.5 rounded-xl text-[13px] font-medium transition ${
                    dealType === opt.v ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* חיווי עלות לפני החיפוש — כמה יעלה ומה נשאר */}
            {credit && credit.configured && creditRemaining(credit) != null && (
              <p className="mt-3 text-center text-[12px] text-slate-500">
                {(() => {
                  const cached = isCityCached(city, street);
                  const left = searchesLeft(credit);
                  const rem = creditRemaining(credit);
                  if (cached) return <>העיר הזו כבר שמורה — החיפוש <b className="text-emerald-600">חינם</b>. יתרה: {usd(rem!)} (~{left} חיפושים חדשים)</>;
                  return <>חיפוש עיר חדשה ≈ <b>{usd(EST_COST_PER_SEARCH)}</b> · יתרה: {usd(rem!)} (~<b>{left}</b> חיפושים) · מחירי מבוקש בלבד; רשות המסים חינם</>;
                })()}
              </p>
            )}
          </div>

          {!deals && !loading && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <span className="text-[13px] text-slate-400">נסו לדוגמה:</span>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.city + ex.street}
                  onClick={() => {
                    setCity(ex.city);
                    setNeighborhood("");
                    setStreet(ex.street);
                    setAddr([ex.street, ex.city].filter(Boolean).join(" "));
                    runSearch(ex.city, ex.street, dealType, yearsBack, "", null, false, "");
                  }}
                  className="text-[13px] rounded-full bg-white border border-slate-200 hover:border-indigo-300 hover:text-indigo-700 px-3.5 py-1.5 text-slate-600 transition"
                >
                  {[ex.street, ex.city].filter(Boolean).join(", ")}
                </button>
              ))}
            </div>
          )}
        </section>

        {loading && (
          <div className="mt-6 grid place-items-center py-16 text-slate-400">
            <Loader2 size={34} className="animate-spin text-indigo-500" />
            <p className="mt-3 text-sm">שולף עסקאות אמת מ‑govmap…</p>
          </div>
        )}

        {error && !loading && (
          <div className="mt-6 flex items-start gap-2.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3.5 text-[14px]">
            <Info size={18} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {stats && !loading && (
          <section className="mt-8 space-y-6">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-bold text-slate-800">
                  תוצאות עבור <span className="text-indigo-600">{query}</span>
                </h2>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[13px] font-medium rounded-xl border border-slate-200 hover:border-indigo-300 hover:text-indigo-700 px-3 py-2 text-slate-600 transition cursor-pointer">
                    <FileUp size={15} /> העלה קובץ יד2/יד1/מדלן
                    <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleUpload} />
                  </label>
                  <button
                    onClick={exportExcel}
                    className="flex items-center gap-1.5 text-[13px] font-medium rounded-xl border border-slate-200 hover:border-indigo-300 hover:text-indigo-700 px-3 py-2 text-slate-600 transition"
                  >
                    <Download size={15} /> ייצוא לאקסל
                  </button>
                </div>
              </div>

              {/* הסבר על מקורות נוספים */}
              <div className="flex items-start gap-2 mb-3 rounded-2xl bg-indigo-50/70 border border-indigo-100 px-3.5 py-2.5 text-[12.5px] text-indigo-900/80">
                <Info size={15} className="shrink-0 mt-0.5 text-indigo-500" />
                <span>
                  הנתונים כאן הם <b>מחירי סגירה אמיתיים מרשות המסים</b>. <b>מחירי המבוקש</b> מיד2 / יד1 / מדלן /
                  פייסבוק נשאבים <b>אוטומטית</b> ומוצגים למטה — אין צורך בדפדפן פתוח או בהתחברות. חיפוש לפי{" "}
                  <b>גוש וחלקה</b> מציג עסקאות רשות המסים בלבד.
                </span>
              </div>

              {/* מתג סינון מחיר למשתכן */}
              <label className="flex items-center gap-2.5 mb-3 cursor-pointer select-none w-fit">
                <button
                  type="button"
                  role="switch"
                  aria-checked={hideSubsidized}
                  onClick={() => setHideSubsidized((v) => !v)}
                  className={`relative w-10 h-6 rounded-full transition ${hideSubsidized ? "bg-indigo-600" : "bg-slate-300"}`}
                >
                  <span
                    className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${hideSubsidized ? "right-0.5" : "right-[18px]"}`}
                  />
                </button>
                <span className="text-[13px] text-slate-600">
                  הסתר מחיר למשתכן ועסקאות חריגות
                  {hideSubsidized && removedCount > 0 && (
                    <span className="text-slate-400"> ({removedCount} הוסתרו)</span>
                  )}
                </span>
              </label>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard icon={<Building2 size={18} />} label="עסקאות שנמצאו" value={nf.format(stats.count)} tint="indigo" />
                <StatCard icon={<TrendingUp size={18} />} label="מחיר חציוני" value={shekel(stats.medianPrice)} tint="emerald" />
                <StatCard icon={<Home size={18} />} label='מחיר חציוני למ״ר' value={shekel(stats.medianPricePerSqm)} tint="violet" />
                <StatCard
                  icon={<CalendarDays size={18} />}
                  label="טווח תאריכים"
                  value={stats.dateRange ? `${stats.dateRange.from.slice(0, 7)} — ${stats.dateRange.to.slice(0, 7)}` : "—"}
                  tint="sky"
                  small
                />
              </div>
            </div>

            {/* השוואת מחיר מבוקש (יד2/מדלן) מול מחיר סגירה (רשות המסים) */}
            {uploaded && (
              <ComparePanel
                uploaded={uploaded}
                closingMedianPrice={stats.medianPrice}
                closingMedianPpsm={stats.medianPricePerSqm}
                onClear={() => setUploaded(null)}
              />
            )}

            {/* הסבר כשמקורות המחיר-המבוקש אינם זמינים */}
            {credit && !liveLoading && liveSources.length === 0 && !madlan && (
              <SourcesStatusNotice credit={credit} />
            )}

            {/* מחירי מבוקש חיים (יד2 · יד1 · פייסבוק) */}
            {(liveLoading || liveSources.length > 0) && (
              <LiveSourcesPanel
                sources={liveSources}
                loading={liveLoading}
                closingPrice={stats.medianPrice}
                closingPpsm={stats.medianPricePerSqm}
                madlan={madlan}
                fromCache={fromCache}
                onRefresh={() => {
                  // רענון יזום: חיפוש טרי שמדלג על המטמון (מקומי ושרת) ומושך מהמקור.
                  runBridge(city.trim(), street.trim(), true);
                }}
              />
            )}

            {/* כל המודעות שנמצאו, לפי תאריך, עם ציון המקור */}
            {liveSources.some((s) => s.listings?.length) && (
              <SourceListingsTable sources={liveSources} />
            )}

            {/* אנליטיקת מדלן — מגמה, היצע ומחיר למ"ר ברמת העיר */}
            {madlan && <MadlanPanel m={madlan} closingPpsm={stats.medianPricePerSqm} />}

            {/* מדד חברתי-כלכלי (הלמ"ס) */}
            {socio && <SocioPanel s={socio} />}

            {/* מדד השקעה */}
            {investment && <InvestmentPanel inv={investment} />}

            {/* מפת הזדמנויות — כל הפרמטרים ביחד, ניקוד לכל שכונה */}
            {hoods.length > 1 && <OpportunityMap hoods={hoods} />}

            {roomsChart.length > 0 && (
              <div className="glass-ios rounded-3xl p-5">
                <h3 className="font-bold text-slate-800 mb-1">מחיר חציוני למ״ר לפי מספר חדרים</h3>
                <p className="text-[12px] text-slate-400 mb-4">מבוסס על {nf.format(stats.count)} עסקאות אמיתיות</p>
                <div className="h-64" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={roomsChart} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                      <XAxis dataKey="rooms" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
                      <YAxis
                        tick={{ fontSize: 11, fill: "#94a3b8" }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                      />
                      <Tooltip
                        formatter={(v: any) => [shekel(v), 'חציון למ״ר']}
                        contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 13 }}
                      />
                      <Bar dataKey="pricePerSqm" radius={[8, 8, 0, 0]}>
                        {roomsChart.map((_, i) => (
                          <Cell key={i} fill="#6366f1" />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            <div className="glass-ios rounded-3xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h3 className="font-bold text-slate-800">כל העסקאות</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-slate-400 text-right bg-slate-50/60">
                      <th className="font-medium px-4 py-2.5 whitespace-nowrap">תאריך</th>
                      <th className="font-medium px-4 py-2.5 whitespace-nowrap">כתובת</th>
                      <th className="font-medium px-4 py-2.5 whitespace-nowrap">חדרים</th>
                      <th className="font-medium px-4 py-2.5 whitespace-nowrap">מ״ר</th>
                      <th className="font-medium px-4 py-2.5 whitespace-nowrap">קומה</th>
                      <th className="font-medium px-4 py-2.5 whitespace-nowrap">מחיר</th>
                      <th className="font-medium px-4 py-2.5 whitespace-nowrap">למ״ר</th>
                      <th className="font-medium px-4 py-2.5 whitespace-nowrap">סוג</th>
                      <th className="font-medium px-4 py-2.5 whitespace-nowrap">מקור</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownDeals!.map((d, i) => {
                      const fTag = floorTag(d);
                      const sTag = saleClassTag(d);
                      return (
                      <tr key={d.objectid + "_" + i} className="border-t border-slate-50 hover:bg-indigo-50/40 transition">
                        <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{d.date}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap font-medium text-slate-700">
                          {[d.street, d.houseNumber].filter(Boolean).join(" ") || d.neighborhood || d.city}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">{d.rooms ?? "—"}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap">{d.sqm ?? "—"}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className="text-slate-600">{d.floor ?? "—"}</span>
                          {fTag && (
                            <span className={`ms-1.5 inline-block text-[10.5px] rounded-full px-1.5 py-0.5 border ${fTag.cls}`}>
                              {fTag.label}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap font-semibold text-slate-800">{shekel(d.price)}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{shekel(d.pricePerSqm)}</td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          {sTag ? (
                            <span className={`inline-block text-[11px] rounded-full px-2 py-0.5 border ${sTag.cls}`}>
                              {sTag.label}
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className="inline-block text-[11px] rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 border border-emerald-100">
                            רשות המסים
                          </span>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="text-center text-[12px] text-slate-400 pt-2">
              המקור: מאגר עסקאות הנדל״ן של רשות המסים דרך govmap.gov.il · הנתונים ציבוריים ומתעדכנים באיחור מסוים.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  facebook: "פייסבוק",
  yad2: "יד2",
  yad1: "יד1",
  madlan: "מדלן PRO",
};

/* ---------- מפת הזדמנויות ---------- */
const TIER_HEX: Record<NeighborhoodScore["tier"], string> = {
  hot: "#10b981",
  warm: "#f59e0b",
  cool: "#94a3b8",
};
const TIER_LABEL: Record<NeighborhoodScore["tier"], string> = {
  hot: "הזדמנות גבוהה",
  warm: "בינונית",
  cool: "נמוכה",
};
const TIER_CHIP: Record<NeighborhoodScore["tier"], string> = {
  hot: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warm: "bg-amber-50 text-amber-700 border-amber-200",
  cool: "bg-slate-100 text-slate-600 border-slate-200",
};

/**
 * מפת הזדמנויות — מאחדת את כל הפרמטרים לציון אחד לכל שכונה, ומציגה
 * מפת בועות (מיקום לפי קואורדינטות אמת, צבע=ציון, גודל=היקף עסקאות)
 * לצד טבלה מדורגת. כלי החלטה: איפה שווה להתמקד בקרקע / פינוי-בינוי.
 */
function OpportunityMap({ hoods }: { hoods: NeighborhoodScore[] }) {
  const mapped = hoods.filter((h) => h.coord);
  const W = 640;
  const H = 380;
  const pad = 46;

  const layout = useMemo(() => {
    if (!mapped.length) return [];
    const xs = mapped.map((h) => h.coord![0]);
    const ys = mapped.map((h) => h.coord![1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const maxCount = Math.max(...mapped.map((h) => h.count));
    const sx = (v: number) => pad + ((v - minX) / (maxX - minX || 1)) * (W - 2 * pad);
    const sy = (v: number) => H - pad - ((v - minY) / (maxY - minY || 1)) * (H - 2 * pad);
    return mapped.map((h) => ({
      h,
      cx: sx(h.coord![0]),
      cy: sy(h.coord![1]),
      r: 12 + Math.sqrt(h.count / maxCount) * 24,
    }));
  }, [mapped]);

  return (
    <div className="glass-ios rounded-3xl p-5">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <MapPin size={18} className="text-indigo-500" />
        <h3 className="font-bold text-slate-800">מפת הזדמנויות — דירוג אזורים</h3>
        <span className="text-[11px] text-slate-400">{hoods.length} אזורים · כל הפרמטרים בציון אחד</span>
      </div>
      <p className="text-[12px] text-slate-400 mb-4">
        ציון משוקלל: מגמת מחיר (45%) · נזילות/היקף עסקאות (30%) · מרווח מחיר למ״ר (25%).
        הציון השוואתי בין השכונות שנמצאו. כלי תמיכה בהחלטה — לא ייעוץ.
      </p>

      {layout.length > 0 && (
        <div className="overflow-x-auto mb-4" dir="ltr">
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="min-w-[520px]" role="img" aria-label="מפת שכונות לפי ציון הזדמנות">
            <rect x="0" y="0" width={W} height={H} rx="18" fill="#f8fafc" />
            {layout.map(({ h, cx, cy, r }, i) => (
              <g key={i}>
                <circle cx={cx} cy={cy} r={r} fill={TIER_HEX[h.tier]} fillOpacity={0.28} stroke={TIER_HEX[h.tier]} strokeWidth={1.5} />
                <text x={cx} y={cy + 4} textAnchor="middle" fontSize={13} fontWeight={700} fill="#0f172a">
                  {h.score}
                </text>
                {(i < 6 || h.tier === "hot") && (
                  <text x={cx} y={cy - r - 4} textAnchor="middle" fontSize={11} fill="#475569">
                    {h.neighborhood.length > 14 ? h.neighborhood.slice(0, 13) + "…" : h.neighborhood}
                  </text>
                )}
              </g>
            ))}
          </svg>
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-3 text-[11.5px]">
        {(["hot", "warm", "cool"] as const).map((t) => (
          <span key={t} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full inline-block" style={{ background: TIER_HEX[t] }} />
            <span className="text-slate-500">{TIER_LABEL[t]}</span>
          </span>
        ))}
        <span className="text-slate-400">· גודל הבועה = היקף העסקאות</span>
      </div>

      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-[12.5px] min-w-[620px]">
          <thead>
            <tr className="text-slate-400 text-[11.5px] border-b border-slate-200">
              <th className="text-right font-bold py-2 px-1">#</th>
              <th className="text-right font-bold py-2 px-1">אזור</th>
              <th className="text-right font-bold py-2 px-1">ציון</th>
              <th className="text-right font-bold py-2 px-1">עסקאות</th>
              <th className="text-right font-bold py-2 px-1">חציון ₪/מ״ר</th>
              <th className="text-right font-bold py-2 px-1">מגמה</th>
              <th className="text-right font-bold py-2 px-1">למה</th>
            </tr>
          </thead>
          <tbody>
            {hoods.map((h, i) => (
              <tr key={h.neighborhood + i} className="border-b border-slate-100 hover:bg-slate-50/60 transition align-top">
                <td className="py-2 px-1 text-slate-400">{i + 1}</td>
                <td className="py-2 px-1 font-medium text-slate-700 whitespace-nowrap">
                  {h.neighborhood}
                  <span className={`ms-1.5 inline-block text-[10px] rounded-full px-1.5 py-0.5 border ${TIER_CHIP[h.tier]}`}>
                    {TIER_LABEL[h.tier]}
                  </span>
                </td>
                <td className="py-2 px-1">
                  <div className="flex items-center gap-1.5">
                    <div className="w-14 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${h.score}%`, background: TIER_HEX[h.tier] }} />
                    </div>
                    <span className="font-bold text-slate-700">{h.score}</span>
                  </div>
                </td>
                <td className="py-2 px-1 text-slate-600">{h.count}</td>
                <td className="py-2 px-1 text-slate-600 whitespace-nowrap">{h.medianPpsm ? shekel(h.medianPpsm) : "—"}</td>
                <td className="py-2 px-1 whitespace-nowrap">
                  {h.trendPct == null ? (
                    <span className="text-slate-300">—</span>
                  ) : (
                    <span className={h.trendPct >= 0 ? "text-emerald-600" : "text-rose-600"}>
                      {h.trendPct >= 0 ? "+" : ""}{h.trendPct}%
                    </span>
                  )}
                </td>
                <td className="py-2 px-1 text-slate-500 max-w-[220px]">
                  {h.reasons.slice(0, 2).join(" · ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- מחוון קרדיט ---------- */
/**
 * כמה קרדיט נותר לשאיבות. יושב בכותרת כדי שיהיה גלוי תמיד — בלעדיו
 * הקרדיט נגמר בלי אזהרה והמקורות מפסיקים לעבוד בלי סיבה נראית לעין.
 */
function CreditMeter({ credit }: { credit: CreditStatus }) {
  if (!credit.configured || credit.unknown || credit.capUsd == null) return null;

  const used = credit.usedUsd ?? 0;
  const cap = credit.capUsd || 0;
  const left = Math.max(0, Math.round((cap - used) * 100) / 100);
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  const n = searchesLeft(credit); // כמה חיפושי ערים חדשות נותרו

  // מתחת לחמישית נותר — אדום; מתחת לחצי — כתום.
  const tone = left <= 0 ? "rose" : left / cap < 0.2 ? "amber" : "emerald";
  const barColor = tone === "rose" ? "bg-rose-500" : tone === "amber" ? "bg-amber-500" : "bg-emerald-500";
  const textColor = tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : "text-emerald-600";

  return (
    <a
      href="https://console.apify.com/billing/subscription"
      target="_blank"
      rel="noopener noreferrer"
      title={`נוצל $${used} מתוך $${cap} · נשאר $${left}`}
      className="ms-auto flex items-center gap-2 rounded-xl px-2.5 py-1.5 hover:bg-slate-100/70 transition"
    >
      <div className="leading-tight text-right">
        <div className={`text-[12px] font-bold ${textColor}`}>
          {left > 0 ? `נשאר $${left}` : "הקרדיט נגמר"}
        </div>
        <div className="text-[10px] text-slate-400">
          {left > 0 && n != null ? `~${n} חיפושים · ` : ""}נוצל ${used} מתוך ${cap}
        </div>
      </div>
      <div className="w-14 h-1.5 rounded-full bg-slate-200 overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </a>
  );
}

/* ---------- מודעות מכל המקורות ---------- */
const SOURCE_STYLE: Record<string, string> = {
  yad2: "bg-orange-50 text-orange-700 border-orange-200",
  yad1: "bg-sky-50 text-sky-700 border-sky-200",
  facebook: "bg-blue-50 text-blue-700 border-blue-200",
  madlan: "bg-violet-50 text-violet-700 border-violet-200",
};

/**
 * דירוג אמינות המקורות (נמוך = אמין יותר). כשאותה דירה מופיעה בכמה מקורות,
 * שומרים את זה עם הדירוג הנמוך ביותר. יד2 מובנה עם שם רחוב; פייסבוק חופשי
 * וארצי ולכן הכי פחות אמין.
 */
const SOURCE_RELIABILITY: Record<string, number> = { yad2: 0, yad1: 1, madlan: 1, facebook: 3 };
const reliabilityRank = (src: string) => SOURCE_RELIABILITY[src] ?? 2;

/** מנרמל שם רחוב להשוואה: מסיר "רחוב"/"רח׳", פסיקים, רווחים כפולים. */
function normStreetClient(s: string): string {
  return String(s || "")
    .replace(/רח['׳]?\s*/g, "")
    .replace(/רחוב\s*/g, "")
    .replace(/[",]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * מפתח זיהוי אותה דירה בין מקורות: רחוב מנורמל + חדרים + מ"ר + דלי מחיר
 * (10 אלף ₪). מחזיר null כשאין מספיק מידע כדי לומר בביטחון שזו כפילות —
 * במקרה כזה המודעה נשמרת כמות שהיא.
 */
function listingDupKey(r: SourceListing): string | null {
  if (!r.price) return null;
  const street = normStreetClient(r.street);
  const sqm = r.sqm ?? "";
  // בלי רחוב וגם בלי שטח אי אפשר לטעון שזו אותה דירה.
  if (!street && sqm === "") return null;
  const priceBucket = Math.round(r.price / 10000);
  return `${street}|${r.rooms ?? ""}|${sqm}|${priceBucket}`;
}

/**
 * מאחד מודעות כפולות ממקורות שונים ומשאיר את המקור האמין יותר.
 * מחזיר את הרשימה המאוחדת ואת מספר הכפילויות שהוסרו.
 */
function dedupeListings(rows: SourceListing[]): { rows: SourceListing[]; removed: number } {
  const best = new Map<string, SourceListing>();
  const passthrough: SourceListing[] = [];
  let removed = 0;
  for (const r of rows) {
    const key = listingDupKey(r);
    if (!key) {
      passthrough.push(r);
      continue;
    }
    const existing = best.get(key);
    if (!existing) {
      best.set(key, r);
      continue;
    }
    removed++;
    if (reliabilityRank(r.source) < reliabilityRank(existing.source)) best.set(key, r);
  }
  return { rows: [...passthrough, ...best.values()], removed };
}

/**
 * מאחד את המודעות מכל המקורות לרשימה אחת ממוינת לפי תאריך פרסום.
 * לכל שורה מסומן המקור, כדי שיהיה ברור מאיפה כל מחיר הגיע.
 */
function SourceListingsTable({ sources }: { sources: BridgeResult[] }) {
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<string>("all"); // מקור
  const [fromDate, setFromDate] = useState(""); // YYYY-MM-DD
  const [toDate, setToDate] = useState("");
  const [minPrice, setMinPrice] = useState(""); // ₪
  const [maxPrice, setMaxPrice] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "penthouse" | "garden">("all");

  const { all, removedDupes } = useMemo(() => {
    const rows: SourceListing[] = [];
    for (const s of sources) if (s.listings) rows.push(...s.listings);
    // איחוד כפילויות בין מקורות — נשמר המקור האמין יותר.
    const { rows: deduped, removed } = dedupeListings(rows);
    // ללא תאריך — לסוף, אחרת המיון נראה שרירותי.
    deduped.sort((a, b) => {
      if (!a.date && !b.date) return b.price - a.price;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date.localeCompare(a.date);
    });
    return { all: deduped, removedDupes: removed };
  }, [sources]);

  // סינון לפי מקור · תאריך · מחיר · סוג (פנטהאוז/גן).
  const shown = useMemo(() => {
    const minP = minPrice ? Number(minPrice) : null;
    const maxP = maxPrice ? Number(maxPrice) : null;
    return all.filter((r) => {
      if (filter !== "all" && r.source !== filter) return false;
      if (fromDate && (!r.date || r.date < fromDate)) return false;
      if (toDate && (!r.date || r.date > toDate)) return false;
      if (minP != null && r.price < minP) return false;
      if (maxP != null && r.price > maxP) return false;
      if (typeFilter !== "all") {
        const tag = listingTypeTag(r);
        const want = typeFilter === "penthouse" ? "פנטהאוז" : "דירת גן";
        if (tag?.label !== want) return false;
      }
      return true;
    });
  }, [all, filter, fromDate, toDate, minPrice, maxPrice, typeFilter]);

  const visible = showAll ? shown : shown.slice(0, 25);

  // ממוצע (חציון) מחיר ומחיר למ"ר לפי מספר חדרים — על התוצאות המסוננות.
  const byRooms = useMemo(() => {
    const groups = new Map<number, SourceListing[]>();
    for (const r of shown) {
      if (r.rooms == null) continue;
      (groups.get(r.rooms) ?? groups.set(r.rooms, []).get(r.rooms)!).push(r);
    }
    return Array.from(groups.entries())
      .map(([rooms, rows]) => ({
        rooms,
        count: rows.length,
        medianPrice: medianOf(rows.map((r) => r.price).filter((p) => p > 0)),
        medianPpsm: medianOf(rows.map((r) => r.pricePerSqm).filter((n): n is number => n != null && n > 0)),
      }))
      .sort((a, b) => a.rooms - b.rooms);
  }, [shown]);

  const hasFilters = !!(fromDate || toDate || minPrice || maxPrice || typeFilter !== "all" || filter !== "all");
  const clearFilters = () => {
    setFilter("all");
    setFromDate("");
    setToDate("");
    setMinPrice("");
    setMaxPrice("");
    setTypeFilter("all");
  };

  const availableSources = useMemo(
    () => sources.filter((s) => s.listings?.length).map((s) => s.source),
    [sources],
  );

  const fmtDate = (d: string) => {
    if (!d) return "—";
    const [y, m, day] = d.split("-");
    return `${day}.${m}.${y.slice(2)}`;
  };

  return (
    <div className="glass-ios rounded-3xl p-5">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <FileUp size={18} className="text-indigo-500" />
        <h3 className="font-bold text-slate-800">כל המודעות שנמצאו</h3>
        <span className="text-[11px] text-slate-400">{nf.format(all.length)} מודעות · לפי תאריך פרסום</span>
        {removedDupes > 0 && (
          <span className="text-[11px] rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5">
            {removedDupes} כפילויות אוחדו
          </span>
        )}
      </div>
      <p className="text-[12px] text-slate-400 mb-3">
        מחירי מבוקש מהמקורות החיים. ליד כל מודעה מצוין מאיזה מקור היא הגיעה.
        {removedDupes > 0 && " מודעות שהופיעו בכמה מקורות אוחדו — הושאר המקור האמין יותר."}
      </p>

      <div className="flex flex-wrap gap-1.5 mb-3">
        <button
          onClick={() => setFilter("all")}
          className={`text-[12px] font-bold px-3 py-1.5 rounded-full border transition ${
            filter === "all" ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-600 border-slate-200"
          }`}
        >
          הכל ({all.length})
        </button>
        {availableSources.map((src) => {
          const n = all.filter((r) => r.source === src).length;
          return (
            <button
              key={src}
              onClick={() => setFilter(src)}
              className={`text-[12px] font-bold px-3 py-1.5 rounded-full border transition ${
                filter === src
                  ? "bg-slate-800 text-white border-slate-800"
                  : SOURCE_STYLE[src] || "bg-white text-slate-600 border-slate-200"
              }`}
            >
              {SOURCE_LABEL[src] || src} ({n})
            </button>
          );
        })}
      </div>

      {/* סינון סוג: פנטהאוז / דירת גן */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {([
          { v: "all", label: "כל הסוגים" },
          { v: "penthouse", label: "פנטהאוז" },
          { v: "garden", label: "דירת גן" },
        ] as const).map((opt) => (
          <button
            key={opt.v}
            onClick={() => setTypeFilter(opt.v)}
            className={`text-[12px] font-medium px-3 py-1.5 rounded-full border transition ${
              typeFilter === opt.v ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-600 border-slate-200"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* סינון תאריך + מחיר */}
      <div className="flex flex-wrap items-center gap-2 mb-3 text-[12px]">
        <span className="text-slate-400">תאריך:</span>
        <input
          type="date"
          value={fromDate}
          max={toDate || undefined}
          onChange={(e) => setFromDate(e.target.value)}
          className="rounded-xl bg-slate-50 border border-slate-200 px-2.5 py-1.5 outline-none focus:border-indigo-400"
          aria-label="מתאריך"
        />
        <span className="text-slate-400">—</span>
        <input
          type="date"
          value={toDate}
          min={fromDate || undefined}
          onChange={(e) => setToDate(e.target.value)}
          className="rounded-xl bg-slate-50 border border-slate-200 px-2.5 py-1.5 outline-none focus:border-indigo-400"
          aria-label="עד תאריך"
        />
        <span className="text-slate-400 ms-2">מחיר ₪:</span>
        <input
          type="number"
          inputMode="numeric"
          placeholder="מ־"
          value={minPrice}
          onChange={(e) => setMinPrice(e.target.value)}
          className="w-24 rounded-xl bg-slate-50 border border-slate-200 px-2.5 py-1.5 outline-none focus:border-indigo-400"
          aria-label="מחיר מינימלי"
        />
        <input
          type="number"
          inputMode="numeric"
          placeholder="עד"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
          className="w-24 rounded-xl bg-slate-50 border border-slate-200 px-2.5 py-1.5 outline-none focus:border-indigo-400"
          aria-label="מחיר מקסימלי"
        />
        {hasFilters && (
          <button onClick={clearFilters} className="ms-1 text-[12px] font-medium text-indigo-600 hover:text-indigo-700">
            נקה סינון
          </button>
        )}
        <span className="text-slate-400 ms-auto">מוצג {nf.format(shown.length)} מתוך {nf.format(all.length)}</span>
      </div>

      {/* ממוצע (חציון) מחיר לפי חדרים — על התוצאות המסוננות */}
      {byRooms.length > 0 && (
        <div className="mb-3 rounded-2xl bg-slate-50/70 border border-slate-100 p-3">
          <div className="text-[11.5px] font-bold text-slate-500 mb-2">מחיר חציוני לפי חדרים ({nf.format(shown.length)} מודעות)</div>
          <div className="flex flex-wrap gap-2">
            {byRooms.map((b) => (
              <div key={b.rooms} className="rounded-xl bg-white border border-slate-200 px-3 py-1.5 text-center">
                <div className="text-[11px] text-slate-400">{b.rooms} חד׳ · {b.count}</div>
                <div className="text-[13px] font-bold text-slate-700">{shekel(b.medianPrice)}</div>
                {b.medianPpsm > 0 && <div className="text-[10.5px] text-slate-400">{shekel(b.medianPpsm)}/מ״ר</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-[12.5px] min-w-[620px]">
          <thead>
            <tr className="text-slate-400 text-[11.5px] border-b border-slate-200">
              <th className="text-right font-bold py-2 px-1">תאריך</th>
              <th className="text-right font-bold py-2 px-1">מקור</th>
              <th className="text-right font-bold py-2 px-1">כתובת</th>
              <th className="text-right font-bold py-2 px-1">חדרים</th>
              <th className="text-right font-bold py-2 px-1">מ״ר</th>
              <th className="text-right font-bold py-2 px-1">מחיר</th>
              <th className="text-right font-bold py-2 px-1">₪/מ״ר</th>
              <th className="text-right font-bold py-2 px-1">מיוחד</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => {
              const tTag = listingTypeTag(r);
              return (
              <tr key={`${r.source}-${i}`} className="border-b border-slate-100 hover:bg-slate-50/60 transition">
                <td className="py-2 px-1 text-slate-500 whitespace-nowrap">{fmtDate(r.date)}</td>
                <td className="py-2 px-1">
                  <span
                    className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                      SOURCE_STYLE[r.source] || "bg-slate-50 text-slate-600 border-slate-200"
                    }`}
                  >
                    {SOURCE_LABEL[r.source] || r.source}
                  </span>
                </td>
                <td className="py-2 px-1 text-slate-700 max-w-[190px] truncate">
                  {r.url ? (
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-indigo-600 hover:underline"
                      title={r.title || r.street}
                    >
                      {r.street || r.title || "—"}
                    </a>
                  ) : (
                    <span title={r.title}>{r.street || r.title || "—"}</span>
                  )}
                  {r.neighbourhood && (
                    <span className="block text-[10.5px] text-slate-400 truncate">{r.neighbourhood}</span>
                  )}
                </td>
                <td className="py-2 px-1 text-slate-600">{r.rooms ?? "—"}</td>
                <td className="py-2 px-1 text-slate-600">{r.sqm ?? "—"}</td>
                <td className="py-2 px-1 font-bold text-slate-800 whitespace-nowrap">{shekel(r.price)}</td>
                <td className="py-2 px-1 text-slate-600 whitespace-nowrap">
                  {r.pricePerSqm ? shekel(r.pricePerSqm) : "—"}
                </td>
                <td className="py-2 px-1 whitespace-nowrap">
                  {tTag ? (
                    <span className={`inline-block text-[10.5px] rounded-full px-1.5 py-0.5 border ${tTag.cls}`}>
                      {tTag.label}
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {shown.length === 0 && (
        <p className="text-[12.5px] text-slate-400 py-3 text-center">אין מודעות התואמות את הסינון. נסו לנקות חלק מהמסננים.</p>
      )}

      {shown.length > 25 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 text-[12.5px] font-bold text-indigo-600 hover:text-indigo-700"
        >
          {showAll ? "הצג פחות" : `הצג את כל ${nf.format(shown.length)} המודעות`}
        </button>
      )}
    </div>
  );
}

/* ---------- הסבר מצב המקורות ---------- */
/**
 * מקורות המחיר-המבוקש נכשלים בשקט כשאין שרת או כשנגמר הקרדיט, והמשתמש
 * נשאר עם רשות המסים בלבד בלי לדעת למה. הפאנל הזה אומר את זה במפורש.
 */
function SourcesStatusNotice({ credit }: { credit: CreditStatus }) {
  let title = "מקורות המחיר המבוקש אינם זמינים כרגע";
  let body = "";
  let link: { href: string; label: string } | null = null;

  if (credit.offline || !credit.configured) {
    body =
      "השרת שמביא את יד2 / יד1 / מדלן / פייסבוק אינו זמין כרגע. נתוני רשות המסים שלמעלה עובדים תמיד ואינם תלויים בו.";
  } else if (credit.exhausted) {
    title = "נגמר הקרדיט — לא נמצאו נתונים שמורים לעיר זו";
    body = `נוצל ${
      credit.usedUsd != null ? `$${credit.usedUsd}` : "כל הסכום"
    }${
      credit.capUsd ? ` מתוך $${credit.capUsd}` : ""
    }. ערים שכבר חיפשת מוצגות מהמאגר השמור (נשמר לשבועיים), אך העיר הזו טרם נשאבה. הקרדיט מתחדש בתחילת מחזור החיוב הבא.`;
    link = { href: "https://console.apify.com/billing/subscription", label: "לניהול הקרדיט ב-Apify" };
  } else if (credit.unknown) {
    body = "לא הצלחנו לבדוק את מצב הקרדיט. נסו שוב בעוד רגע.";
  } else {
    // יש קרדיט והשרת עובד — פשוט אין מודעות באזור הזה.
    title = "לא נמצאו מודעות באזור זה";
    body = "המקורות פעילים, אך אין כרגע מודעות תואמות בעיר או ברחוב שחיפשתם.";
  }

  return (
    <div className="glass-ios rounded-3xl p-5">
      <div className="flex items-start gap-2.5">
        <Info size={17} className="shrink-0 mt-0.5 text-amber-500" />
        <div className="min-w-0">
          <h3 className="font-bold text-slate-800 text-[14px]">{title}</h3>
          <p className="text-[12.5px] text-slate-500 mt-1 leading-relaxed">{body}</p>
          {credit.usedUsd != null && credit.capUsd ? (
            <div className="mt-3 max-w-xs">
              <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                <div
                  className="h-full rounded-full bg-amber-500"
                  style={{ width: `${Math.min(100, (credit.usedUsd / credit.capUsd) * 100)}%` }}
                />
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                ${credit.usedUsd} מתוך ${credit.capUsd}
              </div>
            </div>
          ) : null}
          {link && (
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-3 text-[12.5px] font-bold text-indigo-600 hover:text-indigo-700"
            >
              {link.label} ←
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- אנליטיקת מדלן ---------- */
function MadlanPanel({ m, closingPpsm }: { m: MadlanAnalytics; closingPpsm: number | null }) {
  const gap =
    m.pricePerSqm && closingPpsm
      ? Math.round(((m.pricePerSqm - closingPpsm) / closingPpsm) * 1000) / 10
      : null;
  const rooms = m.pricesByRooms.filter((r) => r.medianBuyPrice && /^\d+$/.test(r.rooms));

  return (
    <div className="glass-ios rounded-3xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <Activity size={18} className="text-indigo-500" />
        <h3 className="font-bold text-slate-800">מדלן — תמונת שוק עירונית</h3>
        <span className="ms-2 text-[11px] text-slate-400">{m.cityHebrew}</span>
      </div>
      <p className="text-[12px] text-slate-400 mb-4">
        נתוני מדלן הציבוריים — מחיר למ״ר, מגמה שנתית והיצע
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
          <div className="text-[12px] text-slate-500 mb-1">מחיר למ״ר</div>
          <div className="text-lg font-bold text-slate-800">{shekel(m.pricePerSqm)}</div>
          {gap != null && (
            <div className={`text-[11px] mt-1 font-semibold ${gap > 0 ? "text-amber-600" : "text-emerald-600"}`}>
              {gap > 0 ? "+" : ""}
              {gap}% מול הסגירה
            </div>
          )}
        </div>
        <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
          <div className="text-[12px] text-slate-500 mb-1">מגמה שנתית</div>
          <div
            className={`text-lg font-bold flex items-center gap-1 ${
              (m.yearlyChangePct ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600"
            }`}
          >
            {m.yearlyChangePct != null ? (
              <>
                {m.yearlyChangePct >= 0 ? <ArrowUpRight size={17} /> : <ArrowDownRight size={17} />}
                {Math.abs(m.yearlyChangePct)}%
              </>
            ) : (
              "—"
            )}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">{nf.format(m.yearlyDeals || 0)} עסקאות בשנה</div>
        </div>
        <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
          <div className="text-[12px] text-slate-500 mb-1">היצע למכירה</div>
          <div className="text-lg font-bold text-slate-800">{nf.format(m.bulletinsForSale || 0)}</div>
          <div className="text-[11px] text-slate-400 mt-1">{nf.format(m.bulletinsForRent || 0)} להשכרה</div>
        </div>
        <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
          <div className="text-[12px] text-slate-500 mb-1">מדד חברתי-כלכלי</div>
          <div className="text-lg font-bold text-slate-800">
            {m.socioeconomicIndex != null ? `${m.socioeconomicIndex}/10` : "—"}
          </div>
        </div>
      </div>

      {rooms.length > 0 && (
        <div className="mt-4">
          <div className="text-[12px] font-bold text-slate-600 mb-2">מחיר חציוני לפי חדרים (מדלן)</div>
          <div className="flex flex-wrap gap-2">
            {rooms.map((r) => (
              <div key={r.rooms} className="rounded-xl bg-white border border-slate-200 px-3 py-2">
                <span className="text-[12px] text-slate-500">{r.rooms} חד׳ · </span>
                <span className="text-[13px] font-bold text-slate-800">{shekel(r.medianBuyPrice)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LiveSourcesPanel({
  sources,
  loading,
  closingPrice,
  closingPpsm,
  madlan,
  fromCache,
  onRefresh,
}: {
  madlan?: MadlanAnalytics | null;
  fromCache?: boolean;
  onRefresh?: () => void;
  sources: BridgeResult[];
  loading: boolean;
  closingPrice: number;
  closingPpsm: number | null;
}) {
  return (
    <div className="glass-ios rounded-3xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <Scale size={18} className="text-indigo-500" />
        <h3 className="font-bold text-slate-800">מחירי מבוקש חיים — יד2 · יד1 · מדלן · פייסבוק</h3>
        {fromCache ? (
          <span
            className="ms-2 inline-flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5"
            title="הנתונים נלקחו מהמאגר השמור (שבועיים) — לא חויב קרדיט"
          >
            ⚡ הנתונים מהמאגר השמור · ללא חיוב
          </span>
        ) : (
          <span className="ms-2 inline-flex items-center gap-1 text-[11px] text-emerald-600">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> נשאב עכשיו
          </span>
        )}
        {onRefresh && !loading && (
          <button
            onClick={onRefresh}
            title="מתעלם מהמטמון ושואב מחדש — פעולה זו צורכת קרדיט"
            className="ms-auto text-[11.5px] font-bold text-slate-500 hover:text-indigo-600 transition"
          >
            רענן ↻
          </button>
        )}
      </div>
      <p className="text-[12px] text-slate-400 mb-4">
        {fromCache
          ? "העיר הזו כבר נשאבה — הנתונים מוגשים מהמאגר השמור (שבועיים) ואינם עולים כלום."
          : "נשאב אוטומטית מול מחיר הסגירה של רשות המסים"}
      </p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {["yad2", "yad1", "madlan", "facebook"].map((src) => {
          const r = sources.find((s) => s.source === src);
          // מדלן אינו מחזיר מודעות בודדות אלא אנליטיקה עירונית, ולכן הכרטיס
          // שלו נבנה מנתוני האנליטיקה ומפנה לפאנל המפורט שמתחת.
          if (src === "madlan") {
            const gapM =
              madlan?.pricePerSqm && closingPpsm
                ? Math.round(((madlan.pricePerSqm - closingPpsm) / closingPpsm) * 1000) / 10
                : null;
            return (
              <div key={src} className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
                <div className="text-[13px] font-bold text-slate-700 mb-1">מדלן</div>
                {madlan?.pricePerSqm ? (
                  <>
                    <div className="text-lg font-bold text-slate-800">{shekel(madlan.pricePerSqm)}</div>
                    <div className="text-[12px] text-slate-500">
                      למ״ר · {nf.format(madlan.bulletinsForSale || 0)} מודעות בעיר
                    </div>
                    <div className="text-[11px] mt-1 text-slate-400">אנליטיקה עירונית</div>
                    {gapM != null && (
                      <div
                        className={`text-[12px] mt-1 font-semibold ${
                          gapM > 0 ? "text-amber-600" : "text-emerald-600"
                        }`}
                      >
                        {gapM > 0 ? "+" : ""}
                        {gapM}% מול הסגירה
                      </div>
                    )}
                  </>
                ) : loading ? (
                  <div className="flex items-center gap-1.5 text-[12px] text-slate-400 mt-1">
                    <Loader2 size={13} className="animate-spin" /> שואב…
                  </div>
                ) : (
                  <div className="text-[12px] text-slate-400 mt-1">אין נתונים לעיר זו</div>
                )}
              </div>
            );
          }
          const gap =
            r?.medianPricePerSqm && closingPpsm
              ? Math.round(((r.medianPricePerSqm - closingPpsm) / closingPpsm) * 1000) / 10
              : null;
          return (
            <div key={src} className="rounded-2xl bg-slate-50 border border-slate-100 p-4">
              <div className="text-[13px] font-bold text-slate-700 mb-1">{SOURCE_LABEL[src]}</div>
              {r ? (
                <>
                  <div className="text-lg font-bold text-slate-800">{shekel(r.medianPrice)}</div>
                  <div className="text-[12px] text-slate-500">
                    {nf.format(r.count)} מודעות · {shekel(r.medianPricePerSqm)}/מ״ר
                  </div>
                  {r.scope === "street" ? (
                    <div className="text-[11px] mt-1 inline-flex items-center gap-1 text-emerald-600 font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> מדויק לפי רחוב
                    </div>
                  ) : r.scope === "city" ? (
                    <div className="text-[11px] mt-1 text-slate-400">רמת עיר</div>
                  ) : null}
                  {gap != null && (
                    <div className={`text-[12px] mt-1 font-semibold ${gap > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                      {gap > 0 ? "+" : ""}
                      {gap}% מעל הסגירה
                    </div>
                  )}
                </>
              ) : loading ? (
                <div className="flex items-center gap-1.5 text-[12px] text-slate-400 mt-1">
                  <Loader2 size={13} className="animate-spin" /> שואב…
                </div>
              ) : (
                <div className="text-[12px] text-slate-400 mt-1">
                  {src === "facebook" ? (
                    <span title="הפיד של Marketplace ארצי ולא ממוין לפי עיר, ולכן ערים רבות אינן מיוצגות בו">
                      לא נמצאו מודעות בעיר זו
                    </span>
                  ) : (
                    "אין נתונים"
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-400 mt-3">
        מחיר סגירה (רשות המסים): חציון {shekel(closingPrice)} · {shekel(closingPpsm)}/מ״ר. פייסבוק — הזנה ידנית.
      </p>
    </div>
  );
}

function ComparePanel({
  uploaded,
  closingMedianPrice,
  closingMedianPpsm,
  onClear,
}: {
  uploaded: UploadedData;
  closingMedianPrice: number;
  closingMedianPpsm: number | null;
  onClear: () => void;
}) {
  // פער מיקוח: כמה המחיר המבוקש גבוה ממחיר הסגירה בפועל
  const askPpsm = uploaded.medianPricePerSqm;
  const gapPct =
    askPpsm && closingMedianPpsm ? Math.round(((askPpsm - closingMedianPpsm) / closingMedianPpsm) * 1000) / 10 : null;
  const priceGapPct =
    uploaded.medianPrice && closingMedianPrice
      ? Math.round(((uploaded.medianPrice - closingMedianPrice) / closingMedianPrice) * 1000) / 10
      : null;

  return (
    <div className="glass-ios rounded-3xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Scale size={18} className="text-indigo-500" />
          <h3 className="font-bold text-slate-800">מבוקש מול סגירה — {uploaded.source}</h3>
        </div>
        <button onClick={onClear} className="text-slate-400 hover:text-slate-600" title="הסר">
          <X size={16} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-2xl bg-sky-50 border border-sky-100 p-4">
          <div className="text-[12px] text-sky-700 font-medium mb-1">מחיר מבוקש (מהקובץ)</div>
          <div className="text-xl font-bold text-slate-800">{shekel(uploaded.medianPrice)}</div>
          <div className="text-[12px] text-slate-500 mt-0.5">
            חציון · {nf.format(uploaded.count)} מודעות · {shekel(askPpsm)}/מ״ר
          </div>
        </div>
        <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-4">
          <div className="text-[12px] text-emerald-700 font-medium mb-1">מחיר סגירה (רשות המסים)</div>
          <div className="text-xl font-bold text-slate-800">{shekel(closingMedianPrice)}</div>
          <div className="text-[12px] text-slate-500 mt-0.5">חציון · {shekel(closingMedianPpsm)}/מ״ר</div>
        </div>
      </div>

      {gapPct != null && (
        <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4 text-center">
          <div className="text-[13px] text-slate-500">פער מיקוח (מבוקש מעל סגירה, למ״ר)</div>
          <div className={`text-2xl font-extrabold ${gapPct > 0 ? "text-amber-600" : "text-emerald-600"}`}>
            {gapPct > 0 ? "+" : ""}
            {gapPct}%
          </div>
          <p className="text-[12px] text-slate-500 mt-1">
            {gapPct > 0
              ? `בממוצע מבקשים כ-${gapPct}% מעל מה שבאמת נסגר. יש מקום למשא ומתן.`
              : `המחיר המבוקש קרוב או נמוך ממחיר הסגירה בפועל — שוק "חם".`}
            {priceGapPct != null && ` (פער במחיר הכולל: ${priceGapPct > 0 ? "+" : ""}${priceGapPct}%)`}
          </p>
        </div>
      )}
      <p className="text-[11px] text-slate-400 text-center mt-3">
        מחיר מבוקש מקורו בקובץ שהעלית (יד2/מדלן/ידני). מחיר סגירה מרשות המסים. השוואה אינדיקטיבית.
      </p>
    </div>
  );
}

function SocioPanel({ s }: { s: SocioEconomic }) {
  const tone =
    s.cluster <= 3
      ? { text: "text-rose-600", bg: "bg-rose-500" }
      : s.cluster <= 6
        ? { text: "text-amber-600", bg: "bg-amber-500" }
        : s.cluster <= 8
          ? { text: "text-emerald-600", bg: "bg-emerald-500" }
          : { text: "text-indigo-600", bg: "bg-indigo-600" };
  return (
    <div className="glass-ios rounded-3xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp size={18} className="text-indigo-500" />
        <h3 className="font-bold text-slate-800">מדד חברתי-כלכלי — {s.name}</h3>
      </div>
      <div className="flex items-baseline gap-2 mb-3">
        <span className={`text-3xl font-extrabold ${tone.text}`}>{s.cluster}</span>
        <span className="text-slate-400 text-sm">/ 10</span>
        <span className={`ms-2 font-bold ${tone.text}`}>{s.label}</span>
      </div>
      {/* סקאלה 1–10 */}
      <div className="flex gap-1">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <div
            key={n}
            className={`flex-1 h-2.5 rounded-full ${n <= s.cluster ? tone.bg : "bg-slate-200"}`}
            title={`אשכול ${n}`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-slate-400 mt-1.5">
        <span>1 · נמוך</span>
        <span>10 · גבוה</span>
      </div>
      <p className="text-[11px] text-slate-400 mt-3">
        מקור: הלשכה המרכזית לסטטיסטיקה (הלמ״ס) דרך data.gov.il · אשכול חברתי-כלכלי ברמת הרשות המקומית.
      </p>
    </div>
  );
}

function InvestmentPanel({ inv }: { inv: InvestmentAnalysis }) {
  const theme = {
    recommended: { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", dot: "bg-emerald-500", line: "#10b981" },
    neutral: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", dot: "bg-amber-500", line: "#f59e0b" },
    caution: { bg: "bg-rose-50", border: "border-rose-200", text: "text-rose-700", dot: "bg-rose-500", line: "#f43f5e" },
  }[inv.verdict];

  const up = inv.appreciationPerYear >= 0;

  return (
    <div className="glass-ios rounded-3xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Gauge size={18} className="text-indigo-500" />
        <h3 className="font-bold text-slate-800">מדד השקעה — מגמת הרחוב ב‑3 שנים</h3>
      </div>

      {/* המלצה */}
      <div className={`flex items-start gap-3 rounded-2xl ${theme.bg} ${theme.border} border px-4 py-3.5 mb-4`}>
        <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${theme.dot}`} />
        <div>
          <div className={`font-bold ${theme.text}`}>{inv.verdictLabel}</div>
          <p className="text-[13px] text-slate-600 mt-0.5 leading-relaxed">{inv.reason}</p>
        </div>
      </div>

      {/* מדדים */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <Metric
          icon={up ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
          label="עליית ערך שנתית"
          value={`${up ? "+" : ""}${inv.appreciationPerYear}%`}
          good={up}
        />
        <Metric icon={<Activity size={16} />} label="נזילות (עסקאות/חודש)" value={`${inv.dealsPerMonth}`} />
        <Metric icon={<Gauge size={16} />} label="תנודתיות" value={`${inv.volatility}%`} />
      </div>

      {/* גרף מגמה */}
      {inv.trend.length >= 2 && (
        <div className="h-56" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={inv.trend} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="period" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${Math.round(v / 1000)}k`}
              />
              <Tooltip
                formatter={(v: any) => ["₪" + new Intl.NumberFormat("he-IL").format(Math.round(v)), 'חציון למ״ר']}
                contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 13 }}
              />
              <Line type="monotone" dataKey="medianPricePerSqm" stroke={theme.line} strokeWidth={3} dot={{ r: 4, fill: theme.line }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="text-[11px] text-slate-400 text-center mt-2">
        המדד מבוסס על מגמת מחיר למ״ר בעסקאות אמת. אינדיקציה לתכנון בלבד — אינו ייעוץ השקעות.
      </p>
    </div>
  );
}

function Metric({ icon, label, value, good }: { icon: React.ReactNode; label: string; value: string; good?: boolean }) {
  const color = good === undefined ? "text-slate-700" : good ? "text-emerald-600" : "text-rose-600";
  return (
    <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3 text-center">
      <div className={`inline-flex items-center justify-center gap-1 ${color} font-bold text-lg`}>
        {icon}
        {value}
      </div>
      <div className="text-[11px] text-slate-400 mt-0.5 leading-tight">{label}</div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tint,
  small,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tint: "indigo" | "emerald" | "violet" | "sky";
  small?: boolean;
}) {
  const tints: Record<string, string> = {
    indigo: "bg-indigo-50 text-indigo-600",
    emerald: "bg-emerald-50 text-emerald-600",
    violet: "bg-violet-50 text-violet-600",
    sky: "bg-sky-50 text-sky-600",
  };
  return (
    <div className="glass-ios rounded-2xl p-4">
      <div className={`inline-grid place-items-center w-9 h-9 rounded-xl mb-2.5 ${tints[tint]}`}>{icon}</div>
      <div className="text-[12px] text-slate-400">{label}</div>
      <div className={`font-bold text-slate-800 ${small ? "text-[15px]" : "text-xl"}`}>{value}</div>
    </div>
  );
}
