// REQUIRE_ALL_BROWSERS=1 makes missing engines fail (used in CI).
const { chromium, firefox, webkit, devices } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const engines = { chromium, firefox, webkit };
const profiles = {
    chromium: [{ name: 'desktop', options: {} }, { name: 'Android viewport', options: devices['Pixel 7'] }],
    firefox: [{ name: 'desktop', options: {} }, { name: 'touch viewport', options: { viewport: { width: 390, height: 844 }, hasTouch: true } }],
    webkit: [{ name: 'desktop', options: {} }, { name: 'iPhone viewport', options: devices['iPhone 13'] }]
};
(async () => {
    let passed = 0;
    for (const [engine, launcher] of Object.entries(engines)) {
        const executablePath = engine === 'chromium' ? process.env.CHROME_PATH : undefined;
        if (!fs.existsSync(executablePath || launcher.executablePath())) {
            const message = `${engine}: engine unavailable; no test executed`;
            if (process.env.REQUIRE_ALL_BROWSERS === '1') throw new Error(message);
            console.log(`SKIP ${message}`); continue;
        }
        const browser = await launcher.launch({ executablePath });
        try {
            for (const profile of profiles[engine]) {
                const { defaultBrowserType, ...options } = profile.options;
                const context = await browser.newContext({ ...options, permissions: ['geolocation'],
                    geolocation: { latitude: 10, longitude: 20, accuracy: 15 } });
                try {
                    const page = await context.newPage();
                    await page.addInitScript(({ engine }) => {
                        // Record raw engine timestamps. Only Firefox's known synthetic
                        // future override is adapted; WebKit reaches production unchanged.
                        const getPosition = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
                        window.nativeLocationReadings = [];
                        navigator.geolocation.getCurrentPosition = (success, failure, options) => getPosition(position => {
                            const receivedAt = Date.now();
                            nativeLocationReadings.push({ timestamp: position.timestamp, receivedAt,
                                accuracy: position.coords.accuracy });
                            const timestamp = engine === 'firefox' ? receivedAt : position.timestamp;
                            success(engine === 'firefox' ? { coords: position.coords, timestamp } : position);
                        }, failure, options);
                        // Camera is deliberately outside this location-engine suite.
                        Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
                            value: async () => { throw new Error('Camera fixture unavailable'); }
                        });
                    }, { engine });
                    const errors = []; page.on('pageerror', e => errors.push(e.message));
                    let lookupFails = false;
                    await page.route('**/*', route => {
                        const url = route.request().url();
                        if (url === 'http://localhost:8123/') return route.fulfill({ contentType: 'text/html',
                            body: fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8') });
                        if (url.endsWith('/location-config.js')) return route.fulfill({ contentType: 'application/javascript',
                            body: fs.readFileSync(path.join(__dirname, '../location-config.js'), 'utf8') });
                        if (url.includes('/reverse?')) return route.fulfill(lookupFails ? { status: 503, body: '' }
                            : { contentType: 'application/json', body: '{"display_name":"Synthetic address"}' });
                        return route.fulfill({ body: url.includes('cdn.tailwindcss.com') ? 'window.tailwind = {};' : '' });
                    });
                    await page.goto('http://localhost:8123/');
                    try {
                        await page.waitForFunction(() => state.locationReady);
                    } catch (error) {
                        console.error(`${engine} ${profile.name} initialization failed`, await page.evaluate(() => ({
                            readyState: document.readyState, visibility: document.visibilityState,
                            secureContext: window.isSecureContext, message: state.locationMessage,
                            reading: state.locationReading, nativeReadings: window.nativeLocationReadings
                        })), { pageErrors: errors });
                        throw error;
                    }
                    assert.equal(await page.locator('#boxLatitude').textContent(), '10.000000° N');
                    assert.match(await page.locator('#boxAccuracy').textContent(), /15 m/);
                    assert.match(await page.locator('#boxLocationAge').textContent(), /seconds/);
                    assert.equal(await page.evaluate(() => locationIsUsable()), true);
                    console.log(`${engine} ${profile.name} raw/normalized`, await page.evaluate(() => ({
                        native: nativeLocationReadings.at(-1), rawTimestamp: state.locationReading.rawTimestamp,
                        receivedAt: state.locationReading.receivedAt, normalized: state.locationReading.timestamp,
                        encoding: state.locationReading.timestampEncoding
                    })));
                    await context.setGeolocation({ latitude: -30, longitude: -40, accuracy: 2000 });
                    await page.locator('#btnResyncGps').click();
                    await page.waitForFunction(() => state.locationReading?.accuracy === 2000);
                    assert.equal(await page.evaluate(() => locationIsUsable()), false);
                    assert.match(await page.locator('#locationStatus').textContent(), /approximate/);
                    await context.setGeolocation({ latitude: -30, longitude: -40, accuracy: 10 });
                    await page.locator('#btnResyncGps').click();
                    await page.locator('#btnResyncGps').click();
                    await page.waitForFunction(() => state.locationReady);
                    assert.equal(await page.locator('#boxLatitude').textContent(), '30.000000° S');
                    // Force interleaved callbacks to exercise engine-independent stale-response handling.
                    await page.evaluate(() => {
                        window.fixtureRequests = [];
                        navigator.geolocation.getCurrentPosition = (success, failure, options) => fixtureRequests.push({ success, failure, options });
                        fetchLocation(); fetchLocation();
                    });
                    assert.equal(await page.locator('#boxLatitude').textContent(), 'Unavailable');
                    await page.evaluate(() => fixtureRequests[1].success({ coords: { latitude: 1, longitude: 2, accuracy: 5 }, timestamp: Date.now() }));
                    await page.waitForFunction(() => state.locationReady);
                    await page.evaluate(() => {
                        fixtureRequests[0].failure({ code: 1 });
                        fixtureRequests[0].success({ coords: { latitude: 80, longitude: 90, accuracy: 5 }, timestamp: Date.now() });
                    });
                    assert.equal(await page.locator('#boxLatitude').textContent(), '1.000000° N');
                    for (const [code, text] of [[1, 'permission denied'], [2, 'unavailable'], [3, 'timed out']]) {
                        await page.evaluate(code => { fetchLocation(); fixtureRequests.at(-1).failure({ code }); }, code);
                        assert.match(await page.locator('#locationStatus').textContent(), new RegExp(text));
                        assert.equal(await page.evaluate(() => locationIsUsable()), false);
                        assert.equal(await page.locator('#boxLatitude').textContent(), 'Unavailable');
                    }
                    // Feed unmodified synthetic Safari provider timestamps into production.
                    // This verifies conversion in every engine; it is not native-device evidence.
                    for (const format of ['apple-ms', 'unix-us', 'unix-s']) {
                        await page.evaluate(format => {
                            const now = Date.now();
                            const raw = format === 'apple-ms' ? now - 978307200000 - 6000
                                : format === 'unix-us' ? (now - 6000) * 1000 : (now - 6000) / 1000;
                            Object.defineProperty(navigator, 'userAgent', { configurable: true,
                                value: 'AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15' });
                            fetchLocation();
                            fixtureRequests.at(-1).success({ coords: { latitude: 1, longitude: 2, accuracy: 35 }, timestamp: raw });
                        }, format);
                        await page.waitForFunction(() => state.locationReady);
                        assert.equal(await page.evaluate(() => locationIsUsable()), true);
                        assert.match(await page.locator('#boxLocationAge').textContent(), /^6 seconds$/);
                    }
                    for (const age of [61000, -120000]) {
                        await page.evaluate(age => {
                            fetchLocation();
                            fixtureRequests.at(-1).success({ coords: { latitude: 1, longitude: 2, accuracy: 35 },
                                timestamp: Date.now() - 978307200000 - age });
                        }, age);
                        assert.equal(await page.evaluate(() => locationIsUsable()), false);
                        assert.equal(await page.evaluate(() => state.locationReady), false);
                    }
                    lookupFails = true;
                    await page.evaluate(() => { fetchLocation(); fixtureRequests.at(-1).success({ coords: { latitude: 1, longitude: 2, accuracy: 5 }, timestamp: Date.now() }); });
                    await page.waitForFunction(() => state.locationMessage.includes('Reverse geocoding failed') && !state.locationMessage.includes('Retrying'));
                    assert.equal(await page.evaluate(() => locationIsUsable()), false);
                    assert.equal(await page.locator('#boxLockedAddress').textContent(), 'Address unavailable');
                    lookupFails = false;
                    // A future-dated position like Firefox's automation override must still
                    // fail closed in the application, regardless of the engine running it.
                    await page.evaluate(() => { fetchLocation(); fixtureRequests.at(-1).success({ coords: { latitude: 1, longitude: 2, accuracy: 5 }, timestamp: Date.now() + 86400000 }); });
                    assert.equal(await page.evaluate(() => state.locationReady), false);
                    assert.equal(await page.evaluate(() => locationIsUsable()), false);
                    assert.match(await page.locator('#locationStatus').textContent(), /invalid timestamp/);
                    await page.evaluate(() => { fetchLocation(); fixtureRequests.at(-1).success({ coords: { latitude: 1, longitude: 2, accuracy: 5 }, timestamp: Date.now() - 120000 }); });
                    assert.equal(await page.evaluate(() => locationIsUsable()), false);
                    assert.match(await page.locator('#locationStatus').textContent(), /stale/);
                    await page.evaluate(() => {
                        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
                        document.dispatchEvent(new Event('visibilitychange'));
                    });
                    assert.equal(await page.locator('#boxLatitude').textContent(), 'Unavailable');
                    assert.equal(await page.evaluate(() => locationIsUsable()), false);
                    assert.deepEqual(errors, []);
                    console.log(`PASS ${engine} ${profile.name}: native Geolocation API coordinates/permissions${engine === 'firefox' ? ' (fixture timestamp)' : ''}, accuracy/age, repeated Resync, stale callbacks/readings, future timestamp rejection, permission/timeout/unavailable errors, geocoding failures, background invalidation`);
                    passed++;
                } finally { await context.close(); }
            }
        } finally { await browser.close(); }
    }
    if (!passed) throw new Error('No browser profile executed');
    console.log(`${passed} browser profiles passed. Viewport emulation and fixtures do not validate real-device GPS or native permission dialogs.`);
})().catch(e => { console.error(e); process.exitCode = 1; });

