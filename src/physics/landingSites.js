// src/physics/landingSites.js
//
// Where spacecraft have come down on other worlds (docs/frontend/landing-sites.md):
// every soft landing on the Moon from Luna 9 to Blue Ghost, the rovers'
// last places, and the landers that crashed; and the landers, rovers,
// probes and impacts on Mars, Venus, Mercury, Titan, Jupiter and Saturn,
// and the touchdowns on Eros, Itokawa, Ryugu, Bennu and comet 67P.
//
// The Moon's: each site's planetocentric latitude and east longitude are
// in the mean-Earth/polar-axis (ME) frame, the frame of the LRO maps the
// Moon is drawn with, as the source prints them (longitudes printed from
// 0° to 360° east are given here less 360° when past 180°, at the printed
// precision):
//
//   - the LROC team's measurements from Narrow Angle Camera images, a few
//     metres to tens of metres (their table of 28 July 2016, described in
//     Wagner et al. 2017, and their posts on each landing since);
//   - NSSDCA's coordinates where LROC has not found the craft (Luna 2, 9
//     and 13, Surveyor 2 and 4): the Soviet and NASA estimates of the time,
//     kilometres out, marked as estimates.
//
// The other bodies': latitude and east longitude in the body's IAU frame
// (the one orientation.js turns it with), planetocentric where the source
// says so; a source's west longitude is given here as east (360° less it,
// less 360° again past 180°), and each site's `frame` says what the source
// printed. Mars's are the MOLA-era (IAU 2000) planetocentric ones.
//
// A site on a planet or moon is placed on the body's reference ellipsoid
// (pck.data.js's RADII, as the body is drawn; the published elevation is
// shown on its plate, not drawn) along its planetocentric direction, and
// turned with the body's frame, orientation.js's bodyAxesEqj:
// landingSites.test.mjs checks the Moon's against SPICE's MOON_ME. A site
// on a small body ('sb:<designation>', drawn as a sphere with no rotation
// model, smallBodies.ts) is given on its plate and flown to as the body.

import { bodyAxesEqj } from './orientation.js';
import { RADII } from './pck.data.js';

export const MOON_RADIUS_KM = 1737.4;
const DEG = Math.PI / 180;

