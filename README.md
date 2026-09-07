# Faktura

Fakturering og bogholderi for én person: fakturaer, kreditnotaer, udgifter med bilag, kvartalsvis moms og en
komplet eksport til revisor. Ét brugernavn-løst kodeord, én container, én mappe med alle data.

Erstatter HurtigFaktura og Excel-arket. Bygget til at kunne forsvares over for en revisor: ubrudt fakturanummerserie,
uforanderlige udstedte dokumenter, hver post sporbar til en gemt PDF, og fem års opbevaring.

## Kør

Krav: Docker med `docker compose`.

```bash
git clone <repo> faktura && cd faktura
export APP_PASSWORD='et-langt-kodeord'
docker compose up -d --build
```

Appen svarer på <http://localhost:3000>. Log ind med `APP_PASSWORD`. Kør den kun på et privat netværk
(fx Tailscale); der er ingen TLS og ingen brugerstyring ud over det ene kodeord.

Udfyld **Indstillinger** (firmanavn, adresse, CVR, bank) før den første faktura udstedes – felterne er
lovpligtige på fakturaen, og udstedelse afvises, hvis de mangler.

Testdata (3 kunder, fakturaer 1001–1006, 8 udgifter) på en tom database:

```bash
docker compose exec app npm run seed
```

Seed afbrydes, hvis databasen allerede indeholder fakturaer eller udgifter. Den kører som en separat proces mod
den samme SQLite-fil (WAL gør det sikkert); brug den kun på en tom database, aldrig mens der udstedes fakturaer.

### Lokal udvikling

```bash
npm install
npx playwright install chromium
DATA_DIR=./data APP_PASSWORD=dev npm run dev      # http://localhost:3000
npm test                                          # bygger, seeder en temp-database og kører alle tests
```

Miljøvariabler: `APP_PASSWORD` (påkrævet), `DATA_DIR` (standard `/data`), `PROJECT_ROOT` (mappen med
`tokens.css`/`drizzle/`, standard: arbejdsmappen), `PORT` (3000), `HOST` (0.0.0.0), `BODY_SIZE_LIMIT`
(request-grænse, `25M` i containeren; uploads afvises pænt over 20 MB), `TZ` (kun for logtidsstempler; datoer i
appen beregnes altid i Europe/Copenhagen).

## Hvor data ligger

Alt persistent ligger under `/data` i containeren (`./data` på værten via compose):

| Sti | Indhold |
|---|---|
| `/data/app.db` (+ `-wal`, `-shm`) | SQLite-databasen (WAL-tilstand) |
| `/data/files/invoices/{nummer}.pdf` | Den udstedte faktura/kreditnota – det juridiske dokument. Genereres aldrig igen. |
| `/data/files/expenses/{bilagsnr}.{pdf,jpg,png}` | Uploadede udgiftsbilag |

Intet andet sted holder tilstand. Containeren kan slettes og bygges igen; med samme `./data` er alt intakt.

### Nummerserien

Næste fakturanummer ligger i tabellen `setting` under nøglen `next_invoice_number` (standard 1001) og
vises under **Indstillinger → Nummerserie**. Nummeret tildeles først i det øjeblik en kladde udstedes, i samme
transaktion som statusskiftet, så serien aldrig får huller. Kladder har intet nummer og må slettes; udstedte
dokumenter kan ikke slettes eller ændres – kun modposteres med en kreditnota, som selv får næste nummer.
Værdien kan kun sættes op, og ændringen skrives i revisionssporet (`audit_log`). Det er den eneste måde, serien
kan få et hul: en bevidst, logget opjustering. Appen selv springer aldrig et nummer over – nummeret tildeles først,
når PDF'en er genereret, og hele skiftet (nummer, status, filsti) sker i én transaktion; slår den fejl, forbliver
kladden uden nummer, og den midlertidige PDF slettes.

Uforanderligheden håndhæves også i selve databasen: triggere afviser `UPDATE`/`DELETE` på `audit_log`, sletning af
udstedte fakturaer, ændring af udstedte fakturaers indhold og ændring af deres linjer – uanset hvilken kode eller
hvilket SQL-værktøj der forsøger.

Udgiftsbilag nummereres fortløbende fra 1 ved oprettelse (`voucher_number`).

## Backup

Bogføringsloven kræver, at regnskabsmaterialet opbevares i fem år, og at der findes en sikkerhedskopi hos en
tredjepart (et andet sted end på serveren). En backup er en kopi af hele `data`-mappen.

Manuelt, mens appen kører. SQLite's online-backup giver en konsistent kopi af databasen (`app.db.backup`), som
pakkes sammen med `files/` – den levende `app.db`/`-wal`/`-shm` tages ikke med, for de kan være midt i en skrivning:

```bash
docker compose exec app node -e "require('better-sqlite3')('/data/app.db').backup('/data/app.db.backup').then(()=>process.exit(0))"
tar czf faktura-backup-$(date +%F).tar.gz -C data app.db.backup files
rm data/app.db.backup
```

Alternativt er **Eksport**-knappen i appen den revisor-venlige variant: én zip med `invoices.csv`,
`invoice_lines.csv`, `expenses.csv`, `audit_log.csv` og alle filer under `files/`.

