// api/sheets.js - Optimized with Server-Side Caching
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const API_KEY = process.env.GOOGLE_SHEETS_API_KEY;

// ✅ Server-side cache (persists across requests in same instance)
const serverCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Rate limiting
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_MINUTE = 30;

function checkRateLimit(ip) {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW;
    
    if (!rateLimitMap.has(ip)) {
        rateLimitMap.set(ip, []);
    }
    
    const requests = rateLimitMap.get(ip).filter(time => time > windowStart);
    rateLimitMap.set(ip, requests);
    
    if (requests.length >= MAX_REQUESTS_PER_MINUTE) {
        return false;
    }
    
    requests.push(now);
    return true;
}

// ✅ Clean expired cache entries periodically
function cleanExpiredCache() {
    const now = Date.now();
    for (const [key, value] of serverCache.entries()) {
        if (now - value.timestamp > CACHE_DURATION) {
            serverCache.delete(key);
        }
    }
}

// ✅ Get data from cache or fetch from Google Sheets
async function getCachedData(cacheKey, fetchFunction) {
    const now = Date.now();
    
    // Check if cached data exists and is still valid
    if (serverCache.has(cacheKey)) {
        const cached = serverCache.get(cacheKey);
        if (now - cached.timestamp < CACHE_DURATION) {
            console.log(`Cache HIT for: ${cacheKey}`);
            return cached.data;
        }
    }
    
    // Cache miss or expired - fetch new data
    console.log(`Cache MISS for: ${cacheKey} - Fetching from Google Sheets`);
    const data = await fetchFunction();
    
    // Store in cache
    serverCache.set(cacheKey, {
        data: data,
        timestamp: now
    });
    
    return data;
}

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', 'https://samakischool.app');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Rate limiting check
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || 
               req.headers['x-real-ip'] || 
               req.connection.remoteAddress || 
               'unknown';
    
    if (!checkRateLimit(ip)) {
        console.log(`Rate limit exceeded for IP: ${ip}`);
        return res.status(429).json({ 
            error: 'កំពុងមានអ្នកប្រើប្រាស់ច្រើនពេក។ សូមព្យាយាមមួយម៉ោងទៀត។' 
        });
    }

    const { sheet, action } = req.query;

    try {
        // Clean expired cache entries
        cleanExpiredCache();
        
        // ✅ Handle getting list of sheet names (with cache)
        if (action === 'list') {
            const cacheKey = 'sheet-names-list';
            
            const sheets = await getCachedData(cacheKey, async () => {
                const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?key=${API_KEY}`;
                const response = await fetch(url);
                
                if (!response.ok) {
                    throw new Error('Failed to fetch sheet names from Google Sheets');
                }
                
                const data = await response.json();
                return data.sheets.map(s => s.properties.title);
            });
            
            // ✅ Set aggressive CDN cache headers (5 minutes)
            res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
            
            return res.status(200).json({ 
                sheets,
                cached: serverCache.has(cacheKey),
                cacheAge: serverCache.has(cacheKey) 
                    ? Math.floor((Date.now() - serverCache.get(cacheKey).timestamp) / 1000) 
                    : 0
            });
        }

        // ✅ Handle getting specific sheet data (with cache)
        if (!sheet) {
            return res.status(400).json({ error: 'Sheet name is required' });
        }

        const cacheKey = `sheet-data-${sheet}`;
        
        const data = await getCachedData(cacheKey, async () => {
            const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(sheet)}?key=${API_KEY}`;
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch sheet "${sheet}" from Google Sheets`);
            }
            
            return await response.json();
        });
        
        // ✅ Set CDN cache headers (5 minutes)
        res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
        
        return res.status(200).json({
            ...data,
            cached: serverCache.has(cacheKey),
            cacheAge: serverCache.has(cacheKey) 
                ? Math.floor((Date.now() - serverCache.get(cacheKey).timestamp) / 1000) 
                : 0
        });
    } catch (error) {
        console.error('Error in sheets API:', error);
        return res.status(500).json({ 
            error: 'មិនអាចទាញយកទិន្នន័យបានទេ',
            details: error.message 
        });
    }
}

