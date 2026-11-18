// src/physics/landingSites.js
//
// Where spacecraft have come down on the Moon (docs/frontend/landing-sites.md):
// every soft landing from Luna 9 to Blue Ghost, the rovers' last places,
// and the landers that crashed. Each site's planetocentric latitude and
// east longitude are in the mean-Earth/polar-axis (ME) frame, the frame
// of the LRO maps the Moon is drawn with, as the source prints them
// (longitudes printed from 0° to 360° east are given here less 360° when
// past 180°, at the printed precision):
//
//   - the LROC team's measurements from Narrow Angle Camera images, a few
//     metres to tens of metres (their table of 28 July 2016, described in
//     Wagner et al. 2017, and their posts on each landing since);
//   - NSSDCA's coordinates where LROC has not found the craft (Luna 2, 9
//     and 13, Surveyor 2 and 4): the Soviet and NASA estimates of the time,
//     kilometres out, marked as estimates.
//
// A site is placed on the Moon's reference sphere (1,737.4 km, as the Moon
// is drawn; the published elevation is shown on its plate, not drawn) and
// turned with the Moon's body frame, orientation.js's bodyAxesEqj('moon'):
// landingSites.test.mjs checks that against SPICE's MOON_ME.

import { bodyAxesEqj } from './orientation.js';

export const MOON_RADIUS_KM = 1737.4;
const DEG = Math.PI / 180;

// The sources, IEEE style; docs/frontend/landing-sites.md has the list.
export const SITE_SOURCES = {
  lroc2016: {
    tag: 'LROC',
    short: 'LROC team table, 28 July 2016 (Wagner et al. 2017)',
    cite: 'R. V. Wagner, D. M. Nelson, J. B. Plescia, M. S. Robinson, E. J. Speyerer and E. Mazarico, "Coordinates of anthropogenic features on the Moon," Icarus, vol. 283, pp. 92–103, 2017; LROC Science Operations Team, "LROC coordinates of lunar anthropogenic features," 28 July 2016',
    url: 'https://lroc.im-ldi.com/data/support/downloads/2016_LROC_Coordinates_of_Human_Features.pdf',
  },
  nssdcaUssr: {
    tag: 'NSSDCA',
    short: 'NSSDCA, Soviet missions to the Moon',
    cite: 'D. R. Williams, NASA NSSDCA, "Soviet missions to the Moon," 2005',
    url: 'https://nssdc.gsfc.nasa.gov/planetary/lunar/lunarussr.html',
  },
  nssdcaSurveyor2: {
    tag: 'NSSDCA', short: 'NSSDCA, Surveyor 2', cite: 'NASA NSSDCA, "Surveyor 2," NSSDCA/COSPAR ID 1966-084A',
    url: 'https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1966-084A',
  },
  nssdcaSurveyor4: {
    tag: 'NSSDCA', short: 'NSSDCA, Surveyor 4', cite: 'NASA NSSDCA, "Surveyor 4," NSSDCA/COSPAR ID 1967-068A',
    url: 'https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1967-068A',
  },
  lrocChange4: { tag: 'LROC', short: 'LROC, Chang\'e 4 lander coordinates, 2019', cite: 'M. Robinson, LROC, "Chang\'e 4 lander coordinates," 11 Jan. 2019', url: 'https://lroc.im-ldi.com/posts/1087' },
  lrocChange5: { tag: 'LROC', short: 'LROC, First look: Chang\'e 5, 2020', cite: 'M. Robinson, LROC, "First look: Chang\'e 5," 4 Dec. 2020', url: 'https://lroc.im-ldi.com/images/1172' },
  lrocChange6: { tag: 'LROC', short: 'LROC, First look: Chang\'e 6, 2024', cite: 'R. Wagner, LROC, "First look: Chang\'e 6," 14 Jun. 2024', url: 'https://lroc.im-ldi.com/images/1374' },
  lrocChandrayaan3: { tag: 'LROC', short: 'LROC, Chandrayaan-3 landing site, 2023', cite: 'M. Robinson, LROC, "Chandrayaan-3 landing site," 5 Sep. 2023', url: 'https://lroc.im-ldi.com/images/1314' },
  lrocSlim: { tag: 'LROC', short: 'LROC, JAXA SLIM landing, 2024', cite: 'M. Robinson, LROC, "JAXA SLIM landing," 26 Jan. 2024', url: 'https://lroc.im-ldi.com/images/1358' },
  lrocIm1: { tag: 'LROC', short: 'LROC, Intuitive Machines IM-1 on the Moon, 2024', cite: 'M. Robinson, LROC, "Intuitive Machines IM-1 on the Moon!," 26 Feb. 2024', url: 'https://lroc.im-ldi.com/images/1360' },
  lrocBlueGhost: { tag: 'LROC', short: 'LROC, Blue Ghost seen from above, 2025', cite: 'M. Robinson, LROC, "Blue Ghost lunar lander seen from above," 7 Mar. 2025', url: 'https://lroc.im-ldi.com/images/1407' },
  lrocIm2: { tag: 'LROC', short: 'LROC, IM-2 Athena seen obliquely, 2025', cite: 'M. Robinson, LROC, "IM-2 Athena seen obliquely," 10 Mar. 2025', url: 'https://lroc.im-ldi.com/images/1408' },
  lrocVikram: { tag: 'LROC', short: 'LROC, Vikram lander found, 2019', cite: 'M. Robinson, LROC, "Vikram lander found," 2 Dec. 2019', url: 'https://lroc.im-ldi.com/images/1131' },
  lrocBeresheet: { tag: 'LROC', short: 'LROC, Beresheet crash site spotted, 2019', cite: 'M. Robinson, LROC, "Beresheet crash site spotted!," 15 May 2019', url: 'https://lroc.im-ldi.com/images/1101' },
  lrocHakuto: { tag: 'LROC', short: 'LROC, HAKUTO-R Mission 1 impact site, 2023', cite: 'E. Speyerer, LROC, "Impact site of the HAKUTO-R Mission 1 lunar lander," 23 May 2023', url: 'https://lroc.im-ldi.com/images/1302' },
  lrocLuna25: { tag: 'LROC', short: 'LROC, Luna 25 impact crater, 2023', cite: 'M. Robinson, LROC, "Luna 25 impact crater," 29 Nov. 2023', url: 'https://lroc.im-ldi.com/images/1311' },
  lrocResilience: { tag: 'LROC', short: 'LROC, ispace Mission 2 impact site, 2025', cite: 'M. Robinson, LROC, "ispace Mission 2 SMBC x HAKUTO-R Venture Moon impact site," 20 Jun. 2025', url: 'https://lroc.im-ldi.com/images/1456' },
};

