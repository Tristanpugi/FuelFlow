from __future__ import annotations

import math
import os
import secrets
import sqlite3
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from fastapi import FastAPI, Header, HTTPException, Query, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field, EmailStr
from jose import JWTError, jwt
from passlib.context import CryptContext

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "fuelflow.db"
STATIC_DIR = BASE_DIR / "static"
ESTONIA_BRANDS = {"Circle K", "Alexela", "Olerex", "Neste"}
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# ── Auth config ──────────────────────────────────────────────────────────────
SECRET_KEY = os.environ.get("JWT_SECRET", secrets.token_hex(32))
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 30

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)

# Google OAuth (optional — set env vars to enable)
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.environ.get("GOOGLE_REDIRECT_URI", "http://localhost:8000/auth/google/callback")

app = FastAPI(title="FuelFlow API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class PriceReportIn(BaseModel):
    station_id: int
    fuel_type: Literal["diesel", "e10", "premium95", "premium98"]
    price: float = Field(gt=0)
    source: Literal["community", "partner_dashboard", "partner_api"] = "community"
    user_id: int | None = None


class PriceConfirmIn(BaseModel):
    report_id: int
    user_id: int
    action: Literal["confirm", "correct"]
    corrected_price: float | None = Field(default=None, gt=0)


class AlertIn(BaseModel):
    user_id: int
    fuel_type: Literal["diesel", "e10", "premium95", "premium98"]
    target_price_lte: float = Field(gt=0)
    radius_km: float = Field(gt=0, le=500)
    lat: float
    lng: float
    cooldown_minutes: int = Field(default=30, ge=1, le=1440)


class PartnerPushIn(BaseModel):
    station_id: int
    prices: dict[str, float]


# ── Auth models ───────────────────────────────────────────────────────────────
class RegisterIn(BaseModel):
    email: str
    password: str = Field(min_length=6)
    name: str = Field(min_length=1)


class LoginIn(BaseModel):
    email: str
    password: str


class FavoriteIn(BaseModel):
    station_id: int


class UserAlertTargetsIn(BaseModel):
    diesel: float | None = None
    premium95: float | None = None
    premium98: float | None = None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_ts(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


# ── Auth helpers ──────────────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(account_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    return jwt.encode({"sub": str(account_id), "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


def get_current_account(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict | None:
    if credentials is None:
        return None
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        account_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        return None
    conn = get_conn()
    row = conn.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone()
    conn.close()
    if row is None:
        return None
    return dict(row)


def require_account(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    account = get_current_account(credentials)
    if account is None:
        raise HTTPException(status_code=401, detail="Sisselogimine nõutud")
    return account


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def verification_weight(source: str) -> float:
    if source == "partner_api":
        return 1.0
    if source == "partner_dashboard":
        return 0.9
    return 0.7


def verification_status(reports: list[sqlite3.Row], price: float) -> tuple[str, float]:
    if not reports:
        return "pending", 0.5

    weighted_total = 0.0
    weight_sum = 0.0
    for row in reports:
        w = verification_weight(row["source"])
        weighted_total += row["price"] * w
        weight_sum += w
    consensus = weighted_total / max(weight_sum, 0.0001)

    delta = abs(price - consensus)
    confidence = max(0.0, min(1.0, 1 - (delta / max(consensus, 0.1))))
    if delta <= 0.04:
        return "verified", max(confidence, 0.8)
    if delta <= 0.09:
        return "pending", confidence
    return "disputed", confidence


def update_canonical_price(conn: sqlite3.Connection, station_id: int, fuel_type: str) -> None:
    recent_rows = conn.execute(
        """
        SELECT price, source, submitted_at
        FROM price_reports
        WHERE station_id = ? AND fuel_type = ? AND verification_status IN ('verified', 'pending')
        ORDER BY submitted_at DESC
        LIMIT 10
        """,
        (station_id, fuel_type),
    ).fetchall()
    if not recent_rows:
        return

    weighted_total = 0.0
    weight_sum = 0.0
    for row in recent_rows:
        w = verification_weight(row["source"])
        weighted_total += row["price"] * w
        weight_sum += w

    canonical = round(weighted_total / max(weight_sum, 0.0001), 3)
    conn.execute(
        """
        INSERT INTO station_prices (station_id, fuel_type, price, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(station_id, fuel_type) DO UPDATE SET
            price = excluded.price,
            updated_at = excluded.updated_at
        """,
        (station_id, fuel_type, canonical, now_iso()),
    )


def staleness_state(updated_at: str | None) -> str:
    ts = parse_ts(updated_at)
    if ts is None:
        return "stale"
    age = datetime.now(timezone.utc) - ts
    if age < timedelta(minutes=35):
        return "fresh"
    if age < timedelta(minutes=90):
        return "aging"
    return "stale"


def normalize_brand(raw_brand: str) -> str | None:
    value = raw_brand.strip().lower()
    if "circle k" in value:
        return "Circle K"
    if "alexela" in value:
        return "Alexela"
    if "olerex" in value:
        return "Olerex"
    if "neste" in value:
        return "Neste"
    return None


def fetch_estonia_brand_stations() -> list[tuple[str, str, str, str, float, float, int]]:
    query = """
[out:json][timeout:40];
area["ISO3166-1"="EE"]["admin_level"="2"]->.searchArea;
(
  node["amenity"="fuel"]["brand"~"^(Circle K|Alexela|Olerex|Neste.*)$", i](area.searchArea);
  way["amenity"="fuel"]["brand"~"^(Circle K|Alexela|Olerex|Neste.*)$", i](area.searchArea);
  relation["amenity"="fuel"]["brand"~"^(Circle K|Alexela|Olerex|Neste.*)$", i](area.searchArea);
);
out center tags;
""".strip()

    request = Request(
        OVERPASS_URL,
        data=urlencode({"data": query}).encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": "FuelFlow/0.1"},
        method="POST",
    )
    with urlopen(request, timeout=45) as response:
        payload = json.loads(response.read().decode("utf-8"))

    stations: list[tuple[str, str, str, str, float, float, int]] = []
    seen: set[tuple[str, float, float]] = set()
    for element in payload.get("elements", []):
        tags = element.get("tags", {})
        raw_brand = tags.get("brand") or tags.get("operator") or ""
        brand = normalize_brand(raw_brand)
        if brand is None:
            continue

        lat = element.get("lat")
        lng = element.get("lon")
        if lat is None or lng is None:
            center = element.get("center", {})
            lat = center.get("lat")
            lng = center.get("lon")
        if lat is None or lng is None:
            continue

        key = (brand, round(float(lat), 5), round(float(lng), 5))
        if key in seen:
            continue
        seen.add(key)

        city = tags.get("addr:city") or tags.get("addr:place") or "Estonia"
        street = tags.get("addr:street", "")
        house_number = tags.get("addr:housenumber", "")
        address = f"{street} {house_number}".strip() or city
        station_name = tags.get("name") or f"{brand} {city}"
        is_partner_verified = 1 if brand in {"Circle K", "Alexela", "Neste"} else 0
        stations.append((brand, station_name, address, city, float(lat), float(lng), is_partner_verified))

    return stations


def demo_fallback_stations() -> list[tuple[str, str, str, str, float, float, int]]:
    return [
        ("Circle K", "Circle K Kesklinn", "Narva mnt 2", "Tallinn", 59.4373, 24.7536, 1),
        ("Alexela", "Alexela Mustamae", "Akadeemia tee 31", "Tallinn", 59.4078, 24.6863, 1),
        ("Olerex", "Olerex Lasnamae", "Peterburi tee 71", "Tallinn", 59.4340, 24.8478, 0),
        ("Neste", "Neste Tallinn", "Smuuli tee 4", "Tallinn", 59.4395, 24.8073, 1),
        ("Circle K", "Circle K Tartu", "Riia 2", "Tartu", 58.3776, 26.7290, 1),
        ("Alexela", "Alexela Tartu", "Turu 45", "Tartu", 58.3691, 26.7476, 0),
        ("Olerex", "Olerex Parnu", "Tallinna mnt 82", "Parnu", 58.3859, 24.4971, 0),
        ("Neste", "Neste Parnu", "Papiniidu 50", "Parnu", 58.3672, 24.5095, 1),
    ]


def generated_prices(lat: float, lng: float) -> tuple[float, float, float]:
    # Generate stable demo prices from coordinates so every station has a value.
    variation = abs((lat * 1000 + lng * 700) % 11) / 1000
    diesel = round(1.569 + variation, 3)
    e10 = round(diesel + 0.04, 3)
    premium95 = round(e10 + 0.06, 3)
    return diesel, e10, premium95


def init_db() -> None:
    conn = get_conn()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            reputation_score REAL NOT NULL DEFAULT 0.5,
            role TEXT NOT NULL DEFAULT 'driver'
        );

        CREATE TABLE IF NOT EXISTS stations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            brand_name TEXT NOT NULL,
            station_name TEXT NOT NULL,
            address TEXT NOT NULL,
            city TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            is_partner_verified INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS station_prices (
            station_id INTEGER NOT NULL,
            fuel_type TEXT NOT NULL,
            price REAL NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(station_id, fuel_type),
            FOREIGN KEY(station_id) REFERENCES stations(id)
        );

        CREATE TABLE IF NOT EXISTS price_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            station_id INTEGER NOT NULL,
            fuel_type TEXT NOT NULL,
            user_id INTEGER,
            source TEXT NOT NULL,
            price REAL NOT NULL,
            confidence_score REAL NOT NULL,
            verification_status TEXT NOT NULL,
            submitted_at TEXT NOT NULL,
            FOREIGN KEY(station_id) REFERENCES stations(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS price_confirmations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            report_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            corrected_price REAL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(report_id) REFERENCES price_reports(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            fuel_type TEXT NOT NULL,
            target_price_lte REAL NOT NULL,
            radius_km REAL NOT NULL,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            cooldown_minutes INTEGER NOT NULL,
            last_notified_at TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS partner_keys (
            station_id INTEGER PRIMARY KEY,
            api_key TEXT NOT NULL UNIQUE,
            FOREIGN KEY(station_id) REFERENCES stations(id)
        );

        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT,
            name TEXT NOT NULL,
            google_id TEXT UNIQUE,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS user_favorites (
            account_id INTEGER NOT NULL,
            station_id INTEGER NOT NULL,
            added_at TEXT NOT NULL,
            PRIMARY KEY (account_id, station_id),
            FOREIGN KEY(account_id) REFERENCES accounts(id),
            FOREIGN KEY(station_id) REFERENCES stations(id)
        );

        CREATE TABLE IF NOT EXISTS user_alert_targets (
            account_id INTEGER PRIMARY KEY,
            diesel REAL,
            premium95 REAL,
            premium98 REAL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(account_id) REFERENCES accounts(id)
        );
        """
    )

    user_count = conn.execute("SELECT COUNT(*) as c FROM users").fetchone()["c"]
    if user_count == 0:
        conn.executemany(
            "INSERT INTO users (name, reputation_score, role) VALUES (?, ?, ?)",
            [
                ("Demo Driver", 0.7, "driver"),
                ("Trusted Driver", 0.9, "driver"),
                ("Station Owner", 0.8, "partner"),
            ],
        )

    station_count = conn.execute("SELECT COUNT(*) as c FROM stations").fetchone()["c"]
    brand_rows = conn.execute("SELECT DISTINCT brand_name FROM stations").fetchall()
    existing_brands = {row["brand_name"] for row in brand_rows}
    if existing_brands != ESTONIA_BRANDS or station_count < 30:
        # Re-seed demo data so the app is Estonia-only and brand-restricted.
        conn.execute("DELETE FROM price_confirmations")
        conn.execute("DELETE FROM price_reports")
        conn.execute("DELETE FROM station_prices")
        conn.execute("DELETE FROM partner_keys")
        conn.execute("DELETE FROM stations")

        stations: list[tuple[str, str, str, str, float, float, int]] = []
        try:
            stations = fetch_estonia_brand_stations()
        except Exception:
            stations = []
        if not stations:
            stations = demo_fallback_stations()

        first_partner_station: dict[str, int] = {}
        for brand, station_name, address, city, lat, lng, is_partner_verified in stations:
            cursor = conn.execute(
                """
                INSERT INTO stations (brand_name, station_name, address, city, latitude, longitude, is_partner_verified)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (brand, station_name, address, city, lat, lng, is_partner_verified),
            )
            station_id = int(cursor.lastrowid)
            if brand not in first_partner_station:
                first_partner_station[brand] = station_id

            diesel, e10, premium95 = generated_prices(lat, lng)
            conn.executemany(
                "INSERT INTO station_prices (station_id, fuel_type, price, updated_at) VALUES (?, ?, ?, ?)",
                [
                    (station_id, "diesel", diesel, now_iso()),
                    (station_id, "e10", e10, now_iso()),
                    (station_id, "premium95", premium95, now_iso()),
                ],
            )

        for brand, station_id in first_partner_station.items():
            key_value = f"partner-{brand.lower().replace(' ', '')}-demo-key"
            conn.execute(
                "INSERT INTO partner_keys (station_id, api_key) VALUES (?, ?)",
                (station_id, key_value),
            )

    conn.commit()
    conn.close()


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/login")
def login_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "login.html")


# ── Auth endpoints ─────────────────────────────────────────────────────────────

@app.post("/auth/register")
def register(body: RegisterIn) -> dict:
    conn = get_conn()
    existing = conn.execute("SELECT id FROM accounts WHERE email = ?", (body.email,)).fetchone()
    if existing:
        conn.close()
        raise HTTPException(status_code=409, detail="See e-mail on juba kasutusel")
    hashed = hash_password(body.password)
    cursor = conn.execute(
        "INSERT INTO accounts (email, password_hash, name, created_at) VALUES (?, ?, ?, ?)",
        (body.email.lower().strip(), hashed, body.name.strip(), now_iso()),
    )
    account_id = int(cursor.lastrowid)
    conn.commit()
    conn.close()
    token = create_access_token(account_id)
    return {"token": token, "name": body.name.strip(), "email": body.email.lower().strip()}


@app.post("/auth/login")
def login(body: LoginIn) -> dict:
    conn = get_conn()
    row = conn.execute("SELECT * FROM accounts WHERE email = ?", (body.email.lower().strip(),)).fetchone()
    conn.close()
    if row is None or row["password_hash"] is None or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Vale e-mail või parool")
    token = create_access_token(row["id"])
    return {"token": token, "name": row["name"], "email": row["email"]}


@app.get("/auth/me")
def me(account: dict = Depends(require_account)) -> dict:
    return {"id": account["id"], "name": account["name"], "email": account["email"]}


# ── Google OAuth ──────────────────────────────────────────────────────────────

@app.get("/auth/google")
def google_login() -> RedirectResponse:
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=501, detail="Google OAuth pole seadistatud")
    params = urlencode({
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
    })
    return RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{params}")


@app.get("/auth/google/callback")
def google_callback(code: str = Query(...)) -> RedirectResponse:
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=501, detail="Google OAuth pole seadistatud")
    # Exchange code for token
    token_req = Request(
        "https://oauth2.googleapis.com/token",
        data=urlencode({
            "code": code,
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri": GOOGLE_REDIRECT_URI,
            "grant_type": "authorization_code",
        }).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        token_resp = json.loads(urlopen(token_req, timeout=10).read())
    except HTTPError as exc:
        try:
            error_payload = json.loads(exc.read().decode("utf-8"))
            error_detail = error_payload.get("error_description") or error_payload.get("error") or "Google token exchange ebaõnnestus"
        except Exception:
            error_detail = "Google token exchange ebaõnnestus"
        raise HTTPException(status_code=400, detail=error_detail)
    except Exception:
        raise HTTPException(status_code=400, detail="Google token exchange ebaõnnestus")

    try:
        id_token_str = token_resp["id_token"]
        claims = jwt.get_unverified_claims(id_token_str)
        google_id = claims["sub"]
        email = claims.get("email", "")
        name = claims.get("name", email.split("@")[0])
    except Exception:
        raise HTTPException(status_code=400, detail="Google ID tokeni lugemine ebaõnnestus")

    conn = get_conn()
    row = conn.execute("SELECT * FROM accounts WHERE google_id = ?", (google_id,)).fetchone()
    if row is None:
        # Try match by email
        row = conn.execute("SELECT * FROM accounts WHERE email = ?", (email.lower(),)).fetchone()
        if row:
            conn.execute("UPDATE accounts SET google_id = ? WHERE id = ?", (google_id, row["id"]))
        else:
            cursor = conn.execute(
                "INSERT INTO accounts (email, name, google_id, created_at) VALUES (?, ?, ?, ?)",
                (email.lower(), name, google_id, now_iso()),
            )
            row = conn.execute("SELECT * FROM accounts WHERE id = ?", (int(cursor.lastrowid),)).fetchone()
        conn.commit()
    conn.close()
    token = create_access_token(row["id"])
    return RedirectResponse(f"/?token={token}&name={row['name']}")


# ── Favorites (server-side) ───────────────────────────────────────────────────

@app.get("/api/me/favorites")
def get_favorites(account: dict = Depends(require_account)) -> list[dict]:
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT s.id, s.brand_name, s.station_name, s.address, s.city,
               s.latitude AS lat, s.longitude AS lng, uf.added_at
        FROM user_favorites uf
        JOIN stations s ON s.id = uf.station_id
        WHERE uf.account_id = ?
        ORDER BY uf.added_at DESC
        """,
        (account["id"],),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/me/favorites")
def add_favorite(body: FavoriteIn, account: dict = Depends(require_account)) -> dict:
    conn = get_conn()
    conn.execute(
        "INSERT OR IGNORE INTO user_favorites (account_id, station_id, added_at) VALUES (?, ?, ?)",
        (account["id"], body.station_id, now_iso()),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.delete("/api/me/favorites/{station_id}")
def remove_favorite(station_id: int, account: dict = Depends(require_account)) -> dict:
    conn = get_conn()
    conn.execute(
        "DELETE FROM user_favorites WHERE account_id = ? AND station_id = ?",
        (account["id"], station_id),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


# ── Alert targets (server-side) ───────────────────────────────────────────────

@app.get("/api/me/alert-targets")
def get_alert_targets(account: dict = Depends(require_account)) -> dict:
    conn = get_conn()
    row = conn.execute("SELECT * FROM user_alert_targets WHERE account_id = ?", (account["id"],)).fetchone()
    conn.close()
    if row is None:
        return {"diesel": None, "premium95": None, "premium98": None}
    return {"diesel": row["diesel"], "premium95": row["premium95"], "premium98": row["premium98"]}


@app.put("/api/me/alert-targets")
def set_alert_targets(body: UserAlertTargetsIn, account: dict = Depends(require_account)) -> dict:
    conn = get_conn()
    conn.execute(
        """
        INSERT INTO user_alert_targets (account_id, diesel, premium95, premium98, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(account_id) DO UPDATE SET
            diesel = excluded.diesel,
            premium95 = excluded.premium95,
            premium98 = excluded.premium98,
            updated_at = excluded.updated_at
        """,
        (account["id"], body.diesel, body.premium95, body.premium98, now_iso()),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


@app.get("/api/stations")
def list_stations(
    lat: float = Query(...),
    lng: float = Query(...),
    radius_km: float = Query(350.0, gt=0, le=500),
    fuel_type: Literal["diesel", "e10", "premium95", "premium98"] = Query("diesel"),
    sort: Literal["closest", "cheapest", "updated"] = Query("closest"),
) -> list[dict[str, Any]]:
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT s.id, s.brand_name, s.station_name, s.address, s.city,
               s.latitude, s.longitude, s.is_partner_verified,
               sp.price, sp.updated_at
        FROM stations s
        LEFT JOIN station_prices sp
          ON sp.station_id = s.id AND sp.fuel_type = ?
        """,
        (fuel_type,),
    ).fetchall()

    stations = []
    for row in rows:
        distance = haversine_km(lat, lng, row["latitude"], row["longitude"])
        if distance > radius_km:
            continue
        stations.append(
            {
                "id": row["id"],
                "brand_name": row["brand_name"],
                "station_name": row["station_name"],
                "address": row["address"],
                "city": row["city"],
                "lat": row["latitude"],
                "lng": row["longitude"],
                "is_partner_verified": bool(row["is_partner_verified"]),
                "fuel_type": fuel_type,
                "price": row["price"],
                "distance_km": round(distance, 2),
                "last_updated_at": row["updated_at"],
                "staleness": staleness_state(row["updated_at"]),
            }
        )

    if sort == "closest":
        stations.sort(key=lambda x: x["distance_km"])
    elif sort == "cheapest":
        stations.sort(key=lambda x: (x["price"] is None, x["price"] if x["price"] is not None else 99))
    else:
        stations.sort(key=lambda x: x["last_updated_at"] or "", reverse=True)

    conn.close()
    return stations


@app.get("/api/stations/{station_id}")
def station_profile(station_id: int) -> dict[str, Any]:
    conn = get_conn()
    station = conn.execute(
        "SELECT * FROM stations WHERE id = ?",
        (station_id,),
    ).fetchone()
    if not station:
        conn.close()
        raise HTTPException(status_code=404, detail="Station not found")

    prices = conn.execute(
        "SELECT fuel_type, price, updated_at FROM station_prices WHERE station_id = ?",
        (station_id,),
    ).fetchall()
    reports = conn.execute(
        """
        SELECT id, fuel_type, source, price, verification_status, confidence_score, submitted_at
        FROM price_reports
        WHERE station_id = ?
        ORDER BY submitted_at DESC
        LIMIT 12
        """,
        (station_id,),
    ).fetchall()
    conn.close()

    return {
        "station": {
            "id": station["id"],
            "brand_name": station["brand_name"],
            "station_name": station["station_name"],
            "address": station["address"],
            "city": station["city"],
            "lat": station["latitude"],
            "lng": station["longitude"],
            "is_partner_verified": bool(station["is_partner_verified"]),
        },
        "prices": [
            {
                "fuel_type": row["fuel_type"],
                "price": row["price"],
                "updated_at": row["updated_at"],
                "staleness": staleness_state(row["updated_at"]),
            }
            for row in prices
        ],
        "recent_reports": [dict(row) for row in reports],
    }


@app.post("/api/prices/report")
def submit_price(payload: PriceReportIn) -> dict[str, Any]:
    conn = get_conn()
    station = conn.execute("SELECT id FROM stations WHERE id = ?", (payload.station_id,)).fetchone()
    if not station:
        conn.close()
        raise HTTPException(status_code=404, detail="Station not found")

    # Compare against recent values to classify trust level.
    recent = conn.execute(
        """
        SELECT price, source
        FROM price_reports
        WHERE station_id = ? AND fuel_type = ? AND submitted_at >= ?
        ORDER BY submitted_at DESC
        LIMIT 12
        """,
        (
            payload.station_id,
            payload.fuel_type,
            (datetime.now(timezone.utc) - timedelta(minutes=90)).isoformat(),
        ),
    ).fetchall()
    status, confidence = verification_status(recent, payload.price)

    cur = conn.execute(
        """
        INSERT INTO price_reports (station_id, fuel_type, user_id, source, price, confidence_score, verification_status, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            payload.station_id,
            payload.fuel_type,
            payload.user_id,
            payload.source,
            payload.price,
            confidence,
            status,
            now_iso(),
        ),
    )

    if status in {"verified", "pending"}:
        update_canonical_price(conn, payload.station_id, payload.fuel_type)

    conn.commit()
    report_id = cur.lastrowid
    conn.close()
    return {
        "report_id": report_id,
        "verification_status": status,
        "confidence_score": round(confidence, 3),
    }


@app.post("/api/prices/confirm")
def confirm_price(payload: PriceConfirmIn) -> dict[str, Any]:
    conn = get_conn()
    report = conn.execute(
        "SELECT station_id, fuel_type, price FROM price_reports WHERE id = ?",
        (payload.report_id,),
    ).fetchone()
    if not report:
        conn.close()
        raise HTTPException(status_code=404, detail="Report not found")

    conn.execute(
        """
        INSERT INTO price_confirmations (report_id, user_id, action, corrected_price, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            payload.report_id,
            payload.user_id,
            payload.action,
            payload.corrected_price,
            now_iso(),
        ),
    )

    if payload.action == "correct" and payload.corrected_price is not None:
        conn.execute(
            """
            UPDATE price_reports
            SET verification_status = 'disputed'
            WHERE id = ?
            """,
            (payload.report_id,),
        )
        conn.execute(
            """
            INSERT INTO price_reports (station_id, fuel_type, user_id, source, price, confidence_score, verification_status, submitted_at)
            VALUES (?, ?, ?, 'community', ?, 0.8, 'verified', ?)
            """,
            (report["station_id"], report["fuel_type"], payload.user_id, payload.corrected_price, now_iso()),
        )

    update_canonical_price(conn, report["station_id"], report["fuel_type"])
    conn.commit()
    conn.close()
    return {"ok": True}


@app.post("/api/alerts")
def create_alert(payload: AlertIn) -> dict[str, Any]:
    conn = get_conn()
    cur = conn.execute(
        """
        INSERT INTO alerts (user_id, fuel_type, target_price_lte, radius_km, lat, lng, cooldown_minutes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            payload.user_id,
            payload.fuel_type,
            payload.target_price_lte,
            payload.radius_km,
            payload.lat,
            payload.lng,
            payload.cooldown_minutes,
        ),
    )
    conn.commit()
    alert_id = cur.lastrowid
    conn.close()
    return {"id": alert_id}


@app.get("/api/alerts")
def list_alerts(user_id: int) -> list[dict[str, Any]]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM alerts WHERE user_id = ? AND is_active = 1 ORDER BY id DESC",
        (user_id,),
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]


@app.get("/api/alerts/check")
def check_alerts(user_id: int) -> list[dict[str, Any]]:
    conn = get_conn()
    alerts = conn.execute(
        "SELECT * FROM alerts WHERE user_id = ? AND is_active = 1",
        (user_id,),
    ).fetchall()

    notifications: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc)
    for alert in alerts:
        rows = conn.execute(
            """
            SELECT s.id, s.brand_name, s.station_name, s.latitude, s.longitude, sp.price, sp.updated_at
            FROM stations s
            JOIN station_prices sp ON sp.station_id = s.id AND sp.fuel_type = ?
            """,
            (alert["fuel_type"],),
        ).fetchall()

        for row in rows:
            distance = haversine_km(alert["lat"], alert["lng"], row["latitude"], row["longitude"])
            if distance > alert["radius_km"]:
                continue
            if row["price"] > alert["target_price_lte"]:
                continue

            last_notified = parse_ts(alert["last_notified_at"])
            if last_notified is not None and now - last_notified < timedelta(minutes=alert["cooldown_minutes"]):
                continue

            notifications.append(
                {
                    "alert_id": alert["id"],
                    "station_id": row["id"],
                    "station_name": row["station_name"],
                    "brand_name": row["brand_name"],
                    "fuel_type": alert["fuel_type"],
                    "price": row["price"],
                    "distance_km": round(distance, 2),
                    "target_price_lte": alert["target_price_lte"],
                }
            )
            conn.execute("UPDATE alerts SET last_notified_at = ? WHERE id = ?", (now.isoformat(), alert["id"]))
            break

    conn.commit()
    conn.close()
    return notifications


@app.post("/api/partner/prices/push")
def partner_push(payload: PartnerPushIn, x_api_key: str = Header(default="")) -> dict[str, Any]:
    conn = get_conn()
    key = conn.execute(
        "SELECT station_id FROM partner_keys WHERE station_id = ? AND api_key = ?",
        (payload.station_id, x_api_key),
    ).fetchone()
    if not key:
        conn.close()
        raise HTTPException(status_code=403, detail="Invalid partner API key")

    accepted = []
    for fuel_type, price in payload.prices.items():
        if fuel_type not in {"diesel", "e10", "premium95", "premium98"}:
            continue
        conn.execute(
            """
            INSERT INTO price_reports (station_id, fuel_type, user_id, source, price, confidence_score, verification_status, submitted_at)
            VALUES (?, ?, NULL, 'partner_api', ?, 0.95, 'verified', ?)
            """,
            (payload.station_id, fuel_type, price, now_iso()),
        )
        update_canonical_price(conn, payload.station_id, fuel_type)
        accepted.append(fuel_type)

    conn.commit()
    conn.close()
    return {"updated_fuel_types": accepted}


@app.get("/api/partner/analytics/overview")
def partner_analytics(station_id: int) -> dict[str, Any]:
    conn = get_conn()
    report_count = conn.execute(
        "SELECT COUNT(*) as c FROM price_reports WHERE station_id = ?",
        (station_id,),
    ).fetchone()["c"]
    verified_count = conn.execute(
        "SELECT COUNT(*) as c FROM price_reports WHERE station_id = ? AND verification_status = 'verified'",
        (station_id,),
    ).fetchone()["c"]
    confirm_count = conn.execute(
        "SELECT COUNT(*) as c FROM price_confirmations pc JOIN price_reports pr ON pr.id = pc.report_id WHERE pr.station_id = ?",
        (station_id,),
    ).fetchone()["c"]

    avg_price = conn.execute(
        "SELECT AVG(price) as p FROM station_prices WHERE station_id = ?",
        (station_id,),
    ).fetchone()["p"]
    conn.close()

    return {
        "station_id": station_id,
        "profile_views": report_count * 3,
        "map_impressions": report_count * 5,
        "verified_reports": verified_count,
        "community_interactions": confirm_count,
        "average_live_price": round(avg_price, 3) if avg_price is not None else None,
    }
