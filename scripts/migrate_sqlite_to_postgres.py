from __future__ import annotations

import argparse
import os
import sqlite3
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_SQLITE_PATH = ROOT_DIR / "app" / "fuelflow.db"


def normalize_database_url(url: str) -> str:
    if url.startswith("postgres://"):
        return "postgresql://" + url[len("postgres://") :]
    return url


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Migrate FuelFlow user data from SQLite to PostgreSQL.",
    )
    parser.add_argument(
        "--sqlite-path",
        default=str(DEFAULT_SQLITE_PATH),
        help="Path to the source SQLite database file.",
    )
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL", ""),
        help="Target PostgreSQL DATABASE_URL. Defaults to the DATABASE_URL environment variable.",
    )
    return parser.parse_args()


def fetch_all(conn: sqlite3.Connection, query: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    return [dict(row) for row in conn.execute(query, params).fetchall()]


def create_postgres_schema(conn: psycopg.Connection) -> None:
    statements = [
        """
        CREATE TABLE IF NOT EXISTS users (
            id BIGSERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            reputation_score REAL NOT NULL DEFAULT 0.5,
            role TEXT NOT NULL DEFAULT 'driver'
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS stations (
            id BIGSERIAL PRIMARY KEY,
            brand_name TEXT NOT NULL,
            station_name TEXT NOT NULL,
            address TEXT NOT NULL,
            city TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            is_partner_verified BOOLEAN NOT NULL DEFAULT FALSE
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS station_prices (
            station_id BIGINT NOT NULL REFERENCES stations(id),
            fuel_type TEXT NOT NULL,
            price REAL NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(station_id, fuel_type)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS price_reports (
            id BIGSERIAL PRIMARY KEY,
            station_id BIGINT NOT NULL REFERENCES stations(id),
            fuel_type TEXT NOT NULL,
            user_id BIGINT REFERENCES users(id),
            source TEXT NOT NULL,
            price REAL NOT NULL,
            confidence_score REAL NOT NULL,
            verification_status TEXT NOT NULL,
            submitted_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS price_confirmations (
            id BIGSERIAL PRIMARY KEY,
            report_id BIGINT NOT NULL REFERENCES price_reports(id),
            user_id BIGINT NOT NULL REFERENCES users(id),
            action TEXT NOT NULL,
            corrected_price REAL,
            created_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS alerts (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id),
            fuel_type TEXT NOT NULL,
            target_price_lte REAL NOT NULL,
            radius_km REAL NOT NULL,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            cooldown_minutes INTEGER NOT NULL,
            last_notified_at TEXT,
            is_active BOOLEAN NOT NULL DEFAULT TRUE
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS partner_keys (
            station_id BIGINT PRIMARY KEY REFERENCES stations(id),
            api_key TEXT NOT NULL UNIQUE
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS accounts (
            id BIGSERIAL PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT,
            name TEXT NOT NULL,
            google_id TEXT UNIQUE,
            created_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS user_favorites (
            account_id BIGINT NOT NULL REFERENCES accounts(id),
            station_id BIGINT NOT NULL REFERENCES stations(id),
            added_at TEXT NOT NULL,
            PRIMARY KEY (account_id, station_id)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS user_alert_targets (
            account_id BIGINT PRIMARY KEY REFERENCES accounts(id),
            diesel REAL,
            premium95 REAL,
            premium98 REAL,
            updated_at TEXT NOT NULL
        )
        """,
    ]
    with conn.cursor() as cursor:
        for statement in statements:
            cursor.execute(statement)


def upsert_users(sqlite_conn: sqlite3.Connection, pg_conn: psycopg.Connection) -> int:
    rows = fetch_all(sqlite_conn, "SELECT id, name, reputation_score, role FROM users ORDER BY id")
    if not rows:
        return 0
    with pg_conn.cursor() as cursor:
        for row in rows:
            cursor.execute(
                """
                INSERT INTO users (id, name, reputation_score, role)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    reputation_score = EXCLUDED.reputation_score,
                    role = EXCLUDED.role
                """,
                (row["id"], row["name"], row["reputation_score"], row["role"]),
            )
    return len(rows)


def upsert_accounts(sqlite_conn: sqlite3.Connection, pg_conn: psycopg.Connection) -> int:
    rows = fetch_all(
        sqlite_conn,
        "SELECT id, email, password_hash, name, google_id, created_at FROM accounts ORDER BY id",
    )
    if not rows:
        return 0
    with pg_conn.cursor() as cursor:
        for row in rows:
            cursor.execute(
                """
                INSERT INTO accounts (id, email, password_hash, name, google_id, created_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    email = EXCLUDED.email,
                    password_hash = EXCLUDED.password_hash,
                    name = EXCLUDED.name,
                    google_id = EXCLUDED.google_id,
                    created_at = EXCLUDED.created_at
                """,
                (
                    row["id"],
                    row["email"].lower().strip(),
                    row["password_hash"],
                    row["name"],
                    row["google_id"],
                    row["created_at"],
                ),
            )
    return len(rows)


def ensure_station(sqlite_conn: sqlite3.Connection, pg_conn: psycopg.Connection, source_station_id: int) -> int:
    source_station = dict(
        sqlite_conn.execute(
            """
            SELECT id, brand_name, station_name, address, city, latitude, longitude, is_partner_verified
            FROM stations
            WHERE id = ?
            """,
            (source_station_id,),
        ).fetchone()
    )

    with pg_conn.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            SELECT id
            FROM stations
            WHERE brand_name = %s
              AND station_name = %s
              AND address = %s
              AND city = %s
              AND latitude = %s
              AND longitude = %s
            LIMIT 1
            """,
            (
                source_station["brand_name"],
                source_station["station_name"],
                source_station["address"],
                source_station["city"],
                source_station["latitude"],
                source_station["longitude"],
            ),
        )
        existing = cursor.fetchone()
        if existing is not None:
            return int(existing["id"])

        cursor.execute(
            """
            SELECT id
            FROM stations
            WHERE id = %s
            LIMIT 1
            """,
            (source_station["id"],),
        )
        id_collision = cursor.fetchone()

        if id_collision is None:
            cursor.execute(
                """
                INSERT INTO stations (id, brand_name, station_name, address, city, latitude, longitude, is_partner_verified)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    brand_name = EXCLUDED.brand_name,
                    station_name = EXCLUDED.station_name,
                    address = EXCLUDED.address,
                    city = EXCLUDED.city,
                    latitude = EXCLUDED.latitude,
                    longitude = EXCLUDED.longitude,
                    is_partner_verified = EXCLUDED.is_partner_verified
                RETURNING id
                """,
                (
                    source_station["id"],
                    source_station["brand_name"],
                    source_station["station_name"],
                    source_station["address"],
                    source_station["city"],
                    source_station["latitude"],
                    source_station["longitude"],
                    bool(source_station["is_partner_verified"]),
                ),
            )
            inserted = cursor.fetchone()
            return int(inserted["id"])

        cursor.execute(
            """
            INSERT INTO stations (brand_name, station_name, address, city, latitude, longitude, is_partner_verified)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                source_station["brand_name"],
                source_station["station_name"],
                source_station["address"],
                source_station["city"],
                source_station["latitude"],
                source_station["longitude"],
                bool(source_station["is_partner_verified"]),
            ),
        )
        inserted = cursor.fetchone()
        return int(inserted["id"])


