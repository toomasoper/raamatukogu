# Kodukogu

Pere raamaturiiul: skanni vöötkood, andmed täituvad automaatselt, otsi ja filtreeri, ning märgi kelle käes raamat on. Frontend on staatiline PWA (ilma build-sammuta), andmed Supabase'is (PostgreSQL + RLS).

## Failid
- `index.html`, `app.js` — rakendus
- `config.js` — **täida siin Supabase URL ja anon-võti**
- `manifest.webmanifest`, `sw.js`, `icon.svg` — PWA (installitav, töötab offline'is loeturežiimis)
- `raamatukogu_schema.sql` — andmebaasi skeem (repo juurkaustast üks tase üleval)

## Seadistus

### 1. Andmebaas
1. Supabase → uus projekt (regioon: EL / Frankfurt).
2. Database → SQL Editor → jooksuta `raamatukogu_schema.sql`.
3. Authentication → lülita **avalik registreerumine (Allow new sign-ups) VÄLJA**.
4. Authentication → Users → **Add user** iga pereliikme jaoks (e-post + parool).

### 2. Ühenda frontend
Ava `config.js` ja täida:
```js
export const SUPABASE_URL = "https://SINU-PROJEKT.supabase.co";
export const SUPABASE_ANON_KEY = "SINU-ANON-VOTI";
```
Mõlemad leiad: Supabase → Project Settings → API. Kasuta **ainult** `anon`/`public` võtit — mitte `service_role`.

### 3. Majuta GitHub Pages'il
1. Loo repo ja lükka need failid juurkausta (või `/docs`).
2. Repo → Settings → Pages → Source: vali haru ja kaust.
3. Ava saadud HTTPS-aadress telefonis → „Lisa avakuvale" (kaamera töötab ainult HTTPS-i all).

## Kasutus
- **Lisa raamat** → *Skanni* → luba kaamera → suuna vöötkoodile. Pealkiri, autor, kirjastus, aasta, žanr ja kaanepilt täituvad automaatselt (Google Books, siis Open Library). Täienda žanri/sarja ja salvesta.
- ISBN-ita raamat: jäta ISBN tühjaks ja täida käsitsi.
- **Otsing** töötab üle pealkirja, autori, ISBN-i, kirjastuse, žanri, sarja, asukoha ja laenaja. Lisaks filtrid žanri, sarja ja staatuse (kodus / väljas) järgi.
- **Laenutus**: ava raamat, kirjuta „Laenatud kellele". Tühi väli = kodus.

## Turvalisus
- RLS lubab andmeid lugeda/muuta ainult sisseloginud kasutajatel. Väljalogitud (anonüümne) ei näe midagi.
- `anon`-võti tohib olla avalik/GitHubis — seda kaitseb RLS. `service_role`-võtit ega paroole repo'sse **mitte kunagi**.

## Varukoopia
Supabase → Table Editor → `raamat` → Export CSV. (Soovi korral saab hiljem seadistada GitHub Actions öise ekspordi.)
