# MIS-HRIS-TIMESTAMP

Location readings use the browser's reported coordinates, accuracy and timestamp.
Desktop Chrome may estimate location from Wi-Fi/network information even with
permission and high accuracy enabled. The application cannot guarantee physical
position from an API success or a reverse-geocoded address.

Capture requires reported accuracy at most 100 metres, a reading no older than
60 seconds, and successful address lookup. Unknown accuracy, stale/invalid
readings, location errors and address failures block capture. These conservative
client-side limits do not constitute server-side location attestation. Existing
camera, mandatory employee fields, timestamp rendering and gallery behavior remain.

Tests (all coordinates and addresses supplied by tests are synthetic fixtures):

```sh
node tests/location.test.cjs
npm install --no-save --package-lock=false playwright@1.56.1
npx playwright install chromium
node tests/chrome-desktop.cjs
```

Set `CHROME_PATH` to an installed Chrome/Chromium executable if desired.
The browser suite stubs remote assets and geocoding so it is deterministic and
does not send fixture positions to a real geocoder.
