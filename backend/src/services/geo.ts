import { sql, type SQL } from 'drizzle-orm';
import { query, queryOne, type Db } from '../db/client';

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Afstand i km mellem en butikslokation (alias `l`) og et punkt – ren SQL (ingen PostGIS). */
export function haversineSql(alias: string, point: GeoPoint): SQL {
  const a = sql.raw(alias);
  return sql`(6371 * 2 * asin(sqrt(
    power(sin(radians(${a}.latitude - ${point.lat}::float8) / 2), 2) +
    cos(radians(${point.lat}::float8)) * cos(radians(${a}.latitude)) *
    power(sin(radians(${a}.longitude - ${point.lng}::float8) / 2), 2)
  )))`;
}

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/**
 * Postnummer → koordinat. Beregnes som midtpunktet af de butikker vi kender
 * i postnummeret (ingen ekstern tjeneste). Findes ingen, bruges det
 * numerisk nærmeste postnummer med butikker.
 */
export async function zipToPoint(db: Db, zip: string): Promise<GeoPoint | null> {
  if (!/^\d{4}$/.test(zip)) return null;
  const exact = await queryOne<{ lat: number | null; lng: number | null }>(
    db,
    sql`SELECT avg(latitude)::float8 AS lat, avg(longitude)::float8 AS lng FROM store_locations WHERE zip_code = ${zip}`,
  );
  if (exact?.lat != null && exact.lng != null) return { lat: exact.lat, lng: exact.lng };
  const nearest = await queryOne<{ lat: number; lng: number }>(
    db,
    sql`SELECT avg(latitude)::float8 AS lat, avg(longitude)::float8 AS lng
        FROM store_locations
        WHERE zip_code ~ '^[0-9]{4}$'
        GROUP BY zip_code
        ORDER BY abs(zip_code::int - ${Number(zip)}::int)
        LIMIT 1`,
  );
  return nearest ?? null;
}

export async function nearbyLocations(db: Db, point: GeoPoint, radiusKm: number, storeIds?: string[]) {
  const dist = haversineSql('l', point);
  return query<{
    id: number;
    store_id: string;
    name: string;
    street: string | null;
    city: string | null;
    zip_code: string | null;
    latitude: number;
    longitude: number;
    distance_km: number;
  }>(
    db,
    sql`SELECT * FROM (
          SELECT l.id, l.store_id, l.name, l.street, l.city, l.zip_code, l.latitude, l.longitude, ${dist} AS distance_km
          FROM store_locations l
          JOIN stores s ON s.id = l.store_id AND s.enabled
          ${storeIds?.length ? sql`WHERE l.store_id IN (${sql.join(storeIds.map((id) => sql`${id}`), sql`, `)})` : sql``}
        ) x
        WHERE distance_km <= ${radiusKm}::float8
        ORDER BY distance_km
        LIMIT 200`,
  );
}
