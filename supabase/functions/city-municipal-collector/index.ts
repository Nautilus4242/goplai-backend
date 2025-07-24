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
      max_activities = 50 
    } = await req.json()
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    console.log(`🏛️ Starting municipal data collection for ${city}, ${region}, ${country}`)
    
    // Generate city-specific URLs
    const cityUrls = generateMunicipalUrls(city, region, country)
    
    let totalActivities = 0
    let newActivities = 0
    const results: any = {}

    for (const urlInfo of cityUrls) {
      try {
        console.log(`🔍 Checking: ${urlInfo.url}`)
        
        // Test if URL exists and is accessible
        if (await isUrlAccessible(urlInfo.url)) {
          console.log(`✅ Accessible: ${urlInfo.type} - ${urlInfo.url}`)
          
          const activities = await extractActivitiesFromPage(urlInfo.url, urlInfo.type, city, region, country)
          console.log(`📄 Found ${activities.length} activities from ${urlInfo.type}`)
          
          // Insert activities into database
          for (const activity of activities) {
            const { data: existing } = await supabase
              .from('activities_cache')
              .select('id')
              .eq('source_url', activity.source_url)
              .eq('title', activity.title)
              .single()

            if (!existing) {
              const { error } = await supabase
                .from('activities_cache')
                .insert(activity)

              if (!error) {
                newActivities++
                console.log(`✅ Added: ${activity.title}`)
              } else {
                console.error(`❌ Insert error: ${error.message}`)
              }
            }
          }

          results[urlInfo.type] = {
            url: urlInfo.url,
            status: 'success',
            activities_found: activities.length
          }
          totalActivities += activities.length

        } else {
          console.log(`❌ Not accessible: ${urlInfo.url}`)
          results[urlInfo.type] = {
            url: urlInfo.url,
            status: 'not_accessible'
          }
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000))

      } catch (error) {
        console.error(`Error processing ${urlInfo.url}:`, error)
        results[urlInfo.type] = {
          url: urlInfo.url,
          status: 'error',
          error: error.message
        }
      }
    }

    console.log(`🎯 Municipal collection complete: ${newActivities} new activities from ${Object.keys(results).length} sources`)

    return new Response(
      JSON.stringify({
        success: true,
        city,
        region,
        country,
        total_activities_found: totalActivities,
        new_activities_added: newActivities,
        sources_checked: Object.keys(results).length,
        results
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )

  } catch (error) {
    console.error('Municipal collector error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})

function generateMunicipalUrls(city: string, region: string, country: string): any[] {
  const cityLower = city.toLowerCase().replace(/\s+/g, '')
  const citySlug = city.toLowerCase().replace(/\s+/g, '-')
  const regionLower = region.toLowerCase()
  
  const urls: any[] = []

  // 1. Main City Government
  const cityPatterns = [
    `https://www.${cityLower}.ca`,
    `https://www.${cityLower}.gov`,  
    `https://www.${cityLower}.org`,
    `https://${cityLower}.ca`,
    `https://city.${cityLower}.ca`,
    `https://www.city-${citySlug}.ca`
  ]

  for (const baseUrl of cityPatterns) {
    urls.push({ url: `${baseUrl}/recreation`, type: 'city_recreation' })
    urls.push({ url: `${baseUrl}/parks-recreation`, type: 'city_parks' })
    urls.push({ url: `${baseUrl}/events`, type: 'city_events' })
    urls.push({ url: `${baseUrl}/programs`, type: 'city_programs' })
    urls.push({ url: `${baseUrl}/activities`, type: 'city_activities' })
    urls.push({ url: `${baseUrl}/community`, type: 'city_community' })
  }

  // 2. Regional Districts/Counties
  if (region) {
    const regionalPatterns = [
      `https://www.${regionLower}.ca`,
      `https://${regionLower}.ca`,
      `https://www.${regionLower}.gov`
    ]

    for (const baseUrl of regionalPatterns) {
      urls.push({ url: `${baseUrl}/recreation`, type: 'regional_recreation' })
      urls.push({ url: `${baseUrl}/events`, type: 'regional_events' })
      urls.push({ url: `${baseUrl}/parks`, type: 'regional_parks' })
    }
  }

  // 3. Public Libraries
  const libraryPatterns = [
    `https://${cityLower}library.ca/events`,
    `https://www.${cityLower}library.ca/events`,
    `https://${cityLower}library.org/events`,
    `https://library.${cityLower}.ca/events`,
    `https://${cityLower}.bibliocommons.com/events`
  ]

  libraryPatterns.forEach(url => {
    urls.push({ url, type: 'library_events' })
  })

  // 4. Community Centers
  const communityPatterns = [
    `https://${cityLower}rec.ca`,
    `https://www.${cityLower}rec.ca`,
    `https://${cityLower}recreation.ca`,
    `https://rec.${cityLower}.ca`
  ]

  communityPatterns.forEach(url => {
    urls.push({ url: `${url}/programs`, type: 'community_programs' })
    urls.push({ url: `${url}/events`, type: 'community_events' })
  })

  // 5. Arts & Culture Venues
  const culturePatterns = [
    `https://${cityLower}arts.ca`,
    `https://${cityLower}theatre.ca`,
    `https://${cityLower}museum.ca`,
    `https://arts.${cityLower}.ca`
  ]

  culturePatterns.forEach(url => {
    urls.push({ url: `${url}/events`, type: 'culture_events' })
    urls.push({ url: `${url}/shows`, type: 'culture_shows' })
  })

  return urls
}

async function isUrlAccessible(url: string): Promise<boolean> {
  try {
    // Check robots.txt first
    const robotsAllowed = await checkRobotsAllowed(url)
    if (!robotsAllowed) {
      console.log(`🤖 Robots.txt disallows: ${url}`)
      return false
    }

    const response = await fetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GoPlai/1.0; Municipal Event Collector)'
      }
    })

    return response.ok
  } catch {
    return false
  }
}

