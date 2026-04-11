// Free geocoding proxy using OpenStreetMap Nominatim.
// Nominatim usage policy: max 1 request per second, must include a
// descriptive User-Agent, and cache results.
// https://operations.osmfoundation.org/policies/nominatim/

import { NextResponse } from "next/server";

export const runtime = "nodejs";

const CACHE = new Map<string, { lat: number; lon: number } | null>();

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
      // Cache at edge level when possible
      next: { revalidate: 60 * 60 * 24 * 30 },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Nominatim returnerte ${res.status}` },
        { status: 502 },
      );
    }

    const data: { lat: string; lon: string }[] = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      CACHE.set(key, null);
      return NextResponse.json({ result: null });
    }

    const result = {
      lat: parseFloat(data[0].lat),
      lon: parseFloat(data[0].lon),
    };
    CACHE.set(key, result);
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Ukjent feil" },
      { status: 500 },
    );
  }
}
