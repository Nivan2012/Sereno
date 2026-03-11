require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const sgMail = require("@sendgrid/mail");
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } = require("docx");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const path = require("path");
const fs = require("fs");

// ─── App setup ───────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const PORT = process.env.PORT || 3000;

// ─── Helper: Search the web via Serper ───────────────────────────────────────
async function searchWeb(query) {
  try {
    const response = await axios.post(
      "https://google.serper.dev/search",
      { q: query, num: 5 },
      {
        headers: {
          "X-API-KEY": process.env.SERPER_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );
    const results = response.data.organic || [];
    return results
      .map((r) => `• ${r.title}: ${r.snippet} (${r.link})`)
      .join("\n");
  } catch (err) {
    console.error("Serper error:", err.message);
    return "No search results found.";
  }
}

// ─── Helper: Generate itinerary via OpenRouter (Gemini 2.0 Flash) ────────────
async function generateItinerary(userInputs, searchData) {
  const {
    origin, destination, dateFrom, dateTo, budgetMin, budgetMax,
    travelStyle, adults, children, dietary, prefAirlines, otherPrefs,
  } = userInputs;

  const prompt = `
You are Sereno, a world-class luxury travel concierge AI. Your task is to create a beautifully detailed, personalised travel itinerary based on the traveller's inputs and real search data provided below.

─── TRAVELLER DETAILS ───
From: ${origin}
To: ${destination}
Dates: ${dateFrom} → ${dateTo}
Budget: $${budgetMin || "0"} – $${budgetMax || "open"}
Travel Style: ${travelStyle || "Not specified"}
Travelers: ${adults || "1"} adult(s), ${children || "0"} child(ren)
Dietary & Accessibility: ${dietary || "None"}
Preferred Airlines/Hotels: ${prefAirlines || "No preference"}
Special Preferences: ${otherPrefs || "None"}

─── LIVE SEARCH DATA (use this to recommend real options with prices) ───
FLIGHTS:
${searchData.flights}

HOTELS:
${searchData.hotels}

ACTIVITIES:
${searchData.activities}

RESTAURANTS:
${searchData.restaurants}

─── YOUR TASK ───
Create a luxurious, detailed travel itinerary that includes:

1. OVERVIEW — A warm, elegant welcome paragraph summarising the trip.

2. GETTING THERE — Recommend specific flights from the search data with estimated prices, airline, duration and booking link if available.

3. ACCOMMODATION — Recommend 2-3 hotels from the search data with prices per night, highlights and booking links.

4. DAY-BY-DAY ITINERARY — A detailed plan for each day including:
   - Morning, Afternoon, Evening activities
   - Specific restaurant recommendations with cuisine type and price range
   - Transport between locations
   - Estimated costs for each activity

5. CATEGORY SUMMARY — A clean breakdown by:
   - Flights (estimated total cost)
   - Accommodation (estimated total cost)
   - Activities (estimated total cost)
   - Food & Dining (estimated total cost)
   - Transport (estimated total cost)
   - GRAND TOTAL ESTIMATE

6. INSIDER TIPS — 5 golden tips for this destination that only a seasoned traveller would know.

7. PACKING ESSENTIALS — A tailored packing list for the travel style and destination.

Use warm, elegant, concierge-level language throughout. Format with clear section headers using === for main sections and --- for subsections. Use bullet points for lists. Include emojis sparingly for warmth. Make the traveller feel like they are being personally looked after.
`;

  const response = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: "google/gemini-2.0-flash-exp:free",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 4000,
      temperature: 0.7,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://sereno.travel",
        "X-Title": "Sereno Travel Concierge",
      },
    }
  );

  return response.data.choices[0].message.content;
}

