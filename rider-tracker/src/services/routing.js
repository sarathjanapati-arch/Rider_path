const axios = require('axios');
const { VALHALLA_URL } = require('../config');
const { pairRouteCache, withCache } = require('./cache');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function decodePolyline6(encoded) {
  const coords = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    for (const isLng of [false, true]) {
      let result = 0;
      let shift = 0;
      let byte;

      do {
        byte = encoded.charCodeAt(index) - 63;
        index += 1;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);

      const delta = (result & 1) ? ~(result >> 1) : (result >> 1);
      if (isLng) lng += delta;
      else lat += delta;
    }

    coords.push([lat / 1e6, lng / 1e6]);
  }

  return coords;
}

async function valhallaRoute(from, to) {
  const key = `${from.lat},${from.lng}->${to.lat},${to.lng}`;

  return withCache(pairRouteCache, key, async () => {
    const payload = {
      locations: [
        { lat: from.lat, lon: from.lng },
        { lat: to.lat, lon: to.lng },
      ],
      costing: 'auto',
      directions_options: { units: 'kilometers' },
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await axios.post(VALHALLA_URL, payload, {
        timeout: 15000,
        validateStatus: () => true,
      });

      if (response.status === 429) {
        await sleep((attempt + 1) * 1500);
        continue;
      }

      if (response.status !== 200) {
        throw new Error(`Valhalla HTTP ${response.status}`);
      }

      const legs = response.data?.trip?.legs || [];
      if (!legs.length) throw new Error('No route');

      const coords = [];
      let distKm = 0;

      for (const leg of legs) {
        if (leg?.shape) {
          const legCoords = decodePolyline6(leg.shape);
          if (coords.length && legCoords.length) {
            const [prevLat, prevLng] = coords.at(-1);
            const [nextLat, nextLng] = legCoords[0];
            if (prevLat === nextLat && prevLng === nextLng) coords.push(...legCoords.slice(1));
            else coords.push(...legCoords);
          } else {
            coords.push(...legCoords);
          }
        }

        distKm += Number(leg?.summary?.length || 0);
      }

      if (!coords.length) throw new Error('Empty geometry');
      return { coords, distKm: +distKm.toFixed(3), fallback: false };
    }

    throw new Error('Valhalla rate limit retries exhausted');
  });
}

module.exports = { valhallaRoute, sleep };
