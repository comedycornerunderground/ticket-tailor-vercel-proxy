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
    today.setHours(0, 0, 0, 0); // Start of today
    
    // 1. Fetch standalone events
    console.log('Fetching standalone events...');
    const eventsRes = await fetch(`${baseUrl}/events?status=published`, { headers });
    
    if (eventsRes.ok) {
      const eventsData = await eventsRes.json();
      const standaloneEvents = Array.isArray(eventsData.data) ? eventsData.data : [];
      
      standaloneEvents.forEach(event => {
        if (event.start && event.start.unix) {
          const eventDate = new Date(event.start.unix * 1000);
          
          // Only include future events that are available
          if (eventDate >= today && event.tickets_available) {
            allEvents.push({
              id: event.id,
              name: event.name,
              date: event.start.iso,
              unix: event.start.unix,
              url: event.url,
              status: event.status
            });
          }
        }
      });
    }
    
    // 2. Fetch event series
    console.log('Fetching event series...');
    const seriesRes = await fetch(`${baseUrl}/event_series`, { headers });
    
    if (seriesRes.ok) {
      const seriesData = await seriesRes.json();
      const series = Array.isArray(seriesData.data) ? seriesData.data : [];
      
      // 3. For each series, fetch its occurrences
      for (const s of series) {
        console.log(`Fetching occurrences for series ${s.id}...`);
        
        const occurrencesRes = await fetch(
          `${baseUrl}/event_series/${s.id}/events?status=published`,
          { headers }
        );
        
        if (occurrencesRes.ok) {
          const occurrencesData = await occurrencesRes.json();
          const occurrences = Array.isArray(occurrencesData.data) ? occurrencesData.data : [];
          
          occurrences.forEach(occurrence => {
            if (occurrence.start && occurrence.start.unix) {
              const eventDate = new Date(occurrence.start.unix * 1000);
              
              // Only include future occurrences that are available
              if (eventDate >= today && occurrence.tickets_available) {
                allEvents.push({
                  id: occurrence.id,
                  name: occurrence.name || s.name, // Fall back to series name if needed
                  date: occurrence.start.iso,
                  unix: occurrence.start.unix,
                  url: occurrence.url,
                  status: occurrence.status
                });
              }
            }
          });
        }
      }
    }
    
    // Sort by date (earliest first)
    allEvents.sort((a, b) => a.unix - b.unix);
    
    console.log(`Returning ${allEvents.length} events`);
    
    // Return with CORS headers for Squarespace
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.status(200).json(allEvents);
    
  } catch (error) {
    console.error('Error fetching Ticket Tailor events:', error);
    res.status(500).json({ 
      error: 'Failed to fetch events',
      message: error.message 
    });
  }
}