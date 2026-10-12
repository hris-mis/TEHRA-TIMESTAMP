// Run: NODE_PATH=/path/to/playwright/node_modules node tests/chrome-desktop.cjs
// Uses installed Chrome/Chromium via CHROME_PATH, or Playwright's bundled Chromium.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
    const browser = await chromium.launch({
        executablePath: process.env.CHROME_PATH || undefined,
        args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
    });
    try {
        const context = await browser.newContext({ permissions: ['camera', 'geolocation'],
            geolocation: { latitude: 10, longitude: 20, accuracy: 20 } });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        let geocodeFails = false;
        await page.route('**/*', route => {
            const url = route.request().url();
            if (url === 'http://localhost:8123/') return route.fulfill({ contentType: 'text/html',
                body: fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8') });
            if (url.includes('/reverse?')) return route.fulfill(geocodeFails
                ? { status: 503, body: '' }
                : { contentType: 'application/json', body: JSON.stringify({ display_name: 'Synthetic test address' }) });
            return route.fulfill({ body: url.includes('cdn.tailwindcss.com') ? 'window.tailwind = {};' : '' });
        });
        await page.goto('http://localhost:8123/');
        await page.waitForFunction(() => state.locationReady && document.querySelector('#webcam').videoWidth > 0);
        assert.match(await page.locator('#boxAccuracy').textContent(), /20 m/);
        await page.locator('#btnShutter').click();
        assert.equal(await page.evaluate(() => state.gallery.length), 0);
        for (const [id, value] of [['inputDept', 'MIS'], ['inputEmpName', 'Test Employee'], ['inputEmpId', 'TEST001']])
            await page.locator('#' + id).fill(value);
        await page.locator('#btnShutter').click();
        assert.equal(await page.evaluate(() => state.gallery.length), 1);
        assert(await page.evaluate(() => state.gallery[0].dataUrl.startsWith('data:image/jpeg;base64,')));
        await context.setGeolocation({ latitude: 30, longitude: 40, accuracy: 2000 });
        await page.locator('#btnResyncGps').click();
        await page.waitForFunction(() => state.locationReading?.accuracy === 2000);
        await page.locator('#btnShutter').click();
        assert.equal(await page.evaluate(() => state.gallery.length), 1);
        assert.match(await page.locator('#locationStatus').textContent(), /Desktop Chrome location may be approximate/);
        await context.setGeolocation({ latitude: 30, longitude: 40, accuracy: 10 });
        await page.locator('#btnResyncGps').click();
        await page.locator('#btnResyncGps').click();
        await page.waitForFunction(() => state.locationReady);
        assert.equal(await page.locator('#boxLatitude').textContent(), '30.000000° N');
        await page.evaluate(() => { state.locationReading.timestamp = Date.now() - 120000; });
        await page.locator('#btnShutter').click();
        assert.equal(await page.evaluate(() => state.gallery.length), 1);
        geocodeFails = true;
        await page.locator('#btnResyncGps').click();
        await page.waitForFunction(() => state.locationMessage.includes('Reverse geocoding failed'));
        await page.locator('#btnShutter').click();
        assert.equal(await page.evaluate(() => state.gallery.length), 1);
        assert(!await page.evaluate(() => state.lockedAddress.includes('Synthetic')));
        await page.locator('#btnOpenGallery').click();
        await page.locator('#galleryGrid img').click();
        assert((await page.locator('#btnDownloadCurrent').getAttribute('download')).startsWith('HRIS_Selfie_TEST001_'));
        await page.locator('#btnDeleteCurrent').click();
        assert.equal(await page.evaluate(() => state.gallery.length), 0);
        await context.clearPermissions();
        await page.locator('#btnResyncGps').click();
        await page.waitForFunction(() => state.locationMessage.includes('permission denied'));
        assert.equal(await page.locator('#boxLatitude').textContent(), 'Unavailable');
        assert.equal(await page.evaluate(() => locationIsUsable()), false);
        assert.deepEqual(errors, []);
        console.log('PASS: Chromium desktop permissions, accuracy, repeated Resync, stale capture guard, geocoding failure, mandatory fields, JPEG, gallery, preview/download and deletion. All locations/addresses are test fixtures.');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