// The landing times' sources, where they are not the coordinates' own.
export const TIME_SOURCES = {
  nssdcaApollo: 'NASA NSSDCA, the Apollo lunar modules\' spacecraft pages (1969-059C … 1972-096C)',
  nssdcaUssr: SITE_SOURCES.nssdcaUssr.cite,
  nssdcaSurveyor: 'NASA NSSDCA, the Surveyor spacecraft pages (1966-045A … 1968-001A)',
  nasaBlueGhost: 'NASA, "NASA\'s Lunar Reconnaissance Orbiter views Blue Ghost on Moon\'s surface," 25 Mar. 2025',
  nssdcaIm2: 'NASA NSSDCA, "Intuitive Machines 2 (PRIME 1)," spacecraft page PRIME-1',
};

// kind: 'crewed' | 'lander' | 'rover' (a rover's last place) | 'crash' (a
// failed landing, where it hit) | 'estimate' (not found: the estimate of
// the time; impact: it struck rather than landed). landed: UTC, as precise as the source ('1959-09' for a month).
// uncM: the source's uncertainty in metres, where it gives one; elevM:
// height above the 1,737.4 km sphere.
/** @typedef {{ key: string; name: string; agency: string; kind: 'crewed' | 'lander' | 'rover' | 'crash' | 'estimate'; impact?: boolean; landed: string; timeSource?: keyof typeof TIME_SOURCES; crew?: string[]; rover?: string; place: string; lat: number; lon: number; elevM?: number; uncM?: number; source: keyof typeof SITE_SOURCES; note?: string }} LandingSite */

