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
      country = 'Canada',
      hashtags = [],
      max_videos = 30 
    } = await req.json()
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    console.log(`🎵 Starting TikTok hashtag scrape for ${city}, ${country}`)
    
    // Generate city-specific hashtags if none provided
    const targetHashtags = hashtags.length > 0 ? hashtags : generateCityHashtags(city, country)
    
    let totalVideos = 0
    let newActivities = 0
    const results: any = {}

    for (const hashtag of targetHashtags.slice(0, 5)) { // Limit to 5 hashtags
      try {
        console.log(`🔍 Scraping TikTok hashtag: #${hashtag}`)
        
        const videos = await scrapeTikTokHashtag(hashtag, Math.floor(max_videos / targetHashtags.length))
        console.log(`📱 Found ${videos.length} videos for #${hashtag}`)
        
        for (const video of videos) {
          if (isActivityRelevant(video, city)) {
            console.log(`✅ Activity-relevant video: "${video.title}"`)
            
            const activity = processVideoToActivity(video, city, country, hashtag)
            
            // Check if already exists
            const { data: existing } = await supabase
              .from('raw_events')
              .select('id')
              .eq('source_url', video.video_url)
              .single()

            if (!existing) {
              const { error } = await supabase
                .from('raw_events')
                .insert(activity)

              if (!error) {
                newActivities++
                console.log(`✅ Added TikTok activity: "${activity.title}"`)
              } else {
                console.error(`❌ Insert error: ${error.message}`)
              }
            } else {
              console.log(`⚠️ Video already processed: "${video.title}"`)
            }
          }
        }

        results[hashtag] = {
          videos_found: videos.length,
          activities_extracted: videos.filter(v => isActivityRelevant(v, city)).length
        }
        totalVideos += videos.length

        // Rate limiting between hashtags
        await new Promise(resolve => setTimeout(resolve, 3000))

      } catch (error) {
        console.error(`Error scraping hashtag #${hashtag}:`, error)
        results[hashtag] = { error: error.message }
      }
    }

    console.log(`🎯 TikTok scraping complete: ${newActivities} new activities from ${targetHashtags.length} hashtags`)

    return new Response(
      JSON.stringify({
        success: true,
        city,
        country,
        hashtags_scraped: targetHashtags,
        total_videos_found: totalVideos,
        new_activities_added: newActivities,
        results
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )

  } catch (error) {
    console.error('TikTok scraper error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})

function generateCityHashtags(city: string, country: string): string[] {
  const cityLower = city.toLowerCase().replace(/\s+/g, '')
  const cityNoSpaces = city.replace(/\s+/g, '')
  
  if (city.toLowerCase() === 'victoria' && country.toLowerCase() === 'canada') {
    return [
      'VictoriaBC',
      'YYJEats', 
      'VancouverIsland',
      'YYJLife',
      'VictoriaBCFood',
      'VictoriaVibes',
      'YYJEvents',
      'VictoriaSecrets',
      'BCLife',
      'VictoriaCanada'
    ]
  }
  
  // Generic city hashtag patterns
  return [
    cityNoSpaces,
    `${cityNoSpaces}Life`,
    `${cityNoSpaces}Food`,
    `${cityNoSpaces}Eats`,
    `${cityNoSpaces}Events`,
    `${cityNoSpaces}Vibes`,
    `Visit${cityNoSpaces}`,
    `${cityLower}`,
    `${cityNoSpaces}Travel`,
    `${cityNoSpaces}Local`
  ]
}

async function scrapeTikTokHashtag(hashtag: string, maxVideos: number = 10): Promise<any[]> {
  const videos: any[] = []
  
  try {
    // TikTok web hashtag endpoint
    const url = `https://www.tiktok.com/tag/${hashtag}`
    
    console.log(`🌐 Fetching: ${url}`)
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'Referer': 'https://www.google.com/'
      }
    })

    if (!response.ok) {
      console.warn(`TikTok hashtag ${hashtag} returned ${response.status}`)
      return videos
    }

    const html = await response.text()
    
    // Extract JSON data from TikTok's page
    const jsonMatches = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">(.*?)<\/script>/s)
    
    if (jsonMatches && jsonMatches[1]) {
      try {
        const data = JSON.parse(jsonMatches[1])
        const videoList = extractVideosFromTikTokData(data, hashtag, maxVideos)
        videos.push(...videoList)
      } catch (parseError) {
        console.error('JSON parsing error:', parseError)
        // Fallback to HTML parsing
        const htmlVideos = extractVideosFromHTML(html, hashtag, maxVideos)
        videos.push(...htmlVideos)
      }
    } else {
      // Fallback HTML parsing method
      const htmlVideos = extractVideosFromHTML(html, hashtag, maxVideos)
      videos.push(...htmlVideos)
    }

  } catch (error) {
    console.error(`Error fetching TikTok hashtag ${hashtag}:`, error)
  }

  return videos.slice(0, maxVideos)
}

