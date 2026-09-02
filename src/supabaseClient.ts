import { createClient } from '@supabase/supabase-js'

// Remplace ces 2 valeurs par les tiennes — tu les trouves dans ton
// dashboard Supabase : Project Settings -> API
const supabaseUrl = 'https://aturumvtzbykfhflusun.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0dXJ1bXZ0emJ5a2ZoZmx1c3VuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3MTU3OTksImV4cCI6MjEwMjI5MTc5OX0.KaYlTo4HhI12yM0oQKEqc1VuhyVZA0EOCB-kl5phCRQ'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