/** @type {LandingSite[]} */
export const LANDING_SITES = [
  // ---- Luna, Surveyor and Apollo, 1959-1976 ----
  { key: 'luna2', name: 'Luna 2', agency: 'USSR', kind: 'estimate', impact: true, landed: '1959-09', place: 'Palus Putredinis', lat: 29.10, lon: 0.00, source: 'nssdcaUssr',
    note: 'The first craft to reach the Moon, by impact. Its crater has not been found: this is the Soviet estimate of the time.' },
  { key: 'luna9', name: 'Luna 9', agency: 'USSR', kind: 'estimate', landed: '1966-02-03T18:44:52Z', timeSource: 'nssdcaUssr', place: 'Oceanus Procellarum', lat: 7.08, lon: -64.37, source: 'nssdcaUssr',
    note: 'The first soft landing. LROC has not found the lander: this is the Soviet estimate of the time.' },
  { key: 'surveyor1', name: 'Surveyor 1', agency: 'NASA', kind: 'lander', landed: '1966-06-02T06:17:36Z', timeSource: 'nssdcaSurveyor', place: 'Oceanus Procellarum', lat: -2.4745, lon: -43.3398, elevM: -1889, uncM: 5.6, source: 'lroc2016' },
  { key: 'surveyor2', name: 'Surveyor 2', agency: 'NASA', kind: 'estimate', impact: true, landed: '1966-09-22T09:35Z', timeSource: 'nssdcaSurveyor', place: 'southeast of Copernicus', lat: 5.5, lon: -12, source: 'nssdcaSurveyor2',
    note: 'A vernier engine failed to fire mid-course and it tumbled, and crashed. NSSDCA\'s rough estimate of where; it has not been found.' },
  { key: 'luna13', name: 'Luna 13', agency: 'USSR', kind: 'estimate', landed: '1966-12-24T18:01:00Z', timeSource: 'nssdcaUssr', place: 'Oceanus Procellarum', lat: 18.87, lon: -62.05, source: 'nssdcaUssr',
    note: 'Not yet found by LROC: the Soviet estimate of the time.' },
  { key: 'surveyor3', name: 'Surveyor 3', agency: 'NASA', kind: 'lander', landed: '1967-04-20T00:04:53Z', timeSource: 'nssdcaSurveyor', place: 'Oceanus Procellarum', lat: -3.0162, lon: -23.4180, elevM: -1433, uncM: 2.6, source: 'lroc2016',
    note: 'Apollo 12 landed within about 180 m of it.' },
  { key: 'surveyor4', name: 'Surveyor 4', agency: 'NASA', kind: 'estimate', impact: true, landed: '1967-07-17T02:02:40Z', timeSource: 'nssdcaSurveyor', place: 'Sinus Medii', lat: 0.47, lon: -1.44, source: 'nssdcaSurveyor4',
    note: 'Its signal stopped 2.5 minutes before touchdown, and it was never heard again. NSSDCA\'s estimate for a ballistic crash; it has not been found.' },
  { key: 'surveyor5', name: 'Surveyor 5', agency: 'NASA', kind: 'lander', landed: '1967-09-11T00:46:44Z', timeSource: 'nssdcaSurveyor', place: 'Mare Tranquillitatis', lat: 1.4551, lon: 23.1943, elevM: -2052, uncM: 11.9, source: 'lroc2016' },
  { key: 'surveyor6', name: 'Surveyor 6', agency: 'NASA', kind: 'lander', landed: '1967-11-10T01:01:06Z', timeSource: 'nssdcaSurveyor', place: 'Sinus Medii', lat: 0.4742, lon: -1.4275, elevM: -757, uncM: 6.7, source: 'lroc2016' },
  { key: 'surveyor7', name: 'Surveyor 7', agency: 'NASA', kind: 'lander', landed: '1968-01-10T01:05:36Z', timeSource: 'nssdcaSurveyor', place: 'north of Tycho', lat: -40.9812, lon: -11.5127, elevM: 81, uncM: 3.5, source: 'lroc2016',
    note: 'The only Surveyor in the highlands.' },
  { key: 'apollo11', name: 'Apollo 11', agency: 'NASA', kind: 'crewed', landed: '1969-07-20T20:17:40Z', timeSource: 'nssdcaApollo', crew: ['Neil A. Armstrong', 'Edwin E. Aldrin Jr.'], place: 'Mare Tranquillitatis', lat: 0.67416, lon: 23.47314, elevM: -1926, uncM: 0.3, source: 'lroc2016',
    note: 'The lunar module\'s descent stage, as for each Apollo landing.' },
  { key: 'apollo12', name: 'Apollo 12', agency: 'NASA', kind: 'crewed', landed: '1969-11-19T06:54:35Z', timeSource: 'nssdcaApollo', crew: ['Charles P. Conrad', 'Alan L. Bean'], place: 'Oceanus Procellarum', lat: -3.0128, lon: -23.4219, elevM: -1422, uncM: 2.2, source: 'lroc2016',
    note: 'It set down within about 180 m of Surveyor 3.' },
  { key: 'luna16', name: 'Luna 16', agency: 'USSR', kind: 'lander', landed: '1970-09-20T05:18:00Z', timeSource: 'nssdcaUssr', place: 'Mare Fecunditatis', lat: -0.5137, lon: 56.3638, elevM: -2452, uncM: 3.7, source: 'lroc2016' },
  { key: 'luna17', name: 'Luna 17', agency: 'USSR', kind: 'lander', landed: '1970-11-17T03:47:00Z', timeSource: 'nssdcaUssr', rover: 'Lunokhod 1', place: 'Mare Imbrium', lat: 38.23764, lon: -35.00163, elevM: -2471, uncM: 0.5, source: 'lroc2016' },
  { key: 'lunokhod1', name: 'Lunokhod 1', agency: 'USSR', kind: 'rover', landed: '1970-11-17T03:47:00Z', timeSource: 'nssdcaUssr', rover: 'Lunokhod 1', place: 'Mare Imbrium', lat: 38.3150, lon: -35.0081, elevM: -2471, uncM: 3.8, source: 'lroc2016',
    note: 'Where the first rover stopped, landed by Luna 17.' },
  { key: 'apollo14', name: 'Apollo 14', agency: 'NASA', kind: 'crewed', landed: '1971-02-05T09:18:11Z', timeSource: 'nssdcaApollo', crew: ['Alan B. Shepard Jr.', 'Edgar D. Mitchell'], place: 'Fra Mauro', lat: -3.64589, lon: -17.47194, elevM: -1062, uncM: 0.4, source: 'lroc2016' },
  { key: 'apollo15', name: 'Apollo 15', agency: 'NASA', kind: 'crewed', landed: '1971-07-30T22:16:29Z', timeSource: 'nssdcaApollo', crew: ['David R. Scott', 'James B. Irwin'], rover: 'Lunar Roving Vehicle', place: 'Hadley–Apennine', lat: 26.13239, lon: 3.63330, elevM: -1931, uncM: 1.0, source: 'lroc2016' },
  { key: 'luna20', name: 'Luna 20', agency: 'USSR', kind: 'lander', landed: '1972-02-21T19:19:00Z', timeSource: 'nssdcaUssr', place: 'Apollonius highlands', lat: 3.7863, lon: 56.6242, elevM: -1780, uncM: 4.3, source: 'lroc2016' },
  { key: 'apollo16', name: 'Apollo 16', agency: 'NASA', kind: 'crewed', landed: '1972-04-21T02:23:35Z', timeSource: 'nssdcaApollo', crew: ['John W. Young', 'Charles M. Duke Jr.'], rover: 'Lunar Roving Vehicle', place: 'Descartes highlands', lat: -8.9734, lon: 15.5011, elevM: 8, uncM: 3.0, source: 'lroc2016' },
  { key: 'apollo17', name: 'Apollo 17', agency: 'NASA', kind: 'crewed', landed: '1972-12-11T19:54:57Z', timeSource: 'nssdcaApollo', crew: ['Eugene A. Cernan', 'Harrison H. Schmitt'], rover: 'Lunar Roving Vehicle', place: 'Taurus–Littrow', lat: 20.1911, lon: 30.7723, elevM: -2626, uncM: 3.5, source: 'lroc2016',
    note: 'The last crew on the Moon to date.' },
  { key: 'luna21', name: 'Luna 21', agency: 'USSR', kind: 'lander', landed: '1973-01-15T23:35:00Z', timeSource: 'nssdcaUssr', rover: 'Lunokhod 2', place: 'Le Monnier', lat: 25.9994, lon: 30.4076, elevM: -2680, uncM: 13.4, source: 'lroc2016' },
  { key: 'lunokhod2', name: 'Lunokhod 2', agency: 'USSR', kind: 'rover', landed: '1973-01-15T23:35:00Z', timeSource: 'nssdcaUssr', rover: 'Lunokhod 2', place: 'Le Monnier', lat: 25.8323, lon: 30.9222, elevM: -2761, uncM: 7.5, source: 'lroc2016',
    note: 'Where the second Lunokhod stopped, landed by Luna 21.' },
  { key: 'luna24', name: 'Luna 24', agency: 'USSR', kind: 'lander', landed: '1976-08-18T02:00:00Z', timeSource: 'nssdcaUssr', place: 'Mare Crisium', lat: 12.7142, lon: 62.2129, elevM: -3670, uncM: 3.7, source: 'lroc2016',
    note: 'The last landing for 37 years.' },
  // ---- since 2013 ----
  { key: 'change3', name: 'Chang\'e 3', agency: 'CNSA', kind: 'lander', landed: '2013-12-14', rover: 'Yutu', place: 'Mare Imbrium', lat: 44.1214, lon: -19.5117, elevM: -2630, uncM: 9.1, source: 'lroc2016' },
  { key: 'yutu', name: 'Yutu', agency: 'CNSA', kind: 'rover', landed: '2013-12-14', rover: 'Yutu', place: 'Mare Imbrium', lat: 44.1208, lon: -19.5122, elevM: -2630, uncM: 12.9, source: 'lroc2016',
    note: 'Chang\'e 3\'s rover, about 20 m from the lander, where LROC measured it.' },
  { key: 'change4', name: 'Chang\'e 4', agency: 'CNSA', kind: 'lander', landed: '2019-01-03', place: 'Von Kármán, far side', lat: -45.457, lon: 177.589, uncM: 20, source: 'lrocChange4',
    note: 'On the far side, on the plains of Von Kármán crater.' },
  { key: 'beresheet', name: 'Beresheet', agency: 'SpaceIL', kind: 'crash', landed: '2019-04-11', place: 'Mare Serenitatis', lat: 32.5956, lon: 19.3496, uncM: 20, source: 'lrocBeresheet',
    note: 'Its main engine cut out late in the descent; it struck at under 10°. The darkest pixel of the smudge it left.' },
  { key: 'vikram2', name: 'Chandrayaan-2 Vikram', agency: 'ISRO', kind: 'crash', landed: '2019-09', place: 'south polar highlands', lat: -70.8810, lon: 22.7840, elevM: 834, source: 'lrocVikram',
    note: 'Lost in its final descent. Found by LROC after Shanmuga Subramanian spotted its debris.' },
  { key: 'change5', name: 'Chang\'e 5', agency: 'CNSA', kind: 'lander', landed: '2020-12-01T15:11Z', place: 'Oceanus Procellarum', lat: 43.0576, lon: -51.9161, elevM: -2570, uncM: 20, source: 'lrocChange5' },
  { key: 'hakutoR1', name: 'HAKUTO-R M1', agency: 'ispace', kind: 'crash', landed: '2023-04-25T16:40Z', place: 'Atlas crater', lat: 47.581, lon: 44.094, source: 'lrocHakuto',
    note: 'Contact was lost moments before touchdown. Where LROC found its debris.' },
  { key: 'luna25', name: 'Luna 25', agency: 'Roscosmos', kind: 'crash', landed: '2023-08-19T11:58Z', place: 'Pontecoulant G', lat: -57.865, lon: 61.360, elevM: -360, uncM: 40, source: 'lrocLuna25',
    note: 'It struck the steep inner rim of Pontecoulant G, about 400 km short of its target. Its 10 m crater.' },
  { key: 'chandrayaan3', name: 'Chandrayaan-3', agency: 'ISRO', kind: 'lander', landed: '2023-08-23', place: 'south polar highlands', lat: -69.3741, lon: 32.32, elevM: 532, source: 'lrocChandrayaan3',
    note: 'The lander Vikram, about 600 km from the south pole.' },
  { key: 'slim', name: 'SLIM', agency: 'JAXA', kind: 'lander', landed: '2024-01-19T15:20Z', place: 'near Shioli', lat: -13.3160, lon: 25.2510, elevM: -912, source: 'lrocSlim',
    note: 'Beside the fresh crater Shioli, 270 m across.' },
  { key: 'im1', name: 'IM-1 Odysseus', agency: 'Intuitive Machines', kind: 'lander', landed: '2024-02-22T23:23:53Z', place: 'Malapert A, south polar', lat: -80.13, lon: 1.44, elevM: 2579, source: 'lrocIm1',
    note: 'It came to rest in a degraded 1 km crater, on ground sloping 12°.' },
  { key: 'change6', name: 'Chang\'e 6', agency: 'CNSA', kind: 'lander', landed: '2024-06-01', place: 'Apollo basin, far side', lat: -41.6385, lon: -153.9852, elevM: -5256, uncM: 30, source: 'lrocChange6',
    note: 'On the southern edge of the Apollo basin.' },
  { key: 'blueGhost1', name: 'Blue Ghost M1', agency: 'Firefly', kind: 'lander', landed: '2025-03-02T08:34Z', timeSource: 'nasaBlueGhost', place: 'Mons Latreille, Mare Crisium', lat: 18.5623, lon: 61.8103, elevM: -3650, source: 'lrocBlueGhost',
    note: 'Beside Mons Latreille, a volcanic cone.' },
  { key: 'im2', name: 'IM-2 Athena', agency: 'Intuitive Machines', kind: 'lander', landed: '2025-03-06T17:30Z', timeSource: 'nssdcaIm2', place: 'Mons Mouton, south polar', lat: -84.7906, lon: 29.1957, source: 'lrocIm2',
    note: 'It hit faster than intended and came to rest on its side in a 20 m crater, yet sent back over 400 MB.' },
  { key: 'resilience', name: 'RESILIENCE', agency: 'ispace', kind: 'crash', landed: '2025-06-05T18:13Z', place: 'Mare Frigoris', lat: 60.4445, lon: -4.5880, elevM: -2432, source: 'lrocResilience',
    note: 'ispace\'s Mission 2: a hard landing. The dark smudge it left.' },
];

