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
    const { userId, context = {} } = await req.json()
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get user profile and preferences
    const { data: user } = await supabase
      .from('users')
      .select('personality_profile, preferences, location_preferences')
      .eq('id', userId)
      .single()

    if (!user) {
      throw new Error('User not found')
    }

    // Get user's past feedback to understand preferences
    const { data: pastFeedback } = await supabase
      .from('user_feedback')
      .select('experience_id, rating, feedback_type')
      .eq('user_id', userId)
      .gte('rating', 4) // Only positive experiences

    // Extract location from context or user preferences
    const userLocation = context.location || user.location_preferences?.current_city || 'Victoria'
    const userLat = context.latitude || user.location_preferences?.latitude
    const userLng = context.longitude || user.location_preferences?.longitude

    // Build activity query based on user preferences
    let activitiesQuery = supabase
      .from('activities_cache')
      .select('*')
      .gt('expires_at', new Date().toISOString())
      .eq('city', userLocation)
      .gte('quality_score', 0.6) // Only good quality activities

    // Filter by user preferences if available
    const preferences = user.preferences || {}
    
    if (preferences.budget_max) {
      activitiesQuery = activitiesQuery.lte('cost_max', preferences.budget_max)
    }
    
    if (preferences.preferred_categories?.length > 0) {
      activitiesQuery = activitiesQuery.overlaps('categories', preferences.preferred_categories)
    }
    
    if (preferences.indoor_outdoor_preference) {
      activitiesQuery = activitiesQuery.eq('indoor_outdoor', preferences.indoor_outdoor_preference)
    }

    const { data: activities, error } = await activitiesQuery.limit(50)
    
    if (error) throw error

    // Score and rank activities based on user profile
    const scoredActivities = activities?.map(activity => {
      let score = activity.quality_score || 0.5

      // Boost score based on personality profile
      const personality = user.personality_profile || {}
      
      // Adventure seekers prefer outdoor, higher rarity
      if (personality.adventure_seeking > 0.7) {
        if (activity.indoor_outdoor === 'outdoor') score += 0.2
        if (activity.categories?.includes('adventure')) score += 0.3
      }
      
      // Social people prefer group activities
      if (personality.social_preference > 0.7) {
        if (activity.categories?.includes('social') || activity.categories?.includes('group')) score += 0.2
      }
      
      // Cultural interests
      if (personality.cultural_interest > 0.7) {
        if (activity.categories?.includes('culture') || activity.categories?.includes('arts')) score += 0.2
      }

      // Distance penalty if location is available
      if (userLat && userLng && activity.latitude && activity.longitude) {
        const distance = calculateDistance(userLat, userLng, activity.latitude, activity.longitude)
        if (distance > 20) score -= 0.1 // Penalty for far activities
        if (distance < 5) score += 0.1  // Bonus for nearby
      }

      // Boost activities similar to past positive experiences
      if (pastFeedback?.some(f => f.experience_id === activity.id)) {
        score += 0.3
      }

      // Time of day preferences
      const currentHour = new Date().getHours()
      if (currentHour >= 9 && currentHour <= 17) {
        // Daytime - prefer outdoor activities
        if (activity.indoor_outdoor === 'outdoor') score += 0.1
      } else {
        // Evening - prefer indoor activities
        if (activity.indoor_outdoor === 'indoor') score += 0.1
      }

      return {
        ...activity,
        recommendation_score: Math.min(score, 1.0),
        recommendation_reasons: generateReasons(activity, personality, preferences)
      }
    }) || []

    // Sort by score and return top recommendations
    const recommendations = scoredActivities
      .sort((a, b) => b.recommendation_score - a.recommendation_score)
      .slice(0, 10)

    // Generate context analysis
    const contextAnalysis = {
      timing: generateTimingAnalysis(new Date().getHours()),
      weather: "Great conditions", // Could integrate weather API
      availability: `Found ${recommendations.length} personalized recommendations`,
      personalization_factors: Object.keys(user.personality_profile || {}).filter(key => (user.personality_profile || {})[key] > 0.5),
      location_context: userLocation
    }

    console.log(`Generated ${recommendations.length} personalized recommendations for user: ${userId}`)
    
    return new Response(
      JSON.stringify({ 
        success: true,
        recommendations,
        context_analysis: contextAnalysis,
        user_profile_used: {
          has_preferences: Object.keys(preferences).length > 0,
          has_personality: Object.keys(user.personality_profile || {}).length > 0,
          past_feedback_count: pastFeedback?.length || 0
        }
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )

  } catch (error) {
    console.error('Recommendation error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})

// Helper functions
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371 // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return R * c
}

function generateReasons(activity: any, personality: any, preferences: any): string[] {
  const reasons = []
  
  if (activity.recommendation_score > 0.8) reasons.push("Highly recommended for you")
  if (activity.cost_min === 0) reasons.push("Free activity")
  if (activity.indoor_outdoor === 'outdoor' && personality.adventure_seeking > 0.7) {
    reasons.push("Perfect for adventure seekers")
  }
  if (activity.categories?.includes('culture') && personality.cultural_interest > 0.7) {
    reasons.push("Matches your cultural interests")
  }
  if (activity.quality_score > 0.8) reasons.push("High quality experience")
  
  return reasons.slice(0, 3) // Max 3 reasons
}

function generateTimingAnalysis(hour: number): string {
  if (hour >= 6 && hour < 12) return "Perfect morning activity time"
  if (hour >= 12 && hour < 17) return "Great afternoon adventure window"
  if (hour >= 17 && hour < 21) return "Ideal evening experience time"
  return "Late night activity options"
}
