-- ============================================================
-- Kodukogu — Supabase / PostgreSQL skeem
-- Üks tabel, üks rida raamatu kohta. ISBN unikaalne => üks eksemplar.
-- Jooksuta see Supabase'i SQL-editoris (Database -> SQL Editor).
-- ============================================================

-- 1) Tabel -----------------------------------------------------
create table if not exists public.raamat (
  id                uuid primary key default gen_random_uuid(),
  isbn              text unique,          -- NULL lubatud (ISBN-ita raamatud); mitu NULL-i ei riku unikaalsust
  pealkiri          text not null,
  autor             text,
  kirjastus         text,
  aasta             int,
  keel              text,
  zanr              text,                 -- žanr; täitub automaatselt, saab käsitsi muuta
  seeria            text,                 -- sarja nimi (nt "Kalevipoja lood")
  seeria_nr         numeric,              -- koht sarjas (nt 3)
  kaane_url         text,                 -- kaanepildi aadress (Open Library / Google Books)
  asukoht           text,                 -- nt "elutoa riiul", "maakodu"
  laenatud_kellele  text,                 -- tühi / NULL = raamat on kodus
  laenatud_kuup     date,
  lisatud           timestamptz not null default now()
);

-- Kiire ISBN-i otsing skannimisel (duplikaadi kontroll)
create index if not exists raamat_isbn_idx on public.raamat (isbn);

-- 1b) Kui algne tabel on juba olemas, lisa uued veerud ----------
alter table public.raamat add column if not exists zanr      text;
alter table public.raamat add column if not exists seeria    text;
alter table public.raamat add column if not exists seeria_nr numeric;

-- 2) Row-Level Security ---------------------------------------
-- RLS sisse. Ilma poliisita on ligipääs vaikimisi keelatud,
-- seega väljalogitud (anonüümne) kasutaja ei näe ega muuda midagi.
alter table public.raamat enable row level security;

-- Sisseloginud pereliikmetel täisõigus (loe/lisa/muuda/kustuta).
drop policy if exists "pere taisoigus" on public.raamat;
create policy "pere taisoigus"
  on public.raamat
  for all
  to authenticated
  using (true)
  with check (true);

-- ============================================================
-- MÄRKUSED
-- * Lülita Supabase'is avalik registreerumine VÄLJA
--   (Authentication -> Sign In / Providers) ja kutsu pereliikmed käsitsi,
--   muidu saab "authenticated" olla igaüks, kes end registreerib.
-- * Frontendis kasuta ainult avalikku "anon" võtit — seda kaitseb RLS.
--   "service_role" võti EI TOHI sattuda brauserisse ega GitHubi.
-- ============================================================
