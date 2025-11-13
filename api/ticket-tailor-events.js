// api/ticket-tailor-events.js

module.exports = async (req, res) => {
  // Basic CORS so Squarespace can call it
  res.setHeader("Access-Control-Allow-Origin", "*"); // you can lock this down later
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
      // Pass through TT error + body to help debug
      return res.status(ttRes.status).json({
        error: "Ticket Tailor API error",
        details: ttData,
      });
    }

    // Normalize to an array of events from either [ ... ] or { data: [ ... ] }
    let events;
    if (Array.isArray(ttData)) {
      events = ttData;
    } else if (Array.isArray(ttData.data)) {
      events = ttData.data;
    } else {
      events = [];
    }

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const filtered = events.filter((ev) => {
      const attrs = ev.attributes || ev || {};
      const startObj = attrs.start || {};

      // tickets "on sale"
      const ticketsAvailable = attrs.tickets_available;
      const status = attrs.status;

      const isAvailable =
        (ticketsAvailable === true || ticketsAvailable === "true") &&
        (!status || status === "published" || status === "on_sale" || status === "live");

      if (!isAvailable) return false;

      // Find a usable date
      let rawDate =
        startObj.unix ??
        startObj.iso ??
        startObj.datetime ??
        startObj.date ??
        attrs.starts_at ??
        attrs.start_at;

      if (rawDate == null) return false;

      let date;
      if (typeof rawDate === "number") {
        // unix seconds
        date = new Date(rawDate * 1000);
      } else if (typeof rawDate === "string" && /^\d+$/.test(rawDate)) {
        // numeric string unix
        date = new Date(parseInt(rawDate, 10) * 1000);
      } else {
        // ISO or yyyy-mm-dd
        date = new Date(rawDate);
      }

      if (isNaN(date.getTime())) return false;

      return date >= startOfToday;
    });

    // Return the same "shape" back, just with filtered events
    if (Array.isArray(ttData)) {
      return res.status(200).json(filtered);
    } else {
      return res.status(200).json({
        ...ttData,
        data: filtered,
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Server error",
      details: String(err),
    });
  }
};
