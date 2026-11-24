// src/chart/launchSites.ts
//
// The Earth's orbital launch sites in use, for the chart's PADS layer
// (docs/frontend/chart.md#the-earth): one representative pad each, its
// geodetic latitude and east longitude (WGS 84) and the stated error, all
// from Jonathan McDowell's General Catalog of Artificial Space Objects
// (GCAT), launch points table lp.html, updated 23 November 2026 and read
// 25 November 2026. GCAT is CC BY 4.0: credit J. McDowell, planet4589.org.
// `code` is GCAT's site and launch point code.

export interface LaunchSite { key: string; name: string; pad: string; country: string; lat: number; lon: number; errDeg: number; code: string }

export const LAUNCH_SITES: readonly LaunchSite[] = [
  { key: 'ksc39a', name: 'Kennedy', pad: 'LC-39A', country: 'USA', lat: 28.6083, lon: -80.6041, errDeg: 0.0001, code: 'KSC LC39A' },
  { key: 'cc40', name: 'Cape Canaveral', pad: 'SLC-40', country: 'USA', lat: 28.5620, lon: -80.5772, errDeg: 0.0001, code: 'CC SLC40' },
  { key: 'cc41', name: 'Cape Canaveral', pad: 'SLC-41', country: 'USA', lat: 28.5833, lon: -80.5831, errDeg: 0.0002, code: 'CC SLC41' },
  { key: 'vsfb4e', name: 'Vandenberg', pad: 'SLC-4E', country: 'USA', lat: 34.6320, lon: -120.6106, errDeg: 0.0001, code: 'VS SLC4E' },
  { key: 'wallops', name: 'Wallops', pad: 'LA-0A', country: 'USA', lat: 37.8338, lon: -75.4877, errDeg: 0.0001, code: 'MARS Pad 0A' },
  { key: 'starbase', name: 'Starbase', pad: 'Orbital Pad 1', country: 'USA', lat: 25.9961, lon: -97.1544, errDeg: 0.0002, code: 'STB OLP1' },
  { key: 'kodiak', name: 'Kodiak', pad: 'LP-1', country: 'USA', lat: 57.4353, lon: -152.3394, errDeg: 0.0002, code: 'KLC LP1' },
  { key: 'mahia', name: 'Mahia', pad: 'LC-1A', country: 'New Zealand', lat: -39.2616, lon: 177.8652, errDeg: 0.0001, code: 'MAHIA LC1A' },
  { key: 'kourou', name: 'Kourou', pad: 'ELA-4', country: 'French Guiana', lat: 5.2646, lon: -52.7922, errDeg: 0.001, code: 'CSG ELA4' },
  { key: 'baikonur1', name: 'Baikonur', pad: 'Site 1/5', country: 'Kazakhstan', lat: 45.9203, lon: 63.3423, errDeg: 0.0001, code: 'GIK-5 LC1' },
  { key: 'baikonur31', name: 'Baikonur', pad: 'Site 31', country: 'Kazakhstan', lat: 45.9960, lon: 63.5641, errDeg: 0.0001, code: 'GIK-5 LC31' },
  { key: 'plesetsk', name: 'Plesetsk', pad: 'Site 43/4', country: 'Russia', lat: 62.9300, lon: 40.4700, errDeg: 0.02, code: 'GIK-1 LC43/4' },
  { key: 'vostochny', name: 'Vostochny', pad: 'Site 1S', country: 'Russia', lat: 51.8840, lon: 128.3345, errDeg: 0.001, code: 'VOST PU1S' },
  { key: 'jiuquan', name: 'Jiuquan', pad: 'Pad 921', country: 'China', lat: 40.9580, lon: 100.2912, errDeg: 0.0002, code: 'JQ LC43/91' },
  { key: 'taiyuan', name: 'Taiyuan', pad: 'LC-9', country: 'China', lat: 38.8632, lon: 111.5895, errDeg: 0.0002, code: 'TYSC LC9' },
  { key: 'xichang', name: 'Xichang', pad: 'LC-2', country: 'China', lat: 28.2455, lon: 102.0271, errDeg: 0.0001, code: 'XSC LC2' },
  { key: 'wenchang', name: 'Wenchang', pad: 'LC-101', country: 'China', lat: 19.6143, lon: 110.9511, errDeg: 0.0001, code: 'WEN LC101' },
  { key: 'tanegashima', name: 'Tanegashima', pad: 'Yoshinobu', country: 'Japan', lat: 30.4008, lon: 130.9776, errDeg: 0.0001, code: 'TNSC Y' },
  { key: 'uchinoura', name: 'Uchinoura', pad: 'Epsilon pad', country: 'Japan', lat: 31.2474, lon: 131.0848, errDeg: 0.0001, code: 'KASC EP' },
  { key: 'sriharikota', name: 'Sriharikota', pad: 'First Launch Pad', country: 'India', lat: 13.7333, lon: 80.2348, errDeg: 0.0001, code: 'SHAR FLP' },
  { key: 'sriharikota2', name: 'Sriharikota', pad: 'Second Launch Pad', country: 'India', lat: 13.7200, lon: 80.2305, errDeg: 0.0001, code: 'SHAR SLP' },
  { key: 'naro', name: 'Naro', pad: 'LC-1', country: 'South Korea', lat: 34.4318, lon: 127.5363, errDeg: 0.0001, code: 'NARO LC1' },
  { key: 'semnan', name: 'Semnan', pad: 'Imam Khomeini', country: 'Iran', lat: 35.2369, lon: 53.9522, errDeg: 0.0002, code: 'SEM IKSC' },
  { key: 'sohae', name: 'Sohae', pad: 'LC-1', country: 'North Korea', lat: 39.6601, lon: 124.7053, errDeg: 0.0001, code: 'SOHAE LC1' },
  { key: 'palmachim', name: 'Palmachim', pad: 'Shavit pad', country: 'Israel', lat: 31.8847, lon: 34.6801, errDeg: 0.0001, code: 'PALB SH' },
];

export const LAUNCH_SITES_CREDIT = 'J. McDowell, General Catalog of Artificial Space Objects (GCAT), launch points, planet4589.org, CC BY 4.0';