function extractVideosFromTikTokData(data: any, hashtag: string, maxVideos: number): any[] {
  const videos: any[] = []
  
  try {
    // Navigate TikTok's JSON structure to find video data
    const challengeData = data?.default?.["webapp.challenge-detail"]?.["challenge-detail"]
    const videoItems = challengeData?.videoList || []

    for (const item of videoItems.slice(0, maxVideos)) {
      if (item?.video && item?.desc) {
        videos.push({
          video_id: item.id,
          title: item.desc,
          description: item.desc,
          author: item.author?.nickname || item.author?.uniqueId || 'Unknown',
          video_url: `https://www.tiktok.com/@${item.author?.uniqueId}/video/${item.id}`,
          view_count: item.stats?.playCount || 0,
          like_count: item.stats?.diggCount || 0,
          comment_count: item.stats?.commentCount || 0,
          hashtags: extractHashtagsFromDescription(item.desc),
          created_at: item.createTime ? new Date(item.createTime * 1000).toISOString() : new Date().toISOString(),
          source_hashtag: hashtag
        })
      }
    }
  } catch (error) {
    console.error('Error extracting from TikTok JSON data:', error)
  }

  return videos
}

function extractVideosFromHTML(html: string, hashtag: string, maxVideos: number): any[] {
  const videos: any[] = []
  
  try {
    // Regex patterns to extract basic video info from HTML
    const videoIdPattern = /"id":"(\d+)"/g
    const descPattern = /"desc":"([^"]+)"/g
    const authorPattern = /"uniqueId":"([^"]+)"/g

    const videoIds = Array.from(html.matchAll(videoIdPattern)).map(m => m[1])
    const descriptions = Array.from(html.matchAll(descPattern)).map(m => m[1])
    const authors = Array.from(html.matchAll(authorPattern)).map(m => m[1])

    for (let i = 0; i < Math.min(videoIds.length, descriptions.length, maxVideos); i++) {
      if (videoIds[i] && descriptions[i]) {
        videos.push({
          video_id: videoIds[i],
          title: descriptions[i],
          description: descriptions[i],
          author: authors[i] || 'Unknown',
          video_url: `https://www.tiktok.com/@${authors[i] || 'unknown'}/video/${videoIds[i]}`,
          view_count: 0,
          like_count: 0,
          comment_count: 0,
          hashtags: extractHashtagsFromDescription(descriptions[i]),
          created_at: new Date().toISOString(),
          source_hashtag: hashtag
        })
      }
    }
  } catch (error) {
    console.error('Error extracting from TikTok HTML:', error)
  }

  return videos
}

