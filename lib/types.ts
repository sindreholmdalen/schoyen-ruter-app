export interface Stop {
  id: string;
  mottaker: string;
  adresse: string;
  losseadresse?: string;
  kolli: number;
  kg: number;
  eta?: string;
  telefon?: string;
  merknad?: string;
  fotoDataUrl?: string;
  lat?: number;
  lon?: number;
  geocodeStatus?: "pending" | "ok" | "failed";
}

export interface Settings {
  antallBiler: number;
  kapasitetKg: number;
  henteadresse: string;
  henteLat: number;
  henteLon: number;
  startTid: string;
}

export interface Route {
  bilNr: number;
  stops: Stop[];
  totalKolli: number;
  totalKg: number;
  utnyttelsePct: number;
  omraade: string;
}

export const DEFAULT_SETTINGS: Settings = {
  antallBiler: 4,
  kapasitetKg: 1800,
  henteadresse: "Borgeskogen, 3160 Stokke",
  // Borgeskogen industriområde, Stokke (Sandefjord kommune)
  henteLat: 59.2239,
  henteLon: 10.2845,
  startTid: "07:00",
};
