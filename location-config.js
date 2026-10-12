// Deployment-maintained policy. Positive finite numbers only.
// Limits above 100 m / 60000 ms are clamped to the secure defaults.
// Do not derive this configuration from URL parameters or employee input.
window.TEHRA_LOCATION_CONFIG = Object.freeze({
    maxAccuracyMeters: 100,
    maxAgeMs: 60000
});
