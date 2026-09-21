// Spherical, clear maritime atmosphere. Distances are kilometres; coefficients
// are inverse kilometres. RGB is a three-band approximation, not a spectral
// solver. Physical parameter sources and approximations: docs/atmosphere.md.
export const ATM = Object.freeze({
  radius: 6360, top: 6460, rayleighHeight: 8, mieHeight: 1.2,
  rayleigh: [0.005802, 0.013558, 0.033100],
  mieScattering: 0.003996, mieExtinction: 0.004440, mieG: 0.8,
  ozone: [0.000650, 0.001881, 0.000085], groundAlbedo: 0.1,
  // One scene illuminance unit = 5,000 lux. The same scale applies to
  // radiance (cd/m²) and to luminous intensity (cd) of the city's lamps.
  luxPerUnit: 5000, solarIlluminance: 25, lunarIlluminance: 0.000050,
  sunRadius: 0.004675, moonRadius: 0.00452,
});
export const luminance = c => c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
export const clamp01 = x => Math.max(0, Math.min(1, x));

export function atmosphereDensity(h) {
  return [Math.exp(-Math.max(0, h) / ATM.rayleighHeight),
    Math.exp(-Math.max(0, h) / ATM.mieHeight), Math.max(0, 1 - Math.abs(h - 25) / 15)];
}
export function extinctionAt(h) {
  const d = atmosphereDensity(h);
  return ATM.rayleigh.map((r, i) => r * d[0] + ATM.mieExtinction * d[1] + ATM.ozone[i] * d[2]);
}
export function rayleighPhase(mu) { return 3 * (1 + mu * mu) / (16 * Math.PI); }
export function miePhase(mu) {
  const g = ATM.mieG;
  return 3 * (1 - g * g) * (1 + mu * mu) /
    (8 * Math.PI * (2 + g * g) * Math.pow(1 + g * g - 2 * g * mu, 1.5));
}
export function boundaryDistance(height, mu) {
  const r = ATM.radius + Math.max(.000001, height), b = r * mu;
  const g = b * b - (r - ATM.radius) * (r + ATM.radius);
  if (mu < 0 && g >= 0) return { distance: -b - Math.sqrt(g), ground: true };
  return { distance: -b + Math.sqrt(b * b + (ATM.top - r) * (ATM.top + r)), ground: false };
}
export function transmittance(height, mu, count = 192) {
  const { distance, ground } = boundaryDistance(height, mu);
  if (ground) return [0, 0, 0];
  const r = ATM.radius + height, od = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    const t0 = distance * (i / count) ** 2, t1 = distance * ((i + 1) / count) ** 2;
    const t = (t0 + t1) / 2;
    const h = Math.sqrt(r * r + t * t + 2 * r * mu * t) - ATM.radius;
    const e = extinctionAt(h);
    for (let c = 0; c < 3; c++) od[c] += e[c] * (t1 - t0);
  }
  return od.map(v => Math.exp(-v));
}
export function discVisibility(height, mu, radius = ATM.sunRadius) {
  const r = ATM.radius + Math.max(0, height);
  const horizon = -Math.sqrt(Math.max(0, 1 - (ATM.radius / r) ** 2));
  const x = Math.max(-1, Math.min(1, (mu - horizon) / radius));
  return (Math.acos(-x) + x * Math.sqrt(Math.max(0, 1 - x * x))) / Math.PI;
}
export function directIrradiance(height, mu, source = 'sun') {
  const radius = source === 'sun' ? ATM.sunRadius : ATM.moonRadius;
  const visible = discVisibility(height, mu, radius);
  if (!visible) return [0, 0, 0];
  const r = ATM.radius + height;
  const horizon = -Math.sqrt(Math.max(0, 1 - (ATM.radius / r) ** 2));
  const T = transmittance(height, Math.max(mu, horizon + 1e-6));
  const e = source === 'sun' ? ATM.solarIlluminance : ATM.lunarIlluminance;
  // Lunar regolith is slightly redder than sunlight; perceptual cooling is a
  // response of the observer, and is deliberately absent from the light.
  const colour = source === 'sun' ? [1, 1, 1] : [1.06, 1, .91];
  return T.map((v, i) => v * e * colour[i] * visible);
}

export function solarPosition(time) {
  const rad = Math.PI / 180, phi = 42.6407 * rad, dec = 13.8 * rad;
  const H = (time - 12.87) * 15 * rad;
  const sinEl = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) + Math.PI;
  return { el: el / rad, az: ((az / rad) + 360) % 360,
    dir: [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)] };
}

// Partial dark adaptation: exposure changes, incident radiance never does.
// Meter in lux. A full-moon landscape stays much dimmer than a sunlit one.
export function exposureForIlluminance(illuminance) {
  return .60 * Math.pow(100000 / Math.max(.02, illuminance * ATM.luxPerUnit), .64);
}