// The sources, IEEE style; docs/frontend/landing-sites.md has the list.
/** @type {Record<string, { tag: string; short: string; cite: string; url: string }>} */
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
  // ---- the other bodies (NSSDCA's pages are cited as archived: its live catalogue was down in Nov. 2026) ----
  nssdcaVenera3: { tag: 'NSSDCA', short: 'NSSDCA, Venera 3', cite: 'NASA NSSDCA, "Venera 3," NSSDCA/COSPAR ID 1965-092A, archived 14 Aug. 2025', url: 'https://web.archive.org/web/20250814193536/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1965-092A' },
  nssdcaVenera7: { tag: 'NSSDCA', short: 'NSSDCA, Venera 7', cite: 'NASA NSSDCA, "Venera 7," NSSDCA/COSPAR ID 1970-060A, archived 18 Sep. 2026', url: 'https://web.archive.org/web/20260918070753/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1970-060A' },
  nssdcaVenera8: { tag: 'NSSDCA', short: 'NSSDCA, Venera 8', cite: 'NASA NSSDCA, "Venera 8," NSSDCA/COSPAR ID 1972-021A, archived 21 Jul. 2025', url: 'https://web.archive.org/web/20250721180956/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1972-021A' },
  nssdcaVenera9: { tag: 'NSSDCA', short: 'NSSDCA, Venera 9 Descent Craft', cite: 'NASA NSSDCA, "Venera 9 Descent Craft," NSSDCA/COSPAR ID 1975-050D, archived 26 Jul. 2025', url: 'https://web.archive.org/web/20250726211237/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1975-050D' },
  nssdcaVenera10: { tag: 'NSSDCA', short: 'NSSDCA, Venera 10 Descent Craft', cite: 'NASA NSSDCA, "Venera 10 Descent Craft," NSSDCA/COSPAR ID 1975-054D, archived 26 Jul. 2025', url: 'https://web.archive.org/web/20250726211244/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1975-054D' },
  nssdcaVenera11: { tag: 'NSSDCA', short: 'NSSDCA, Venera 11 Descent Craft', cite: 'NASA NSSDCA, "Venera 11 Descent Craft," NSSDCA/COSPAR ID 1978-084D, archived 14 Aug. 2025', url: 'https://web.archive.org/web/20250814171910/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1978-084D' },
  nssdcaPvLarge: { tag: 'NSSDCA', short: 'NSSDCA, Pioneer Venus Large Probe', cite: 'NASA NSSDCA, "Pioneer Venus Large Probe," NSSDCA/COSPAR ID 1978-078D, archived 27 Oct. 2026', url: 'https://web.archive.org/web/20261027042758/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1978-078D' },
  nssdcaPvNorth: { tag: 'NSSDCA', short: 'NSSDCA, Pioneer Venus Small Probe (North)', cite: 'NASA NSSDCA, "Pioneer Venus Small Probe (North)," NSSDCA/COSPAR ID 1978-078E, archived 18 Sep. 2026', url: 'https://web.archive.org/web/20260918070803/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1978-078E' },
  nssdcaPvNight: { tag: 'NSSDCA', short: 'NSSDCA, Pioneer Venus Small Probe (Night)', cite: 'NASA NSSDCA, "Pioneer Venus Small Probe (Night)," NSSDCA/COSPAR ID 1978-078F, archived 30 Jun. 2025', url: 'https://web.archive.org/web/20250630224158/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1978-078F' },
  nssdcaPvDay: { tag: 'NSSDCA', short: 'NSSDCA, Pioneer Venus Small Probe (Day)', cite: 'NASA NSSDCA, "Pioneer Venus Small Probe (Day)," NSSDCA/COSPAR ID 1978-078G, archived 22 Oct. 2026', url: 'https://web.archive.org/web/20261022211645/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1978-078G' },
  nssdcaVenera13: { tag: 'NSSDCA', short: 'NSSDCA, Venera 13 Descent Craft', cite: 'NASA NSSDCA, "Venera 13 Descent Craft," NSSDCA/COSPAR ID 1981-106D, archived 31 Jul. 2025', url: 'https://web.archive.org/web/20250731205701/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1981-106D' },
  nssdcaVenera14: { tag: 'NSSDCA', short: 'NSSDCA, Venera 14 Descent Craft', cite: 'NASA NSSDCA, "Venera 14 Descent Craft," NSSDCA/COSPAR ID 1981-110D, archived 9 Aug. 2025', url: 'https://web.archive.org/web/20250809183337/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1981-110D' },
  nssdcaVega1: { tag: 'NSSDCA', short: 'NSSDCA, Vega 1 Descent Craft', cite: 'NASA NSSDCA, "Vega 1 Descent Craft," NSSDCA/COSPAR ID 1984-125E, archived 13 Aug. 2025', url: 'https://web.archive.org/web/20250813121806/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1984-125E' },
  nssdcaVega2: { tag: 'NSSDCA', short: 'NSSDCA, Vega 2 Descent Craft', cite: 'NASA NSSDCA, "Vega 2 Descent Craft," NSSDCA/COSPAR ID 1984-128E, archived 16 Jun. 2025', url: 'https://web.archive.org/web/20250616095949/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1984-128E' },
  nssdcaMars3: { tag: 'NSSDCA', short: 'NSSDCA, Mars 3 Lander', cite: 'NASA NSSDCA, "Mars 3 Lander," NSSDCA/COSPAR ID 1971-049F, archived 18 Dec. 2024', url: 'https://web.archive.org/web/20241218101503/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1971-049F' },
  nssdcaViking1: { tag: 'NSSDCA', short: 'NSSDCA, Viking 1 Lander', cite: 'NASA NSSDCA, "Viking 1 Lander," NSSDCA/COSPAR ID 1975-075C, archived 15 Nov. 2026', url: 'https://web.archive.org/web/20261115212256/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1975-075C' },
  nssdcaViking2: { tag: 'NSSDCA', short: 'NSSDCA, Viking 2 Lander', cite: 'NASA NSSDCA, "Viking 2 Lander," NSSDCA/COSPAR ID 1975-083C, archived 7 Nov. 2026', url: 'https://web.archive.org/web/20261107113207/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1975-083C' },
  nssdcaPathfinder: { tag: 'NSSDCA', short: 'NSSDCA, Mars Pathfinder', cite: 'NASA NSSDCA, "Mars Pathfinder," NSSDCA/COSPAR ID 1996-068A, archived 6 Aug. 2025', url: 'https://web.archive.org/web/20250806100727/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1996-068A' },
  nssdcaSpirit: { tag: 'NSSDCA', short: 'NSSDCA, Spirit', cite: 'NASA NSSDCA, "Spirit," NSSDCA/COSPAR ID 2003-027A, archived 15 Nov. 2026', url: 'https://web.archive.org/web/20261115212303/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=2003-027A' },
  nssdcaTianwen1: { tag: 'NSSDCA', short: 'NSSDCA, Tianwen 1', cite: 'NASA NSSDCA, "Tianwen 1," NSSDCA/COSPAR ID 2020-049A, archived 20 Aug. 2025', url: 'https://web.archive.org/web/20250820142240/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=2020-049A' },
  nssdcaCassini: { tag: 'NSSDCA', short: 'NSSDCA, Cassini Saturn Orbiter', cite: 'NASA NSSDCA, "Cassini Saturn Orbiter," NSSDCA/COSPAR ID 1997-061A, archived 14 Aug. 2025', url: 'https://web.archive.org/web/20250814193535/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1997-061A' },
  nssdcaGalileoProbe: { tag: 'NSSDCA', short: 'NSSDCA, Galileo Probe', cite: 'NASA NSSDCA, "Galileo Probe," NSSDCA/COSPAR ID 1989-084E, archived 18 Sep. 2026', url: 'https://web.archive.org/web/20260918070756/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1989-084E' },
  nssdcaOpportunity: { tag: 'NSSDCA', short: 'NSSDCA, Opportunity', cite: 'NASA NSSDCA, "Opportunity," NSSDCA/COSPAR ID 2003-032A, archived 2024', url: 'https://web.archive.org/web/2024/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=2003-032A' },
  nssdcaPhoenix: { tag: 'NSSDCA', short: 'NSSDCA, Phoenix', cite: 'NASA NSSDCA, "Phoenix," NSSDCA/COSPAR ID 2007-034A, archived 2025', url: 'https://web.archive.org/web/2025/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=2007-034A' },
  nssdcaInsight: { tag: 'NSSDCA', short: 'NSSDCA, InSight', cite: 'NASA NSSDCA, "InSight," NSSDCA/COSPAR ID 2018-042A, archived 2025', url: 'https://web.archive.org/web/2025/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=2018-042A' },
  naifNearLanded: { tag: 'NAIF', short: 'NAIF, landed NEAR location SPK, 2001', cite: 'B. Semenov, NAIF/JPL, "Landed NEAR spacecraft location SPK file (near_eroslanded_nav_v1.bsp)," comments, 18 Jul. 2001 (the estimate of P. G. Antreasian, NEAR navigation team, JPL); read from a mirror of NAIF\'s NEAR kernels', url: 'https://ftp1.gwdg.de/pub/misc/isis/isis3data/data/near/kernels/spk/near_eroslanded_nav_v1.bsp.log' },
  schroderMascot: { tag: 'arXiv', short: 'Schröder et al. 2022, MASCOT landing area', cite: 'S. E. Schröder et al., "Characterization of the MASCOT landing area by Hayabusa2," Astron. Astrophys., 2022, doi: 10.1051/0004-6361/202244059; arXiv:2209.00856', url: 'https://arxiv.org/abs/2209.00856' },
  barnouinHokioi: { tag: 'PSJ', short: 'Barnouin et al. 2022, OSIRIS-REx sample site', cite: 'O. S. Barnouin et al., "Geologic context of the OSIRIS-REx sample site from high-resolution topography and imaging," Planet. Sci. J., vol. 3, no. 4, art. 75, 2022, doi: 10.3847/PSJ/ac5597', url: 'https://doi.org/10.3847/PSJ/ac5597' },
  nssdcaNear: { tag: 'NSSDCA', short: 'NSSDCA, NEAR Shoemaker', cite: 'NASA NSSDCA, "NEAR Shoemaker," NSSDCA/COSPAR ID 1996-008A, archived 5 Apr. 2025', url: 'https://web.archive.org/web/20250405161217/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1996-008A' },
  nssdcaHayabusa2: { tag: 'NSSDCA', short: 'NSSDCA, Hayabusa2', cite: 'NASA NSSDCA, "Hayabusa2," NSSDCA/COSPAR ID 2014-076A, archived 9 Aug. 2025', url: 'https://web.archive.org/web/20250809000235/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=2014-076A' },
  nssdcaOsirisRex: { tag: 'NSSDCA', short: 'NSSDCA, OSIRIS-REx', cite: 'NASA NSSDCA, "OSIRIS-REx," NSSDCA/COSPAR ID 2016-055A, archived 31 Oct. 2026', url: 'https://web.archive.org/web/20261031050633/https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=2016-055A' },
  odeMars: { tag: 'PDS', short: 'PDS Geosciences Node, ODE landing sites', cite: 'PDS Geosciences Node, Mars Orbital Data Explorer, "ODE supported existing and proposed landing sites" (from W. M. Folkner et al., Science 278, 1997, for the Vikings and Pathfinder; R. E. Arvidson et al., Science 305 and 306, 2004, for Spirit and Opportunity; P. H. Smith et al., Science 325, 2009, for Phoenix; K. D. Seelos et al., Geophys. Res. Lett. 41, 2014, for Curiosity), Washington Univ. in St. Louis, read Nov. 2026', url: 'https://ode.rsl.wustl.edu/mars/pagehelp/Content/Missions_Instruments/Landing_Sites.htm' },
  mars24: { tag: 'NASA', short: 'NASA GISS, Mars24: Mars lander missions, 2023', cite: 'R. B. Schmunk, NASA Goddard Institute for Space Studies, "Mars24 Sunclock: Mars lander missions," updated 9 Dec. 2023 (from Bridges et al. 2017 for Beagle 2, Liu et al. 2022 for Zhurong, and JPL/NAIF for InSight and Perseverance)', url: 'https://www.giss.nasa.gov/tools/mars24/help/landers.html' },
  bridgesBeagle2: { tag: 'HiRISE', short: 'Bridges et al. 2017, Beagle 2 identified', cite: 'J. C. Bridges et al., "Identification of the Beagle 2 lander on Mars," R. Soc. Open Sci., vol. 4, no. 10, art. 170785, 2017, doi: 10.1098/rsos.170785', url: 'https://doi.org/10.1098/rsos.170785' },
  messengerImpact: { tag: 'NASA', short: 'NASA/JHUAPL, Best determination of MESSENGER\'s impact location, 2015', cite: 'NASA/JHU APL/Carnegie Institution of Washington, "Best determination of MESSENGER\'s impact location," NASA Photojournal, 2015', url: 'https://science.nasa.gov/photojournal/best-determination-of-messengers-impact-location/' },
  huygensDtwg: { tag: 'ESA', short: 'Atkinson et al. 2015, Huygens trajectory reconstruction', cite: 'D. H. Atkinson, B. Kazeminejad and J.-P. Lebreton, "The Huygens Descent Trajectory Working Group and the reconstruction of the Huygens probe entry and descent trajectory at Titan," Geophys. Res. Abstr., vol. 17, EGU2015-162-2, 2015', url: 'https://meetingorganizer.copernicus.org/EGU2015/EGU2015-162-2.pdf' },
  galileoCat: { tag: 'PDS', short: 'PDS, Galileo mission catalogue', cite: 'NASA PDS, "Galileo mission description" (MISSION.CAT, GO-J-NIMS-4-MOSAIC-V1.0, volume GO_1104)', url: 'https://pds.nasa.gov/data/go-j-nims-4-mosaic-v1.0/go_1104/catalog/mission.cat' },
};