async function checkRobotsAllowed(url: string): Promise<boolean> {
  try {
    const urlObj = new URL(url)
    const robotsUrl = `${urlObj.protocol}//${urlObj.host}/robots.txt`
    
    const response = await fetch(robotsUrl)
    if (!response.ok) return true // No robots.txt = allowed
    
    const robotsText = await response.text()
    const lines = robotsText.split('\n')
    let userAgentMatch = false
    
    for (const line of lines) {
      const trimmed = line.trim().toLowerCase()
      if (trimmed.startsWith('user-agent:')) {
        userAgentMatch = trimmed.includes('*') || trimmed.includes('goplai')
      } else if (userAgentMatch && trimmed.startsWith('disallow:')) {
        const disallowPath = trimmed.split(':')[1].trim()
        if (disallowPath === '/' || urlObj.pathname.startsWith(disallowPath)) {
          return false
        }
      }
    }
    
    return true
  } catch {
    return true // Error = assume allowed
  }
}

async function extractActivitiesFromPage(url: string, sourceType: string, city: string, region: string, country: string): Promise<any[]> {
  const activities: any[] = []

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GoPlai/1.0; Municipal Event Collector)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    })

    if (!response.ok) return activities

    const html = await response.text()
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')

    // Generic selectors for municipal sites
    const activitySelectors = [
      '.event', '.program', '.activity', '.class', '.workshop',
      '[class*="event"]', '[class*="program"]', '[class*="activity"]',
      '.calendar-event', '.recreation-program', '.community-event'
    ]

    for (const selector of activitySelectors) {
      const elements = doc.querySelectorAll(selector)
      
      for (const element of Array.from(elements).slice(0, 20)) {
        const title = extractTitle(element)
        const description = extractDescription(element)
        const dateTime = extractDateTime(element)
        const location = extractLocation(element, city)

        if (title && title.length > 5 && isValidActivity(title, description)) {
          activities.push({
            source: 'municipal',
            source_id: `${sourceType}_${btoa(title + url).replace(/[^a-zA-Z0-9]/g, '').slice(0, 20)}`,
            title,
            description,
            location_name: location || `${city} Municipal Facility`,
            city,
            start_time: dateTime,
            cost_min: 0,
            cost_max: null,
            cost_description: 'See website for pricing',
            tags: ['municipal', 'community', sourceType],
            categories: categorizeMunicipalActivity(title, description, sourceType),
            age_appropriate: ['all_ages'],
            indoor_outdoor: 'mixed',
            booking_required: true,
            source_url: url,
            quality_score: 0.8, // Municipal sources are reliable
            relevance_score: 0.8,
            scraped_data: {
              source_type: sourceType,
              scraped_at: new Date().toISOString()
            },
            expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString() // 60 days
          })
        }
      }
    }

  } catch (error) {
    console.error(`Error extracting from ${url}:`, error)
  }

  return activities
}

