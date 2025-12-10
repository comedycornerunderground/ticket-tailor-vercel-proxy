// api/ticket-tailor-events.js

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
  
  try {
    const allEvents = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    console.log('Starting fetch, today:', today.toISOString());
    
    // 1. Fetch ALL event series (with pagination)
    const allSeries = [];
    let seriesUrl = `${baseUrl}/event_series`;
    
    while (seriesUrl) {
      console.log('Fetching series page:', seriesUrl);
      const seriesRes = await fetch(seriesUrl, { headers });
      
      if (!seriesRes.ok) {
        console.error('Series fetch failed:', seriesRes.status);
        break;
      }
      
      const seriesData = await seriesRes.json();
      const seriesPage = Array.isArray(seriesData.data) ? seriesData.data : [];
      allSeries.push(...seriesPage);
      
      console.log(`Got ${seriesPage.length} series on this page`);
      
      // Check for next page
      if (seriesData.links && seriesData.links.next) {
        seriesUrl = baseUrl + seriesData.links.next;
      } else {
        seriesUrl = null;
      }
    }
    
    console.log(`Total series found: ${allSeries.length}`);
    
    // 2. For each series, fetch its occurrences
    for (const series of allSeries) {
      console.log(`Checking series: ${series.id} - ${series.name}`);
      
      if (series.upcoming_occurrences === 0) {
        console.log(`  Skipping ${series.id} - no upcoming occurrences`);
        continue;
      }
      
      let occUrl = `${baseUrl}/event_series/${series.id}/events`;
      
      while (occUrl) {
        const occRes = await fetch(occUrl, { headers });
        
        if (!occRes.ok) {
          console.error(`  Failed to fetch occurrences for ${series.id}`);
          break;
        }
        
        const occData = await occRes.json();
        const occurrences = Array.isArray(occData.data) ? occData.data : [];
        
        console.log(`  Found ${occurrences.length} occurrences`);
        
        occurrences.forEach(occ => {
          if (occ.start && occ.start.unix) {
            const eventDate = new Date(occ.start.unix * 1000);
            
            if (eventDate >= today && occ.tickets_available) {
              // Extract numeric ID from series.id (e.g., "es_1948944" -> "1948944")
              // The event page URL uses the series ID, not the occurrence ID
              const seriesId = series.id.replace(/^es_/, '');
              allEvents.push({
                id: occ.id,
                name: series.name,
                date: occ.start.iso,
                unix: occ.start.unix,
                // Use event page URL (with description) - uses series ID
                url: `https://www.tickettailor.com/events/ccug/${seriesId}`,
                image: series.images?.thumbnail || series.images?.header || null
              });
              console.log(`    ✓ Added: ${series.name} on ${occ.start.date}`);
            }
          }
        });
        
        if (occData.links && occData.links.next) {
          occUrl = baseUrl + occData.links.next;
        } else {
          occUrl = null;
        }
      }
    }
    
    // 3. Also fetch standalone events
    console.log('Fetching standalone events...');
    let eventsUrl = `${baseUrl}/events`;
    
    while (eventsUrl) {
      const eventsRes = await fetch(eventsUrl, { headers });
      
      if (!eventsRes.ok) break;
      
      const eventsData = await eventsRes.json();
      const events = Array.isArray(eventsData.data) ? eventsData.data : [];
      
      events.forEach(event => {
        if (event.start && event.start.unix && !event.event_series_id) {
          const eventDate = new Date(event.start.unix * 1000);
          
          if (eventDate >= today && event.tickets_available) {
            // Extract numeric ID from event.id (e.g., "ev_1234567" -> "1234567")
            const eventId = event.id.replace(/^ev_/, '');
            allEvents.push({
              id: event.id,
              name: event.name,
              date: event.start.iso,
              unix: event.start.unix,
              // Use event page URL (with description) instead of checkout URL
              url: `https://www.tickettailor.com/events/ccug/${eventId}`,
              image: event.images?.thumbnail || event.images?.header || null
            });
          }
        }
      });
      
      if (eventsData.links && eventsData.links.next) {
        eventsUrl = baseUrl + eventsData.links.next;
      } else {
        eventsUrl = null;
      }
    }
    
    // Sort by date
    allEvents.sort((a, b) => a.unix - b.unix);
    
    console.log(`Returning ${allEvents.length} total events`);
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.status(200).json(allEvents);
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch events',
      message: error.message 
    });
  }
}