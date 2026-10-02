import { ZONE_COORDINATES } from '../data/zoneCoordinates';
import { canonicalZone, offsetMinutes } from './tz';

// Where the sun is, from the equations of NOAA's Solar Calculator (after
// Meeus, Astronomical Algorithms) — no network, no tables. Good to a small
// fraction of a degree, far more than a background colour needs.

const rad = (degrees: number) => (degrees * Math.PI) / 180;
const deg = (radians: number) => (radians * 180) / Math.PI;

// The sun's declination (degrees) and the equation of time (minutes) at `date`.
function solarTerms(date: Date): { declination: number; equationOfTime: number } {
  const t = (date.getTime() / 86400000 + 2440587.5 - 2451545) / 36525; // Julian centuries since J2000
  const meanLongitude = (((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360) + 360) % 360;
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const center =
    Math.sin(rad(meanAnomaly)) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(rad(2 * meanAnomaly)) * (0.019993 - 0.000101 * t) +
    Math.sin(rad(3 * meanAnomaly)) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const apparentLongitude = meanLongitude + center - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const obliquity =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(rad(omega));
  const declination = deg(Math.asin(Math.sin(rad(obliquity)) * Math.sin(rad(apparentLongitude))));
  const y = Math.tan(rad(obliquity) / 2) ** 2;
  const equationOfTime =
    4 *
    deg(
      y * Math.sin(2 * rad(meanLongitude)) -
        2 * eccentricity * Math.sin(rad(meanAnomaly)) +
        4 * eccentricity * y * Math.sin(rad(meanAnomaly)) * Math.cos(2 * rad(meanLongitude)) -
        0.5 * y * y * Math.sin(4 * rad(meanLongitude)) -
        1.25 * eccentricity * eccentricity * Math.sin(2 * rad(meanAnomaly))
    );
  return { declination, equationOfTime };
}

// Minutes since true solar midnight at longitude `lon`; 720 is solar noon.
function trueSolarMinutes(lon: number, date: Date, equationOfTime: number): number {
  const utcMinutes = date.getTime() / 60000;
  return (((utcMinutes + equationOfTime + 4 * lon) % 1440) + 1440) % 1440;
}

// The sun's geometric elevation above the horizon at (lat, lon) at `date`, in
// degrees — negative once it has set. Refraction is left out: at sunrise the
// centre of the sun is at about −0.83° by this measure.
export function sunElevation(lat: number, lon: number, date: Date): number {
  const { declination, equationOfTime } = solarTerms(date);
  const hourAngle = trueSolarMinutes(lon, date, equationOfTime) / 4 - 180;
  const cosZenith =
    Math.sin(rad(lat)) * Math.sin(rad(declination)) +
    Math.cos(rad(lat)) * Math.cos(rad(declination)) * Math.cos(rad(hourAngle));
  return 90 - deg(Math.acos(Math.min(1, Math.max(-1, cosZenith))));
}

// Solar noon — the sun at its highest — of the solar day `date` falls in:
// the one between the solar midnights either side of it, so a time before
// it is morning and a time after it afternoon. Longitude alone decides it.
export function solarNoon(lon: number, date: Date): Date {
  const at = (eotAt: Date) =>
    date.getTime() + (720 - trueSolarMinutes(lon, date, solarTerms(eotAt).equationOfTime)) * 60000;
  // The equation of time drifts by seconds a day: one more pass at the
  // estimate settles it.
  return new Date(at(new Date(at(date))));
}

export type TimeOfDay = 'night' | 'dawn' | 'day' | 'twilight';

// The sky a card shows (spec §9.2), from how high the sun is: below
// NIGHT_BELOW it's night, above DAY_ABOVE it's day; in between it's dawn
// before solar noon and twilight after. The thresholds are the old
// sunrise/sunset ±45-minute windows turned into elevations: fitted on Tokyo,
// London, New York, Sydney and Singapore at both equinoxes and solstices, the
// phases match the old ones to within 15 minutes at every boundary. London's
// solstice dawns and dusks run about 30 minutes longer — not an error: the
// farther from the equator, the shallower the sun's path, so it takes longer
// to cross the same band of elevation, just as real twilight lasts longer
// there. 3.1.2's fixed ±45 minutes was the approximation. Polar day and night
// need no special case: the sun just never crosses a threshold.
export const NIGHT_BELOW = -9;
export const DAY_ABOVE = 7;

export function timeOfDay(lat: number, lon: number, date: Date): TimeOfDay {
  const elevation = sunElevation(lat, lon, date);
  if (elevation < NIGHT_BELOW) return 'night';
  if (elevation > DAY_ABOVE) return 'day';
  return date.getTime() < solarNoon(lon, date).getTime() ? 'dawn' : 'twilight';
}

export interface Coordinates {
  lat: number;
  lon: number;
}

const isCoordinate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

// Where to put the sun for a card: the city's own coordinates when it has
// them (0 is a coordinate, not a missing one); else the principal location
// of its time zone from tzdata's zone.tab, found by its current name (cities
// added before 2.0.0 have none); else — a zone with no location, like Etc/GMT-9 — the equator at the
// longitude its UTC offset stands for. Derived each time, never written back
// to the entry.
export function sunCoordinates(timezone: string, lat: number | undefined, lon: number | undefined, date: Date): Coordinates {
  if (isCoordinate(lat) && isCoordinate(lon)) return { lat, lon };
  const zone = ZONE_COORDINATES[canonicalZone(timezone)];
  if (zone) return { lat: zone[0], lon: zone[1] };
  return { lat: 0, lon: offsetMinutes(timezone, date) / 4 };
}
