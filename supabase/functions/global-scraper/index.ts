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
      country = 'Canada',
      sources = ['community_centers', 'universities', 'farmers_markets'],
      max_events = 50 
    } = await req.json()
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    console.log(`🌍 Starting global scrape for ${city}, ${country}`)
    
    let totalEvents = 0
    let newEvents = 0
    const results: any = {}

    // Initialize scrapers
    const scrapers = {
      community_centers: new CommunityEventScraper(city, country),
      universities: new UniversityEventScraper(city, country),
      farmers_markets: new FarmersMarketScraper(city, country),
      outdoor_forums: new OutdoorForumScraper(city, country),
      local_news: new LocalNewsScraper(city, country),
      local_blogs: new LocalBlogScraper(city, country)
    }

    // Execute selected scrapers
    for (const sourceType of sources) {
      if (scrapers[sourceType as keyof typeof scrapers]) {
        try {
          console.log(`🔍 Scraping ${sourceType} for ${city}`)
          
          const scraper = scrapers[sourceType as keyof typeof scrapers]
          const events = await scraper.scrape(max_events / sources.length)
          
          console.log(`📄 Found ${events.length} events from ${sourceType}`)
          
          // Insert events into database
          for (const event of events) {
            const { data: existing } = await supabase
              .from('raw_events')
              .select('id')
              .eq('source_url', event.source_url)
              .eq('datetime', event.datetime)
              .single()

            if (!existing) {
              const { error } = await supabase
                .from('raw_events')
                .insert({
                  ...event,
                  city,
                  country,
                  inserted_at: new Date().toISOString()
                })

              if (!error) {
                newEvents++
                console.log(`✅ Added: ${event.title}`)
              } else {
                console.error(`❌ Insert error: ${error.message}`)
              }
            }
          }

          results[sourceType] = {
            scraped: events.length,
            new: events.filter(e => !e.exists).length
          }
          totalEvents += events.length

          // Rate limiting between sources
          await new Promise(resolve => setTimeout(resolve, 2000))

        } catch (error) {
          console.error(`Error scraping ${sourceType}:`, error)
          results[sourceType] = { error: error.message }
        }
      }
    }

    console.log(`🎯 Scraping complete: ${newEvents} new events from ${sources.length} sources`)

    return new Response(
      JSON.stringify({
        success: true,
        city,
        country,
        total_events_found: totalEvents,
        new_events_added: newEvents,
        sources_scraped: sources,
        results
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )

  } catch (error) {
    console.error('Global scraper error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})

// Base scraper class
class BaseScraper {
  constructor(protected city: string, protected country: string) {}

  protected async fetchPage(url: string): Promise<string> {
    // Check robots.txt compliance
    const robotsAllowed = await this.checkRobots(url)
    if (!robotsAllowed) {
      throw new Error(`Robots.txt disallows crawling ${url}`)
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GoPlai/1.0; +https://goplai.com/bot)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`)
    }

    return await response.text()
  }

  private async checkRobots(url: string): Promise<boolean> {
    try {
      const urlObj = new URL(url)
      const robotsUrl = `${urlObj.protocol}//${urlObj.host}/robots.txt`
      
      const response = await fetch(robotsUrl)
      if (!response.ok) return true // No robots.txt = allowed
      
      const robotsText = await response.text()
      
      // Simple robots.txt parser - check for Disallow rules
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
      return true // Error checking robots.txt = allowed
    }
  }

  protected parseDate(dateStr: string): string {
    try {
      // Handle various date formats
      const date = new Date(dateStr)
      return date.toISOString()
    } catch {
      // Default to today if parsing fails
      return new Date().toISOString()
    }
  }

  protected extractText(element: any): string {
    return element?.textContent?.trim() || ''
  }
}

// Community Centers & Libraries Scraper
class CommunityEventScraper extends BaseScraper {
  async scrape(maxEvents: number = 20): Promise<any[]> {
    const events: any[] = []
    
    // City-specific community center URLs
    const urls = this.getCommunityUrls()
    
    for (const url of urls.slice(0, 3)) { // Limit to 3 sources
      try {
        const html = await this.fetchPage(url)
        const parser = new DOMParser()
        const doc = parser.parseFromString(html, 'text/html')
        
        // Generic selectors for event listings
        const eventSelectors = [
          '.event', '.calendar-event', '.program', '.activity',
          '[class*="event"]', '[class*="program"]', '[class*="calendar"]'
        ]
        
        for (const selector of eventSelectors) {
          const elements = doc.querySelectorAll(selector)
          
          for (const element of Array.from(elements).slice(0, maxEvents)) {
            const title = this.extractEventTitle(element)
            const dateTime = this.extractEventDate(element)
            const location = this.extractEventLocation(element)
            const description = this.extractEventDescription(element)
            
            if (title && title.length > 5) {
              events.push({
                title,
                datetime: dateTime,
                location: location || `${this.city} Community Center`,
                description,
                source_url: url,
                tags: ['community', 'local', 'public'],
                source_type: 'community_center'
              })
            }
          }
          
          if (events.length >= maxEvents) break
        }
        
      } catch (error) {
        console.error(`Error scraping community URL ${url}:`, error)
      }
    }
    
    return events.slice(0, maxEvents)
  }

  private getCommunityUrls(): string[] {
    const cityLower = this.city.toLowerCase().replace(/\s+/g, '')
    
    // Common community center URL patterns
    return [
      `https://www.${cityLower}.ca/recreation/programs`,
      `https://www.${cityLower}.ca/events`,
      `https://www.${cityLower}.gov/parks-recreation/events`,
      `https://${cityLower}recreation.ca/programs`,
      `https://www.${cityLower}library.ca/events`,
      `https://${cityLower}.bibliocommons.com/events`
    ]
  }

  private extractEventTitle(element: any): string {
    const selectors = ['h1', 'h2', 'h3', '.title', '.name', '.event-title']
    for (const sel of selectors) {
      const titleEl = element.querySelector(sel)
      if (titleEl) return this.extractText(titleEl)
    }
    return this.extractText(element).split('\n')[0]
  }

  private extractEventDate(element: any): string {
    const selectors = ['.date', '.time', '.datetime', '.when', '[class*="date"]']
    for (const sel of selectors) {
      const dateEl = element.querySelector(sel)
      if (dateEl) {
        const dateText = this.extractText(dateEl)
        if (dateText) return this.parseDate(dateText)
      }
    }
    return new Date().toISOString()
  }

  private extractEventLocation(element: any): string {
    const selectors = ['.location', '.where', '.venue', '[class*="location"]']
    for (const sel of selectors) {
      const locEl = element.querySelector(sel)
      if (locEl) return this.extractText(locEl)
    }
    return ''
  }

  private extractEventDescription(element: any): string {
    const selectors = ['.description', '.details', '.summary', 'p']
    for (const sel of selectors) {
      const descEl = element.querySelector(sel)
      if (descEl) {
        const desc = this.extractText(descEl)
        if (desc.length > 20) return desc.slice(0, 500)
      }
    }
    return ''
  }
}

// Universities & Colleges Scraper
class UniversityEventScraper extends BaseScraper {
  async scrape(maxEvents: number = 15): Promise<any[]> {
    const events: any[] = []
    const urls = this.getUniversityUrls()
    
    // Similar implementation pattern as community scraper
    // ... (implement university-specific scraping logic)
    
    return events
  }

  private getUniversityUrls(): string[] {
    // University event calendar patterns
    return [
      `https://www.uvic.ca/events/`,
      `https://camosun.ca/events`,
      // Add more university patterns
    ]
  }
}

// Farmers Markets & Artisan Events Scraper  
class FarmersMarketScraper extends BaseScraper {
  async scrape(maxEvents: number = 10): Promise<any[]> {
    const events: any[] = []
    
    // Implementation for farmers market directories
    // ...
    
    return events
  }
}

// Outdoor Forums & Trail Reports Scraper
class OutdoorForumScraper extends BaseScraper {
  async scrape(maxEvents: number = 10): Promise<any[]> {
    const events: any[] = []
    
    // Implementation for outdoor community sites
    // ...
    
    return events
  }
}

// Local News & Radio Events Scraper
class LocalNewsScraper extends BaseScraper {
  async scrape(maxEvents: number = 15): Promise<any[]> {
    const events: any[] = []
    
    // Implementation for local news event calendars
    // ...
    
    return events
  }
}

// Independent Local Blogs Scraper
class LocalBlogScraper extends BaseScraper {
  async scrape(maxEvents: number = 10): Promise<any[]> {
    const events: any[] = []
    
    // Implementation for local blog content
    // ...
    
    return events
  }
}
