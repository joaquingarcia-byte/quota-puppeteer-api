const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
    origin: ['https://cbam.wdprc.net', 'http://localhost:5173'],
    methods: ['GET', 'POST'],
    credentials: true
}));
app.use(express.json());

app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'quota-puppeteer-api',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

app.get('/api/quota', async (req, res) => {
    const { orderNumber, year, origin } = req.query;

    if (!orderNumber || !year || !origin) {
        return res.status(400).json({
            error: 'Missing required parameters',
            required: ['orderNumber', 'year', 'origin'],
            received: { orderNumber, year, origin }
        });
    }

    console.log(`[${new Date().toISOString()}] Fetching quota: ${orderNumber} (${origin}, ${year})`);

    let browser = null;

    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');

        const currentYear = parseInt(year);
        const nextYear = currentYear + 1;
        const url = `https://ec.europa.eu/taxation_customs/dds2/taric/quota_consultation.jsp?Lang=en&Code=${orderNumber}&Origin=${origin}&Expand=true&Year=${currentYear}&Year=${nextYear}`;

        console.log(`[${new Date().toISOString()}] Navigating to: ${url}`);

        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        const result = await page.evaluate((ordNum) => {
            const rows = Array.from(document.querySelectorAll('tr'));

            for (const row of rows) {
                const cells = row.querySelectorAll('td');
                if (cells.length < 5) continue;

                const cellOrder = cells[0].textContent?.trim();
                if (cellOrder !== ordNum) continue;

                const origin = cells[1].textContent?.trim() || '';
                const startDate = cells[2].textContent?.trim() || '';
                const endDate = cells[3].textContent?.trim() || '';
                const balanceText = cells[4].textContent?.trim() || '';

                const match = balanceText.match(/([\d\s.]+)\s*(Kilogram|Tonne|kg|TNE)/i);
                if (!match) continue;

                const rawValue = parseFloat(match[1].replace(/\s/g, ''));
                const unit = match[2].toLowerCase();
                const isTonne = unit.startsWith('t') || unit === 'tne';
                const balanceKg = isTonne ? Math.round(rawValue * 1000) : rawValue;

                return {
                    orderNumber: ordNum,
                    origin: origin,
                    startDate: startDate,
                    endDate: endDate,
                    balance: `${Math.round(balanceKg)} Kilogram`,
                    balanceKg: Math.round(balanceKg),
                    unit: 'Kilogram',
                    moreInfoUrl: `https://ec.europa.eu/taxation_customs/dds2/taric/quota_tariff_details.jsp?Lang=en&StartDate=${startDate.split('-').reverse().join('-')}&Code=${ordNum}`,
                    scrapedAt: new Date().toISOString()
                };
            }

            return null;
        }, orderNumber);

        await browser.close();

        if (!result) {
            console.log(`[${new Date().toISOString()}] Quota not found: ${orderNumber}`);
            return res.status(404).json({
                error: 'Quota not found',
                orderNumber,
                origin,
                year
            });
        }

        console.log(`[${new Date().toISOString()}] Success: ${orderNumber} → ${result.balanceKg} kg`);

        return res.json({
            success: true,
            data: result,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error:`, error.message);

        if (browser) {
            await browser.close();
        }

        return res.status(500).json({
            error: 'Scraping failed',
            message: error.message,
            orderNumber,
            origin,
            year
        });
    }
});

app.listen(PORT, () => {
    console.log(`\n🚀 Quota Puppeteer API running on port ${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}/`);
    console.log(`📊 Endpoint: http://localhost:${PORT}/api/quota?orderNumber=098701&year=2025&origin=BR\n`);
});

module.exports = app;
