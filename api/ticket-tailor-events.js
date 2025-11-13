// api/ticket-tailor-events.js

const BASE_URL = "https://api.tickettailor.com/v1";

async function ttFetch(path, encodedKey) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${encodedKey}`,
    },
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      `Ticket Tailor error ${res.status}: ${JSON.stringify(data)}`
    );
  }

  return data;
}

function parseStartDate(ev) {
  const attrs = ev.attributes || ev || {};
  const start = attrs.start || {};

  let raw =
    start.unix ??
    start.iso ??
    start.datetime ??
    start.date ??
    attrs.starts_at ??
    attrs.start_at;

  if (raw == null) return null;

  let d;
  if (typeof raw === "number") {
    d = new Date(raw * 1000);
  } else if (typeof raw === "string" && /^\d+$/.test(raw)) {
    d = new Date(parseInt(raw, 10) * 1000);
  } else {
    d = new Date(raw);
  }

  if (isNaN(d.getTime())) return null;
  return d;
}

function isUpcomingAndOnSale(ev, todayStart) {
  const attrs = ev.attributes || ev || {};
  const date = parseStartDate(ev);
  if (!date) return false;

  if (date < todayStart) return false;

  // Be a bit generous with "on sale"
  const ticketsAvailable =
    attrs.tickets_available === true || attrs.tickets_available === "true";
  const status = (attrs.status || "").toLowerCase();

  const okStatus =
    !status ||
    status === "published" ||
    status === "on_sale" ||
    status === "live";

  // If Ticket Tailor doesn’t set tickets_available, just rely on status
  if (attrs.tickets_available == null) {
    return okStatus;
  }

  return ticketsAvailable && okStatus;
}

module.exports = async (req, res) => {
  // CORS for Squarespace
  res.setHeader("Access-Control-Allow-Origin", "*");
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
    // 1) Get all event series
    const seriesData = await ttFetch("/event_series", encoded);
    const seriesList = Array.isArray(seriesData.data)
      ? seriesData.data
      : Array.isArray(seriesData)
      ? seriesData
      : [];

    // 2) For each series, get its occurrences
    const allEvents = [];

    await Promise.all(
      seriesList.map(async (series) => {
        const id = series.id || series.event_series_id;
        if (!id) return;

        try {
          const occData = await ttFetch(`/event_series/${id}/events`, encoded);
          const events = Array.isArray(occData.data)
            ? occData.data
            : Array.isArray(occData)
            ? occData
            : [];
          allEvents.push(...events);
        } catch (e) {
          // Fail soft on one bad series
          console.error(`Error loading events for series ${id}:`, e.message);
        }
      })
    );

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // 3) Filter to today+ and on sale
    const upcoming = allEvents
      .filter((ev) => isUpcomingAndOnSale(ev, todayStart))
      .sort((a, b) => {
        const da = parseStartDate(a) || new Date(0);
        const db = parseStartDate(b) || new Date(0);
        return da - db;
      });

    // Return a plain array; Squarespace script already handles Array responses
    res.status(200).json(upcoming);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Server error",
      details: String(err),
    });
  }
};
