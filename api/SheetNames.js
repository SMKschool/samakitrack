// api/sheetNames.js
export default async function handler(req, res) {
    const API_KEY = process.env.GOOGLE_SHEETS_API_KEY;
    const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

    try {
        console.log('Fetching sheet names...');
        
        if (!API_KEY || !SPREADSHEET_ID) {
            throw new Error('API key or Spreadsheet ID not configured');
        }

        const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?key=${API_KEY}`;
        console.log('API URL:', url);
        
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Google Sheets API error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('Sheet names fetched successfully');
        res.status(200).json(data);
    } catch (error) {
        console.error('Error in sheetNames API:', error);
        res.status(500).json({ 
            error: 'មិនអាចទាញយកឈ្មោះស៊ីតបានទេ',
            details: error.message 
        });
    }
}
