import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

type WaybillItem = {
  recipientName?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  packages?: number;
  weightKg?: number;
  reference?: string;
  notes?: string;
};

const SYSTEM_PROMPT = `Du analyserer norske fraktbrev/føresedler. Les bildet og trekk ut STRUKTURERT data for HVERT mottakerstopp.

Returner KUN ren JSON (ingen markdown, ingen forklaring) på formatet:
{
  "stops": [
    {
      "recipientName": "Firma/personnavn",
      "address": "Gate og husnummer",
      "postalCode": "4 siffer",
      "city": "Poststed",
      "packages": <tall>,
      "weightKg": <tall>,
      "reference": "Kolli-/ordrenr hvis synlig",
      "notes": "Evt. merknader"
    }
  ]
}

Regler:
- Hvis fraktbrevet har flere mottakere, returner én stop per mottaker
- Hvis felt ikke kan leses, sett til null
- Vekt i kilo (tall, ikke tekst)
- Antall kolli som heltall
- Ikke gjett — bedre med null enn feil
- Postnummer må være 4 siffer hvis det oppgis
- Ikke inkluder avsender/depot — kun mottakere`;

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Server mangler ANTHROPIC_API_KEY" },
        { status: 500 }
      );
    }

    const body = await req.json();
    const imageDataUrl: string | undefined = body?.image;
    if (!imageDataUrl || typeof imageDataUrl !== "string") {
      return NextResponse.json(
        { error: "Mangler 'image' (data URL)" },
        { status: 400 }
      );
    }

    const match = imageDataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.*)$/);
    if (!match) {
      return NextResponse.json(
        { error: "Ugyldig bilde-format (må være data URL)" },
        { status: 400 }
      );
    }
    const mediaType = match[1];
    const base64 = match[2];

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: base64,
                },
              },
              {
                type: "text",
                text: "Analyser dette fraktbrevet. Returner JSON.",
              },
            ],
          },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      return NextResponse.json(
        { error: `Claude API feilet (${anthropicRes.status})`, detail: errText.slice(0, 500) },
        { status: 502 }
      );
    }

    const data = await anthropicRes.json();
    const text: string =
      data?.content?.[0]?.type === "text" ? data.content[0].text : "";

    // Strip any code fences / surrounding text, isolate first JSON object
    let jsonStr = text.trim();
    const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) jsonStr = fence[1].trim();
    const firstBrace = jsonStr.indexOf("{");
    const lastBrace = jsonStr.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }

    let parsed: { stops: WaybillItem[] };
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json(
        { error: "Kunne ikke parse svar fra Claude", raw: text.slice(0, 500) },
        { status: 502 }
      );
    }

    return NextResponse.json({ stops: parsed.stops ?? [] });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Uventet serverfeil", detail: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
