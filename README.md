<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/mark-dark.svg">
    <img src="docs/images/mark-light.svg" width="72" height="72" alt="">
  </picture>
</p>

<h1 align="center">Orbital Insight</h1>

<p align="center">
  <a href="https://orbital-insight-drab.vercel.app"><b>Open the site</b></a>
  &nbsp;·&nbsp;
  <a href="https://orbital-insight-drab.vercel.app/methodology">How the numbers are made</a>
  &nbsp;·&nbsp;
  <a href="docs/notes.md">Notes from building it</a>
</p>

A website for looking up. It tells you which satellites will cross your sky tonight and where to look, works out
what that moving light you just saw probably was, and puts every active satellite on a live globe. The orbits are
real (public element sets from CelesTrak), and the maths runs in your browser.

No account, nothing to install.

![Every active satellite on the globe, with the ISS followed in real time](docs/images/home.jpg)

## What you can do

- **See what's up tonight.** Type a town (or share your location) and get the passes you can actually see: only
  ones where the satellite is sunlit against a dark sky. Each comes with a little chart of your sky, the direction in
  compass words, how high in fists at arm's length, the forecast cloud cover, and a calendar reminder.
- **Identify a sighting.** Saw a steady light glide past? Say when and which way you were looking, and the whole
  catalog is checked against your sky for that moment.
- **Explore the globe.** About 16,000 objects, propagated live. Follow the ISS, scrub time forward, click any dot.
- **See who's in orbit.** Every satellite by orbit height and tilt, where Starlink's shells, the sun-synchronous
  band and the geostationary ring jump out.
- **Screen for close approaches.** Pick a satellite and check it against everything else for the next few days.

![An ISS pass over New York: when, how bright, where to look, and the cloud forecast](docs/images/sky-chart.png)

| Who's in orbit | Close approaches to the ISS |
| --- | --- |
| ![Active satellites by inclination and altitude](docs/images/atlas.png) | ![The ISS screened against the catalog, with miss distances split into radial, in-track and cross-track](docs/images/conjunctions.png) |

## How it works

Every satellite in orbit has a published set of numbers describing its orbit, refreshed every day or so by the people
who track them. Feed those numbers into SGP4, the standard model the tracking community uses, and you get where the
satellite is at any moment. This site does that in your browser for about 16,000 satellites at once, which is what
puts the whole sky on the globe and lets it check a sighting against every one of them in a second or two.

Seeing one is a different question from where it is. A satellite only shines because it's catching sunlight, so it
has to be lit while your own sky is dark, and that window is usually just after dusk or before dawn. Every pass gets
checked for both, the stretch you can actually see gets worked out to the second, and that's the part drawn on the
chart.

If you want the details: [docs/architecture.md](docs/architecture.md) covers how the pieces fit, the
[methodology page](https://orbital-insight-drab.vercel.app/methodology) lists every approximation, and
[docs/notes.md](docs/notes.md) is the story of what broke along the way.

## Running it

```bash
npm install
npm run dev       # http://localhost:3000, no setup or keys needed
npm test
```

## Credits

Orbital elements from [CelesTrak](https://celestrak.org/). Town search and cloud forecasts from
[Open-Meteo](https://open-meteo.com/) (CC BY 4.0, places from GeoNames). Orbits computed with
[satellite.js](https://github.com/shashwatak/satellite-js), the globe drawn with [CesiumJS](https://cesium.com/), the
ISS model from NASA.

Positions are predictions from public data, good to about a kilometre, so this is for looking up, not for navigation
or anything safety-related.

Made by [Devligan](https://github.com/Devligan).