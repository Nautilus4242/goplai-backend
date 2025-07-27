import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { 
      city = 'Victoria', 
      region = 'BC',
      country = 'Canada',
      latitude = 48.4284,
      longitude = -123.3656,
      sources = ['yelp', 'eventbrite', 'meetup', 'open_data'],
      max_per_source = 50 
    } = await req.json()
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    console.log(`🌍 Starting legitimate data collection for ${city}, ${region}, ${country}`)
    
    let totalFound = 0
    let totalAdded = 0
    const results: any = {}

    // Yelp Fusion API Integration
    if (sources.includes('yelp')) {
      try {
        console.log('🍽️ Collecting from Yelp Fusion API...')
        const yelpResults = await collectFromYelp(city, region, country, latitude, longitude, max_per_source)
        
        for (const venue of yelpResults) {
          const { data: existing } = await supabase
            .from('activities_cache')
            .select('id')
            .eq('source', 'yelp')
            .eq('source_id', venue.source_id)
            .single()

          if (!existing) {
            const { error } = await supabase
              .from('activities_cache')
              .insert(venue)

            if (!error) {
              totalAdded++
              console.log(`✅ Added Yelp venue: ${venue.title}`)
            }
          }
        }

        results.yelp = {
          found: yelpResults.length,
          status: 'success'
        }
        totalFound += yelpResults.length

      } catch (error) {
        console.error('Yelp collection error:', error)
        results.yelp = { error: error.message, status: 'failed' }
      }
    }

    // Eventbrite API Integration
    if (sources.includes('eventbrite')) {
      try {
        console.log('🎫 Collecting from Eventbrite API...')
        const eventbriteResults = await collectFromEventbrite(city, region, country, latitude, longitude, max_per_source)
        
        for (const event of eventbriteResults) {
          const { data: existing } = await supabase
            .from('activities_cache')
            .select('id')
            .eq('source', 'eventbrite')
            .eq('source_id', event.source_id)
            .single()

          if (!existing) {
            const { error } = await supabase
              .from('activities_cache')
              .insert(event)

            if (!error) {
              totalAdded++
              console.log(`✅ Added Eventbrite event: ${event.title}`)
            }
          }
        }

        results.eventbrite = {
          found: eventbriteResults.length,
          status: 'success'
        }
        totalFound += eventbriteResults.length

      } catch (error) {
        console.error('Eventbrite collection error:', error)
        results.eventbrite = { error: error.message, status: 'failed' }
      }
    }

    // Meetup API Integration
    if (sources.includes('meetup')) {
      try {
        console.log('👥 Collecting from Meetup API...')
        const meetupResults = await collectFromMeetup(city, region, country, latitude, longitude, max_per_source)
        
        for (const meetup of meetupResults) {
          const { data: existing } = await supabase
            .from('activities_cache')
            .select('id')
            .eq('source', 'meetup')
            .eq('source_id', meetup.source_id)
            .single()

          if (!existing) {
            const { error } = await supabase
              .from('activities_cache')
              .insert(meetup)

            if (!error) {
              totalAdded++
              console.log(`✅ Added Meetup event: ${meetup.title}`)
            }
          }
        }

        results.meetup = {
          found: meetupResults.length,
          status: 'success'
        }
        totalFound += meetupResults.length

      } catch (error) {
        console.error('Meetup collection error:', error)
        results.meetup = { error: error.message, status: 'failed' }
      }
    }

    // Open Data Integration
    if (sources.includes('open_data')) {
      try {
        console.log('🏛️ Collecting from Open Data sources...')
        const openDataResults = await collectFromOpenData(city, region, country, latitude, longitude, max_per_source)
        
        for (const item of openDataResults) {
          const { data: existing } = await supabase
            .from('activities_cache')
            .select('id')
            .eq('source', 'open_data')
            .eq('source_id', item.source_id)
            .single()

          if (!existing) {
            const { error } = await supabase
              .from('activities_cache')
              .insert(item)

            if (!error) {
              totalAdded++
              console.log(`✅ Added Open Data item: ${item.title}`)
            }
          }
        }

        results.open_data = {
          found: openDataResults.length,
          status: 'success'
        }
        totalFound += openDataResults.length

      } catch (error) {
        console.error('Open Data collection error:', error)
        results.open_data = { error: error.message, status: 'failed' }
      }
    }

    console.log(`🎯 Legitimate collection complete: ${totalAdded} new activities from ${totalFound} found`)

    return new Response(
      JSON.stringify({
        success: true,
        city,
        region,
        country,
        total_found: totalFound,
        total_added: totalAdded,
        sources_used: sources,
        results
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )

  } catch (error) {
    console.error('Legitimate collector error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})

// YELP FUSION API INTEGRATION
async function collectFromYelp(city: string, region: string, country: string, lat: number, lng: number, limit: number): Promise<any[]> {
  const venues: any[] = []
  
  // Yelp categories to search
  const categories = [
    'restaurants', 'bars', 'coffee', 'nightlife',
    'arts', 'museums', 'galleries', 'theaters',
    'active', 'tours', 'shopping', 'spas'
  ]

  for (const category of categories.slice(0, 4)) { // Limit categories to stay within rate limits
    try {
      // Yelp Fusion API search
      const yelpUrl = `https://api.yelp.com/v3/businesses/search?` +
        `latitude=${lat}&longitude=${lng}&` +
        `categories=${category}&` +
        `limit=${Math.min(limit / categories.length, 20)}&` +
        `sort_by=rating&` +
        `radius=20000` // 20km radius

      const response = await fetch(yelpUrl, {
        headers: {
          'Authorization': `Bearer ${Deno.env.get('YELP_API_KEY')}`,
          'User-Agent': 'GoPlai/1.0'
        }
      })

      if (!response.ok) {
        console.warn(`Yelp API returned ${response.status} for category ${category}`)
        continue
      }

      const data = await response.json()
      
      for (const business of data.businesses || []) {
        venues.push({
          source: 'yelp',
          source_id: business.id,
          title: business.name,
          description: `${business.categories?.map((c: any) => c.title).join(', ') || 'Local business'} - ${business.review_count} reviews on Yelp`,
          location_name: business.location?.display_address?.join(', ') || `${city}, ${region}`,
          latitude: business.coordinates?.latitude,
          longitude: business.coordinates?.longitude,
          city,
          cost_min: business.price?.length ? business.price.length * 10 : 0,
          cost_max: business.price?.length ? business.price.length * 25 : null,
          cost_description: business.price || 'See venue for pricing',
          tags: ['yelp', 'verified', ...(business.categories?.map((c: any) => c.alias) || [])],
          categories: categorizeYelpBusiness(business),
          age_appropriate: ['all_ages'],
          indoor_outdoor: inferIndoorOutdoor(business),
          booking_required: false,
          source_url: business.url,
          image_url: business.image_url,
          quality_score: calculateYelpQuality(business),
          relevance_score: business.rating / 5,
          scraped_data: {
            yelp_rating: business.rating,
            yelp_review_count: business.review_count,
            yelp_price: business.price,
            yelp_categories: business.categories,
            phone: business.phone,
            is_closed: business.is_closed
          },
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days
        })
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000))

    } catch (error) {
      console.error(`Error fetching Yelp category ${category}:`, error)
    }
  }

  return venues
}

// EVENTBRITE API INTEGRATION
async function collectFromEventbrite(city: string, region: string, country: string, lat: number, lng: number, limit: number): Promise<any[]> {
  const events: any[] = []
  
  try {
    // Eventbrite public events search
    const eventbriteUrl = `https://www.eventbriteapi.com/v3/events/search/?` +
      `location.latitude=${lat}&location.longitude=${lng}&` +
      `location.within=25km&` +
      `start_date.range_start=${new Date().toISOString()}&` +
      `start_date.range_end=${new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()}&` +
      `status=live&` +
      `order_by=start_asc&` +
      `expand=venue,organizer,category&` +
      `page_size=${Math.min(limit, 50)}`

    const response = await fetch(eventbriteUrl, {
      headers: {
        'Authorization': `Bearer ${Deno.env.get('EVENTBRITE_API_KEY')}`,
        'User-Agent': 'GoPlai/1.0'
      }
    })

    if (!response.ok) {
      console.warn(`Eventbrite API returned ${response.status}`)
      return events
    }

    const data = await response.json()
    
    for (const event of data.events || []) {
      if (isEventRelevant(event)) {
        events.push({
          source: 'eventbrite',
          source_id: event.id,
          title: event.name?.text || 'Eventbrite Event',
          description: (event.description?.text || event.summary || '').slice(0, 500),
          location_name: event.venue?.name || `${city}, ${region}`,
          latitude: event.venue?.latitude ? parseFloat(event.venue.latitude) : null,
          longitude: event.venue?.longitude ? parseFloat(event.venue.longitude) : null,
          city,
          start_time: event.start?.local,
          end_time: event.end?.local,
          cost_min: event.is_free ? 0 : 10,
          cost_max: event.is_free ? 0 : null,
          cost_description: event.is_free ? 'Free' : 'Paid event - see Eventbrite for pricing',
          tags: ['eventbrite', 'event', 'scheduled'],
          categories: categorizeEventbriteEvent(event),
          age_appropriate: ['all_ages'],
          indoor_outdoor: 'mixed',
          booking_required: true,
          source_url: event.url,
          image_url: event.logo?.url,
          quality_score: calculateEventbriteQuality(event),
          relevance_score: 0.8,
          scraped_data: {
            eventbrite_id: event.id,
            organizer_name: event.organizer?.name,
            category: event.category?.name,
            capacity: event.capacity,
            is_free: event.is_free,
            status: event.status
          },
          expires_at: event.end?.local || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        })
      }
    }

  } catch (error) {
    console.error('Eventbrite collection error:', error)
  }

  return events
}

// MEETUP API INTEGRATION
async function collectFromMeetup(city: string, region: string, country: string, lat: number, lng: number, limit: number): Promise<any[]> {
  const events: any[] = []
  
  try {
    // Meetup GraphQL API for finding events
    const meetupQuery = {
      query: `
        query($lat: Float!, $lon: Float!, $radius: Int!, $first: Int!) {
          rankedEvents(filter: {
            lat: $lat,
            lon: $lon,
            radius: $radius,
            startDateRange: "2024-01-01,2025-12-31"
          }, first: $first) {
            edges {
              node {
                id
                title
                description
                dateTime
                endTime
                venue {
                  name
                  address
                  lat
                  lng
                }
                group {
                  name
                  urlname
                }
                eventUrl
                images {
                  baseUrl
                }
                isOnline
                maxTickets
                rsvpState
              }
            }
          }
        }
      `,
      variables: {
        lat: lat,
        lon: lng,
        radius: 25, // 25 mile radius
        first: Math.min(limit, 50)
      }
    }

    const response = await fetch('https://www.meetup.com/gql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('MEETUP_API_KEY')}`,
        'User-Agent': 'GoPlai/1.0'
      },
      body: JSON.stringify(meetupQuery)
    })

    if (!response.ok) {
      console.warn(`Meetup API returned ${response.status}`)
      return events
    }

    const data = await response.json()
    
    for (const edge of data.data?.rankedEvents?.edges || []) {
      const event = edge.node
      
      events.push({
        source: 'meetup',
        source_id: event.id,
        title: event.title,
        description: (event.description || '').slice(0, 500),
        location_name: event.venue?.name || `${city}, ${region}`,
        latitude: event.venue?.lat,
        longitude: event.venue?.lng,
        city,
        start_time: event.dateTime,
        end_time: event.endTime,
        cost_min: 0, // Most meetups are free
        cost_max: 0,
        cost_description: 'Free community event',
        tags: ['meetup', 'community', 'social'],
        categories: categorizeMeetupEvent(event),
        age_appropriate: ['adults'],
        indoor_outdoor: event.isOnline ? 'online' : 'mixed',
        booking_required: true,
        source_url: event.eventUrl,
        quality_score: 0.7,
        relevance_score: 0.8,
        scraped_data: {
          meetup_id: event.id,
          group_name: event.group?.name,
          group_url: event.group?.urlname,
          max_tickets: event.maxTickets,
          is_online: event.isOnline
        },
        expires_at: event.endTime || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      })
    }

  } catch (error) {
    console.error('Meetup collection error:', error)
  }

  return events
}

