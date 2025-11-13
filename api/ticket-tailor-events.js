// api/ticket-tailor-events.js - DEBUG VERSION

export default async function handler(req, res) {
  const API_KEY = process.env.TT_API_KEY;
  
  if (!API_KEY) {
    return res.status(500).json({ error: 'TT_API_KEY not configured' });
  }

  const headers = {
    'Authorization': `Basic ${Buffer.from(API_KEY + ':').toString('base64')}`,
    'Accept': 'application/json'
  };

  const baseUrl = 'https://api.tickettailor.com/v1';
  
  const debug = {
    apiKey: API_KEY ? 'Present (length: ' + API_KEY.length + ')' : 'Missing',
    standaloneEvents: {},
    eventSeries: {},
    occurrences: [],
    errors: []
  };

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    debug.today = today.toISOString();
    
    // 1. Fetch standalone events - NO FILTERS
    console.log('Fetching standalone events...');
    const eventsUrl = `${baseUrl}/events`;
    debug.standaloneEvents.url = eventsUrl;
    
    const eventsRes = await fetch(eventsUrl, { headers });
    debug.standaloneEvents.status = eventsRes.status;
    debug.standaloneEvents.ok = eventsRes.ok;
    
    if (eventsRes.ok) {
      const eventsData = await eventsRes.json();
      debug.standaloneEvents.rawResponse = eventsData;
      debug.standaloneEvents.count = eventsData.data ? eventsData.data.length : 0;
    } else {
      const errorText = await eventsRes.text();
      debug.standaloneEvents.error = errorText;
      debug.errors.push('Standalone events fetch failed: ' + errorText);
    }
    
    // 2. Fetch event series - NO FILTERS
    console.log('Fetching event series...');
    const seriesUrl = `${baseUrl}/event_series`;
    debug.eventSeries.url = seriesUrl;
    
    const seriesRes = await fetch(seriesUrl, { headers });
    debug.eventSeries.status = seriesRes.status;
    debug.eventSeries.ok = seriesRes.ok;
    
    if (seriesRes.ok) {
      const seriesData = await seriesRes.json();
      debug.eventSeries.rawResponse = seriesData;
      const series = Array.isArray(seriesData.data) ? seriesData.data : [];
      debug.eventSeries.count = series.length;
      debug.eventSeries.seriesIds = series.map(s => s.id);
      
      // 3. For each series, fetch occurrences
      for (const s of series) {
        console.log(`Fetching occurrences for series ${s.id}...`);
        const occUrl = `${baseUrl}/event_series/${s.id}/events`;
        
        const occRes = await fetch(occUrl, { headers });
        
        const occDebug = {
          seriesId: s.id,
          seriesName: s.name,
          url: occUrl,
          status: occRes.status,
          ok: occRes.ok
        };
        
        if (occRes.ok) {
          const occData = await occRes.json();
          occDebug.rawResponse = occData;
          occDebug.count = occData.data ? occData.data.length : 0;
        } else {
          const errorText = await occRes.text();
          occDebug.error = errorText;
          debug.errors.push(`Occurrences for ${s.id} failed: ${errorText}`);
        }
        
        debug.occurrences.push(occDebug);
      }
    } else {
      const errorText = await seriesRes.text();
      debug.eventSeries.error = errorText;
      debug.errors.push('Event series fetch failed: ' + errorText);
    }
    
    // Return debug info
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(debug);
    
  } catch (error) {
    console.error('Error:', error);
    debug.errors.push(error.message);
    debug.exception = {
      message: error.message,
      stack: error.stack
    };
    res.status(500).json(debug);
  }
}