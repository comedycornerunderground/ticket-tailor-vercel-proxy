// api/ticket-tailor-events.js

module.exports = async (req, res) => {
  // CORS so Squarespace can call it
  res.setHeader("Access-Control-Allow-Origin", "*"); // tighten later if you want
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

  const encoded = Buffer.from(apiKey).toString("base64");

  try {
    const ttRes = await fetch("https://api.tickettailor.com/v1/events", {
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${encoded}`,
      },
    });

    const ttData = await ttRes.json();

    if (!ttRes.ok) {
      return res.status(ttRes.status).json({
        error: "Ticket Tailor API error",
        details: ttData,
      });
    }

    // Just pass Ticket Tailor JSON straight through
    return res.status(200).json(ttData);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Server error",
      details: String(err),
    });
  }
};
