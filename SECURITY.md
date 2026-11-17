# Security

digital-orrery runs entirely in the browser. It has no server, no
accounts and no stored credentials, and it sends nothing about its users
anywhere.

## What it fetches

- **Its own files:** the app's own static data, maps and ephemeris tables,
  from wherever it is served.
- **Daily Earth imagery:** from NASA GIBS (`gibs.earthdata.nasa.gov`), for
  the sim date.

Data scripts run by a developer (`npm run fetch:…`) also read public JPL,
NAIF and NASA services. They write only under the repository and
`~/.cache/digital-orrery/`.

## Files it reads

- **OpenRocket designs:** the ROCKET tab opens `.ork` files you choose, and
  parses them in the page. A malformed file should only produce an error
  message. If one can run code, read other files or hang the page, that is
  a security bug.

## Reporting

Please report a vulnerability privately to the repository owner through
GitHub, not in a public issue. Include the browser, the steps or the file
that shows it, and what happened.