// OPEN DATA INTEGRATION
async function collectFromOpenData(city: string, region: string, country: string, lat: number, lng: number, limit: number): Promise<any[]> {
  const items: any[] = []
  
  // City-specific open data endpoints
  const openDataUrls = getOpenDataUrls(city, region, country)
  
  for (const dataSource of openDataUrls.slice(0, 3)) { // Limit to prevent timeout
    try {
      console.log(`📊 Fetching from: ${dataSource.name}`)
      
      const response = await fetch(dataSource.url, {
        headers: {
          'User-Agent': 'GoPlai/1.0 Open Data Consumer',
          'Accept': 'application/json'
        }
      })

      if (!response.ok) {
        console.warn(`Open data source ${dataSource.name} returned ${response.status}`)
        continue
      }

      const data = await response.json()
      const processedItems = processOpenDataResponse(data, dataSource, city, region)
      
      items.push(...processedItems.slice(0, Math.floor(limit / openDataUrls.length)))
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000))

    } catch (error) {
      console.error(`Error fetching open data from ${dataSource.name}:`, error)
    }
  }

  return items
}

// HELPER FUNCTIONS

function categorizeYelpBusiness(business: any): string[] {
  const categories = business.categories?.map((c: any) => c.alias) || []
  const mappedCategories = []

  if (categories.some((c: string) => ['restaurants', 'food', 'bars', 'coffee'].includes(c))) {
    mappedCategories.push('food')
  }
  if (categories.some((c: string) => ['arts', 'museums', 'galleries'].includes(c))) {
    mappedCategories.push('culture')
  }
  if (categories.some((c: string) => ['active', 'fitness', 'outdoor'].includes(c))) {
    mappedCategories.push('fitness')
  }
  if (categories.some((c: string) => ['shopping', 'retail'].includes(c))) {
    mappedCategories.push('shopping')
  }

  return mappedCategories.length > 0 ? mappedCategories : ['general']
}

