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
    const { userId, mood, context } = await req.json()
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Demo serendipity experience based on mood
    const moodExperiences = {
      adventurous: {
        id: 'demo-swing',
        name: 'The Secret Swing',
        description: 'A hidden tree swing with breathtaking city views',
        rarity_score: 9,
        magic_level: 0.9
      },
      relaxed: {
        id: 'demo-tea',
        name: 'Underground Tea Ceremony',
        description: 'A traditional tea ceremony in a secret location',
        rarity_score: 8,
        magic_level: 0.85
      },
      curious: {
        id: 'demo-library',
        name: 'Hidden Library Vault',
        description: 'A forgotten underground library with rare books',
        rarity_score: 9,
        magic_level: 0.87
      }
    }

    const experience = moodExperiences[mood] || moodExperiences.adventurous

    console.log(`Generating serendipity for user: ${userId}, mood: ${mood}`)
    
    return new Response(
      JSON.stringify({ 
        success: true,
        serendipity: {
          experience: experience,
          mood: mood,
          mysteryLevel: 0.8,
          whyNow: `Your ${mood} mood is perfectly aligned with this magical moment`,
          personalizedClues: ["Look for the carved heart in the tree trunk"],
          magicFactors: ["Perfect golden hour timing", `Matched to your ${mood} mood`]
        }
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
