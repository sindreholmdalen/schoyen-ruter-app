// Geocoding proxy — Kartverket (geonorge) primary, Nominatim fallback.
// Kartverket is built for Norwegian addresses and has no rate limits worth worrying about.
// Nominatim is used as fallback for business-name lookups when the address field doesn't match.

import { NextResponse } from "next/server";

export const runtime = "nodejs";

const CACHE = new Map<string, { lat: number; lon: number } | null>();

type GeoResult = { lat: number; lon: number } | null;

// Extract "street, postnr, city" components from a free-text string like
// "Alf Bjerckes vei 26 B, 0582, Oslo" or "Alf Bjerckes vei 26B 0582 Oslo"
function parseParts(q: string): { street?: string; postnr?: string; poststed?: string } {
  const postnrMatch = q.match(/\b(\d{4})\b/);
  const postnr = postnrMatch?.[1];
  if (postnr) {
    const before = q.slice(0, postnrMatch!.index).replace(/[,\s]+$/, "").trim();
    const after = q.slice(postnrMatch!.index! + 4).replace(/^[,\s]+/, "").trim();
    return {
      street: before || undefined,
      postnr,
      poststed: after || undefined,
    };
  }
  return { street: q };
}

async function tryKartverket(q: string): Promise<GeoResult> {
  const parts = parseParts(q);
  const url = new URL("https://ws.geonorge.no/adresser/v1/sok");
  if (parts.street) url.searchParams.set("adressetekst", parts.street);
  if (parts.postnr) url.searchParams.set("postnummer", parts.postnr);
  if (parts.poststed) url.searchParams.set("poststed", parts.poststed);
  url.searchParams.set("treffPerSide", "1");
  url.searchParams.set("utkoordsys", "4326");

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 * 60 * 24 * 30 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const first = data?.adresser?.[0];
    const punkt = first?.representasjonspunkt;
    if (punkt && typeof punkt.lat === "number" && typeof punkt.lon === "number") {
      return { lat: punkt.lat, lon: punkt.lon };
    }
    return null;
  } catch {
    return null;
  }
}

// Fallback: free-text search (no postnr required). Useful when the address
// field contains a business name the structured lookup doesn't resolve.
async function tryKartverketFreeText(q: string): Promise<GeoResult> {
  const url = new URL("https://ws.geonorge.no/adresser/v1/sok");
  url.searchParams.set("sok", q);
  url.searchParams.set("treffPerSide", "1");
  url.searchParams.set("utkoordsys", "4326");
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 * 60 * 24 * 30 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const first = data?.adresser?.[0];
    const punkt = first?.representasjonspunkt;
    if (punkt && typeof punkt.lat === "number" && typeof punkt.lon === "number") {
      return { lat: punkt.lat, lon: punkt.lon };
    }
    return null;
  } catch {
    return null;
  }
}

async function tryNominatim(q: string): Promise<GeoResult> {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", q);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", "no");
    url.searchParams.set("addressdetails", "0");

    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "schoyen-ruter-app/1.0 (dispatch tool for Norwegian transport)",
        "Accept-Language": "nb,en",
      },
      next: { revalidate: 60 * 60 * 24 * 30 },
    });
    if (!res.ok) return null;
    const data: { lat: string; lon: string }[] = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "Missing q parameter" }, { status: 400 });
  }

  const key = q.toLowerCase();
  if (CACHE.has(key)) {
    return NextResponse.json({ result: CACHE.get(key), cached: true });
  }

  // 1. Kartverket structured (street + postnr + poststed) — best for Norwegian addresses
  let result = await tryKartverket(q);

  // 2. Kartverket free-text search — handles unusual formatting
  if (!result) result = await tryKartverketFreeText(q);

  // 3. Nominatim fallback — for anything Kartverket misses
  if (!result) result = await tryNominatim(q);

  CACHE.set(key, result);
  return NextResponse.json({ result, source: result ? "ok" : "none" });
}
