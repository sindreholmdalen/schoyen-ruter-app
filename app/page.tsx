"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stop, Settings, Route, DEFAULT_SETTINGS } from "@/lib/types";
import { optimizeRoutes } from "@/lib/routing";
import { generateAllRoutesPdf, generateSingleRoutePdf } from "@/lib/pdf";

const STORAGE_KEY = "schoyen-ruter-state-v1";

interface AppState {
  settings: Settings;
  stops: Stop[];
}

const EMPTY_FORM: Omit<Stop, "id"> = {
  mottaker: "",
  adresse: "",
  losseadresse: "",
  kolli: 1,
  kg: 0,
  eta: "",
  telefon: "",
  merknad: "",
};

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function geocodeAddress(
  address: string,
): Promise<{ lat: number; lon: number } | null> {
  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(address)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.result ?? null;
  } catch {
    return null;
  }
}

// Shrink image to keep localStorage from blowing up.
async function fileToDataUrl(file: File, maxDim = 900): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const { width, height } = img;
        const scale = Math.min(1, maxDim / Math.max(width, height));
        const w = Math.round(width * scale);
        const h = Math.round(height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(reader.result as string);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.75));
      };
      img.onerror = () => resolve(reader.result as string);
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export default function Home() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [stops, setStops] = useState<Stop[]>([]);
  const [form, setForm] = useState<Omit<Stop, "id">>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [unrouted, setUnrouted] = useState<Stop[]>([]);
  const [optimizing, setOptimizing] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [showSettings, setShowSettings] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: AppState = JSON.parse(raw);
        if (parsed.settings) setSettings(parsed.settings);
        if (Array.isArray(parsed.stops)) setStops(parsed.stops);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Persist on changes
  useEffect(() => {
    const state: AppState = { settings, stops };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* quota exceeded – drop photos */
      try {
        const trimmed: AppState = {
          settings,
          stops: stops.map((s) => ({ ...s, fotoDataUrl: undefined })),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      } catch {
        /* give up */
      }
    }
  }, [settings, stops]);

  const totalKg = useMemo(
    () => stops.reduce((sum, s) => sum + (Number(s.kg) || 0), 0),
    [stops],
  );
  const totalKolli = useMemo(
    () => stops.reduce((sum, s) => sum + (Number(s.kolli) || 0), 0),
    [stops],
  );
  const totalKapasitet = settings.antallBiler * settings.kapasitetKg;

  const handlePhoto = useCallback(
    async (file: File | null) => {
      if (!file) return;
      const dataUrl = await fileToDataUrl(file);
      setForm((f) => ({ ...f, fotoDataUrl: dataUrl }));
    },
    [],
  );

  const analyzeWaybill = useCallback(async (file: File) => {
    setAnalyzing(true);
    setAnalyzeError("");
    try {
      // Slightly bigger image for OCR quality
      const imageDataUrl = await fileToDataUrl(file, 1400);
      const res = await fetch("/api/analyze-waybill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageDataUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAnalyzeError(data.error || "Analyse feilet");
        return;
      }
      const parsed = (data.stops || []) as Array<{
        recipientName?: string;
        address?: string;
        postalCode?: string;
        city?: string;
        packages?: number;
        weightKg?: number;
        reference?: string;
        notes?: string;
      }>;
      if (parsed.length === 0) {
        setAnalyzeError(
          "Fant ingen mottakere i bildet. Prøv bedre lys/vinkel eller legg inn manuelt.",
        );
        return;
      }
      const newStops: Stop[] = parsed.map((p) => ({
        id: newId(),
        mottaker: p.recipientName || "",
        adresse: [p.address, p.postalCode, p.city].filter(Boolean).join(", "),
        losseadresse: "",
        kolli: Number(p.packages) || 1,
        kg: Number(p.weightKg) || 0,
        eta: "",
        telefon: "",
        merknad: [p.reference, p.notes].filter(Boolean).join(" · "),
        fotoDataUrl: imageDataUrl,
        geocodeStatus: "pending",
      }));
      setStops((arr) => [...arr, ...newStops]);
      setStatus(`La til ${newStops.length} stopp fra fraktbrev — sjekk og juster ved behov`);
      setTimeout(() => setStatus(""), 5000);
    } catch (err: any) {
      setAnalyzeError(String(err?.message || err));
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const saveForm = () => {
    if (!form.mottaker.trim() || !form.adresse.trim()) {
      alert("Mottaker og adresse må fylles ut.");
      return;
    }
    const kolli = Number(form.kolli) || 0;
    const kg = Number(form.kg) || 0;
    if (editingId) {
      setStops((arr) =>
        arr.map((s) =>
          s.id === editingId
            ? {
                ...s,
                ...form,
                kolli,
                kg,
                geocodeStatus: s.adresse === form.adresse ? s.geocodeStatus : "pending",
                lat: s.adresse === form.adresse ? s.lat : undefined,
                lon: s.adresse === form.adresse ? s.lon : undefined,
              }
            : s,
        ),
      );
    } else {
      const stop: Stop = {
        id: newId(),
        ...form,
        kolli,
        kg,
        geocodeStatus: "pending",
      };
      setStops((arr) => [...arr, stop]);
    }
    resetForm();
    setShowForm(false);
  };

  const editStop = (id: string) => {
    const s = stops.find((x) => x.id === id);
    if (!s) return;
    setForm({
      mottaker: s.mottaker,
      adresse: s.adresse,
      losseadresse: s.losseadresse || "",
      kolli: s.kolli,
      kg: s.kg,
      eta: s.eta || "",
      telefon: s.telefon || "",
      merknad: s.merknad || "",
      fotoDataUrl: s.fotoDataUrl,
    });
    setEditingId(id);
    setShowForm(true);
  };

  const deleteStop = (id: string) => {
    if (!confirm("Slette dette stoppet?")) return;
    setStops((arr) => arr.filter((s) => s.id !== id));
  };

  const clearAll = () => {
    if (!confirm("Slette alle stopp og ruter?")) return;
    setStops([]);
    setRoutes([]);
    setUnrouted([]);
    resetForm();
    setShowForm(false);
  };

  const runOptimization = async () => {
    if (stops.length === 0) {
      alert("Legg til minst ett stopp først.");
      return;
    }
    setOptimizing(true);
    setStatus("Geokoder adresser…");

    // Geocode any stop that hasn't been geocoded yet
    const updated: Stop[] = [...stops];
    let done = 0;
    for (let i = 0; i < updated.length; i++) {
      const s = updated[i];
      if (s.geocodeStatus === "ok" && s.lat != null && s.lon != null) {
        done++;
        continue;
      }
      const addr = s.losseadresse?.trim() || s.adresse;
      setStatus(`Geokoder (${done + 1}/${updated.length}): ${s.mottaker}…`);
      const res = await geocodeAddress(addr);
      if (res) {
        updated[i] = { ...s, lat: res.lat, lon: res.lon, geocodeStatus: "ok" };
      } else {
        updated[i] = { ...s, geocodeStatus: "failed" };
      }
      // Kartverket has generous rate limits; keep a tiny delay as politeness
      await new Promise((r) => setTimeout(r, 120));
      done++;
    }

    setStops(updated);
    setStatus("Optimaliserer ruter…");
    const { routes: newRoutes, unrouted: nu } = optimizeRoutes(updated, settings);
    setRoutes(newRoutes);
    setUnrouted(nu);
    setStatus("");
    setOptimizing(false);
  };

  const downloadAllPdf = () => {
    if (routes.length === 0) return;
    const doc = generateAllRoutesPdf(routes, settings);
    doc.save(`kjoreruter-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const downloadBilPdf = (route: Route) => {
    const doc = generateSingleRoutePdf(route, settings);
    doc.save(
      `sjaforliste-bil-${route.bilNr}-${new Date().toISOString().slice(0, 10)}.pdf`,
    );
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 pb-24">
      <header className="mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Ruteplanlegger</h1>
            <p className="text-sm text-slate-500">Schøyen & Horntvedt AS</p>
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
          >
            ⚙ Innstillinger
          </button>
        </div>
      </header>

      {showSettings && (
        <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Driftsparametre</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-medium text-slate-600">
              Antall biler
              <input
                type="number"
                min={1}
                max={10}
                value={settings.antallBiler}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    antallBiler: Math.max(1, Number(e.target.value) || 1),
                  })
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Kapasitet per bil (kg)
              <input
                type="number"
                min={100}
                value={settings.kapasitetKg}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    kapasitetKg: Number(e.target.value) || 0,
                  })
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
              />
            </label>
            <label className="col-span-2 text-xs font-medium text-slate-600">
              Henteadresse (startpunkt)
              <input
                type="text"
                value={settings.henteadresse}
                onChange={(e) =>
                  setSettings({ ...settings, henteadresse: e.target.value })
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              Starttid
              <input
                type="time"
                value={settings.startTid}
                onChange={(e) =>
                  setSettings({ ...settings, startTid: e.target.value })
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
              />
            </label>
          </div>
        </section>
      )}

      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Registrerte stopp
            </div>
            <div className="text-2xl font-bold text-slate-900">
              {stops.length}
              <span className="ml-2 text-sm font-normal text-slate-500">
                {totalKolli} kolli &middot; {Math.round(totalKg)} kg
              </span>
            </div>
            <div className="text-xs text-slate-500">
              Totalkapasitet: {totalKapasitet} kg ({settings.antallBiler} biler)
            </div>
          </div>
          {stops.length > 0 && (
            <button
              onClick={clearAll}
              className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
            >
              Tøm alt
            </button>
          )}
        </div>
      </section>

      <section className="mb-4 rounded-xl border border-brand-200 bg-brand-50 p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold text-brand-900">
          📷 Automatisk fraktbrev-lesing
        </h2>
        <p className="mb-3 text-xs text-brand-800">
          Ta bilde av fraktbrevet — Claude leser mottaker, adresse, vekt og kolli automatisk og legger inn som nytt stopp.
        </p>
        <label
          className={`flex w-full cursor-pointer items-center justify-center rounded-lg px-4 py-3 text-base font-semibold text-white shadow-sm ${
            analyzing
              ? "bg-slate-400"
              : "bg-brand-600 hover:bg-brand-700"
          }`}
        >
          {analyzing ? "Leser fraktbrev…" : "📷 Ta bilde av fraktbrev"}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) analyzeWaybill(f);
              e.target.value = "";
            }}
            disabled={analyzing}
            className="hidden"
          />
        </label>
        {analyzeError && (
          <div className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
            {analyzeError}
          </div>
        )}
      </section>

      <div className="mb-4 flex gap-2">
        <button
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
          className="flex-1 rounded-lg bg-brand-600 px-4 py-3 text-base font-semibold text-white shadow-sm hover:bg-brand-700"
        >
          + Legg til stopp
        </button>
        <button
          onClick={runOptimization}
          disabled={optimizing || stops.length === 0}
          className="flex-1 rounded-lg bg-emerald-600 px-4 py-3 text-base font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:bg-slate-300"
        >
          {optimizing ? "Planlegger…" : "Generer ruter"}
        </button>
      </div>

      {status && (
        <div className="mb-4 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-900">
          {status}
        </div>
      )}

      {showForm && (
        <section className="mb-4 rounded-xl border border-brand-200 bg-white p-4 shadow">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">
              {editingId ? "Rediger stopp" : "Nytt stopp"}
            </h2>
            <button
              onClick={() => {
                resetForm();
                setShowForm(false);
              }}
              className="text-sm text-slate-500 hover:text-slate-700"
            >
              Avbryt
            </button>
          </div>

          <div className="mb-3">
            <label className="block text-xs font-medium text-slate-600">
              Bilde av føreseddel (valgfritt – for referanse)
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => handlePhoto(e.target.files?.[0] ?? null)}
              className="mt-1 w-full text-sm"
            />
            {form.fotoDataUrl && (
              <div className="mt-2">
                <img
                  src={form.fotoDataUrl}
                  alt="Føreseddel"
                  className="max-h-64 rounded-md border border-slate-200"
                />
              </div>
            )}
          </div>

          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Mottaker *</span>
              <input
                type="text"
                value={form.mottaker}
                onChange={(e) => setForm({ ...form, mottaker: e.target.value })}
                placeholder="F.eks. Meny Skøyen"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">
                Mottakeradresse *
              </span>
              <input
                type="text"
                value={form.adresse}
                onChange={(e) => setForm({ ...form, adresse: e.target.value })}
                placeholder="Gateadresse, postnr, sted"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">
                Losseadresse (hvis ulik)
              </span>
              <input
                type="text"
                value={form.losseadresse}
                onChange={(e) =>
                  setForm({ ...form, losseadresse: e.target.value })
                }
                placeholder="Varemottak bak bygget"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Kolli *</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={form.kolli}
                  onChange={(e) =>
                    setForm({ ...form, kolli: Number(e.target.value) || 0 })
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">
                  Bruttovekt (kg) *
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.1"
                  value={form.kg}
                  onChange={(e) =>
                    setForm({ ...form, kg: Number(e.target.value) || 0 })
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">ETA</span>
                <input
                  type="text"
                  value={form.eta}
                  onChange={(e) => setForm({ ...form, eta: e.target.value })}
                  placeholder="f.eks. 19.3 kl. 10"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">Telefon</span>
                <input
                  type="tel"
                  value={form.telefon}
                  onChange={(e) =>
                    setForm({ ...form, telefon: e.target.value })
                  }
                  placeholder="Valgfritt"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Merknad</span>
              <textarea
                value={form.merknad}
                onChange={(e) => setForm({ ...form, merknad: e.target.value })}
                placeholder="Port, varemottak, tidsvindu, kontaktperson…"
                rows={2}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={saveForm}
              className="flex-1 rounded-lg bg-brand-600 px-4 py-3 font-semibold text-white hover:bg-brand-700"
            >
              {editingId ? "Lagre endringer" : "Lagre stopp"}
            </button>
          </div>
        </section>
      )}

      {stops.length > 0 && (
        <section className="mb-4 rounded-xl border border-slate-200 bg-white shadow-sm">
          <h2 className="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
            Alle stopp ({stops.length})
          </h2>
          <ul className="divide-y divide-slate-100">
            {stops.map((s) => (
              <li
                key={s.id}
                className="flex items-start justify-between gap-2 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-slate-900">
                      {s.mottaker}
                    </span>
                    {s.geocodeStatus === "ok" && (
                      <span className="text-xs text-emerald-600">●</span>
                    )}
                    {s.geocodeStatus === "failed" && (
                      <span
                        className="text-xs text-red-600"
                        title="Adresse kunne ikke geokodes"
                      >
                        ⚠
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {s.losseadresse || s.adresse}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-600">
                    {s.kolli} kolli · {s.kg} kg
                    {s.eta ? ` · ${s.eta}` : ""}
                    {s.telefon ? ` · ${s.telefon}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <button
                    onClick={() => editStop(s.id)}
                    className="rounded px-2 py-1 text-xs text-brand-600 hover:bg-brand-50"
                  >
                    Rediger
                  </button>
                  <button
                    onClick={() => deleteStop(s.id)}
                    className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                  >
                    Slett
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {routes.length > 0 && routes.some((r) => r.stops.length > 0) && (
        <section className="mb-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">Kjøreruter</h2>
            <button
              onClick={downloadAllPdf}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Last ned samlet PDF
            </button>
          </div>

          {routes.map((route) => {
            const over = route.totalKg > settings.kapasitetKg;
            return (
              <div
                key={route.bilNr}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex items-center justify-between bg-slate-800 px-4 py-3 text-white">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-300">
                      Bil {route.bilNr}
                    </div>
                    <div className="font-semibold">{route.omraade}</div>
                  </div>
                  <button
                    onClick={() => downloadBilPdf(route)}
                    className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/20"
                  >
                    PDF
                  </button>
                </div>
                <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-600">
                  {route.stops.length} stopp · {route.totalKolli} kolli ·{" "}
                  <span className={over ? "font-semibold text-red-600" : ""}>
                    {Math.round(route.totalKg)} / {settings.kapasitetKg} kg (
                    {route.utnyttelsePct} %)
                  </span>
                </div>
                <ol className="divide-y divide-slate-100">
                  {route.stops.map((s, i) => (
                    <li key={s.id} className="flex gap-3 px-4 py-2.5 text-sm">
                      <span className="w-6 shrink-0 text-right font-mono text-xs text-slate-400">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-slate-900">
                          {s.mottaker}
                        </div>
                        <div className="truncate text-xs text-slate-500">
                          {s.losseadresse || s.adresse}
                        </div>
                        <div className="text-xs text-slate-600">
                          {s.kolli} kolli · {s.kg} kg
                          {s.telefon ? ` · ${s.telefon}` : ""}
                        </div>
                        {s.merknad && (
                          <div className="text-xs italic text-amber-700">
                            {s.merknad}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </section>
      )}

      {unrouted.length > 0 && (
        <section className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h3 className="mb-2 text-sm font-semibold text-amber-900">
            ⚠ {unrouted.length} stopp kunne ikke plasseres
          </h3>
          <p className="mb-2 text-xs text-amber-800">
            Adressene under kunne ikke geokodes. Sjekk at gateadresse og postnr er
            riktig skrevet, og prøv igjen.
          </p>
          <ul className="text-xs text-amber-900">
            {unrouted.map((s) => (
              <li key={s.id}>
                • {s.mottaker} – {s.adresse}
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-8 border-t border-slate-200 pt-4 text-center text-xs text-slate-400">
        Schøyen & Horntvedt AS · Ruteplanlegger
      </footer>
    </main>
  );
}
