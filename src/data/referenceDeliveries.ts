import { ContactPointRecord, PlantedStumpsConfig } from '../types/cricket';
import {
  autoDetectBounceFromContactPoint,
  calculateImaginaryStumpPoint,
  createDefaultPlantedStumps,
} from '../utils/stumpProjection';

function createCleanSampleSnapshot(
  label: string,
  dotX: number,
  dotY: number,
  bounceX: number,
  bounceY: number,
  backStumpX: number,
  frontStumpX: number,
  dotColor: string,
  isCreaseArrow = false
): string {
  const w = 480;
  const h = 270;
  const bx = backStumpX * w;
  const by = 0.57 * h;
  const fx = frontStumpX * w;
  const fy = (isCreaseArrow ? 0.72 : 0.84) * h;
  const px = dotX * w;
  const py = dotY * h;
  const bncX = bounceX * w;
  const bncY = bounceY * h;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="#090E1A"/>
    <polygon points="0,${h * 0.45} ${w},${h * 0.45} ${w},${h} 0,${h}" fill="#0B2219"/>
    <polygon points="${bx - 56},${by - 12} ${bx + 56},${by - 12} ${fx + 125},${h} ${fx - 125},${h}" fill="#443527"/>
    <!-- Pitch Stump-to-Stump or Crease Arrow Corridor -->
    <polygon points="${bx - 18},${by} ${bx + 18},${by} ${fx + 22},${fy} ${fx - 22},${fy}" fill="#F59E0B" opacity="0.18"/>
    <!-- Popping Crease White Line -->
    <line x1="${fx - 65}" y1="${fy}" x2="${fx + 65}" y2="${fy}" stroke="#E2E8F0" stroke-width="2" opacity="0.8"/>
    <!-- Back Stumps (Behind Batsman) -->
    <line x1="${bx - 15}" y1="${by}" x2="${bx - 15}" y2="${by - 54}" stroke="#FBBF24" stroke-width="2.5"/>
    <line x1="${bx}" y1="${by}" x2="${bx}" y2="${by - 54}" stroke="#FBBF24" stroke-width="2.5"/>
    <line x1="${bx + 15}" y1="${by}" x2="${bx + 15}" y2="${by - 54}" stroke="#FBBF24" stroke-width="2.5"/>
    <line x1="${bx - 16}" y1="${by - 54}" x2="${bx + 16}" y2="${by - 54}" stroke="#FEF08A" stroke-width="3"/>
    <!-- Front Stumps OR Crease Pitch Arrow -->
    ${
      isCreaseArrow
        ? `<line x1="${bx}" y1="${by}" x2="${fx}" y2="${fy}" stroke="#38BDF8" stroke-width="2.5" stroke-dasharray="4 3"/>
           <circle cx="${fx}" cy="${fy}" r="6" fill="#38BDF8"/>`
        : `<line x1="${fx - 18}" y1="${fy}" x2="${fx - 18}" y2="${fy - 44}" stroke="#38BDF8" stroke-width="2.5"/>
           <line x1="${fx}" y1="${fy}" x2="${fx}" y2="${fy - 44}" stroke="#38BDF8" stroke-width="2.5"/>
           <line x1="${fx + 18}" y1="${fy}" x2="${fx + 18}" y2="${fy - 44}" stroke="#38BDF8" stroke-width="2.5"/>`
    }
    <!-- Auto-Detected Bounce to Contact Arc -->
    <line x1="${bncX}" y1="${bncY}" x2="${px}" y2="${py}" stroke="#22D3EE" stroke-width="2" stroke-dasharray="4 3"/>
    <ellipse cx="${bncX}" cy="${bncY}" rx="10" ry="4.5" fill="rgba(16,185,129,0.28)" stroke="#10B981" stroke-width="2"/>
    <!-- Contact Point -->
    <circle cx="${px}" cy="${py}" r="13" fill="none" stroke="${dotColor}" stroke-width="2.5"/>
    <circle cx="${px}" cy="${py}" r="4.5" fill="#FFFFFF" stroke="${dotColor}" stroke-width="2"/>
    <rect x="12" y="12" width="215" height="22" rx="5" fill="#090D16" opacity="0.85"/>
    <text x="20" y="27" fill="#F8FAFC" font-family="monospace" font-size="10.5" font-weight="bold">${label}</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function getInitialContactPoints(): ContactPointRecord[] {
  const defaultStumps = createDefaultPlantedStumps();

  // Unified calibrated stumps matching the video clip (backStumps at x = 0.48, y = 0.57)
  const sharedStumps: PlantedStumpsConfig = {
    ...defaultStumps,
    anchorMode: 'FRONT_STUMPS',
    backStumps: { x: 0.48, y: 0.57 },
    frontStumps: { x: 0.52, y: 0.84 },
  };

  // Ball #1: Off Stump Good Length (5.8m from stumps -> -9.3 cm Off, 41 cm High)
  const pt1 = { x: 0.467, y: 0.515 };
  const auto1 = autoDetectBounceFromContactPoint(pt1, sharedStumps, 'RHB', 1.01, 5.8);

  // Ball #2: Middle Stump Full / Half-Volley (3.6m from stumps -> -0.7 cm Middle, 31 cm High)
  const pt2 = { x: 0.479, y: 0.528 };
  const auto2 = autoDetectBounceFromContactPoint(pt2, sharedStumps, 'RHB', 1.12, 3.6);

  // Ball #3: Leg Stump Yorker / Blockhole (1.9m from stumps -> +9.3 cm Leg, 18 cm High)
  const pt3 = { x: 0.493, y: 0.546 };
  const auto3 = autoDetectBounceFromContactPoint(pt3, sharedStumps, 'RHB', 1.54, 1.9);

  return [
    {
      id: 'contact-1',
      indexNumber: 1,
      timestampSec: 1.01,
      videoPoint: pt1,
      bouncePoint: auto1.bouncePoint,
      releasePoint: auto1.releasePoint,
      bounceTimestampSec: auto1.bounceTimestampSec,
      releaseTimestampSec: auto1.releaseTimestampSec,
      stumpConfig: sharedStumps,
      projection: calculateImaginaryStumpPoint(pt1, sharedStumps, 'RHB'),
      frameSnapshotUrl: createCleanSampleSnapshot(
        'BALL #1 · GOOD LENGTH (5.8m)',
        pt1.x,
        pt1.y,
        auto1.bouncePoint.x,
        auto1.bouncePoint.y,
        sharedStumps.backStumps.x,
        sharedStumps.frontStumps.x,
        '#10B981',
        false
      ),
      source: 'AI Auto-Detect',
      clipLabel: 'Clip #1 (Good Length)',
      isLocked: true,
      bounceLengthM: 5.8,
      shotOutcome: 'CONTROLLED',
      batBladeBox: {
        xmin: 0.442,
        ymin: 0.455,
        xmax: 0.492,
        ymax: 0.545,
      },
    },
    {
      id: 'contact-2',
      indexNumber: 2,
      timestampSec: 1.12,
      videoPoint: pt2,
      bouncePoint: auto2.bouncePoint,
      releasePoint: auto2.releasePoint,
      bounceTimestampSec: auto2.bounceTimestampSec,
      releaseTimestampSec: auto2.releaseTimestampSec,
      stumpConfig: sharedStumps,
      projection: calculateImaginaryStumpPoint(pt2, sharedStumps, 'RHB'),
      frameSnapshotUrl: createCleanSampleSnapshot(
        'BALL #2 · FULL LENGTH (3.6m)',
        pt2.x,
        pt2.y,
        auto2.bouncePoint.x,
        auto2.bouncePoint.y,
        sharedStumps.backStumps.x,
        sharedStumps.frontStumps.x,
        '#F59E0B',
        false
      ),
      source: 'AI Auto-Detect',
      clipLabel: 'Clip #2 (Full Length)',
      isLocked: true,
      bounceLengthM: 3.6,
      shotOutcome: 'MIDDLED',
      batBladeBox: {
        xmin: 0.469,
        ymin: 0.448,
        xmax: 0.489,
        ymax: 0.552,
      },
    },
    {
      id: 'contact-3',
      indexNumber: 3,
      timestampSec: 1.54,
      videoPoint: pt3,
      bouncePoint: auto3.bouncePoint,
      releasePoint: auto3.releasePoint,
      bounceTimestampSec: auto3.bounceTimestampSec,
      releaseTimestampSec: auto3.releaseTimestampSec,
      stumpConfig: sharedStumps,
      projection: calculateImaginaryStumpPoint(pt3, sharedStumps, 'RHB'),
      frameSnapshotUrl: createCleanSampleSnapshot(
        'BALL #3 · YORKER (1.9m)',
        pt3.x,
        pt3.y,
        auto3.bouncePoint.x,
        auto3.bouncePoint.y,
        sharedStumps.backStumps.x,
        sharedStumps.frontStumps.x,
        '#38BDF8',
        false
      ),
      source: 'Manual Point',
      clipLabel: 'Clip #3 (Yorker)',
      isLocked: true,
      bounceLengthM: 1.9,
      shotOutcome: 'CONTROLLED',
      batBladeBox: {
        xmin: 0.476,
        ymin: 0.472,
        xmax: 0.518,
        ymax: 0.562,
      },
    },
  ];
}