def upsert_favorites(sqlite_conn: sqlite3.Connection, pg_conn: psycopg.Connection) -> int:
    rows = fetch_all(
        sqlite_conn,
        "SELECT account_id, station_id, added_at FROM user_favorites ORDER BY account_id, station_id",
    )
    if not rows:
        return 0

    station_map: dict[int, int] = {}
    with pg_conn.cursor() as cursor:
        for row in rows:
            source_station_id = int(row["station_id"])
            if source_station_id not in station_map:
                station_map[source_station_id] = ensure_station(sqlite_conn, pg_conn, source_station_id)

            cursor.execute(
                """
                INSERT INTO user_favorites (account_id, station_id, added_at)
                VALUES (%s, %s, %s)
                ON CONFLICT (account_id, station_id) DO UPDATE SET
                    added_at = EXCLUDED.added_at
                """,
                (row["account_id"], station_map[source_station_id], row["added_at"]),
            )
    return len(rows)


def upsert_alert_targets(sqlite_conn: sqlite3.Connection, pg_conn: psycopg.Connection) -> int:
    rows = fetch_all(
        sqlite_conn,
        "SELECT account_id, diesel, premium95, premium98, updated_at FROM user_alert_targets ORDER BY account_id",
    )
    if not rows:
        return 0
    with pg_conn.cursor() as cursor:
        for row in rows:
            cursor.execute(
                """
                INSERT INTO user_alert_targets (account_id, diesel, premium95, premium98, updated_at)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (account_id) DO UPDATE SET
                    diesel = EXCLUDED.diesel,
                    premium95 = EXCLUDED.premium95,
                    premium98 = EXCLUDED.premium98,
                    updated_at = EXCLUDED.updated_at
                """,
                (row["account_id"], row["diesel"], row["premium95"], row["premium98"], row["updated_at"]),
            )
    return len(rows)