// ─── Helper: Generate Word Document ──────────────────────────────────────────
async function generateWordDoc(itinerary, userInputs) {
  const { destination, dateFrom, dateTo } = userInputs;
  const lines = itinerary.split("\n");

  const children = [
    new Paragraph({
      text: "SERENO",
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
    }),
    new Paragraph({
      text: "Private Travel Concierge",
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      run: { color: "C9A96E" },
    }),
    new Paragraph({
      text: `${destination}  ·  ${dateFrom} → ${dateTo}`,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      children.push(new Paragraph({ text: "", spacing: { after: 100 } }));
      continue;
    }

    if (trimmed.startsWith("===")) {
      // Main section header
      const text = trimmed.replace(/===/g, "").trim();
      children.push(
        new Paragraph({
          text,
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 200 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "C9A96E" } },
        })
      );
    } else if (trimmed.startsWith("---")) {
      // Sub section header
      const text = trimmed.replace(/---/g, "").trim();
      children.push(
        new Paragraph({
          text,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 100 },
        })
      );
    } else if (trimmed.startsWith("•") || trimmed.startsWith("-")) {
      // Bullet point
      children.push(
        new Paragraph({
          text: trimmed,
          bullet: { level: 0 },
          spacing: { after: 80 },
        })
      );
    } else {
      // Regular paragraph
      children.push(
        new Paragraph({
          children: [new TextRun({ text: trimmed, size: 22 })],
          spacing: { after: 120 },
        })
      );
    }
  }

  const doc = new Document({
    sections: [{ properties: {}, children }],
    styles: {
      default: {
        document: {
          run: { font: "Georgia", size: 22, color: "1a1208" },
          paragraph: { spacing: { line: 340 } },
        },
      },
    },
  });

  return await Packer.toBuffer(doc);
}

// ─── Helper: Generate PDF ─────────────────────────────────────────────────────
async function generatePDF(itinerary, userInputs) {
  const { destination, dateFrom, dateTo } = userInputs;
  const pdfDoc = await PDFDocument.create();
  const timesRoman = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const timesBold  = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

  const gold   = rgb(0.788, 0.663, 0.431);
  const dark   = rgb(0.1,  0.07, 0.03);
  const muted  = rgb(0.45, 0.38, 0.27);
  const pageW  = 595;
  const pageH  = 842;
  const margin = 60;
  const lineH  = 18;

  let page = pdfDoc.addPage([pageW, pageH]);
  let y = pageH - margin;

  // Cover header
  page.drawText("SERENO", {
    x: margin, y, font: timesBold, size: 36, color: gold,
  });
  y -= 28;
  page.drawText("Private Travel Concierge", {
    x: margin, y, font: timesRoman, size: 13, color: muted,
  });
  y -= 20;
  page.drawText(`${destination}  ·  ${dateFrom} — ${dateTo}`, {
    x: margin, y, font: timesRoman, size: 12, color: dark,
  });
  y -= 12;
  page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 1, color: gold });
  y -= 30;

  // Word wrap helper
  function wrapText(text, font, size, maxWidth) {
    const words = text.split(" ");
    const lines = [];
    let current = "";
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      const w = font.widthOfTextAtSize(test, size);
      if (w > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  function ensureSpace(needed) {
    if (y - needed < margin) {
      page = pdfDoc.addPage([pageW, pageH]);
      y = pageH - margin;
      // Page header
      page.drawText("SERENO  —  Private Travel Concierge", {
        x: margin, y, font: timesRoman, size: 9, color: muted,
      });
      y -= 20;
      page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.5, color: gold });
      y -= 20;
    }
  }

  const textLines = itinerary.split("\n");
  for (const line of textLines) {
    const trimmed = line.trim();

    if (!trimmed) { y -= 8; continue; }

    if (trimmed.startsWith("===")) {
      const text = trimmed.replace(/===/g, "").trim();
      ensureSpace(40);
      y -= 10;
      page.drawText(text.toUpperCase(), { x: margin, y, font: timesBold, size: 14, color: gold });
      y -= 6;
      page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.8, color: gold });
      y -= 16;
    } else if (trimmed.startsWith("---")) {
      const text = trimmed.replace(/---/g, "").trim();
      ensureSpace(30);
      y -= 8;
      page.drawText(text, { x: margin, y, font: timesBold, size: 12, color: dark });
      y -= 16;
    } else {
      const wrapped = wrapText(trimmed, timesRoman, 10, pageW - margin * 2);
      for (const wLine of wrapped) {
        ensureSpace(lineH);
        page.drawText(wLine, { x: margin + (trimmed.startsWith("•") ? 10 : 0), y, font: timesRoman, size: 10, color: dark });
        y -= lineH;
      }
    }
  }

  // Footer on last page
  y -= 20;
  page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.5, color: gold });
  y -= 14;
  page.drawText("Crafted with care by Sereno — Your Private Travel Concierge", {
    x: margin, y, font: timesRoman, size: 9, color: muted,
  });

  return await pdfDoc.save();
}

