const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://leafankrwvhdscjstwkf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxlYWZhbmtyd3ZoZHNjanN0d2tmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNTA3MjksImV4cCI6MjA5MTgyNjcyOX0.WG2bo313fznBlptywKrPnJBHUluftz3S53TYKJnfS6g';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function test() {
    try {
        const { data, error } = await supabase.from('scenepacks').select('*').limit(1);
        if (error) {
            console.error('Connection failed:', error);
        } else {
            console.log('Connection successful!', data);
        }
    } catch (e) {
        console.error('Exception:', e);
    }
}
test();

