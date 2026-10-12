const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const script = html.match(/<script>\s*\/\/ APP STATE([\s\S]*?)<\/script>/)[1];

function app(fetchImpl = async () => ({ ok: false }), supported = true, fastTimeout = false) {
    const elements = new Map();
    const requests = [];
    const context = vm.createContext({
        document: { getElementById(id) {
            if (!elements.has(id)) elements.set(id, { textContent: '' });
            return elements.get(id);
        } },
        window: { addEventListener() {} },
        navigator: supported ? { geolocation: { getCurrentPosition(success, failure, options) {
            requests.push({ success, failure, options });
        } } } : {},
        fetch: fetchImpl, AbortController,
        setTimeout: fastTimeout ? (callback) => setTimeout(callback, 0) : setTimeout, clearTimeout,
        console: { warn() {} }
    });
    vm.runInContext(script, context);
    return {
        requests, elements,
        sync: () => vm.runInContext('fetchLocation()', context),
        state: () => vm.runInContext('({...state})', context),
        fix: (index, latitude, longitude) => requests[index].success({ coords: { latitude, longitude } }),
        stamp() {
            const text = [];
            context.testCanvas = { save() {}, restore() {}, fillText(value) { text.push(value); } };
            vm.runInContext('drawCanvasStamp(testCanvas, 1280, 960)', context);
            return text.join('\n');
        }
    };
}

function checkUI(a) {
    const s = a.state();
    assert.equal(a.elements.get('boxLockedAddress').textContent, s.lockedAddress);
    assert.equal(a.elements.get('overlayAddress').textContent, s.lockedAddress);
    assert.equal(a.elements.get('boxLatitude').textContent, s.latitude);
    assert.equal(a.elements.get('boxLongitude').textContent, s.longitude);
    assert.equal(a.elements.get('overlayLatLng').textContent, `LAT: ${s.latitude}, LON: ${s.longitude}`);
    assert(a.stamp().includes(s.lockedAddress.toUpperCase()));
    assert(a.stamp().includes(`LAT: ${s.latitude}, LON: ${s.longitude}`));
}

test('startup has no fabricated location', () => {
    const a = app();
    assert.equal(a.state().lockedAddress, 'WAITING FOR GPS');
    assert.equal(a.state().latitude, 'Unavailable');
    assert(!/PASIG|14\.574921|121\.058942/.test(html));
});

test('GPS address uses actual coordinates in the request, UI and exported stamp', async () => {
    let url;
    const a = app(async value => {
        url = value;
        return { ok: true, json: async () => ({ address: { road: 'Ayala Avenue', city: 'Makati', country: 'Philippines' } }) };
    });
    a.sync();
    assert.equal(a.requests[0].options.maximumAge, 0);
    await a.fix(0, 14.5547, 121.0244);
    assert(url.includes('lat=14.5547&lon=121.0244'));
    assert.equal(a.state().lockedAddress, 'AYALA AVENUE, MAKATI, PHILIPPINES');
    checkUI(a);
});

for (const [name, fetchImpl] of [
    ['HTTP error', async () => ({ ok: false })],
    ['network error', async () => { throw new Error('offline'); }],
    ['malformed JSON', async () => ({ ok: true, json: async () => { throw new SyntaxError(); } })],
    ['missing address', async () => ({ ok: true, json: async () => ({}) })],
    ['lookup timeout', (_url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('timeout')));
    })]
]) {
    test(`${name} keeps real coordinates instead of a fallback street`, async () => {
        const a = app(fetchImpl, true, name === 'lookup timeout');
        a.sync();
        await a.fix(0, -33.8688, -151.2093);
        assert.equal(a.state().lockedAddress, '33.868800° S, 151.209300° W');
        checkUI(a);
    });
}

test('display name resolves an address without structured fields', async () => {
    const a = app(async () => ({ ok: true, json: async () => ({ display_name: 'Cebu, Philippines' }) }));
    a.sync();
    await a.fix(0, 10.3157, 123.8854);
    assert.equal(a.state().lockedAddress, 'CEBU, PHILIPPINES');
});

for (const code of [1, 2, 3]) {
    test(`GPS error ${code} clears old location and explains failure`, async () => {
        const a = app();
        a.sync();
        await a.fix(0, 10, 20);
        a.sync();
        a.requests[1].failure({ code });
        assert.equal(a.state().latitude, 'Unavailable');
        assert.match(a.state().lockedAddress, /GPS (PERMISSION DENIED|UNAVAILABLE|TIMED OUT)/);
        checkUI(a);
    });
}

test('unsupported GPS explicitly shows unavailable', () => {
    const a = app(undefined, false);
    a.sync();
    assert.equal(a.state().lockedAddress, 'GPS NOT SUPPORTED');
    checkUI(a);
});

test('an old address response or GPS callback cannot overwrite a newer resync', async () => {
    let resolve;
    const a = app(() => new Promise(r => { resolve = r; }));
    a.sync();
    const oldLookup = a.fix(0, 10, 20);
    a.sync();
    resolve({ ok: true, json: async () => ({ display_name: 'Old address' }) });
    await oldLookup;
    assert.equal(a.state().lockedAddress, 'LOCATING…');
    a.requests[0].failure({ code: 1 });
    await a.fix(0, 30, 40);
    assert.equal(a.state().lockedAddress, 'LOCATING…');
});