function categorizeEventbriteEvent(event: any): string[] {
  const title = (event.name?.text || '').toLowerCase()
  const description = (event.description?.text || '').toLowerCase()
  const content = title + ' ' + description

  const categories = []
  
  if (content.includes('workshop') || content.includes('class') || content.includes('learn')) {
    categories.push('education')
  }
  if (content.includes('food') || content.includes('wine') || content.includes('cooking')) {
    categories.push('food')
  }
  if (content.includes('art') || content.includes('music') || content.includes('culture')) {
    categories.push('culture')
  }
  if (content.includes('fitness') || content.includes('yoga') || content.includes('outdoor')) {
    categories.push('fitness')
  }

  return categories.length > 0 ? categories : ['event']
}

function categorizeMeetupEvent(event: any): string[] {
  const title = (event.title || '').toLowerCase()
  const description = (event.description || '').toLowerCase()
  const groupName = (event.group?.name || '').toLowerCase()
  const content = title + ' ' + description + ' ' + groupName

  const categories = []
  
  if (content.includes('tech') || content.includes('programming') || content.includes('developer')) {
    categories.push('technology')
  }
  if (content.includes('network') || content.includes('business') || content.includes('professional')) {
    categories.push('networking')
  }
  if (content.includes('language') || content.includes('learn') || content.includes('skill')) {
    categories.push('education')
  }
  if (content.includes('outdoor') || content.includes('hiking') || content.includes('adventure')) {
    categories.push('outdoor')
  }
  if (content.includes('social') || content.includes('friends') || content.includes('community')) {
    categories.push('social')
  }

  return categories.length > 0 ? categories : ['community']
}

