# NYC Apartment Check

Type an NYC address (and optionally an apartment) and get one report on the building and its block:

- **HPD**: open violations by class, tenant complaints, housing court cases (incl. harassment findings), marshal evictions, owner / managing agent from HPD registration
- **DOB**: DOB violations, ECB/OATH violations and unpaid fines, DOB complaints, BIS permits and DOB NOW filings/permits
- **311**: requests at the building (last 3 years) and within ~1 block (last 12 months)
- **NYPD**: reported crimes within 150 m / 400 m / 800 m on a map, compared to the NYC average density
- **Rent stabilization**: a likelihood estimate from building age and unit count, plus links to confirm with DHCR

It's a static site (plain HTML/CSS/JS, no build step, no server). Everything is fetched live in the browser from:

- [NYC Open Data](https://opendata.cityofnewyork.us/) (Socrata SODA API)
- [NYC Planning GeoSearch](https://geosearch.planninglabs.nyc/) for address → BBL/BIN/coordinates

Each section also links out to the official site (HPD Online, DOB BIS, DOB NOW, 311, NYPD Crime Map, Who Owns What, ZoLa).

Report URLs are shareable (e.g. `?q=530 East 169 Street, Bronx&apt=10E`).

## Hosting on GitHub Pages

1. Repo **Settings → Pages**
2. **Source:** "Deploy from a branch", **Branch:** `main`, folder `/ (root)` → Save
3. After about a minute the site is at `https://<your-username>.github.io/nyc-apartment-check/`

## Run locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Optional: Socrata app token

Without a token, NYC Open Data rate-limits requests by IP. That's fine for personal use. For heavier use, create a free app token at
https://data.cityofnewyork.us/profile/edit/developer_settings and paste it into `APP_TOKEN` at the top of `app.js`. App tokens are not secret.

## Datasets used

| Section | Dataset | ID |
|---|---|---|
| HPD | Housing Maintenance Code Violations | `wvxf-dwi5` |
| HPD | Housing Maintenance Code Complaints and Problems | `ygpa-z7cr` |
| HPD | Multiple Dwelling Registrations / Registration Contacts | `tesw-yqqr` / `feu5-w2e2` |
| HPD | Housing Litigations | `59kj-x8nc` |
| HPD | Evictions | `6z8x-wfk4` |
| DOB | DOB Violations | `3h2n-5cm9` |
| DOB | DOB ECB Violations | `6bgk-3dad` |
| DOB | DOB Complaints Received | `eabe-havv` |
| DOB | DOB Permit Issuance (BIS) | `ipu4-2q9a` |
| DOB | DOB NOW: Build – Job Application Filings | `w9ak-ipjd` |
| DOB | DOB NOW: Build – Approved Permits | `rbx6-tga4` |
| 311 | 311 Service Requests from 2020 to Present | `erm2-nwe9` |
| NYPD | NYPD Complaint Data Current (YTD) / Historic | `5uac-w243` / `qgea-i56i` |
| Building | PLUTO | `64uk-42ks` |

## Caveats

- Open data lags the live city systems by a day to a few weeks. NYPD data is published quarterly.
- NYPD complaint locations are moved to the nearest intersection or block midpoint for privacy.
- There's no public API for DHCR rent-stabilization status. The estimate here is a heuristic. Confirm it with the DHCR building list or by requesting the apartment's rent history.
- Not affiliated with the City of New York.
