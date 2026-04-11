"use client";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Route, Settings } from "./types";

const BIL_COLORS: [number, number, number][] = [
  [31, 78, 121],
  [13, 110, 74],
  [139, 69, 19],
  [106, 27, 154],
  [190, 30, 45],
];

function formatDate(): string {
  const now = new Date();
  return now.toLocaleDateString("nb-NO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function addHeader(doc: jsPDF, date: string, settings: Settings) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(30, 41, 59);
  doc.text(`Kjøreruter – ${date}`, 14, 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Schøyen & Horntvedt AS  ·  Start: ${settings.henteadresse}  ·  ${settings.antallBiler} biler  ·  Kapasitet ${settings.kapasitetKg} kg/bil`,
    14,
    24,
  );
}

function addFooter(doc: jsPDF, pageLabel: string) {
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(156, 163, 175);
  doc.text(
    `Schøyen & Horntvedt AS – Kjøreruter ${formatDate()}`,
    14,
    pageHeight - 8,
  );
  doc.text(pageLabel, pageWidth - 14, pageHeight - 8, { align: "right" });
}

export function generateAllRoutesPdf(
  routes: Route[],
  settings: Settings,
): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const date = formatDate();

  // Cover page
  addHeader(doc, date, settings);

  const summaryBody = routes.map((r) => [
    `BIL ${r.bilNr}`,
    r.omraade,
    r.stops.length.toString(),
    r.totalKolli.toString(),
    `${Math.round(r.totalKg)}`,
    `${r.utnyttelsePct} %`,
  ]);
  const totals = routes.reduce(
    (acc, r) => ({
      stops: acc.stops + r.stops.length,
      kolli: acc.kolli + r.totalKolli,
      kg: acc.kg + r.totalKg,
    }),
    { stops: 0, kolli: 0, kg: 0 },
  );
  summaryBody.push([
    "Totalt",
    "Alle biler",
    `${totals.stops}`,
    `${totals.kolli}`,
    `${Math.round(totals.kg)}`,
    `${Math.round((totals.kg / (settings.kapasitetKg * routes.length)) * 100)} %`,
  ]);

  autoTable(doc, {
    startY: 32,
    head: [["Bil", "Område", "Stopp", "Kolli", "Kg", "Utnyttelse"]],
    body: summaryBody,
    theme: "grid",
    headStyles: { fillColor: [31, 41, 55], textColor: 255, fontStyle: "bold" },
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: {
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
    },
    foot: undefined,
  });

  addFooter(doc, "Side 1");

  // One page per route
  routes.forEach((route, idx) => {
    doc.addPage();
    const color = BIL_COLORS[idx % BIL_COLORS.length];

    // Colored header bar
    doc.setFillColor(color[0], color[1], color[2]);
    doc.rect(14, 14, 182, 12, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(255, 255, 255);
    doc.text(`BIL ${route.bilNr} – ${route.omraade}`, 18, 22);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(55, 65, 81);
    doc.text(
      `Totalt: ${route.stops.length} stopp  ·  ${route.totalKolli} kolli  ·  ${Math.round(
        route.totalKg,
      )} / ${settings.kapasitetKg} kg  ·  Utnyttelse: ${route.utnyttelsePct} %`,
      14,
      32,
    );

    const body = route.stops.map((s, i) => [
      `${i + 1}`,
      s.mottaker,
      s.losseadresse || s.adresse,
      s.kolli.toString(),
      `${s.kg}`,
      s.telefon || "–",
      s.merknad || "",
    ]);

    autoTable(doc, {
      startY: 36,
      head: [["#", "Mottaker", "Adresse", "Kolli", "Kg", "Telefon", "Merknad"]],
      body,
      theme: "grid",
      headStyles: { fillColor: color, textColor: 255, fontStyle: "bold" },
      styles: { fontSize: 8.5, cellPadding: 2, valign: "top" },
      columnStyles: {
        0: { cellWidth: 8, halign: "right" },
        1: { cellWidth: 35 },
        2: { cellWidth: 50 },
        3: { cellWidth: 12, halign: "right" },
        4: { cellWidth: 13, halign: "right" },
        5: { cellWidth: 22 },
        6: { cellWidth: "auto" },
      },
    });

    addFooter(doc, `Side ${idx + 2}`);
  });

  return doc;
}

export function generateSingleRoutePdf(
  route: Route,
  settings: Settings,
): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const date = formatDate();
  const color = BIL_COLORS[(route.bilNr - 1) % BIL_COLORS.length];

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(30, 41, 59);
  doc.text(`Sjåførliste – BIL ${route.bilNr}`, 14, 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(
    `Schøyen & Horntvedt AS  ·  ${date}  ·  Start: ${settings.henteadresse}`,
    14,
    24,
  );

  // Colored bar
  doc.setFillColor(color[0], color[1], color[2]);
  doc.rect(14, 28, 182, 10, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(route.omraade, 18, 35);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(55, 65, 81);
  doc.text(
    `${route.stops.length} stopp  ·  ${route.totalKolli} kolli  ·  ${Math.round(
      route.totalKg,
    )} / ${settings.kapasitetKg} kg  ·  Utnyttelse: ${route.utnyttelsePct} %`,
    14,
    44,
  );

  const body = route.stops.map((s, i) => [
    `${i + 1}`,
    s.mottaker,
    s.losseadresse || s.adresse,
    s.kolli.toString(),
    `${s.kg}`,
    s.telefon || "–",
    s.merknad || "",
  ]);

  autoTable(doc, {
    startY: 48,
    head: [["#", "Mottaker", "Adresse", "Kolli", "Kg", "Telefon", "Merknad"]],
    body,
    theme: "grid",
    headStyles: { fillColor: color, textColor: 255, fontStyle: "bold" },
    styles: { fontSize: 9, cellPadding: 2.5, valign: "top" },
    columnStyles: {
      0: { cellWidth: 8, halign: "right" },
      1: { cellWidth: 38 },
      2: { cellWidth: 52 },
      3: { cellWidth: 12, halign: "right" },
      4: { cellWidth: 13, halign: "right" },
      5: { cellWidth: 24 },
      6: { cellWidth: "auto" },
    },
  });

  addFooter(doc, `Side 1`);
  return doc;
}
