// Edge Function Supabase : fetch-product-info
// Reçoit { url } et renvoie { ok, title, image, price } lus dans les balises
// Open Graph / JSON-LD de la page. Ne bloque jamais l'utilisateur : en cas
// d'échec elle répond { ok: false } (HTTP 200) et le formulaire se remplit à la main.
//
// Protections :
//  - SSRF : http/https uniquement, ports 80/443, pas d'identifiants dans l'URL,
//    refus de localhost / noms internes / IP privées, loopback, link-local,
//    CGNAT, multicast, IPv6 locales... (le DNS est résolu et chaque IP est
//    vérifiée, à chaque redirection ; les redirections sont suivies à la main).
//  - Timeout court, taille de réponse limitée, type de contenu HTML uniquement.
//  - Limite de débit simple par IP (en mémoire, par instance : "best effort").

const MAX_BYTES = 600_000;
const TIMEOUT_MS = 6_000;
const MAX_REDIRECTS = 3;
const RATE_LIMIT = 20; // requêtes
const RATE_WINDOW_MS = 60_000;
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

// ---------------------------------------------------------------- rate limit
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5_000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(k);
  }
  return recent.length > RATE_LIMIT;
}

// ----------------------------------------------------------------- SSRF guard
function parseV4(s: string): number[] | null {
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const b = m.slice(1).map(Number);
  return b.every((n) => n >= 0 && n <= 255) ? b : null;
}

function parseV6(input: string): number[] | null {
  let s = input;
  if (s.includes("%")) return null;
  let v4tail: number[] | null = null;
  const m = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    v4tail = parseV4(m[2]);
    if (!v4tail) return null;
    s = m[1] + "0:0";
  }
  const parts = s.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  let groups: string[];
  if (parts.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null;
    groups = [...head, ...Array(fill).fill("0"), ...tail];
  } else {
    groups = head;
    if (groups.length !== 8) return null;
  }
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    const n = parseInt(g, 16);
    out.push(n >> 8, n & 255);
  }
  if (v4tail) out.splice(12, 4, ...v4tail);
  return out;
}

function isBlockedV4(b: number[]): boolean {
  const [a, c] = b;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && c >= 64 && c <= 127) || // CGNAT
    (a === 169 && c === 254) || // link-local / metadata cloud
    (a === 172 && c >= 16 && c <= 31) ||
    (a === 192 && c === 168) ||
    (a === 192 && c === 0 && b[2] === 0) ||
    (a === 198 && (c === 18 || c === 19))
  );
}

function isBlockedIp(ip: string): boolean {
  const v4 = parseV4(ip);
  if (v4) return isBlockedV4(v4);
  const b = parseV6(ip);
  if (!b) return true; // format inconnu => on refuse
  if (b.slice(0, 12).every((x) => x === 0)) return true; // ::, ::1, ::/96
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10
  if (b[0] === 0xff) return true; // multicast
  if (b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff) {
    return isBlockedV4(b.slice(12)); // ::ffff:a.b.c.d
  }
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) {
    return isBlockedV4(b.slice(12)); // NAT64
  }
  if (b[0] === 0x20 && b[1] === 0x02) return isBlockedV4(b.slice(2, 6)); // 6to4
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0 && b[3] === 0) return true; // Teredo
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // doc
  return false;
}

async function assertPublicUrl(u: URL): Promise<void> {
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("protocol");
  if (u.username || u.password) throw new Error("credentials");
  if (u.port && u.port !== "80" && u.port !== "443") throw new Error("port");

  let host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);

  const isLiteral = parseV4(host) !== null || host.includes(":");
  if (!isLiteral) {
    if (
      host === "localhost" || !host.includes(".") ||
      /\.(localhost|local|internal|intranet|lan|home|corp|private)$/.test(host)
    ) throw new Error("internal host");
  }

  if (isLiteral) {
    if (isBlockedIp(host)) throw new Error("blocked ip");
    return;
  }

  const ips: string[] = [];
  try { ips.push(...await Deno.resolveDns(host, "A")); } catch { /* pas d'enregistrement A */ }
  try { ips.push(...await Deno.resolveDns(host, "AAAA")); } catch { /* pas d'AAAA */ }
  if (ips.length === 0) throw new Error("dns");
  if (ips.some(isBlockedIp)) throw new Error("blocked ip");
}

// ---------------------------------------------------------------------- fetch
async function readLimited(res: Response): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }
  await reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(total, MAX_BYTES));
  let offset = 0;
  for (const c of chunks) {
    const slice = c.subarray(0, Math.max(0, out.length - offset));
    out.set(slice, offset);
    offset += slice.length;
  }
  return out;
}

