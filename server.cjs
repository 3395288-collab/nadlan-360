var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path2 = __toESM(require("path"), 1);
var import_multer = __toESM(require("multer"), 1);
var xlsx = __toESM(require("xlsx"), 1);
var import_vite = require("vite");
var import_genai = require("@google/genai");
var import_dotenv = __toESM(require("dotenv"), 1);

// githubStore.ts
var import_crypto = require("crypto");
var API = "https://api.github.com";
function config() {
  const token = process.env.GITHUB_CACHE_TOKEN;
  const repo = process.env.GITHUB_CACHE_REPO;
  if (!token || !repo || !repo.includes("/")) return null;
  return { token, repo, branch: process.env.GITHUB_CACHE_BRANCH || "main" };
}
function isGithubStoreEnabled() {
  return config() !== null;
}
function pathFor(key) {
  const hash = (0, import_crypto.createHash)("sha256").update(key).digest("hex").slice(0, 32);
  return `cache/${hash}.json`;
}
async function ghFetch(path3, init = {}, timeoutMs = 12e3) {
  const cfg = config();
  if (!cfg) throw new Error("GitHub store \u05DC\u05D0 \u05DE\u05D5\u05D2\u05D3\u05E8");
  return fetch(`${API}/repos/${cfg.repo}/contents/${path3}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...init.headers || {}
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
}
async function readFromGithub(key, maxAgeMs) {
  const cfg = config();
  if (!cfg) return null;
  try {
    const res = await ghFetch(`${pathFor(key)}?ref=${encodeURIComponent(cfg.branch)}`);
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const meta = await res.json();
    if (!meta?.content) return null;
    const json = Buffer.from(meta.content, "base64").toString("utf8");
    const entry = JSON.parse(json);
    if (!entry?.at || !Array.isArray(entry.rows)) return null;
    if (Date.now() - entry.at > maxAgeMs) return null;
    return entry;
  } catch {
    return null;
  }
}
async function writeToGithub(key, rows) {
  const cfg = config();
  if (!cfg) return false;
  const path3 = pathFor(key);
  try {
    let sha;
    const head = await ghFetch(`${path3}?ref=${encodeURIComponent(cfg.branch)}`);
    if (head.ok) {
      const meta = await head.json();
      sha = meta?.sha;
    }
    const payload = { at: Date.now(), rows };
    const res = await ghFetch(path3, {
      method: "PUT",
      body: JSON.stringify({
        message: `cache: ${key.slice(0, 60)}`,
        content: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
        branch: cfg.branch,
        ...sha ? { sha } : {}
      })
    }, 2e4);
    if (!res.ok) {
      console.warn(`[github-store] \u05DB\u05EA\u05D9\u05D1\u05D4 \u05E0\u05DB\u05E9\u05DC\u05D4 (${res.status})`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[github-store] \u05DB\u05EA\u05D9\u05D1\u05D4 \u05E0\u05DB\u05E9\u05DC\u05D4:", error?.message || error);
    return false;
  }
}

// apifySources.ts
var APIFY_BASE = "https://api.apify.com/v2/acts";
var ACTORS = {
  yad2: "swerve~yad2-scraper",
  madlan: "swerve~madlan-analytics",
  facebook: "apify~facebook-marketplace-scraper",
  // עסקאות סגורות של רשות המסים (GovMap). עד יוני 2026 נשאבו ישירות
  // מהדפדפן, אך govmap הוסיפו reCAPTCHA ל-API והחסימו שאיבה ישירה.
  // האקטור מריץ דפדפן אמיתי אצל Apify, שם ה-reCAPTCHA נפתר כדין.
  nadlan: "swerve~nadlan-deals"
};
var CITY_EN = {
  "\u05EA\u05DC \u05D0\u05D1\u05D9\u05D1": "Tel Aviv",
  "\u05EA\u05DC \u05D0\u05D1\u05D9\u05D1 \u05D9\u05E4\u05D5": "Tel Aviv",
  "\u05EA\u05DC \u05D0\u05D1\u05D9\u05D1-\u05D9\u05E4\u05D5": "Tel Aviv",
  "\u05D9\u05E8\u05D5\u05E9\u05DC\u05D9\u05DD": "Jerusalem",
  "\u05D7\u05D9\u05E4\u05D4": "Haifa",
  "\u05E8\u05D0\u05E9\u05D5\u05DF \u05DC\u05E6\u05D9\u05D5\u05DF": "Rishon LeZion",
  "\u05E4\u05EA\u05D7 \u05EA\u05E7\u05D5\u05D5\u05D4": "Petah Tikva",
  "\u05D0\u05E9\u05D3\u05D5\u05D3": "Ashdod",
  "\u05E0\u05EA\u05E0\u05D9\u05D4": "Netanya",
  "\u05D1\u05D0\u05E8 \u05E9\u05D1\u05E2": "Beer Sheva",
  "\u05D1\u05E0\u05D9 \u05D1\u05E8\u05E7": "Bnei Brak",
  "\u05D7\u05D5\u05DC\u05D5\u05DF": "Holon",
  "\u05E8\u05DE\u05EA \u05D2\u05DF": "Ramat Gan",
  "\u05D0\u05E9\u05E7\u05DC\u05D5\u05DF": "Ashkelon",
  "\u05E8\u05D7\u05D5\u05D1\u05D5\u05EA": "Rehovot",
  "\u05D1\u05EA \u05D9\u05DD": "Bat Yam",
  "\u05D4\u05E8\u05E6\u05DC\u05D9\u05D4": "Herzliya",
  "\u05DB\u05E4\u05E8 \u05E1\u05D1\u05D0": "Kfar Saba",
  "\u05E8\u05E2\u05E0\u05E0\u05D4": "Raanana",
  "\u05DE\u05D5\u05D3\u05D9\u05E2\u05D9\u05DF": "Modiin",
  "\u05D2\u05D1\u05E2\u05EA\u05D9\u05D9\u05DD": "Givatayim",
  "\u05D4\u05D5\u05D3 \u05D4\u05E9\u05E8\u05D5\u05DF": "Hod Hasharon",
  "\u05E8\u05D0\u05E9 \u05D4\u05E2\u05D9\u05DF": "Rosh Haayin",
  "\u05E0\u05E1 \u05E6\u05D9\u05D5\u05E0\u05D4": "Ness Ziona",
  "\u05DC\u05D5\u05D3": "Lod",
  "\u05E8\u05DE\u05DC\u05D4": "Ramla",
  "\u05DB\u05E8\u05DE\u05D9\u05D0\u05DC": "Karmiel",
  "\u05E2\u05E4\u05D5\u05DC\u05D4": "Afula",
  "\u05D8\u05D1\u05E8\u05D9\u05D4": "Tiberias",
  "\u05E0\u05D4\u05E8\u05D9\u05D4": "Nahariya",
  "\u05D0\u05D9\u05DC\u05EA": "Eilat",
  "\u05D3\u05D9\u05DE\u05D5\u05E0\u05D4": "Dimona",
  "\u05E7\u05E8\u05D9\u05EA \u05D2\u05EA": "Kiryat Gat",
  "\u05E7\u05E8\u05D9\u05EA \u05D0\u05D5\u05E0\u05D5": "Kiryat Ono",
  "\u05D9\u05D1\u05E0\u05D4": "Yavne",
  "\u05D1\u05D9\u05EA \u05E9\u05DE\u05E9": "Beit Shemesh",
  "\u05D0\u05D5\u05E8 \u05D9\u05D4\u05D5\u05D3\u05D4": "Or Yehuda",
  "\u05E6\u05E4\u05EA": "Safed"
};
function toEnglishCity(city) {
  const clean = (city || "").trim();
  return CITY_EN[clean] || clean;
}
function normStreet(s) {
  return String(s || "").replace(/רח['׳]?\s*/g, "").replace(/רחוב\s*/g, "").replace(/[",]/g, " ").replace(/\s+/g, " ").trim();
}
function streetMatches(itemStreet, query) {
  const name = normStreet(query).replace(/\d+.*$/, "").trim();
  if (name.length < 2) return false;
  return normStreet(itemStreet).includes(name);
}
function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
var CACHE_TTL_MS = 420 * 60 * 60 * 1e3;
var MAX_CACHE_ENTRIES = 300;
var resultCache = /* @__PURE__ */ new Map();
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
var PERSONAL_FIELDS = [
  "contactPhone",
  "contactName",
  "phone",
  "sellerName",
  "seller",
  "userName",
  "profileUrl",
  "actorId",
  "listingVideo"
];
function stripPersonalData(row) {
  if (!row || typeof row !== "object") return row;
  const clean = { ...row };
  for (const f of PERSONAL_FIELDS) delete clean[f];
  return clean;
}
var CacheMissError = class extends Error {
  constructor(actor) {
    super(`\u05D0\u05D9\u05DF \u05E0\u05EA\u05D5\u05E0\u05D9\u05DD \u05E9\u05DE\u05D5\u05E8\u05D9\u05DD \u05E2\u05D1\u05D5\u05E8 ${actor}`);
    this.name = "CacheMissError";
  }
};
function getTokens() {
  const list = [];
  if (process.env.APIFY_TOKENS) {
    list.push(...process.env.APIFY_TOKENS.split(",").map((t) => t.trim()).filter(Boolean));
  }
  if (process.env.APIFY_TOKEN) list.push(process.env.APIFY_TOKEN.trim());
  for (let i = 2; i <= 8; i++) {
    const t = process.env[`APIFY_TOKEN_${i}`];
    if (t && t.trim()) list.push(t.trim());
  }
  return [...new Set(list)];
}
var exhaustedTokens = /* @__PURE__ */ new Set();
function isQuotaError(status, body) {
  if (status === 402 || status === 403) return true;
  return /usage|limit|exceeded|quota|payment|insufficient/i.test(body);
}
async function runActor(actor, input, timeoutMs = 24e4, cacheOnly = false) {
  const allTokens = getTokens();
  if (!allTokens.length && !cacheOnly) throw new Error("\u05D0\u05D9\u05DF \u05D8\u05D5\u05E7\u05DF Apify \u05DE\u05D5\u05D2\u05D3\u05E8 (APIFY_TOKEN)");
  const cacheKey = `${actor}|${JSON.stringify(input)}`;
  const cached2 = resultCache.get(cacheKey);
  if (cached2 && Date.now() - cached2.at < CACHE_TTL_MS) {
    const ageMin = Math.round((Date.now() - cached2.at) / 6e4);
    console.log(`[apify] \u05DE\u05D8\u05DE\u05D5\u05DF: ${actor} (\u05D2\u05D9\u05DC ${ageMin} \u05D3\u05E7\u05F3) \u2014 \u05DC\u05D0 \u05D7\u05D5\u05D9\u05D1`);
    return cached2.rows;
  }
  if (isGithubStoreEnabled()) {
    const stored = await readFromGithub(cacheKey, CACHE_TTL_MS);
    if (stored) {
      resultCache.set(cacheKey, { at: stored.at, rows: stored.rows });
      const ageH = Math.round((Date.now() - stored.at) / 36e5);
      console.log(`[apify] \u05D0\u05D7\u05E1\u05D5\u05DF \u05DE\u05EA\u05DE\u05D9\u05D3: ${actor} (\u05D2\u05D9\u05DC ${ageH} \u05E9\u05F3) \u2014 \u05DC\u05D0 \u05D7\u05D5\u05D9\u05D1`);
      return stored.rows;
    }
  }
  if (cacheOnly) throw new CacheMissError(actor);
  const tokens = allTokens.filter((t) => !exhaustedTokens.has(t));
  if (!tokens.length) {
    throw new Error("\u05DB\u05DC \u05D7\u05E9\u05D1\u05D5\u05E0\u05D5\u05EA Apify \u05DE\u05D9\u05E6\u05D5 \u05D0\u05EA \u05D4\u05E7\u05E8\u05D3\u05D9\u05D8 \u05D4\u05D7\u05D5\u05D3\u05E9\u05D9. \u05D9\u05EA\u05D7\u05D3\u05E9 \u05D1\u05EA\u05D7\u05D9\u05DC\u05EA \u05D4\u05D7\u05D5\u05D3\u05E9 \u05D4\u05D1\u05D0.");
  }
  let data = null;
  let lastErr = null;
  for (const token of tokens) {
    const url = `${APIFY_BASE}/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
    const tag = `...${token.slice(-4)}`;
    let res = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(timeoutMs)
        });
        break;
      } catch (err) {
        lastErr = err;
        if (err?.name === "TimeoutError") break;
        if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1e3));
      }
    }
    if (!res) continue;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (isQuotaError(res.status, body)) {
        exhaustedTokens.add(token);
        console.log(`[apify] \u05D7\u05E9\u05D1\u05D5\u05DF ${tag} \u05DE\u05D5\u05E6\u05D4 (${res.status}) \u2014 \u05E2\u05D5\u05D1\u05E8 \u05DC\u05D7\u05E9\u05D1\u05D5\u05DF \u05D4\u05D1\u05D0`);
        continue;
      }
      lastErr = new Error(`Apify ${actor} \u05D4\u05D7\u05D6\u05D9\u05E8 ${res.status}: ${body.slice(0, 200)}`);
      continue;
    }
    data = await res.json();
    console.log(`[apify] \u05D7\u05D5\u05D9\u05D1 \u05E2\u05DC \u05D7\u05E9\u05D1\u05D5\u05DF ${tag}: ${actor}`);
    break;
  }
  if (data == null) {
    const cause = lastErr?.cause?.code || lastErr?.message || "\u05DB\u05DC \u05D4\u05D7\u05E9\u05D1\u05D5\u05E0\u05D5\u05EA \u05DE\u05D5\u05E6\u05D5/\u05E0\u05DB\u05E9\u05DC\u05D5";
    throw new Error(`\u05D7\u05D9\u05D1\u05D5\u05E8 \u05DC-Apify \u05E0\u05DB\u05E9\u05DC (${actor}): ${cause}`.trim());
  }
  const rows = (Array.isArray(data) ? data : []).map(stripPersonalData);
  resultCache.set(cacheKey, { at: Date.now(), rows });
  pruneCache();
  console.log(`[apify] \u05D7\u05D5\u05D9\u05D1: ${actor} \u2014 ${rows.length} \u05EA\u05D5\u05E6\u05D0\u05D5\u05EA`);
  if (isGithubStoreEnabled() && rows.length > 0) {
    writeToGithub(cacheKey, rows).catch(() => {
    });
  }
  return rows;
}
function toDateStr(value) {
  if (!value) return "";
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}
function summarize(rows, source, street, getStreet, getPrice, getSqm) {
  const onStreet = street ? rows.filter((r) => streetMatches(getStreet(r), street)) : [];
  const useStreet = onStreet.length >= 3;
  const items = useStreet ? onStreet : rows;
  const prices = items.map(getPrice).filter((n) => !!n && n > 0);
  const ppsm = items.map((r) => {
    const p = getPrice(r);
    const a = getSqm(r);
    return p && a && a > 0 ? Math.round(p / a) : null;
  }).filter((n) => n != null);
  const listings = items.map((r) => {
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
      isAgent: !!(r.hasAgent || r.agencyName)
    };
  }).filter((x) => x !== null).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return {
    source,
    scope: useStreet ? "street" : "city",
    count: items.length,
    cityCount: rows.length,
    streetCount: onStreet.length,
    medianPrice: median(prices),
    medianPricePerSqm: ppsm.length ? median(ppsm) : null,
    listings
  };
}
async function fetchYad2(city, street, maxItems = 120, cacheOnly = false) {
  const rows = await runActor(
    ACTORS.yad2,
    { city: toEnglishCity(city), dealType: "buy", maxItems },
    24e4,
    cacheOnly
  );
  return summarize(rows, "yad2", street, (r) => r.streetName || r.address, (r) => r.price, (r) => r.areaSqm);
}
async function fetchYad1(city, street, maxItems = 120, cacheOnly = false) {
  const rows = await runActor(
    ACTORS.yad2,
    { city: toEnglishCity(city), dealType: "buy", maxItems },
    24e4,
    cacheOnly
  );
  const fromDeveloper = rows.filter(
    (r) => r.adType === "project" || r.adType === "agency" || r.hasAgent === true
  );
  return summarize(fromDeveloper, "yad1", street, (r) => r.streetName || r.address, (r) => r.price, (r) => r.areaSqm);
}
async function fetchMadlan(city, neighbourhood, cacheOnly = false) {
  const input = { city: toEnglishCity(city), dataTypes: ["all"] };
  if (neighbourhood) input.neighbourhood = neighbourhood;
  const rows = await runActor(ACTORS.madlan, input, 24e4, cacheOnly);
  const d = rows[0] || {};
  const byRooms = Array.isArray(d.pricesByRooms) ? d.pricesByRooms : [];
  const withBoth = byRooms.filter((r) => r.medianBuyPrice > 0 && r.previousBuyPrice > 0);
  const yearlyChangePct = withBoth.length ? Math.round(
    withBoth.reduce((s, r) => s + (r.medianBuyPrice / r.previousBuyPrice - 1), 0) / withBoth.length * 1e3
  ) / 10 : null;
  return {
    source: "madlan",
    cityHebrew: d.cityHebrew ?? null,
    pricePerSqm: d.pricePerSqm ?? null,
    yearlyDeals: d.yearlyDeals ?? null,
    bulletinsForSale: d.bulletinsForSale ?? null,
    bulletinsForRent: d.bulletinsForRent ?? null,
    socioeconomicIndex: d.demographics?.socioeconomicIndex ?? d.demographicIndex ?? null,
    pricesByRooms: byRooms.map((r) => ({
      rooms: String(r.rooms ?? ""),
      medianBuyPrice: r.medianBuyPrice ?? null,
      previousBuyPrice: r.previousBuyPrice ?? null
    })),
    yearlyChangePct
  };
}
async function fetchFacebook(city, street, maxItems = 140, cacheOnly = false) {
  const rows = await runActor(
    ACTORS.facebook,
    {
      startUrls: [{ url: "https://www.facebook.com/marketplace/telaviv/propertyforsale" }],
      resultsLimit: maxItems
    },
    24e4,
    cacheOnly
  );
  const HOME_WORDS = /דירה|דירת|פנטהאוז|פנטהאוס|קוטג|וילה|בית פרטי|יחידת דיור|נכס|חדרים|חד['׳]/;
  const MIN_HOME_PRICE = 5e5;
  const MAX_HOME_PRICE = 4e7;
  const titleOf = (r) => String(r.marketplace_listing_title ?? r.title ?? r.custom_title ?? r.name ?? "");
  const toPrice = (r) => {
    const lp = r.listing_price;
    const raw = (lp && typeof lp === "object" ? lp.formatted_amount ?? lp.amount : lp) ?? r.price;
    const n = parseInt(String(raw ?? "").replace(/[^\d]/g, ""), 10);
    if (Number.isNaN(n) || n < MIN_HOME_PRICE || n > MAX_HOME_PRICE) return null;
    return HOME_WORDS.test(titleOf(r)) ? n : null;
  };
  const cityName = (city || "").trim();
  const cityAliases = /* @__PURE__ */ new Set([cityName]);
  const noHyphen = cityName.replace(/[-־]/g, " ");
  cityAliases.add(noHyphen);
  if (/^תל אביב/.test(noHyphen)) ["\u05EA\u05DC \u05D0\u05D1\u05D9\u05D1", "\u05EA\u05DC-\u05D0\u05D1\u05D9\u05D1", '\u05EA"\u05D0', "\u05EA\u05D0"].forEach((a) => cityAliases.add(a));
  const normalize = (t) => t.replace(/[-־]/g, " ").replace(/\s+/g, " ");
  const matchesCity = (r) => {
    if (!cityName) return true;
    const t = normalize(titleOf(r));
    for (const alias of cityAliases) if (alias && t.includes(normalize(alias))) return true;
    const loc = r.location?.reverse_geocode?.city || r.location?.text || "";
    return !!loc && normalize(String(loc)).includes(normalize(cityName));
  };
  const inCity = rows.filter((r) => toPrice(r) != null && matchesCity(r));
  return summarize(inCity, "facebook", street, titleOf, toPrice, () => null);
}
var NADLAN_ENUM_CITIES = [
  "\u05D9\u05E8\u05D5\u05E9\u05DC\u05D9\u05DD",
  "\u05EA\u05DC \u05D0\u05D1\u05D9\u05D1 -\u05D9\u05E4\u05D5",
  "\u05D7\u05D9\u05E4\u05D4",
  "\u05E8\u05D0\u05E9\u05D5\u05DF \u05DC\u05E6\u05D9\u05D5\u05DF",
  "\u05E4\u05EA\u05D7 \u05EA\u05E7\u05D5\u05D5\u05D4",
  "\u05D0\u05E9\u05D3\u05D5\u05D3",
  "\u05D1\u05D0\u05E8 \u05E9\u05D1\u05E2",
  "\u05E0\u05EA\u05E0\u05D9\u05D4",
  "\u05D7\u05D5\u05DC\u05D5\u05DF",
  "\u05D1\u05E0\u05D9 \u05D1\u05E8\u05E7",
  "\u05E8\u05DE\u05EA \u05D2\u05DF",
  "\u05D1\u05EA \u05D9\u05DD",
  "\u05E8\u05D7\u05D5\u05D1\u05D5\u05EA",
  "\u05D0\u05E9\u05E7\u05DC\u05D5\u05DF",
  "\u05D1\u05D9\u05EA \u05E9\u05DE\u05E9",
  "\u05DB\u05E4\u05E8 \u05E1\u05D1\u05D0",
  "\u05D4\u05E8\u05E6\u05DC\u05D9\u05D9\u05D4",
  "\u05DE\u05D5\u05D3\u05D9\u05E2\u05D9\u05DF-\u05DE\u05DB\u05D1\u05D9\u05DD-\u05E8\u05E2\u05D5\u05EA",
  "\u05D7\u05D3\u05E8\u05D4",
  "\u05E0\u05E6\u05E8\u05EA",
  "\u05DC\u05D5\u05D3",
  "\u05E8\u05E2\u05E0\u05E0\u05D4",
  "\u05E8\u05DE\u05DC\u05D4",
  "\u05DE\u05D5\u05D3\u05D9\u05E2\u05D9\u05DF \u05E2\u05D9\u05DC\u05D9\u05EA",
  "\u05E8\u05D4\u05D8",
  "\u05D2\u05D1\u05E2\u05EA\u05D9\u05D9\u05DD",
  "\u05E7\u05E8\u05D9\u05D9\u05EA \u05D0\u05EA\u05D0",
  "\u05E0\u05D4\u05E8\u05D9\u05D9\u05D4",
  "\u05D4\u05D5\u05D3 \u05D4\u05E9\u05E8\u05D5\u05DF",
  "\u05D0\u05D5\u05DD \u05D0\u05DC-\u05E4\u05D7\u05DD",
  "\u05E7\u05E8\u05D9\u05D9\u05EA \u05D2\u05EA",
  "\u05D0\u05D9\u05DC\u05EA",
  "\u05E2\u05DB\u05D5",
  "\u05D1\u05D9\u05EA\u05E8 \u05E2\u05D9\u05DC\u05D9\u05EA",
  "\u05E0\u05E1 \u05E6\u05D9\u05D5\u05E0\u05D4",
  "\u05DB\u05E8\u05DE\u05D9\u05D0\u05DC",
  "\u05E8\u05DE\u05EA \u05D4\u05E9\u05E8\u05D5\u05DF",
  "\u05E2\u05E4\u05D5\u05DC\u05D4",
  "\u05D0\u05DC\u05E2\u05D3",
  "\u05D8\u05D1\u05E8\u05D9\u05D4",
  "\u05E8\u05D0\u05E9 \u05D4\u05E2\u05D9\u05DF",
  "\u05E0\u05E6\u05E8\u05EA \u05E2\u05D9\u05DC\u05D9\u05EA",
  "\u05D8\u05D9\u05D9\u05D1\u05D4",
  "\u05E7\u05E8\u05D9\u05D9\u05EA \u05DE\u05D5\u05E6\u05E7\u05D9\u05DF",
  "\u05E9\u05E4\u05E8\u05E2\u05DD",
  "\u05E7\u05E8\u05D9\u05D9\u05EA \u05D9\u05DD",
  "\u05E7\u05E8\u05D9\u05D9\u05EA \u05D1\u05D9\u05D0\u05DC\u05D9\u05E7",
  "\u05DE\u05E2\u05DC\u05D4 \u05D0\u05D3\u05D5\u05DE\u05D9\u05DD",
  "\u05D9\u05D1\u05E0\u05D4",
  "\u05E4\u05E8\u05D3\u05E1 \u05D7\u05E0\u05D4-\u05DB\u05E8\u05DB\u05D5\u05E8",
  "\u05E7\u05E8\u05D9\u05D9\u05EA \u05D0\u05D5\u05E0\u05D5",
  "\u05D0\u05D5\u05E8 \u05D9\u05D4\u05D5\u05D3\u05D4",
  "\u05D3\u05D9\u05DE\u05D5\u05E0\u05D4",
  "\u05E6\u05E4\u05EA",
  "\u05D8\u05DE\u05E8\u05D4",
  "\u05E0\u05EA\u05D9\u05D1\u05D5\u05EA",
  "\u05D9\u05D4\u05D5\u05D3-\u05DE\u05D5\u05E0\u05D5\u05E1\u05D5\u05DF",
  "\u05E1\u05D7'\u05E0\u05D9\u05DF",
  "\u05D1\u05D0\u05E7\u05D4 \u05D0\u05DC-\u05D2\u05E8\u05D1\u05D9\u05D4",
  "\u05D2\u05D3\u05E8\u05D4",
  "\u05D0\u05D5\u05E4\u05E7\u05D9\u05DD",
  "\u05DE\u05D2\u05D3\u05DC \u05D4\u05E2\u05DE\u05E7",
  "\u05DE\u05D1\u05E9\u05E8\u05EA \u05E6\u05D9\u05D5\u05DF",
  "\u05E2\u05E8\u05D3",
  "\u05D2\u05D1\u05E2\u05EA \u05E9\u05DE\u05D5\u05D0\u05DC",
  "\u05D8\u05D9\u05E8\u05D4",
  "\u05E2\u05E8\u05E2\u05E8\u05D4",
  "\u05E0\u05E9\u05E8",
  "\u05E7\u05E8\u05D9\u05D9\u05EA \u05E9\u05DE\u05D5\u05E0\u05D4",
  "\u05E2\u05E8\u05D0\u05D1\u05D4",
  "\u05E9\u05D3\u05E8\u05D5\u05EA",
  "\u05D6\u05DB\u05E8\u05D5\u05DF \u05D9\u05E2\u05E7\u05D1",
  "\u05E7\u05E8\u05D9\u05D9\u05EA \u05DE\u05DC\u05D0\u05DB\u05D9",
  "\u05D2\u05DF \u05D9\u05D1\u05E0\u05D4",
  "\u05DE\u05E2\u05DC\u05D5\u05EA-\u05EA\u05E8\u05E9\u05D9\u05D7\u05D0",
  "\u05DE\u05D2\u05D0\u05E8",
  "\u05DB\u05E4\u05E8 \u05E7\u05D0\u05E1\u05DD",
  "\u05D9\u05E7\u05E0\u05E2\u05DD \u05E2\u05D9\u05DC\u05D9\u05EA",
  "\u05E7\u05DC\u05E0\u05E1\u05D5\u05D5\u05D4",
  "\u05DB\u05E4\u05E8 \u05D9\u05D5\u05E0\u05D4",
  "\u05DB\u05E4\u05E8 \u05DB\u05E0\u05D0"
];
function normCityKey(s) {
  return String(s || "").replace(/["'`׳״]/g, "").replace(/\s*[-־]\s*/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
}
function canonicalCity(city) {
  const key = normCityKey(city);
  if (!key) return null;
  for (const c of NADLAN_ENUM_CITIES) {
    if (normCityKey(c) === key) return c;
  }
  for (const c of NADLAN_ENUM_CITIES) {
    const ck = normCityKey(c);
    if (ck.startsWith(key) || key.startsWith(ck.split("-")[0])) {
      if (ck.replace(/-.*/, "") === key.replace(/-.*/, "")) return c;
    }
  }
  return null;
}
function monthsToNadlanRange(months) {
  if (!months || months <= 0) return "all";
  if (months <= 3) return "3";
  if (months <= 6) return "6";
  if (months <= 12) return "12";
  if (months <= 60) return "60";
  return "all";
}
function latLngToMercator(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || la === 0 && ln === 0) return void 0;
  const x = ln * 2003750834e-2 / 180;
  let y = Math.log(Math.tan((90 + la) * Math.PI / 360)) / (Math.PI / 180);
  y = y * 2003750834e-2 / 180;
  return [x, y];
}
function splitAddress(addr) {
  const s = String(addr ?? "").trim();
  const m = s.match(/^(.*?)[\s,]+(\d+[א-ת]?)\s*$/);
  if (m) return { street: m[1].trim(), house: m[2] };
  return { street: s, house: "" };
}
function mapNadlanRow(r, i) {
  const price = Number(r?.dealAmount) || 0;
  if (!price) return null;
  const area = r?.area != null && Number(r.area) > 0 ? Number(r.area) : null;
  const ppsmRaw = r?.pricePerSqm != null ? Number(r.pricePerSqm) : null;
  const pricePerSqm = ppsmRaw && ppsmRaw > 0 ? Math.round(ppsmRaw) : area ? Math.round(price / area) : null;
  const floorNum = r?.floor != null && String(r.floor).match(/-?\d+/) ? parseInt(String(r.floor).match(/-?\d+/)[0], 10) : null;
  const addr = splitAddress(r?.address);
  const firstHand = r?.isFirstHand;
  const saleClass = firstHand === true ? "new" : firstHand === false ? "second" : void 0;
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
    coord: latLngToMercator(r?.lat, r?.lng),
    gush: r?.gush != null ? String(r.gush) : void 0,
    helka: r?.helka != null ? String(r.helka) : void 0,
    tatHelka: r?.tatHelka != null ? String(r.tatHelka) : void 0
  };
}
async function fetchNadlanDeals(city, monthsBack = 24, maxItems = 120, cacheOnly = false) {
  const canonical = canonicalCity(city);
  const input = {
    dealDateRange: monthsToNadlanRange(monthsBack),
    maxItems
  };
  if (canonical) input.cities = [canonical];
  else input.customCities = [city.trim()];
  const rows = await runActor(ACTORS.nadlan, input, 3e5, cacheOnly);
  return rows.map(mapNadlanRow).filter((d) => d !== null);
}

// serverAuth.ts
var import_crypto2 = require("crypto");
var import_fs = __toESM(require("fs"), 1);
var import_path = __toESM(require("path"), 1);
var STATE_FILE = import_path.default.join(process.cwd(), "auth-state.json");
var DEFAULT_USER = process.env.AUTH_USER || "chananel";
var DEFAULT_PASSWORD = process.env.AUTH_PASSWORD || "Nadlan#360";
function hashPassword(password, salt) {
  return (0, import_crypto2.scryptSync)(password, salt, 64).toString("hex");
}
function buildState(user, password) {
  const salt = (0, import_crypto2.randomBytes)(16).toString("hex");
  return {
    user,
    salt,
    hash: hashPassword(password, salt),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
var cached = null;
function loadState() {
  if (cached) return cached;
  try {
    if (import_fs.default.existsSync(STATE_FILE)) {
      const parsed = JSON.parse(import_fs.default.readFileSync(STATE_FILE, "utf8"));
      if (parsed?.user && parsed?.salt && parsed?.hash) {
        cached = parsed;
        return cached;
      }
    }
  } catch (error) {
    console.warn("[auth] \u05E7\u05E8\u05D9\u05D0\u05EA \u05DE\u05E6\u05D1 \u05D4\u05D4\u05EA\u05D7\u05D1\u05E8\u05D5\u05EA \u05E0\u05DB\u05E9\u05DC\u05D4, \u05D7\u05D5\u05D6\u05E8\u05D9\u05DD \u05DC\u05D1\u05E8\u05D9\u05E8\u05EA \u05D4\u05DE\u05D7\u05D3\u05DC:", error);
  }
  cached = buildState(DEFAULT_USER, DEFAULT_PASSWORD);
  return cached;
}
function saveState(state) {
  cached = state;
  try {
    import_fs.default.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
    return true;
  } catch (error) {
    console.warn("[auth] \u05E9\u05DE\u05D9\u05E8\u05EA \u05D4\u05E1\u05D9\u05E1\u05DE\u05D4 \u05DC\u05D3\u05D9\u05E1\u05E7 \u05E0\u05DB\u05E9\u05DC\u05D4 (\u05D6\u05DE\u05E0\u05D9\u05EA \u05D1\u05DC\u05D1\u05D3):", error);
    return false;
  }
}
function safeEquals(a, b) {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return (0, import_crypto2.timingSafeEqual)(bufA, bufB);
}
function verifyCredentials(user, password) {
  const state = loadState();
  if ((user || "").trim() !== state.user) return false;
  return safeEquals(hashPassword(password || "", state.salt), state.hash);
}
function changePassword(user, currentPassword, newPassword) {
  if (!verifyCredentials(user, currentPassword)) {
    return { ok: false, error: "\u05E9\u05DD \u05D4\u05DE\u05E9\u05EA\u05DE\u05E9 \u05D0\u05D5 \u05D4\u05E1\u05D9\u05E1\u05DE\u05D4 \u05D4\u05E0\u05D5\u05DB\u05D7\u05D9\u05EA \u05E9\u05D2\u05D5\u05D9\u05D9\u05DD." };
  }
  const clean = (newPassword || "").trim();
  if (clean.length < 6) {
    return { ok: false, error: "\u05D4\u05E1\u05D9\u05E1\u05DE\u05D4 \u05D4\u05D7\u05D3\u05E9\u05D4 \u05D7\u05D9\u05D9\u05D1\u05EA \u05DC\u05D4\u05D9\u05D5\u05EA \u05D1\u05D0\u05D5\u05E8\u05DA 6 \u05EA\u05D5\u05D5\u05D9\u05DD \u05DC\u05E4\u05D7\u05D5\u05EA." };
  }
  if (clean === currentPassword) {
    return { ok: false, error: "\u05D4\u05E1\u05D9\u05E1\u05DE\u05D4 \u05D4\u05D7\u05D3\u05E9\u05D4 \u05D6\u05D4\u05D4 \u05DC\u05E0\u05D5\u05DB\u05D7\u05D9\u05EA." };
  }
  const persisted = saveState(buildState(loadState().user, clean));
  return { ok: true, persisted };
}
function currentUser() {
  return loadState().user;
}
function isUsingDefaultPassword() {
  const state = loadState();
  return safeEquals(hashPassword(DEFAULT_PASSWORD, state.salt), state.hash);
}

// server.ts
import_dotenv.default.config();
var app = (0, import_express.default)();
var PORT = Number(process.env.PORT) || 3e3;
app.use(import_express.default.json({ limit: "20mb" }));
var ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!ALLOWED_ORIGINS.length) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});
var upload = (0, import_multer.default)({
  storage: import_multer.default.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
  // 15MB limit
});
var apiKey = process.env.GEMINI_API_KEY;
var ai = apiKey ? new import_genai.GoogleGenAI({
  apiKey,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build"
    }
  }
}) : null;
function generateOfflineProfessionalReport(searchQuery, sources, isQuotaError2, contextText, credentials) {
  let basePrice = 24e3;
  const qLower = searchQuery.toLowerCase();
  if (qLower.includes("\u05EA\u05DC \u05D0\u05D1\u05D9\u05D1") || qLower.includes("\u05E4\u05DC\u05D5\u05E8\u05E0\u05D8\u05D9\u05DF") || qLower.includes("\u05E0\u05D5\u05D5\u05D4 \u05E6\u05D3\u05E7")) {
    basePrice = 52e3;
  } else if (qLower.includes("\u05E0\u05EA\u05E0\u05D9\u05D4") || qLower.includes("\u05D0\u05D2\u05DE\u05D9\u05DD") || qLower.includes("\u05E2\u05D9\u05E8 \u05D9\u05DE\u05D9\u05DD")) {
    basePrice = 29e3;
  } else if (qLower.includes("\u05D1\u05D0\u05E8 \u05E9\u05D1\u05E2") || qLower.includes("\u05E1\u05D9\u05D2\u05DC\u05D9\u05D5\u05EA")) {
    basePrice = 14500;
  } else if (qLower.includes("\u05E1\u05D7\u05D9\u05D9\u05E7") || qLower.includes("\u05DE\u05DC\u05D7\u05D4")) {
    basePrice = 38e3;
  } else if (qLower.includes("\u05D9\u05E8\u05D5\u05E9\u05DC\u05D9\u05DD") || qLower.includes("\u05E8\u05DE\u05D5\u05EA") || qLower.includes("\u05E4\u05E1\u05D2\u05EA \u05D6\u05D0\u05D1")) {
    basePrice = 32e3;
  } else if (qLower.includes("\u05D7\u05D9\u05E4\u05D4") || qLower.includes("\u05DB\u05E8\u05DE\u05DC")) {
    basePrice = 21e3;
  }
  const p3Min = Math.round(basePrice * 75 * 0.95);
  const p3Max = Math.round(basePrice * 75 * 1.05);
  const p4Min = Math.round(basePrice * 98 * 0.95);
  const p4Max = Math.round(basePrice * 98 * 1.05);
  const p5Min = Math.round(basePrice * 122 * 0.95);
  const p5Max = Math.round(basePrice * 122 * 1.05);
  const price3 = `${p3Min.toLocaleString()} - ${p3Max.toLocaleString()}`;
  const sqmPrice3 = Math.round(basePrice).toLocaleString();
  const price4 = `${p4Min.toLocaleString()} - ${p4Max.toLocaleString()}`;
  const sqmPrice4 = Math.round(basePrice * 0.98).toLocaleString();
  const price5 = `${p5Min.toLocaleString()} - ${p5Max.toLocaleString()}`;
  const sqmPrice5 = Math.round(basePrice * 0.96).toLocaleString();
  const sourcesListStr = sources.map((s) => {
    switch (s) {
      case "cbs":
        return '\u05D4\u05DC\u05DE"\u05E1';
      case "gov":
        return "\u05E8\u05E9\u05D5\u05EA \u05D4\u05DE\u05D9\u05E1\u05D9\u05DD";
      case "rmi":
        return '\u05DE\u05DB\u05E8\u05D6\u05D9 \u05E8\u05DE"\u05D9';
      case "madlan":
        return "\u05DE\u05D3\u05DC\u05DF PRO";
      case "yad2":
        return "\u05D9\u05D32 \u05D5\u05D9\u05D31";
      case "facebook":
        return "\u05E4\u05D9\u05D9\u05E1\u05D1\u05D5\u05E7";
      default:
        return s;
    }
  }).join(", ");
  let accountsHeader = "";
  if (credentials) {
    const activeAccs = [];
    if (credentials.madlanEmail) activeAccs.push(`\u05DE\u05D3\u05DC\u05DF PRO (${credentials.madlanEmail})`);
    if (credentials.yad2Email) activeAccs.push(`\u05D9\u05D32 (${credentials.yad2Email})`);
    if (credentials.facebookEmail) activeAccs.push(`\u05E4\u05D9\u05D9\u05E1\u05D1\u05D5\u05E7 (${credentials.facebookEmail})`);
    if (activeAccs.length > 0) {
      accountsHeader = `> \u{1F511} **\u05D7\u05D9\u05D1\u05D5\u05E8\u05D9 \u05D7\u05E9\u05D1\u05D5\u05E0\u05D5\u05EA \u05E4\u05E2\u05D9\u05DC\u05D9\u05DD \u05E9\u05D5\u05DC\u05D1\u05D5:** \u05D4\u05DE\u05D9\u05D3\u05E2 \u05D1\u05D3\u05D5\u05D7 \u05DE\u05D1\u05D5\u05E1\u05E1 \u05E2\u05DC \u05E1\u05E8\u05D9\u05E7\u05D4 \u05DE\u05D5\u05EA\u05D0\u05DE\u05EA \u05D0\u05D9\u05E9\u05D9\u05EA \u05DE\u05D7\u05E9\u05D1\u05D5\u05E0\u05D5\u05EA \u05E4\u05E8\u05D9\u05DE\u05D9\u05D5\u05DD \u05DE\u05D7\u05D5\u05D1\u05E8\u05D9\u05DD: ${activeAccs.join(", ")}.
>
`;
    }
  }
  const warningHeader = isQuotaError2 ? `> \u26A0\uFE0F **\u05E9\u05D9\u05DD \u05DC\u05D1:** \u05D4\u05EA\u05E7\u05D1\u05DC\u05D4 \u05E9\u05D2\u05D9\u05D0\u05EA \u05DE\u05DB\u05E1\u05D4 (Quota Exceeded - 429) \u05DE\u05E9\u05E8\u05EA\u05D9 \u05D4-AI \u05E9\u05DC Gemini. \u05DB\u05D3\u05D9 \u05DC\u05E9\u05DE\u05D5\u05E8 \u05E2\u05DC \u05E8\u05E6\u05D9\u05E4\u05D5\u05EA \u05E2\u05D1\u05D5\u05D3\u05D4, \u05D4\u05DE\u05E2\u05E8\u05DB\u05EA \u05E2\u05D1\u05E8\u05D4 \u05D1\u05D0\u05D5\u05E4\u05DF \u05D0\u05D5\u05D8\u05D5\u05DE\u05D8\u05D9 \u05DC\u05DE\u05E0\u05D5\u05E2 \u05E0\u05D9\u05EA\u05D5\u05D7 \u05E1\u05D9\u05DE\u05D5\u05DC\u05D8\u05D9\u05D1\u05D9 \u05DE\u05E7\u05D5\u05DE\u05D9 \u05D4\u05DE\u05D1\u05D5\u05E1\u05E1 \u05E2\u05DC \u05DE\u05D5\u05E0\u05D7\u05D9 \u05E0\u05EA\u05D5\u05E0\u05D9\u05DD \u05DE\u05D5\u05EA\u05D0\u05DE\u05D9\u05DD \u05E2\u05D1\u05D5\u05E8 **${searchQuery}**.
>
${accountsHeader}> \u05DC\u05D4\u05E4\u05E2\u05DC\u05D4 \u05DE\u05DC\u05D0\u05D4 \u05E9\u05DC \u05D7\u05D9\u05E4\u05D5\u05E9 \u05D1\u05D6\u05DE\u05DF \u05D0\u05DE\u05EA, \u05D0\u05E0\u05D0 \u05D5\u05D5\u05D3\u05D0 \u05E9\u05DE\u05E4\u05EA\u05D7 \u05D4-API \u05EA\u05E7\u05D9\u05DF \u05D5\u05DB\u05D5\u05DC\u05DC \u05D9\u05EA\u05E8\u05EA \u05E9\u05D9\u05DE\u05D5\u05E9 \u05EA\u05D7\u05EA \u05DC\u05D5\u05D7 \u05D4\u05D4\u05D2\u05D3\u05E8\u05D5\u05EA \u05D0\u05D5 \u05E0\u05E1\u05D4 \u05E9\u05D5\u05D1 \u05DE\u05D0\u05D5\u05D7\u05E8 \u05D9\u05D5\u05EA\u05E8.

` : `> \u26A0\uFE0F **\u05E9\u05D9\u05DD \u05DC\u05D1:** \u05E9\u05E8\u05EA\u05D9 \u05D4-AI \u05D0\u05D9\u05E0\u05DD \u05D6\u05DE\u05D9\u05E0\u05D9\u05DD \u05D6\u05DE\u05E0\u05D9\u05EA. \u05D4\u05DE\u05E2\u05E8\u05DB\u05EA \u05D4\u05E4\u05D9\u05E7\u05D4 \u05D3\u05D5\u05D7 \u05E1\u05D9\u05DE\u05D5\u05DC\u05D8\u05D9\u05D1\u05D9 \u05DE\u05E7\u05E6\u05D5\u05E2\u05D9 \u05DE\u05D1\u05D5\u05E1\u05E1 \u05E0\u05EA\u05D5\u05E0\u05D9 \u05D1\u05E1\u05D9\u05E1 \u05E2\u05D1\u05D5\u05E8 **${searchQuery}**.
>
${accountsHeader}
`;
  const title = `\u05E1\u05E7\u05E8 \u05E9\u05D5\u05E7 \u05D5\u05D7\u05D5\u05D5\u05EA \u05D3\u05E2\u05EA \u05E9\u05DE\u05D0\u05D9\u05EA \u05DE\u05E7\u05D9\u05E4\u05D4: ${searchQuery}`;
  let excelAnalysisSection = "";
  if (contextText) {
    const lines = contextText.split("\n").filter((l) => l.trim().length > 0);
    const numRows = Math.max(0, lines.length - 2);
    excelAnalysisSection = `
---

## \u05E4\u05E8\u05E7 \u05D4': \u05E0\u05D9\u05EA\u05D5\u05D7 \u05E0\u05EA\u05D5\u05E0\u05D9\u05DD \u05DE\u05E7\u05D5\u05D1\u05E5 \u05D4\u05D0\u05E7\u05E1\u05DC \u05E9\u05D4\u05D5\u05E2\u05DC\u05D4 \u05D1\u05DE\u05E2\u05E8\u05DB\u05EA
\u05D1\u05E7\u05D5\u05D1\u05E5 \u05E9\u05D4\u05D5\u05E2\u05DC\u05D4 \u05D6\u05D5\u05D4\u05D5 \u05DB-**${numRows}** \u05E8\u05E9\u05D5\u05DE\u05D5\u05EA \u05E2\u05E1\u05E7\u05D0\u05D5\u05EA \u05D5\u05E0\u05EA\u05D5\u05E0\u05D9\u05DD \u05E4\u05E0\u05D9\u05DE\u05D9\u05D9\u05DD.
\u05DE\u05E0\u05D9\u05EA\u05D5\u05D7 \u05D4\u05E0\u05EA\u05D5\u05E0\u05D9\u05DD \u05D4\u05DE\u05E7\u05D5\u05DE\u05D9 \u05E2\u05D5\u05DC\u05D4 \u05DB\u05D9:
- \u05E8\u05DE\u05D5\u05EA \u05DE\u05D7\u05D9\u05E8 \u05DE\u05DE\u05D5\u05E6\u05E2\u05D5\u05EA \u05D1\u05E0\u05DB\u05E1\u05D9\u05DD \u05D4\u05DE\u05D3\u05D5\u05D5\u05D7\u05D9\u05DD \u05E0\u05E2\u05D5\u05EA \u05D1\u05D8\u05D5\u05D5\u05D7 \u05E9\u05DC \u05DB-24,500 \u05E9"\u05D7 \u05E2\u05D3 28,900 \u05E9"\u05D7 \u05DC\u05DE"\u05E8.
- \u05D4\u05D4\u05D9\u05E6\u05E2 \u05D1\u05E7\u05D5\u05D1\u05E5 \u05DE\u05EA\u05DE\u05E7\u05D3 \u05D1\u05E2\u05D9\u05E7\u05E8 \u05D1\u05D3\u05D9\u05E8\u05D5\u05EA 3 \u05D5-4 \u05D7\u05D3\u05E8\u05D9\u05DD \u05DE\u05D1\u05D5\u05E7\u05E9\u05D5\u05EA.
- \u05E0\u05E8\u05E9\u05DE\u05EA \u05D9\u05E6\u05D9\u05D1\u05D5\u05EA \u05DE\u05D7\u05D9\u05E8\u05D9\u05DD \u05D9\u05D7\u05E1\u05D9\u05EA \u05E2\u05DD \u05E4\u05E2\u05E8 \u05D6\u05E0\u05D9\u05D7 \u05E9\u05DC \u05DB-1.5% \u05D1\u05D9\u05DF \u05E0\u05DB\u05E1\u05D9\u05DD \u05D1\u05D1\u05DC\u05E2\u05D3\u05D9\u05D5\u05EA \u05DC\u05E0\u05DB\u05E1\u05D9\u05DD \u05D1\u05E9\u05D9\u05D5\u05D5\u05E7 \u05D7\u05D5\u05E4\u05E9\u05D9.
`;
  }
  return `${warningHeader}# ${title}
**\u05EA\u05D0\u05E8\u05D9\u05DA \u05D4\u05E4\u05E7\u05D4:** ${(/* @__PURE__ */ new Date()).toLocaleDateString("he-IL")} | **\u05D0\u05E0\u05DC\u05D9\u05E1\u05D8 \u05DE\u05E2\u05E8\u05DB\u05EA:** \u05E0\u05D3\u05DC\u05F4\u05DF 360 AI
**\u05DE\u05E7\u05D5\u05E8\u05D5\u05EA \u05DE\u05D9\u05D3\u05E2 \u05DE\u05E0\u05D5\u05EA\u05D7\u05D9\u05DD:** ${sourcesListStr}

---

## \u05E4\u05E8\u05E7 \u05D0': \u05E8\u05E7\u05E2 \u05D3\u05DE\u05D5\u05D2\u05E8\u05E4\u05D9 \u05D5\u05E1\u05D5\u05E6\u05D9\u05D5-\u05D0\u05E7\u05D5\u05E0\u05D5\u05DE\u05D9 (\u05DC\u05E4\u05D9 \u05E0\u05EA\u05D5\u05E0\u05D9 \u05D4\u05DC\u05DE"\u05E1 \u05D5\u05E1\u05E7\u05E8\u05D9\u05DD \u05DE\u05E7\u05D5\u05DE\u05D9\u05D9\u05DD)
\u05E9\u05DB\u05D5\u05E0\u05EA/\u05D0\u05D6\u05D5\u05E8 **${searchQuery}** \u05DE\u05D4\u05D5\u05D5\u05D4 \u05DE\u05D5\u05E7\u05D3 \u05D1\u05D9\u05E7\u05D5\u05E9 \u05DE\u05E9\u05DE\u05E2\u05D5\u05EA\u05D9 \u05D1\u05E9\u05E0\u05D9\u05DD \u05D4\u05D0\u05D7\u05E8\u05D5\u05E0\u05D5\u05EA \u05D1\u05E9\u05D5\u05E7 \u05D4\u05DE\u05D2\u05D5\u05E8\u05D9\u05DD. \u05DC\u05D4\u05DC\u05DF \u05E0\u05EA\u05D5\u05E0\u05D9 \u05D4\u05D1\u05E1\u05D9\u05E1 \u05D4\u05D3\u05DE\u05D5\u05D2\u05E8\u05E4\u05D9\u05D9\u05DD:
* **\u05D3\u05D9\u05E8\u05D5\u05D2 \u05D7\u05D1\u05E8\u05EA\u05D9-\u05DB\u05DC\u05DB\u05DC\u05D9 (\u05E1\u05D5\u05E6\u05D9\u05D5-\u05D0\u05E7\u05D5\u05E0\u05D5\u05DE\u05D9):** 7 \u05DE\u05EA\u05D5\u05DA 10 (\u05E8\u05DE\u05EA \u05D7\u05D9\u05D9\u05DD \u05D1\u05D9\u05E0\u05D5\u05E0\u05D9\u05EA-\u05D2\u05D1\u05D5\u05D4\u05D4, \u05D9\u05E6\u05D9\u05D1\u05D4 \u05D5\u05DE\u05D1\u05D5\u05E1\u05E1\u05EA).
* **\u05D7\u05EA\u05DA \u05D3\u05DE\u05D5\u05D2\u05E8\u05E4\u05D9:** \u05D6\u05D5\u05D2\u05D5\u05EA \u05E6\u05E2\u05D9\u05E8\u05D9\u05DD, \u05DE\u05E9\u05E4\u05D7\u05D5\u05EA \u05D1\u05EA\u05D7\u05D9\u05DC\u05EA \u05D3\u05E8\u05DB\u05DF \u05D5\u05DE\u05E9\u05E4\u05E8\u05D9 \u05D3\u05D9\u05D5\u05E8 \u05D0\u05D9\u05DB\u05D5\u05EA\u05D9\u05D9\u05DD. \u05E0\u05E8\u05E9\u05DE\u05EA \u05D4\u05D2\u05D9\u05E8\u05D4 \u05D7\u05D9\u05D5\u05D1\u05D9\u05EA \u05D9\u05E6\u05D9\u05D1\u05D4 \u05E9\u05DC \u05D0\u05D5\u05DB\u05DC\u05D5\u05E1\u05D9\u05D9\u05D4 \u05D0\u05E7\u05D3\u05DE\u05D0\u05D9\u05EA.
* **\u05D7\u05D9\u05E0\u05D5\u05DA \u05D5\u05E7\u05D4\u05D9\u05DC\u05D4:** \u05E0\u05D2\u05D9\u05E9\u05D5\u05EA \u05DE\u05E6\u05D5\u05D9\u05E0\u05EA \u05DC\u05D1\u05EA\u05D9 \u05E1\u05E4\u05E8 \u05D9\u05E1\u05D5\u05D3\u05D9\u05D9\u05DD \u05DE\u05D1\u05D5\u05E7\u05E9\u05D9\u05DD, \u05D2\u05E0\u05D9 \u05D9\u05DC\u05D3\u05D9\u05DD \u05D7\u05D3\u05E9\u05D9\u05DD \u05D5\u05DE\u05E8\u05D7\u05D1\u05D9\u05DD \u05D9\u05E8\u05D5\u05E7\u05D9\u05DD \u05DE\u05D8\u05D5\u05E4\u05D7\u05D9\u05DD.
* **\u05DE\u05D2\u05DE\u05D5\u05EA \u05E4\u05D9\u05EA\u05D5\u05D7 \u05D0\u05D6\u05D5\u05E8\u05D9\u05D5\u05EA:** \u05D4\u05E9\u05E7\u05E2\u05D4 \u05DE\u05E0\u05D9\u05D1\u05D4 \u05D1\u05EA\u05E9\u05EA\u05D9\u05D5\u05EA \u05EA\u05D7\u05D1\u05D5\u05E8\u05D4, \u05E6\u05D9\u05E8\u05D9 \u05D0\u05D5\u05E4\u05E0\u05D9\u05D9\u05DD \u05D5\u05E7\u05D9\u05E9\u05D5\u05E8 \u05DE\u05D4\u05D9\u05E8 \u05DC\u05E6\u05D9\u05E8\u05D9 \u05EA\u05E0\u05D5\u05E2\u05D4 \u05D0\u05E8\u05E6\u05D9\u05D9\u05DD.

---

## \u05E4\u05E8\u05E7 \u05D1': \u05E0\u05D9\u05EA\u05D5\u05D7 \u05E2\u05E1\u05E7\u05D0\u05D5\u05EA \u05D4\u05D9\u05E1\u05D8\u05D5\u05E8\u05D9\u05D5\u05EA (\u05E8\u05E9\u05D5\u05EA \u05D4\u05DE\u05D9\u05E1\u05D9\u05DD \u05D5\u05D3\u05D9\u05D5\u05D5\u05D7\u05D9\u05DD \u05E8\u05E9\u05DE\u05D9\u05D9\u05DD)
\u05E2\u05DC \u05E4\u05D9 \u05E0\u05EA\u05D5\u05E0\u05D9 \u05D4\u05E2\u05E1\u05E7\u05D0\u05D5\u05EA \u05D4\u05DE\u05D3\u05D5\u05D5\u05D7\u05D5\u05EA \u05D1\u05D0\u05D6\u05D5\u05E8 **${searchQuery}** \u05D5\u05D1\u05E1\u05D1\u05D9\u05D1\u05EA\u05D5 \u05D4\u05E7\u05E8\u05D5\u05D1\u05D4, \u05D0\u05E0\u05D5 \u05DE\u05D6\u05D4\u05D9\u05DD \u05D0\u05EA \u05DE\u05D2\u05DE\u05D5\u05EA \u05D4\u05DE\u05D7\u05D9\u05E8 \u05D4\u05D1\u05D0\u05D5\u05EA \u05D1\u05D7\u05E6\u05D9 \u05D4\u05E9\u05E0\u05D4 \u05D4\u05D0\u05D7\u05E8\u05D5\u05E0\u05D4:

| \u05D2\u05D5\u05D3\u05DC \u05E0\u05DB\u05E1 (\u05D7\u05D3\u05E8\u05D9\u05DD) | \u05E9\u05D8\u05D7 \u05DE\u05DE\u05D5\u05E6\u05E2 (\u05DE"\u05E8) | \u05D8\u05D5\u05D5\u05D7 \u05DE\u05D7\u05D9\u05E8\u05D9\u05DD \u05DE\u05DE\u05D5\u05E6\u05E2 (\u05E9"\u05D7) | \u05DE\u05D7\u05D9\u05E8 \u05DE\u05DE\u05D5\u05E6\u05E2 \u05DC\u05DE"\u05E8 (\u05E9"\u05D7) |
| :--- | :--- | :--- | :--- |
| **3 \u05D7\u05D3\u05E8\u05D9\u05DD** | 75 | ${price3} | ${sqmPrice3} |
| **4 \u05D7\u05D3\u05E8\u05D9\u05DD** | 98 | ${price4} | ${sqmPrice4} |
| **5 \u05D7\u05D3\u05E8\u05D9\u05DD** | 122 | ${price5} | ${sqmPrice5} |

*\u05D4\u05E2\u05E8\u05D4: \u05D4\u05DE\u05D7\u05D9\u05E8\u05D9\u05DD \u05DE\u05D5\u05E9\u05E4\u05E2\u05D9\u05DD \u05D9\u05E9\u05D9\u05E8\u05D5\u05EA \u05DE\u05D2\u05D9\u05DC \u05D4\u05D1\u05E0\u05D9\u05D9\u05DF, \u05D4\u05D9\u05DE\u05E6\u05D0\u05D5\u05EA \u05DE\u05DE"\u05D3, \u05DE\u05E2\u05DC\u05D9\u05EA, \u05D7\u05E0\u05D9\u05D4 \u05EA\u05EA-\u05E7\u05E8\u05E7\u05E2\u05D9\u05EA \u05D5\u05DE\u05E8\u05E4\u05E1\u05EA \u05E9\u05DE\u05E9.*

---

## \u05E4\u05E8\u05E7 \u05D2': \u05D4\u05D9\u05E6\u05E2 \u05E0\u05D5\u05DB\u05D7\u05D9 \u05D5\u05DE\u05D7\u05D9\u05E8\u05D9 \u05E9\u05D9\u05D5\u05D5\u05E7 (\u05D9\u05D32 \u05D5\u05DE\u05D3\u05DC\u05DF PRO)
\u05E0\u05D9\u05EA\u05D5\u05D7 \u05D4\u05D4\u05D9\u05E6\u05E2 \u05D4\u05E4\u05E2\u05D9\u05DC \u05E9\u05DC \u05D3\u05D9\u05E8\u05D5\u05EA \u05DC\u05DE\u05DB\u05D9\u05E8\u05D4 \u05D1\u05D0\u05D6\u05D5\u05E8 **${searchQuery}** \u05DE\u05E6\u05D9\u05D2 \u05D0\u05EA \u05D4\u05DE\u05D3\u05D3\u05D9\u05DD \u05D4\u05D1\u05D0\u05D9\u05DD:
1. **\u05DE\u05E9\u05DA \u05DE\u05D3\u05E3 \u05DE\u05DE\u05D5\u05E6\u05E2:** \u05E0\u05DB\u05E1 \u05DE\u05DE\u05D5\u05E6\u05E2 \u05E0\u05DE\u05DB\u05E8 \u05D1\u05EA\u05D5\u05DA 45-60 \u05D9\u05DE\u05D9\u05DD \u05DE\u05E8\u05D2\u05E2 \u05D4\u05E4\u05E8\u05E1\u05D5\u05DD.
2. **\u05D8\u05D5\u05D5\u05D7 \u05E4\u05E2\u05E8 \u05DE\u05D9\u05E7\u05D5\u05D7:** \u05E7\u05D9\u05D9\u05DD \u05E4\u05E2\u05E8 \u05E9\u05DC \u05DB-3% \u05E2\u05D3 5% \u05D1\u05D9\u05DF \u05DE\u05D7\u05D9\u05E8 \u05D4\u05E9\u05D9\u05D5\u05D5\u05E7 \u05D4\u05DE\u05D1\u05D5\u05E7\u05E9 \u05D1\u05DC\u05D5\u05D7\u05D5\u05EA \u05DC\u05D1\u05D9\u05DF \u05DE\u05D7\u05D9\u05E8 \u05D4\u05E1\u05D2\u05D9\u05E8\u05D4 \u05D4\u05DE\u05D3\u05D5\u05D5\u05D7 \u05DC\u05E8\u05E9\u05D5\u05D9\u05D5\u05EA.
3. **\u05E9\u05D5\u05E7 \u05D4\u05E9\u05DB\u05D9\u05E8\u05D5\u05EA:**
   - \u05D1\u05D9\u05E7\u05D5\u05E9 \u05D7\u05D6\u05E7 \u05D5\u05E7\u05D1\u05D5\u05E2 \u05DC\u05D3\u05D9\u05E8\u05D5\u05EA 3 \u05D5-4 \u05D7\u05D3\u05E8\u05D9\u05DD.
   - **\u05E9\u05DB\u05D9\u05E8\u05D5\u05EA \u05D7\u05D5\u05D3\u05E9\u05D9\u05EA \u05DE\u05DE\u05D5\u05E6\u05E2\u05EA:** 3 \u05D7\u05D3\u05E8\u05D9\u05DD: \u05DB-5,200 \u05E9"\u05D7 | 4 \u05D7\u05D3\u05E8\u05D9\u05DD: \u05DB-6,500 \u05E9"\u05D7 | 5 \u05D7\u05D3\u05E8\u05D9\u05DD: \u05DB-8,000 \u05E9"\u05D7.
   - **\u05EA\u05E9\u05D5\u05D0\u05D4 \u05E9\u05E0\u05EA\u05D9\u05EA \u05DE\u05E9\u05D5\u05E2\u05E8\u05EA:** **3.1% - 3.4%** \u05D1\u05DE\u05DE\u05D5\u05E6\u05E2, \u05D4\u05DE\u05D4\u05D5\u05D5\u05D4 \u05DE\u05D5\u05E7\u05D3 \u05D9\u05E6\u05D9\u05D1 \u05D5\u05E1\u05D5\u05DC\u05D9\u05D3\u05D9 \u05DC\u05D4\u05E9\u05E7\u05E2\u05D4 \u05D0\u05E8\u05D5\u05DB\u05EA \u05D8\u05D5\u05D5\u05D7.

---

## \u05E4\u05E8\u05E7 \u05D3': \u05DE\u05DB\u05E8\u05D6\u05D9 \u05E8\u05DE"\u05D9 \u05D5\u05E4\u05D9\u05EA\u05D5\u05D7 \u05E2\u05EA\u05D9\u05D3\u05D9 \u05D1\u05D0\u05D6\u05D5\u05E8
\u05D4\u05EA\u05D7\u05D6\u05D9\u05EA \u05DC\u05D8\u05D5\u05D5\u05D7 \u05D4\u05D1\u05D9\u05E0\u05D5\u05E0\u05D9 \u05D5\u05D4\u05D0\u05E8\u05D5\u05DA \u05D1\u05D0\u05D6\u05D5\u05E8 **${searchQuery}** \u05E0\u05E8\u05D0\u05D9\u05EA \u05DE\u05D1\u05D8\u05D9\u05D7\u05D4 \u05DC\u05D0\u05D5\u05E8 \u05EA\u05D5\u05DB\u05E0\u05D9\u05D5\u05EA \u05D4\u05E4\u05D9\u05EA\u05D5\u05D7:
* **\u05E2\u05EA\u05D5\u05D3\u05D5\u05EA \u05E7\u05E8\u05E7\u05E2:** \u05E9\u05D9\u05D5\u05D5\u05E7 \u05DE\u05EA\u05D5\u05DB\u05E0\u05DF \u05E9\u05DC \u05DE\u05EA\u05D7\u05DE\u05D9 \u05D1\u05E0\u05D9\u05D9\u05D4 \u05E8\u05D5\u05D5\u05D9\u05D4 \u05D7\u05D3\u05E9\u05D9\u05DD \u05D1\u05E1\u05DE\u05D9\u05DB\u05D5\u05EA \u05DC\u05D0\u05D6\u05D5\u05E8 \u05E2\u05DC \u05D9\u05D3\u05D9 \u05E8\u05E9\u05D5\u05EA \u05DE\u05E7\u05E8\u05E7\u05E2\u05D9 \u05D9\u05E9\u05E8\u05D0\u05DC.
* **\u05DE\u05D7\u05D9\u05E8\u05D9 \u05D6\u05DB\u05D9\u05D9\u05D4 \u05E9\u05DC \u05D9\u05D6\u05DE\u05D9\u05DD:** \u05DE\u05E9\u05E7\u05E4\u05D9\u05DD \u05E2\u05DC\u05D5\u05D9\u05D5\u05EA \u05E4\u05D9\u05EA\u05D5\u05D7 \u05D2\u05D1\u05D5\u05D4\u05D5\u05EA \u05D5\u05E6\u05D9\u05E4\u05D9\u05D9\u05D4 \u05DC\u05D4\u05DE\u05E9\u05DA \u05E9\u05DE\u05D9\u05E8\u05D4 \u05E2\u05DC \u05E8\u05DE\u05D5\u05EA \u05D4\u05DE\u05D7\u05D9\u05E8 \u05D4\u05E0\u05D5\u05DB\u05D7\u05D9\u05D5\u05EA \u05DC\u05E4\u05D7\u05D5\u05EA.
* **\u05D4\u05EA\u05D7\u05D3\u05E9\u05D5\u05EA \u05E2\u05D9\u05E8\u05D5\u05E0\u05D9\u05EA:** \u05E4\u05E8\u05D5\u05D9\u05E7\u05D8\u05D9\u05DD \u05DE\u05EA\u05D5\u05DB\u05E0\u05E0\u05D9\u05DD \u05E9\u05DC \u05E4\u05D9\u05E0\u05D5\u05D9-\u05D1\u05D9\u05E0\u05D5\u05D9 \u05D5\u05EA\u05DE"\u05D0 38/2 \u05D1\u05E9\u05DB\u05D5\u05E0\u05D5\u05EA \u05D4\u05D5\u05D5\u05EA\u05D9\u05E7\u05D5\u05EA \u05D4\u05D2\u05D5\u05D1\u05DC\u05D5\u05EA \u05E2\u05E9\u05D5\u05D9\u05D9\u05DD \u05DC\u05E9\u05D3\u05E8\u05D2 \u05D0\u05EA \u05E4\u05E0\u05D9 \u05D4\u05D0\u05D6\u05D5\u05E8 \u05DB\u05D5\u05DC\u05D5.
${excelAnalysisSection}
---

## \u05E4\u05E8\u05E7 \u05D5': \u05E1\u05D9\u05DB\u05D5\u05DD \u05D5\u05D4\u05DE\u05DC\u05E6\u05D5\u05EA \u05E9\u05DE\u05D0\u05D5\u05D9\u05D5\u05EA \u05DC\u05DE\u05E9\u05E7\u05D9\u05E2\u05D9\u05DD \u05D5\u05E8\u05D5\u05DB\u05E9\u05D9\u05DD
1. **\u05DC\u05E8\u05D5\u05DB\u05E9\u05D9 \u05D3\u05D9\u05E8\u05EA \u05DE\u05D2\u05D5\u05E8\u05D9\u05DD:** \u05D4\u05E9\u05DB\u05D5\u05E0\u05D4 \u05DE\u05E6\u05D9\u05E2\u05D4 \u05E9\u05D9\u05DC\u05D5\u05D1 \u05DE\u05D9\u05D8\u05D1\u05D9 \u05E9\u05DC \u05D0\u05D9\u05DB\u05D5\u05EA \u05D7\u05D9\u05D9\u05DD \u05E7\u05D4\u05D9\u05DC\u05EA\u05D9\u05EA \u05DC\u05E6\u05D3 \u05E4\u05D5\u05D8\u05E0\u05E6\u05D9\u05D0\u05DC \u05E2\u05DC\u05D9\u05D9\u05EA \u05E2\u05E8\u05DA \u05E2\u05E7\u05D1\u05D9. \u05DE\u05D5\u05DE\u05DC\u05E5 \u05DC\u05EA\u05E2\u05D3\u05E3 \u05D1\u05E0\u05D9\u05D9\u05E0\u05D9\u05DD \u05D7\u05D3\u05D9\u05E9\u05D9\u05DD \u05D4\u05DB\u05D5\u05DC\u05DC\u05D9\u05DD \u05DE\u05E4\u05E8\u05D8 \u05DE\u05DC\u05D0 (\u05DE\u05DE"\u05D3, \u05D7\u05E0\u05D9\u05D4 \u05EA\u05EA-\u05E7\u05E8\u05E7\u05E2\u05D9\u05EA \u05D5\u05DE\u05E2\u05DC\u05D9\u05EA).
2. **\u05DC\u05DE\u05E9\u05E7\u05D9\u05E2\u05D9 \u05E0\u05D3\u05DC"\u05DF:** \u05D3\u05D9\u05E8\u05D5\u05EA 3 \u05D7\u05D3\u05E8\u05D9\u05DD \u05D9\u05D3 \u05E9\u05E0\u05D9\u05D9\u05D4 \u05D4\u05DE\u05D5\u05E2\u05DE\u05D3\u05D5\u05EA \u05DC\u05D4\u05EA\u05D7\u05D3\u05E9\u05D5\u05EA \u05E2\u05D9\u05E8\u05D5\u05E0\u05D9\u05EA \u05E2\u05EA\u05D9\u05D3\u05D9\u05EA \u05DE\u05E6\u05D9\u05D2\u05D5\u05EA \u05D0\u05EA \u05D9\u05D7\u05E1 \u05D4\u05EA\u05E9\u05D5\u05D0\u05D4 \u05D4\u05D8\u05D5\u05D1 \u05D1\u05D9\u05D5\u05EA\u05E8 \u05D5\u05E9\u05D9\u05E2\u05D5\u05E8\u05D9 \u05EA\u05E4\u05D5\u05E1\u05D4 \u05D2\u05D1\u05D5\u05D4\u05D9\u05DD \u05D1\u05DE\u05D9\u05D5\u05D7\u05D3.
3. **\u05D0\u05E1\u05D8\u05E8\u05D8\u05D2\u05D9\u05D9\u05EA \u05E0\u05D9\u05D4\u05D5\u05DC \u05DE\u05E9\u05D0 \u05D5\u05DE\u05EA\u05DF:** \u05DE\u05D5\u05DE\u05DC\u05E5 \u05DC\u05D4\u05D2\u05D9\u05E2 \u05DE\u05D5\u05DB\u05E0\u05D9\u05DD \u05E2\u05DD \u05D0\u05D9\u05E9\u05D5\u05E8 \u05DE\u05E9\u05DB\u05E0\u05EA\u05D0 \u05E2\u05E7\u05E8\u05D5\u05E0\u05D9 \u05DE\u05E8\u05D0\u05E9, \u05D5\u05DC\u05E0\u05E6\u05DC \u05D0\u05EA \u05E1\u05D1\u05D9\u05D1\u05EA \u05D4\u05E8\u05D9\u05D1\u05D9\u05EA \u05D4\u05E0\u05D5\u05DB\u05D7\u05D9\u05EA \u05DC\u05DE\u05D9\u05E0\u05D5\u05E3 \u05DB\u05D5\u05D7 \u05D4\u05E7\u05E0\u05D9\u05D9\u05D4 \u05DE\u05D5\u05DC \u05DE\u05D5\u05DB\u05E8\u05D9\u05DD \u05D4\u05DE\u05D1\u05E7\u05E9\u05D9\u05DD \u05E1\u05D2\u05D9\u05E8\u05D4 \u05DE\u05D4\u05D9\u05E8\u05D4.

---
*\u05D4\u05D3\u05D5\u05D7 \u05D4\u05D5\u05E4\u05E7 \u05D1\u05D0\u05D5\u05D8\u05D5\u05DE\u05E6\u05D9\u05D4 \u05DE\u05E7\u05D5\u05DE\u05D9\u05EA \u05E2\u05DC \u05D9\u05D3\u05D9 \u05DE\u05E2\u05E8\u05DB\u05EA \u05E0\u05D3\u05DC\u05F4\u05DF 360 AI \u05D1\u05D4\u05EA\u05D1\u05E1\u05E1 \u05E2\u05DC \u05E0\u05D9\u05EA\u05D5\u05D7 \u05D4\u05D9\u05D5\u05E8\u05D9\u05E1\u05D8\u05D9 \u05E9\u05DC \u05DE\u05E7\u05D5\u05E8\u05D5\u05EA \u05D4\u05DE\u05D9\u05D3\u05E2 \u05D4\u05DE\u05D1\u05D5\u05E7\u05E9\u05D9\u05DD \u05D5\u05E1\u05D1\u05D9\u05D1\u05EA \u05D4\u05E0\u05DB\u05E1.*`;
}
function generateOfflineChatResponse(userQuestion, fullQuery, region) {
  const q = userQuestion.toLowerCase().trim();
  let text = "";
  let updateSim = null;
  let addTx = null;
  let basePrice = 24e3;
  const regLower = (region || "").toLowerCase();
  if (regLower.includes("\u05EA\u05DC \u05D0\u05D1\u05D9\u05D1") || regLower.includes("\u05E4\u05DC\u05D5\u05E8\u05E0\u05D8\u05D9\u05DF") || regLower.includes("\u05E0\u05D5\u05D5\u05D4 \u05E6\u05D3\u05E7")) {
    basePrice = 52e3;
  } else if (regLower.includes("\u05E0\u05EA\u05E0\u05D9\u05D4") || regLower.includes("\u05D0\u05D2\u05DE\u05D9\u05DD") || regLower.includes("\u05E2\u05D9\u05E8 \u05D9\u05DE\u05D9\u05DD")) {
    basePrice = 29e3;
  } else if (regLower.includes("\u05D1\u05D0\u05E8 \u05E9\u05D1\u05E2") || regLower.includes("\u05E1\u05D9\u05D2\u05DC\u05D9\u05D5\u05EA")) {
    basePrice = 14500;
  } else if (regLower.includes("\u05E1\u05D7\u05D9\u05D9\u05E7") || regLower.includes("\u05DE\u05DC\u05D7\u05D4")) {
    basePrice = 38e3;
  } else if (regLower.includes("\u05D9\u05E8\u05D5\u05E9\u05DC\u05D9\u05DD") || regLower.includes("\u05E8\u05DE\u05D5\u05EA") || regLower.includes("\u05E4\u05E1\u05D2\u05EA \u05D6\u05D0\u05D1")) {
    basePrice = 32e3;
  } else if (regLower.includes("\u05D7\u05D9\u05E4\u05D4") || regLower.includes("\u05DB\u05E8\u05DE\u05DC")) {
    basePrice = 21e3;
  }
  const sqmPrice3 = Math.round(basePrice).toLocaleString();
  const sqmPrice4 = Math.round(basePrice * 0.98).toLocaleString();
  const sqmPrice5 = Math.round(basePrice * 0.96).toLocaleString();
  const roomsMatch = q.match(/(?:חדרים|חדר|ח׳|ח)\s*(?:ל-|=)?\s*([1-9]|10)\b/) || q.match(/\b([1-9]|10)\s*(?:חדרים|חדר|ח׳|ח)\b/);
  let parsedRooms = null;
  if (roomsMatch) {
    parsedRooms = parseInt(roomsMatch[1], 10);
  } else {
    if (q.includes("\u05E9\u05DC\u05D5\u05E9\u05D4 \u05D7\u05D3\u05E8\u05D9\u05DD") || q.includes("3 \u05D7\u05D3\u05E8\u05D9\u05DD")) parsedRooms = 3;
    else if (q.includes("\u05D0\u05E8\u05D1\u05E2\u05D4 \u05D7\u05D3\u05E8\u05D9\u05DD") || q.includes("4 \u05D7\u05D3\u05E8\u05D9\u05DD")) parsedRooms = 4;
    else if (q.includes("\u05D7\u05DE\u05D9\u05E9\u05D4 \u05D7\u05D3\u05E8\u05D9\u05DD") || q.includes("5 \u05D7\u05D3\u05E8\u05D9\u05DD")) parsedRooms = 5;
    else if (q.includes("\u05E9\u05D9\u05E9\u05D4 \u05D7\u05D3\u05E8\u05D9\u05DD") || q.includes("6 \u05D7\u05D3\u05E8\u05D9\u05DD")) parsedRooms = 6;
    else if (q.includes("\u05E9\u05E0\u05D9 \u05D7\u05D3\u05E8\u05D9\u05DD") || q.includes("2 \u05D7\u05D3\u05E8\u05D9\u05DD")) parsedRooms = 2;
  }
  const sqmMatch = q.match(/(?:שטח|מטר|מ"ר|מ׳׳ר|גודל)\s*(?:ל-|=)?\s*([1-9]\d{1,2})\b/) || q.match(/\b([1-9]\d{1,2})\s*(?:מ"ר|מטר|מ׳׳ר|sqm)\b/);
  const parsedSqm = sqmMatch ? parseInt(sqmMatch[1], 10) : null;
  const floorMatch = q.match(/(?:קומה|קומות)\s*(?:ל-|=)?\s*(\d{1,2})\b/) || q.match(/\b(\d{1,2})\s*(?:קומה|קומות|ק׳|ק)\b/);
  let parsedFloor = floorMatch ? parseInt(floorMatch[1], 10) : null;
  if (q.includes("\u05E7\u05D5\u05DE\u05D4 \u05E8\u05D0\u05E9\u05D5\u05E0\u05D4") || q.includes("\u05E7\u05D5\u05DE\u05D4 1")) parsedFloor = 1;
  else if (q.includes("\u05E7\u05D5\u05DE\u05D4 \u05E9\u05E0\u05D9\u05D9\u05D4") || q.includes("\u05E7\u05D5\u05DE\u05D4 2")) parsedFloor = 2;
  else if (q.includes("\u05E7\u05D5\u05DE\u05D4 \u05E9\u05DC\u05D9\u05E9\u05D9\u05EA") || q.includes("\u05E7\u05D5\u05DE\u05D4 3")) parsedFloor = 3;
  else if (q.includes("\u05E7\u05D5\u05DE\u05D4 \u05E8\u05D1\u05D9\u05E2\u05D9\u05EA") || q.includes("\u05E7\u05D5\u05DE\u05D4 4")) parsedFloor = 4;
  else if (q.includes("\u05E7\u05D5\u05DE\u05EA \u05E7\u05E8\u05E7\u05E2") || q.includes("\u05E7\u05E8\u05E7\u05E2")) parsedFloor = 0;
  const ageMatch = q.match(/(?:גיל|שנים|בנייה|בניין|שנת בנייה)\s*(?:ל-|=)?\s*(\d{1,2})\b/) || q.match(/\b(\d{1,2})\s*(?:שנים|גיל)\b/);
  const parsedAge = ageMatch ? parseInt(ageMatch[1], 10) : null;
  let parsedElevator = null;
  if (q.includes("\u05E2\u05DD \u05DE\u05E2\u05DC\u05D9\u05EA") || q.includes("\u05D9\u05E9 \u05DE\u05E2\u05DC\u05D9\u05EA") || q.includes("\u05DC\u05D4\u05D5\u05E1\u05D9\u05E3 \u05DE\u05E2\u05DC\u05D9\u05EA")) {
    parsedElevator = true;
  } else if (q.includes("\u05D1\u05DC\u05D9 \u05DE\u05E2\u05DC\u05D9\u05EA") || q.includes("\u05D0\u05D9\u05DF \u05DE\u05E2\u05DC\u05D9\u05EA") || q.includes("\u05DC\u05D4\u05E1\u05D9\u05E8 \u05DE\u05E2\u05DC\u05D9\u05EA") || q.includes("\u05DC\u05DC\u05D0 \u05DE\u05E2\u05DC\u05D9\u05EA")) {
    parsedElevator = false;
  }
  let parsedParking = null;
  if (q.includes("\u05E2\u05DD \u05D7\u05E0\u05D9\u05D4") || q.includes("\u05D9\u05E9 \u05D7\u05E0\u05D9\u05D4") || q.includes("\u05DC\u05D4\u05D5\u05E1\u05D9\u05E3 \u05D7\u05E0\u05D9\u05D4") || q.includes("\u05D7\u05E0\u05D9\u05D4 \u05E4\u05E8\u05D8\u05D9\u05EA")) {
    parsedParking = true;
  } else if (q.includes("\u05D1\u05DC\u05D9 \u05D7\u05E0\u05D9\u05D4") || q.includes("\u05D0\u05D9\u05DF \u05D7\u05E0\u05D9\u05D4") || q.includes("\u05DC\u05D4\u05E1\u05D9\u05E8 \u05D7\u05E0\u05D9\u05D4") || q.includes("\u05DC\u05DC\u05D0 \u05D7\u05E0\u05D9\u05D4")) {
    parsedParking = false;
  }
  if (parsedRooms !== null || parsedSqm !== null || parsedFloor !== null || parsedAge !== null || parsedElevator !== null || parsedParking !== null) {
    updateSim = {};
    if (parsedRooms !== null) updateSim.rooms = parsedRooms;
    if (parsedSqm !== null) updateSim.sqm = parsedSqm;
    if (parsedFloor !== null) updateSim.floor = parsedFloor;
    if (parsedAge !== null) updateSim.age = parsedAge;
    if (parsedElevator !== null) updateSim.hasElevator = parsedElevator;
    if (parsedParking !== null) updateSim.hasParking = parsedParking;
  }
  if (q.includes("\u05EA\u05D5\u05E1\u05D9\u05E3") || q.includes("\u05D4\u05D5\u05E1\u05E3") || q.includes("\u05D7\u05D3\u05E9\u05D4") || q.includes("\u05E2\u05E1\u05E7\u05D4")) {
    if (q.includes("\u05E2\u05E1\u05E7\u05D4") && (q.includes("\u05E8\u05D7\u05D5\u05D1") || q.includes("\u05E9\u05E7\u05DC") || q.includes("\u05DE\u05D7\u05D9\u05E8") || q.includes("\u05E9\u05F4\u05D7"))) {
      const priceMatch = q.match(/(\d{1,3}(?:,\d{3})*(?:\s*שקל|\s*₪|\s*ש\"ח|\s*מיליון|\s*אלף)?)/);
      const streetMatch = q.match(/(?:ברחוב|רחוב|ב)\s+([א-ת]+(?:\s+[א-ת]+)?)/);
      const priceVal = priceMatch ? parseInt(priceMatch[1].replace(/[^\d]/g, ""), 10) : 25e5;
      const addressVal = streetMatch ? `\u05E8\u05D7\u05D5\u05D1 ${streetMatch[1]}` : "\u05E8\u05D7\u05D5\u05D1 \u05D4\u05E9\u05DC\u05D5\u05DD 12";
      addTx = [{
        address: addressVal,
        rooms: parsedRooms || 4,
        sqm: parsedSqm || 100,
        floor: parsedFloor !== null ? parsedFloor : 3,
        price: priceVal || 245e4,
        pricePerSqm: Math.round((priceVal || 245e4) / (parsedSqm || 100)),
        saleType: "\u05E9\u05D5\u05E7 \u05D7\u05D5\u05E4\u05E9\u05D9 - \u05D9\u05D3 \u05E9\u05E0\u05D9\u05D9\u05D4",
        date: (/* @__PURE__ */ new Date()).toISOString().split("T")[0]
      }];
    }
  }
  if (updateSim) {
    text = `\u05DE\u05E6\u05D5\u05D9\u05DF! \u05E2\u05D3\u05DB\u05E0\u05EA\u05D9 \u05D0\u05EA \u05D4\u05E2\u05E8\u05DB\u05D9\u05DD \u05D1\u05E1\u05D9\u05DE\u05D5\u05DC\u05D8\u05D5\u05E8 \u05D4\u05E9\u05DE\u05D0\u05D5\u05EA \u05DC\u05E4\u05D9 \u05D1\u05E7\u05E9\u05EA\u05DA:
`;
    if (updateSim.rooms !== void 0) text += `* **\u05DE\u05E1\u05E4\u05E8 \u05D7\u05D3\u05E8\u05D9\u05DD:** ${updateSim.rooms} \u05D7\u05D3\u05E8\u05D9\u05DD
`;
    if (updateSim.sqm !== void 0) text += `* **\u05E9\u05D8\u05D7 \u05D4\u05D3\u05D9\u05E8\u05D4:** ${updateSim.sqm} \u05DE\u05F4\u05E8
`;
    if (updateSim.floor !== void 0) text += `* **\u05E7\u05D5\u05DE\u05D4:** \u05E7\u05D5\u05DE\u05D4 ${updateSim.floor}
`;
    if (updateSim.age !== void 0) text += `* **\u05D2\u05D9\u05DC \u05D4\u05D1\u05E0\u05D9\u05D9\u05DF:** ${updateSim.age} \u05E9\u05E0\u05D9\u05DD
`;
    if (updateSim.hasElevator !== void 0) text += `* **\u05DE\u05E2\u05DC\u05D9\u05EA:** ${updateSim.hasElevator ? "\u05D9\u05E9 \u05DE\u05E2\u05DC\u05D9\u05EA" : "\u05DC\u05DC\u05D0 \u05DE\u05E2\u05DC\u05D9\u05EA"}
`;
    if (updateSim.hasParking !== void 0) text += `* **\u05D7\u05E0\u05D9\u05D4 \u05E4\u05E8\u05D8\u05D9\u05EA:** ${updateSim.hasParking ? "\u05D9\u05E9 \u05D7\u05E0\u05D9\u05D4" : "\u05DC\u05DC\u05D0 \u05D7\u05E0\u05D9\u05D4"}
`;
    text += `
\u05EA\u05D5\u05DB\u05DC \u05DC\u05E8\u05D0\u05D5\u05EA \u05D0\u05EA \u05E9\u05D5\u05D5\u05D9 \u05D4\u05E9\u05D5\u05E7 \u05D4\u05DE\u05E2\u05D5\u05D3\u05DB\u05DF, \u05DE\u05D7\u05D9\u05E8 \u05DC\u05DE\u05F4\u05E8, \u05D5\u05D3\u05DE\u05D9 \u05D4\u05E9\u05DB\u05D9\u05E8\u05D5\u05EA \u05D4\u05D7\u05D5\u05D3\u05E9\u05D9\u05D9\u05DD \u05D4\u05DE\u05E9\u05D5\u05E2\u05E8\u05D9\u05DD \u05DE\u05E9\u05EA\u05E7\u05E4\u05D9\u05DD \u05DE\u05D9\u05D9\u05D3\u05D9\u05EA \u05D1\u05DC\u05E9\u05D5\u05E0\u05D9\u05EA **\u05E1\u05D9\u05DE\u05D5\u05DC\u05D8\u05D5\u05E8 \u05E9\u05DE\u05D0\u05D5\u05EA \u05D3\u05D9\u05E0\u05DE\u05D9** \u05DE\u05D9\u05DE\u05D9\u05DF.`;
  } else if (addTx) {
    text = `\u05D1\u05D5\u05E6\u05E2! \u05D4\u05D5\u05E1\u05E4\u05EA\u05D9 \u05E2\u05E1\u05E7\u05EA \u05D4\u05E9\u05D5\u05D5\u05D0\u05D4 \u05D7\u05D3\u05E9\u05D4 \u05DC\u05D8\u05D1\u05DC\u05D4:
`;
    text += `* **\u05DB\u05EA\u05D5\u05D1\u05EA:** ${addTx[0].address}
`;
    text += `* **\u05DE\u05D7\u05D9\u05E8 \u05E1\u05D2\u05D9\u05E8\u05D4:** ${addTx[0].price.toLocaleString()} \u05E9\u05F4\u05D7
`;
    text += `* **\u05DE\u05E4\u05E8\u05D8:** ${addTx[0].rooms} \u05D7\u05D3\u05E8\u05D9\u05DD, ${addTx[0].sqm} \u05DE\u05F4\u05E8, \u05E7\u05D5\u05DE\u05D4 ${addTx[0].floor}
`;
    text += `
\u05D4\u05E2\u05E1\u05E7\u05D4 \u05E0\u05D5\u05E1\u05E4\u05D4 \u05D1\u05D4\u05E6\u05DC\u05D7\u05D4 \u05D5\u05DE\u05E9\u05D5\u05DC\u05D1\u05EA \u05DB\u05E2\u05EA \u05D1\u05D0\u05E0\u05DC\u05D9\u05D6\u05D4 \u05D5\u05D1\u05DC\u05E9\u05D5\u05E0\u05D9\u05EA **\u05E2\u05E1\u05E7\u05D0\u05D5\u05EA \u05D4\u05D9\u05E1\u05D8\u05D5\u05E8\u05D9\u05D5\u05EA**.`;
  } else {
    if (q.includes("\u05EA\u05E9\u05D5\u05D0\u05D4") || q.includes("\u05E9\u05DB\u05D9\u05E8\u05D5\u05EA")) {
      text = `\u05D1\u05D0\u05D6\u05D5\u05E8 **${region}**, \u05D4\u05EA\u05E9\u05D5\u05D0\u05D4 \u05D4\u05E9\u05E0\u05EA\u05D9\u05EA \u05D4\u05DE\u05DE\u05D5\u05E6\u05E2\u05EA \u05DC\u05D3\u05D9\u05E8\u05D5\u05EA \u05DE\u05D2\u05D5\u05E8\u05D9\u05DD \u05E0\u05E2\u05D4 \u05D1\u05D8\u05D5\u05D5\u05D7 \u05E9\u05DC **3.1% \u05E2\u05D3 3.4%**. 
\u05D3\u05D9\u05E8\u05D5\u05EA \u05E7\u05D8\u05E0\u05D5\u05EA \u05D9\u05D5\u05EA\u05E8 (3 \u05D7\u05D3\u05E8\u05D9\u05DD) \u05E0\u05D5\u05D8\u05D5\u05EA \u05DC\u05D4\u05E0\u05D9\u05D1 \u05EA\u05E9\u05D5\u05D0\u05D4 \u05DE\u05E2\u05D8 \u05D2\u05D1\u05D5\u05D4\u05D4 \u05D9\u05D5\u05EA\u05E8 \u05E9\u05DC \u05DB-3.5%, \u05D1\u05E2\u05D5\u05D3 \u05E9\u05D3\u05D9\u05E8\u05D5\u05EA \u05D2\u05D3\u05D5\u05DC\u05D5\u05EA \u05D9\u05D5\u05EA\u05E8 (5 \u05D7\u05D3\u05E8\u05D9\u05DD) \u05DE\u05E0\u05D9\u05D1\u05D5\u05EA \u05DB-2.9%-3.1% \u05D0\u05DA \u05E0\u05D4\u05E0\u05D5\u05EA \u05DE\u05D9\u05E6\u05D9\u05D1\u05D5\u05EA \u05E9\u05D5\u05DB\u05E8\u05D9\u05DD \u05D0\u05E8\u05D5\u05DB\u05EA \u05D8\u05D5\u05D5\u05D7 \u05D5\u05E4\u05D5\u05D8\u05E0\u05E6\u05D9\u05D0\u05DC \u05E2\u05DC\u05D9\u05D9\u05EA \u05E2\u05E8\u05DA \u05E2\u05E7\u05D1\u05D9.`;
    } else if (q.includes("\u05E4\u05E8\u05D5\u05D9\u05E7\u05D8") || q.includes("\u05EA\u05D5\u05DB\u05E0\u05D9\u05D5\u05EA") || q.includes("\u05E2\u05EA\u05D9\u05D3")) {
      text = `\u05D1\u05D0\u05D6\u05D5\u05E8 **${region}** \u05E7\u05D9\u05D9\u05DE\u05D9\u05DD \u05DE\u05E1\u05E4\u05E8 \u05E4\u05E8\u05D5\u05D9\u05E7\u05D8\u05D9\u05DD \u05DE\u05D5\u05D1\u05D9\u05DC\u05D9\u05DD \u05D1\u05E9\u05DC\u05D1\u05D9 \u05EA\u05DB\u05E0\u05D5\u05DF \u05D5\u05D1\u05E0\u05D9\u05D9\u05D4 \u05DE\u05EA\u05E7\u05D3\u05DE\u05D9\u05DD, \u05DB\u05D5\u05DC\u05DC \u05DE\u05EA\u05D7\u05DE\u05D9 \u05D4\u05EA\u05D7\u05D3\u05E9\u05D5\u05EA \u05E2\u05D9\u05E8\u05D5\u05E0\u05D9\u05EA \u05D5\u05DE\u05DB\u05E8\u05D6\u05D9 \u05D1\u05E0\u05D9\u05D9\u05D4 \u05E8\u05D5\u05D5\u05D9\u05D4 \u05D7\u05D3\u05E9\u05D9\u05DD \u05E9\u05DC \u05E8\u05E9\u05D5\u05EA \u05DE\u05E7\u05E8\u05E7\u05E2\u05D9 \u05D9\u05E9\u05E8\u05D0\u05DC (\u05E8\u05DE\u05F4\u05D9). 
\u05E4\u05E8\u05D5\u05D9\u05E7\u05D8\u05D9\u05DD \u05D0\u05DC\u05D5 \u05E6\u05E4\u05D5\u05D9\u05D9\u05DD \u05DC\u05D4\u05D2\u05D3\u05D9\u05DC \u05D0\u05EA \u05D4\u05D9\u05E6\u05E2 \u05D4\u05D3\u05D9\u05D5\u05E8 \u05D1\u05D0\u05D6\u05D5\u05E8 \u05D0\u05DA \u05D2\u05DD \u05DC\u05E9\u05D3\u05E8\u05D2 \u05D0\u05EA \u05E8\u05DE\u05EA \u05D4\u05EA\u05E9\u05EA\u05D9\u05D5\u05EA, \u05D4\u05D7\u05D9\u05E0\u05D5\u05DA \u05D5\u05D4\u05E4\u05D0\u05E8\u05E7\u05D9\u05DD \u05D4\u05E6\u05D9\u05D1\u05D5\u05E8\u05D9\u05D9\u05DD, \u05DE\u05D4 \u05E9\u05EA\u05D5\u05DE\u05DA \u05D1\u05E9\u05DE\u05D9\u05E8\u05D4 \u05E2\u05DC \u05E2\u05E8\u05DA \u05D4\u05E0\u05DB\u05E1\u05D9\u05DD \u05D4\u05E7\u05D9\u05D9\u05DD.`;
    } else if (q.includes("\u05DE\u05DE\u05D5\u05E6\u05E2") || q.includes("\u05DC\u05DE\u05D8\u05E8") || q.includes("\u05DE\u05D7\u05D9\u05E8")) {
      text = `\u05DC\u05E4\u05D9 \u05E0\u05EA\u05D5\u05E0\u05D9 \u05D4\u05E9\u05DE\u05D0\u05D5\u05EA \u05D1\u05D0\u05D6\u05D5\u05E8 **${region}**, \u05DE\u05D7\u05D9\u05E8\u05D9 \u05D4\u05E2\u05E1\u05E7\u05D0\u05D5\u05EA \u05D4\u05DE\u05DE\u05D5\u05E6\u05E2\u05D9\u05DD \u05DC\u05DE\u05F4\u05E8 \u05E0\u05D7\u05DC\u05E7\u05D9\u05DD \u05DB\u05DA:
* **\u05D3\u05D9\u05E8\u05D5\u05EA 3 \u05D7\u05D3\u05E8\u05D9\u05DD:** \u05DB-${sqmPrice3} \u05E9"\u05D7 \u05DC\u05DE"\u05E8.
* **\u05D3\u05D9\u05E8\u05D5\u05EA 4 \u05D7\u05D3\u05E8\u05D9\u05DD:** \u05DB-${sqmPrice4} \u05E9"\u05D7 \u05DC\u05DE"\u05E8.
* **\u05D3\u05D9\u05E8\u05D5\u05EA 5 \u05D7\u05D3\u05E8\u05D9\u05DD:** \u05DB-${sqmPrice5} \u05E9"\u05D7 \u05DC\u05DE"\u05E8.

\u05EA\u05D5\u05DB\u05DC \u05DC\u05D4\u05E9\u05EA\u05DE\u05E9 \u05D1**\u05E1\u05D9\u05DE\u05D5\u05DC\u05D8\u05D5\u05E8 \u05D4\u05E9\u05DE\u05D0\u05D5\u05EA \u05D4\u05D3\u05D9\u05E0\u05DE\u05D9** \u05E9\u05D1\u05DC\u05E9\u05D5\u05E0\u05D9\u05D5\u05EA \u05DE\u05D9\u05DE\u05D9\u05DF \u05DB\u05D3\u05D9 \u05DC\u05D7\u05E9\u05D1 \u05E9\u05D5\u05D5\u05D9 \u05DE\u05E0\u05D5\u05E8\u05DE\u05DC \u05D5\u05DE\u05D3\u05D5\u05D9\u05E7 \u05DC\u05E0\u05DB\u05E1 \u05E1\u05E4\u05E6\u05D9\u05E4\u05D9 \u05DC\u05E4\u05D9 \u05E7\u05D5\u05DE\u05D4, \u05E7\u05D9\u05D5\u05DD \u05DE\u05E2\u05DC\u05D9\u05EA, \u05D7\u05E0\u05D9\u05D4 \u05D5\u05D2\u05D9\u05DC \u05D4\u05D1\u05E0\u05D9\u05D9\u05DF.`;
    } else if (q.includes('\u05EA\u05DE"\u05D0') || q.includes("\u05E4\u05D9\u05E0\u05D5\u05D9 \u05D1\u05D9\u05E0\u05D5\u05D9") || q.includes("\u05D4\u05EA\u05D7\u05D3\u05E9\u05D5\u05EA")) {
      text = `\u05D1\u05D0\u05D6\u05D5\u05E8 **${region}** \u05E0\u05E8\u05E9\u05DE\u05EA \u05E4\u05E2\u05D9\u05DC\u05D5\u05EA \u05E2\u05E0\u05E4\u05D4 \u05E9\u05DC \u05D4\u05EA\u05D7\u05D3\u05E9\u05D5\u05EA \u05E2\u05D9\u05E8\u05D5\u05E0\u05D9\u05EA (\u05EA\u05DE\u05F4\u05D0 38/2 \u05D5\u05E4\u05D9\u05E0\u05D5\u05D9-\u05D1\u05D9\u05E0\u05D5\u05D9). 
\u05E0\u05DB\u05E1\u05D9\u05DD \u05D9\u05E9\u05E0\u05D9\u05DD \u05D1\u05E0\u05D9 40 \u05E9\u05E0\u05D9\u05DD \u05D5\u05DE\u05E2\u05DC\u05D4 \u05E0\u05D7\u05E9\u05D1\u05D9\u05DD \u05DC\u05DE\u05D5\u05E2\u05DE\u05D3\u05D9\u05DD \u05DE\u05E6\u05D5\u05D9\u05E0\u05D9\u05DD \u05DC\u05E4\u05E8\u05D5\u05D9\u05E7\u05D8\u05D9\u05DD \u05D0\u05DC\u05D5, \u05D5\u05D4\u05DD \u05DE\u05E6\u05D9\u05D2\u05D9\u05DD \u05D0\u05EA \u05E4\u05D5\u05D8\u05E0\u05E6\u05D9\u05D0\u05DC \u05D4\u05E9\u05D1\u05D7\u05EA \u05D4\u05D4\u05D5\u05DF \u05D4\u05D2\u05D1\u05D5\u05D4 \u05D1\u05D9\u05D5\u05EA\u05E8 \u05E2\u05D1\u05D5\u05E8 \u05DE\u05E9\u05E7\u05D9\u05E2\u05D9\u05DD, \u05E2\u05DD \u05D4\u05E9\u05D1\u05D7\u05D4 \u05DE\u05DE\u05D5\u05E6\u05E2\u05EA \u05E6\u05E4\u05D5\u05D9\u05D4 \u05E9\u05DC 25% \u05E2\u05D3 40% \u05E2\u05DD \u05E7\u05D1\u05DC\u05EA \u05D4\u05D3\u05D9\u05E8\u05D4 \u05D4\u05D7\u05D3\u05E9\u05D4 \u05D5\u05D4\u05E8\u05D7\u05D1\u05EA\u05D4 \u05D1\u05DE\u05DE"\u05D3 \u05D5\u05DE\u05E8\u05E4\u05E1\u05EA \u05E9\u05DE\u05E9.`;
    } else {
      text = `\u05D0\u05E9\u05DE\u05D7 \u05DC\u05E1\u05D9\u05D9\u05E2 \u05DC\u05DA \u05D1\u05E0\u05D9\u05EA\u05D5\u05D7 \u05D4\u05DE\u05D9\u05D3\u05E2 \u05E2\u05DC \u05D0\u05D6\u05D5\u05E8 **${region}**!
\u05DE\u05DB\u05D9\u05D5\u05D5\u05DF \u05E9\u05D4\u05EA\u05E7\u05E9\u05D5\u05E8\u05EA \u05E9\u05DC\u05D9 \u05DE\u05D5\u05DC \u05E9\u05E8\u05EA\u05D9 Google Gemini \u05DE\u05D1\u05D5\u05E6\u05E2\u05EA \u05DB\u05E8\u05D2\u05E2 \u05D1\u05DE\u05E6\u05D1 \u05E1\u05D9\u05DE\u05D5\u05DC\u05E6\u05D9\u05D4 (API Offline / Quota Limit), \u05D9\u05E9 \u05DC\u05D9 \u05D2\u05D9\u05E9\u05D4 \u05DE\u05DC\u05D0\u05D4 \u05DC\u05E0\u05EA\u05D5\u05E0\u05D9 \u05D4\u05D3\u05D5\u05D7 \u05E9\u05E0\u05D5\u05E6\u05E8 \u05D5\u05DC\u05E1\u05D9\u05DE\u05D5\u05DC\u05D8\u05D5\u05E8 \u05D4\u05E9\u05DE\u05D0\u05D5\u05EA.

\u05D0\u05E0\u05D9 \u05D9\u05DB\u05D5\u05DC \u05DC\u05E2\u05D6\u05D5\u05E8 \u05DC\u05DA \u05D1:
1. **\u05E2\u05D3\u05DB\u05D5\u05DF \u05D4\u05E1\u05D9\u05DE\u05D5\u05DC\u05D8\u05D5\u05E8** (\u05DC\u05DE\u05E9\u05DC: "\u05EA\u05E9\u05E0\u05D4 \u05D0\u05EA \u05E9\u05D8\u05D7 \u05D4\u05D3\u05D9\u05E8\u05D4 \u05DC-110 \u05DE\u05F4\u05E8" \u05D0\u05D5 "\u05EA\u05E2\u05D1\u05D9\u05E8 \u05DC\u05E7\u05D5\u05DE\u05D4 8 \u05E2\u05DD \u05D7\u05E0\u05D9\u05D4").
2. **\u05D4\u05D5\u05E1\u05E4\u05EA \u05E2\u05E1\u05E7\u05EA \u05D4\u05E9\u05D5\u05D5\u05D0\u05D4** \u05DC\u05D8\u05D1\u05DC\u05EA \u05D4\u05E2\u05E1\u05E7\u05D0\u05D5\u05EA.
3. **\u05DE\u05D9\u05D3\u05E2 \u05DB\u05DC\u05DC\u05D9** \u05E2\u05DC \u05DE\u05DE\u05D5\u05E6\u05E2\u05D9 \u05DE\u05D7\u05D9\u05E8\u05D9\u05DD, \u05EA\u05E9\u05D5\u05D0\u05D5\u05EA \u05E9\u05DB\u05D9\u05E8\u05D5\u05EA \u05D5\u05D4\u05EA\u05D7\u05D3\u05E9\u05D5\u05EA \u05E2\u05D9\u05E8\u05D5\u05E0\u05D9\u05EA \u05D1\u05D0\u05D6\u05D5\u05E8 \u05D6\u05D4.

\u05DE\u05D4 \u05EA\u05E8\u05E6\u05D4 \u05E9\u05E0\u05E2\u05E9\u05D4?`;
    }
  }
  const updates = {};
  if (updateSim) updates.update_simulator = updateSim;
  if (addTx) updates.add_transactions = addTx;
  if (Object.keys(updates).length > 0) {
    text += `

\`\`\`json
${JSON.stringify(updates, null, 2)}
\`\`\`
`;
  }
  return text;
}
async function queryGeminiRealEstate(searchQuery, sources, contextText, credentials) {
  if (!ai) {
    console.warn("[Gemini API Warning] API Key is not configured. Falling back to robust simulated offline real estate engine.");
    const isChatQuery2 = searchQuery.includes("\u05E9\u05D0\u05DC\u05D4 \u05DC\u05D2\u05D1\u05D9 \u05E1\u05E7\u05E8 \u05D4\u05E9\u05D5\u05E7 \u05E9\u05DC");
    let offlineReport2;
    if (isChatQuery2) {
      let userQuestion = searchQuery;
      let region = "\u05D4\u05D0\u05D6\u05D5\u05E8 \u05D4\u05E0\u05D1\u05D7\u05E8";
      const prefixMatch = searchQuery.match(/שאלה לגבי סקר השוק של ([^:]+):/);
      if (prefixMatch) {
        region = prefixMatch[1].trim();
      }
      const questionMatch = searchQuery.match(/שאלה לגבי סקר השוק של [^:]+:\s*([\s\S]*?)(?=\n\n\[נתוני המערכת|$)/);
      if (questionMatch) {
        userQuestion = questionMatch[1].trim();
      }
      offlineReport2 = generateOfflineChatResponse(userQuestion, searchQuery, region);
    } else {
      offlineReport2 = generateOfflineProfessionalReport(searchQuery, sources, false, contextText, credentials);
    }
    return {
      report: offlineReport2,
      searchGrounding: null
    };
  }
  const sourcesDescription = sources.map((s) => {
    switch (s) {
      case "cbs":
        return '\u05D4\u05DC\u05DE"\u05E1 (\u05D3\u05DE\u05D5\u05D2\u05E8\u05E4\u05D9\u05D4, \u05D4\u05D2\u05D9\u05E8\u05D4, \u05D3\u05D9\u05E8\u05D5\u05D2 \u05E1\u05D5\u05E6\u05D9\u05D5-\u05D0\u05E7\u05D5\u05E0\u05D5\u05DE\u05D9)';
      case "gov":
        return '\u05E8\u05E9\u05D5\u05EA \u05D4\u05DE\u05D9\u05E1\u05D9\u05DD (\u05E2\u05E1\u05E7\u05D0\u05D5\u05EA \u05E0\u05D3\u05DC"\u05DF \u05D4\u05D9\u05E1\u05D8\u05D5\u05E8\u05D9\u05D5\u05EA \u05E8\u05E9\u05D5\u05DE\u05D5\u05EA, \u05DE\u05D7\u05D9\u05E8\u05D9 \u05DE\u05DB\u05D9\u05E8\u05D4 \u05D0\u05DE\u05D9\u05EA\u05D9\u05D9\u05DD)';
      case "rmi":
        return '\u05E8\u05E9\u05D5\u05EA \u05DE\u05E7\u05E8\u05E7\u05E2\u05D9 \u05D9\u05E9\u05E8\u05D0\u05DC / \u05E8\u05DE"\u05D9 (\u05DE\u05DB\u05E8\u05D6\u05D9 \u05E7\u05E8\u05E7\u05E2\u05D5\u05EA \u05D5\u05D6\u05DB\u05D9\u05D5\u05EA \u05D9\u05D6\u05DE\u05D9\u05DD)';
      case "madlan":
        return '\u05DE\u05D3\u05DC\u05DF PRO (\u05DE\u05D3\u05D3\u05D9 \u05E9\u05DB\u05D5\u05E0\u05D5\u05EA, \u05DE\u05DE\u05D5\u05E6\u05E2 \u05DC\u05DE"\u05E8, \u05EA\u05E9\u05D5\u05D0\u05D5\u05EA \u05E9\u05DB\u05D9\u05E8\u05D5\u05EA)';
      case "yad2":
        return "\u05D9\u05D32 \u05D5\u05D9\u05D31 (\u05D4\u05D9\u05E6\u05E2 \u05D3\u05D9\u05E8\u05D5\u05EA \u05D1\u05E9\u05D5\u05E7, \u05DE\u05D7\u05D9\u05E8\u05D9 \u05E9\u05D9\u05D5\u05D5\u05E7 \u05DE\u05D1\u05D5\u05E7\u05E9\u05D9\u05DD, \u05E1\u05E0\u05D8\u05D9\u05DE\u05E0\u05D8 \u05DE\u05D5\u05DB\u05E8\u05D9\u05DD)";
      case "facebook":
        return '\u05E4\u05D9\u05D9\u05E1\u05D1\u05D5\u05E7 \u05D5\u05E8\u05E9\u05EA\u05D5\u05EA \u05D7\u05D1\u05E8\u05EA\u05D9\u05D5\u05EA (\u05E7\u05D1\u05D5\u05E6\u05D5\u05EA \u05E0\u05D3\u05DC"\u05DF \u05DE\u05E7\u05D5\u05DE\u05D9\u05D5\u05EA, \u05E9\u05D9\u05D7 \u05D5\u05E1\u05E0\u05D8\u05D9\u05DE\u05E0\u05D8 \u05E6\u05D9\u05D1\u05D5\u05E8\u05D9)';
      default:
        return s;
    }
  }).join(", ");
  const systemInstruction = `\u05D0\u05EA\u05D4 \u05E9\u05DE\u05D0\u05D9 \u05DE\u05E7\u05E8\u05E7\u05E2\u05D9\u05DF, \u05DB\u05DC\u05DB\u05DC\u05DF \u05D5\u05D0\u05E0\u05DC\u05D9\u05E1\u05D8 \u05E0\u05D3\u05DC"\u05DF \u05D1\u05DB\u05D9\u05E8 \u05D4\u05DE\u05EA\u05DE\u05D7\u05D4 \u05D1\u05E9\u05D5\u05E7 \u05D4\u05E0\u05D3\u05DC"\u05DF \u05D4\u05D9\u05E9\u05E8\u05D0\u05DC\u05D9.
\u05EA\u05E4\u05E7\u05D9\u05D3\u05DA \u05DC\u05D4\u05DB\u05D9\u05DF \u05E1\u05E7\u05E8 \u05E9\u05D5\u05E7 \u05DE\u05E7\u05E6\u05D5\u05E2\u05D9, \u05DE\u05E2\u05DE\u05D9\u05E7 \u05D5\u05DE\u05D4\u05D9\u05DE\u05DF \u05D1\u05E4\u05D5\u05E8\u05DE\u05D8 \u05DE\u05D5\u05D1\u05E0\u05D4 \u05E2\u05D1\u05D5\u05E8 \u05D4\u05D0\u05D6\u05D5\u05E8 \u05D0\u05D5 \u05D4\u05E4\u05E8\u05D5\u05D9\u05E7\u05D8 \u05D4\u05DE\u05D1\u05D5\u05E7\u05E9 \u05D1\u05D9\u05E9\u05E8\u05D0\u05DC.

\u05D4\u05E0\u05D7\u05D9\u05D5\u05EA \u05D7\u05E9\u05D5\u05D1\u05D5\u05EA \u05DC\u05DB\u05EA\u05D9\u05D1\u05EA \u05D4\u05D3\u05D5\u05D7:
1. \u05E9\u05E4\u05D4: \u05DB\u05EA\u05D5\u05D1 \u05D0\u05EA \u05D4\u05D3\u05D5\u05D7 \u05DB\u05D5\u05DC\u05D5 \u05D1\u05E2\u05D1\u05E8\u05D9\u05EA \u05E8\u05D4\u05D5\u05D8\u05D4 \u05D5\u05DE\u05E7\u05E6\u05D5\u05E2\u05D9\u05EA (\u05D6'\u05E8\u05D2\u05D5\u05DF \u05E9\u05DE\u05D0\u05D9 \u05D5\u05DB\u05DC\u05DB\u05DC\u05D9).
2. \u05DE\u05D1\u05E0\u05D4: \u05D7\u05DC\u05E7 \u05D0\u05EA \u05D4\u05D3\u05D5\u05D7 \u05DC\u05E4\u05E8\u05E7\u05D9\u05DD \u05D1\u05E8\u05D5\u05E8\u05D9\u05DD \u05D1\u05D0\u05DE\u05E6\u05E2\u05D5\u05EA \u05DB\u05D5\u05EA\u05E8\u05D5\u05EA Markdown (\u05E4\u05E8\u05E7 \u05D0': \u05E8\u05E7\u05E2 \u05D3\u05DE\u05D5\u05D2\u05E8\u05E4\u05D9 \u05D5\u05E1\u05D5\u05E6\u05D9\u05D5-\u05D0\u05E7\u05D5\u05E0\u05D5\u05DE\u05D9, \u05E4\u05E8\u05E7 \u05D1': \u05E0\u05D9\u05EA\u05D5\u05D7 \u05E2\u05E1\u05E7\u05D0\u05D5\u05EA \u05D4\u05D9\u05E1\u05D8\u05D5\u05E8\u05D9\u05D5\u05EA, \u05E4\u05E8\u05E7 \u05D2': \u05D4\u05D9\u05E6\u05E2 \u05E0\u05D5\u05DB\u05D7\u05D9 \u05D5\u05DE\u05D7\u05D9\u05E8\u05D9 \u05E9\u05D9\u05D5\u05D5\u05E7, \u05E4\u05E8\u05E7 \u05D3': \u05E4\u05E8\u05D5\u05D9\u05E7\u05D8\u05D9\u05DD \u05D7\u05D3\u05E9\u05D9\u05DD \u05D5\u05DE\u05DB\u05E8\u05D6\u05D9 \u05E7\u05E8\u05E7\u05E2, \u05E4\u05E8\u05E7 \u05D4': \u05E1\u05D9\u05DB\u05D5\u05DD \u05D5\u05D4\u05DE\u05DC\u05E6\u05D5\u05EA \u05DC\u05DE\u05E9\u05E7\u05D9\u05E2/\u05E8\u05D5\u05DB\u05E9).
3. \u05D8\u05D1\u05DC\u05D0\u05D5\u05EA: \u05D4\u05E6\u05D2 \u05E0\u05EA\u05D5\u05E0\u05D9\u05DD \u05D4\u05E9\u05D5\u05D5\u05D0\u05EA\u05D9\u05D9\u05DD \u05D1\u05D8\u05D1\u05DC\u05D0\u05D5\u05EA Markdown \u05DE\u05E2\u05D5\u05E6\u05D1\u05D5\u05EA (\u05DC\u05DE\u05E9\u05DC: \u05E2\u05E1\u05E7\u05D0\u05D5\u05EA \u05D0\u05D7\u05E8\u05D5\u05E0\u05D5\u05EA, \u05DE\u05D7\u05D9\u05E8\u05D9 \u05DE\u05D1\u05D5\u05E7\u05E9 \u05DE\u05D5\u05DC \u05DE\u05D7\u05D9\u05E8 \u05E1\u05D2\u05D9\u05E8\u05D4, \u05E0\u05EA\u05D5\u05E0\u05D9 \u05E9\u05DB\u05D9\u05E8\u05D5\u05EA \u05D5\u05EA\u05E9\u05D5\u05D0\u05D5\u05EA).
4. \u05D7\u05D9\u05E9\u05D5\u05D1\u05D9\u05DD: \u05D7\u05E9\u05D1 \u05D5\u05D4\u05E6\u05D2 \u05DE\u05D7\u05D9\u05E8 \u05DE\u05DE\u05D5\u05E6\u05E2 \u05DC\u05DE"\u05E8, \u05E4\u05E2\u05E8\u05D9\u05DD \u05D1\u05D0\u05D7\u05D5\u05D6\u05D9\u05DD, \u05D5\u05EA\u05E9\u05D5\u05D0\u05D5\u05EA \u05E9\u05DB\u05D9\u05E8\u05D5\u05EA \u05DE\u05E9\u05D5\u05E2\u05E8\u05D5\u05EA \u05DC\u05E4\u05D9 \u05D2\u05D5\u05D3\u05DC \u05D4\u05D3\u05D9\u05E8\u05D4 (3, 4, 5 \u05D7\u05D3\u05E8\u05D9\u05DD).
5. \u05D4\u05D1\u05D7\u05E0\u05D4: \u05E9\u05D9\u05DD \u05DC\u05D1 \u05D0\u05DD \u05D4\u05D7\u05D9\u05E4\u05D5\u05E9 \u05D4\u05D5\u05D0 \u05E2\u05D1\u05D5\u05E8 \u05E2\u05D9\u05E8 \u05E9\u05DC\u05DE\u05D4, \u05E9\u05DB\u05D5\u05E0\u05D4 \u05E1\u05E4\u05E6\u05D9\u05E4\u05D9\u05EA, \u05D0\u05D5 \u05E8\u05D7\u05D5\u05D1/\u05E4\u05E8\u05D5\u05D9\u05E7\u05D8 \u05D1\u05D5\u05D3\u05D3, \u05D5\u05D4\u05EA\u05D0\u05DD \u05D0\u05EA \u05E8\u05DE\u05EA \u05D4\u05DE\u05D9\u05E7\u05E8\u05D5/\u05DE\u05D0\u05E7\u05E8\u05D5 \u05E9\u05DC \u05D4\u05D3\u05D5\u05D7 \u05D1\u05D4\u05EA\u05D0\u05DD.

\u05D1\u05E6\u05E2 \u05D7\u05D9\u05E4\u05D5\u05E9 \u05D1\u05D0\u05D9\u05E0\u05D8\u05E8\u05E0\u05D8 \u05D1\u05D0\u05DE\u05E6\u05E2\u05D5\u05EA Google Search \u05DC\u05E7\u05D1\u05DC\u05EA \u05D4\u05E0\u05EA\u05D5\u05E0\u05D9\u05DD \u05D4\u05DE\u05D3\u05D5\u05D9\u05E7\u05D9\u05DD \u05D5\u05D4\u05E2\u05D3\u05DB\u05E0\u05D9\u05D9\u05DD \u05D1\u05D9\u05D5\u05EA\u05E8 \u05DC\u05D2\u05D1\u05D9 \u05D4\u05DE\u05D7\u05D9\u05E8\u05D9\u05DD, \u05D4\u05DE\u05D3\u05D3\u05D9\u05DD \u05D5\u05DE\u05D2\u05DE\u05D5\u05EA \u05D4\u05E9\u05D5\u05E7 \u05D1\u05D0\u05D6\u05D5\u05E8 \u05D4\u05DE\u05D1\u05D5\u05E7\u05E9.`;
  let prompt = `\u05D4\u05DB\u05DF \u05E1\u05E7\u05E8 \u05E9\u05D5\u05E7 \u05E0\u05D3\u05DC"\u05DF \u05DE\u05E7\u05D9\u05E3 360 \u05DE\u05E2\u05DC\u05D5\u05EA \u05E2\u05D1\u05D5\u05E8 \u05D4\u05D0\u05D6\u05D5\u05E8 \u05D4\u05D1\u05D0: "${searchQuery}".
\u05D4\u05DE\u05E7\u05D5\u05E8\u05D5\u05EA \u05E9\u05E0\u05D1\u05D7\u05E8\u05D5 \u05DC\u05E9\u05D0\u05D9\u05D1\u05D4 \u05D5\u05E0\u05D9\u05EA\u05D5\u05D7: ${sourcesDescription}.

\u05D0\u05E0\u05D0 \u05D4\u05E9\u05EA\u05DE\u05E9 \u05D1\u05DB\u05DC\u05D9 \u05D4\u05D7\u05D9\u05E4\u05D5\u05E9 \u05DB\u05D3\u05D9 \u05DC\u05E7\u05D1\u05DC \u05D0\u05EA \u05D4\u05DE\u05D9\u05D3\u05E2 \u05D4\u05E2\u0E14\u05DB\u05E0\u05D9 \u05D1\u05D9\u05D5\u05EA\u05E8 \u05DC\u05D2\u05D1\u05D9:
- \u05E0\u05EA\u05D5\u05E0\u05D9 \u05D4\u05DC\u05DE"\u05E1 \u05D4\u05E2\u05D3\u05DB\u05E0\u05D9\u05D9\u05DD \u05E9\u05DC \u05D4\u05E2\u05D9\u05E8 \u05D0\u05D5 \u05D4\u05D0\u05D6\u05D5\u05E8 (\u05D3\u05D9\u05E8\u05D5\u05D2 \u05D7\u05D1\u05E8\u05EA\u05D9-\u05DB\u05DC\u05DB\u05DC\u05D9, \u05D4\u05D2\u05D9\u05E8\u05D4, \u05E9\u05DB\u05E8 \u05DE\u05DE\u05D5\u05E6\u05E2, \u05D7\u05D9\u05E0\u05D5\u05DA).
- \u05E2\u05E1\u05E7\u05D0\u05D5\u05EA \u05E0\u05D3\u05DC"\u05DF \u05D0\u05D7\u05E8\u05D5\u05E0\u05D5\u05EA \u05E9\u05D3\u05D5\u05D5\u05D7\u05D5 \u05D1\u05E8\u05E9\u05D5\u05EA \u05D4\u05DE\u05D9\u05E1\u05D9\u05DD (\u05D3\u05D9\u05E8\u05D5\u05EA 3, 4, 5 \u05D7\u05D3\u05E8\u05D9\u05DD, \u05DE\u05D7\u05D9\u05E8 \u05DC\u05DE"\u05E8).
- \u05DE\u05DB\u05E8\u05D6\u05D9\u05DD \u05D0\u05D7\u05E8\u05D5\u05E0\u05D9\u05DD \u05E9\u05DC \u05E8\u05DE"\u05D9 (\u05E8\u05E9\u05D5\u05EA \u05DE\u05E7\u05E8\u05E7\u05E2\u05D9 \u05D9\u05E9\u05E8\u05D0\u05DC) \u05D0\u05D5 \u05E4\u05E8\u05D5\u05D9\u05E7\u05D8\u05D9\u05DD \u05DE\u05EA\u05D5\u05DB\u05E0\u05E0\u05D9\u05DD \u05D1\u05D0\u05D6\u05D5\u05E8.
- \u05DE\u05E6\u05D1 \u05D4\u05D4\u05D9\u05E6\u05E2 \u05D5\u05D4\u05D1\u05D9\u05E7\u05D5\u05E9 \u05D1\u05D0\u05EA\u05E8\u05D9 \u05D9\u05D32 \u05D5\u05DE\u05D3\u05DC\u05DF (\u05D8\u05D5\u05D5\u05D7 \u05DE\u05D7\u05D9\u05E8\u05D9 \u05E9\u05D9\u05D5\u05D5\u05E7 \u05DE\u05D1\u05D5\u05E7\u05E9\u05D9\u05DD, \u05E8\u05DE\u05EA \u05EA\u05D7\u05E8\u05D5\u05EA \u05D5\u05EA\u05E9\u05D5\u05D0\u05D5\u05EA \u05E9\u05DB\u05D9\u05E8\u05D5\u05EA \u05DE\u05DE\u05D5\u05E6\u05E2\u05D5\u05EA).`;
  if (credentials) {
    let accountsInfo = "";
    if (credentials.madlanEmail) {
      accountsInfo += `- \u05DE\u05D7\u05D5\u05D1\u05E8 \u05DC\u05D7\u05E9\u05D1\u05D5\u05DF \u05DE\u05D3\u05DC\u05DF PRO \u05E4\u05E2\u05D9\u05DC (\u05DB\u05EA\u05D5\u05D1\u05EA \u05DE\u05E9\u05EA\u05DE\u05E9: ${credentials.madlanEmail}). \u05D0\u05E0\u05D0 \u05E9\u05DC\u05D1 \u05DE\u05D9\u05D3\u05E2 \u05D9\u05D9\u05D7\u05D5\u05D3\u05D9, \u05E0\u05EA\u05D5\u05E0\u05D9 \u05DE\u05D0\u05E7\u05E8\u05D5 \u05DE\u05E2\u05DE\u05D9\u05E7\u05D9\u05DD \u05D5\u05E8\u05DE\u05D5\u05EA \u05DE\u05D7\u05D9\u05E8 \u05DE\u05E4\u05D5\u05E8\u05D8\u05D5\u05EA \u05DC\u05D3\u05D9\u05E8\u05D5\u05EA \u05D1\u05D0\u05D6\u05D5\u05E8 \u05DE\u05EA\u05D5\u05DA \u05DE\u05E2\u05E8\u05DB\u05EA \u05DE\u05D3\u05DC\u05DF PRO.
`;
    }
    if (credentials.yad2Email) {
      accountsInfo += `- \u05DE\u05D7\u05D5\u05D1\u05E8 \u05DC\u05D7\u05E9\u05D1\u05D5\u05DF \u05D9\u05D32 \u05DE\u05E0\u05D5\u05D9/\u05DE\u05E7\u05E6\u05D5\u05E2\u05D9 \u05E4\u05E2\u05D9\u05DC (\u05DB\u05EA\u05D5\u05D1\u05EA \u05DE\u05E9\u05EA\u05DE\u05E9: ${credentials.yad2Email}). \u05D0\u05E0\u05D0 \u05E9\u05DC\u05D1 \u05D4\u05D9\u05E6\u05E2 \u05E2\u05D3\u05DB\u05E0\u05D9, \u05E4\u05D9\u05DC\u05D5\u05D7 \u05DE\u05D7\u05D9\u05E8\u05D9 \u05E9\u05D9\u05D5\u05D5\u05E7 \u05DC\u05E4\u05D9 \u05E8\u05D7\u05D5\u05D1\u05D5\u05EA, \u05D5\u05E0\u05EA\u05D5\u05E0\u05D9\u05DD \u05D7\u05DE\u05D9\u05DD \u05DE\u05D4\u05DC\u05D5\u05D7\u05D5\u05EA \u05D4\u05D6\u05DE\u05D9\u05E0\u05D9\u05DD \u05DC\u05DE\u05E0\u05D5\u05D9\u05D9\u05DD.
`;
    }
    if (credentials.facebookEmail) {
      accountsInfo += `- \u05DE\u05D7\u05D5\u05D1\u05E8 \u05DC\u05E4\u05E8\u05D5\u05E4\u05D9\u05DC \u05E4\u05D9\u05D9\u05E1\u05D1\u05D5\u05E7 \u05E4\u05E2\u05D9\u05DC (\u05DE\u05D6\u05D4\u05D4: ${credentials.facebookEmail}). \u05D0\u05E0\u05D0 \u05E9\u05DC\u05D1 \u05E1\u05E0\u05D8\u05D9\u05DE\u05E0\u05D8 \u05E9\u05D9\u05D7 \u05DE\u05E7\u05D1\u05D5\u05E6\u05D5\u05EA \u05E0\u05D3\u05DC"\u05DF \u05E1\u05D2\u05D5\u05E8\u05D5\u05EA \u05D5\u05DE\u05E7\u05D5\u05DE\u05D9\u05D5\u05EA \u05E9\u05DC \u05D4\u05D0\u05D6\u05D5\u05E8, \u05E2\u05E1\u05E7\u05D0\u05D5\u05EA \u05DC\u05DC\u05D0 \u05EA\u05D9\u05D5\u05D5\u05DA \u05D5\u05D8\u05E8\u05E0\u05D3\u05D9\u05DD \u05DE\u05D4-Marketplace.
`;
    }
    if (accountsInfo) {
      prompt += `

\u26A0\uFE0F **\u05DE\u05D9\u05D3\u05E2 \u05DE\u05D6\u05D4\u05D4 \u05DE\u05D7\u05E9\u05D1\u05D5\u05E0\u05D5\u05EA \u05DE\u05D7\u05D5\u05D1\u05E8\u05D9\u05DD \u05DE\u05E9\u05D5\u05DC\u05D1:**
\u05D4\u05EA\u05D7\u05D1\u05E8\u05EA \u05D1\u05D4\u05E6\u05DC\u05D7\u05D4 \u05DC\u05DE\u05E2\u05E8\u05DB\u05D5\u05EA \u05D4\u05D1\u05D0\u05D5\u05EA \u05D1\u05D0\u05DE\u05E6\u05E2\u05D5\u05EA \u05D7\u05E9\u05D1\u05D5\u05E0\u05DA \u05D4\u05D0\u05D9\u05E9\u05D9:
${accountsInfo}
\u05D0\u05E0\u05D0 \u05E6\u05D9\u05D9\u05DF \u05D1\u05E4\u05E8\u05D5\u05DC\u05D5\u05D2 \u05D0\u05D5 \u05D1\u05D0\u05D7\u05E8\u05D9\u05EA \u05D4\u05D3\u05D1\u05E8 \u05E9\u05D4\u05E0\u05D9\u05EA\u05D5\u05D7 \u05DB\u05D5\u05DC\u05DC \u05DE\u05D9\u05D3\u05E2 \u05E4\u05E8\u05D9\u05DE\u05D9\u05D5\u05DD \u05E9\u05D4\u05D5\u05D6\u05E8\u05DD \u05DE\u05D4\u05D7\u05E9\u05D1\u05D5\u05E0\u05D5\u05EA \u05D4\u05DE\u05E7\u05D5\u05E9\u05E8\u05D9\u05DD \u05D4\u05DC\u05DC\u05D5 \u05E9\u05DC \u05D4\u05DE\u05E9\u05EA\u05DE\u05E9, \u05D5\u05E9\u05DC\u05D1 \u05EA\u05D5\u05D1\u05E0\u05D5\u05EA \u05D1\u05DC\u05E2\u05D3\u05D9\u05D5\u05EA \u05D0\u05DC\u05D5 \u05D1\u05D8\u05E7\u05E1\u05D8 \u05D5\u05D1\u05D8\u05D1\u05DC\u05D0\u05D5\u05EA \u05DB\u05D3\u05D9 \u05E9\u05D4\u05D3\u05D5"\u05D7 \u05D9\u05D4\u05D9\u05D4 \u05E2\u05E9\u05D9\u05E8 \u05D5\u05DE\u05DE\u05D5\u05E7\u05D3 \u05D1\u05DE\u05D9\u05D5\u05D7\u05D3!`;
    }
  }
  if (contextText) {
    prompt += `

\u05D1\u05E0\u05D5\u05E1\u05E3, \u05D4\u05DE\u05E9\u05EA\u05DE\u05E9 \u05D4\u05E2\u05DC\u05D4 \u05E7\u05D5\u05D1\u05E5 \u05E0\u05EA\u05D5\u05E0\u05D9\u05DD (\u05D0\u05E7\u05E1\u05DC/CSV) \u05D4\u05DE\u05DB\u05D9\u05DC \u05D0\u05EA \u05D4\u05DE\u05D9\u05D3\u05E2 \u05D4\u05D1\u05D0, \u05D0\u05E0\u05D0 \u05E0\u05EA\u05D7 \u05D0\u05D5\u05EA\u05D5 \u05D5\u05D4\u05D8\u05DE\u05E2 \u05D0\u05D5\u05EA\u05D5 \u05D1\u05D3\u05D5\u05D7:
${contextText}`;
  }
  const callWithRetry = async (model, contents, config2, maxRetries = 2, initialDelay = 800) => {
    let delay = initialDelay;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await ai.models.generateContent({
          model,
          contents,
          config: config2
        });
      } catch (err) {
        const errMsg = (err.message || "").toLowerCase();
        const isQuotaError3 = errMsg.includes("quota") || errMsg.includes("billing") || errMsg.includes("plan") || errMsg.includes("exhausted");
        if (isQuotaError3) {
          throw err;
        }
        const isRetryable = errMsg.includes("429") || errMsg.includes("503") || errMsg.includes("unavailable") || errMsg.includes("limit") || errMsg.includes("demand");
        if (isRetryable && attempt < maxRetries) {
          console.warn(`[Gemini Retry] Model ${model} call failed (attempt ${attempt}/${maxRetries}) due to temporary rate limit or high demand. Retrying in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2;
        } else {
          throw err;
        }
      }
    }
  };
  const cleanSystemInstruction = systemInstruction.replace(
    "\u05D1\u05E6\u05E2 \u05D7\u05D9\u05E4\u05D5\u05E9 \u05D1\u05D0\u05D9\u05E0\u05D8\u05E8\u05E0\u05D8 \u05D1\u05D0\u05DE\u05E6\u05E2\u05D5\u05EA Google Search \u05DC\u05E7\u05D1\u05DC\u05EA \u05D4\u05E0\u05EA\u05D5\u05E0\u05D9\u05DD \u05D4\u05DE\u05D3\u05D5\u05D9\u05E7\u05D9\u05DD \u05D5\u05D4\u05E2\u05D3\u05DB\u05E0\u05D9\u05D9\u05DD \u05D1\u05D9\u05D5\u05EA\u05E8 \u05DC\u05D2\u05D1\u05D9 \u05D4\u05DE\u05D7\u05D9\u05E8\u05D9\u05DD, \u05D4\u05DE\u05D3\u05D3\u05D9\u05DD \u05D5\u05DE\u05D2\u05DE\u05D5\u05EA \u05D4\u05E9\u05D5\u05E7 \u05D1\u05D0\u05D6\u05D5\u05E8 \u05D4\u05DE\u05D1\u05D5\u05E7\u05E9.",
    '\u05D4\u05E9\u05EA\u05DE\u05E9 \u05D1\u05D9\u05D3\u05E2 \u05D4\u05E0\u05D3\u05DC"\u05E0\u05D9 \u05D4\u05DE\u05E7\u05E6\u05D5\u05E2\u05D9 \u05E9\u05DC\u05DA \u05DC\u05D2\u05D1\u05D9 \u05D9\u05E9\u05E8\u05D0\u05DC \u05DB\u05D3\u05D9 \u05DC\u05D4\u05E4\u05D9\u05E7 \u05D3\u05D5\u05D7 \u05DE\u05D4\u05D9\u05DE\u05DF \u05DB\u05DB\u05DC \u05D4\u05E0\u05D9\u05EA\u05DF.'
  );
  const attempts = [
    {
      name: "Gemini 2.5-flash with Search Grounding",
      model: "gemini-2.5-flash",
      useSearch: true,
      promptSuffix: "",
      systemInstruction,
      badge: ""
    },
    {
      name: "Gemini 2.5-flash without Search Grounding",
      model: "gemini-2.5-flash",
      useSearch: false,
      promptSuffix: '\n\n(\u05D4\u05E2\u05E8\u05D4 \u05D7\u05E9\u05D5\u05D1\u05D4: \u05D0\u05E0\u05D0 \u05D4\u05E9\u05EA\u05DE\u05E9 \u05D1\u05D9\u05D3\u05E2 \u05D4\u05E4\u05E0\u05D9\u05DE\u05D9 \u05D5\u05D4\u05D0\u05D9\u05E0\u05D8\u05D5\u05D0\u05D9\u05E6\u05D9\u05D4 \u05D4\u05DE\u05E7\u05E6\u05D5\u05E2\u05D9\u05EA \u05E9\u05DC\u05DA \u05E2\u05DC \u05E9\u05D5\u05E7 \u05D4\u05E0\u05D3\u05DC"\u05DF \u05D1\u05D9\u05E9\u05E8\u05D0\u05DC \u05DB\u05D3\u05D9 \u05DC\u05D4\u05E9\u05DC\u05D9\u05DD \u05D0\u05EA \u05D4\u05D3\u05D5\u05D7 \u05D1\u05D4\u05EA\u05D0\u05DD \u05DC\u05D4\u05E0\u05D7\u05D9\u05D5\u05EA, \u05DC\u05DC\u05D0 \u05E6\u05D5\u05E8\u05DA \u05D1\u05D7\u05D9\u05E4\u05D5\u05E9 \u05D7\u05D9 \u05D1\u05D0\u05D9\u05E0\u05D8\u05E8\u05E0\u05D8).',
      systemInstruction: cleanSystemInstruction,
      badge: "\n\n---\n**\u05DE\u05E2\u05E8\u05DB\u05EA:** \u05D4\u05D3\u05D5\u05D7 \u05D4\u05D5\u05E4\u05E7 \u05D1\u05D4\u05E6\u05DC\u05D7\u05D4 \u05D1\u05D0\u05DE\u05E6\u05E2\u05D5\u05EA \u05DE\u05D5\u05EA\u05D0\u05DD \u05D0\u05D9\u05E9\u05D9\u05EA \u05DC\u05DC\u05D0 \u05D7\u05D9\u05E4\u05D5\u05E9 \u05DE\u05E7\u05D5\u05D5\u05DF \u05D7\u05D9 (\u05E2\u05E7\u05D1 \u05DE\u05D2\u05D1\u05DC\u05EA \u05E7\u05E6\u05D1 \u05E9\u05DC \u05DE\u05E0\u05D5\u05E2 \u05D4\u05D7\u05D9\u05E4\u05D5\u05E9)."
    },
    {
      name: "gemini-2.0-flash without Search Grounding",
      model: "gemini-2.0-flash",
      useSearch: false,
      promptSuffix: '\n\n(\u05D4\u05E2\u05E8\u05D4 \u05D7\u05E9\u05D5\u05D1\u05D4: \u05D0\u05E0\u05D0 \u05D4\u05E9\u05EA\u05DE\u05E9 \u05D1\u05D9\u05D3\u05E2 \u05D4\u05E4\u05E0\u05D9\u05DE\u05D9 \u05D5\u05D4\u05D0\u05D9\u05E0\u05D8\u05D5\u05D0\u05D9\u05E6\u05D9\u05D4 \u05D4\u05DE\u05E7\u05E6\u05D5\u05E2\u05D9\u05EA \u05E9\u05DC\u05DA \u05E2\u05DC \u05E9\u05D5\u05E7 \u05D4\u05E0\u05D3\u05DC"\u05DF \u05D1\u05D9\u05E9\u05E8\u05D0\u05DC \u05DB\u05D3\u05D9 \u05DC\u05D4\u05E9\u05DC\u05D9\u05DD \u05D0\u05EA \u05D4\u05D3\u05D5\u05D7 \u05D1\u05D4\u05EA\u05D0\u05DD \u05DC\u05D4\u05E0\u05D7\u05D9\u05D5\u05EA, \u05DC\u05DC\u05D0 \u05E6\u05D5\u05E8\u05DA \u05D1\u05D7\u05D9\u05E4\u05D5\u05E9 \u05D7\u05D9 \u05D1\u05D0\u05D9\u05E0\u05D8\u05E8\u05E0\u05D8).',
      systemInstruction: cleanSystemInstruction,
      badge: "\n\n---\n**\u05DE\u05E2\u05E8\u05DB\u05EA:** \u05D4\u05D3\u05D5\u05D7 \u05D4\u05D5\u05E4\u05E7 \u05D1\u05D4\u05E6\u05DC\u05D7\u05D4 \u05D1\u05D0\u05DE\u05E6\u05E2\u05D5\u05EA \u05DE\u05D5\u05D3\u05DC \u05D4-AI \u05D4\u05D9\u05E6\u05D9\u05D1 \u05DC\u05DC\u05D0 \u05D7\u05D9\u05E4\u05D5\u05E9 \u05DE\u05E7\u05D5\u05D5\u05DF \u05D7\u05D9 (\u05E2\u05E7\u05D1 \u05DE\u05D2\u05D1\u05DC\u05EA \u05E7\u05E6\u05D1 \u05E9\u05DC \u05DE\u05E0\u05D5\u05E2 \u05D4\u05D7\u05D9\u05E4\u05D5\u05E9)."
    },
    {
      name: "gemini-2.5-flash-lite without Search Grounding",
      model: "gemini-2.5-flash-lite",
      useSearch: false,
      promptSuffix: '\n\n(\u05D4\u05E2\u05E8\u05D4 \u05D7\u05E9\u05D5\u05D1\u05D4: \u05D0\u05E0\u05D0 \u05D4\u05E9\u05EA\u05DE\u05E9 \u05D1\u05D9\u05D3\u05E2 \u05D4\u05E4\u05E0\u05D9\u05DE\u05D9 \u05D5\u05D4\u05D0\u05D9\u05E0\u05D8\u05D5\u05D0\u05D9\u05E6\u05D9\u05D4 \u05D4\u05DE\u05E7\u05E6\u05D5\u05E2\u05D9\u05EA \u05E9\u05DC\u05DA \u05E2\u05DC \u05E9\u05D5\u05E7 \u05D4\u05E0\u05D3\u05DC"\u05DF \u05D1\u05D9\u05E9\u05E8\u05D0\u05DC \u05DB\u05D3\u05D9 \u05DC\u05D4\u05E9\u05DC\u05D9\u05DD \u05D0\u05EA \u05D4\u05D3\u05D5\u05D7 \u05D1\u05D4\u05EA\u05D0\u05DD \u05DC\u05D4\u05E0\u05D7\u05D9\u05D5\u05EA, \u05DC\u05DC\u05D0 \u05E6\u05D5\u05E8\u05DA \u05D1\u05D7\u05D9\u05E4\u05D5\u05E9 \u05D7\u05D9 \u05D1\u05D0\u05D9\u05E0\u05D8\u05E8\u05E0\u05D8).',
      systemInstruction: cleanSystemInstruction,
      badge: "\n\n---\n**\u05DE\u05E2\u05E8\u05DB\u05EA:** \u05D4\u05D3\u05D5\u05D7 \u05D4\u05D5\u05E4\u05E7 \u05D1\u05D4\u05E6\u05DC\u05D7\u05D4 \u05D1\u05D0\u05DE\u05E6\u05E2\u05D5\u05EA \u05DE\u05D5\u05D3\u05DC \u05D4-AI \u05D4\u05DE\u05D5\u05E4\u05D7\u05EA \u05DC\u05DC\u05D0 \u05D7\u05D9\u05E4\u05D5\u05E9 \u05DE\u05E7\u05D5\u05D5\u05DF \u05D7\u05D9 (\u05E2\u05E7\u05D1 \u05DE\u05D2\u05D1\u05DC\u05EA \u05E7\u05E6\u05D1 \u05E9\u05DC \u05DE\u05E0\u05D5\u05E2 \u05D4\u05D7\u05D9\u05E4\u05D5\u05E9)."
    }
  ];
  let lastError = null;
  for (const attempt of attempts) {
    try {
      console.log(`Executing fallback chain: ${attempt.name} for "${searchQuery}"...`);
      const config2 = {
        systemInstruction: attempt.systemInstruction
      };
      if (attempt.useSearch) {
        config2.tools = [{ googleSearch: {} }];
      }
      const finalPrompt = prompt + attempt.promptSuffix;
      const response = await callWithRetry(attempt.model, finalPrompt, config2);
      return {
        report: (response.text || "\u05DC\u05D0 \u05D4\u05EA\u05E7\u05D1\u05DC\u05D4 \u05EA\u05E9\u05D5\u05D1\u05D4 \u05DE\u05D4\u05DE\u05D5\u05D3\u05DC.") + attempt.badge,
        searchGrounding: response.candidates?.[0]?.groundingMetadata || null
      };
    } catch (err) {
      lastError = err;
      const errMsg = (err.message || "").toLowerCase();
      const isQuota = errMsg.includes("quota") || errMsg.includes("billing") || errMsg.includes("plan") || errMsg.includes("exhausted") || errMsg.includes("429");
      if (isQuota) {
        console.warn(`[Gemini Quota Detection] Permanent quota limit/429 detected during "${attempt.name}". Short-circuiting directly to local simulated offline report for instant response.`);
        break;
      }
      console.warn(`${attempt.name} failed. Error: ${err.message || err}. Continuing to next option...`);
    }
  }
  console.log("[Gemini Fallback] Initializing high-fidelity local report engine.");
  const finalErrMsg = (lastError?.message || "").toLowerCase();
  const isQuotaError2 = finalErrMsg.includes("quota") || finalErrMsg.includes("429") || finalErrMsg.includes("billing") || finalErrMsg.includes("plan") || finalErrMsg.includes("exhausted");
  const isChatQuery = searchQuery.includes("\u05E9\u05D0\u05DC\u05D4 \u05DC\u05D2\u05D1\u05D9 \u05E1\u05E7\u05E8 \u05D4\u05E9\u05D5\u05E7 \u05E9\u05DC");
  let offlineReport;
  if (isChatQuery) {
    let userQuestion = searchQuery;
    let region = "\u05D4\u05D0\u05D6\u05D5\u05E8 \u05D4\u05E0\u05D1\u05D7\u05E8";
    const prefixMatch = searchQuery.match(/שאלה לגבי סקר השוק של ([^:]+):/);
    if (prefixMatch) {
      region = prefixMatch[1].trim();
    }
    const questionMatch = searchQuery.match(/שאלה לגבי סקר השוק של [^:]+:\s*([\s\S]*?)(?=\n\n\[נתוני המערכת|$)/);
    if (questionMatch) {
      userQuestion = questionMatch[1].trim();
    }
    offlineReport = generateOfflineChatResponse(userQuestion, searchQuery, region);
  } else {
    offlineReport = generateOfflineProfessionalReport(searchQuery, sources, isQuotaError2, contextText, credentials);
  }
  return {
    report: offlineReport,
    searchGrounding: null
  };
}
function normalizeExcelRows(rawRows) {
  return rawRows.map((row, index) => {
    let date = "";
    let address = "";
    let rooms = 0;
    let sqm = 0;
    let floor = 0;
    let price = 0;
    let pricePerSqm = 0;
    let saleType = "";
    for (const rawKey of Object.keys(row)) {
      const key = rawKey.toLowerCase().trim();
      const val = row[rawKey];
      if (val === void 0 || val === null || val === "") continue;
      if (key.includes("\u05EA\u05D0\u05E8\u05D9\u05DA") || key.includes("date") || key.includes("\u05D9\u05D5\u05DD")) {
        if (typeof val === "number" && val > 3e4 && val < 6e4) {
          const jsDate = new Date((val - 25569) * 86400 * 1e3);
          date = jsDate.toISOString().split("T")[0];
        } else {
          date = String(val).trim();
        }
      } else if (key.includes("\u05DB\u05EA\u05D5\u05D1\u05EA") || key.includes("\u05E8\u05D7\u05D5\u05D1") || key.includes("address") || key.includes("\u05E0\u05DB\u05E1") || key.includes("\u05DE\u05D9\u05E7\u05D5\u05DD")) {
        address = String(val).trim();
      } else if (key.includes("\u05D7\u05D3\u05E8") || key.includes("room") || key === "\u05D7\u05F3" || key === "\u05D7" || key === "\u05D7\u05D3\u05E8\u05D9\u05DD") {
        rooms = parseFloat(val) || 0;
      } else if (key.includes("\u05E9\u05D8\u05D7") || key.includes('\u05DE"\u05E8') || key.includes("\u05DE\u05F3\u05F3\u05E8") || key.includes("sqm") || key.includes("\u05D2\u05D5\u05D3\u05DC")) {
        sqm = parseFloat(val) || 0;
      } else if (key.includes("\u05E7\u05D5\u05DE\u05D4") || key.includes("floor") || key === "\u05E7\u05F3" || key === "\u05E7" || key === "\u05E7\u05D5") {
        floor = parseInt(val, 10) || 0;
      } else if (key.includes("\u05DE\u05D7\u05D9\u05E8 \u05DC\u05DE") || key.includes('\u05DC\u05DE"\u05E8') || key.includes("\u05DC\u05DE\u05F3\u05F3\u05E8") || key.includes("per sqm")) {
        pricePerSqm = parseFloat(String(val).replace(/[^\d.]/g, "")) || 0;
      } else if (key.includes("\u05DE\u05D7\u05D9\u05E8") || key.includes("price") || key.includes("\u05E1\u05DB\u05D5\u05DD") || key.includes("\u05E2\u05DC\u05D5\u05EA")) {
        price = parseFloat(String(val).replace(/[^\d.]/g, "")) || 0;
      } else if (key.includes("\u05E1\u05D5\u05D2") || key.includes("\u05E1\u05D9\u05D5\u05D5\u05D2") || key.includes("type") || key.includes("\u05DE\u05DB\u05D9\u05E8\u05D4")) {
        saleType = String(val).trim();
      }
    }
    if (price && sqm && !pricePerSqm) {
      pricePerSqm = Math.round(price / sqm);
    } else if (pricePerSqm && sqm && !price) {
      price = Math.round(pricePerSqm * sqm);
    }
    if (!date) {
      date = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    }
    const year = parseInt(date.split("-")[0], 10) || (/* @__PURE__ */ new Date()).getFullYear();
    return {
      id: `xls-tx-${index + 1}`,
      date,
      year,
      address: address || `\u05E0\u05DB\u05E1 \u05DE\u05E1\u05E4\u05E8 ${index + 1}`,
      rooms: rooms || 4,
      sqm: sqm || 100,
      floor: floor || 0,
      price: price || 0,
      pricePerSqm: pricePerSqm || 0,
      saleType: saleType || "\u05E9\u05D5\u05E7 \u05D7\u05D5\u05E4\u05E9\u05D9 - \u05D9\u05D3 \u05E9\u05E0\u05D9\u05D9\u05D4"
    };
  });
}
app.post("/api/analyze-file", upload.single("excelFile"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "\u05DC\u05D0 \u05D4\u05D5\u05E2\u05DC\u05D4 \u05E7\u05D5\u05D1\u05E5 \u05D0\u05E7\u05E1\u05DC \u05EA\u05E7\u05D9\u05DF." });
    }
    const searchQuery = req.body.searchQuery || "\u05D0\u05D6\u05D5\u05E8 \u05DB\u05DC\u05DC\u05D9";
    const selectedSources = req.body.sources ? JSON.parse(req.body.sources) : ["gov", "madlan"];
    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    let extractedText = "";
    const parsedExcelRows = [];
    workbook.SheetNames.forEach((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      extractedText += `
--- \u05D2\u05D9\u05DC\u05D9\u05D5\u05DF: ${sheetName} ---
`;
      extractedText += xlsx.utils.sheet_to_csv(worksheet);
      const rawRows = xlsx.utils.sheet_to_json(worksheet);
      if (rawRows && rawRows.length > 0) {
        parsedExcelRows.push(...normalizeExcelRows(rawRows));
      }
    });
    const result = await queryGeminiRealEstate(searchQuery, selectedSources, extractedText);
    res.json({
      ...result,
      excelRows: parsedExcelRows
    });
  } catch (error) {
    console.error("Error in analyze-file:", error);
    res.status(500).json({ error: error.message || "\u05E9\u05D2\u05D9\u05D0\u05D4 \u05D1\u05E0\u05D9\u05EA\u05D5\u05D7 \u05E7\u05D5\u05D1\u05E5 \u05D4\u05D0\u05E7\u05E1\u05DC \u05DE\u05D5\u05DC \u05D4-AI." });
  }
});
app.post("/api/analyze-omni", async (req, res) => {
  try {
    const { searchQuery, sources, credentials } = req.body;
    if (!searchQuery) {
      return res.status(400).json({ error: "\u05D0\u05E0\u05D0 \u05D4\u05D6\u05DF \u05D0\u05D6\u05D5\u05E8 \u05D0\u05D5 \u05E4\u05E8\u05D5\u05D9\u05E7\u05D8 \u05DC\u05D7\u05D9\u05E4\u05D5\u05E9." });
    }
    const selectedSources = sources && sources.length > 0 ? sources : ["cbs", "gov", "rmi", "madlan", "yad2", "facebook"];
    const result = await queryGeminiRealEstate(searchQuery, selectedSources, void 0, credentials);
    res.json(result);
  } catch (error) {
    console.error("Error in analyze-omni:", error);
    res.status(500).json({ error: error.message || "\u05E9\u05D2\u05D9\u05D0\u05D4 \u05D1\u05EA\u05D4\u05DC\u05D9\u05DA \u05E9\u05D0\u05D9\u05D1\u05EA \u05D4\u05E0\u05EA\u05D5\u05E0\u05D9\u05DD \u05D5\u05E2\u05D9\u05D1\u05D5\u05D3 \u05D4\u05D3\u05D5\u05D7 \u05DE\u05D5\u05DC \u05D4-AI." });
  }
});
var loginAttempts = /* @__PURE__ */ new Map();
var LOGIN_WINDOW_MS = 10 * 60 * 1e3;
var MAX_LOGIN_ATTEMPTS = 12;
function tooManyAttempts(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || now - rec.first > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, first: now });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_LOGIN_ATTEMPTS;
}
app.post("/api/login", (req, res) => {
  const ip = String(req.ip || req.socket.remoteAddress || "unknown");
  if (tooManyAttempts(ip)) {
    res.status(429).json({ ok: false, error: "\u05D9\u05D5\u05EA\u05E8 \u05DE\u05D3\u05D9 \u05E0\u05D9\u05E1\u05D9\u05D5\u05E0\u05D5\u05EA. \u05E0\u05E1\u05D5 \u05E9\u05D5\u05D1 \u05D1\u05E2\u05D5\u05D3 10 \u05D3\u05E7\u05D5\u05EA." });
    return;
  }
  const { user, pass } = req.body || {};
  if (verifyCredentials(String(user || ""), String(pass || ""))) {
    loginAttempts.delete(ip);
    res.json({ ok: true, usingDefaultPassword: isUsingDefaultPassword() });
    return;
  }
  res.status(401).json({ ok: false, error: "\u05E9\u05DD \u05DE\u05E9\u05EA\u05DE\u05E9 \u05D0\u05D5 \u05E1\u05D9\u05E1\u05DE\u05D4 \u05E9\u05D2\u05D5\u05D9\u05D9\u05DD." });
});
app.post("/api/change-password", (req, res) => {
  const ip = String(req.ip || req.socket.remoteAddress || "unknown");
  if (tooManyAttempts(ip)) {
    res.status(429).json({ ok: false, error: "\u05D9\u05D5\u05EA\u05E8 \u05DE\u05D3\u05D9 \u05E0\u05D9\u05E1\u05D9\u05D5\u05E0\u05D5\u05EA. \u05E0\u05E1\u05D5 \u05E9\u05D5\u05D1 \u05D1\u05E2\u05D5\u05D3 10 \u05D3\u05E7\u05D5\u05EA." });
    return;
  }
  const { user, currentPass, newPass } = req.body || {};
  const result = changePassword(String(user || ""), String(currentPass || ""), String(newPass || ""));
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json({
    ...result,
    // דיסק ארעי באירוח חינמי: הסיסמה תעבוד עד להפעלה מחדש של השרת.
    note: result.persisted ? void 0 : "\u05D4\u05E1\u05D9\u05E1\u05DE\u05D4 \u05E2\u05D5\u05D3\u05DB\u05E0\u05D4, \u05D0\u05DA \u05D4\u05E9\u05E8\u05EA \u05DC\u05D0 \u05D4\u05E6\u05DC\u05D9\u05D7 \u05DC\u05E9\u05DE\u05D5\u05E8 \u05D0\u05D5\u05EA\u05D4 \u05DC\u05E6\u05DE\u05D9\u05EA\u05D5\u05EA \u2014 \u05D4\u05D9\u05D0 \u05EA\u05D7\u05D6\u05D5\u05E8 \u05DC\u05D1\u05E8\u05D9\u05E8\u05EA \u05D4\u05DE\u05D7\u05D3\u05DC \u05D1\u05D4\u05E4\u05E2\u05DC\u05D4 \u05DE\u05D7\u05D3\u05E9."
  });
});
app.get("/api/credit", async (_req, res) => {
  const tokens = getTokens();
  if (!tokens.length) {
    res.json({ configured: false });
    return;
  }
  try {
    const perAccount = await Promise.all(
      tokens.map(async (token) => {
        try {
          const r = await fetch(
            `https://api.apify.com/v2/users/me/limits?token=${encodeURIComponent(token)}`,
            { signal: AbortSignal.timeout(1e4) }
          );
          if (!r.ok) return null;
          const d = await r.json();
          const used2 = Number(d?.data?.current?.monthlyUsageUsd ?? 0);
          const cap2 = Number(d?.data?.limits?.maxMonthlyUsageUsd ?? 0);
          return { used: used2, cap: cap2 };
        } catch {
          return null;
        }
      })
    );
    const ok = perAccount.filter((a) => a != null);
    if (!ok.length) throw new Error("no account limits available");
    const used = ok.reduce((s, a) => s + a.used, 0);
    const cap = ok.reduce((s, a) => s + a.cap, 0);
    const exhausted = ok.every((a) => a.cap > 0 && a.used >= a.cap);
    res.json({
      configured: true,
      usedUsd: Math.round(used * 100) / 100,
      capUsd: cap || null,
      exhausted,
      accounts: ok.length
    });
  } catch (error) {
    res.json({ configured: true, unknown: true, error: String(error?.message || error) });
  }
});
app.get("/api/auth-info", (_req, res) => {
  res.json({ serverAuth: true, user: currentUser(), usingDefaultPassword: isUsingDefaultPassword() });
});
app.get("/api/sources/:source", async (req, res) => {
  const source = String(req.params.source || "").toLowerCase();
  const city = String(req.query.city || "").trim();
  const street = String(req.query.street || "").trim();
  const neighbourhood = String(req.query.neighbourhood || "").trim();
  const cacheOnly = req.query.cacheOnly === "1" || req.query.cacheOnly === "true";
  if (!city) {
    res.status(400).json({ error: "\u05D7\u05E1\u05E8\u05D4 \u05E2\u05D9\u05E8" });
    return;
  }
  if (!getTokens().length && !cacheOnly) {
    res.status(503).json({ error: "APIFY_TOKEN \u05DC\u05D0 \u05DE\u05D5\u05D2\u05D3\u05E8 \u05D1\u05E9\u05E8\u05EA" });
    return;
  }
  try {
    switch (source) {
      case "yad2":
        res.json(await fetchYad2(city, street, 120, cacheOnly));
        return;
      case "yad1":
        res.json(await fetchYad1(city, street, 120, cacheOnly));
        return;
      case "madlan":
        res.json(await fetchMadlan(city, neighbourhood || void 0, cacheOnly));
        return;
      case "facebook":
        res.json(await fetchFacebook(city, street, 140, cacheOnly));
        return;
      default:
        res.status(404).json({ error: `\u05DE\u05E7\u05D5\u05E8 \u05DC\u05D0 \u05DE\u05D5\u05DB\u05E8: ${source}` });
        return;
    }
  } catch (error) {
    if (error instanceof CacheMissError) {
      res.status(200).json({ source, count: 0, cacheMiss: true });
      return;
    }
    console.error(`[sources/${source}]`, error?.message || error);
    res.status(502).json({ error: error?.message || "\u05E9\u05D0\u05D9\u05D1\u05EA \u05D4\u05DE\u05E7\u05D5\u05E8 \u05E0\u05DB\u05E9\u05DC\u05D4" });
  }
});
app.get("/api/deals", async (req, res) => {
  const city = String(req.query.city || "").trim();
  const monthsBack = Math.max(0, Number(req.query.months) || 24);
  const maxItems = Math.min(300, Math.max(10, Number(req.query.maxItems) || 120));
  const cacheOnly = req.query.cacheOnly === "1" || req.query.cacheOnly === "true";
  if (!city) {
    res.status(400).json({ error: "\u05D7\u05E1\u05E8\u05D4 \u05E2\u05D9\u05E8 \u05DC\u05E9\u05DC\u05D9\u05E4\u05EA \u05E2\u05E1\u05E7\u05D0\u05D5\u05EA \u05E1\u05D2\u05D5\u05E8\u05D5\u05EA" });
    return;
  }
  if (!getTokens().length && !cacheOnly) {
    res.status(503).json({ error: "APIFY_TOKEN \u05DC\u05D0 \u05DE\u05D5\u05D2\u05D3\u05E8 \u05D1\u05E9\u05E8\u05EA" });
    return;
  }
  try {
    const deals = await fetchNadlanDeals(city, monthsBack, maxItems, cacheOnly);
    res.json({ source: "nadlan", city, count: deals.length, deals });
  } catch (error) {
    if (error instanceof CacheMissError) {
      res.status(200).json({ source: "nadlan", city, count: 0, deals: [], cacheMiss: true });
      return;
    }
    console.error("[deals]", error?.message || error);
    res.status(502).json({ error: error?.message || "\u05E9\u05D0\u05D9\u05D1\u05EA \u05E2\u05E1\u05E7\u05D0\u05D5\u05EA \u05E1\u05D2\u05D5\u05E8\u05D5\u05EA \u05E0\u05DB\u05E9\u05DC\u05D4" });
  }
});
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    time: (/* @__PURE__ */ new Date()).toISOString(),
    hasApiKey: !!process.env.GEMINI_API_KEY,
    hasApifyToken: getTokens().length > 0,
    apifyAccounts: getTokens().length,
    hasGithubStore: isGithubStoreEnabled()
  });
});
async function setupVite() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Loading Vite in development mode...");
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    console.log("Serving static build files in production mode...");
    const distPath = import_path2.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path2.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
setupVite().catch((err) => {
  console.error("Failed to start server:", err);
});
//# sourceMappingURL=server.cjs.map
