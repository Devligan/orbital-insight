# Notes from building it

Things that went wrong, and what each one changed. Roughly in the order they happened.

### The globe worked everywhere except production

A Cesium dependency carried a WebAssembly blob as a string, and the production minifier turned it into invalid
JavaScript. Every test passed in development; visitors got a blank globe and a `SyntaxError`. The unused module is
aliased away now, visual changes get judged on production builds, and every deployment is smoke-tested with one
headline assertion: no uncaught page errors.

### The ISS was drawn inside the Earth

Positions in kilometres went to Cesium, which expects metres, so the station sat about 7 km from the centre of the Earth. A test had been checking the readout text, which was fine, while the globe itself was wrong. Unit conversions
now live in one module, and the globe exposes what Cesium actually holds (its clock, the satellite's altitude) so
tests check the drawing, not the label.

### The provider said no to our servers

CelesTrak answered the full-catalog request from Vercel's servers with an error, while answering everyone else. The
globe's sky, the atlas and the screener all went empty at once. Each deployment now carries its own copy of the
catalog, labelled with its real age, refreshed in the background and by a scheduled job.

### Screening took ten seconds

When Starlink lowered a shell to about 480 km, thousands more satellites fell inside the ISS's screening band:
11.5 million SGP4 runs. Two things in Earth orbit can't close faster than about 16 km/s, though, so from a separation
*d* nothing can come within the threshold for *(d − threshold) / 16 km/s*, and the sweep can jump ahead by exactly that
much. Same answers, 2.4 million runs, about 2.5 seconds. A test checks it against the brute-force sweep.

### A test that failed on its own

A test compared the real clock against a data snapshot checked into the repo, and started failing a week after the
file was written. Time in that test is now pinned to the snapshot.

### 27 kB to check a 1 kB answer

Town search and the cloud forecast validated their small responses with Zod in the browser, and the home page grew
from 122 kB to 150 kB of JavaScript. The browser clients check the same rules by hand now, and the server keeps Zod.
The bundle budget in CI is what noticed.

### "Satellite trains" that weren't

The first version of *What did I just see?* grouped any four satellites from the same launch as a train. A screenshot
showed it calling scattered Starlinks from 2021 a train. A train is a cluster, launch-mates within 10° of each other at
the same moment, and that's what it looks for now.

### Testing a login page

The post-deploy checks ran against each deployment's own URL, which is behind Vercel's protection, so for a while
they were testing Vercel's sign-in page. The smoke test failed for the wrong reason, and Lighthouse passed by auditing
the sign-in page. Production is now checked on its public domain, once that domain reports the commit being checked.
