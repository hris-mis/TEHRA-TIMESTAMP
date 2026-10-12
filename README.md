# MIS-HRIS-TIMESTAMP

Location readings use the browser's reported coordinates, accuracy and timestamp.
Browsers may estimate location from Wi-Fi/network information even with
permission and high accuracy enabled. The standard Geolocation API is used without
requiring the Permissions API (which is inconsistent across Safari/mobile browsers). The application cannot guarantee physical
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
npx playwright install chromium firefox webkit
node tests/chrome-desktop.cjs
REQUIRE_ALL_BROWSERS=1 node tests/cross-browser.cjs
```

Set `CHROME_PATH` to an installed Chrome/Chromium executable if desired.
The browser suite stubs remote assets and geocoding so it is deterministic and
does not send fixture positions to a real geocoder.

Deployment policy lives in `location-config.js`: `maxAccuracyMeters` defaults to
100 and `maxAgeMs` to 60000. Both accept positive finite numbers and can be made
stricter; higher limits are clamped to these secure defaults. Missing or malformed
configuration fails back to defaults. There is no employee-facing override, URL
parameter or local-storage override. This static app cannot attest location or
protect policy from a user modifying their own browser; server-side enforcement
is required for that and is outside this change.

The site must be served over HTTPS (localhost is allowed for tests). Embedded
pages need host permission for geolocation and camera; opening the site directly
avoids that restriction. Allow both browser site permission and OS location
access. iOS users should enable Location Services and Precise Location for the
browser; Android users should allow precise location for their browser. Desktop
users should check Windows/macOS location privacy settings and Wi-Fi availability.
A permission grant does not imply sufficient accuracy. Resync requests a reading
with `enableHighAccuracy: true`, `maximumAge: 0`, and a 15-second timeout, but the
browser/OS controls actual acquisition. No application can guarantee movement or
new coordinates on every call. Old metadata and insufficient accuracy are rejected.
Backgrounding/navigation invalidates the reading and cancels pending lookup work;
returning requires tapping Resync, which also permits user-initiated permission
requests. Safari inline muted camera video and the existing camera retry remain.

Cross-browser automation covers native geolocation with synthetic readings,
status/accuracy/age, approximate readings, repeated Resync, interleaved callbacks,
permission/unavailable/timeout errors, future/stale positions, reverse-geocoding errors,
and background invalidation. The existing Chromium camera suite covers required
employee fields, JPEG timestamp capture, gallery, preview/download link and deletion.
Firefox/WebKit location suites intentionally stub camera failure; they do not claim
camera integration coverage. No synthetic coordinates are sent to a real geocoder.

Firefox's Playwright 1.56.1 geolocation override was observed to return a synthetic
timestamp almost 24 hours ahead of the page clock. The application correctly rejects
future timestamps, so the suite supplies a fresh callback-time timestamp for Firefox's
synthetic readings while retaining native coordinates, permissions and request options.
Chromium/WebKit timestamps are unchanged. Explicit future and stale timestamp fixtures
test rejection in every engine; this adapter is test-only and does not change application
freshness rules. Initialization failures print native timestamp and application diagnostics.

CI installs Chromium, Firefox and WebKit and sets `REQUIRE_ALL_BROWSERS=1`, requiring
all six desktop/mobile viewport profiles to execute. Firefox native device timestamp
behavior and real-device GPS remain manual checks. If an engine is unavailable locally,
the suite reports it explicitly; use `REQUIRE_ALL_BROWSERS=1` to fail rather than skip.

Every browser/device combination below still requires real-device testing; engine
and viewport emulation do not validate native permissions, OS providers or GPS:

| Device/OS | Browsers requiring real-device verification | Related automated profile |
| --- | --- | --- |
| Android | Chrome, Samsung Internet, Edge, Firefox | Chromium Android viewport; Firefox touch viewport |
| iOS | Safari, Chrome, Firefox | WebKit iPhone viewport |
| Windows | Chrome, Edge, Firefox | Chromium and Firefox desktop |
| macOS | Safari, Chrome, Firefox | WebKit, Chromium and Firefox desktop |

On each combination verify allow/deny/revoke permission, approximate vs precise
location, GPS/Wi-Fi disabled, timeout, movement followed by repeated Resync,
background/foreground and navigation restore, offline/geocoding failure, and the
100-metre/60-second capture guards. Also verify front/rear camera, mirror, employee
validation, timestamp overlay and exported JPEG, gallery persistence, actual JPEG
download/save behavior (including iOS), preview and deletion. iOS browser branding
is not proof of the installed engine; test each listed app directly. Branded Edge
and Samsung Internet are not exercised by bundled Chromium automation.