// The landing times' sources, where they are not the coordinates' own
// (a SITE_SOURCES key may serve too).
/** @type {Record<string, string>} */
export const TIME_SOURCES = {
  nssdcaApollo: 'NASA NSSDCA, the Apollo lunar modules\' spacecraft pages (1969-059C … 1972-096C)',
  nssdcaUssr: SITE_SOURCES.nssdcaUssr.cite,
  nssdcaSurveyor: 'NASA NSSDCA, the Surveyor spacecraft pages (1966-045A … 1968-001A)',
  nasaBlueGhost: 'NASA, "NASA\'s Lunar Reconnaissance Orbiter views Blue Ghost on Moon\'s surface," 25 Mar. 2025',
  nssdcaIm2: 'NASA NSSDCA, "Intuitive Machines 2 (PRIME 1)," spacecraft page PRIME-1',
};

// body: 'moon' (when left out), a planet or moon's key, or 'sb:<pdes>' for
// a small body. kind: 'crewed' | 'lander' | 'rover' (a rover's last place)
// | 'crash' (a failed landing, where it hit) | 'estimate' (not found: the
// estimate of the time; impact: it struck rather than landed) | 'impact'
// (a planned end, struck on purpose) | 'entry' (a probe into a giant
// planet's atmosphere, where it went in) | 'touch' (a touch-and-go or a
// brief touchdown). landed: UTC, as precise as the source ('1959-09' for
// a month). uncM: the source's uncertainty in metres, where it gives one;
// elevM: height above the reference sphere or ellipsoid. timeSource: a
// TIME_SOURCES or SITE_SOURCES key, where the time is not the
// coordinates' source's. frame: what the source printed, where the
// conversion is worth saying.
/** @typedef {{ key: string; name: string; agency: string; body?: string; kind: 'crewed' | 'lander' | 'rover' | 'crash' | 'estimate' | 'impact' | 'entry' | 'touch'; impact?: boolean; landed: string; timeSource?: string; crew?: string[]; rover?: string; place: string; lat: number; lon: number; elevM?: number; uncM?: number; uncKm?: number; source: string; frame?: string; note?: string }} LandingSite */

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
  // ---- Mars: planetocentric, east, in the IAU 2000 / MOLA frame ----
  { key: 'mars2', body: 'mars', name: 'Mars 2', agency: 'USSR', kind: 'estimate', impact: true, landed: '1971-11-27', place: 'Hellas Planitia', lat: -45, lon: 47, source: 'mars24',
    note: 'The first craft to reach Mars\'s surface: it crashed in its descent, probably in a global dust storm. An estimate; it has not been found (NSSDCA prints 4° N, 47° W).' },
  { key: 'mars3', body: 'mars', name: 'Mars 3', agency: 'USSR', kind: 'estimate', landed: '1971-12-02T13:50:35Z', place: 'Ptolemaeus, Terra Sirenum', lat: -45, lon: -158, source: 'nssdcaMars3', frame: '158° W as printed',
    note: 'The first soft landing on Mars. It began sending a picture and fell silent after about 20 seconds. The Soviet estimate; NSSDCA puts a 3-minute uncertainty on the times.' },
  { key: 'mars6', body: 'mars', name: 'Mars 6', agency: 'USSR', kind: 'estimate', impact: true, landed: '1974-03-12', place: 'near Samara Valles', lat: -23.90, lon: -19.42, source: 'mars24',
    note: 'It sent a few minutes of unreadable descent data, and was lost near the surface. An estimate; it has not been found.' },
  { key: 'viking1', body: 'mars', name: 'Viking 1', agency: 'NASA', kind: 'lander', landed: '1976-07-20T11:53:06Z', timeSource: 'nssdcaViking1', place: 'Chryse Planitia', lat: 22.269, lon: -47.951, source: 'odeMars', frame: 'planetocentric, 312.049° E as printed',
    note: 'The first fully successful landing on Mars, from Viking 1\'s radio tracking. It worked until November 1982.' },
  { key: 'viking2', body: 'mars', name: 'Viking 2', agency: 'NASA', kind: 'lander', landed: '1976-09-03T22:58:20Z', timeSource: 'nssdcaViking2', place: 'Utopia Planitia', lat: 47.668, lon: 134.280, source: 'odeMars', frame: 'planetocentric',
    note: 'About 200 km west of the crater Mie.' },
  { key: 'pathfinder', body: 'mars', name: 'Mars Pathfinder', agency: 'NASA', kind: 'lander', landed: '1997-07-04T16:56:55Z', timeSource: 'nssdcaPathfinder', rover: 'Sojourner', place: 'Ares Vallis', lat: 19.095, lon: -33.253, source: 'odeMars', frame: 'planetocentric, 326.747° E as printed',
    note: 'The Carl Sagan Memorial Station. It bounced to a stop on airbags; its rover Sojourner drove about 100 m.' },
  { key: 'mpl', body: 'mars', name: 'Mars Polar Lander', agency: 'NASA', kind: 'estimate', impact: true, landed: '1999-12-03', place: 'Planum Australe', lat: -76.1, lon: 164.7, source: 'mars24', frame: '195.3° W as printed',
    note: 'Lost in its descent, most likely when its engines shut down early. Where it was aimed; it has not been found.' },
  { key: 'beagle2', body: 'mars', name: 'Beagle 2', agency: 'ESA · UK', kind: 'lander', landed: '2003-12-25', place: 'Isidis Planitia', lat: 11.52879, lon: 90.43139, source: 'bridgesBeagle2',
    note: 'Never heard from. Found in HiRISE images in 2015, about 5 km from its target, its panels not fully opened.' },
  { key: 'spirit', body: 'mars', name: 'Spirit', agency: 'NASA', kind: 'lander', landed: '2004-01-04T04:35Z', timeSource: 'nssdcaSpirit', rover: 'Spirit', place: 'Gusev crater', lat: -14.5692, lon: 175.4729, source: 'odeMars', frame: 'planetocentric, by triangulation from the ground',
    note: 'The landing site, the Columbia Memorial Station (the time is as received on Earth). Spirit drove 7.7 km and was stuck in soft ground at Troy in 2009.' },
  { key: 'opportunity', body: 'mars', name: 'Opportunity', agency: 'NASA', kind: 'lander', landed: '2004-01-25T04:54:22Z', timeSource: 'nssdcaOpportunity', rover: 'Opportunity', place: 'Meridiani Planum', lat: -1.9462, lon: -5.5266, source: 'odeMars', frame: 'planetocentric, 354.4734° E as printed',
    note: 'The landing site, the Challenger Memorial Station (the time is the spacecraft\'s). Opportunity drove about 45 km in 14 years, to Perseverance Valley.' },
  { key: 'phoenix', body: 'mars', name: 'Phoenix', agency: 'NASA', kind: 'lander', landed: '2008-05-25T23:53:44Z', timeSource: 'nssdcaPhoenix', place: 'Vastitas Borealis', lat: 68.22, lon: -125.75, source: 'odeMars', frame: 'planetocentric, 234.25° E as printed',
    note: 'It dug down to water ice a few centimetres under the soil.' },
  { key: 'curiosity', body: 'mars', name: 'Curiosity', agency: 'NASA', kind: 'lander', landed: '2012-08-06', rover: 'Curiosity', place: 'Bradbury Landing, Gale crater', lat: -4.59, lon: 137.44, source: 'odeMars', frame: 'planetocentric',
    note: 'Where it landed; the rover has driven over 31 km since, up Mount Sharp.' },
  { key: 'schiaparelli', body: 'mars', name: 'Schiaparelli', agency: 'ESA', kind: 'crash', landed: '2016-10-19', place: 'Meridiani Planum', lat: -2.07, lon: -6.21, source: 'mars24', frame: '353.79° E as printed',
    note: 'ExoMars\'s landing demonstrator. Its parachute let go and its rockets stopped too early; it struck about 5.5 km west of its target.' },
  { key: 'insight', body: 'mars', name: 'InSight', agency: 'NASA', kind: 'lander', landed: '2018-11-26T19:52:59Z', timeSource: 'nssdcaInsight', place: 'Elysium Planitia', lat: 4.50, lon: 135.62, source: 'mars24',
    note: 'A seismometer and heat probe, at work until December 2022, when dust on its panels had cut its power by almost 95 %.' },
  { key: 'perseverance', body: 'mars', name: 'Perseverance', agency: 'NASA', kind: 'lander', landed: '2021-02-18', rover: 'Perseverance', place: 'Octavia E. Butler Landing, Jezero crater', lat: 18.44, lon: 77.45, source: 'mars24',
    note: 'Where it landed, with the Ingenuity helicopter. The rover is caching samples for return.' },
  { key: 'zhurong', body: 'mars', name: 'Tianwen-1', agency: 'CNSA', kind: 'lander', landed: '2021-05-14T23:18Z', timeSource: 'nssdcaTianwen1', rover: 'Zhurong', place: 'Utopia Planitia', lat: 25.07, lon: 109.93, source: 'mars24',
    note: 'The lander, from which the rover Zhurong drove about 1.9 km before it fell silent in 2022.' },
  // ---- Venus: latitude and east longitude as NSSDCA prints them ----
  { key: 'venera3', body: 'venus', name: 'Venera 3', agency: 'USSR', kind: 'estimate', impact: true, landed: '1966-03-01T06:56Z', timeSource: 'nssdcaVenera3', place: 'between 20° N and 30° S', lat: -5, lon: 70, source: 'nssdcaVenera3',
    note: 'The first craft to reach another planet\'s surface, its radio already dead. The middle of NSSDCA\'s box for it: 20° N to 30° S, 60° to 80° E.' },
  { key: 'venera7', body: 'venus', name: 'Venera 7', agency: 'USSR', kind: 'lander', landed: '1970-12-15T05:34:10Z', place: 'night side', lat: -5, lon: -9, source: 'nssdcaVenera7', frame: '351° E as printed',
    note: 'The first craft to send data from another planet\'s surface: 23 minutes of a weak signal, after its parachute failed.' },
  { key: 'venera8', body: 'venus', name: 'Venera 8', agency: 'USSR', kind: 'lander', landed: '1972-07-22T09:32Z', place: 'near the morning terminator', lat: -10.70, lon: -24.75, source: 'nssdcaVenera8', frame: '335.25° E as printed',
    note: 'It sent 63 minutes of data from the surface, the first from the day side.' },
  { key: 'venera9', body: 'venus', name: 'Venera 9', agency: 'USSR', kind: 'lander', landed: '1975-10-22T05:13Z', place: 'Beta Regio', lat: 31.7, lon: -69, source: 'nssdcaVenera9', frame: '291° E as printed',
    note: 'It sent the first picture from the surface of another planet.' },
  { key: 'venera10', body: 'venus', name: 'Venera 10', agency: 'USSR', kind: 'lander', landed: '1975-10-25T02:17Z', place: 'Beta Regio', lat: 16, lon: -69, source: 'nssdcaVenera10', frame: '291° E as printed' },
  { key: 'pvLarge', body: 'venus', name: 'PV Large Probe', agency: 'NASA', kind: 'impact', landed: '1978-12-09T19:39:55Z', place: 'just north of the equator', lat: 4.4, lon: -56, source: 'nssdcaPvLarge', frame: '304° E as printed',
    note: 'Pioneer Venus\'s large probe, parachuted to 45 km and then falling free. Not built to survive the landing; its signal ended when it struck (spacecraft time).' },
  { key: 'pvNorth', body: 'venus', name: 'PV North Probe', agency: 'NASA', kind: 'impact', landed: '1978-12-09T19:42:40Z', place: 'high northern night side', lat: 59.3, lon: 4.8, source: 'nssdcaPvNorth' },
  { key: 'pvDay', body: 'venus', name: 'PV Day Probe', agency: 'NASA', kind: 'impact', landed: '1978-12-09T19:47:59Z', place: 'southern day side', lat: -31.3, lon: -43, source: 'nssdcaPvDay', frame: '317° E as printed',
    note: 'It survived the impact and sent data from the surface for over an hour.' },
  { key: 'pvNight', body: 'venus', name: 'PV Night Probe', agency: 'NASA', kind: 'impact', landed: '1978-12-09T19:52:05Z', place: 'southern night side', lat: -28.7, lon: 56.7, source: 'nssdcaPvNight' },
  { key: 'venera11', body: 'venus', name: 'Venera 11', agency: 'USSR', kind: 'lander', landed: '1978-12-25T03:24Z', place: 'southern low latitudes', lat: -14, lon: -61, source: 'nssdcaVenera11', frame: '299° E as printed',
    note: 'Its camera\'s lens cover failed to come off, so it sent no pictures.' },
  { key: 'venera13', body: 'venus', name: 'Venera 13', agency: 'USSR', kind: 'lander', landed: '1982-03-01T03:57:21Z', place: 'east of Phoebe Regio', lat: -7.5, lon: -57, source: 'nssdcaVenera13', frame: '303° E as printed',
    note: 'The first colour pictures from Venus. It lasted 127 minutes at 457 °C and 89 bar.' },
  { key: 'venera14', body: 'venus', name: 'Venera 14', agency: 'USSR', kind: 'lander', landed: '1982-03-05T07:00:10Z', place: 'Phoebe Regio', lat: -13.25, lon: -50, source: 'nssdcaVenera14', frame: '13° 15′ S, 310° E as printed',
    note: 'On a basalt plain about 950 km southwest of Venera 13.' },
  { key: 'vega1', body: 'venus', name: 'Vega 1', agency: 'USSR', kind: 'lander', landed: '1985-06-11T03:02:54Z', place: 'north of Aphrodite Terra', lat: 7.5, lon: 177.7, elevM: -600, source: 'nssdcaVega1',
    note: 'Its lander, left at Venus on the way to Halley\'s comet, 0.6 km below the mean radius.' },
  { key: 'vega2', body: 'venus', name: 'Vega 2', agency: 'USSR', kind: 'lander', landed: '1985-06-15T03:00:50Z', place: 'Aphrodite Terra', lat: -8.5, lon: 164.5, elevM: 100, source: 'nssdcaVega2',
    note: 'The last craft on Venus\'s surface to date.' },
  // ---- Mercury, Titan and the giants ----
  { key: 'messenger', body: 'mercury', name: 'MESSENGER', agency: 'NASA', kind: 'impact', landed: '2015-04-30T19:26:01Z', place: 'northern hemisphere', lat: 54.4398, lon: -149.8795, source: 'messengerImpact', frame: '210.1205° E as printed',
    note: 'Out of fuel, it struck at 3.912 km/s on a slope of about 8.5°, 2,438.790 km from Mercury\'s centre, and made a crater about 16 m across.' },
  { key: 'huygens', body: 'titan', name: 'Huygens', agency: 'ESA', kind: 'lander', landed: '2005-01-14', timeSource: 'nssdcaCassini', place: 'equatorial plain', lat: -10.573, lon: 167.665, uncKm: 1.6, source: 'huygensDtwg', frame: '192.335° W as printed',
    note: 'The farthest landing from the Earth. The revised trajectory (2010, for Titan\'s newer pole) moved it about 0.3° south; the residuals are 0.035° in longitude and 0.007° in latitude.' },
  { key: 'galileoProbe', body: 'jupiter', name: 'Galileo Probe', agency: 'NASA', kind: 'entry', landed: '1995-12-07', timeSource: 'nssdcaGalileoProbe', place: 'near the equator', lat: 6.54, lon: -4.46, source: 'galileoCat', frame: '4.46° W as printed; System III, the latitude type not stated',
    note: 'Released from Galileo five months before, it went in a little over four hours after Galileo passed Io, and its data were relayed for 58.6 minutes. Placed on the 1-bar ellipsoid.' },
  { key: 'cassini', body: 'saturn', name: 'Cassini', agency: 'NASA · ESA · ASI', kind: 'entry', landed: '2017-09-15T10:31Z', place: 'northern hemisphere', lat: 9.8, lon: 54.6, source: 'nssdcaCassini', frame: '305.4° W (System III) as printed: NSSDCA\'s estimate',
    note: 'The end of the mission: it went into Saturn on purpose. The time is spacecraft time (11:54 UTC as received on Earth). Placed on the 1-bar ellipsoid.' },
  // ---- small bodies: given in the shape model's frame, flown to as the body ----
  { key: 'near', body: 'sb:433', name: 'NEAR Shoemaker', agency: 'NASA', kind: 'lander', landed: '2001-02-12T20:01:52Z', timeSource: 'nssdcaNear', place: 'south of the Himeros saddle', lat: -40.03, lon: 80.66, uncM: 150, source: 'naifNearLanded', frame: 'EROSFIXED, east-positive; 6.447 km from the centre',
    note: 'At the end of its year in orbit it came down slowly to the surface, the first craft to touch down on an asteroid, and was heard from until 28 February. The navigation team\'s estimate, to ±50, 10 and 150 m in x, y and z.' },
  { key: 'mascot', body: 'sb:162173', name: 'MASCOT', agency: 'DLR · CNES', kind: 'lander', landed: '2018-10-03', timeSource: 'nssdcaHayabusa2', place: 'south of the equator', lat: -22.31, lon: -42.85, source: 'schroderMascot', frame: '317.15° E as printed, in Ryugu\'s shape model',
    note: 'Hayabusa2\'s small lander, let go 51 m above Ryugu at 01:57 UT. It could right itself and hop; its batteries lasted about 17 hours. Its final place.' },
  { key: 'osirisRex', body: 'sb:101955', name: 'OSIRIS-REx', agency: 'NASA', kind: 'touch', landed: '2020-10-20T22:08Z', timeSource: 'nssdcaOsirisRex', place: 'Hokioi crater (Nightingale)', lat: 55.8, lon: 42.3, source: 'barnouinHokioi', frame: 'the crater\'s centre, Bennu\'s body-fixed frame',
    note: 'A touch-and-go: its sampler touched the surface and took a sample, which came back to the Earth on 24 September 2023. The 20 m crater it sampled; the time is as received on the Earth.' },
];

