import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
serve(async (req) => {
  const corsHeaders = {'Access-Control-Allow-Origin': '*','Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'}
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { userId } = await req.json()
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const { data: activities } = await supabase.from('activities_cache').select('*').gt('expires_at', new Date().toISOString()).limit(10)
    return new Response(JSON.stringify({ success: true, recommendations: activities || [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } })
  }
})
