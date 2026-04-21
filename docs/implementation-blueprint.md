# FuelFlow Implementation Blueprint

## 1) Product Scope
FuelFlow is a crowd + partner powered real-time fuel intelligence platform. It combines community submissions, station-provided updates, and verification logic to deliver trustworthy prices, map-based discovery, and personalized alerts.

## 2) Core Architecture
- Frontend: Web app (React or Next.js) with map-first UX and fast price submission flow.
- Backend API: Auth, submissions, station management, alerts, reputation, analytics.
- Stream/Event Layer: Processes price update events and triggers verification, cache refresh, and notifications.
- Operational Data Store: Relational DB for stations, prices, users, alerts, reputation.
- Cache: Fast read model for map tiles, nearby results, and cheapest lists.
- Notification Service: Push, email, and optional SMS.
- Partner Layer: Dashboard + API for station operators.

Recommended deployment:
- API + worker services in containers.
- PostgreSQL for primary storage.
- Redis for caching and event queues.
- Object storage for station logos/media.

## 3) Domain Model

### User
- id (uuid)
- email, password_hash, role (driver, partner, admin)
- reputation_score (float)
- created_at, last_active_at

### Station
- id (uuid)
- brand_name, station_name
- address, city, country, postal_code
- latitude, longitude
- partner_owner_id (nullable)
- is_partner_verified (bool)
- created_at, updated_at

### FuelType
- id (uuid)
- code (e.g., diesel, e10, e5, premium95, premium98)
- display_name

### PriceReport
- id (uuid)
- station_id, fuel_type_id, user_id (nullable for partner API)
- source (community, partner_dashboard, partner_api)
- reported_price (decimal)
- currency
- reported_at (timestamp from source)
- submitted_at (server timestamp)
- confidence_score (0-1)
- verification_status (pending, verified, disputed, rejected)

### CanonicalStationPrice
- id (uuid)
- station_id, fuel_type_id
- current_price (decimal)
- currency
- last_verified_at
- staleness_state (fresh, aging, stale)
- derived_from_report_ids (array<uuid>)

### PriceConfirmation
- id (uuid)
- report_id
- confirmer_user_id
- action (confirm, correct)
- corrected_price (nullable)
- created_at

### AlertRule
- id (uuid)
- user_id
- fuel_type_id
- geo_center_lat, geo_center_lng, radius_km
- target_price_lte
- is_active
- channel (push, email, sms)
- cooldown_minutes

### ReputationEvent
- id (uuid)
- user_id
- event_type (accurate_submission, incorrect_submission, confirmation_helpful)
- score_delta
- created_at

### StationAnalyticsDaily
- id (uuid)
- station_id
- date
- profile_views
- map_impressions
- save_actions
- avg_competitor_delta

## 4) Requirement Mapping

### 4.1 Price Input System
Implementation:
- Public endpoint for manual submissions with station + fuel type + price.
- Partner dashboard form for operators.
- Partner API key auth for direct machine-to-machine updates.
- Verification engine compares incoming data with:
  - latest trusted partner value,
  - recent community consensus,
  - allowed price movement thresholds,
  - geofenced station/fuel context.

Output:
- report marked pending, verified, or disputed.
- canonical station price updated only when confidence passes threshold.

### 4.2 Real-Time Price Database
Implementation:
- Every submission stored with source timestamps and server timestamps.
- Staleness jobs run every 5-10 minutes:
  - fresh: updated within expected market interval,
  - aging: approaching expiry,
  - stale: likely outdated.
- Update requests:
  - notify nearby high-reputation users for stale prices,
  - request refresh from partner stations if integrated.

### 4.3 Interactive Map + Station Profiles
Implementation:
- Map endpoint returns nearby stations + current prices + freshness badges.
- Filters by fuel type and open status.
- Sort modes: cheapest, closest, recently updated.
- Station profile page:
  - current price card per fuel type,
  - last update source and time,
  - 24h/7d trend mini charts,
  - crowd confidence indicator.

### 4.4 Price-Drop Alerts
Implementation:
- User alert rules scoped by fuel type + area + threshold.
- Triggered whenever canonical price changes.
- Debounce/cooldown avoids duplicate spam.
- Delivery channels: push first, optional email/SMS fallback.