// The small bodies with sites, by their 'sb:<designation>' (smallBodies.js's names).
/** @type {Record<string, string>} */
export const SMALL_BODY_NAMES = {
  'sb:433': '433 Eros', 'sb:162173': '162173 Ryugu', 'sb:101955': '101955 Bennu',
};

export const SITE_BY_KEY = Object.fromEntries(LANDING_SITES.map((s) => [s.key, s]));

// The body a site is on: a planet or moon's key, or 'sb:<pdes>'.
/** @type {(site: LandingSite) => string} */
export const siteBody = (site) => site.body ?? 'moon';
// A small body's site has no frame to turn: it is given, not drawn.
export const onSmallBody = (site) => siteBody(site).startsWith('sb:');
// The body's reference radii (km along its X, Y, Z), as it is drawn.
export const siteRadii = (site) => RADII[siteBody(site)] ?? null;

// The site on the unit sphere, in the body's frame (X to 0° longitude,
// Z to the north pole), as the maps are laid out (bodyMaterial.ts).
export function siteUnit(site) {
  const cl = Math.cos(site.lat * DEG);
  return [cl * Math.cos(site.lon * DEG), cl * Math.sin(site.lon * DEG), Math.sin(site.lat * DEG)];
}

// The site on the body's reference ellipsoid, body-fixed km, along its
// planetocentric direction u: r = 1 / sqrt(sum (u_i / a_i)^2).
export function siteFixedKm(site) {
  const u = siteUnit(site), a = siteRadii(site);
  const r = 1 / Math.hypot(u[0] / a[0], u[1] / a[1], u[2] / a[2]);
  return [r * u[0], r * u[1], r * u[2]];
}
// The ellipsoid's outward normal there (unit, body-fixed): the local up.
export function siteNormal(site) {
  const p = siteFixedKm(site), a = siteRadii(site);
  const n = [p[0] / (a[0] * a[0]), p[1] / (a[1] * a[1]), p[2] / (a[2] * a[2])];
  const m = Math.hypot(...n);
  return [n[0] / m, n[1] / m, n[2] / m];
}

// The site about its body's centre in J2000, km: on its reference
// ellipsoid, or (R given) on a sphere of radius R. `axes` may be passed in
// (bodyAxesEqj(body, date)) to share them.
export function siteOffsetEqj(site, date, R = null, axes = bodyAxesEqj(siteBody(site), date)) {
  const p = R === null ? siteFixedKm(site) : siteUnit(site).map((x) => R * x);
  const [X, Y, Z] = axes;
  return [0, 1, 2].map((i) => p[0] * X[i] + p[1] * Y[i] + p[2] * Z[i]);
}

// The Sun's elevation above the site's horizon (the ellipsoid's tangent
// plane), degrees, from the direction to the Sun in J2000 (any length)
// and the body's axes.
export function sunElevationDeg(site, sunDirEqj, axes) {
  const u = siteNormal(site);
  const [X, Y, Z] = axes;
  const n = [0, 1, 2].map((i) => u[0] * X[i] + u[1] * Y[i] + u[2] * Z[i]);
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
