# Security

digital-orrery runs entirely in the browser. It has no server, no
accounts and no stored credentials, and it sends nothing about its users
anywhere.

## What it fetches

- **Its own files:** the app's own static data, maps and ephemeris tables,
  from wherever it is served.
- **Daily Earth imagery:** from NASA GIBS (`gibs.earthdata.nasa.gov`), for
  the sim date.
- **Satellite element sets, on request:** the rail's satellites **Latest**
  key fetches CelesTrak's current GP data for the active satellites
  (`celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=csv`, 2.5 MB),
  only when pressed and at most once in 2 hours from the same browser, as
  CelesTrak's usage policy asks. It sends nothing but the request itself.
  It keeps the time it last asked in `localStorage`. Without it, the app
  uses the snapshot it ships.

Data scripts run by a developer (`npm run fetch:…`) also read public JPL,
NAIF, NASA and CelesTrak services. They write only under the repository and
`~/.cache/digital-orrery/`.

## What it keeps

- **The place for satellite passes:** the latitude, longitude and height
  typed on the satellite plate, or given by the browser when **Locate** is
  pressed (the browser asks first), are kept in this browser's
  `localStorage` and used only in the page. They are sent nowhere.

## Files it reads

- **OpenRocket designs:** the ROCKET tab opens `.ork` files you choose, and
  parses them in the page. A malformed file should only produce an error
  message. If one can run code, read other files or hang the page, that is
  a security bug.

## Reporting

Please report a vulnerability privately to the repository owner through
GitHub, not in a public issue. Include the browser, the steps or the file
that shows it, and what happened.