### 4.5 Collaboration Tools for Gas Stations
Implementation:
- Partner role with station ownership mapping.
- Dashboard features:
  - update prices manually,
  - view profile traffic analytics,
  - compare local competitors.
- API integration:
  - station API key + HMAC signature,
  - idempotency key for safe retries,
  - bulk update endpoint for multiple fuel types.

### 4.6 Community Features
Implementation:
- Any logged-in user can confirm or correct visible prices.
- Reputation model:
  - accurate reports increase score,
  - disputed/rejected reports reduce score,
  - trusted users get higher report weight.
- Anti-abuse controls:
  - rate limiting,
  - anomaly detection,
  - temporary trust suspension.

### 4.7 Clean, Simple UI
Implementation:
- Fast add-price flow: 3 steps max.
- Prominent nearby cheapest card.
- Readable hierarchy: price first, freshness second, details third.
- Trend visuals: small inline charts, no clutter.
- Mobile-first map interactions and one-handed input.

## 5) Verification Logic (MVP)
For each incoming report r:
1. Find last canonical price c for station + fuel type.
2. Build evidence set E from recent reports in rolling window (e.g., 90 minutes).
3. Compute weighted median using source reliability:
   - partner API > high-rep users > normal users.
4. Apply sanity gates:
   - absolute min/max market bounds,
   - max allowed delta from c unless confirmed by multiple independent sources.
5. Set confidence score from agreement and source trust.
6. Update canonical price when confidence >= threshold (e.g., 0.75).

## 6) API Surface (MVP)

Auth:
- POST /v1/auth/register
- POST /v1/auth/login

Stations + map:
- GET /v1/stations/nearby?lat=&lng=&radius_km=&fuel_type=&sort=
- GET /v1/stations/{stationId}

Prices:
- POST /v1/prices/report
- POST /v1/prices/confirm
- GET /v1/stations/{stationId}/prices/history?fuel_type=&range=

Alerts:
- POST /v1/alerts
- GET /v1/alerts
- PATCH /v1/alerts/{id}
- DELETE /v1/alerts/{id}

Partners:
- POST /v1/partner/prices/push
- POST /v1/partner/prices/push-bulk
- GET /v1/partner/analytics/overview

Admin/moderation:
- GET /v1/mod/reports/disputed
- POST /v1/mod/reports/{id}/resolve

## 7) Real-Time Event Flows

Price report flow:
- Submission accepted -> PriceReported event.
- Verification worker evaluates report.
- Canonical price updated -> CanonicalPriceChanged event.
- Alert worker matches rules and sends notifications.
- Cache invalidation updates map query performance.

Staleness flow:
- Scheduler checks station/fuel pairs by market cadence.
- Marks stale where needed.
- Dispatches update requests to users and partners.

## 8) Security + Trust
- JWT auth for users, API keys for partners.
- Signed partner payloads + nonce to prevent replay.
- Input validation for price bounds and station ownership.
- Rate limiting by IP and user.
- Audit logs for partner updates and moderation actions.

## 9) Observability
- Metrics:
  - report ingestion rate,
  - verification pass ratio,
  - stale percentage,
  - alert trigger and delivery latency.
- Logs with request IDs and event IDs.
- Tracing across API -> queue -> worker.

## 10) Phased Delivery Plan

Phase 1 (2-4 weeks):
- Station directory + map browsing.
- Manual price submission + simple verification.
- Canonical price table + freshness indicator.

Phase 2 (2-3 weeks):
- Alerts and notification channels.
- Confirmation/correction workflow.
- Reputation scoring baseline.

Phase 3 (3-4 weeks):
- Partner dashboard + partner API.
- Analytics module for stations.
- Stronger anti-abuse and moderation tooling.

## 11) Acceptance Criteria Snapshot
- Users can submit and see prices reflected in near real-time.
- System rejects or flags implausible updates.
- Map supports filtering and sorting by required modes.
- Alerts fire within target SLA after qualifying price drops.
- Partners can update prices via dashboard and API.
- Community confirmation improves confidence and data quality.
- UI supports quick mobile submission and clear comparisons.