function extractTitle(element: any): string {
  const selectors = ['h1', 'h2', 'h3', 'h4', '.title', '.name', '.program-title', '.event-title']
  for (const sel of selectors) {
    const titleEl = element.querySelector(sel)
    if (titleEl && titleEl.textContent?.trim()) {
      return titleEl.textContent.trim()
    }
  }
  
  // Fallback to element text
  const text = element.textContent?.trim() || ''
  return text.split('\n')[0].slice(0, 100)
}

function extractDescription(element: any): string {
  const selectors = ['.description', '.details', '.summary', '.content', 'p']
  for (const sel of selectors) {
    const descEl = element.querySelector(sel)
    if (descEl && descEl.textContent?.trim()?.length > 20) {
      return descEl.textContent.trim().slice(0, 500)
    }
  }
  return ''
}

function extractDateTime(element: any): string {
  const selectors = ['.date', '.time', '.datetime', '.when', '.schedule', '[class*="date"]']
  for (const sel of selectors) {
    const dateEl = element.querySelector(sel)
    if (dateEl && dateEl.textContent?.trim()) {
      try {
        const dateText = dateEl.textContent.trim()
        const date = new Date(dateText)
        if (!isNaN(date.getTime())) {
          return date.toISOString()
        }
      } catch {}
    }
  }
  
  // Default to 7 days from now
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
}

function extractLocation(element: any, defaultCity: string): string {
  const selectors = ['.location', '.venue', '.where', '.address', '[class*="location"]']
  for (const sel of selectors) {
    const locEl = element.querySelector(sel)
    if (locEl && locEl.textContent?.trim()) {
      return locEl.textContent.trim()
    }
  }
  return defaultCity
}

function isValidActivity(title: string, description: string): boolean {
  const content = (title + ' ' + description).toLowerCase()
  
  // Must contain activity-related keywords
  const validKeywords = [
    'class', 'program', 'workshop', 'event', 'activity', 'course', 'lesson',
    'fitness', 'art', 'music', 'dance', 'sport', 'recreation', 'community',
    'swim', 'yoga', 'craft', 'cooking', 'garden', 'nature', 'tour', 'walk'
  ]

  // Exclude administrative content
  const excludeKeywords = [
    'meeting', 'council', 'committee', 'budget', 'policy', 'bylaw',
    'staff', 'employment', 'job', 'tender', 'bid', 'contract'
  ]

  const hasValidKeywords = validKeywords.some(keyword => content.includes(keyword))
  const hasExcludeKeywords = excludeKeywords.some(keyword => content.includes(keyword))

  return hasValidKeywords && !hasExcludeKeywords && title.length > 5
}

function categorizeMunicipalActivity(title: string, description: string, sourceType: string): string[] {
  const content = (title + ' ' + description).toLowerCase()
  const categories = []

  const categoryMap = {
    'fitness': ['fitness', 'gym', 'workout', 'exercise', 'swim', 'aqua', 'yoga', 'pilates'],
    'arts': ['art', 'craft', 'paint', 'draw', 'pottery', 'creative', 'music', 'dance'],
    'education': ['class', 'course', 'lesson', 'learn', 'workshop', 'seminar', 'training'],
    'sports': ['sport', 'hockey', 'soccer', 'basketball', 'tennis', 'baseball', 'volleyball'],
    'children': ['kids', 'child', 'youth', 'junior', 'teen', 'family', 'parent'],
    'seniors': ['senior', 'adult', '55+', 'elder', 'mature'],
    'culture': ['culture', 'heritage', 'history', 'museum', 'library', 'book', 'reading'],
    'nature': ['park', 'nature', 'garden', 'outdoor', 'hiking', 'walk', 'environment']
  }

  for (const [category, keywords] of Object.entries(categoryMap)) {
    if (keywords.some(keyword => content.includes(keyword))) {
      categories.push(category)
    }
  }

  // Add source-based categories
  if (sourceType.includes('library')) categories.push('education')
  if (sourceType.includes('recreation')) categories.push('fitness')
  if (sourceType.includes('culture')) categories.push('culture')

  return categories.length > 0 ? categories : ['community']
}