def upsert_alerts(sqlite_conn: sqlite3.Connection, pg_conn: psycopg.Connection) -> int:
    rows = fetch_all(
        sqlite_conn,
        """
        SELECT id, user_id, fuel_type, target_price_lte, radius_km, lat, lng, cooldown_minutes, last_notified_at, is_active
        FROM alerts
        ORDER BY id
        """,
    )
    if not rows:
        return 0
    with pg_conn.cursor() as cursor:
        for row in rows:
            cursor.execute(
                """
                INSERT INTO alerts (id, user_id, fuel_type, target_price_lte, radius_km, lat, lng, cooldown_minutes, last_notified_at, is_active)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    user_id = EXCLUDED.user_id,
                    fuel_type = EXCLUDED.fuel_type,
                    target_price_lte = EXCLUDED.target_price_lte,
                    radius_km = EXCLUDED.radius_km,
                    lat = EXCLUDED.lat,
                    lng = EXCLUDED.lng,
                    cooldown_minutes = EXCLUDED.cooldown_minutes,
                    last_notified_at = EXCLUDED.last_notified_at,
                    is_active = EXCLUDED.is_active
                """,
                (
                    row["id"],
                    row["user_id"],
                    row["fuel_type"],
                    row["target_price_lte"],
                    row["radius_km"],
                    row["lat"],
                    row["lng"],
                    row["cooldown_minutes"],
                    row["last_notified_at"],
                    bool(row["is_active"]),
                ),
            )
    return len(rows)


def sync_sequence(pg_conn: psycopg.Connection, table_name: str) -> None:
    with pg_conn.cursor() as cursor:
        cursor.execute(
            """
            SELECT setval(
                pg_get_serial_sequence(%s, 'id'),
                COALESCE((SELECT MAX(id) FROM {}), 1),
                true
            )
            """.format(table_name),
            (table_name,),
        )


def main() -> int:
    args = parse_args()
    database_url = args.database_url.strip()
    if not database_url:
        raise SystemExit("DATABASE_URL puudub. Anna --database-url või ekspordi env var.")

    sqlite_path = Path(args.sqlite_path)
    if not sqlite_path.exists():
        raise SystemExit(f"SQLite faili ei leitud: {sqlite_path}")

    sqlite_conn = sqlite3.connect(sqlite_path)
    sqlite_conn.row_factory = sqlite3.Row

    pg_conn = psycopg.connect(normalize_database_url(database_url), row_factory=dict_row)
    try:
        create_postgres_schema(pg_conn)

        migrated_users = upsert_users(sqlite_conn, pg_conn)
        migrated_accounts = upsert_accounts(sqlite_conn, pg_conn)
        migrated_alert_targets = upsert_alert_targets(sqlite_conn, pg_conn)
        migrated_alerts = upsert_alerts(sqlite_conn, pg_conn)
        migrated_favorites = upsert_favorites(sqlite_conn, pg_conn)

        sync_sequence(pg_conn, "users")
        sync_sequence(pg_conn, "accounts")
        sync_sequence(pg_conn, "stations")
        sync_sequence(pg_conn, "alerts")
        pg_conn.commit()
    except Exception:
        pg_conn.rollback()
        raise
    finally:
        sqlite_conn.close()
        pg_conn.close()

    print("Migratsioon valmis.")
    print(f"users: {migrated_users}")
    print(f"accounts: {migrated_accounts}")
    print(f"user_alert_targets: {migrated_alert_targets}")
    print(f"alerts: {migrated_alerts}")
    print(f"user_favorites: {migrated_favorites}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())