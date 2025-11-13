// api/ticket-tailor-events.js

// Vercel will treat this as a serverless function:
// /api/ticket-tailor-events  →  this handler :contentReference[oaicite:0]{index=0}
module.exports = async (req, res) => {
  // Basic CORS so Squarespace can call it
  res.setHeader("Access-Control-Allow-Origin", "*"); // later you can lock to your domain
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.TT_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Missing TT_API_KEY env var" });
    return;
  }

  // Ticket Tailor wants: Authorization: Basic base64(api_key) :contentReference[oaicite:1]{index=1}
  const encoded = Buffer.from(apiKey).toString("base64");

  try {
    const ttRes = await fetch("https://api.tickettailor.com/v1/events", {
      headers: {
        "Accept": "application/json",
        "Authorization": `Basic ${encoded}`,
      },
    });

    if (!ttRes.ok) {
      const text = await ttRes.text();
      res.status(500).json({
        error: "Ticket Tailor API error",
        details: text,
      });
      return;
    }

    const raw = await ttRes.json();

    // Ticket Tailor returns a list of events; exact shape may be either raw or raw.data
    const eventsArray = Array.isArray(raw) ? raw : (raw.data || []);

    // Map down to the fields your calendar widget cares about
    const events = eventsArray.map(ev => ({
      id: ev.id,
      name: ev.name,
      // you may tweak these once you inspect the real JSON
      starts_at: ev.starts_at || ev.start_at || ev.start_time,
      url:
        ev.public_url ||
        ev.url ||
        `https://tickettailor.com/events/${ev.id}`,
    }));

    res.status(200).json(events);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Server error",
      details: String(err),
    });
  }
};
