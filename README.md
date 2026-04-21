# FuelFlow

FuelFlow is a real-time fuel price platform that helps drivers find the cheapest nearby gas stations, while allowing stations to publish verified official pricing.

## Run The App

1. Install dependencies:

```bash
pip install -r requirements.txt
```

2. Start the API + web app:

```bash
uvicorn app.main:app --reload
```

3. Open:

- http://127.0.0.1:8000

## What Is Implemented (MVP)

- Price input system:
	- Community price submission endpoint and UI form.
	- Partner push endpoint using API key authentication.
	- Verification status assigned as verified, pending, or disputed.
- Real-time storage:
	- SQLite persistence for stations, reports, canonical prices, alerts, and confirmations.
	- Staleness state computed from last update timestamps.
- Interactive map + profiles:
	- Leaflet map with nearby station markers.
	- Filter by fuel type and sort by closest, cheapest, or recently updated.
	- Station profile details with live fuel cards and recent reports.
- Price-drop alerts:
	- Alert creation per fuel type, radius, and target price.
	- Polling check endpoint that returns triggered matches with cooldown handling.
- Collaboration for stations:
	- Partner API key table and secure partner price push endpoint.
	- Basic partner analytics overview endpoint.
- Community features:
	- Confirmation and correction endpoint for community moderation.

## Demo Partner API Keys

Partner keys are auto-generated from the first station found for each brand:

- Circle K: `partner-circlek-demo-key`
- Alexela: `partner-alexela-demo-key`
- Olerex: `partner-olerex-demo-key`
- Neste: `partner-neste-demo-key`

Use with header:

- `X-API-Key: <key>`

## What FuelFlow Needs To Build

1. Price Input System
- Community users can submit prices for any station.
- Partner stations can push official prices through a dashboard or API.
- Verification compares multiple sources before updating trusted live prices.

2. Real-Time Price Database
- Every price report is stored with source and timestamps.
- Stale prices are automatically marked and refresh requests are sent.

3. Interactive Map + Station Profiles
- Map shows price, distance, and last update time.
- Users can filter by fuel type and sort by cheapest or closest.

4. Price-Drop Alerts
- Users define thresholds per fuel type and area.
- Alerts trigger instantly when verified prices drop below targets.

5. Collaboration Tools for Gas Stations
- Partner login to manage station prices directly.
- Optional API integration for internal system syncing.
- Station analytics for visits, trends, and competitive position.

6. Community Features
- Users confirm or correct prices.
- Reputation scoring weights trusted contributors more heavily.

7. Clean, Simple UI
- Fast submission flow and map-first discovery.
- Clear comparison cards and lightweight trend visuals.

## Implementation Blueprint

Detailed architecture, data model, APIs, event flows, and phased delivery are documented in:

- docs/implementation-blueprint.md