function decodeBody(bytes: Uint8Array, contentType: string): string {
  let charset = contentType.match(/charset=["']?([\w-]+)/i)?.[1];
  if (!charset) {
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
    charset = head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  }
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function fetchHtml(start: URL): Promise<{ html: string; finalUrl: URL }> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(url);
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PapilloteBot/1.0; +link-preview)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "fr,en;q=0.8",
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!loc) throw new Error("redirect");
      url = new URL(loc, url);
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new Error("status");
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml\+xml/i.test(ct)) {
      await res.body?.cancel().catch(() => {});
      throw new Error("content-type");
    }
    return { html: decodeBody(await readLimited(res), ct), finalUrl: url };
  }
  throw new Error("too many redirects");
}

// -------------------------------------------------------------------- parsing
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function safeChar(n: number): string {
  try { return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ""; } catch { return ""; }
}

function clean(s: string | undefined | null, max: number): string | null {
  if (!s) return null;
  const v = decodeEntities(s).replace(/\s+/g, " ").trim();
  return v ? v.slice(0, max) : null;
}

function readMeta(html: string): Map<string, string> {
  const meta = new Map<string, string>();
  const head = html.slice(0, MAX_BYTES);
  for (const tag of head.match(/<meta\s[^>]*>/gi) ?? []) {
    const attrs: Record<string, string> = {};
    for (const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
    }
    const key = (attrs.property ?? attrs.name ?? attrs.itemprop ?? "").toLowerCase();
    if (key && attrs.content !== undefined && !meta.has(key)) meta.set(key, attrs.content);
  }
  return meta;
}

function parsePrice(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 && v <= 1e6 ? Math.round(v * 100) / 100 : null;
  if (typeof v !== "string") return null;
  const m = v.replace(/\s/g, "").match(/\d+(?:[.,]\d{1,2})?/);
  if (!m) return null;
  return parsePrice(Number(m[0].replace(",", ".")));
}

// Parcourt le JSON-LD à la recherche d'un Product (profondeur limitée).
function fromJsonLd(html: string): { name?: string; image?: string; price?: number | null } {
  const out: { name?: string; image?: string; price?: number | null } = {};
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(re)) {
    let data: unknown;
    try { data = JSON.parse(m[1]); } catch { continue; }
    const stack: Array<[unknown, number]> = [[data, 0]];
    let guard = 0;
    while (stack.length && guard++ < 500) {
      const [node, depth] = stack.pop()!;
      if (!node || typeof node !== "object" || depth > 6) continue;
      if (Array.isArray(node)) { for (const n of node) stack.push([n, depth + 1]); continue; }
      const o = node as Record<string, unknown>;
      const type = String(Array.isArray(o["@type"]) ? o["@type"].join(",") : o["@type"] ?? "");
      if (/Product/i.test(type)) {
        if (typeof o.name === "string" && !out.name) out.name = o.name;
        const img = Array.isArray(o.image) ? o.image[0] : o.image;
        if (!out.image) {
          if (typeof img === "string") out.image = img;
          else if (img && typeof (img as Record<string, unknown>).url === "string") out.image = (img as Record<string, string>).url;
        }
        const offers = Array.isArray(o.offers) ? o.offers[0] : o.offers;
        if (offers && typeof offers === "object" && out.price == null) {
          const off = offers as Record<string, unknown>;
          out.price = parsePrice(off.price ?? off.lowPrice);
        }
      }
      for (const v of Object.values(o)) if (v && typeof v === "object") stack.push([v, depth + 1]);
    }
    if (out.name) break;
  }
  return out;
}

function absoluteHttpUrl(raw: string | null | undefined, base: URL): string | null {
  if (!raw) return null;
  try {
    const u = new URL(decodeEntities(raw).trim(), base);
    return (u.protocol === "http:" || u.protocol === "https:") && u.href.length <= 2000 ? u.href : null;
  } catch {
    return null;
  }
}

function extract(html: string, finalUrl: URL) {
  const meta = readMeta(html);
  const ld = fromJsonLd(html);
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];

  const title = clean(meta.get("og:title") ?? meta.get("twitter:title") ?? ld.name ?? titleTag, 200);
  const image = absoluteHttpUrl(
    meta.get("og:image") ?? meta.get("og:image:url") ?? meta.get("twitter:image") ?? ld.image,
    finalUrl,
  );
  const price = parsePrice(
    meta.get("product:price:amount") ?? meta.get("og:price:amount") ?? meta.get("price") ?? ld.price,
  );
  return { title, image, price };
}

// -------------------------------------------------------------------- handler
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) return json({ ok: false, error: "rate_limited" }, 429);

  let target: URL;
  try {
    const body = await req.json();
    if (typeof body?.url !== "string" || body.url.length > 2000) throw new Error("bad url");
    target = new URL(body.url.trim());
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }

  try {
    const { html, finalUrl } = await fetchHtml(target);
    const info = extract(html, finalUrl);
    if (!info.title && !info.image && info.price == null) return json({ ok: false, error: "nothing_found" });
    return json({ ok: true, ...info });
  } catch {
    // Volontairement vague : pas de détail sur le réseau interne.
    return json({ ok: false, error: "unreachable" });
  }
});