export const SITE_BY_KEY = Object.fromEntries(LANDING_SITES.map((s) => [s.key, s]));

// The site on the unit sphere, in the Moon's body frame (X to 0° longitude,
// Z to the north pole), as the maps are laid out (bodyMaterial.ts).
export function siteUnit(site) {
  const cl = Math.cos(site.lat * DEG);
  return [cl * Math.cos(site.lon * DEG), cl * Math.sin(site.lon * DEG), Math.sin(site.lat * DEG)];
}

// The site about the Moon's centre in J2000, km, on a sphere of radius R.
// `axes` may be passed in (bodyAxesEqj('moon', date)) to share them.
export function siteOffsetEqj(site, date, R = MOON_RADIUS_KM, axes = bodyAxesEqj('moon', date)) {
  const u = siteUnit(site);
  const [X, Y, Z] = axes;
  return [0, 1, 2].map((i) => R * (u[0] * X[i] + u[1] * Y[i] + u[2] * Z[i]));
}

// The Sun's elevation above the site's horizon, degrees, from the
// direction to the Sun in J2000 (any length) and the Moon's axes.
export function sunElevationDeg(site, sunDirEqj, axes) {
  const n = siteOffsetEqj(site, null, 1, axes);
  const s = Math.hypot(...sunDirEqj);
  return Math.asin((n[0] * sunDirEqj[0] + n[1] * sunDirEqj[1] + n[2] * sunDirEqj[2]) / s) / DEG;
}

// 'Mon 1969-07-20 20:17:40 UTC'-style text for a landing time at its precision.
export function landedText(landed) {
  if (/^\d{4}-\d{2}$/.test(landed)) {
    const [y, m] = landed.split('-').map(Number);
    return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`;
  }
  const d = new Date(landed.length === 10 ? `${landed}T00:00Z` : landed);
  const day = `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  if (landed.length === 10) return day;
  const p = (n) => String(n).padStart(2, '0');
  const secs = /T\d{2}:\d{2}:\d{2}/.test(landed);
  return `${day} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}${secs ? `:${p(d.getUTCSeconds())}` : ''} UTC`;
}
