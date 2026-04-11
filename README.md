# Ruteplanlegger – Schøyen & Horntvedt AS

En mobilvennlig web-app som hjelper dispatcher å registrere dagens føresedler
og få 4 optimaliserte kjøreruter med PDF-sjåførlister – klar til å sendes ut.

## Hva appen gjør

- Registrer hvert leveringsstopp på mobilen (mottaker, adresse, kolli, vekt, ETA, telefon).
- Ta bilde av føreseddelen med kameraet som referanse (lagres lokalt i nettleseren).
- Geokoder adressene via OpenStreetMap (gratis).
- Grupperer stoppene geografisk i 4 ruter (én per bil).
- Balanserer vekten så ingen bil overstiger kapasiteten (standard 1 800 kg).
- Sorterer stopp i hver rute via nærmeste-nabo fra Borgeskogen.
- Genererer PDF med samlet rapport + én sjåførliste per bil.
- Alt lagres i nettleserens localStorage – ingen database, ingen pålogging.

## Ingen AI-kostnad

Denne versjonen bruker **kun manuell registrering** (ingen OCR-API).
Dispatcher skriver inn hvert stopp manuelt. Fordelene er:

- Ingen API-nøkler eller kjøretidskostnad.
- 100 % gratis å kjøre på Vercel sin free tier.
- Data forlater aldri brukerens enhet (unntatt geokoding av selve adressen).

## Deploy til Vercel (10 minutter)

Du trenger bare en GitHub-konto og en Vercel-konto (begge gratis).

### Steg 1 – Last opp koden til GitHub

1. Gå til <https://github.com/new> og opprett et nytt repo
   (f.eks. `schoyen-ruter-app`). La det stå som **Private** om du vil.
2. På datamaskinen: pakk ut denne mappen et sted, åpne Terminal, og kjør:

   ```bash
   cd schoyen-ruter-app
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/DITT-BRUKERNAVN/schoyen-ruter-app.git
   git push -u origin main
   ```

   (Bytt ut `DITT-BRUKERNAVN` med ditt GitHub-brukernavn.)

### Steg 2 – Koble til Vercel

1. Gå til <https://vercel.com/signup> og logg inn med GitHub.
2. Klikk **Add New → Project**.
3. Velg repoet `schoyen-ruter-app` fra listen.
4. Vercel detekterer Next.js automatisk. Trykk **Deploy**.
5. Etter ca. 1–2 minutter får du en URL som `schoyen-ruter-app.vercel.app`.
   Denne kan du bokmerke på mobilen.

### Steg 3 – (Valgfritt) Eget domene

Under **Settings → Domains** i Vercel kan du koble på et eget domene du
allerede eier, f.eks. `ruter.schoyen-horntvedt.no`.

## Kjøre lokalt for testing

```bash
npm install
npm run dev
```

Åpne <http://localhost:3000> i nettleseren.

## Slik bruker vennen din appen hver morgen

1. Åpne URL-en på mobilen (bokmerk den på hjemskjermen for hurtig tilgang).
2. Trykk **+ Legg til stopp**.
3. Ta bilde av føreseddelen (valgfritt – for referanse).
4. Fyll ut mottaker, adresse, kolli og bruttovekt. Resten er valgfritt.
5. Trykk **Lagre stopp**.
6. Gjenta for alle føresedlene (typisk 30–50 per dag).
7. Trykk **Generer ruter**. Appen geokoder adressene (ca. 1 sekund per stopp)
   og lager 4 ruter.
8. Trykk **Last ned samlet PDF** for én fil med alle 4 ruter, eller **PDF** på
   hver rute for å laste ned én sjåførliste per bil.
9. Send PDF-ene til sjåførene via Messenger, SMS eller e-post.

## Teknologi

- **Next.js 14** (App Router, TypeScript) – frontend + API-route
- **Tailwind CSS** – styling
- **jsPDF + jspdf-autotable** – PDF-generering (kjøres i nettleseren)
- **OpenStreetMap Nominatim** – gratis geokoding (via egen API-proxy for CORS)
- **localStorage** – lagrer stopp og innstillinger lokalt på enheten

## Begrensninger

- **Manuell inntasting kreves** – ingen OCR. Kan legges til senere ved å bytte
  til en Claude API-basert backend.
- **Nominatim rate limit**: 1 forespørsel per sekund. Ca. 40 stopp = ca. 45
  sekunder geokoding.
- **Lokallagring**: data er bundet til nettleseren på enheten. Bytter
  brukeren enhet, må dataene registreres på nytt.
- **Ingen autentisering**: URL-en er offentlig. Om flere bruker appen er det
  ingen skille mellom deres data (alt lagres i hver enhets egen localStorage).
- **Ingen multi-bruker-sync**: hvis flere dispatchere skal registrere stopp
  samtidig må dette utvides med backend (f.eks. Supabase).

## Videre utvikling (hvis dere får bruk for det)

- Auto-ekstraksjon av føresedler via Claude API (~2–10 kr/dag).
- Innlogging + delte lister for flere dispatchere (Supabase / Auth0).
- Eksport direkte til sjåførenes navigasjonsapp (Google Maps Waypoints).
- Trafikkestimater i sanntid (Google Maps Routes API – koster penger).
- Historikk / rapportering på tidligere dager.

## Kontakt / support

Appen er satt opp av Claude (Anthropic) for Sindre / Schøyen & Horntvedt AS.