function extractHashtagsFromDescription(description: string): string[] {
  const hashtagMatches = description.match(/#[\w\u4e00-\u9fff]+/g) || []
  return hashtagMatches.map(tag => tag.slice(1)) // Remove # symbol
}

function isActivityRelevant(video: any, city: string): boolean {
  const content = (video.title + ' ' + video.description + ' ' + video.hashtags.join(' ')).toLowerCase()
  const cityLower = city.toLowerCase()

  console.log(`  📱 TikTok content: "${content.slice(0, 100)}..."`)

  // Activity and location keywords
  const activityKeywords = [
    // Food & Dining
    'restaurant', 'cafe', 'food', 'eat', 'dining', 'coffee', 'brunch', 'lunch', 'dinner',
    'bar', 'pub', 'brewery', 'cocktail', 'drink', 'taste', 'delicious', 'yummy', 'foodie',
    // Places & Attractions  
    'place', 'spot', 'location', 'visit', 'see', 'check out', 'hidden gem', 'secret',
    'view', 'beautiful', 'amazing', 'stunning', 'must see', 'attraction', 'destination',
    // Activities & Events
    'activity', 'event', 'festival', 'concert', 'show', 'market', 'shop', 'shopping',
    'hike', 'trail', 'walk', 'beach', 'park', 'outdoor', 'adventure', 'explore',
    'museum', 'gallery', 'art', 'culture', 'tour', 'experience', 'fun', 'enjoy',
    // Recommendations
    'recommend', 'suggestion', 'best', 'favorite', 'love', 'try', 'go to', 'perfect',
    'local', 'insider', 'tips', 'guide', 'where to', 'what to do'
  ]

  // Location confirmation
  const locationKeywords = [
    cityLower,
    cityLower.replace(/\s+/g, ''),
    // Victoria-specific
    'yyj', 'vancouver island', 'bc', 'british columbia', 'victoria bc'
  ]

  // Exclude irrelevant content
  const excludeKeywords = [
    'dance', 'dancing', 'tiktok dance', 'challenge', 'trend', 'viral', 'duet',
    'reaction', 'makeup', 'outfit', 'ootd', 'selfie', 'mirror', 'bedroom',
    'personal', 'private', 'home', 'family', 'drama', 'gossip'
  ]

  const hasActivityKeywords = activityKeywords.some(keyword => content.includes(keyword))
  const hasLocationKeywords = locationKeywords.some(keyword => content.includes(keyword))
  const hasExcludeKeywords = excludeKeywords.some(keyword => content.includes(keyword))

  // Must have both activity and location relevance
  const passes = hasActivityKeywords && hasLocationKeywords && !hasExcludeKeywords && 
                 video.view_count >= 100 // Minimum engagement threshold

  console.log(`  🎯 Activity keywords: ${hasActivityKeywords}`)
  console.log(`  📍 Location keywords: ${hasLocationKeywords}`)
  console.log(`  🚫 Exclude keywords: ${hasExcludeKeywords}`)
  console.log(`  👀 Views: ${video.view_count}`)
  console.log(`  📈 TikTok Filter result: ${passes ? 'PASS' : 'FAIL'}`)

  return passes
}

function processVideoToActivity(video: any, city: string, country: string, hashtag: string): any {
  // Extract location from description if possible
  const location = extractLocationFromDescription(video.description, city)
  
  // Categorize based on content
  const categories = categorizeVideoContent(video.description, video.hashtags)
  
  // Calculate quality score based on engagement
  const qualityScore = calculateVideoQualityScore(video)

  return {
    title: video.title.slice(0, 200), // Truncate long titles
    datetime: video.created_at,
    location: location || city,
    description: `TikTok video by @${video.author}: ${video.description}`.slice(0, 500),
    source_url: video.video_url,
    tags: ['tiktok', 'social_media', 'authentic', 'local', `hashtag_${hashtag}`],
    city,
    country,
    source_type: 'tiktok_hashtag',
    quality_score: qualityScore,
    scraped_data: {
      video_id: video.video_id,
      author: video.author,
      hashtags: video.hashtags,
      view_count: video.view_count,
      like_count: video.like_count,
      comment_count: video.comment_count,
      source_hashtag: hashtag
    }
  }
}

function extractLocationFromDescription(description: string, defaultCity: string): string {
  // Simple location extraction patterns
  const locationPatterns = [
    /at\s+([A-Z][a-zA-Z\s]+(?:Restaurant|Cafe|Bar|Park|Beach|Mall|Center|Store|Shop))/i,
    /(@\s*[A-Z][a-zA-Z\s]+)/,
    /(downtown|uptown|waterfront|harbour|harbor|beach|park)\s+([A-Z][a-zA-Z\s]*)/i
  ]

  for (const pattern of locationPatterns) {
    const match = description.match(pattern)
    if (match && match[1] && match[1].length > 3 && match[1].length < 50) {
      return match[1].trim()
    }
  }

  return defaultCity
}

function categorizeVideoContent(description: string, hashtags: string[]): string[] {
  const content = (description + ' ' + hashtags.join(' ')).toLowerCase()
  const categories = []

  const categoryMap = {
    'food': ['food', 'eat', 'restaurant', 'cafe', 'coffee', 'bar', 'drink', 'taste', 'delicious', 'foodie', 'dining'],
    'nature': ['beach', 'park', 'hike', 'trail', 'outdoor', 'nature', 'view', 'sunset', 'ocean', 'mountain'],
    'culture': ['museum', 'gallery', 'art', 'culture', 'history', 'heritage', 'festival', 'event'],
    'entertainment': ['show', 'concert', 'music', 'performance', 'festival', 'event', 'fun'],
    'shopping': ['shop', 'store', 'mall', 'market', 'boutique', 'shopping', 'buy'],
    'tourism': ['visit', 'tour', 'attraction', 'destination', 'explore', 'travel', 'sightseeing'],
    'local_life': ['local', 'community', 'neighborhood', 'insider', 'hidden', 'secret', 'gem']
  }

  for (const [category, keywords] of Object.entries(categoryMap)) {
    if (keywords.some(keyword => content.includes(keyword))) {
      categories.push(category)
    }
  }

  return categories.length > 0 ? categories : ['general']
}

function calculateVideoQualityScore(video: any): number {
  let score = 0.5 // Base score

  // Engagement metrics
  const views = video.view_count || 0
  const likes = video.like_count || 0
  const comments = video.comment_count || 0

  // View count scoring
  if (views > 1000) score += 0.1
  if (views > 10000) score += 0.1
  if (views > 100000) score += 0.1

  // Engagement rate scoring
  if (views > 0) {
    const engagementRate = (likes + comments) / views
    if (engagementRate > 0.05) score += 0.1 // 5% engagement
    if (engagementRate > 0.1) score += 0.1  // 10% engagement
  }

  // Content quality indicators
  const hasDescription = (video.description || '').length > 20
  if (hasDescription) score += 0.1

  const hasRelevantHashtags = video.hashtags.some((tag: string) => 
    ['food', 'travel', 'local', 'hidden', 'secret', 'best'].some(keyword => 
      tag.toLowerCase().includes(keyword)
    )
  )
  if (hasRelevantHashtags) score += 0.1

  return Math.min(1.0, Math.max(0.1, score))
}
