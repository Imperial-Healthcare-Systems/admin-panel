import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const DUMMY_URL = 'https://placeholder.supabase.co'

function isValidUrl(url: string) {
  try { new URL(url); return true } catch { return false }
}

// Client-side (anon key, RLS-respecting)
export const supabase: SupabaseClient = createClient(
  isValidUrl(supabaseUrl) ? supabaseUrl : DUMMY_URL,
  supabaseAnonKey || 'placeholder-anon-key',
)

// Server-side admin (service role, bypasses RLS — never import in client code)
export const supabaseAdmin: SupabaseClient = createClient(
  isValidUrl(supabaseUrl) ? supabaseUrl : DUMMY_URL,
  supabaseServiceKey || 'placeholder-service-key',
  { auth: { autoRefreshToken: false, persistSession: false } },
)
