// Supabase Edge Function: enrich
// Võtab ISBN-i ja proovib mitut allikat, tagastab kombineeritud raamatuinfo.
// Allikad järjekorras: Google Books -> Apollo (pealkiri+kaas) -> ESTER (autor+kirjastus).
// Serveripoolel pole CORS-piiranguid, seega saame parsida ka HTML-lehti.
//
// Deploy:  supabase functions deploy enrich --no-verify-jwt
// Kutsu:   POST { "isbn": "9789949634460" }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const clean = (s: string) => (s || "").replace(/[^0-9Xx]/g, "");
const decode = (s: string) =>
  (s || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();

type Book = {
  pealkiri?: string; autor?: string; kirjastus?: string;
  aasta?: number | null; keel?: string; zanr?: string; kaane_url?: string;
};

// ---------- 1) Google Books ----------
async function fromGoogle(isbn: string): Promise<Book | null> {
  try {
    const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
    const d = await r.json();
    if (!d.totalItems) return null;
    const v = d.items[0].volumeInfo || {};
    return {
      pealkiri: v.title ? v.title + (v.subtitle ? `: ${v.subtitle}` : "") : undefined,
      autor: (v.authors || []).join(", ") || undefined,
      kirjastus: v.publisher || undefined,
      aasta: v.publishedDate ? parseInt(v.publishedDate.slice(0, 4)) : null,
      keel: v.language || undefined,
      zanr: (v.categories || [])[0] || undefined,
      kaane_url: (v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || "").replace(/^http:/, "https:") || undefined,
    };
  } catch { return null; }
}

// ---------- 2) Apollo (pealkiri + kaanepilt JSON-LD-st) ----------
async function fromApollo(isbn: string): Promise<Book | null> {
  try {
    const s = await fetch(`https://www.apollo.ee/et/catalogsearch/result?category_id=-1&q=${isbn}`);
    const html = await s.text();
    // leia esimene tootelink
    const m = html.match(/href="(https:\/\/www\.apollo\.ee\/et\/[a-z0-9\-]+\.html[^"]*)"/i)
      || html.match(/href="(\/et\/[a-z0-9\-]+\.html)"/i);
    if (!m) return null;
    const url = m[1].startsWith("http") ? m[1] : `https://www.apollo.ee${m[1]}`;
    const p = await fetch(url);
    const ph = await p.text();
    const book: Book = {};
    // JSON-LD Product
    for (const jm of ph.matchAll(/application\/ld\+json[^>]*>(.*?)<\/script>/gis)) {
      try {
        const j = JSON.parse(jm[1]);
        const items = Array.isArray(j) ? j : [j];
        for (const it of items) {
          if (it["@type"] === "Product" || it["@type"] === "Book") {
            if (it.name) book.pealkiri = decode(it.name);
            const img = typeof it.image === "string" ? it.image : (it.image || [])[0];
            if (img) book.kaane_url = img;
          }
        }
      } catch { /* jätka */ }
    }
    return Object.keys(book).length ? book : null;
  } catch { return null; }
}

// ---------- 3) ESTER (autor + kirjastus + aasta MARC-tabelist) ----------
async function fromEster(isbn: string): Promise<Book | null> {
  try {
    const r = await fetch(`https://www.ester.ee/search~S1*est/?searchtype=i&searcharg=${isbn}`);
    const html = await r.text();
    const field = (label: string) => {
      const m = html.match(new RegExp(label + "\\s*</t[dh]>\\s*<t[dh][^>]*>(.*?)</t[dh]>", "is"));
      return m ? decode(m[1].replace(/<[^>]+>/g, " ")) : undefined;
    };
    const book: Book = {};
    const pealkiriRaw = field("Pealkiri");
    if (pealkiriRaw) book.pealkiri = pealkiriRaw.split("/")[0].trim();
    const autorRaw = field("Autor");
    if (autorRaw) book.autor = autorRaw.replace(/,\s*\d{4}-?.*$/, "").replace(/\s+autor.*$/i, "").trim();
    const ilmunud = field("Ilmunud") || field("Väljaandmine") || field("Trükiandmed");
    if (ilmunud) {
      const koolon = ilmunud.split(":");
      if (koolon[1]) book.kirjastus = koolon[1].split(",")[0].trim();
      const aasta = ilmunud.match(/\b(19|20)\d{2}\b/);
      if (aasta) book.aasta = parseInt(aasta[0]);
    }
    return Object.keys(book).length ? book : null;
  } catch { return null; }
}

// Ühenda: varasemad allikad on prioriteetsemad, aga tühja välja täidab järgmine.
function merge(base: Book, extra: Book | null): Book {
  if (!extra) return base;
  const out = { ...base };
  for (const k of Object.keys(extra) as (keyof Book)[]) {
    if ((out[k] === undefined || out[k] === null || out[k] === "") && extra[k]) {
      (out as any)[k] = extra[k];
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { isbn: raw } = await req.json();
    const isbn = clean(raw);
    if (!isbn) return new Response(JSON.stringify({ error: "ISBN puudub" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });

    let book: Book = {};
    const allikad: string[] = [];

    const g = await fromGoogle(isbn);
    if (g) { book = merge(book, g); allikad.push("google"); }

    // Kui midagi olulist puudu, proovi eesti allikaid
    if (!book.pealkiri || !book.autor || !book.kaane_url) {
      const a = await fromApollo(isbn);
      if (a) { book = merge(book, a); allikad.push("apollo"); }
    }
    if (!book.autor || !book.kirjastus) {
      const e = await fromEster(isbn);
      if (e) { book = merge(book, e); allikad.push("ester"); }
    }

    const leitud = Object.keys(book).length > 0;
    return new Response(JSON.stringify({ isbn, leitud, allikad, book }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