// ─── Helper: Send email via SendGrid ─────────────────────────────────────────
async function sendEmail(toEmail, destination, wordBuffer, pdfBuffer) {
  const msg = {
    to: toEmail,
    from: {
      email: process.env.SENDGRID_FROM_EMAIL,
      name: process.env.SENDGRID_FROM_NAME || "Sereno",
    },
    subject: `✦ Your Sereno Itinerary — ${destination}`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; background: #0e0b08; color: #f5e6c8; padding: 48px 40px; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="font-size: 32px; font-weight: 300; color: #c9a96e; letter-spacing: 0.3em; margin: 0;">SERENO</h1>
          <p style="font-size: 11px; letter-spacing: 0.2em; color: #7a6340; margin: 6px 0 0; text-transform: uppercase;">Private Travel Concierge</p>
        </div>
        <hr style="border: none; border-top: 1px solid #3a2e1e; margin: 24px 0;" />
        <h2 style="font-size: 22px; font-weight: 300; color: #f5e6c8; margin: 0 0 16px;">Your journey to <em style="color: #c9a96e;">${destination}</em> awaits.</h2>
        <p style="font-size: 14px; line-height: 1.8; color: rgba(245,220,170,0.7); margin: 0 0 24px;">
          We've crafted your personalised travel itinerary with care. Please find your complete journey plan attached as both a Word document and a PDF — whichever you prefer.
        </p>
        <p style="font-size: 14px; line-height: 1.8; color: rgba(245,220,170,0.7); margin: 0 0 32px;">
          If you have any questions or wish to refine your itinerary, simply visit Sereno and let us know.
        </p>
        <hr style="border: none; border-top: 1px solid #3a2e1e; margin: 24px 0;" />
        <p style="font-size: 11px; color: #7a6340; text-align: center; letter-spacing: 0.1em;">Crafted with care by Sereno &nbsp;·&nbsp; Your Private Travel Concierge</p>
      </div>
    `,
    attachments: [
      {
        content: wordBuffer.toString("base64"),
        filename: `Sereno_Itinerary_${destination.replace(/[^a-z0-9]/gi, "_")}.docx`,
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        disposition: "attachment",
      },
      {
        content: Buffer.from(pdfBuffer).toString("base64"),
        filename: `Sereno_Itinerary_${destination.replace(/[^a-z0-9]/gi, "_")}.pdf`,
        type: "application/pdf",
        disposition: "attachment",
      },
    ],
  };

  await sgMail.send(msg);
}

// ─── Main route: Generate itinerary ──────────────────────────────────────────
app.post("/api/generate", async (req, res) => {
  const {
    origin, destination, dateFrom, dateTo,
    budgetMin, budgetMax, travelStyle,
    adults, children, dietary,
    prefAirlines, otherPrefs, email,
  } = req.body;

  if (!destination || !dateFrom || !dateTo || !email || !origin) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  try {
    // ── Step 1: Search web for real data ──
    console.log("🔍 Searching for travel data...");
    const [flights, hotels, activities, restaurants] = await Promise.all([
      searchWeb(`best flights from ${origin} to ${destination} ${dateFrom} prices booking`),
      searchWeb(`best hotels in ${destination} ${travelStyle || ""} ${budgetMax ? `under $${budgetMax}` : ""} price per night`),
      searchWeb(`best things to do in ${destination} attractions activities experiences`),
      searchWeb(`best restaurants in ${destination} ${travelStyle || ""} local food dining`),
    ]);

    const searchData = { flights, hotels, activities, restaurants };

    // ── Step 2: Generate itinerary via AI ──
    console.log("🤖 Generating itinerary...");
    const itinerary = await generateItinerary(
      { origin, destination, dateFrom, dateTo, budgetMin, budgetMax, travelStyle, adults, children, dietary, prefAirlines, otherPrefs },
      searchData
    );

    // ── Step 3: Generate Word + PDF ──
    console.log("📄 Generating documents...");
    const userInputs = { destination, dateFrom, dateTo };
    const [wordBuffer, pdfBuffer] = await Promise.all([
      generateWordDoc(itinerary, userInputs),
      generatePDF(itinerary, userInputs),
    ]);

    // ── Step 4: Send email ──
    console.log("📧 Sending email to", email);
    await sendEmail(email, destination, wordBuffer, pdfBuffer);

    // ── Step 5: Return itinerary to frontend ──
    console.log("✅ Done!");
    res.json({ success: true, itinerary });

  } catch (err) {
    console.error("❌ Error:", err.response?.data || err.message);
    res.status(500).json({ error: "Something went wrong. Please try again.", details: err.message });
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "Sereno is running ✦", timestamp: new Date().toISOString() });
});

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✦ Sereno backend running at http://localhost:${PORT}`);
  console.log(`✦ Health check: http://localhost:${PORT}/api/health\n`);
});