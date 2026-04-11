import { Stop, Settings, Route } from "./types";

// Haversine distance in kilometers between two lat/lon points.
export function haversine(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// K-means-style clustering of stops, seeded deterministically by
// picking the k stops farthest from each other.
function initialCentroids(stops: Stop[], k: number): [number, number][] {
  const pts = stops
    .filter((s) => s.lat != null && s.lon != null)
    .map((s) => [s.lat as number, s.lon as number] as [number, number]);
  if (pts.length === 0) return [];
  const centroids: [number, number][] = [pts[0]];
  while (centroids.length < k && centroids.length < pts.length) {
    let bestIdx = -1;
    let bestDist = -1;
    for (let i = 0; i < pts.length; i++) {
      const [plat, plon] = pts[i];
      const minDist = Math.min(
        ...centroids.map(([clat, clon]) => haversine(plat, plon, clat, clon)),
      );
      if (minDist > bestDist) {
        bestDist = minDist;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    centroids.push(pts[bestIdx]);
  }
  return centroids;
}

interface Cluster {
  centroid: [number, number];
  stops: Stop[];
  totalKg: number;
}

function runKMeans(stops: Stop[], k: number, maxIter = 20): Cluster[] {
  const geoStops = stops.filter((s) => s.lat != null && s.lon != null);
  if (geoStops.length === 0) return [];
  let centroids = initialCentroids(geoStops, k);
  if (centroids.length < k) {
    while (centroids.length < k) {
      centroids.push(centroids[centroids.length - 1]);
    }
  }

  let clusters: Cluster[] = [];
  for (let iter = 0; iter < maxIter; iter++) {
    clusters = centroids.map((c) => ({
      centroid: c,
      stops: [],
      totalKg: 0,
    }));
    for (const stop of geoStops) {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < centroids.length; i++) {
        const d = haversine(
          stop.lat as number,
          stop.lon as number,
          centroids[i][0],
          centroids[i][1],
        );
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      clusters[bestIdx].stops.push(stop);
      clusters[bestIdx].totalKg += stop.kg;
    }
    // Recompute centroids
    const newCentroids: [number, number][] = clusters.map((c) => {
      if (c.stops.length === 0) return c.centroid;
      const avgLat =
        c.stops.reduce((sum, s) => sum + (s.lat as number), 0) / c.stops.length;
      const avgLon =
        c.stops.reduce((sum, s) => sum + (s.lon as number), 0) / c.stops.length;
      return [avgLat, avgLon];
    });
    const moved = newCentroids.some(
      (c, i) =>
        haversine(c[0], c[1], centroids[i][0], centroids[i][1]) > 0.05,
    );
    centroids = newCentroids;
    if (!moved) break;
  }
  return clusters;
}

// Rebalance clusters so none exceeds kapasitet. Move stops from overweight
// clusters to the nearest cluster with capacity.
function rebalance(clusters: Cluster[], kapasitet: number): Cluster[] {
  const result = clusters.map((c) => ({ ...c, stops: [...c.stops] }));
  let safety = 50;
  while (safety-- > 0) {
    const over = result
      .map((c, i) => ({ c, i }))
      .filter((x) => x.c.totalKg > kapasitet);
    if (over.length === 0) break;
    for (const { c, i } of over) {
      // Pick the heaviest stop in this cluster
      c.stops.sort((a, b) => b.kg - a.kg);
      const stop = c.stops[0];
      if (!stop) break;
      // Find target cluster with capacity, nearest to stop
      let bestTarget = -1;
      let bestDist = Infinity;
      for (let j = 0; j < result.length; j++) {
        if (j === i) continue;
        if (result[j].totalKg + stop.kg > kapasitet) continue;
        const d = haversine(
          stop.lat as number,
          stop.lon as number,
          result[j].centroid[0],
          result[j].centroid[1],
        );
        if (d < bestDist) {
          bestDist = d;
          bestTarget = j;
        }
      }
      if (bestTarget === -1) break; // cannot rebalance further
      c.stops.shift();
      c.totalKg -= stop.kg;
      result[bestTarget].stops.push(stop);
      result[bestTarget].totalKg += stop.kg;
    }
  }
  return result;
}

// Order stops within a route via nearest-neighbor from the start depot.
function orderByNearestNeighbor(
  stops: Stop[],
  startLat: number,
  startLon: number,
): Stop[] {
  if (stops.length === 0) return [];
  const remaining = [...stops];
  const ordered: Stop[] = [];
  let curLat = startLat;
  let curLon = startLon;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const s = remaining[i];
      if (s.lat == null || s.lon == null) continue;
      const d = haversine(curLat, curLon, s.lat, s.lon);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    if (next.lat != null && next.lon != null) {
      curLat = next.lat;
      curLon = next.lon;
    }
  }
  return ordered;
}

// Derive a simple area label from the postal codes represented in the route.
function labelForStops(stops: Stop[]): string {
  const codes = stops
    .map((s) => {
      const m = s.adresse.match(/\b(\d{4})\b/);
      return m ? parseInt(m[1], 10) : null;
    })
    .filter((c): c is number => c != null);
  if (codes.length === 0) return "Blandet område";
  const avg = codes.reduce((a, b) => a + b, 0) / codes.length;
  if (avg < 200) return "Oslo sentrum øst";
  if (avg < 400) return "Oslo sentrum vest";
  if (avg < 700) return "Oslo nord / Sagene";
  if (avg < 1000) return "Oslo vest / nord";
  if (avg < 1500) return "Bærum / Asker";
  if (avg < 1700) return "Follo / Nesodden";
  if (avg < 2000) return "Romerike";
  if (avg < 3200) return "Vestfold / Tønsberg";
  return "Blandet område";
}

export function optimizeRoutes(
  stops: Stop[],
  settings: Settings,
): { routes: Route[]; unrouted: Stop[] } {
  const geoStops = stops.filter(
    (s) => s.lat != null && s.lon != null && s.geocodeStatus === "ok",
  );
  const unrouted = stops.filter(
    (s) => s.lat == null || s.lon == null || s.geocodeStatus !== "ok",
  );

  if (geoStops.length === 0) {
    return {
      routes: Array.from({ length: settings.antallBiler }, (_, i) => ({
        bilNr: i + 1,
        stops: [],
        totalKolli: 0,
        totalKg: 0,
        utnyttelsePct: 0,
        omraade: "–",
      })),
      unrouted,
    };
  }

  const rawClusters = runKMeans(geoStops, settings.antallBiler);
  const balanced = rebalance(rawClusters, settings.kapasitetKg);

  // Sort routes: assign bil numbers in order of average lat (north to south)
  // so the "first" truck always covers the northernmost area – purely cosmetic.
  balanced.sort((a, b) => a.centroid[1] - b.centroid[1]);

  const routes: Route[] = balanced.map((c, i) => {
    const orderedStops = orderByNearestNeighbor(
      c.stops,
      settings.henteLat,
      settings.henteLon,
    );
    const totalKolli = orderedStops.reduce((sum, s) => sum + s.kolli, 0);
    const totalKg = orderedStops.reduce((sum, s) => sum + s.kg, 0);
    return {
      bilNr: i + 1,
      stops: orderedStops,
      totalKolli,
      totalKg,
      utnyttelsePct: Math.round((totalKg / settings.kapasitetKg) * 100),
      omraade: labelForStops(orderedStops),
    };
  });

  return { routes, unrouted };
}