### Cron: natlig kopi til et andet sted

Eksempel på `/etc/cron.d/faktura-backup` på værten, som hver nat kl. 02:30 laver en konsistent kopi og
sender den off-box med `rsync` over SSH (skift `backup@nas.example` til jeres fjernmål – en NAS hos et andet
firma, en VPS eller et objektlager via `rclone`):

```cron
30 2 * * * root cd /srv/faktura && docker compose exec -T app node -e "require('better-sqlite3')('/data/app.db').backup('/data/app.db.backup').then(()=>process.exit(0))" && tar czf /var/backups/faktura-$(date +\%F).tar.gz -C /srv/faktura/data app.db.backup files && rm -f data/app.db.backup && rsync -a /var/backups/faktura-*.tar.gz backup@nas.example:/backups/faktura/ && find /var/backups -name 'faktura-*.tar.gz' -mtime +60 -delete
```

Fjernmålet skal selv beholde kopierne i mindst fem år (rotationen ovenfor rydder kun lokalt efter 60 dage).
Test jævnligt, at en kopi kan gendannes.

## Gendan

1. Stop appen: `docker compose down`.
2. Flyt den gamle `data`-mappe væk (`mv data data.gammel`) og pak backuppen ud i en ny:
   `mkdir data && tar xzf faktura-backup-YYYY-MM-DD.tar.gz -C data`.
3. Omdøb kopien til det levende databasenavn: `mv data/app.db.backup data/app.db`. Der må ikke ligge nogen
   `app.db-wal`/`app.db-shm` fra en anden kopi ved siden af (backup-kopien er selvstændig og har ingen).
4. Start igen: `docker compose up -d`. Migreringer kører automatisk ved start.
5. Kontrollér under **Fakturaer**, at det seneste nummer og PDF'erne er til stede, og at **Indstillinger →
   Næste fakturanummer** stemmer.

Ved gendannelse fra eksport-zippen (uden databasen) genskabes databasen ikke automatisk – zippen er til
revisor og dokumentation, `data`-mappen er den egentlige backup.

## Regler, der er bygget ind

- Fakturanummer tildeles kun ved udstedelse, fra `next_invoice_number`, i samme transaktion som status → `issued`.
  Udstedelser serialiseres, så samtidige forsøg altid giver fortløbende numre.
- Udstedte fakturaer og deres linjer er skrivebeskyttede i API-laget (409 Conflict). Eneste korrektion er en kreditnota.
- PDF'en genereres ved udstedelse fra en HTML-skabelon (samme designtokens) og gemmes som `files/invoices/{nummer}.pdf`.
- Momsrapporten beregnes live pr. kvartal: salgsmoms (fakturadato, kreditnotaer modregnes), købsmoms (bilagsdato), momstilsvar.
- Alle oprettelser, udstedelser, krediteringer, ændringer og uploads skrives til `audit_log`, som kun kan tilføjes til.
- Alle beløb gemmes som heltal i øre; DKK er eneste valuta.

## Design

`tokens.css`, `style.md` og `example.html` i rodmappen er designautoriteten. Appen nægter at starte, hvis de mangler.
`tokens.css` er det eneste sted, farver, typografi, afstande og radier defineres; alle stylesheets refererer til dem.
Faktura-PDF'en bruger de samme tokens under printreglerne i `style.md`.

## Sikkerhed og drift

- Ét delt kodeord (`APP_PASSWORD`), sammenlignet tidskonstant; sessionen er en HMAC af kodeordet i en `HttpOnly`,
  `SameSite=Lax`-cookie (30 dage). Skift kodeordet, og alle sessioner er ugyldige. Fem forkerte forsøg fra samme
  adresse giver 30 sekunders pause.
- Cookien er ikke `Secure`, fordi appen taler ren HTTP på det private net. Sæt en TLS-proxy foran, hvis den nogensinde
  skal ud af Tailscale, og slå `Secure` til i `src/routes/login/+page.server.ts`.
- CSRF: skrivende requests med en `Origin`, der ikke matcher værtsnavnet, afvises (403), uanset hvilket navn appen
  tilgås under. Content-Security-Policy er sat (kun egne scripts/styles).
- `npm audit` melder to transitive fund (`cookie` via SvelteKit, `esbuild` via drizzle-kit). Ingen af dem er
  udnyttelige her: cookie-navne/-værdier sættes kun af appen selv, og esbuild's udviklingsserver kører ikke i drift.
- Containeren kører som root, fordi `/data` er et bind-mount med værtens rettigheder; Chromium kører derfor med
  `--no-sandbox`, hvilket er acceptabelt, da den kun renderer appens egen HTML.

## Teknik

SvelteKit (Svelte 5, adapter-node), SQLite via Drizzle ORM (better-sqlite3, WAL), Playwright/Chromium til PDF,
Vitest. Ingen eksterne tjenester, ingen telemetri, ingen CDN.

- `npm run dev` – udvikling
- `npm run build && npm start` – produktion
- `npm test` – bygger, seeder en midlertidig database, starter serveren og kører unit- og API-tests
- `npm run seed` – testdata på en tom database
- `npm run db:generate` – ny migrering efter ændringer i `src/lib/server/schema.ts`