function inferIndoorOutdoor(business: any): string {
  const categories = business.categories?.map((c: any) => c.alias) || []
  
  if (categories.some((c: string) => ['parks', 'hiking', 'beaches', 'outdoor'].includes(c))) {
    return 'outdoor'
  }
  if (categories.some((c: string) => ['restaurants', 'bars', 'museums', 'shopping'].includes(c))) {
    return 'indoor'
  }
  
  return 'mixed'
}

function calculateYelpQuality(business: any): number {
  let score = 0.5
  
  if (business.rating >= 4.0) score += 0.2
  if (business.review_count >= 50) score += 0.1
  if (business.review_count >= 200) score += 0.1
  if (business.price) score += 0.1 // Has pricing info
  
  return Math.min(1.0, score)
}

function calculateEventbriteQuality(event: any): number {
  let score = 0.6 // Base score for Eventbrite events
  
  if (event.description?.text && event.description.text.length > 100) score += 0.1
  if (event.venue?.name) score += 0.1
  if (event.organizer?.name) score += 0.1
  if (event.logo?.url) score += 0.1
  
  return Math.min(1.0, score)
}

function isEventRelevant(event: any): boolean {
  const title = (event.name?.text || '').toLowerCase()
  const description = (event.description?.text || '').toLowerCase()
  
  // Include events that are experiential/activity-based
  const relevantKeywords = [
    'workshop', 'class', 'tour', 'experience', 'activity', 'food', 'art',
    'music', 'outdoor', 'adventure', 'cultural', 'festival', 'market'
  ]
  
  // Exclude corporate/business events
  const excludeKeywords = [
    'webinar', 'conference call', 'meeting', 'sales', 'marketing',
    'corporate training', 'business development'
  ]
  
  const content = title + ' ' + description
  const hasRelevant = relevantKeywords.some(keyword => content.includes(keyword))
  const hasExclude = excludeKeywords.some(keyword => content.includes(keyword))
  
  return hasRelevant && !hasExclude
}

