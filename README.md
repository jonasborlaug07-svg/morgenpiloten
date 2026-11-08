# Morgenpiloten

Vekkerklokka som vet at toget er innstilt. Appen leser kalenderen på iPhonen, finner reisen med Entur og flytter alarmen når morgenen endrer seg:

| Hva skjer i natt | Hva Morgenpiloten gjør |
| --- | --- |
| Toget er innstilt | Vekker deg tidligere, med en ny rute klar |
| Toget er forsinket | Lar deg sove litt lenger: halve forsinkelsen, maks 10 minutter |
| Snø er meldt (MET) | Vekker deg 5 minutter før |
| Første time er avlyst | Flytter alarmen til neste avtale, eller slår den av |
| Ingenting før kl. 12, «Fri» eller helligdag | Ingen alarm |
| «Vekk meg» i kalenderen | Ringer på det klokkeslettet, også på en fridag |

Laget på 24 timer til hackathon.

## Kalenderen bestemmer

Oppsettet er ett trykk på «Koble til kalenderen». Etter det trenger du ikke åpne appen:

- **Når:** første avtale før kl. 12. Står det ingenting, ringer ingen alarm. Lørdag og søndag teller også.
- **Hvor:** stedet i avtalen, slått opp med Entur og Apple Kart. Mangler det, brukes det vanlige reisemålet.
- **Fri:** en heldagsavtale som heter «Fri», «Ferie» eller «Syk».
- **Vekk meg:** en avtale som heter «Vekk meg» (eller «Alarm», «Stå opp») ringer på det klokkeslettet.
- **Avlyst:** avtaler med status avlyst, eller «Avlyst» i tittelen.
- **Hjem:** fra posisjonen ved oppstart. Åpner du appen et annet sted enn hjemme etter kl. 22, starter morgendagens reise der, med angreknapp.

## Kjør appen

Krever Node, en iPhone med Expo Go og at Mac og iPhone er på samme nett (iPhone-hotspot fungerer når skolenettet blokkerer).

```bash
npm install
npx expo start --go
```

Skann QR-koden med kameraet på iPhonen. Hold inne MORGENPILOTEN øverst i appen for å åpne demo-panelet.

Sjekker:

```bash
npx tsc --noEmit
npx expo lint
```

## Slik er det bygget

```
App.tsx              Hovedskjermen: vekketid, hvorfor, avganger, uka, innstillinger og demo-panel
src/Onboarding.tsx   Oppstarten: kalender, varsler og posisjon i ett trykk
src/logic.ts         Selve regelen for vekketid (delt med serveren, ingen React Native)
src/plan.ts          Henter reisen for én morgen fra Entur (delt med serveren)
src/api.ts           Entur reisesøk og stedssøk, MET værvarsel (delt med serveren)
src/calendar.ts      Leser iPhone-kalenderen: avtaler, «Fri» og «Vekk meg»
src/week.ts          Planlegger alle sju morgener, så alarmene står selv om appen er lukket
src/alarm.ts         Alarmen: fem varsler med ett minutts mellomrom
src/background.ts    Bakgrunnsoppdatering når iOS tillater det
src/server.ts        Sender reisen til serveren
supabase/functions/morgenpiloten/   Serveren (Supabase Edge Function)
```

Appen og serveren bruker samme kode for å regne ut vekketiden. Etter endringer i `src/logic.ts`, `src/plan.ts` eller `src/api.ts`:

```bash
sh scripts/copy-shared.sh
supabase functions deploy morgenpiloten
```

Serveren sjekker hver reise mot Entur hvert 5. minutt om natta (pg_cron), og sjekkloggene slettes etter to døgn.

## Data

- [Entur](https://developer.entur.org/) Journey Planner v3 og Geocoder: sanntid, innstillinger og reisesøk for all kollektivtrafikk i Norge.
- [MET Norge](https://api.met.no/) Locationforecast 2.0: nedbør og temperatur for snøregelen.
- iPhone-kalenderen, lest på telefonen.

## Personvern

Avtaletitlene blir på telefonen. Serveren får bare tidspunkt, sted, om avtalen er avlyst og om du har fri eller ba om vekking.

## Kjente begrensninger

- Alarmen er et varsel som følger stillebryteren, fordi appen kjører i Expo Go. Med Apple Developer-konto kan den bruke AlarmKit og ringe som Klokke-appen.
- iOS bestemmer når appen får oppdatere seg i bakgrunnen. Med push kan serveren flytte alarmen med en gang.
- Snø regnes fra værvarselet, ikke fra hvor mye snø som ligger.
