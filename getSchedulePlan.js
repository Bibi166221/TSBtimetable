/**
 * Maps numeric status code from Thai Smile Bus API to human-readable state.
 * 0 = Planned (เที่ยวให้บริการถัดไป)
 * 1 = Operating (กำลังให้บริการ)
 * 2 = Completed (ให้บริการแล้ว)
 */
const STATUS_MAP = {
  0: "Planned (เที่ยวให้บริการถัดไป)",
  1: "Operating (กำลังให้บริการ)",
  2: "Completed (ให้บริการแล้ว)"
};

const BASE_URL = "https://information.thaismilebus.com/SchedulePlan";
const { parseCatalog } = require("./routeCatalog");

/**
 * Helper to send POST requests to Thai Smile Bus SchedulePlan endpoints.
 */
async function postForm(path, params, route) {
  const response = await fetch(`${BASE_URL}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": `${BASE_URL}/index.php?route=${encodeURIComponent(route)}`,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
    },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    throw new Error(`HTTP error on ${path}! Status: ${response.status}`);
  }

  return await response.json();
}

/**
 * Fetches raw route data (info, timetable, stops) from get_route.php.
 * @param {string} route - Custom route name, e.g., "1-4(39)"
 */
async function getRouteData(route = "1-4(39)") {
  const json = await postForm(
    "dataPage/get_route.php",
    { routeName: route, stopsGenerate: "0" },
    route
  );

  if (json.status !== "success" || !json.data) {
    throw new Error(`No route data found for route "${route}"`);
  }

  return json;
}

/**
 * Fetches live vehicle positions from getVehicleLocation.php.
 * @param {string} route - Custom route name, e.g., "1-4(39)"
 */
async function getVehicleLocations(route = "1-4(39)") {
  const json = await postForm(
    "dataPage/getVehicleLocation.php",
    { routeName: route },
    route
  );

  return Array.isArray(json?.data) ? json.data : [];
}

/**
 * Loads the list of routes actually advertised by the official TSB route picker.
 * Do not infer a supplementary line exists solely from a route-number pattern.
 */
async function getRouteCatalog() {
  const response = await fetch(`${BASE_URL}/index.php`, {
    method: "GET",
    headers: { "Accept": "text/html, */*" },
    signal: AbortSignal.timeout(9000)
  });
  if (!response.ok) throw new Error(`Could not load TSB route list (HTTP ${response.status})`);
  const list = parseCatalog(await response.text());
  if (!list.size) throw new Error("No route options found in the TSB route picker");
  return list;
}

/**
 * Fetches route display start & destination names (e.g., "มหาวิทยาลัยธรรมศาสตร์ (ศูนย์รังสิต)" - "บางเขน")
 * from index.php option attributes.
 * @param {string} route - Custom route name, e.g., "1-4(39)"
 */
async function getRouteMeta(route = "1-4(39)") {
  const response = await fetch(`${BASE_URL}/index.php?route=${encodeURIComponent(route)}`, {
    method: "GET",
    headers: {
      "Accept": "text/html, */*",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
    },
    signal: AbortSignal.timeout(9000)
  });

  if (!response.ok) {
    return { start: "-", destination: "-" };
  }

  const html = await response.text();
  const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const optionMatch = html.match(new RegExp(`<option\\b[^>]*\\bvalue="${escapedRoute}"[^>]*>`, "i"));

  if (!optionMatch) {
    return { start: "-", destination: "-" };
  }

  const tag = optionMatch[0];
  const start = tag.match(/\bdata-start="([^"]*)"/i)?.[1] || "-";
  const destination = tag.match(/\bdata-destination="([^"]*)"/i)?.[1] || "-";

  return { start, destination };
}

/**
 * Fetches combined route data, stops, live bus positions, and schedule list
 * for a custom route.
 *
 * @param {string} route - Custom route name, e.g., "1-4(39)"
 */
async function getSchedulePlan(route = "1-4(39)") {
  const [routeRes, locationList, routeMeta] = await Promise.all([
    getRouteData(route),
    getVehicleLocations(route),
    getRouteMeta(route)
  ]);

  const { updated_date: updatedDate, data } = routeRes;
  const goStops = data.go?.stops || [];
  const backStops = data.back?.stops || [];

  // Build stop lookup maps (stopId -> stop details)
  const goStopMap = new Map(
    goStops.map((s, idx) => [String(s.id), { ...s, index: idx + 1, direction: "go (ขาไป)" }])
  );
  const backStopMap = new Map(
    backStops.map((s, idx) => [String(s.id), { ...s, index: idx + 1, direction: "back (ขากลับ)" }])
  );

  // Build live location lookup by plate number
  const rawLocationByPlate = new Map();
  for (const loc of locationList) {
    if (loc.plateNo) {
      rawLocationByPlate.set(loc.plateNo, loc);
    }
  }

  const formatDirection = (dirData, dirKey, dirLabel, stopMap) => {
    const info = dirData?.info || {};
    const stops = (dirData?.stops || []).map((s, idx) => ({
      order: idx + 1,
      id: s.id,
      name: s.name,
      note: s.note || ""
    }));

    const timetable = (dirData?.timetable || []).map((item) => {
      const statusCode = Number(item.status);
      const loc = rawLocationByPlate.get(item.plate);
      let currentStopId = null;
      let currentStopName = "-";

      if (statusCode === 1 && loc) {
        currentStopId = loc.stop;
        const stopMatch =
          stopMap.get(String(loc.stop)) ||
          goStopMap.get(String(loc.stop)) ||
          backStopMap.get(String(loc.stop));

        // Same logic as website script.js: if a back-direction operating bus is still on a go stop
        if (dirKey === "back" && goStopMap.has(String(loc.stop)) && !backStopMap.has(String(loc.stop))) {
          currentStopName = "--จบเที่ยวแล้ว--";
        } else if (stopMatch) {
          currentStopName = stopMatch.name;
        } else {
          currentStopName = `Stop ID: ${loc.stop}`;
        }
      }

      return {
        direction: dirLabel,
        plate: item.plate || "-",
        time: item.time || "-",
        state: STATUS_MAP[statusCode] ?? `Unknown (${item.status})`,
        statusCode,
        vehicleAirType: item.vehicle_air_type || "-",
        currentStopId,
        currentStopName
      };
    });

    return {
      info: {
        firstStation: info.first_station || "-",
        lastStation: info.last_station || "-",
        firstBus: info.first_bus || "-",
        lastBus: info.last_bus || "-"
      },
      stops,
      timetable
    };
  };

  const go = formatDirection(data.go, "go", "go (ขาไป)", goStopMap);
  const back = formatDirection(data.back, "back", "back (ขากลับ)", backStopMap);

  go.info.start = routeMeta.start;
  go.info.destination = routeMeta.destination;
  go.info.routeTitle = `${routeMeta.start} - ${routeMeta.destination}`;

  back.info.start = routeMeta.destination;
  back.info.destination = routeMeta.start;
  back.info.routeTitle = `${routeMeta.destination} - ${routeMeta.start}`;

  const schedule = [...go.timetable, ...back.timetable];

  // Map all reported live vehicle positions with resolved stop names
  const busPositions = locationList.map((loc) => {
    const stopId = String(loc.stop);
    const stopInfo = goStopMap.get(stopId) || backStopMap.get(stopId);
    const activeTrip = schedule.find(
      (t) => t.plate === loc.plateNo && t.statusCode === 1
    );

    return {
      plate: loc.plateNo,
      stopId: loc.stop,
      stopName: stopInfo ? stopInfo.name : "-",
      direction: activeTrip?.direction || stopInfo?.direction || "-",
      departureTime: activeTrip?.time || "-",
      state: activeTrip ? activeTrip.state : "Idle / Off-trip"
    };
  });

  return {
    route,
    updatedDate,
    guarantee: data.guarantee || "",
    vehicleType: data.vehicle_type,
    routeData: {
      go: { info: go.info, stops: go.stops },
      back: { info: back.info, stops: back.stops }
    },
    busPositions,
    schedule
  };
}

// Run test from CLI: node getSchedulePlan.js [custom_route]
if (require.main === module) {
  const customRoute = process.argv[2] || "1-4(39)";
  console.log(`Fetching route data & live bus positions for route: ${customRoute}...\n`);

  getSchedulePlan(customRoute)
    .then((result) => {
      console.log("=== ROUTE INFO ===");
      console.log(`Route: ${result.route} (Date: ${result.updatedDate})`);
      console.log(`ขาไป:   ${result.routeData.go.info.routeTitle}`);
      console.log(
        `        (${result.routeData.go.info.firstStation} -> ${result.routeData.go.info.lastStation}, ` +
        `${result.routeData.go.info.firstBus} - ${result.routeData.go.info.lastBus}, ${result.routeData.go.stops.length} stops)`
      );
      console.log(`ขากลับ: ${result.routeData.back.info.routeTitle}`);
      console.log(
        `        (${result.routeData.back.info.firstStation} -> ${result.routeData.back.info.lastStation}, ` +
        `${result.routeData.back.info.firstBus} - ${result.routeData.back.info.lastBus}, ${result.routeData.back.stops.length} stops)\n`
      );

      console.log(`=== LIVE BUS POSITIONS (${result.busPositions.length} vehicles) ===`);
      console.table(result.busPositions);

      const operatingTrips = result.schedule.filter((t) => t.statusCode === 1);
      console.log(`\n=== CURRENTLY OPERATING TRIPS (${operatingTrips.length} trips) ===`);
      console.table(operatingTrips);

      console.log(`\n=== ALL SCHEDULE TRIPS (${result.schedule.length} total) ===`);
      console.table(
        result.schedule.map(({ direction, plate, time, state, currentStopName }) => ({
          direction,
          plate,
          time,
          state,
          currentStopName
        }))
      );
    })
    .catch((err) => {
      console.error("Error fetching schedule:", err.message);
      process.exitCode = 1;
    });
}

module.exports = {
  getSchedulePlan,
  getRouteData,
  getRouteMeta,
  getRouteCatalog,
  getVehicleLocations,
  STATUS_MAP
};