function getOpenDataUrls(city: string, region: string, country: string): any[] {
  const cityLower = city.toLowerCase()
  const urls = []

  // Add city-specific open data sources
  if (cityLower === 'vancouver' && country.toLowerCase() === 'canada') {
    urls.push({
      name: 'Vancouver Open Data - Events',
      url: 'https://opendata.vancouver.ca/api/records/1.0/search/?dataset=city-events&rows=50',
      type: 'vancouver_events'
    })
  }
  
  if (cityLower === 'toronto' && country.toLowerCase() === 'canada') {
    urls.push({
      name: 'Toronto Open Data - Recreation',
      url: 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search?resource_id=parks-and-recreation&limit=50',
      type: 'toronto_recreation'
    })
  }
  
  if (cityLower === 'seattle' && country.toLowerCase() === 'usa') {
    urls.push({
      name: 'Seattle Open Data - Parks',
      url: 'https://data.seattle.gov/resource/kzjm-xkqj.json?$limit=50',
      type: 'seattle_parks'
    })
  }

  // Generic fallbacks
  urls.push({
    name: `${city} Generic Open Data Search`,
    url: `https://www.${cityLower}.gov/api/data/events`,
    type: 'generic_municipal'
  })

  return urls
}

function processOpenDataResponse(data: any, source: any, city: string, region: string): any[] {
  const items = []
  
  try {
    // Handle different open data response formats
    const records = data.records || data.result?.records || data.results || data
    
    if (!Array.isArray(records)) return items
    
    for (const record of records.slice(0, 20)) {
      const fields = record.fields || record
      
      // Extract relevant fields (varies by city)
      const title = fields.name || fields.title || fields.event_name || 'Open Data Item'
      const description = fields.description || fields.details || ''
      const location = fields.location || fields.address || `${city}, ${region}`
      
      if (title && title.length > 3) {
        items.push({
          source: 'open_data',
          source_id: `${source.type}_${fields.id || Math.random().toString(36)}`,
          title,
          description: description.slice(0, 500),
          location_name: location,
          city,
          cost_min: 0,
          cost_max: 0,
          cost_description: 'Free public facility/service',
          tags: ['open_data', 'government', 'public'],
          categories: ['community'],
          age_appropriate: ['all_ages'],
          indoor_outdoor: 'mixed',
          booking_required: false,
          source_url: source.url,
          quality_score: 0.8, // Open data is generally reliable
          relevance_score: 0.7,
          scraped_data: {
            open_data_source: source.name,
            original_fields: fields
          },
          expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString() // 90 days
        })
      }
    }
  } catch (error) {
    console.error('Error processing open data response:', error)
  }

  return items
}
