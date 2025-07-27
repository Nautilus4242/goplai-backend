import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts"

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
      sources = ['open_data', 'tourism_rss', 'municipal'],
      max_per_source = 30 
    } = await req.json()
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    console.log(`🌍 Starting free sources collection for ${city}, ${region}, ${country}`)
    
    let totalFound = 0
    let totalAdded = 0
    const results: any = {}

    // Open Data Sources
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

    // Tourism RSS Feeds
    if (sources.includes('tourism_rss')) {
      try {
        console.log('📰 Collecting from Tourism RSS feeds...')
        const rssResults = await collectFromTourismRSS(city, region, country, max_per_source)
        
        for (const item of rssResults) {
          const { data: existing } = await supabase
            .from('activities_cache')
            .select('id')
            .eq('source', 'tourism_rss')
            .eq('source_id', item.source_id)
            .single()

          if (!existing) {
            const { error } = await supabase
              .from('activities_cache')
              .insert(item)

            if (!error) {
              totalAdded++
              console.log(`✅ Added Tourism RSS item: ${item.title}`)
            }
          }
        }

        results.tourism_rss = {
          found: rssResults.length,
          status: 'success'
        }
        totalFound += rssResults.length

      } catch (error) {
        console.error('Tourism RSS collection error:', error)
        results.tourism_rss = { error: error.message, status: 'failed' }
      }
    }

    // Municipal Sources (Enhanced)
    if (sources.includes('municipal')) {
      try {
        console.log('🏛️ Collecting from Municipal sources...')
        const municipalResults = await collectFromMunicipal(city, region, country, max_per_source)
        
        for (const item of municipalResults) {
          const { data: existing } = await supabase
            .from('activities_cache')
            .select('id')
            .eq('source', 'municipal_enhanced')
            .eq('source_id', item.source_id)
            .single()

          if (!existing) {
            const { error } = await supabase
              .from('activities_cache')
              .insert(item)

            if (!error) {
              totalAdded++
              console.log(`✅ Added Municipal item: ${item.title}`)
            }
          }
        }

        results.municipal = {
          found: municipalResults.length,
          status: 'success'
        }
        totalFound += municipalResults.length

      } catch (error) {
        console.error('Municipal collection error:', error)
        results.municipal = { error: error.message, status: 'failed' }
      }
    }

    console.log(`🎯 Free sources collection complete: ${totalAdded} new activities from ${totalFound} found`)

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
    console.error('Free sources collector error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})

// OPEN DATA INTEGRATION
async function collectFromOpenData(city: string, region: string, country: string, lat: number, lng: number, limit: number): Promise<any[]> {
  const items: any[] = []
  
  // Get city-specific open data sources
  const openDataSources = getOpenDataSources(city, region, country)
  
  for (const source of openDataSources.slice(0, 4)) { // Limit to prevent timeout
    try {
      console.log(`📊 Fetching from: ${source.name}`)
      
      const response = await fetch(source.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; GoPlai/1.0; Open Data Consumer)',
          'Accept': 'application/json, text/xml, application/xml'
        }
      })

      if (!response.ok) {
        console.warn(`Open data source ${source.name} returned ${response.status}`)
        continue
      }

      const contentType = response.headers.get('content-type') || ''
      let data

      if (contentType.includes('application/json')) {
        data = await response.json()
      } else if (contentType.includes('xml')) {
        const xmlText = await response.text()
        data = parseXMLResponse(xmlText)
      } else {
        const text = await response.text()
        data = { text }
      }

      const processedItems = processOpenDataResponse(data, source, city, region)
      items.push(...processedItems.slice(0, Math.floor(limit / openDataSources.length)))
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000))

    } catch (error) {
      console.error(`Error fetching open data from ${source.name}:`, error)
    }
  }

  return items
}

// TOURISM RSS FEEDS INTEGRATION
async function collectFromTourismRSS(city: string, region: string, country: string, limit: number): Promise<any[]> {
  const items: any[] = []
  
  // Get tourism RSS feeds for the city
  const rssFeeds = getTourismRSSFeeds(city, region, country)
  
  for (const feed of rssFeeds.slice(0, 3)) { // Limit feeds to prevent timeout
    try {
      console.log(`📰 Fetching RSS: ${feed.name}`)
      
      const response = await fetch(feed.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; GoPlai/1.0; RSS Reader)',
          'Accept': 'application/rss+xml, application/xml, text/xml'
        }
      })

      if (!response.ok) {
        console.warn(`RSS feed ${feed.name} returned ${response.status}`)
        continue
      }

      const xmlText = await response.text()
      const rssItems = parseRSSFeed(xmlText)
      
      console.log(`📄 Found ${rssItems.length} RSS items from ${feed.name}`)

      for (const item of rssItems.slice(0, Math.floor(limit / rssFeeds.length))) {
        if (isRSSItemRelevant(item, city)) {
          items.push({
            source: 'tourism_rss',
            source_id: `${feed.type}_${item.guid || item.link || Math.random().toString(36)}`,
            title: item.title,
            description: item.description.slice(0, 500),
            location_name: extractLocationFromRSS(item, city, region),
            city,
            cost_min: 0,
            cost_max: null,
            cost_description: 'See article for details',
            tags: ['tourism', 'official', 'curated', feed.type],
            categories: categorizeRSSItem(item),
            age_appropriate: ['all_ages'],
            indoor_outdoor: 'mixed',
            booking_required: false,
            source_url: item.link,
            quality_score: 0.8, // Tourism content is generally high quality
            relevance_score: 0.8,
            scraped_data: {
              rss_feed: feed.name,
              pub_date: item.pubDate,
              feed_type: feed.type
            },
            expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString() // 60 days
          })
        }
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 3000))

    } catch (error) {
      console.error(`Error fetching RSS feed ${feed.name}:`, error)
    }
  }

  return items
}

// ENHANCED MUNICIPAL SOURCES
async function collectFromMunicipal(city: string, region: string, country: string, limit: number): Promise<any[]> {
  const items: any[] = []
  
  // Get enhanced municipal sources
  const municipalSources = getEnhancedMunicipalSources(city, region, country)
  
  for (const source of municipalSources.slice(0, 5)) {
    try {
      console.log(`🏛️ Checking municipal source: ${source.name}`)
      
      // Check if source is accessible
      if (await isSourceAccessible(source.url)) {
        const response = await fetch(source.url, {
          headers: {
