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
    const { city = 'Victoria', subreddits = [], limit = 50 } = await req.json()
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Default subreddits for Victoria, BC
    const defaultSubreddits = subreddits.length > 0 ? subreddits : [
      'VictoriaBC',
      'vancouverisland', 
      'britishcolumbia',
      'canada'
    ]

    let totalProcessed = 0
    let newActivities = []

    for (const subreddit of defaultSubreddits) {
      try {
        console.log(`🔍 Fetching r/${subreddit}...`)
        
        // Fetch Reddit JSON feed (no auth required)
        const redditUrl = `https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}`
        const response = await fetch(redditUrl, {
          headers: {
            'User-Agent': 'GoPlai/1.0 (Travel Activity Aggregator)'
          }
        })

        if (!response.ok) {
          console.warn(`Failed to fetch r/${subreddit}: ${response.status}`)
          continue
        }

        const data = await response.json()
        const posts = data.data?.children || []
        console.log(`📝 Found ${posts.length} posts in r/${subreddit}`)

        for (const post of posts) {
          const postData = post.data
          
          console.log(`\n🔍 Checking: "${postData.title}" (Score: ${postData.score})`)
          
          // Filter for activity-relevant posts
          if (isActivityRelevant(postData)) {
            console.log(`✅ Post passed filter: "${postData.title}"`)
            const activity = await processRedditPost(postData, city, subreddit)
            if (activity) {
              // Check if activity already exists
              const { data: existing } = await supabase
                .from('activities_cache')
                .select('id')
                .eq('source', 'reddit')
                .eq('source_id', postData.id)
                .single()

              if (!existing) {
                const { error } = await supabase
                  .from('activities_cache')
                  .insert(activity)

                if (!error) {
                  newActivities.push(activity)
                  totalProcessed++
                  console.log(`✅ Added activity: "${activity.title}"`)
                } else {
                  console.log(`❌ Database insert error: ${error.message}`)
                }
              } else {
                console.log(`⚠️ Activity already exists: "${postData.title}"`)
              }
            } else {
              console.log(`❌ Failed to process post: "${postData.title}"`)
            }
          } else {
            console.log(`❌ Post filtered out: "${postData.title}"`)
          }
        }

        // Rate limiting - wait between subreddit requests
        await new Promise(resolve => setTimeout(resolve, 1000))

      } catch (error) {
        console.error(`Error processing r/${subreddit}:`, error)
      }
    }

    console.log(`Reddit ingestion complete: ${totalProcessed} new activities from ${defaultSubreddits.join(', ')}`)

    return new Response(
      JSON.stringify({
        success: true,
        processed: totalProcessed,
        new_activities: newActivities.length,
        subreddits_checked: defaultSubreddits,
        sample_activities: newActivities.slice(0, 3)
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )

  } catch (error) {
    console.error('Reddit ingestion error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})

function isActivityRelevant(postData: any): boolean {
  const title = postData.title.toLowerCase()
  const text = (postData.selftext || '').toLowerCase()
  const content = title + ' ' + text

  console.log(`  📝 Content to check: "${content.slice(0, 100)}..."`)

  // More comprehensive activity keywords
  const activityKeywords = [
    // Events
    'event', 'festival', 'concert', 'show', 'exhibition', 'market', 'fair',
    'workshop', 'class', 'tour', 'walk', 'meetup', 'gathering', 'live',
    // Places
    'restaurant', 'cafe', 'bar', 'pub', 'brewery', 'museum', 'gallery',
    'park', 'trail', 'beach', 'hike', 'shop', 'store', 'attraction', 'location',
    'ice cream', 'food', 'coffee', 'view', 'place',
    // Recommendations
    'recommend', 'suggestion', 'suggest', 'best', 'favorite', 'good place',
    'check out', 'worth visiting', 'great place', 'love this', 'explore',
    'where to', 'looking for', 'anyone know'
  ]

  // Simplified exclude keywords
  const excludeKeywords = [
    'housing', 'apartment', 'rent', 'roommate', 'job', 'hiring',
    'for sale', 'selling', 'buy', 'traffic', 'politics', 'stench', 'hate'
  ]

  // Check for activity keywords
  const hasActivityKeywords = activityKeywords.some(keyword => content.includes(keyword))
  const hasExcludeKeywords = excludeKeywords.some(keyword => content.includes(keyword))

  console.log(`  🔍 Has activity keywords: ${hasActivityKeywords}`)
  console.log(`  🚫 Has exclude keywords: ${hasExcludeKeywords}`) 
  console.log(`  📊 Score: ${postData.score} (min: 5)`)
  console.log(`  🔞 NSFW: ${postData.over_18}`)

  // More lenient scoring and filtering
  const passes = hasActivityKeywords && 
         !hasExcludeKeywords &&
         postData.score >= 5 && 
         !postData.over_18

  console.log(`  📈 Final result: ${passes ? 'PASS' : 'FAIL'}`)
  
  return passes
}

async function processRedditPost(postData: any, city: string, subreddit: string): Promise<any> {
  const title = postData.title
  const description = postData.selftext || `Reddit post from r/${subreddit}`
  const url = `https://reddit.com${postData.permalink}`

  // Extract potential location from title/text
  const locationMatch = extractLocation(title + ' ' + description)
  
  // Categorize based on content
  const categories = categorizePost(title, description)
  
  // Calculate quality score based on Reddit metrics
  const qualityScore = calculateQualityScore(postData)

  return {
    source: 'reddit',
    source_id: postData.id,
    title: title,
    description: description.slice(0, 500), // Truncate long descriptions
    location_name: locationMatch || city,
    city: city,
    cost_min: 0, // Reddit posts don't typically have pricing
    cost_max: null,
    cost_description: 'See post for details',
    tags: [`reddit`, `r/${subreddit}`, `community_recommended`],
    categories: categories,
    age_appropriate: ['all_ages'], // Default - could be refined
    indoor_outdoor: 'mixed',
    booking_required: false,
    source_url: url,
    quality_score: qualityScore,
    relevance_score: qualityScore,
    scraped_data: {
      reddit_score: postData.score,
      reddit_comments: postData.num_comments,
      reddit_created: postData.created_utc,
      subreddit: subreddit
    },
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
  }
}

function extractLocation(text: string): string | null {
  // Simple location extraction - could be enhanced with NLP
  const locationPatterns = [
    /in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g,
    /at\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g,
    /near\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g
  ]

  for (const pattern of locationPatterns) {
    const match = pattern.exec(text)
    if (match && match[1].length < 50) {
      return match[1]
    }
  }

  return null
}

function categorizePost(title: string, description: string): string[] {
  const content = (title + ' ' + description).toLowerCase()
  const categories = []

  const categoryMap = {
    'food': ['restaurant', 'cafe', 'food', 'eat', 'dining', 'brewery', 'bar'],
    'culture': ['museum', 'gallery', 'art', 'exhibition', 'cultural', 'history'],
    'nature': ['park', 'trail', 'hike', 'beach', 'outdoor', 'nature', 'walk'],
    'entertainment': ['concert', 'show', 'event', 'festival', 'music', 'performance'],
    'shopping': ['shop', 'store', 'market', 'boutique', 'shopping'],
    'social': ['meetup', 'gathering', 'community', 'group', 'social']
  }

  for (const [category, keywords] of Object.entries(categoryMap)) {
    if (keywords.some(keyword => content.includes(keyword))) {
      categories.push(category)
    }
  }

  return categories.length > 0 ? categories : ['general']
}

function calculateQualityScore(postData: any): number {
  let score = 0.5 // Base score

  // Upvote ratio impact
  const upvoteRatio = postData.upvote_ratio || 0.5
  score += (upvoteRatio - 0.5) * 0.4

  // Comment engagement
  const comments = postData.num_comments || 0
  if (comments > 10) score += 0.1
  if (comments > 25) score += 0.1

  // Post score (upvotes)
  const postScore = postData.score || 0
  if (postScore > 20) score += 0.1
  if (postScore > 50) score += 0.1

  // Content quality indicators
  const hasDescription = (postData.selftext || '').length > 50
  if (hasDescription) score += 0.1

  return Math.min(1.0, Math.max(0.1, score))
}
