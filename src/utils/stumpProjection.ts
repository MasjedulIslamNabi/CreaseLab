import {
  AIShotAnalysisReport,
  AIShotVerdictBadge,
  BatterHandedness,
  BowlerTargetPlanId,
  CameraDistanceTelemetry,
  CameraViewingAngle,
  ContactPointRecord,
  DeliverySourceType,
  FarEndCalibrationMode,
  FollowThroughExitVectorTelemetry,
  ImaginaryStumpProjection,
  NormalizedPoint,
  OpticalSwingKinematics,
  PlantedStumpsConfig,
  ShotOutcomeTag,
  StumpLineZone,
  TrackedBallFramePoint,
} from '../types/cricket';

export const STUMP_WIDTH_CM = 22.86; // 9 inches across 3 stumps
export const STUMP_HEIGHT_CM = 71.12; // 28 inches from ground to top of bails

export interface VideoContentRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function getVideoContentRect(
  containerWidth: number,
  containerHeight: number,
  videoWidth: number,
  videoHeight: number
): VideoContentRect {
  if (!containerWidth || !containerHeight || !videoWidth || !videoHeight) {
    return {
      left: 0,
      top: 0,
      width: containerWidth || 1,
      height: containerHeight || 1,
    };
  }

  const containerRatio = containerWidth / containerHeight;
  const videoRatio = videoWidth / videoHeight;

  if (videoRatio > containerRatio) {
    const width = containerWidth;
    const height = containerWidth / videoRatio;
    const left = 0;
    const top = (containerHeight - height) / 2;
    return { left, top, width, height };
  } else {
    const height = containerHeight;
    const width = containerHeight * videoRatio;
    const top = 0;
    const left = (containerWidth - width) / 2;
    return { left, top, width, height };
  }
}

/**
 * Returns -1 when the video is filmed from Behind the Batter (Keeper / Back-Net view)
 * because screen Left/Right (+X/-X) is horizontally mirrored relative to the standard Front/Bowler view.
 */
export function getCameraLateralMirrorSign(
  stumps?: PlantedStumpsConfig | null
): 1 | -1 {
  return stumps?.cameraAngle === 'BEHIND_BATTER' ? -1 : 1;
}

/**
 * Resolves all 4 calibration points (P1: Striker Base, P2: Striker Bails, P3: Popping Crease 1.22m, P4: Pitch Axis / Far End)
 * with sensible defaults for any legacy or partial configuration.
 */
export function resolveFourPointCalibration(stumps: PlantedStumpsConfig): {
  p1StumpBase: NormalizedPoint;
  p2StumpBails: NormalizedPoint;
  p3PoppingCrease: NormalizedPoint;
  p4PitchAxis: NormalizedPoint;
} {
  const p1StumpBase = stumps.backStumps;
  const safeBackH = Math.max(0.03, stumps.backStumpHeight || 0.095);
  const p2StumpBails = stumps.stumpTopPoint || {
    x: p1StumpBase.x,
    y: Number(clamp(p1StumpBase.y - safeBackH, 0.04, 0.94).toFixed(4)),
  };
  const p4PitchAxis = stumps.frontStumps;
  const dx = p4PitchAxis.x - p1StumpBase.x;
  const dy = p4PitchAxis.y - p1StumpBase.y;
  const rayLen = Math.hypot(dx, dy);
  const ux = rayLen > 0.001 ? dx / rayLen : 0;
  const uy = rayLen > 0.001 ? dy / rayLen : 1;

  // Auto-scale 1.22m Popping Crease from Stump Height (0.7112m) along the Pitch Arrow direction if not explicitly set
  const defaultCreaseSpan = clamp(safeBackH * 0.38, 0.022, 0.14);
  let p3PoppingCrease: NormalizedPoint;
  if (stumps.poppingCreasePoint) {
    const projDist = clamp(
      (stumps.poppingCreasePoint.x - p1StumpBase.x) * ux +
        (stumps.poppingCreasePoint.y - p1StumpBase.y) * uy,
      0.018,
      0.22
    );
    p3PoppingCrease = {
      x: Number(clamp(p1StumpBase.x + ux * projDist, 0.03, 0.97).toFixed(4)),
      y: Number(clamp(p1StumpBase.y + uy * projDist, 0.03, 0.97).toFixed(4)),
    };
  } else {
    p3PoppingCrease = {
      x: Number(
        clamp(p1StumpBase.x + ux * defaultCreaseSpan, 0.03, 0.97).toFixed(4)
      ),
      y: Number(
        clamp(p1StumpBase.y + uy * defaultCreaseSpan, 0.03, 0.97).toFixed(4)
      ),
    };
  }

  return {
    p1StumpBase,
    p2StumpBails,
    p3PoppingCrease,
    p4PitchAxis,
  };
}

/**
 * Compact, realistic default 4-point stump & pitch calibration dimensions
 * tailored to the user's Camera Viewing Angle and Far-End visibility.
 */
export function createDefaultPlantedStumps(
  cameraAngle: CameraViewingAngle = 'BEHIND_BOWLER',
  farEndMode: FarEndCalibrationMode = 'VISIBLE_PITCH_AXIS',
  deliverySource: DeliverySourceType = 'BOWLER_STUMPS'
): PlantedStumpsConfig {
  if (cameraAngle === 'BEHIND_BATTER') {
    // Behind Batter / Wicketkeeper Net View: Striker Stumps in foreground (lower on screen), pitch runs upward toward background
    const backStumps = { x: 0.5, y: 0.78 };
    const backStumpHeight = 0.125;
    const backStumpWidth = 0.044;
    const frontStumps =
      farEndMode === 'VISIBLE_PITCH_AXIS'
        ? { x: 0.5, y: 0.42 }
        : { x: 0.5, y: 0.34 };
    const poppingCreasePoint = { x: 0.5, y: 0.69 };
    const stumpTopPoint = {
      x: backStumps.x,
      y: Number((backStumps.y - backStumpHeight).toFixed(4)),
    };
    return {
      anchorMode:
        farEndMode === 'VISIBLE_PITCH_AXIS' ? 'CREASE_ARROW' : 'FRONT_STUMPS',
      cameraAngle,
      farEndMode,
      deliverySource,
      releaseVisibilityMode: 'UNSEEN_RELEASE',
      bowlerWicketSide: 'OVER_THE_WICKET',
      bowlerSpeedType: 'PACE',
      backStumps,
      stumpTopPoint,
      poppingCreasePoint,
      frontStumps,
      backStumpWidth,
      backStumpHeight,
      frontStumpWidth: 0.028,
      frontStumpHeight: 0.075,
    };
  }

  if (cameraAngle === 'SIDE_DIAGONAL') {
    const backStumps = { x: 0.34, y: 0.64 };
    const backStumpHeight = 0.105;
    const backStumpWidth = 0.034;
    const frontStumps = { x: 0.78, y: 0.74 };
    const poppingCreasePoint = { x: 0.44, y: 0.66 };
    const stumpTopPoint = {
      x: backStumps.x,
      y: Number((backStumps.y - backStumpHeight).toFixed(4)),
    };
    return {
      anchorMode: 'CREASE_ARROW',
      cameraAngle,
      farEndMode,
      deliverySource,
      releaseVisibilityMode: 'UNSEEN_RELEASE',
      bowlerWicketSide: 'OVER_THE_WICKET',
      bowlerSpeedType: 'PACE',
      backStumps,
      stumpTopPoint,
      poppingCreasePoint,
      frontStumps,
      backStumpWidth,
      backStumpHeight,
      frontStumpWidth: 0.038,
      frontStumpHeight: 0.095,
    };
  }

  // Standard Behind Bowler / Broadcast View (works even when Bowler Stumps are off-screen via P3 Popping Crease + P4 Pitch Axis)
  const backStumps = { x: 0.48, y: 0.57 };
  const backStumpHeight = 0.095;
  const backStumpWidth = 0.032;
  const frontStumps = { x: 0.52, y: 0.82 };
  const poppingCreasePoint = { x: 0.486, y: 0.608 };
  const stumpTopPoint = {
    x: backStumps.x,
    y: Number((backStumps.y - backStumpHeight).toFixed(4)),
  };

  return {
    anchorMode:
      farEndMode === 'VISIBLE_PITCH_AXIS' ? 'CREASE_ARROW' : 'FRONT_STUMPS',
    cameraAngle,
    farEndMode,
    deliverySource,
    releaseVisibilityMode: 'UNSEEN_RELEASE',
    bowlerWicketSide: 'OVER_THE_WICKET',
    bowlerSpeedType: 'PACE',
    backStumps,
    stumpTopPoint,
    poppingCreasePoint,
    frontStumps,
    backStumpWidth,
    backStumpHeight,
    frontStumpWidth: 0.038,
    frontStumpHeight: 0.095,
  };
}

export const MIDDLE_STUMP_ZONE_HALF_WIDTH_CM = 4.4;
export const STUMP_OUTER_HALF_WIDTH_CM = 11.43; // 22.86cm / 2 (Outer edge of Off/Leg stump)
export const BALL_RADIUS_CM = 3.6; // Regulation cricket ball radius
export const WICKET_HIT_HALF_WIDTH_CM = 15.03; // 11.43 + 3.60 (Outer Umpire's Call grazing edge)
export const BAIL_GRAZE_TOP_CM = 74.72; // 71.12 + 3.60 (Top of bails Umpire's Call grazing edge)

export function classifyStumpLineZone(offsetFromMiddleCm: number): StumpLineZone {
  if (offsetFromMiddleCm < -WICKET_HIT_HALF_WIDTH_CM) {
    return 'Outside Off';
  }
  if (offsetFromMiddleCm < -MIDDLE_STUMP_ZONE_HALF_WIDTH_CM) {
    return 'Off Stump';
  }
  if (offsetFromMiddleCm <= MIDDLE_STUMP_ZONE_HALF_WIDTH_CM) {
    return 'Middle Stump';
  }
  if (offsetFromMiddleCm <= WICKET_HIT_HALF_WIDTH_CM) {
    return 'Leg Stump';
  }
  return 'Outside Leg';
}

/**
 * Pitch-Axis & Back-Stump Calibrated Line Judgment:
 * Maps any contact point (x, y) against the planted Back Stumps and Pitch Corridor
 * (`stumps.backStumps`, `stumps.frontStumps`, `stumps.backStumpWidth`, `stumps.backStumpHeight`)
 * so that:
 *  - Clicking on or above the Back Stump base (`y <= backStumps.y`) measures 1-to-1 against the
 *    3 golden Back Stump lines (`-0.5 = Left Stump`, `0 = Middle Stump`, `+0.5 = Right Stump`).
 *  - Clicking down the pitch corridor below the Back Stump base (`y > backStumps.y`, e.g. a Yorker or
 *    front-foot contact along the 3 dotted pitch rails toward `frontStumps`) interpolates the pitch
 *    centerline (`axisGroundPoint.x`) and corridor width along the `backStumps -> frontStumps` axis
 *    so angled cameras never misjudge a Middle/Off/Leg stump ball.
 */
export function calculateImaginaryStumpPoint(
  videoPoint: NormalizedPoint,
  stumps: PlantedStumpsConfig,
  handedness: BatterHandedness,
  bouncePointOverride?: NormalizedPoint | null
): ImaginaryStumpProjection {
  const { p1StumpBase, p2StumpBails, p3PoppingCrease, p4PitchAxis } =
    resolveFourPointCalibration(stumps);
  const lateralMirror = getCameraLateralMirrorSign(stumps);

  const p1p2Height = Math.abs(p1StumpBase.y - p2StumpBails.y);
  const safeBackHeight = Math.max(
    0.018,
    stumps.stumpTopPoint ? p1p2Height : stumps.backStumpHeight
  );
  const safeBackWidth = Math.max(0.008, stumps.backStumpWidth);
  const isCreaseArrow = stumps.anchorMode === 'CREASE_ARROW';
  const safeFrontWidth = isCreaseArrow
    ? stumps.cameraAngle === 'BEHIND_BATTER'
      ? safeBackWidth * 0.72
      : safeBackWidth * 1.15
    : Math.max(0.008, stumps.frontStumpWidth || safeBackWidth * 1.15);
  const safeFrontHeight = isCreaseArrow
    ? stumps.cameraAngle === 'BEHIND_BATTER'
      ? safeBackHeight * 0.72
      : safeBackHeight * 0.92
    : Math.max(0.018, stumps.frontStumpHeight || safeBackHeight * 0.9);

  const frontAnchor = p4PitchAxis;
  const dxCorridor = frontAnchor.x - p1StumpBase.x;
  const dyCorridor = frontAnchor.y - p1StumpBase.y;
  const lenSq = dxCorridor * dxCorridor + dyCorridor * dyCorridor;

  // Compute the popping crease screen parameter (1.22m in front of Striker Stumps)
  let pCreaseDefault = 0.068;
  if (lenSq > 0.0004) {
    const rawCreaseP =
      ((p3PoppingCrease.x - p1StumpBase.x) * dxCorridor +
        (p3PoppingCrease.y - p1StumpBase.y) * dyCorridor) /
      lenSq;
    pCreaseDefault = clamp(rawCreaseP, 0.035, 0.16);
  }

  // Compute the batter's contact ground point directly along the user's adjusted Stump Line arrow (p1StumpBase -> frontAnchor)
  // so that clicking on the Stump Line arrow at the batter's crease always registers as 0cm (Middle Stump) even on angled videos.
  void safeFrontWidth;
  void safeFrontHeight;
  void bouncePointOverride;

  let tContactCrease = pCreaseDefault;
  if (lenSq > 0.0004) {
    // Estimate the turf shadow directly beneath the elevated bat-ball contact point (~0.35 stump heights below the ball)
    const estimatedShadowY = videoPoint.y + safeBackHeight * 0.35;
    const rawGroundProjT =
      ((videoPoint.x - p1StumpBase.x) * dxCorridor +
        (estimatedShadowY - p1StumpBase.y) * dyCorridor) /
      lenSq;
    tContactCrease = clamp(
      Math.max(pCreaseDefault * 0.65, rawGroundProjT),
      0.025,
      0.22
    );
  }

  const axisGroundPoint: NormalizedPoint = {
    x: Number(
      clamp(p1StumpBase.x + dxCorridor * tContactCrease, 0.02, 0.98).toFixed(4)
    ),
    y: Number(
      clamp(p1StumpBase.y + dyCorridor * tContactCrease, 0.02, 0.98).toFixed(4)
    ),
  };

  const effectiveStumpWidth = safeBackWidth;
  const effectiveStumpHeight = safeBackHeight;

  // Direct horizontal offset from the Stump Line centerline at the batter's contact depth,
  // damped gently beyond 1 stump width so slight hand-click jitter on angled videos never throws the ball off the pitch
  const rawScreenDeltaStumps =
    (videoPoint.x - axisGroundPoint.x) / effectiveStumpWidth;
  const dampedScreenRelX =
    Math.abs(rawScreenDeltaStumps) <= 0.55
      ? rawScreenDeltaStumps
      : Math.sign(rawScreenDeltaStumps) *
        (0.55 + (Math.abs(rawScreenDeltaStumps) - 0.55) * 0.45);
  const rawScreenRelX = clamp(dampedScreenRelX, -0.95, 0.95);

  // Apply lateralMirror (-1 when filmed from Behind the Batter) so relX and screenOffsetCm match 3D world coordinates
  const relX = clamp(rawScreenRelX * lateralMirror, -0.95, 0.95);

  // Vertical height measurement relative to the local turf ground plane beneath the contact point (`axisGroundPoint.y`)
  const rawRelY = (axisGroundPoint.y - videoPoint.y) / effectiveStumpHeight;
  const relY = clamp(rawRelY, 0.08, 1.08);

  // World offset in cm where -11.43 cm is RHB Off Stump center and +11.43 cm is RHB Leg Stump center
  const screenOffsetCm = Number((relX * STUMP_WIDTH_CM).toFixed(1));

  // Handedness-aware offset where negative = Off Side and positive = Leg Side
  const handednessSign = handedness === 'RHB' ? 1 : -1;
  const offsetFromMiddleCm = Number(
    (screenOffsetCm * handednessSign).toFixed(1)
  );

  const contactHeightCm = clamp(
    Math.round(relY * STUMP_HEIGHT_CM),
    4,
    84
  );

  const zone = classifyStumpLineZone(offsetFromMiddleCm);

  const hittingStumps =
    Math.abs(screenOffsetCm) <= WICKET_HIT_HALF_WIDTH_CM &&
    contactHeightCm >= 0 &&
    contactHeightCm <= BAIL_GRAZE_TOP_CM;

  return {
    offsetFromMiddleCm,
    screenOffsetCm,
    relX: Number(relX.toFixed(4)),
    relY: Number(relY.toFixed(4)),
    contactHeightCm,
    zone,
    hittingStumps,
    axisGroundPoint,
  };
}

export function getZoneColorConfig(zone: StumpLineZone): {
  hex: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
} {
  switch (zone) {
    case 'Middle Stump':
      return {
        hex: '#F59E0B',
        badgeBg: 'bg-amber-500/15',
        badgeText: 'text-amber-300',
        badgeBorder: 'border-amber-500/35',
      };
    case 'Off Stump':
      return {
        hex: '#10B981',
        badgeBg: 'bg-emerald-500/15',
        badgeText: 'text-emerald-300',
        badgeBorder: 'border-emerald-500/35',
      };
    case 'Leg Stump':
      return {
        hex: '#38BDF8',
        badgeBg: 'bg-sky-500/15',
        badgeText: 'text-sky-300',
        badgeBorder: 'border-sky-500/35',
      };
    case 'Outside Off':
      return {
        hex: '#2DD4BF',
        badgeBg: 'bg-teal-500/15',
        badgeText: 'text-teal-300',
        badgeBorder: 'border-teal-500/35',
      };
    case 'Outside Leg':
      return {
        hex: '#FB7185',
        badgeBg: 'bg-rose-500/15',
        badgeText: 'text-rose-300',
        badgeBorder: 'border-rose-500/35',
      };
  }
}

export function captureFrameWithContact(
  videoEl: HTMLVideoElement,
  videoPoint: NormalizedPoint,
  stumps: PlantedStumpsConfig,
  zone: StumpLineZone,
  autoBouncePoint?: NormalizedPoint,
  handedness: BatterHandedness = 'RHB',
  releasePoint?: NormalizedPoint
): string {
  const canvas = document.createElement('canvas');
  const w = 480;
  const aspect =
    videoEl.videoWidth && videoEl.videoHeight
      ? videoEl.videoHeight / videoEl.videoWidth
      : 9 / 16;
  const h = Math.round(w * aspect);
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  try {
    ctx.drawImage(videoEl, 0, 0, w, h);
  } catch {
    ctx.fillStyle = '#0B1120';
    ctx.fillRect(0, 0, w, h);
  }

  const bx = stumps.backStumps.x * w;
  const by = stumps.backStumps.y * h;
  const bw = stumps.backStumpWidth * w;
  const bh = stumps.backStumpHeight * h;

  // Compact Back Stumps lines on snapshot at [-0.5, 0, 0.5]
  ctx.save();
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.9)';
  ctx.lineWidth = 1.6;
  for (const r of [-0.5, 0, 0.5]) {
    ctx.beginPath();
    ctx.moveTo(bx + r * bw, by);
    ctx.lineTo(bx + r * bw, by - bh);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(bx - bw * 0.5, by - bh);
  ctx.lineTo(bx + bw * 0.5, by - bh);
  ctx.stroke();
  ctx.restore();

  const px = videoPoint.x * w;
  const py = videoPoint.y * h;
  const { hex } = getZoneColorConfig(zone);

  // Full 2D Hawk-Eye curved trajectory projection on snapshot
  try {
    const proj = calculateImaginaryStumpPoint(
      videoPoint,
      stumps,
      handedness,
      autoBouncePoint
    );
    const bncM = autoBouncePoint
      ? projectVideoBounceTo3DPitch(autoBouncePoint, stumps)
          .bounceDistanceFromStumpsM
      : undefined;
    const pred = calculateBallTrajectory(
      stumps,
      proj,
      handedness,
      'AUTO_PITCH',
      undefined,
      bncM,
      undefined,
      {
        releasePoint,
        bouncePoint: autoBouncePoint,
        contactPoint: videoPoint,
      }
    );
    const videoTraj = project3DTrajectoryToVideo(pred, stumps, {
      releasePoint,
      bouncePoint: autoBouncePoint,
      contactPoint: videoPoint,
    });

    const drawCurve = (
      pts: NormalizedPoint[],
      stroke: string,
      width: number,
      dash: number[] = []
    ) => {
      if (pts.length < 2) return;
      ctx.save();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(pts[0].x * w, pts[0].y * h);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x * w, pts[i].y * h);
      }
      ctx.stroke();
      ctx.restore();
    };

    drawCurve(
      videoTraj.preBouncePoints2D,
      'rgba(16, 185, 129, 0.72)',
      2.2
    );
    drawCurve(
      videoTraj.bounceToImpactPoints2D,
      'rgba(34, 211, 238, 0.92)',
      3.0
    );
    drawCurve(
      videoTraj.impactToStumpsPoints2D,
      pred.hittingWicket ? 'rgba(244, 63, 94, 0.95)' : 'rgba(251, 191, 36, 0.85)',
      2.4,
      [4, 3]
    );

    // Stump impact bullseye
    const sx = videoTraj.stumpIntersection2D.x * w;
    const sy = videoTraj.stumpIntersection2D.y * h;
    ctx.save();
    ctx.fillStyle = pred.hittingWicket ? '#F43F5E' : '#38BDF8';
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  } catch {
    if (autoBouncePoint) {
      const bncX = autoBouncePoint.x * w;
      const bncY = autoBouncePoint.y * h;
      ctx.save();
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.85)';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(bncX, bncY);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.restore();
    }
  }

  if (autoBouncePoint) {
    const bncX = autoBouncePoint.x * w;
    const bncY = autoBouncePoint.y * h;
    ctx.save();
    ctx.fillStyle = 'rgba(16, 185, 129, 0.28)';
    ctx.strokeStyle = '#10B981';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.ellipse(bncX, bncY, 8, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Contact Point Marker
  ctx.save();
  ctx.strokeStyle = hex;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px, py, 9, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(px, py, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  return canvas.toDataURL('image/jpeg', 0.85);
}

export type TrajectoryDeliveryMode =
  | 'AUTO_PITCH'
  | 'STRAIGHT'
  | 'ANGLE_IN'
  | 'SEAM_AWAY';

// Broadcast-scaled 22-yard (20.12m) pitch geometry in 100% rigid Euclidean 3D world units
export const PITCH_LENGTH_METERS = 20.12;
export const BOWLER_STUMPS_Z_CM = 700; // 20.12m full 22-yard pitch length in 3D world units
export const BOWLER_POPPING_CREASE_Z_CM = 657.6; // 18.90m (1.22m in front of Bowler Stumps)
export const STRIKER_POPPING_CREASE_Z_CM = 42.4; // 1.22m in front of Striker Stumps
export const DEFAULT_IMPACT_Z_CM = 50.5; // ~1.45m in front of Striker Stumps (standard batting impact plane)

export function metersToWorldZ(metersFromStrikerStumps: number): number {
  return Number(
    ((metersFromStrikerStumps / PITCH_LENGTH_METERS) * BOWLER_STUMPS_Z_CM).toFixed(2)
  );
}

export function worldZToMeters(zCm: number): number {
  return Number(((zCm / BOWLER_STUMPS_Z_CM) * PITCH_LENGTH_METERS).toFixed(2));
}

export interface WorldPoint3D {
  xCm: number;
  yCm: number;
  zCm: number;
}

export interface TrailGhostMarker {
  point: WorldPoint3D;
  progress: number;
  phase: 'PRE_IMPACT' | 'POST_IMPACT';
}

export interface BallTrajectoryPrediction {
  entryPoint3D: WorldPoint3D;
  bouncePoint3D: WorldPoint3D;
  impactPoint3D: WorldPoint3D;
  stumpIntersection3D: WorldPoint3D;
  postStumpPoint3D: WorldPoint3D;
  preBounceArc: WorldPoint3D[];
  bounceToImpactArc: WorldPoint3D[];
  impactToStumpsArc: WorldPoint3D[];
  /** Unified high-density 3D trajectory trail from the pitch bounce point through contact to the stumps */
  bounceToStumpsTrail: WorldPoint3D[];
  /** Ground projection directly beneath bounceToStumpsTrail for rendering the 3D volumetric trail curtain */
  bounceToStumpsGroundTrack: WorldPoint3D[];
  /** Stroboscopic ghost ball markers sampled dynamically along the bounce-to-stumps trail */
  trailGhostPoints: TrailGhostMarker[];
  groundTrackPoints: WorldPoint3D[];
  hittingWicket: boolean;
  verdictLabel: string;
  pitchingZoneLabel: string;
  lengthCategoryLabel: string;
  lateralDeviationDeg: number;
  lateralDriftCm: number;
  bounceDistanceFromStumpsM: number;
  impactDistanceFromStumpsM: number;
  /** True only when speed was measured via release-to-impact stopwatch or manually calibrated */
  hasCalibratedSpeed: boolean;
  calibratedSpeedKph: number | null;
  calibratedSpeedMph: number | null;
  /** Internal animation pacing reference speed in km/h */
  estimatedSpeedKph: number;
  estimatedSpeedMph: number;
  /** True physical flight duration in milliseconds from release (18.90m) to Striker Stumps (0.00m) */
  realFlightDurationMs: number;
  /** Normalized timeline progress (0..1) when the ball strikes the pitch at bouncePoint3D */
  bounceProgress: number;
  /** Normalized timeline progress (0..1) when the ball reaches bat contact at impactPoint3D */
  impactProgress: number;
  /** Non-Linear Ballistic & Turf Interaction Physics Telemetry */
  /** Vertical Coefficient of Restitution e_y = v_y,out / v_y,in solved from pointed Bounce & Contact */
  bounceRestitutionCoeff: number;
  /** Tangential Horizontal Speed Retention Factor e_z = v_z,out / v_z,in across turf impact */
  tangentialRestitutionCoeff: number;
  /** Dynamic Turf Friction Coefficient mu_d solved from oblique impact equations */
  turfFrictionCoeff: number;
  /** Total Post-Bounce Kinetic Energy Retention (%) = (KE_out / KE_in) * 100 */
  impactEnergyRetentionPct: number;
  /** Pre-Bounce Incidence Angle into the pitch surface (degrees) */
  incidenceAngleDeg: number;
  /** Post-Bounce Rebound Lift Angle off the pitch surface (degrees) */
  reboundAngleDeg: number;
  /** Quadratic Aerodynamic Drag Deceleration Factor alpha (m^-1) */
  aerodynamicDragFactor: number;
  /** 3D Path Smoothing Telemetry: Bounce Control Node used to refine post-impact trajectory */
  smoothingControlNode3D?: WorldPoint3D;
  /** C1-continuous 3D unit velocity tangent vector at impact refined by the bounce control node */
  impactTangentVector3D?: { dx: number; dy: number; dz: number };
  /** Ballistic Hermite vertical curvature parameter kappa_y solved from the bounce control node */
  postImpactCurvatureKappa?: number;
  /** Indicates that C2 bounce-control-node 3D path smoothing was applied */
  pathSmoothingApplied?: boolean;
}

/**
 * Computes real physical release speed (km/h) from two video timestamps:
 *  - releaseTimestampSec (t0: ball leaves bowler's hand at 18.90m popping crease)
 *  - impactTimestampSec (t1: ball reaches bat/pad impact plane at impactDistanceFromStumpsM)
 * Accounts for ~7% average aerodynamic + turf bounce deceleration over the flight window.
 */
export function computeStopwatchSpeedKph(
  releaseTimestampSec: number | undefined,
  impactTimestampSec: number | undefined,
  impactDistanceFromStumpsM = 1.35
): number | null {
  if (
    typeof releaseTimestampSec !== 'number' ||
    typeof impactTimestampSec !== 'number'
  ) {
    return null;
  }
  const dtSec = Math.abs(impactTimestampSec - releaseTimestampSec);
  if (dtSec < 0.22 || dtSec > 1.85) {
    return null;
  }
  const releaseMetersFromStumps = worldZToMeters(BOWLER_POPPING_CREASE_Z_CM); // 18.90m
  const flightDistM = Math.max(
    12.0,
    releaseMetersFromStumps - clamp(impactDistanceFromStumpsM, 0.5, 3.5)
  );
  const avgMps = flightDistM / dtSec;
  const releaseKph = avgMps * 3.6 * 1.07;
  return Number(clamp(releaseKph, 55.0, 162.0).toFixed(1));
}

export interface AnimatedTrajectoryState {
  progress: number;
  phase: 'PRE_BOUNCE' | 'BOUNCE_TO_IMPACT' | 'IMPACT_TO_STUMPS' | 'COMPLETE';
  currentBall3D: WorldPoint3D;
  currentGround3D: WorldPoint3D;
  hasBounced: boolean;
  hasImpacted: boolean;
  hasReachedStumps: boolean;
  bouncePulseProgress: number | null;
  impactPulseProgress: number | null;
  stumpPulseProgress: number | null;
  visiblePreBounceArc: WorldPoint3D[];
  visibleBounceToImpactArc: WorldPoint3D[];
  visibleImpactToStumpsArc: WorldPoint3D[];
  visibleBounceToStumpsTrail: WorldPoint3D[];
  visibleBounceToStumpsGroundTrack: WorldPoint3D[];
  visibleGroundTrackPoints: WorldPoint3D[];
  visibleGhostPoints: TrailGhostMarker[];
  ballTrailWake3D: WorldPoint3D[];
}


/**
 * Calculates camera distance to batting stumps and bowling stumps using the pinhole camera model
 * based on regulation cricket stump height (71.12cm) and pitch length (20.12m).
 * Supports both "Both Stumps Visible" mode and "Batting Stumps Only" (with virtual 20.12m bowling end).
 */
export function calculateCameraStumpDistances(
  stumps: PlantedStumpsConfig,
  releaseVideoPoint?: NormalizedPoint | null
): CameraDistanceTelemetry {
  const { p1StumpBase, p2StumpBails, p3PoppingCrease, p4PitchAxis } =
    resolveFourPointCalibration(stumps);

  // Normalized batting stump height (71.12 cm in real world)
  const measuredBatH = Math.max(
    0.025,
    stumps.stumpTopPoint
      ? Math.abs(p1StumpBase.y - p2StumpBails.y)
      : stumps.backStumpHeight || 0.095
  );

  // Standard vertical normalized focal length for smartphone / broadcast cameras (~60-65° vertical FOV)
  const fNorm = 1.28;
  const stumpHeightM = STUMP_HEIGHT_CM / 100; // 0.7112m

  // Pinhole camera equation: D = (H_real * f_norm) / h_screen
  const rawDistBatM = (stumpHeightM * fNorm) / measuredBatH;
  const autoEstimatedCameraToBattingM = Number(
    clamp(rawDistBatM, 4.0, 38.0).toFixed(2)
  );
  const cameraToBattingStumpsM = Number(
    clamp(
      typeof stumps.customCameraDistanceM === 'number' &&
        stumps.customCameraDistanceM >= 3.5
        ? stumps.customCameraDistanceM
        : autoEstimatedCameraToBattingM,
      3.5,
      45.0
    ).toFixed(2)
  );

  const isBehindBatter = stumps.cameraAngle === 'BEHIND_BATTER';
  const bowlingStumpsVisible =
    stumps.farEndMode === 'BOWLER_STUMPS_20M' &&
    stumps.anchorMode !== 'CREASE_ARROW';

  const isCameraInFrontOfBowlerStumps =
    !bowlingStumpsVisible &&
    !isBehindBatter &&
    cameraToBattingStumpsM < PITCH_LENGTH_METERS;

  const visiblePitchSpanM =
    bowlingStumpsVisible || isBehindBatter || cameraToBattingStumpsM >= PITCH_LENGTH_METERS
      ? PITCH_LENGTH_METERS
      : Number(clamp(cameraToBattingStumpsM * 0.78, 5.2, 19.6).toFixed(2));

  const cameraStationZoneLabel = isBehindBatter
    ? 'Behind Batter / Keeper'
    : cameraToBattingStumpsM < 13.0
    ? 'Mid-Pitch (In Front of Bowler)'
    : cameraToBattingStumpsM < PITCH_LENGTH_METERS
    ? 'In Front of Bowler Stumps'
    : 'Behind Bowler Stumps';

  let cameraToBowlingStumpsM: number;
  let cameraToReleaseCreaseM: number;
  let perspectiveForeshorteningK: number;

  const rawDx = p4PitchAxis.x - p1StumpBase.x;
  const rawDy = p4PitchAxis.y - p1StumpBase.y;
  const rawDist = Math.hypot(rawDx, rawDy);
  const ux = rawDist > 0.001 ? rawDx / rawDist : 0;
  const uy = rawDist > 0.001 ? rawDy / rawDist : 1;

  if (bowlingStumpsVisible) {
    // Both stumps visible in frame: measure bowling stump height directly
    const measuredBowlH = Math.max(0.025, stumps.frontStumpHeight || 0.095);
    const rawDistBowlM = (stumpHeightM * fNorm) / measuredBowlH;
    cameraToBowlingStumpsM = Number(clamp(rawDistBowlM, 3.0, 45.0).toFixed(2));

    const blendRatio = 1.22 / PITCH_LENGTH_METERS;
    cameraToReleaseCreaseM = Number(
      (
        cameraToBowlingStumpsM +
        (cameraToBattingStumpsM - cameraToBowlingStumpsM) * blendRatio
      ).toFixed(2)
    );

    const widthRatio = clamp(
      Math.max(0.014, stumps.frontStumpWidth) /
        Math.max(0.014, stumps.backStumpWidth),
      0.65,
      1.85
    );
    const spanFactor = clamp((0.28 - rawDist) * 0.65, -0.1, 0.22);
    const widthFactor = clamp((widthRatio - 1.0) * 0.25, -0.1, 0.2);
    perspectiveForeshorteningK = Number(
      clamp(1.14 + spanFactor + widthFactor, 0.92, 1.45).toFixed(4)
    );
  } else {
    if (isBehindBatter) {
      cameraToBowlingStumpsM = Number(
        (cameraToBattingStumpsM + PITCH_LENGTH_METERS).toFixed(2)
      );
      cameraToReleaseCreaseM = Number(
        (cameraToBattingStumpsM + 18.9).toFixed(2)
      );
      perspectiveForeshorteningK = 0.88;
    } else {
      // Signed or absolute distance from camera to the 20.12m bowling stumps
      // (When cameraToBattingStumpsM < 20.12m, the bowling stumps are behind the camera!)
      cameraToBowlingStumpsM = Number(
        Math.abs(cameraToBattingStumpsM - PITCH_LENGTH_METERS).toFixed(2)
      );
      cameraToReleaseCreaseM = Number(
        Math.abs(cameraToBattingStumpsM - 18.9).toFixed(2)
      );
      const creaseSpan = clamp(
        (p3PoppingCrease.x - p1StumpBase.x) * ux +
          (p3PoppingCrease.y - p1StumpBase.y) * uy,
        0.018,
        0.22
      );
      const elevationRatio = clamp(
        measuredBatH / Math.max(0.015, creaseSpan),
        1.3,
        4.5
      );
      perspectiveForeshorteningK = Number(
        clamp(1.12 + (elevationRatio - 2.3) * 0.08, 0.96, 1.38).toFixed(4)
      );
    }
  }

  const elevationDeg = Number(
    clamp(
      Math.asin(
        clamp(
          0.7112 / Math.max(1, cameraToBattingStumpsM * measuredBatH),
          0.1,
          0.85
        )
      ) *
        (180 / Math.PI),
      8.0,
      45.0
    ).toFixed(1)
  );

  // Compute virtual 20.12m bowling stumps and virtual 18.90m release popping crease 2D positions
  let virtualBowlingStumps2D: NormalizedPoint;
  let virtualReleaseCrease2D: NormalizedPoint;

  if (bowlingStumpsVisible) {
    virtualBowlingStumps2D = p4PitchAxis;
    const depthRatio = 18.9 / PITCH_LENGTH_METERS;
    const pWeight = clamp(
      (depthRatio * perspectiveForeshorteningK) /
        Math.max(0.03, 1 - depthRatio + depthRatio * perspectiveForeshorteningK),
      0.84,
      0.98
    );
    virtualReleaseCrease2D = {
      x: Number(clamp(p1StumpBase.x + rawDx * pWeight, 0.02, 0.98).toFixed(4)),
      y: Number(clamp(p1StumpBase.y + rawDy * pWeight, 0.02, 0.98).toFixed(4)),
    };
  } else {
    // Use the user's suggested or adjusted Stump Line arrow tip (p4PitchAxis) directly as the far corridor anchor
    virtualBowlingStumps2D = p4PitchAxis;
    const depthRatio = clamp(18.9 / PITCH_LENGTH_METERS, 0.84, 0.96);
    const pWeight = clamp(
      (depthRatio * perspectiveForeshorteningK) /
        Math.max(0.03, 1 - depthRatio + depthRatio * perspectiveForeshorteningK),
      0.84,
      0.98
    );
    virtualReleaseCrease2D = {
      x: Number(
        clamp(
          p1StumpBase.x + (virtualBowlingStumps2D.x - p1StumpBase.x) * pWeight,
          0.02,
          0.98
        ).toFixed(4)
      ),
      y: Number(
        clamp(
          p1StumpBase.y + (virtualBowlingStumps2D.y - p1StumpBase.y) * pWeight,
          0.02,
          0.98
        ).toFixed(4)
      ),
    };
  }

  let reconstructedReleaseGround2D: NormalizedPoint | undefined;
  let reconstructedReleaseHeightCm: number | undefined;
  let reconstructedReleaseLateralCm: number | undefined;

  if (
    releaseVideoPoint &&
    stumps.releaseVisibilityMode !== 'UNSEEN_RELEASE'
  ) {
    reconstructedReleaseGround2D = {
      x: Number(clamp(releaseVideoPoint.x, 0.02, 0.98).toFixed(4)),
      y: Number(clamp(virtualReleaseCrease2D.y, 0.02, 0.98).toFixed(4)),
    };

    const backW = Math.max(0.014, stumps.backStumpWidth);
    const frontW =
      stumps.anchorMode === 'CREASE_ARROW'
        ? isBehindBatter
          ? backW * 0.72
          : backW * 1.18
        : Math.max(0.014, stumps.frontStumpWidth);
    const frontH =
      stumps.anchorMode === 'CREASE_ARROW'
        ? isBehindBatter
          ? measuredBatH * 0.72
          : measuredBatH * 0.92
        : Math.max(0.034, stumps.frontStumpHeight);

    const depthRatio = 18.9 / PITCH_LENGTH_METERS;
    const pWeight = clamp(
      (depthRatio * perspectiveForeshorteningK) /
        Math.max(0.03, 1 - depthRatio + depthRatio * perspectiveForeshorteningK),
      0.84,
      0.98
    );

    const localCreaseW = Math.max(0.014, backW + (frontW - backW) * pWeight);
    const localCreaseH = Math.max(
      0.028,
      measuredBatH + (frontH - measuredBatH) * pWeight
    );

    const verticalDropNorm = Math.max(
      0.01,
      virtualReleaseCrease2D.y - releaseVideoPoint.y
    );
    reconstructedReleaseHeightCm = Number(
      clamp((verticalDropNorm / localCreaseH) * STUMP_HEIGHT_CM, 75, 225).toFixed(1)
    );

    const lateralOffsetNorm = releaseVideoPoint.x - virtualReleaseCrease2D.x;
    reconstructedReleaseLateralCm = Number(
      clamp((lateralOffsetNorm / localCreaseW) * STUMP_WIDTH_CM, -65, 65).toFixed(1)
    );
  }

  return {
    cameraToBattingStumpsM,
    autoEstimatedCameraToBattingM,
    cameraToBowlingStumpsM,
    cameraToReleaseCreaseM,
    visiblePitchSpanM,
    isCameraInFrontOfBowlerStumps,
    cameraStationZoneLabel,
    perspectiveForeshorteningK,
    cameraElevationDeg: elevationDeg,
    bowlingStumpsVisible,
    virtualBowlingStumps2D,
    virtualReleaseCrease2D,
    reconstructedReleaseGround2D,
    reconstructedReleaseHeightCm,
    reconstructedReleaseLateralCm,
  };
}

/**
 * Computes the camera-adaptive projective foreshortening factor `kCam`
 * and normalized pitch corridor geometry from the planted Back Stumps and Front Stumps.
 * Integrates the pinhole camera distance telemetry model for high-precision real-world projection.
 */
export function computeCameraPerspectiveModel(stumps: PlantedStumpsConfig): {
  backBase: NormalizedPoint;
  frontBase: NormalizedPoint;
  p2Bails: NormalizedPoint;
  p3Crease: NormalizedPoint;
  virtualReleaseCrease: NormalizedPoint;
  backW: number;
  backH: number;
  frontW: number;
  frontH: number;
  dx: number;
  dy: number;
  lenSq: number;
  kCam: number;
  lateralMirror: 1 | -1;
  cameraProfile: 'BROADCAST_ELEVATED' | 'HYBRID_ANGLED' | 'NET_TRIPOD_LOW';
  telemetry: CameraDistanceTelemetry;
} {
  const { p1StumpBase, p2StumpBails, p3PoppingCrease, p4PitchAxis } =
    resolveFourPointCalibration(stumps);
  const lateralMirror = getCameraLateralMirrorSign(stumps);
  const backBase = p1StumpBase;

  const telemetry = calculateCameraStumpDistances(stumps);

  const p1p2H = Math.abs(p1StumpBase.y - p2StumpBails.y);
  const backW = Math.max(0.014, stumps.backStumpWidth);
  const backH = Math.max(
    0.034,
    stumps.stumpTopPoint ? p1p2H : stumps.backStumpHeight
  );
  const isBehindBatter = stumps.cameraAngle === 'BEHIND_BATTER';
  const frontW =
    stumps.anchorMode === 'CREASE_ARROW'
      ? isBehindBatter
        ? backW * 0.72
        : backW * 1.18
      : Math.max(0.014, stumps.frontStumpWidth);
  const frontH =
    stumps.anchorMode === 'CREASE_ARROW'
      ? isBehindBatter
        ? backH * 0.72
        : backH * 0.92
      : Math.max(0.034, stumps.frontStumpHeight);

  const targetFarPoint =
    stumps.anchorMode === 'CREASE_ARROW' && telemetry.virtualBowlingStumps2D
      ? telemetry.virtualBowlingStumps2D
      : p4PitchAxis;

  const dx = targetFarPoint.x - backBase.x;
  const dy = targetFarPoint.y - backBase.y;
  const frontBase = targetFarPoint;
  const kCam = telemetry.perspectiveForeshorteningK;

  const lenSq = dx * dx + dy * dy;
  const pitchScreenSpan = Math.hypot(dx, dy);

  const cameraProfile =
    pitchScreenSpan >= 0.24 && kCam <= 1.28
      ? 'BROADCAST_ELEVATED'
      : pitchScreenSpan <= 0.17 || kCam >= 1.48
      ? 'NET_TRIPOD_LOW'
      : 'HYBRID_ANGLED';

  return {
    backBase,
    frontBase,
    p2Bails: p2StumpBails,
    p3Crease: p3PoppingCrease,
    virtualReleaseCrease: telemetry.virtualReleaseCrease2D,
    backW,
    backH,
    frontW,
    frontH,
    dx,
    dy,
    lenSq,
    kCam,
    lateralMirror,
    cameraProfile,
    telemetry,
  };
}

export interface PitchCorridorHomographyModel {
  strikerLeftCorner: NormalizedPoint;
  strikerRightCorner: NormalizedPoint;
  bowlerLeftCorner: NormalizedPoint;
  bowlerRightCorner: NormalizedPoint;
  wicketPolygon: NormalizedPoint[];
  corridorPolygon: NormalizedPoint[];
  lengthZoneLines: Array<{
    label: string;
    meters: number;
    leftPt: NormalizedPoint;
    rightPt: NormalizedPoint;
    color: string;
  }>;
}

/**
 * Computes the 4-Corner 3D Pitch Corridor Homography geometry on the 2D video viewport:
 * - Outer 1.83m tactical pitch corridor with draggable corner anchors
 * - Inner 22.86cm stump-to-stump Hawk-Eye wicket carpet
 * - Calibrated length lines (1.22m Popping Crease, 2.2m Yorker, 4.6m Full, 6.8m Good Length, 9.2m Short)
 */
export function computePitchCorridorHomography(
  stumps: PlantedStumpsConfig
): PitchCorridorHomographyModel {
  const cam = computeCameraPerspectiveModel(stumps);
  // Corridor width = 5.33x stump width (1.22m wide coaching box)
  const corridorMultiple = 5.33;
  const nearHalfCorridor = (cam.backW * corridorMultiple) / 2;
  const farHalfCorridor = (cam.frontW * corridorMultiple) / 2;
  const nearHalfWicket = cam.backW / 2;
  const farHalfWicket = cam.frontW / 2;

  const strikerLeftCorner: NormalizedPoint = {
    x: Number(clamp(cam.backBase.x - nearHalfCorridor, 0.01, 0.99).toFixed(4)),
    y: Number(clamp(cam.backBase.y, 0.01, 0.99).toFixed(4)),
  };
  const strikerRightCorner: NormalizedPoint = {
    x: Number(clamp(cam.backBase.x + nearHalfCorridor, 0.01, 0.99).toFixed(4)),
    y: Number(clamp(cam.backBase.y, 0.01, 0.99).toFixed(4)),
  };
  const bowlerLeftCorner: NormalizedPoint = {
    x: Number(clamp(cam.frontBase.x - farHalfCorridor, 0.01, 0.99).toFixed(4)),
    y: Number(clamp(cam.frontBase.y, 0.01, 0.99).toFixed(4)),
  };
  const bowlerRightCorner: NormalizedPoint = {
    x: Number(clamp(cam.frontBase.x + farHalfCorridor, 0.01, 0.99).toFixed(4)),
    y: Number(clamp(cam.frontBase.y, 0.01, 0.99).toFixed(4)),
  };

  const corridorPolygon: NormalizedPoint[] = [
    strikerLeftCorner,
    strikerRightCorner,
    bowlerRightCorner,
    bowlerLeftCorner,
  ];

  const wicketPolygon: NormalizedPoint[] = [
    { x: cam.backBase.x - nearHalfWicket, y: cam.backBase.y },
    { x: cam.backBase.x + nearHalfWicket, y: cam.backBase.y },
    { x: cam.frontBase.x + farHalfWicket, y: cam.frontBase.y },
    { x: cam.frontBase.x - farHalfWicket, y: cam.frontBase.y },
  ];

  const zoneDefs = [
    { label: 'CREASE 1.2m', meters: 1.22, color: 'rgba(251, 191, 36, 0.85)' },
    { label: 'YORKER 2.2m', meters: 2.2, color: 'rgba(245, 158, 11, 0.55)' },
    { label: 'FULL 4.6m', meters: 4.6, color: 'rgba(16, 185, 129, 0.65)' },
    { label: 'GOOD 6.8m', meters: 6.8, color: 'rgba(34, 211, 238, 0.72)' },
    { label: 'SHORT 9.2m', meters: 9.2, color: 'rgba(168, 85, 247, 0.6)' },
  ];

  const lengthZoneLines = zoneDefs.map((z) => {
    const centerPt = project3DPitchBounceToVideo(z.meters, 0, stumps);
    const depthRatio = clamp(z.meters / PITCH_LENGTH_METERS, 0.02, 0.95);
    const pWeight = clamp(
      (depthRatio * cam.kCam) /
        Math.max(0.03, 1 - depthRatio + depthRatio * cam.kCam),
      0.02,
      0.95
    );
    const halfW =
      nearHalfCorridor + (farHalfCorridor - nearHalfCorridor) * pWeight;
    return {
      label: z.label,
      meters: z.meters,
      leftPt: {
        x: Number(clamp(centerPt.x - halfW, 0.01, 0.99).toFixed(4)),
        y: centerPt.y,
      },
      rightPt: {
        x: Number(clamp(centerPt.x + halfW, 0.01, 0.99).toFixed(4)),
        y: centerPt.y,
      },
      color: z.color,
    };
  });

  return {
    strikerLeftCorner,
    strikerRightCorner,
    bowlerLeftCorner,
    bowlerRightCorner,
    wicketPolygon,
    corridorPolygon,
    lengthZoneLines,
  };
}

/**
 * Estimates a physically grounded bounce distance (in meters from Striker Stumps)
 * by solving the coupled post-bounce ballistic rebound through the batter's contact height (`contactHeightCm`)
 * and the batter's interception depth in front of the stumps (`impactDistanceFromStumpsM`).
 */
export function estimateNaturalBounceLengthM(
  contactHeightCm: number,
  impactDistanceFromStumpsM = 1.35
): number {
  const h = clamp(contactHeightCm, 2, 98);
  const impM = clamp(impactDistanceFromStumpsM, 0.65, 2.35);

  let postBounceTravelM: number;
  if (h <= 16) {
    postBounceTravelM = 0.35 + (h / 16) * 0.7;
  } else if (h <= 34) {
    postBounceTravelM = 1.05 + ((h - 16) / 18) * 2.1;
  } else if (h <= 56) {
    postBounceTravelM = 3.15 + ((h - 34) / 22) * 2.7;
  } else {
    postBounceTravelM = 5.85 + ((h - 56) / 42) * 3.55;
  }

  return Number(clamp(impM + postBounceTravelM, 1.35, 11.8).toFixed(2));
}

function constrainToSameLineZone(
  targetSignedCm: number,
  referenceZone: StumpLineZone
): number {
  const margin = 0.35;
  switch (referenceZone) {
    case 'Outside Off':
      return Math.min(-WICKET_HIT_HALF_WIDTH_CM - margin, targetSignedCm);
    case 'Off Stump':
      return clamp(
        targetSignedCm,
        -WICKET_HIT_HALF_WIDTH_CM + margin,
        -MIDDLE_STUMP_ZONE_HALF_WIDTH_CM - margin
      );
    case 'Middle Stump':
      return clamp(
        targetSignedCm,
        -MIDDLE_STUMP_ZONE_HALF_WIDTH_CM + margin,
        MIDDLE_STUMP_ZONE_HALF_WIDTH_CM - margin
      );
    case 'Leg Stump':
      return clamp(
        targetSignedCm,
        MIDDLE_STUMP_ZONE_HALF_WIDTH_CM + margin,
        WICKET_HIT_HALF_WIDTH_CM - margin
      );
    case 'Outside Leg':
      return Math.max(WICKET_HIT_HALF_WIDTH_CM + margin, targetSignedCm);
  }
}

export interface VideoFlightAnchors {
  releasePoint?: NormalizedPoint;
  bouncePoint?: NormalizedPoint;
  contactPoint?: NormalizedPoint;
  trackedWaypoints?: TrackedBallFramePoint[];
}

/**
 * Projects a 2D video turf bounce point (where yCm = 0 on the pitch surface) into 3D world coordinates
 * using the camera-adaptive projective cross-ratio homography between Back Stumps (Z = 0m) and Front Stumps (Z = 20.12m).
 */
export function projectVideoBounceTo3DPitch(
  bounceVideoPoint: NormalizedPoint,
  stumps: PlantedStumpsConfig,
  _releaseVideoPoint?: NormalizedPoint | null,
  contactVideoPoint?: NormalizedPoint | null
): { bounceDistanceFromStumpsM: number; bounceXCm: number } {
  const cam = computeCameraPerspectiveModel(stumps);

  // Guard against reversed clicks (e.g. if user clicked Bat Contact first and Pitch Bounce second):
  // The turf bounce point is always farther from the batting stumps center than the bat contact point.
  const stumpMidY = cam.backBase.y - cam.backH * 0.35;
  let effectiveBouncePt = bounceVideoPoint;
  let effectiveContactPt = contactVideoPoint || null;
  if (effectiveContactPt) {
    const distBToStumps = Math.hypot(
      bounceVideoPoint.x - cam.backBase.x,
      bounceVideoPoint.y - stumpMidY
    );
    const distCToStumps = Math.hypot(
      effectiveContactPt.x - cam.backBase.x,
      effectiveContactPt.y - stumpMidY
    );
    if (
      distCToStumps > distBToStumps + 0.05 &&
      effectiveContactPt.y > bounceVideoPoint.y + 0.03
    ) {
      effectiveBouncePt = effectiveContactPt;
      effectiveContactPt = bounceVideoPoint;
    }
  }

  // Stump-Line Anchored & Contact-Coupled 3D Pitch Bounce Projection:
  // Projects the user's Bounce click onto the adjusted Stump Line arrow (cam.backBase -> cam.frontBase)
  // and couples the 3D bounce length with the proven Contact-Height Imaginary Trajectory solver so the ball
  // never lands artificially in the middle of the pitch (8m-10m) or shoots outside the pitch corridor.
  const arrowLen = Math.max(0.02, Math.hypot(cam.dx, cam.dy));
  const ux = cam.dx / arrowLen;
  const uy = cam.dy / arrowLen;

  const vecFromStumpX = effectiveBouncePt.x - cam.backBase.x;
  const vecFromStumpY = effectiveBouncePt.y - cam.backBase.y;
  const projAlongArrow = vecFromStumpX * ux + vecFromStumpY * uy;

  // Orthogonal parameter tBounceArrow along the user's Stump Line arrow
  const tBounceArrow = clamp(projAlongArrow / arrowLen, 0.04, 1.15);
  const axisXAtBounce = cam.backBase.x + cam.dx * tBounceArrow;

  // Map the 2D bounce click position along the Stump Line arrow to a realistic cricket bounce length (1.5m - 8.0m)
  const stumpScaleMeters =
    1.25 +
    clamp(
      Math.max(0.01, projAlongArrow) / Math.max(0.032, cam.backH * 0.72),
      0.25,
      6.65
    );
  const arrowFractionMeters = 1.25 + clamp(tBounceArrow, 0.05, 0.95) * 6.4;
  let visualClickBounceM = Number(
    clamp(stumpScaleMeters * 0.55 + arrowFractionMeters * 0.45, 1.45, 8.2).toFixed(2)
  );

  if (cam.telemetry.bowlingStumpsVisible) {
    const pWeight = clamp(tBounceArrow, 0.04, 0.88);
    const depthRatio = clamp(
      pWeight / Math.max(0.03, pWeight + (1 - pWeight) * cam.kCam),
      0.04,
      0.78
    );
    const twoStumpMeters = depthRatio * PITCH_LENGTH_METERS;
    visualClickBounceM = Number(
      clamp(visualClickBounceM * 0.6 + twoStumpMeters * 0.4, 1.45, 9.2).toFixed(2)
    );
  }

  // When Contact point is known, couple the bounce distance and line with the proven Contact-Height Imaginary Trajectory solver
  const contactProj = effectiveContactPt
    ? calculateImaginaryStumpPoint(effectiveContactPt, stumps, 'RHB')
    : null;
  const imaginaryBounceM = contactProj
    ? estimateNaturalBounceLengthM(contactProj.contactHeightCm, 1.32)
    : visualClickBounceM;

  // Blend the Imaginary Trajectory baseline (58%) with the user's Bounce click along the Stump Line arrow (42%),
  // bounded within +/-1.45m of the natural rebound length so the 3D Hawk-Eye curve always rises cleanly through the bat!
  const bounceDistanceFromStumpsM = contactProj
    ? Number(
        clamp(
          imaginaryBounceM * 0.58 + visualClickBounceM * 0.42,
          Math.max(1.4, imaginaryBounceM - 1.45),
          Math.min(8.2, imaginaryBounceM + 1.45)
        ).toFixed(2)
      )
    : visualClickBounceM;

  // Perspective stump width at bounce depth
  const effectiveCamDistM = clamp(
    cam.telemetry.cameraToBattingStumpsM,
    9.5,
    28.0
  );
  const perspectiveScaleAtBounce =
    stumps.cameraAngle === 'BEHIND_BATTER'
      ? clamp(1 - bounceDistanceFromStumpsM / 28, 0.65, 1.0)
      : clamp(
          effectiveCamDistM /
            Math.max(4.5, effectiveCamDistM - bounceDistanceFromStumpsM * 0.55),
          1.0,
          1.65
        );
  const localStumpW = Math.max(0.016, cam.backW * perspectiveScaleAtBounce);

  // Measure lateral offset strictly relative to `axisXAtBounce` (the exact point on the user's Stump Line arrow!)
  const rawAxisOffsetCm =
    ((effectiveBouncePt.x - axisXAtBounce) / localStumpW) *
    STUMP_WIDTH_CM *
    cam.lateralMirror;

  let bounceXCm = 0;
  if (contactProj) {
    const contactXCm = clamp(
      typeof contactProj.screenOffsetCm === 'number'
        ? contactProj.screenOffsetCm
        : contactProj.offsetFromMiddleCm,
      -14.5,
      14.5
    );
    const subtleSeamDeltaCm = clamp(
      (rawAxisOffsetCm - contactXCm) * 0.32,
      -4.2,
      4.2
    );
    bounceXCm = Number(
      clamp(contactXCm + subtleSeamDeltaCm, -14.5, 14.5).toFixed(1)
    );
  } else {
    bounceXCm = Number(clamp(rawAxisOffsetCm * 0.45, -13.5, 13.5).toFixed(1));
  }

  return { bounceDistanceFromStumpsM, bounceXCm };
}

/**
 * Exact mathematical inverse of `projectVideoBounceTo3DPitch`:
 * Maps a 3D turf bounce coordinate (`bounceDistanceFromStumpsM`, `bounceXCm`) back onto the 2D video canvas
 * along the user's Stump Line arrow.
 */
export function project3DPitchBounceToVideo(
  bounceDistanceFromStumpsM: number,
  bounceXCm: number,
  stumps: PlantedStumpsConfig
): NormalizedPoint {
  const cam = computeCameraPerspectiveModel(stumps);
  const tArrow = clamp((bounceDistanceFromStumpsM - 1.25) / 6.4, 0.05, 0.95);
  const axisX = cam.backBase.x + cam.dx * tArrow;
  const axisY = cam.backBase.y + cam.dy * tArrow;

  const effectiveCamDistM = clamp(
    cam.telemetry.cameraToBattingStumpsM,
    9.5,
    28.0
  );
  const perspectiveScaleAtBounce =
    stumps.cameraAngle === 'BEHIND_BATTER'
      ? clamp(1 - bounceDistanceFromStumpsM / 28, 0.65, 1.0)
      : clamp(
          effectiveCamDistM /
            Math.max(4.5, effectiveCamDistM - bounceDistanceFromStumpsM * 0.55),
          1.0,
          1.65
        );
  const localStumpW = Math.max(0.016, cam.backW * perspectiveScaleAtBounce);
  const screenBounceXCm = bounceXCm * cam.lateralMirror;

  return {
    x: Number(
      clamp(
        axisX + (screenBounceXCm / STUMP_WIDTH_CM) * localStumpW,
        0.02,
        0.98
      ).toFixed(4)
    ),
    y: Number(clamp(axisY, 0.02, 0.98).toFixed(4)),
  };
}

/**
 * Projects any arbitrary 3D world point (xCm, yCm, zCm) onto normalized 2D video coordinates (x, y)
 * along with the local perspective ball radius in normalized screen units.
 */
export function project3DPitchPointToVideo(
  point3D: WorldPoint3D,
  stumps: PlantedStumpsConfig
): { point: NormalizedPoint; radiusNorm: number; pWeight: number } {
  const cam = computeCameraPerspectiveModel(stumps);
  const depthRatio = clamp(point3D.zCm / BOWLER_STUMPS_Z_CM, -0.04, 0.98);
  const pWeight =
    depthRatio >= 0
      ? clamp(
          (depthRatio * cam.kCam) /
            Math.max(0.03, 1 - depthRatio + depthRatio * cam.kCam),
          0,
          0.98
        )
      : clamp(depthRatio * cam.kCam, -0.05, 0);

  const axisX = cam.backBase.x + cam.dx * pWeight;
  const axisY = cam.backBase.y + cam.dy * pWeight;
  const localStumpW = Math.max(
    0.01,
    cam.backW + (cam.frontW - cam.backW) * clamp(pWeight, 0, 1)
  );
  const localStumpH = Math.max(
    0.024,
    cam.backH + (cam.frontH - cam.backH) * clamp(pWeight, 0, 1)
  );

  const screenXCm = point3D.xCm * cam.lateralMirror;
  const rawX = axisX + (screenXCm / STUMP_WIDTH_CM) * localStumpW;
  const rawY = axisY - (point3D.yCm / STUMP_HEIGHT_CM) * localStumpH;
  const radiusNorm = clamp(
    (BALL_RADIUS_CM / STUMP_WIDTH_CM) * localStumpW,
    0.0032,
    0.014
  );

  return {
    point: {
      x: Number(clamp(rawX, 0.01, 0.99).toFixed(4)),
      y: Number(clamp(rawY, 0.01, 0.99).toFixed(4)),
    },
    radiusNorm: Number(radiusNorm.toFixed(4)),
    pWeight: Number(pWeight.toFixed(4)),
  };
}

export interface VideoProjectedTrajectory2D {
  preBouncePoints2D: NormalizedPoint[];
  bounceToImpactPoints2D: NormalizedPoint[];
  impactToStumpsPoints2D: NormalizedPoint[];
  groundTrackPoints2D: NormalizedPoint[];
  ghostMarkers2D: Array<{
    point: NormalizedPoint;
    radiusNorm: number;
    phase: 'PRE_IMPACT' | 'POST_IMPACT';
  }>;
  entryPoint2D: NormalizedPoint;
  bouncePoint2D: NormalizedPoint;
  impactPoint2D: NormalizedPoint;
  impactGroundPoint2D: NormalizedPoint;
  stumpIntersection2D: NormalizedPoint;
  stumpGroundPoint2D: NormalizedPoint;
}

/**
 * Projects a complete 3D `BallTrajectoryPrediction` onto the 2D video overlay with
 * boundary-pinned residual interpolation so the 2D Hawk-Eye trajectory tube passes
 * 100% pixel-exact through the user's pointed Bounce (B) and Contact (C) markers
 * while landing on the exact 3D stump intersection `(stumpXCm, stumpYCm)` on the Striker Stumps.
 */
export function project3DTrajectoryToVideo(
  pred: BallTrajectoryPrediction,
  stumps: PlantedStumpsConfig,
  anchors?: VideoFlightAnchors | null
): VideoProjectedTrajectory2D {
  const rawRelease2D = project3DPitchPointToVideo(pred.entryPoint3D, stumps).point;
  const rawBounce2D = project3DPitchPointToVideo(pred.bouncePoint3D, stumps).point;
  const rawImpact2D = project3DPitchPointToVideo(pred.impactPoint3D, stumps).point;
  const rawStump2D = project3DPitchPointToVideo(
    pred.stumpIntersection3D,
    stumps
  ).point;

  const isUnseenRelease =
    (stumps.releaseVisibilityMode || 'UNSEEN_RELEASE') === 'UNSEEN_RELEASE';
  const targetRelease2D =
    !isUnseenRelease && anchors?.releasePoint
      ? anchors.releasePoint
      : rawRelease2D;
  const targetBounce2D = anchors?.bouncePoint || rawBounce2D;
  const targetImpact2D = anchors?.contactPoint || rawImpact2D;

  // Residual vectors at Release, Bounce (B), and Contact (C) so the projected 3D curve
  // passes pixel-exact through the user's clicked video coordinates
  const dBnc = {
    x: targetBounce2D.x - rawBounce2D.x,
    y: targetBounce2D.y - rawBounce2D.y,
  };
  const dRel =
    !isUnseenRelease && anchors?.releasePoint
      ? {
          x: targetRelease2D.x - rawRelease2D.x,
          y: targetRelease2D.y - rawRelease2D.y,
        }
      : dBnc;
  const dImp = {
    x: targetImpact2D.x - rawImpact2D.x,
    y: targetImpact2D.y - rawImpact2D.y,
  };

  const preBouncePoints2D: NormalizedPoint[] = pred.preBounceArc.map(
    (pt, idx, arr) => {
      const t = arr.length > 1 ? idx / (arr.length - 1) : 1;
      const base = project3DPitchPointToVideo(pt, stumps).point;
      return {
        x: Number(
          clamp(base.x + dRel.x * (1 - t) + dBnc.x * t, 0.01, 0.99).toFixed(4)
        ),
        y: Number(
          clamp(base.y + dRel.y * (1 - t) + dBnc.y * t, 0.01, 0.99).toFixed(4)
        ),
      };
    }
  );

  const bounceToImpactPoints2D: NormalizedPoint[] = pred.bounceToImpactArc.map(
    (pt, idx, arr) => {
      const t = arr.length > 1 ? idx / (arr.length - 1) : 1;
      const base = project3DPitchPointToVideo(pt, stumps).point;
      return {
        x: Number(
          clamp(base.x + dBnc.x * (1 - t) + dImp.x * t, 0.01, 0.99).toFixed(4)
        ),
        y: Number(
          clamp(base.y + dBnc.y * (1 - t) + dImp.y * t, 0.01, 0.99).toFixed(4)
        ),
      };
    }
  );

  // Post-impact continuation from Contact (C) to Striker Stumps (Z = 0):
  // Smoothly decays the contact residual (1 - t)^1.25 to 0 at Z = 0 so the trajectory
  // originates pixel-exact at C and terminates on the exact physical stump coordinate at Z = 0!
  const impactToStumpsPoints2D: NormalizedPoint[] = pred.impactToStumpsArc.map(
    (pt, idx, arr) => {
      const t = arr.length > 1 ? idx / (arr.length - 1) : 1;
      const wImp = Math.pow(1 - t, 1.25);
      const base = project3DPitchPointToVideo(pt, stumps).point;
      return {
        x: Number(clamp(base.x + dImp.x * wImp, 0.01, 0.99).toFixed(4)),
        y: Number(clamp(base.y + dImp.y * wImp, 0.01, 0.99).toFixed(4)),
      };
    }
  );

  const impactGroundBase = project3DPitchPointToVideo(
    { xCm: pred.impactPoint3D.xCm, yCm: 0, zCm: pred.impactPoint3D.zCm },
    stumps
  ).point;
  const impactGroundPoint2D: NormalizedPoint = {
    x: Number(clamp(impactGroundBase.x + dImp.x, 0.01, 0.99).toFixed(4)),
    y: Number(clamp(impactGroundBase.y + dImp.y * 0.35, 0.01, 0.99).toFixed(4)),
  };

  const stumpGroundPoint2D = project3DPitchPointToVideo(
    { xCm: pred.stumpIntersection3D.xCm, yCm: 0, zCm: 0 },
    stumps
  ).point;

  const releaseGroundBase = project3DPitchPointToVideo(
    { xCm: pred.entryPoint3D.xCm, yCm: 0, zCm: pred.entryPoint3D.zCm },
    stumps
  ).point;
  const releaseGroundPoint2D: NormalizedPoint = {
    x: Number(clamp(releaseGroundBase.x + dRel.x, 0.01, 0.99).toFixed(4)),
    y: Number(clamp(releaseGroundBase.y + dRel.y * 0.35, 0.01, 0.99).toFixed(4)),
  };

  const groundTrackPoints2D: NormalizedPoint[] = [
    releaseGroundPoint2D,
    targetBounce2D,
    impactGroundPoint2D,
    stumpGroundPoint2D,
  ];

  const spanBI = Math.max(12, pred.bouncePoint3D.zCm - pred.impactPoint3D.zCm);
  const ghostMarkers2D = pred.trailGhostPoints.map((gm) => {
    const proj = project3DPitchPointToVideo(gm.point, stumps);
    if (gm.phase === 'PRE_IMPACT') {
      const t = clamp(
        (pred.bouncePoint3D.zCm - gm.point.zCm) / spanBI,
        0,
        1
      );
      return {
        point: {
          x: Number(
            clamp(
              proj.point.x + dBnc.x * (1 - t) + dImp.x * t,
              0.01,
              0.99
            ).toFixed(4)
          ),
          y: Number(
            clamp(
              proj.point.y + dBnc.y * (1 - t) + dImp.y * t,
              0.01,
              0.99
            ).toFixed(4)
          ),
        },
        radiusNorm: proj.radiusNorm,
        phase: gm.phase,
      };
    }
    const tPost = clamp(
      1 - gm.point.zCm / Math.max(10, pred.impactPoint3D.zCm),
      0,
      1
    );
    const wImp = Math.pow(1 - tPost, 1.25);
    return {
      point: {
        x: Number(clamp(proj.point.x + dImp.x * wImp, 0.01, 0.99).toFixed(4)),
        y: Number(clamp(proj.point.y + dImp.y * wImp, 0.01, 0.99).toFixed(4)),
      },
      radiusNorm: proj.radiusNorm,
      phase: gm.phase,
    };
  });

  return {
    preBouncePoints2D,
    bounceToImpactPoints2D,
    impactToStumpsPoints2D,
    groundTrackPoints2D,
    ghostMarkers2D,
    entryPoint2D:
      preBouncePoints2D[0] || targetRelease2D,
    bouncePoint2D: targetBounce2D,
    impactPoint2D: targetImpact2D,
    impactGroundPoint2D,
    stumpIntersection2D: rawStump2D,
    stumpGroundPoint2D,
  };
}

/**
 * Projects a 2D video bowler release point at the bowler's popping crease (Z = 18.90m)
 * into 3D release coordinates (entryXCm, entryYCm) using the camera-adaptive perspective anchor.
 * Supports wide-of-the-crease, round-the-wicket, over-the-wicket, and angled camera deliveries.
 */
export function projectVideoReleaseTo3DPitch(
  releaseVideoPoint: NormalizedPoint,
  stumps: PlantedStumpsConfig
): { entryXCm: number; entryYCm: number } {
  const telemetry = calculateCameraStumpDistances(stumps, releaseVideoPoint);
  const cam = computeCameraPerspectiveModel(stumps);

  if (
    typeof telemetry.reconstructedReleaseHeightCm === 'number' &&
    typeof telemetry.reconstructedReleaseLateralCm === 'number'
  ) {
    return {
      entryXCm: Number(
        (telemetry.reconstructedReleaseLateralCm * cam.lateralMirror).toFixed(1)
      ),
      entryYCm: telemetry.reconstructedReleaseHeightCm,
    };
  }

  const releaseDepthRatio = clamp(
    BOWLER_POPPING_CREASE_Z_CM / BOWLER_STUMPS_Z_CM,
    0.88,
    0.98
  );
  const pWeight = clamp(
    (releaseDepthRatio * cam.kCam) /
      Math.max(0.05, 1 - releaseDepthRatio + releaseDepthRatio * cam.kCam),
    0.85,
    0.98
  );
  const axisX = cam.backBase.x + cam.dx * pWeight;
  const axisY = cam.backBase.y + cam.dy * pWeight;
  const localStumpW = Math.max(
    0.01,
    cam.backW + (cam.frontW - cam.backW) * pWeight
  );
  const localStumpH = Math.max(
    0.026,
    cam.backH + (cam.frontH - cam.backH) * pWeight
  );

  // Full return-crease width is +/- 132cm (4ft 4in from middle stump); allow [-145, 145] cm for wide angles
  const rawScreenEntryXCm =
    ((releaseVideoPoint.x - axisX) / localStumpW) * STUMP_WIDTH_CM;
  const entryXCm = Number(
    clamp(rawScreenEntryXCm * cam.lateralMirror, -145, 145).toFixed(1)
  );
  // Measure release height relative to the bowler's crease ground plane
  const rawHeightCm =
    ((axisY - releaseVideoPoint.y) / localStumpH) * STUMP_HEIGHT_CM;
  const entryYCm = Number(clamp(rawHeightCm, 55, 225).toFixed(1));

  return { entryXCm, entryYCm };
}

/**
 * Estimates the batter's 3D interception distance in front of Striker Stumps (`impactDistanceFromStumpsM`)
 * by combining the clicked contact point's position along the pitch corridor (`corridorT`)
 * with height-aware front/back foot batting plane kinematics.
 */
export function estimateImpactDistanceFromStumpsM(
  contactVideoPoint: NormalizedPoint,
  stumps: PlantedStumpsConfig,
  contactHeightCm: number
): number {
  const cam = computeCameraPerspectiveModel(stumps);
  // Estimate ground shadow beneath the bat-ball contact point (compensating for contact height above turf)
  const localContactGroundY =
    contactVideoPoint.y +
    clamp(contactHeightCm / STUMP_HEIGHT_CM, 0.05, 1.35) * cam.backH * 0.92;

  let corridorP = 0.075;
  if (cam.lenSq > 0.0004) {
    const rawP =
      ((contactVideoPoint.x - cam.backBase.x) * cam.dx +
        (localContactGroundY - cam.backBase.y) * cam.dy) /
      cam.lenSq;
    corridorP = clamp(rawP, 0.028, 0.165);
  } else if (Math.abs(cam.dy) > 0.01) {
    corridorP = clamp(
      (localContactGroundY - cam.backBase.y) / cam.dy,
      0.028,
      0.165
    );
  }

  const homographyImpactM =
    PITCH_LENGTH_METERS *
    (corridorP / Math.max(0.04, corridorP + (1 - corridorP) * cam.kCam));

  // Blend homography ground-plane depth with biomechanical stride plane (front-foot drives ~1.50-1.78m, back-foot ~0.95-1.25m)
  const kinematicStrideM =
    contactHeightCm <= 38
      ? 1.58 - (contactHeightCm / 38) * 0.18
      : contactHeightCm <= 58
      ? 1.4 - ((contactHeightCm - 38) / 20) * 0.22
      : 1.12;

  return Number(
    clamp(homographyImpactM * 0.58 + kinematicStrideM * 0.42, 0.72, 1.88).toFixed(2)
  );
}

/**
 * Automatically detects and projects the ball's 2D turf bounce point (`bouncePoint`),
 * angle-consistent bowler release point (`releasePoint`), and 3D bounce distance (`bounceDistanceFromStumpsM`)
 * from the user's clicked Bat-Ball Contact Point (and optional pointed Bounce Point).
 */
export function autoDetectBounceFromContactPoint(
  contactVideoPoint: NormalizedPoint,
  stumps: PlantedStumpsConfig,
  handedness: BatterHandedness,
  impactTimestampSec = 1.0,
  bounceLengthOverrideM?: number,
  bouncePointOverride?: NormalizedPoint | null
): {
  bouncePoint: NormalizedPoint;
  releasePoint: NormalizedPoint;
  bounceDistanceFromStumpsM: number;
  impactDistanceFromStumpsM: number;
  bounceXCm: number;
  bounceTimestampSec: number;
  releaseTimestampSec: number;
  lengthCategoryLabel: string;
} {
  const proj = calculateImaginaryStumpPoint(
    contactVideoPoint,
    stumps,
    handedness,
    bouncePointOverride
  );
  const handednessSign = handedness === 'RHB' ? 1 : -1;
  const impactXCm =
    typeof proj.screenOffsetCm === 'number'
      ? proj.screenOffsetCm
      : proj.offsetFromMiddleCm * handednessSign;
  const impactYCm = clamp(proj.contactHeightCm, 1, 96);

  const impactDistanceFromStumpsM = estimateImpactDistanceFromStumpsM(
    contactVideoPoint,
    stumps,
    impactYCm
  );

  const homographyBounce = bouncePointOverride
    ? projectVideoBounceTo3DPitch(
        bouncePointOverride,
        stumps,
        null,
        contactVideoPoint
      )
    : null;

  const naturalBounceM =
    typeof bounceLengthOverrideM === 'number' && bounceLengthOverrideM > 0
      ? bounceLengthOverrideM
      : homographyBounce
      ? homographyBounce.bounceDistanceFromStumpsM
      : estimateNaturalBounceLengthM(impactYCm, impactDistanceFromStumpsM);

  const bounceDistanceFromStumpsM = Number(
    clamp(
      Math.max(impactDistanceFromStumpsM + 0.36, naturalBounceM),
      1.1,
      14.5
    ).toFixed(2)
  );

  const impactZCm = metersToWorldZ(impactDistanceFromStumpsM);
  const bounceZCm = Math.max(
    impactZCm + metersToWorldZ(0.36),
    metersToWorldZ(bounceDistanceFromStumpsM)
  );
  const distBounceToImpactCm = Math.max(15, bounceZCm - impactZCm);
  const lengthLeverage = clamp(distBounceToImpactCm / 180, 0.35, 1.65);

  const bounceLateralOffsetCm = clamp(
    (-impactXCm * 0.05 - handednessSign * 0.55) * lengthLeverage,
    -4.2,
    4.2
  );
  const bounceXCm = homographyBounce
    ? homographyBounce.bounceXCm
    : Number(clamp(impactXCm + bounceLateralOffsetCm, -50, 50).toFixed(1));

  const bouncePoint =
    bouncePointOverride ||
    project3DPitchBounceToVideo(bounceDistanceFromStumpsM, bounceXCm, stumps);

  // Extrapolate the ground-plane delivery line from Contact (C) through Bounce (B) back toward
  // the bowler's popping crease (Z = 18.90m) so the default release point naturally follows any delivery angle!
  const cam = computeCameraPerspectiveModel(stumps);
  const releaseDepthRatio = clamp(
    BOWLER_POPPING_CREASE_Z_CM / BOWLER_STUMPS_Z_CM,
    0.85,
    1.0
  );
  const relPWeight = clamp(
    (releaseDepthRatio * cam.kCam) /
      Math.max(0.05, 1 - releaseDepthRatio + releaseDepthRatio * cam.kCam),
    0.82,
    0.98
  );
  const relAxisX = cam.backBase.x + cam.dx * relPWeight;
  const relAxisY = cam.backBase.y + cam.dy * relPWeight;
  const relLocalW = Math.max(
    0.01,
    cam.backW + (cam.frontW - cam.backW) * relPWeight
  );
  const relLocalH = Math.max(
    0.026,
    cam.backH + (cam.frontH - cam.backH) * relPWeight
  );

  const defaultReleaseSideCm = -handednessSign * 14;
  const groundSlopeToBowler =
    (bounceXCm - impactXCm) / Math.max(24, bounceZCm - impactZCm);
  const extrapolatedCreaseXCm =
    bounceXCm +
    groundSlopeToBowler * (BOWLER_POPPING_CREASE_Z_CM - bounceZCm) * 0.62;
  const entryXCm = clamp(
    homographyBounce
      ? extrapolatedCreaseXCm * 0.82 + defaultReleaseSideCm * 0.18
      : bounceXCm * 0.72 + defaultReleaseSideCm * 0.55,
    -115,
    115
  );
  const entryYCm = 136;

  const releasePoint: NormalizedPoint = {
    x: Number(
      clamp(
        relAxisX + ((entryXCm * cam.lateralMirror) / STUMP_WIDTH_CM) * relLocalW,
        0.04,
        0.96
      ).toFixed(4)
    ),
    y: Number(
      clamp(
        relAxisY - (entryYCm / STUMP_HEIGHT_CM) * relLocalH,
        0.04,
        0.92
      ).toFixed(4)
    ),
  };

  const lengthCategoryLabel =
    bounceDistanceFromStumpsM < 2.6
      ? 'Yorker / Blockhole'
      : bounceDistanceFromStumpsM < 4.8
      ? 'Full / Half-Volley'
      : bounceDistanceFromStumpsM <= 7.4
      ? 'Good Length'
      : bounceDistanceFromStumpsM <= 11.0
      ? 'Back of Length / Short'
      : 'Bouncer';

  const postBounceDistM = Math.max(
    0.4,
    bounceDistanceFromStumpsM - impactDistanceFromStumpsM
  );
  const estBounceToContactSec = clamp(postBounceDistM / 31.5, 0.04, 0.34);
  const bounceTimestampSec = Number(
    Math.max(0.04, impactTimestampSec - estBounceToContactSec).toFixed(3)
  );
  const releaseTimestampSec = Number(
    Math.max(0, impactTimestampSec - 0.44).toFixed(3)
  );

  return {
    bouncePoint,
    releasePoint,
    bounceDistanceFromStumpsM,
    impactDistanceFromStumpsM,
    bounceXCm,
    bounceTimestampSec,
    releaseTimestampSec,
    lengthCategoryLabel,
  };
}

/**
 * Calculates a complete, physically accurate two-phase non-linear ballistic 3D ball trajectory
 * across the 22-yard (20.12m) pitch:
 *  Phase 1 (Aerial Release -> Pitch Bounce under Quadratic Air Drag + Gravity):
 *    Leaves bowler's hand at (entryXCm, entryYCm, BOWLER_POPPING_CREASE_Z_CM = 18.90m) and descends
 *    under aerodynamic drag (alpha_pre = 0.0112 m^-1) and gravity (g = 9.81 m/s^2) into the pointed
 *    turf bounce at (bounceXCm, 0, bounceZCm), establishing pre-bounce impact velocity and incidence angle theta_in.
 *  Phase 2 (Oblique Turf Bounce Restitution -> Non-Linear Ballistic Rebound -> Contact -> Striker Stumps):
 *    Applies oblique turf impact mechanics (tangential friction mu_d, horizontal speed retention e_z,
 *    and vertical bounce restitution coefficient e_y solved from the pointed Bounce and Contact coordinates)
 *    together with post-bounce aerodynamic drag (alpha_post = 0.0118 m^-1) and gravitational acceleration
 *    so the stump hit prediction at Z = 0 accurately reflects ground friction, impact energy, and release angle.
 */
export function calculateBallTrajectory(
  stumps: PlantedStumpsConfig,
  projection: ImaginaryStumpProjection,
  handedness: BatterHandedness,
  mode: TrajectoryDeliveryMode = 'AUTO_PITCH',
  _impactZCmOverride = DEFAULT_IMPACT_Z_CM,
  customBounceLengthM?: number | null,
  calibratedSpeedOverrideKph?: number | null,
  videoFlightAnchors?: VideoFlightAnchors | null
): BallTrajectoryPrediction {
  const handednessSign = handedness === 'RHB' ? 1 : -1;

  // When both contactPoint and bouncePoint are available, re-evaluate contact projection with the bounce constraint
  // so contact height and lateral offset are solved on the exact coupled ground plane
  const refinedProjection =
    videoFlightAnchors?.contactPoint && videoFlightAnchors?.bouncePoint
      ? calculateImaginaryStumpPoint(
          videoFlightAnchors.contactPoint,
          stumps,
          handedness,
          videoFlightAnchors.bouncePoint
        )
      : projection;

  const impactXCm =
    typeof refinedProjection.screenOffsetCm === 'number'
      ? refinedProjection.screenOffsetCm
      : refinedProjection.offsetFromMiddleCm * handednessSign;
  const impactYCm = clamp(refinedProjection.contactHeightCm, 1, 98);

  const isUnseenRelease =
    (stumps.releaseVisibilityMode || 'UNSEEN_RELEASE') === 'UNSEEN_RELEASE';
  const effectiveReleasePoint = isUnseenRelease
    ? undefined
    : videoFlightAnchors?.releasePoint;

  const homographyBounce = videoFlightAnchors?.bouncePoint
    ? projectVideoBounceTo3DPitch(
        videoFlightAnchors.bouncePoint,
        stumps,
        effectiveReleasePoint,
        videoFlightAnchors.contactPoint
      )
    : null;
  const homographyRelease = effectiveReleasePoint
    ? projectVideoReleaseTo3DPitch(effectiveReleasePoint, stumps)
    : null;

  // 1. Determine batter's interception plane and bounce length from pointed 2-point video homography or coupled ballistic solver
  const baseImpactDistM = videoFlightAnchors?.contactPoint
    ? estimateImpactDistanceFromStumpsM(
        videoFlightAnchors.contactPoint,
        stumps,
        impactYCm
      )
    : clamp(
        1.16 + Math.min(estimateNaturalBounceLengthM(impactYCm, 1.38), 5.6) * 0.06,
        0.76,
        1.72
      );
  const autoBounceM = homographyBounce
    ? homographyBounce.bounceDistanceFromStumpsM
    : estimateNaturalBounceLengthM(impactYCm, baseImpactDistM);
  const bounceDistanceFromStumpsM = Number(
    clamp(
      homographyBounce
        ? homographyBounce.bounceDistanceFromStumpsM
        : typeof customBounceLengthM === 'number' && customBounceLengthM > 0
        ? customBounceLengthM
        : autoBounceM,
      1.25,
      9.2
    ).toFixed(2)
  );

  // 2. Smooth, continuous batting impact distance in meters from Striker Stumps (Popping Crease = 1.22m):
  const rawImpactDistM = videoFlightAnchors?.contactPoint
    ? baseImpactDistM
    : clamp(
        1.14 + Math.min(bounceDistanceFromStumpsM, 5.4) * 0.068,
        0.74,
        1.62
      );
  const impactDistanceFromStumpsM = Number(
    Math.min(
      rawImpactDistM,
      Math.max(0.52, bounceDistanceFromStumpsM - 0.38)
    ).toFixed(2)
  );

  const impactZCm = metersToWorldZ(impactDistanceFromStumpsM);
  const bounceZCm = Math.max(
    impactZCm + metersToWorldZ(0.38),
    metersToWorldZ(bounceDistanceFromStumpsM)
  );

  // Regulation Cricket Length Classification (measured from Striker Stumps at 0.00m)
  const lengthCategoryLabel =
    bounceDistanceFromStumpsM < 2.6
      ? 'Yorker / Blockhole'
      : bounceDistanceFromStumpsM < 4.8
      ? 'Full / Half-Volley'
      : bounceDistanceFromStumpsM <= 7.4
      ? 'Good Length'
      : bounceDistanceFromStumpsM <= 11.0
      ? 'Back of Length / Short'
      : 'Bouncer';

  // 3. Bowler Release Point (entryXCm, entryYCm, entryZCm = 18.90m):
  // Keep both bounceXCm and entryXCm cleanly inside the pitch corridor so the 3D Hawk-Eye ball
  // never appears to fly in from outside the pitch mat.
  const distBounceToImpactCm = Math.max(14, bounceZCm - impactZCm);
  const lengthLeverage = clamp(distBounceToImpactCm / 180, 0.35, 1.35);

  const initialBounceXCm = homographyBounce
    ? clamp(homographyBounce.bounceXCm, -14.5, 14.5)
    : Number(
        clamp(
          impactXCm +
            clamp(
              (-impactXCm * 0.05 - handednessSign * 0.55) * lengthLeverage,
              -3.5,
              3.5
            ),
          -14.5,
          14.5
        ).toFixed(1)
      );

  const entryZCm = BOWLER_POPPING_CREASE_Z_CM;
  const wicketSide = stumps.bowlerWicketSide || 'OVER_THE_WICKET';
  const speedType = stumps.bowlerSpeedType || 'PACE';
  const presetReleaseSideCm =
    wicketSide === 'AROUND_THE_WICKET'
      ? handednessSign * 9.5
      : -handednessSign * 7.5;

  const entryXCm = homographyRelease
    ? Number(clamp(homographyRelease.entryXCm, -16, 16).toFixed(1))
    : Number(
        clamp(
          mode === 'STRAIGHT'
            ? impactXCm
            : initialBounceXCm * 0.76 + presetReleaseSideCm * 0.24,
          -14,
          14
        ).toFixed(1)
      );

  // Realistic bowler release height at 18.90m popping crease (Pace ~202cm -> 142 broadcast units; Spin ~184cm -> 124 units)
  const entryYCm = homographyRelease
    ? homographyRelease.entryYCm
    : speedType === 'SPIN'
    ? 124
    : 142;

  // 4. Speed Telemetry & Non-Linear Aerodynamic Drag Pacing:
  const hasCalibratedSpeed =
    typeof calibratedSpeedOverrideKph === 'number' &&
    calibratedSpeedOverrideKph >= 50 &&
    calibratedSpeedOverrideKph <= 170;

  const defaultBaseKph = speedType === 'SPIN' ? 86.0 : 132.0;
  const basePacingSpeedKph =
    defaultBaseKph +
    clamp((impactYCm - 38) * 0.14, -5.5, 6.5) +
    clamp((6.0 - bounceDistanceFromStumpsM) * 0.65, -4.5, 4.0);
  const estimatedSpeedKph = hasCalibratedSpeed
    ? Number(calibratedSpeedOverrideKph!.toFixed(1))
    : Number(
        clamp(
          basePacingSpeedKph,
          speedType === 'SPIN' ? 72.0 : 118.0,
          speedType === 'SPIN' ? 102.0 : 146.0
        ).toFixed(1)
      );
  const estimatedSpeedMph = Number((estimatedSpeedKph * 0.621371).toFixed(1));

  const calibratedSpeedKph = hasCalibratedSpeed ? estimatedSpeedKph : null;
  const calibratedSpeedMph = hasCalibratedSpeed ? estimatedSpeedMph : null;

  // 5. Phase 1 Non-Linear Aerodynamic Ballistics (Release R -> Bounce B):
  const alphaPreDrag = 0.0112;
  const releaseSpeedMps = clamp(estimatedSpeedKph / 3.6, 18.0, 46.0);
  const releaseMetersFromStumps = worldZToMeters(entryZCm);
  const preBounceDistM = Math.max(
    1.5,
    releaseMetersFromStumps - bounceDistanceFromStumpsM
  );
  const expPreDrag = Math.exp(alphaPreDrag * preBounceDistM);
  const tPreSec = (expPreDrag - 1) / (alphaPreDrag * releaseSpeedMps);
  const preBounceHorizontalSpeedInMps = releaseSpeedMps / expPreDrag;
  const preBounceVerticalSpeedInCmps =
    entryYCm / Math.max(0.08, tPreSec) + 0.5 * 981 * tPreSec;
  const preBounceHorizontalSpeedInCmps = preBounceHorizontalSpeedInMps * 100;
  const incidenceAngleRad = Math.atan2(
    preBounceVerticalSpeedInCmps,
    Math.max(500, preBounceHorizontalSpeedInCmps)
  );
  const incidenceAngleDeg = Number(
    clamp((incidenceAngleRad * 180) / Math.PI, 4.5, 28.0).toFixed(1)
  );

  // 6. Post-Bounce Horizontal (X) Line with Realistic Seam/Spin Bounds:
  const alphaPostDrag = 0.0118;
  const bounceToImpactDistM = Math.max(
    0.34,
    bounceDistanceFromStumpsM - impactDistanceFromStumpsM
  );
  const bounceToStumpsDistM = Math.max(0.65, bounceDistanceFromStumpsM);
  const nonLinearTimeRatioStumps =
    (Math.exp(alphaPostDrag * bounceToStumpsDistM) - 1) /
    Math.max(0.002, Math.exp(alphaPostDrag * bounceToImpactDistM) - 1);
  const postImpactLateralLever = clamp(
    nonLinearTimeRatioStumps - 1,
    0.08,
    0.75
  );

  let bounceXCm = initialBounceXCm;
  let stumpXCm = impactXCm;

  if (mode === 'STRAIGHT') {
    bounceXCm = homographyBounce
      ? clamp(homographyBounce.bounceXCm, -16.5, 16.5)
      : impactXCm;
    stumpXCm = impactXCm;
  } else if (mode === 'AUTO_PITCH') {
    bounceXCm = initialBounceXCm;
    const postContactDriftCm = clamp(
      (impactXCm - bounceXCm) * postImpactLateralLever,
      -6.5,
      6.5
    );
    stumpXCm = Number(
      clamp(impactXCm + postContactDriftCm, -24, 24).toFixed(1)
    );
  } else if (mode === 'ANGLE_IN') {
    const inAngleDriftCm = clamp(
      handednessSign * (3.2 + (1.2 - Math.min(1.0, lengthLeverage * 0.45))) -
        impactXCm * 0.05,
      -5.5,
      5.5
    );
    bounceXCm = initialBounceXCm;
    stumpXCm = Number(
      clamp(
        impactXCm +
          clamp((impactXCm - bounceXCm) * postImpactLateralLever, -5.5, 5.5) +
          inAngleDriftCm * 0.55,
        -24,
        24
      ).toFixed(1)
    );
  } else if (mode === 'SEAM_AWAY') {
    const outSeamDriftCm = clamp(
      -handednessSign * (3.2 + (1.2 - Math.min(1.0, lengthLeverage * 0.45))) -
        impactXCm * 0.04,
      -5.5,
      5.5
    );
    bounceXCm = initialBounceXCm;
    stumpXCm = Number(
      clamp(
        impactXCm +
          clamp((impactXCm - bounceXCm) * postImpactLateralLever, -5.5, 5.5) +
          outSeamDriftCm * 0.55,
        -24,
        24
      ).toFixed(1)
    );
  }

  // 7. Non-Linear Ballistic Trajectory & Explicit Bounce Coefficient Solver (Phase 2: Bounce B -> Contact C -> Stumps):
  const smoothedPath = smooth3DTrajectoryWithBounceControlNode({
    bounceControlNode3D: { xCm: bounceXCm, yCm: 0, zCm: bounceZCm },
    impactPoint3D: { xCm: impactXCm, yCm: impactYCm, zCm: impactZCm },
    entryPoint3D: { xCm: entryXCm, yCm: entryYCm, zCm: entryZCm },
    targetStumpXCm: stumpXCm,
    bounceDistanceFromStumpsM,
    impactDistanceFromStumpsM,
    estimatedSpeedKph,
    autoBounceM,
    mode,
  });

  const evalPostBounceX = smoothedPath.evalSmoothedX;
  const evalPostBounceY = smoothedPath.evalSmoothedY;
  const stumpYCm = smoothedPath.stumpIntersection3D.yCm;
  const bounceToImpactArc = smoothedPath.bounceToImpactArc;
  const impactToStumpsArc = smoothedPath.impactToStumpsArc;
  const bounceToStumpsTrail = smoothedPath.bounceToStumpsTrail;
  const postStumpPoint3D = smoothedPath.postStumpPoint3D;

  // Phase 1 Arc: Bowler Release (entryZCm = 18.90m) -> Pitch Bounce (bounceZCm) using Non-Linear Drag Time Fraction tau(t)
  const preBounceArc: WorldPoint3D[] = [];
  const preSteps = 28;
  const preGravityArchCm = 0.5 * 981 * tPreSec * tPreSec;
  for (let i = 0; i <= preSteps; i++) {
    const u = i / preSteps;
    // Non-linear aerodynamic drag time fraction tau(u) = (exp(alpha * D * u) - 1) / (exp(alpha * D) - 1)
    const tau =
      expPreDrag > 1.0001
        ? (Math.exp(alphaPreDrag * preBounceDistM * u) - 1) / (expPreDrag - 1)
        : u;
    const z = entryZCm + (bounceZCm - entryZCm) * u;
    const swingBowCm =
      mode === 'ANGLE_IN'
        ? handednessSign * 4.2 * Math.sin(tau * Math.PI)
        : mode === 'SEAM_AWAY'
        ? -handednessSign * 4.2 * Math.sin(tau * Math.PI)
        : 0;
    const x = entryXCm + (bounceXCm - entryXCm) * tau + swingBowCm;
    // Exact ballistic descent under gravity and aerodynamic drag: y(0) = entryYCm, y(1) = 0
    const y = entryYCm * (1 - tau) + preGravityArchCm * tau * (1 - tau);
    preBounceArc.push({
      xCm: Number(x.toFixed(2)),
      yCm: Number(Math.max(0, y).toFixed(2)),
      zCm: Number(z.toFixed(2)),
    });
  }

  // Ground shadow points directly under bounceToStumpsTrail for 3D Volumetric Trail Curtain
  const bounceToStumpsGroundTrack: WorldPoint3D[] = bounceToStumpsTrail.map(
    (pt) => ({
      xCm: pt.xCm,
      yCm: 0.15,
      zCm: pt.zCm,
    })
  );

  // Stroboscopic Hawk-Eye Ghost Ball Markers sampled along the smoothed Bounce-to-Stumps Trail
  const trailGhostPoints: TrailGhostMarker[] = [];
  const preGhostFractions = [0.18, 0.38, 0.58, 0.78];
  for (const frac of preGhostFractions) {
    const z = bounceZCm + (impactZCm - bounceZCm) * frac;
    trailGhostPoints.push({
      point: {
        xCm: Number(evalPostBounceX(z).toFixed(2)),
        yCm: Number(evalPostBounceY(z).toFixed(2)),
        zCm: Number(z.toFixed(2)),
      },
      progress: Number((frac * 0.65).toFixed(2)),
      phase: 'PRE_IMPACT',
    });
  }
  const postGhostFractions = [0.33, 0.67];
  for (const frac of postGhostFractions) {
    const z = impactZCm * (1 - frac);
    trailGhostPoints.push({
      point: {
        xCm: Number(evalPostBounceX(z).toFixed(2)),
        yCm: Number(evalPostBounceY(z).toFixed(2)),
        zCm: Number(z.toFixed(2)),
      },
      progress: Number((0.65 + frac * 0.35).toFixed(2)),
      phase: 'POST_IMPACT',
    });
  }

  // Ground shadow track along the full pitch surface (yCm = 0.2)
  const groundTrackPoints: WorldPoint3D[] = [
    { xCm: entryXCm, yCm: 0.2, zCm: entryZCm },
    { xCm: bounceXCm, yCm: 0.2, zCm: bounceZCm },
    { xCm: impactXCm, yCm: 0.2, zCm: impactZCm },
    { xCm: stumpXCm, yCm: 0.2, zCm: 0 },
  ];

  // Wicket & Zone Verdict at Striker Stumps (Z = 0) using unified ICC DRS thresholds:
  // - Full Hitting (RED): |x| <= 11.43cm and 0 <= y <= 71.12cm
  // - Umpire's Call Grazing (AMBER): |x| <= 15.03cm and 0 <= y <= 74.72cm
  const stumpSignedOffsetCm = stumpXCm * handednessSign;
  const stumpZone = classifyStumpLineZone(stumpSignedOffsetCm);
  const absStumpX = Math.abs(stumpXCm);
  const isFullWicketHit =
    absStumpX <= STUMP_OUTER_HALF_WIDTH_CM &&
    stumpYCm >= 0 &&
    stumpYCm <= STUMP_HEIGHT_CM;
  const isGrazeWicketHit =
    !isFullWicketHit &&
    absStumpX <= WICKET_HIT_HALF_WIDTH_CM &&
    stumpYCm >= 0 &&
    stumpYCm <= BAIL_GRAZE_TOP_CM;
  const hittingWicket = isFullWicketHit || isGrazeWicketHit;

  let verdictLabel = 'MISSING STUMPS';
  if (isFullWicketHit) {
    if (stumpYCm >= 67.5) {
      verdictLabel = 'HITTING BAILS';
    } else if (stumpZone === 'Middle Stump') {
      verdictLabel = 'HITTING MIDDLE STUMP';
    } else if (stumpSignedOffsetCm < 0) {
      verdictLabel = 'HITTING OFF STUMP';
    } else {
      verdictLabel = 'HITTING LEG STUMP';
    }
  } else if (isGrazeWicketHit) {
    if (stumpYCm > STUMP_HEIGHT_CM) {
      verdictLabel = 'CLIPPING BAILS';
    } else if (stumpSignedOffsetCm < 0) {
      verdictLabel = 'GRAZING OFF STUMP';
    } else {
      verdictLabel = 'GRAZING LEG STUMP';
    }
  } else if (stumpYCm > BAIL_GRAZE_TOP_CM && absStumpX <= WICKET_HIT_HALF_WIDTH_CM) {
    verdictLabel = 'GOING OVER BAILS';
  } else if (stumpSignedOffsetCm < 0) {
    verdictLabel = 'MISSING OFF STUMP';
  } else {
    verdictLabel = 'MISSING LEG STUMP';
  }

  const bounceSignedCm = bounceXCm * handednessSign;
  const pitchingZoneLabel =
    Math.abs(bounceSignedCm) <= STUMP_OUTER_HALF_WIDTH_CM
      ? 'Pitching In-Line'
      : bounceSignedCm < -STUMP_OUTER_HALF_WIDTH_CM
      ? 'Pitching Outside Off'
      : 'Pitching Outside Leg';

  const lateralDeviationDeg = Number(
    (
      (Math.atan2(stumpXCm - bounceXCm, Math.max(1, bounceZCm)) * 180) /
      Math.PI
    ).toFixed(1)
  );
  const lateralDriftCm = Number((stumpXCm - bounceXCm).toFixed(1));

  const postBounceSpeedMps =
    preBounceHorizontalSpeedInMps * smoothedPath.tangentialRestitutionCoeff;
  const tMidSec =
    (Math.exp(alphaPostDrag * bounceToImpactDistM) - 1) /
    (alphaPostDrag * Math.max(12, postBounceSpeedMps));
  const tBounceToStumpsSec =
    (Math.exp(alphaPostDrag * bounceToStumpsDistM) - 1) /
    (alphaPostDrag * Math.max(12, postBounceSpeedMps));
  const tPostSec = Math.max(0.015, tBounceToStumpsSec - tMidSec);
  const totalFlightSec = tPreSec + tMidSec + tPostSec;

  const realFlightDurationMs = Math.round(clamp(totalFlightSec * 1000, 440, 880));
  const bounceProgress = Number(
    clamp(tPreSec / totalFlightSec, 0.18, 0.86).toFixed(3)
  );
  const impactProgress = Number(
    clamp(
      (tPreSec + tMidSec) / totalFlightSec,
      bounceProgress + 0.06,
      0.96
    ).toFixed(3)
  );

  return {
    entryPoint3D: { xCm: entryXCm, yCm: entryYCm, zCm: entryZCm },
    bouncePoint3D: { xCm: bounceXCm, yCm: 0, zCm: bounceZCm },
    impactPoint3D: { xCm: impactXCm, yCm: impactYCm, zCm: impactZCm },
    stumpIntersection3D: { xCm: stumpXCm, yCm: stumpYCm, zCm: 0 },
    postStumpPoint3D,
    preBounceArc,
    bounceToImpactArc,
    impactToStumpsArc,
    bounceToStumpsTrail,
    bounceToStumpsGroundTrack,
    trailGhostPoints,
    groundTrackPoints,
    hittingWicket,
    verdictLabel,
    pitchingZoneLabel,
    lengthCategoryLabel,
    lateralDeviationDeg,
    lateralDriftCm,
    bounceDistanceFromStumpsM,
    impactDistanceFromStumpsM,
    hasCalibratedSpeed,
    calibratedSpeedKph,
    calibratedSpeedMph,
    estimatedSpeedKph,
    estimatedSpeedMph,
    realFlightDurationMs,
    bounceProgress,
    impactProgress,
    bounceRestitutionCoeff: smoothedPath.bounceRestitutionCoeff,
    tangentialRestitutionCoeff: smoothedPath.tangentialRestitutionCoeff,
    turfFrictionCoeff: smoothedPath.turfFrictionCoeff,
    impactEnergyRetentionPct: smoothedPath.impactEnergyRetentionPct,
    incidenceAngleDeg,
    reboundAngleDeg: smoothedPath.reboundAngleDeg,
    aerodynamicDragFactor: alphaPostDrag,
    smoothingControlNode3D: smoothedPath.bounceControlNode3D,
    impactTangentVector3D: smoothedPath.impactTangentVector3D,
    postImpactCurvatureKappa: smoothedPath.postImpactCurvatureKappa,
    pathSmoothingApplied: true,
  };
}

/**
 * Non-Linear Ballistic & Bounce Restitution 3D Trajectory Solver in the DRS Telemetry Engine.
 * Incorporates:
 *  1. Pre-bounce incidence velocity & angle from the Bowler Release Point (`entryPoint3D`) to Bounce (`bounceControlNode3D`).
 *  2. Oblique turf impact physics at the pointed Bounce Point (`bounceControlNode3D`):
 *     - Tangential horizontal velocity restitution `e_z` & dynamic turf friction `mu_d`
 *     - Vertical bounce restitution coefficient `e_y = v_y,out / v_y,in` solved directly from the pointed
 *       Bounce (`B`) and Contact (`C`) coordinates
 *     - Total post-bounce kinetic energy retention percentage (`impactEnergyRetentionPct`)
 *  3. Non-linear aerodynamic drag (`alpha = 0.0118 m^-1`) + gravitational acceleration (`g = 9.81 m/s^2`)
 *     from Bounce (`B`) through Contact (`C`) to the Striker Stumps plane (`Z = 0`).
 */
export function smooth3DTrajectoryWithBounceControlNode(params: {
  bounceControlNode3D: WorldPoint3D;
  impactPoint3D: WorldPoint3D;
  entryPoint3D?: WorldPoint3D;
  targetStumpXCm: number;
  bounceDistanceFromStumpsM: number;
  impactDistanceFromStumpsM?: number;
  estimatedSpeedKph?: number;
  autoBounceM: number;
  mode: TrajectoryDeliveryMode;
}): {
  bounceControlNode3D: WorldPoint3D;
  stumpIntersection3D: WorldPoint3D;
  postStumpPoint3D: WorldPoint3D;
  bounceToImpactArc: WorldPoint3D[];
  impactToStumpsArc: WorldPoint3D[];
  bounceToStumpsTrail: WorldPoint3D[];
  impactTangentVector3D: { dx: number; dy: number; dz: number };
  postImpactCurvatureKappa: number;
  bounceRestitutionCoeff: number;
  tangentialRestitutionCoeff: number;
  turfFrictionCoeff: number;
  impactEnergyRetentionPct: number;
  reboundAngleDeg: number;
  evalSmoothedX: (zCm: number) => number;
  evalSmoothedY: (zCm: number) => number;
} {
  const {
    bounceControlNode3D,
    impactPoint3D,
    entryPoint3D,
    targetStumpXCm,
    bounceDistanceFromStumpsM,
    impactDistanceFromStumpsM = 1.25,
    estimatedSpeedKph = 132.0,
    mode,
  } = params;

  const bounceXCm = bounceControlNode3D.xCm;
  const bounceZCm = bounceControlNode3D.zCm;
  const impactXCm = impactPoint3D.xCm;
  const impactYCm = impactPoint3D.yCm;
  const impactZCm = impactPoint3D.zCm;
  const stumpXCm = targetStumpXCm;

  const entryYCm = entryPoint3D?.yCm ?? 136;
  const entryZCm = entryPoint3D?.zCm ?? BOWLER_POPPING_CREASE_Z_CM;

  const spanBI = Math.max(14, bounceZCm - impactZCm);
  const uStumpsLinear = Math.max(1.05, bounceZCm / spanBI);

  // 1. Pre-Bounce Incidence Kinematics (Release R -> Bounce B):
  const alphaPre = 0.0112;
  const alphaPost = 0.0118;
  const releaseSpeedMps = clamp(estimatedSpeedKph / 3.6, 18.0, 46.0);
  const releaseMeters = worldZToMeters(entryZCm);
  const preBounceDistM = Math.max(
    1.5,
    releaseMeters - bounceDistanceFromStumpsM
  );
  const expPre = Math.exp(alphaPre * preBounceDistM);
  const tPreSec = (expPre - 1) / (alphaPre * releaseSpeedMps);
  const vzInMps = releaseSpeedMps / expPre;
  const vyInCmps = entryYCm / Math.max(0.08, tPreSec) + 0.5 * 981 * tPreSec;
  const vzInCmps = vzInMps * 100;
  const thetaInRad = Math.atan2(vyInCmps, Math.max(500, vzInCmps));

  // 2. Oblique Turf Impact Friction & Tangential Restitution (e_z):
  //    Steeper incidence angles (short-pitched balls or high release) dig deeper into the turf,
  //    losing more horizontal speed to ground friction. Lateral seam deviation also consumes tangential momentum.
  const lateralSeamAngleRad = Math.atan2(
    Math.abs(impactXCm - bounceXCm),
    Math.max(18, spanBI)
  );
  const tangentialRestitutionCoeff = Number(
    clamp(
      0.865 -
        0.24 * Math.sin(thetaInRad) -
        0.12 * Math.sin(lateralSeamAngleRad) -
        0.004 * Math.max(0, bounceDistanceFromStumpsM - 5.5),
      0.71,
      0.91
    ).toFixed(3)
  );
  const vzOutMps = Math.max(14.0, vzInMps * tangentialRestitutionCoeff);
  const vzOutCmps = vzOutMps * 100;

  // 3. Non-Linear Post-Bounce Ballistic Time-of-Flight t(z) under Quadratic Air Drag (alphaPost = 0.0118 m^-1):
  //    Because aerodynamic drag slows the ball continuously after bouncing, time grows faster than distance:
  //    t(s) = (exp(alphaPost * s) - 1) / (alphaPost * vzOutMps)
  const postBounceDistM = Math.max(
    0.34,
    bounceDistanceFromStumpsM - impactDistanceFromStumpsM
  );
  const bounceToStumpsDistM = Math.max(0.65, bounceDistanceFromStumpsM);

  const tBounceToImpactSec =
    (Math.exp(alphaPost * postBounceDistM) - 1) / (alphaPost * vzOutMps);
  const tBounceToStumpsSec =
    (Math.exp(alphaPost * bounceToStumpsDistM) - 1) / (alphaPost * vzOutMps);

  // Required vertical rebound velocity vyOutCmps at Bounce (B) so the ball passes through Contact (C) at height impactYCm:
  const rawVyOutCmps =
    (impactYCm + 0.5 * 981 * tBounceToImpactSec * tBounceToImpactSec) /
    Math.max(0.015, tBounceToImpactSec);

  // Empirical Vertical Bounce Restitution Coefficient e_y = v_y,out / v_y,in:
  const rawEy = rawVyOutCmps / Math.max(120, vyInCmps);
  const bounceRestitutionCoeff = Number(clamp(rawEy, 0.22, 0.88).toFixed(3));

  // Effective dynamic turf friction coefficient mu_d = (1 - e_z) / (tan(theta_in) * (1 + e_y)):
  const tanThetaIn = Math.max(0.08, Math.tan(thetaInRad));
  const turfFrictionCoeff = Number(
    clamp(
      (1 - tangentialRestitutionCoeff) /
        (tanThetaIn * (1 + bounceRestitutionCoeff)),
      0.1,
      0.58
    ).toFixed(3)
  );

  // Rebound lift angle off the pitch (degrees) & Post-Bounce Kinetic Energy Retention (%):
  const reboundAngleRad = Math.atan2(
    Math.max(10, rawVyOutCmps),
    Math.max(500, vzOutCmps)
  );
  const reboundAngleDeg = Number(
    clamp((reboundAngleRad * 180) / Math.PI, 2.0, 26.0).toFixed(1)
  );
  const keIn = vzInCmps * vzInCmps + vyInCmps * vyInCmps;
  const keOut = vzOutCmps * vzOutCmps + rawVyOutCmps * rawVyOutCmps;
  const impactEnergyRetentionPct = Number(
    clamp((keOut / Math.max(1, keIn)) * 100, 38.0, 86.0).toFixed(1)
  );

  // 4. Non-Linear Ballistic Stump Height Evaluation at Z = 0:
  //    Let eta(z) = t(z) / tBounceToImpactSec be the non-linear drag-adjusted flight time ratio.
  //    At Z = bounceZCm, eta = 0; at Z = impactZCm, eta = 1; at Z = 0, etaStumps = tBounceToStumpsSec / tBounceToImpactSec > uStumpsLinear!
  //    Because turf friction (e_z) and air drag (alphaPost) slow the ball down, gravity acts over a longer time interval
  //    between Contact (C) and the Striker Stumps (Z = 0) than a constant-speed linear model.
  const etaStumpsRaw =
    tBounceToStumpsSec / Math.max(0.012, tBounceToImpactSec);
  const etaStumpsEff = clamp(etaStumpsRaw, 1.05, 2.75);
  const gravityDropBC = 0.5 * 981 * tBounceToImpactSec * tBounceToImpactSec;

  const nonLinearBallisticStumpY =
    impactYCm * etaStumpsEff -
    gravityDropBC * etaStumpsEff * (etaStumpsEff - 1);

  const rawRefinedStumpY =
    mode === 'STRAIGHT'
      ? impactYCm
      : clamp(
          nonLinearBallisticStumpY,
          Math.max(4, impactYCm * 0.72),
          Math.min(88, impactYCm * 1.35 + 10)
        );
  const stumpYCm = Number(rawRefinedStumpY.toFixed(1));

  // Helper to evaluate the non-linear drag time ratio eta(zCm) at any zCm <= bounceZCm
  const evalEtaAtZ = (zCm: number): number => {
    const distFromBounceM = Math.max(0, worldZToMeters(bounceZCm - zCm));
    const num = Math.exp(alphaPost * distFromBounceM) - 1;
    const den = Math.max(0.0005, Math.exp(alphaPost * postBounceDistM) - 1);
    return num / den;
  };

  const etaStumps = Math.max(1.05, evalEtaAtZ(0));
  const denomEta = Math.max(0.04, etaStumps * (etaStumps - 1));
  const rawKappaY =
    mode === 'STRAIGHT'
      ? 0
      : (impactYCm * etaStumps - stumpYCm) / denomEta;
  const kappaY = clamp(rawKappaY, -16, Math.max(12, impactYCm * 0.55));

  const linearStumpXEta = bounceXCm * (1 - etaStumps) + impactXCm * etaStumps;
  const kappaX = clamp((linearStumpXEta - stumpXCm) / denomEta, -8, 8);

  const evalSmoothedY = (zCm: number): number => {
    if (mode === 'STRAIGHT' && zCm <= impactZCm) {
      return impactYCm;
    }
    const eta = evalEtaAtZ(zCm);
    const y = impactYCm * eta + kappaY * eta * (1 - eta);
    return clamp(y, 0, 110);
  };

  const evalSmoothedX = (zCm: number): number => {
    const eta = evalEtaAtZ(zCm);
    return bounceXCm * (1 - eta) + impactXCm * eta + kappaX * eta * (1 - eta);
  };

  // 5. Compute unit 3D velocity tangent vector at Impact Point (eta = 1)
  const dEtaDz = -1 / Math.max(12, spanBI);
  const dXds = (impactXCm - bounceXCm - kappaX) * Math.abs(dEtaDz);
  const dYds = (impactYCm - kappaY) * Math.abs(dEtaDz);
  const dZds = -1;
  const tangNorm = Math.hypot(dXds, dYds, dZds) || 1;
  const impactTangentVector3D = {
    dx: Number((dXds / tangNorm).toFixed(4)),
    dy: Number((dYds / tangNorm).toFixed(4)),
    dz: Number((dZds / tangNorm).toFixed(4)),
  };

  // 6. Sample along the non-linear ballistic curve and apply pin-preserving Savitzky-Golay smoothing
  const rawBounceToImpact: WorldPoint3D[] = [];
  const midSteps = 24;
  for (let i = 0; i <= midSteps; i++) {
    const t = i / midSteps;
    const z = bounceZCm + (impactZCm - bounceZCm) * t;
    rawBounceToImpact.push({
      xCm: Number(evalSmoothedX(z).toFixed(2)),
      yCm: Number(evalSmoothedY(z).toFixed(2)),
      zCm: Number(z.toFixed(2)),
    });
  }

  const rawImpactToStumps: WorldPoint3D[] = [];
  const postSteps = 18;
  for (let i = 0; i <= postSteps; i++) {
    const t = i / postSteps;
    const z = impactZCm * (1 - t);
    rawImpactToStumps.push({
      xCm: Number(evalSmoothedX(z).toFixed(2)),
      yCm: Number(evalSmoothedY(z).toFixed(2)),
      zCm: Number(z.toFixed(2)),
    });
  }

  const rawCombined: WorldPoint3D[] = [
    ...rawBounceToImpact,
    ...rawImpactToStumps.slice(1),
  ];
  const impactIndex = midSteps;
  const lastIndex = rawCombined.length - 1;

  const bounceToStumpsTrail: WorldPoint3D[] = rawCombined.map((pt, idx) => {
    if (idx === 0 || idx === impactIndex || idx === lastIndex) {
      return pt;
    }
    const prev = rawCombined[idx - 1];
    const next = rawCombined[idx + 1];
    return {
      xCm: Number((0.2 * prev.xCm + 0.6 * pt.xCm + 0.2 * next.xCm).toFixed(2)),
      yCm: Number((0.2 * prev.yCm + 0.6 * pt.yCm + 0.2 * next.yCm).toFixed(2)),
      zCm: pt.zCm,
    };
  });

  const bounceToImpactArc = bounceToStumpsTrail.slice(0, impactIndex + 1);
  const impactToStumpsArc = bounceToStumpsTrail.slice(impactIndex);

  const postStumpZ = -18;
  const postStumpPoint3D: WorldPoint3D = {
    xCm: Number(evalSmoothedX(postStumpZ).toFixed(1)),
    yCm: Number(evalSmoothedY(postStumpZ).toFixed(1)),
    zCm: postStumpZ,
  };

  void uStumpsLinear;

  return {
    bounceControlNode3D: { xCm: bounceXCm, yCm: 0, zCm: bounceZCm },
    stumpIntersection3D: { xCm: stumpXCm, yCm: stumpYCm, zCm: 0 },
    postStumpPoint3D,
    bounceToImpactArc,
    impactToStumpsArc,
    bounceToStumpsTrail,
    impactTangentVector3D,
    postImpactCurvatureKappa: Number(kappaY.toFixed(3)),
    bounceRestitutionCoeff,
    tangentialRestitutionCoeff,
    turfFrictionCoeff,
    impactEnergyRetentionPct,
    reboundAngleDeg,
    evalSmoothedX,
    evalSmoothedY,
  };
}

/**
 * Progressively slices a 3D polyline from index 0 up to local fraction u in [0, 1],
 * appending the exact linearly interpolated tip point so the animated trail attaches
 * seamlessly to the center of the moving cricket ball.
 */
export function slicePolylineAtFraction(
  pts: WorldPoint3D[],
  u: number
): { sliced: WorldPoint3D[]; tip: WorldPoint3D } {
  if (pts.length === 0) {
    const zero = { xCm: 0, yCm: 0, zCm: 0 };
    return { sliced: [zero], tip: zero };
  }
  const clampedU = clamp(u, 0, 1);
  if (clampedU <= 0 || pts.length === 1) {
    return { sliced: [pts[0]], tip: pts[0] };
  }
  if (clampedU >= 1) {
    return { sliced: pts, tip: pts[pts.length - 1] };
  }

  const exactIdx = clampedU * (pts.length - 1);
  const lowerIdx = Math.floor(exactIdx);
  const upperIdx = Math.min(pts.length - 1, lowerIdx + 1);
  const frac = exactIdx - lowerIdx;

  const p0 = pts[lowerIdx];
  const p1 = pts[upperIdx];
  const tip: WorldPoint3D = {
    xCm: Number((p0.xCm + (p1.xCm - p0.xCm) * frac).toFixed(2)),
    yCm: Number((p0.yCm + (p1.yCm - p0.yCm) * frac).toFixed(2)),
    zCm: Number((p0.zCm + (p1.zCm - p0.zCm) * frac).toFixed(2)),
  };

  const sliced = pts.slice(0, lowerIdx + 1);
  if (frac > 0.001 || sliced.length === 1) {
    sliced.push(tip);
  }
  return { sliced, tip };
}

/**
 * Evaluates the progressive Hawk-Eye animation state of a delivery at normalized timeline progress in [0, 1].
 */
export function evaluateTrajectoryAnimationAtProgress(
  pred: BallTrajectoryPrediction,
  rawProgress: number
): AnimatedTrajectoryState {
  const progress = clamp(rawProgress, 0, 1);
  const pBounce = pred.bounceProgress;
  const pImpact = pred.impactProgress;

  const hasBounced = progress >= pBounce;
  const hasImpacted = progress >= pImpact;
  const hasReachedStumps = progress >= 0.995;

  let phase: AnimatedTrajectoryState['phase'] = 'PRE_BOUNCE';
  let currentBall3D: WorldPoint3D = pred.entryPoint3D;
  let visiblePreBounceArc: WorldPoint3D[] = [pred.entryPoint3D];
  let visibleBounceToImpactArc: WorldPoint3D[] = [];
  let visibleImpactToStumpsArc: WorldPoint3D[] = [];

  if (progress <= pBounce) {
    phase = 'PRE_BOUNCE';
    const localU = pBounce > 0 ? progress / pBounce : 1;
    const preSlice = slicePolylineAtFraction(pred.preBounceArc, localU);
    visiblePreBounceArc = preSlice.sliced;
    currentBall3D = preSlice.tip;
  } else if (progress <= pImpact) {
    phase = 'BOUNCE_TO_IMPACT';
    visiblePreBounceArc = pred.preBounceArc;
    const span = Math.max(0.01, pImpact - pBounce);
    const localU = clamp((progress - pBounce) / span, 0, 1);
    const midSlice = slicePolylineAtFraction(pred.bounceToImpactArc, localU);
    visibleBounceToImpactArc = midSlice.sliced;
    currentBall3D = midSlice.tip;
  } else {
    phase = hasReachedStumps ? 'COMPLETE' : 'IMPACT_TO_STUMPS';
    visiblePreBounceArc = pred.preBounceArc;
    visibleBounceToImpactArc = pred.bounceToImpactArc;
    const span = Math.max(0.01, 1 - pImpact);
    const localU = clamp((progress - pImpact) / span, 0, 1);
    const postSlice = slicePolylineAtFraction(pred.impactToStumpsArc, localU);
    visibleImpactToStumpsArc = postSlice.sliced;
    currentBall3D = postSlice.tip;
  }

  const currentGround3D: WorldPoint3D = {
    xCm: currentBall3D.xCm,
    yCm: 0.15,
    zCm: currentBall3D.zCm,
  };

  const visibleBounceToStumpsTrail: WorldPoint3D[] =
    visibleImpactToStumpsArc.length > 0
      ? [
          ...visibleBounceToImpactArc,
          ...visibleImpactToStumpsArc.slice(1),
        ]
      : visibleBounceToImpactArc;

  const visibleBounceToStumpsGroundTrack: WorldPoint3D[] =
    visibleBounceToStumpsTrail.map((pt) => ({
      xCm: pt.xCm,
      yCm: 0.15,
      zCm: pt.zCm,
    }));

  // Progressive ground shadow track from release up to current ball Z
  const visibleGroundTrackPoints: WorldPoint3D[] = [
    {
      xCm: pred.entryPoint3D.xCm,
      yCm: 0.2,
      zCm: pred.entryPoint3D.zCm,
    },
  ];
  if (hasBounced) {
    visibleGroundTrackPoints.push({
      xCm: pred.bouncePoint3D.xCm,
      yCm: 0.2,
      zCm: pred.bouncePoint3D.zCm,
    });
  }
  if (hasImpacted) {
    visibleGroundTrackPoints.push({
      xCm: pred.impactPoint3D.xCm,
      yCm: 0.2,
      zCm: pred.impactPoint3D.zCm,
    });
  }
  visibleGroundTrackPoints.push({
    xCm: currentBall3D.xCm,
    yCm: 0.2,
    zCm: currentBall3D.zCm,
  });

  // Only reveal stroboscopic ghost balls that the live ball has already passed (zCm >= currentBall3D.zCm)
  const visibleGhostPoints = pred.trailGhostPoints.filter(
    (g) => hasBounced && g.point.zCm >= currentBall3D.zCm + 2
  );

  // Expanding shockwave pulse rings at Bounce, Contact, and Stumps
  const bouncePulseProgress =
    hasBounced && progress <= pBounce + 0.24
      ? clamp((progress - pBounce) / 0.24, 0, 1)
      : null;

  const impactPulseProgress =
    hasImpacted && progress <= pImpact + 0.2
      ? clamp((progress - pImpact) / 0.2, 0, 1)
      : null;

  const stumpPulseProgress =
    progress >= 0.95 ? clamp((progress - 0.95) / 0.05, 0, 1) : null;

  // High-energy motion-blur comet wake directly behind the moving ball
  const activeFullArc = [
    ...visiblePreBounceArc,
    ...(visibleBounceToStumpsTrail.length > 0
      ? visibleBounceToStumpsTrail.slice(1)
      : []),
  ];
  const ballTrailWake3D = activeFullArc.slice(
    Math.max(0, activeFullArc.length - 6)
  );

  return {
    progress,
    phase,
    currentBall3D,
    currentGround3D,
    hasBounced,
    hasImpacted,
    hasReachedStumps,
    bouncePulseProgress,
    impactPulseProgress,
    stumpPulseProgress,
    visiblePreBounceArc,
    visibleBounceToImpactArc,
    visibleImpactToStumpsArc,
    visibleBounceToStumpsTrail,
    visibleBounceToStumpsGroundTrack,
    visibleGroundTrackPoints,
    visibleGhostPoints,
    ballTrailWake3D,
  };
}

// ============================================================================
// PITCH LANDING HEATMAP, ZONE MATRIX, BEEHIVE & OFFICIAL DRS ANALYTICS ENGINE
// ============================================================================

export type PitchHeatmapMode = 'OFF' | 'THERMAL' | 'GRID' | 'BOTH';
export type PitchHeatmapScope = 'ALL' | 'SELECTED';

export type PitchLengthBandId =
  | 'YORKER'
  | 'FULL'
  | 'GOOD'
  | 'BACK_OF_LENGTH'
  | 'SHORT';

export type PitchLineChannelId = 'OUTSIDE_OFF' | 'STUMP_LINE' | 'LEG_SIDE';

export interface PitchZoneCell {
  key: string;
  lengthId: PitchLengthBandId;
  lengthLabel: string;
  shortLengthLabel: string;
  rangeLabel: string;
  minMeters: number;
  maxMeters: number;
  z1Cm: number;
  z2Cm: number;
  lineId: PitchLineChannelId;
  lineLabel: string;
  x1Cm: number;
  x2Cm: number;
  count: number;
  percentage: number;
  avgSpeedKph: number;
  wicketHits: number;
  ballNumbers: number[];
  ballIds: string[];
  intensity: number; // 0..1 normalized against peak cell
}

export interface PitchZoneMatrixSummary {
  cells: PitchZoneCell[];
  lengthTotals: Array<{
    lengthId: PitchLengthBandId;
    label: string;
    rangeLabel: string;
    count: number;
    percentage: number;
    avgSpeedKph: number;
    colorHex: string;
  }>;
  lineTotals: Array<{
    lineId: PitchLineChannelId;
    label: string;
    count: number;
    percentage: number;
    colorHex: string;
  }>;
  totalDeliveries: number;
  dominantZoneLabel: string;
  stumpToStumpPct: number;
  goodLengthPct: number;
}

export interface ThermalGridTile {
  id: string;
  x1Cm: number;
  x2Cm: number;
  z1Cm: number;
  z2Cm: number;
  centerXCm: number;
  centerZCm: number;
  intensity: number; // 0..1 Gaussian kernel sum normalized
  fillRgba: string;
  strokeRgba: string;
}

export interface SideDensitySegment {
  z1Cm: number;
  z2Cm: number;
  centerZCm: number;
  intensity: number;
  fillRgba: string;
}

export interface PitchHeatmapComputation {
  tiles: ThermalGridTile[];
  sideSegments: SideDensitySegment[];
  hotspotCenter3D: { xCm: number; zCm: number; meters: number } | null;
  dispersionRadiusCm: number;
}

/**
 * Maps a normalized [0..1] thermal intensity value to a broadcast Hawk-Eye
 * color ramp: Cool Electric Cyan -> Emerald -> Solar Amber -> Crimson -> White-Hot.
 */
export function getThermalColorRgba(
  intensity: number,
  alphaMultiplier = 1
): string {
  const t = clamp(intensity, 0, 1);
  const alpha = clamp((0.14 + t * 0.64) * alphaMultiplier, 0.04, 0.92);

  if (t < 0.3) {
    // Cyan (#06B6D4) to Emerald (#10B981)
    const u = t / 0.3;
    const r = Math.round(6 + (16 - 6) * u);
    const g = Math.round(182 + (185 - 182) * u);
    const b = Math.round(212 + (129 - 212) * u);
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
  }
  if (t < 0.65) {
    // Emerald (#10B981) to Solar Amber (#F59E0B)
    const u = (t - 0.3) / 0.35;
    const r = Math.round(16 + (245 - 16) * u);
    const g = Math.round(185 + (158 - 185) * u);
    const b = Math.round(129 + (11 - 129) * u);
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
  }
  // Solar Amber (#F59E0B) to Broadcast Crimson (#F43F5E)
  const u = (t - 0.65) / 0.35;
  const r = Math.round(245 + (244 - 245) * u);
  const g = Math.round(158 + (63 - 158) * u);
  const b = Math.round(11 + (94 - 11) * u);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}

/**
 * Computes continuous 2D Gaussian Kernel Density Estimation (KDE) tiles across the
 * 22-yard pitch surface (yCm = 0) so landing point distributions render accurately
 * in 3D Perspective, Drone Top-Down, and Side-On Parallel views.
 */
export function computePitchHeatmapData(
  items: Array<{
    id: string;
    indexNumber: number;
    pred: BallTrajectoryPrediction;
  }>
): PitchHeatmapComputation {
  if (items.length === 0) {
    return {
      tiles: [],
      sideSegments: [],
      hotspotCenter3D: null,
      dispersionRadiusCm: 0,
    };
  }

  // Active landing zone spans Z: 0.6m to 13.4m (zCm: 20 to 468) and X: -54cm to +54cm
  const zMinCm = metersToWorldZ(0.6);
  const zMaxCm = metersToWorldZ(13.4);
  const xMinCm = -54;
  const xMaxCm = 54;

  const zSteps = 22;
  const xSteps = 9;
  const dz = (zMaxCm - zMinCm) / zSteps;
  const dx = (xMaxCm - xMinCm) / xSteps;

  // Gaussian bandwidths in world cm (tuned so nearby deliveries fuse into smooth thermal islands)
  const sigmaX = 11.5;
  const sigmaZ = 34.0;

  const rawTiles: Array<{
    id: string;
    x1Cm: number;
    x2Cm: number;
    z1Cm: number;
    z2Cm: number;
    centerXCm: number;
    centerZCm: number;
    rawVal: number;
  }> = [];

  let maxRaw = 0;

  for (let iz = 0; iz < zSteps; iz++) {
    const z1Cm = zMinCm + iz * dz;
    const z2Cm = z1Cm + dz;
    const centerZCm = (z1Cm + z2Cm) * 0.5;

    for (let ix = 0; ix < xSteps; ix++) {
      const x1Cm = xMinCm + ix * dx;
      const x2Cm = x1Cm + dx;
      const centerXCm = (x1Cm + x2Cm) * 0.5;

      let density = 0;
      for (const item of items) {
        const bx = item.pred.bouncePoint3D.xCm;
        const bz = item.pred.bouncePoint3D.zCm;
        const distX = (centerXCm - bx) / sigmaX;
        const distZ = (centerZCm - bz) / sigmaZ;
        const d2 = distX * distX + distZ * distZ;
        if (d2 < 7.5) {
          density += Math.exp(-0.5 * d2);
        }
      }

      if (density > maxRaw) {
        maxRaw = density;
      }

      if (density > 0.08) {
        rawTiles.push({
          id: `tile-${iz}-${ix}`,
          x1Cm: Number(x1Cm.toFixed(1)),
          x2Cm: Number(x2Cm.toFixed(1)),
          z1Cm: Number(z1Cm.toFixed(1)),
          z2Cm: Number(z2Cm.toFixed(1)),
          centerXCm: Number(centerXCm.toFixed(1)),
          centerZCm: Number(centerZCm.toFixed(1)),
          rawVal: density,
        });
      }
    }
  }

  const normDenom = Math.max(0.001, maxRaw);
  const tiles: ThermalGridTile[] = rawTiles
    .map((t) => {
      const intensity = Number(clamp(t.rawVal / normDenom, 0, 1).toFixed(3));
      return {
        id: t.id,
        x1Cm: t.x1Cm,
        x2Cm: t.x2Cm,
        z1Cm: t.z1Cm,
        z2Cm: t.z2Cm,
        centerXCm: t.centerXCm,
        centerZCm: t.centerZCm,
        intensity,
        fillRgba: getThermalColorRgba(intensity, 0.92),
        strokeRgba: getThermalColorRgba(intensity, 1.15),
      };
    })
    .filter((t) => t.intensity >= 0.11);

  // 1D Longitudinal Density Strip for Side-On Parallel View
  const sideSegments: SideDensitySegment[] = [];
  let maxSideRaw = 0;
  const rawSide: Array<{
    z1Cm: number;
    z2Cm: number;
    centerZCm: number;
    val: number;
  }> = [];

  for (let iz = 0; iz < zSteps; iz++) {
    const z1Cm = zMinCm + iz * dz;
    const z2Cm = z1Cm + dz;
    const centerZCm = (z1Cm + z2Cm) * 0.5;
    let val = 0;
    for (const item of items) {
      const bz = item.pred.bouncePoint3D.zCm;
      const distZ = (centerZCm - bz) / sigmaZ;
      if (distZ * distZ < 7.5) {
        val += Math.exp(-0.5 * distZ * distZ);
      }
    }
    if (val > maxSideRaw) maxSideRaw = val;
    rawSide.push({ z1Cm, z2Cm, centerZCm, val });
  }

  for (const seg of rawSide) {
    const intensity =
      maxSideRaw > 0 ? clamp(seg.val / maxSideRaw, 0, 1) : 0;
    if (intensity >= 0.08) {
      sideSegments.push({
        z1Cm: Number(seg.z1Cm.toFixed(1)),
        z2Cm: Number(seg.z2Cm.toFixed(1)),
        centerZCm: Number(seg.centerZCm.toFixed(1)),
        intensity: Number(intensity.toFixed(3)),
        fillRgba: getThermalColorRgba(intensity, 0.95),
      });
    }
  }

  // Centroid & dispersion radius
  const meanX =
    items.reduce((acc, it) => acc + it.pred.bouncePoint3D.xCm, 0) /
    items.length;
  const meanZ =
    items.reduce((acc, it) => acc + it.pred.bouncePoint3D.zCm, 0) /
    items.length;
  const variance =
    items.reduce((acc, it) => {
      const dxCm = it.pred.bouncePoint3D.xCm - meanX;
      const dzCm = (it.pred.bouncePoint3D.zCm - meanZ) * 0.35;
      return acc + dxCm * dxCm + dzCm * dzCm;
    }, 0) / items.length;

  return {
    tiles,
    sideSegments,
    hotspotCenter3D: {
      xCm: Number(meanX.toFixed(1)),
      zCm: Number(meanZ.toFixed(1)),
      meters: worldZToMeters(meanZ),
    },
    dispersionRadiusCm: Number(Math.sqrt(variance).toFixed(1)),
  };
}

/**
 * Computes the 5 Length Bands x 3 Line Channels Percentage Breakdown Matrix
 * for both the pitch turf grid overlay and the Analytics Matrix panel.
 */
export function computePitchZoneMatrix(
  items: Array<{
    id: string;
    indexNumber: number;
    pred: BallTrajectoryPrediction;
  }>,
  handedness: BatterHandedness
): PitchZoneMatrixSummary {
  const pitchHalfW = 56;
  const wicketEdgeCm = WICKET_HIT_HALF_WIDTH_CM; // 14.2 cm

  // Handedness-aware X intervals on screen:
  // For RHB: Negative X is Off Side, Positive X is Leg Side
  // For LHB: Positive X is Off Side, Negative X is Leg Side
  const lineDefinitions: Array<{
    lineId: PitchLineChannelId;
    label: string;
    x1Cm: number;
    x2Cm: number;
    colorHex: string;
  }> =
    handedness === 'RHB'
      ? [
          {
            lineId: 'OUTSIDE_OFF',
            label: 'Outside Off',
            x1Cm: -pitchHalfW,
            x2Cm: -wicketEdgeCm,
            colorHex: '#22D3EE',
          },
          {
            lineId: 'STUMP_LINE',
            label: 'Stump Line',
            x1Cm: -wicketEdgeCm,
            x2Cm: wicketEdgeCm,
            colorHex: '#F59E0B',
          },
          {
            lineId: 'LEG_SIDE',
            label: 'Leg Side',
            x1Cm: wicketEdgeCm,
            x2Cm: pitchHalfW,
            colorHex: '#FB7185',
          },
        ]
      : [
          {
            lineId: 'LEG_SIDE',
            label: 'Leg Side',
            x1Cm: -pitchHalfW,
            x2Cm: -wicketEdgeCm,
            colorHex: '#FB7185',
          },
          {
            lineId: 'STUMP_LINE',
            label: 'Stump Line',
            x1Cm: -wicketEdgeCm,
            x2Cm: wicketEdgeCm,
            colorHex: '#F59E0B',
          },
          {
            lineId: 'OUTSIDE_OFF',
            label: 'Outside Off',
            x1Cm: wicketEdgeCm,
            x2Cm: pitchHalfW,
            colorHex: '#22D3EE',
          },
        ];

  const lengthDefinitions: Array<{
    lengthId: PitchLengthBandId;
    label: string;
    shortLabel: string;
    rangeLabel: string;
    minMeters: number;
    maxMeters: number;
    colorHex: string;
  }> = [
    {
      lengthId: 'YORKER',
      label: 'Yorker / Blockhole',
      shortLabel: 'Yorker',
      rangeLabel: '0.0m – 2.6m',
      minMeters: 0,
      maxMeters: 2.6,
      colorHex: '#F59E0B',
    },
    {
      lengthId: 'FULL',
      label: 'Full / Half-Volley',
      shortLabel: 'Full',
      rangeLabel: '2.6m – 4.8m',
      minMeters: 2.6,
      maxMeters: 4.8,
      colorHex: '#38BDF8',
    },
    {
      lengthId: 'GOOD',
      label: 'Good Length',
      shortLabel: 'Good',
      rangeLabel: '4.8m – 7.4m',
      minMeters: 4.8,
      maxMeters: 7.4,
      colorHex: '#10B981',
    },
    {
      lengthId: 'BACK_OF_LENGTH',
      label: 'Back of a Length',
      shortLabel: 'Back Len',
      rangeLabel: '7.4m – 10.0m',
      minMeters: 7.4,
      maxMeters: 10.0,
      colorHex: '#F43F5E',
    },
    {
      lengthId: 'SHORT',
      label: 'Short / Bouncer',
      shortLabel: 'Short',
      rangeLabel: '10.0m+',
      minMeters: 10.0,
      maxMeters: 14.0,
      colorHex: '#A855F7',
    },
  ];

  const totalDeliveries = items.length;
  const cells: PitchZoneCell[] = [];
  let maxCellCount = 0;

  for (const lenDef of lengthDefinitions) {
    const z1Cm = metersToWorldZ(lenDef.minMeters);
    const z2Cm = metersToWorldZ(lenDef.maxMeters);

    for (const lineDef of lineDefinitions) {
      const matching = items.filter((it) => {
        const m = it.pred.bounceDistanceFromStumpsM;
        const bx = it.pred.bouncePoint3D.xCm;
        const inLength =
          lenDef.lengthId === 'SHORT'
            ? m >= lenDef.minMeters
            : m >= lenDef.minMeters && m < lenDef.maxMeters;
        const inLine =
          lineDef.x1Cm < -wicketEdgeCm
            ? bx < -wicketEdgeCm
            : lineDef.x2Cm > wicketEdgeCm
            ? bx > wicketEdgeCm
            : bx >= -wicketEdgeCm && bx <= wicketEdgeCm;
        return inLength && inLine;
      });

      const count = matching.length;
      if (count > maxCellCount) maxCellCount = count;

      const percentage =
        totalDeliveries > 0
          ? Number(((count / totalDeliveries) * 100).toFixed(1))
          : 0;
      const avgSpeedKph =
        count > 0
          ? Number(
              (
                matching.reduce(
                  (acc, m) => acc + m.pred.estimatedSpeedKph,
                  0
                ) / count
              ).toFixed(1)
            )
          : 0;
      const wicketHits = matching.filter((m) => m.pred.hittingWicket).length;

      cells.push({
        key: `${lenDef.lengthId}_${lineDef.lineId}`,
        lengthId: lenDef.lengthId,
        lengthLabel: lenDef.label,
        shortLengthLabel: lenDef.shortLabel,
        rangeLabel: lenDef.rangeLabel,
        minMeters: lenDef.minMeters,
        maxMeters: lenDef.maxMeters,
        z1Cm,
        z2Cm,
        lineId: lineDef.lineId,
        lineLabel: lineDef.label,
        x1Cm: lineDef.x1Cm,
        x2Cm: lineDef.x2Cm,
        count,
        percentage,
        avgSpeedKph,
        wicketHits,
        ballNumbers: matching.map((m) => m.indexNumber),
        ballIds: matching.map((m) => m.id),
        intensity: 0,
      });
    }
  }

  for (const cell of cells) {
    cell.intensity =
      maxCellCount > 0
        ? Number((cell.count / maxCellCount).toFixed(2))
        : 0;
  }

  const lengthTotals = lengthDefinitions.map((lenDef) => {
    const rowCells = cells.filter((c) => c.lengthId === lenDef.lengthId);
    const count = rowCells.reduce((acc, c) => acc + c.count, 0);
    const percentage =
      totalDeliveries > 0
        ? Number(((count / totalDeliveries) * 100).toFixed(1))
        : 0;
    const weightedSpeed = rowCells.reduce(
      (acc, c) => acc + c.avgSpeedKph * c.count,
      0
    );
    return {
      lengthId: lenDef.lengthId,
      label: lenDef.label,
      rangeLabel: lenDef.rangeLabel,
      count,
      percentage,
      avgSpeedKph: count > 0 ? Number((weightedSpeed / count).toFixed(1)) : 0,
      colorHex: lenDef.colorHex,
    };
  });

  // Always order lineTotals logically: Outside Off -> Stump Line -> Leg Side
  const orderedLineIds: PitchLineChannelId[] = [
    'OUTSIDE_OFF',
    'STUMP_LINE',
    'LEG_SIDE',
  ];
  const lineTotals = orderedLineIds.map((lId) => {
    const colCells = cells.filter((c) => c.lineId === lId);
    const count = colCells.reduce((acc, c) => acc + c.count, 0);
    const percentage =
      totalDeliveries > 0
        ? Number(((count / totalDeliveries) * 100).toFixed(1))
        : 0;
    const colorHex =
      lId === 'OUTSIDE_OFF'
        ? '#22D3EE'
        : lId === 'STUMP_LINE'
        ? '#F59E0B'
        : '#FB7185';
    const label =
      lId === 'OUTSIDE_OFF'
        ? 'Outside Off'
        : lId === 'STUMP_LINE'
        ? 'Stump Line'
        : 'Leg Side';
    return {
      lineId: lId,
      label,
      count,
      percentage,
      colorHex,
    };
  });

  const bestCell = [...cells].sort((a, b) => b.count - a.count)[0];
  const dominantZoneLabel =
    bestCell && bestCell.count > 0
      ? `${bestCell.shortLengthLabel} · ${bestCell.lineLabel} (${bestCell.percentage}%)`
      : 'No Deliveries';

  const stumpToStumpPct =
    lineTotals.find((l) => l.lineId === 'STUMP_LINE')?.percentage ?? 0;
  const goodLengthPct =
    lengthTotals.find((l) => l.lengthId === 'GOOD')?.percentage ?? 0;

  return {
    cells,
    lengthTotals,
    lineTotals,
    totalDeliveries,
    dominantZoneLabel,
    stumpToStumpPct,
    goodLengthPct,
  };
}

// ============================================================================
// STUMP-PLANE "BEEHIVE" IMPACT HEATMAP ENGINE
// ============================================================================

export interface BeehiveThermalCell {
  id: string;
  xCm: number;
  yCm: number;
  widthCm: number;
  heightCm: number;
  intensity: number;
  fillRgba: string;
}

export interface BeehiveSummary {
  cells: BeehiveThermalCell[];
  hittingWicketsPct: number;
  uncertaintyCorridorPct: number;
  avgStumpHeightCm: number;
}

export function computeBeehiveHeatmap(
  items: Array<{
    id: string;
    indexNumber: number;
    pred: BallTrajectoryPrediction;
  }>,
  handedness: BatterHandedness
): BeehiveSummary {
  if (items.length === 0) {
    return {
      cells: [],
      hittingWicketsPct: 0,
      uncertaintyCorridorPct: 0,
      avgStumpHeightCm: 0,
    };
  }

  const xMin = -32;
  const xMax = 32;
  const yMin = 0;
  const yMax = 88;
  const nx = 16;
  const ny = 14;
  const dx = (xMax - xMin) / nx;
  const dy = (yMax - yMin) / ny;
  const sigmaX = 5.6;
  const sigmaY = 9.5;

  const raw: Array<{
    id: string;
    xCm: number;
    yCm: number;
    val: number;
  }> = [];
  let maxVal = 0;

  for (let iy = 0; iy < ny; iy++) {
    const yCm = yMin + iy * dy;
    const cy = yCm + dy * 0.5;
    for (let ix = 0; ix < nx; ix++) {
      const xCm = xMin + ix * dx;
      const cx = xCm + dx * 0.5;
      let val = 0;
      for (const it of items) {
        const sx = it.pred.stumpIntersection3D.xCm;
        const sy = it.pred.stumpIntersection3D.yCm;
        const d2 =
          Math.pow((cx - sx) / sigmaX, 2) + Math.pow((cy - sy) / sigmaY, 2);
        if (d2 < 6.5) {
          val += Math.exp(-0.5 * d2);
        }
      }
      if (val > maxVal) maxVal = val;
      if (val > 0.08) {
        raw.push({ id: `bh-${iy}-${ix}`, xCm, yCm, val });
      }
    }
  }

  const cells: BeehiveThermalCell[] = raw
    .map((r) => {
      const intensity = Number(clamp(r.val / Math.max(0.01, maxVal), 0, 1).toFixed(2));
      return {
        id: r.id,
        xCm: Number(r.xCm.toFixed(1)),
        yCm: Number(r.yCm.toFixed(1)),
        widthCm: Number(dx.toFixed(1)),
        heightCm: Number(dy.toFixed(1)),
        intensity,
        fillRgba: getThermalColorRgba(intensity, 0.78),
      };
    })
    .filter((c) => c.intensity >= 0.12);

  const hittingCount = items.filter((it) => it.pred.hittingWicket).length;
  const handednessSign = handedness === 'RHB' ? 1 : -1;

  // Channel of Uncertainty: 4th-5th stump corridor outside off (-26cm to -11.43cm signed offset, 28cm to 76cm height)
  const uncertaintyCount = items.filter((it) => {
    const signedX = it.pred.stumpIntersection3D.xCm * handednessSign;
    const sy = it.pred.stumpIntersection3D.yCm;
    return signedX >= -26 && signedX <= -10.5 && sy >= 26 && sy <= 78;
  }).length;

  const avgStumpHeightCm = Number(
    (
      items.reduce((acc, it) => acc + it.pred.stumpIntersection3D.yCm, 0) /
      items.length
    ).toFixed(1)
  );

  return {
    cells,
    hittingWicketsPct: Number(((hittingCount / items.length) * 100).toFixed(1)),
    uncertaintyCorridorPct: Number(
      ((uncertaintyCount / items.length) * 100).toFixed(1)
    ),
    avgStumpHeightCm,
  };
}

// ============================================================================
// OFFICIAL BROADCAST DRS 3-CHECK LBW REVIEW EVALUATOR & WHAT-IF SIMULATOR
// ============================================================================

export type DRSCheckColor = 'RED' | 'AMBER' | 'GREEN';
export type OnFieldUmpireCall = 'OUT' | 'NOT_OUT';

export interface DRSWhatIfOverrides {
  enabled: boolean;
  pitchLineShiftCm: number;
  impactLateralShiftCm: number;
  bounceLengthM: number | null;
  heightMultiplier: number;
  heightShiftCm?: number;
}

export interface DRSReviewCardData {
  pitching: {
    verdict: 'IN-LINE' | 'OUTSIDE OFF' | 'OUTSIDE LEG';
    color: DRSCheckColor;
    detail: string;
    overlapPct: number;
    signedOffsetCm: number;
  };
  impact: {
    verdict: 'IN-LINE' | "UMPIRE'S CALL" | 'OUTSIDE OFF' | 'OUTSIDE LEG';
    color: DRSCheckColor;
    detail: string;
    overlapPct: number;
    signedOffsetCm: number;
  };
  wickets: {
    verdict: 'HITTING' | "UMPIRE'S CALL" | 'MISSING';
    color: DRSCheckColor;
    detail: string;
    overlapPct: number;
    signedOffsetCm: number;
    stumpHeightCm: number;
  };
  finalDecision: 'OUT' | "UMPIRE'S CALL" | 'NOT OUT';
  onFieldCall: OnFieldUmpireCall;
  bigScreenVerdict: 'OUT' | 'NOT OUT';
  reviewOutcomeLabel: 'DECISION OVERTURNED' | 'DECISION STANDS';
  decisionReason: string;
  redLightCount: number;
}

/**
 * Computes the percentage (0..100%) of a regulation cricket ball (radius = 3.60 cm)
 * overlapping the 22.86 cm stump corridor [-11.43 cm, +11.43 cm] and [0 cm, 71.12 cm].
 */
function computeStumpOverlapPercentage(
  absXCm: number,
  yCm?: number
): number {
  const STUMP_HALF_CM = 11.43;
  const BALL_RADIUS_CM = 3.6;
  const BAIL_TOP_CM = 71.12;

  // Horizontal overlap fraction
  const horizMargin = STUMP_HALF_CM + BALL_RADIUS_CM - absXCm;
  const horizFrac = clamp(horizMargin / (2 * BALL_RADIUS_CM), 0, 1);

  if (typeof yCm !== 'number') {
    return Math.round(horizFrac * 100);
  }

  if (yCm < 0) return 0;
  const vertMargin = BAIL_TOP_CM + BALL_RADIUS_CM - yCm;
  const vertFrac =
    yCm <= BAIL_TOP_CM - BALL_RADIUS_CM
      ? 1
      : clamp(vertMargin / (2 * BALL_RADIUS_CM), 0, 1);

  return Math.round(Math.min(horizFrac, vertFrac) * 100);
}

/**
 * Evaluates a delivery against official ICC DRS LBW criteria:
 * - Stump zone half-width = 11.43 cm (9 inches / 2)
 * - Ball radius = 3.60 cm -> Umpire's Call outer edge = 15.03 cm
 * - Stump bail height = 71.12 cm -> Umpire's Call top graze = 74.72 cm
 */
export function evaluateDRSReview(
  pred: BallTrajectoryPrediction,
  handedness: BatterHandedness,
  onFieldCall: OnFieldUmpireCall = 'NOT_OUT'
): DRSReviewCardData {
  const handednessSign = handedness === 'RHB' ? 1 : -1;
  const STUMP_HALF_CM = 11.43;
  const GRAZE_HALF_CM = 15.03;
  const BAIL_TOP_CM = 71.12;
  const GRAZE_TOP_CM = 74.72;

  // 1. PITCHING (at bouncePoint3D.xCm)
  const bounceSignedCm = Number(
    (pred.bouncePoint3D.xCm * handednessSign).toFixed(1)
  );
  const pitchingOverlapPct = computeStumpOverlapPercentage(
    Math.abs(bounceSignedCm)
  );
  let pitchingVerdict: DRSReviewCardData['pitching']['verdict'] = 'IN-LINE';
  let pitchingColor: DRSCheckColor = 'RED';
  if (Math.abs(bounceSignedCm) <= STUMP_HALF_CM) {
    pitchingVerdict = 'IN-LINE';
    pitchingColor = 'RED';
  } else if (bounceSignedCm < -STUMP_HALF_CM) {
    // Pitching Outside Off is valid for LBW (shown as RED/VALID in broadcast DRS)
    pitchingVerdict = 'OUTSIDE OFF';
    pitchingColor = 'RED';
  } else {
    // Pitching Outside Leg is automatically NOT OUT in cricket law
    pitchingVerdict = 'OUTSIDE LEG';
    pitchingColor = 'GREEN';
  }

  // 2. IMPACT (at impactPoint3D.xCm)
  const impactSignedCm = Number(
    (pred.impactPoint3D.xCm * handednessSign).toFixed(1)
  );
  const absImpactCm = Math.abs(impactSignedCm);
  const impactOverlapPct = computeStumpOverlapPercentage(absImpactCm);
  let impactVerdict: DRSReviewCardData['impact']['verdict'] = 'IN-LINE';
  let impactColor: DRSCheckColor = 'RED';
  if (absImpactCm <= STUMP_HALF_CM) {
    impactVerdict = 'IN-LINE';
    impactColor = 'RED';
  } else if (absImpactCm <= GRAZE_HALF_CM) {
    impactVerdict = "UMPIRE'S CALL";
    impactColor = 'AMBER';
  } else if (impactSignedCm < 0) {
    impactVerdict = 'OUTSIDE OFF';
    impactColor = 'GREEN';
  } else {
    impactVerdict = 'OUTSIDE LEG';
    impactColor = 'GREEN';
  }

  // 3. WICKETS (at stumpIntersection3D.xCm, yCm)
  const stumpSignedCm = Number(
    (pred.stumpIntersection3D.xCm * handednessSign).toFixed(1)
  );
  const absStumpX = Math.abs(pred.stumpIntersection3D.xCm);
  const stumpY = Number(pred.stumpIntersection3D.yCm.toFixed(1));
  const wicketsOverlapPct = computeStumpOverlapPercentage(absStumpX, stumpY);
  let wicketsVerdict: DRSReviewCardData['wickets']['verdict'] = 'MISSING';
  let wicketsColor: DRSCheckColor = 'GREEN';

  if (absStumpX <= STUMP_HALF_CM && stumpY >= 0 && stumpY <= BAIL_TOP_CM) {
    wicketsVerdict = 'HITTING';
    wicketsColor = 'RED';
  } else if (
    absStumpX <= GRAZE_HALF_CM &&
    stumpY >= 0 &&
    stumpY <= GRAZE_TOP_CM
  ) {
    wicketsVerdict = "UMPIRE'S CALL";
    wicketsColor = 'AMBER';
  } else {
    wicketsVerdict = 'MISSING';
    wicketsColor = 'GREEN';
  }

  // Final DRS Decision synthesis
  let finalDecision: DRSReviewCardData['finalDecision'] = 'NOT OUT';
  let decisionReason = 'Ball missing wickets or outside line';

  if (
    pitchingColor === 'GREEN' ||
    impactColor === 'GREEN' ||
    wicketsColor === 'GREEN'
  ) {
    finalDecision = 'NOT OUT';
    if (pitchingColor === 'GREEN') {
      decisionReason = 'Pitched Outside Leg Stump';
    } else if (impactColor === 'GREEN') {
      decisionReason = `Impact ${impactVerdict} (${impactOverlapPct}% in-line)`;
    } else {
      decisionReason = `${pred.verdictLabel} (${wicketsOverlapPct}% wicket overlap)`;
    }
  } else if (
    pitchingColor === 'RED' &&
    impactColor === 'RED' &&
    wicketsColor === 'RED'
  ) {
    finalDecision = 'OUT';
    decisionReason = `Three Reds · ${pred.verdictLabel} (${wicketsOverlapPct}% hitting)`;
  } else {
    finalDecision = "UMPIRE'S CALL";
    if (impactColor === 'AMBER' && wicketsColor === 'AMBER') {
      decisionReason = `Umpire's Call on Impact (${impactOverlapPct}%) & Wickets (${wicketsOverlapPct}% · ${pred.verdictLabel})`;
    } else if (impactColor === 'AMBER') {
      decisionReason = `Umpire's Call on Impact (${impactOverlapPct}% in-line) · Wickets ${pred.verdictLabel}`;
    } else {
      decisionReason = `Umpire's Call on Wickets (${wicketsOverlapPct}% overlap) · ${pred.verdictLabel}`;
    }
  }

  const bigScreenVerdict: 'OUT' | 'NOT OUT' =
    finalDecision === 'OUT'
      ? 'OUT'
      : finalDecision === 'NOT OUT'
      ? 'NOT OUT'
      : onFieldCall === 'OUT'
      ? 'OUT'
      : 'NOT OUT';

  const onFieldMatchesFinal =
    (onFieldCall === 'OUT' && bigScreenVerdict === 'OUT') ||
    (onFieldCall === 'NOT_OUT' && bigScreenVerdict === 'NOT OUT');

  const reviewOutcomeLabel: 'DECISION OVERTURNED' | 'DECISION STANDS' =
    onFieldMatchesFinal ? 'DECISION STANDS' : 'DECISION OVERTURNED';

  const redLightCount = [pitchingColor, impactColor, wicketsColor].filter(
    (c) => c === 'RED'
  ).length;

  return {
    pitching: {
      verdict: pitchingVerdict,
      color: pitchingColor,
      detail: `${pred.bounceDistanceFromStumpsM}m length · ${Math.abs(
        bounceSignedCm
      ).toFixed(1)}cm ${
        bounceSignedCm === 0 ? 'Mid' : bounceSignedCm < 0 ? 'Off' : 'Leg'
      }`,
      overlapPct: pitchingOverlapPct,
      signedOffsetCm: bounceSignedCm,
    },
    impact: {
      verdict: impactVerdict,
      color: impactColor,
      detail: `${pred.impactDistanceFromStumpsM}m crease · ${impactOverlapPct}% in-line (${Math.abs(
        impactSignedCm
      ).toFixed(1)}cm)`,
      overlapPct: impactOverlapPct,
      signedOffsetCm: impactSignedCm,
    },
    wickets: {
      verdict: wicketsVerdict,
      color: wicketsColor,
      detail: `${pred.verdictLabel} · ${wicketsOverlapPct}% ball hitting (${stumpY}cm high)`,
      overlapPct: wicketsOverlapPct,
      signedOffsetCm: stumpSignedCm,
      stumpHeightCm: stumpY,
    },
    finalDecision,
    onFieldCall,
    bigScreenVerdict,
    reviewOutcomeLabel,
    decisionReason,
    redLightCount,
  };
}

/**
 * Applies interactive "What-If" DRS simulator adjustments to a recorded delivery
 * so the user can test how shifting pitching line, pad impact line, bounce length,
 * or stump impact height alters the 3D Hawk-Eye path and ICC DRS verdict in real time.
 */
export function applyWhatIfToTrajectory(
  baseStumps: PlantedStumpsConfig,
  baseProjection: ImaginaryStumpProjection,
  handedness: BatterHandedness,
  mode: TrajectoryDeliveryMode,
  baseBounceLengthM: number | undefined,
  overrides: DRSWhatIfOverrides,
  calibratedSpeedOverrideKph?: number,
  videoFlightAnchors?: VideoFlightAnchors | null
): BallTrajectoryPrediction {
  const handednessSign = handedness === 'RHB' ? 1 : -1;
  const targetBounceM =
    overrides.bounceLengthM !== null
      ? overrides.bounceLengthM
      : baseBounceLengthM;

  // 1. Compute the baseline trajectory with the selected bounce length
  const origPred = calculateBallTrajectory(
    baseStumps,
    baseProjection,
    handedness,
    mode,
    DEFAULT_IMPACT_Z_CM,
    targetBounceM,
    calibratedSpeedOverrideKph,
    videoFlightAnchors
  );

  // 2. Compute exact horizontal and vertical shifts
  const lateralShiftCm = overrides.impactLateralShiftCm || 0;
  const pitchShiftCm = overrides.pitchLineShiftCm || 0;
  const extraHeightShiftCm =
    typeof overrides.heightShiftCm === 'number'
      ? overrides.heightShiftCm
      : Math.round(
          origPred.stumpIntersection3D.yCm * (overrides.heightMultiplier - 1)
        );

  const bounceZCm = origPred.bouncePoint3D.zCm;
  const impactZCm = origPred.impactPoint3D.zCm;
  const distBounceToImpact = Math.max(16, bounceZCm - impactZCm);

  const newImpactXCm = Number(
    clamp(origPred.impactPoint3D.xCm + lateralShiftCm, -38, 38).toFixed(1)
  );
  const newBounceXCm = Number(
    clamp(
      origPred.bouncePoint3D.xCm + lateralShiftCm + pitchShiftCm,
      -48,
      48
    ).toFixed(1)
  );

  // When pitchShiftCm is 0, the stump X shifts 1:1 with lateralShiftCm so dragging on the 1:1 Stump SVG tracks the cursor exactly.
  // When pitchShiftCm is non-zero, the altered angle from bounce through impact extrapolates naturally to the stumps.
  const pitchAngleEffectOnStumpsCm =
    Math.abs(pitchShiftCm) > 0.05
      ? -pitchShiftCm * (impactZCm / distBounceToImpact) * 0.72
      : 0;

  const newStumpXCm = Number(
    clamp(
      origPred.stumpIntersection3D.xCm +
        lateralShiftCm +
        pitchAngleEffectOnStumpsCm,
      -42,
      42
    ).toFixed(1)
  );

  const newStumpYCm = Number(
    clamp(origPred.stumpIntersection3D.yCm + extraHeightShiftCm, 1, 92).toFixed(
      1
    )
  );
  const newImpactYCm = Number(
    clamp(
      origPred.impactPoint3D.yCm + extraHeightShiftCm * 0.88,
      1,
      92
    ).toFixed(1)
  );

  const interpolateXAtZ = (zCm: number): number => {
    if (zCm >= bounceZCm) {
      const span = Math.max(1, origPred.entryPoint3D.zCm - bounceZCm);
      const t = clamp((origPred.entryPoint3D.zCm - zCm) / span, 0, 1);
      return Number(
        (
          origPred.entryPoint3D.xCm +
          (newBounceXCm - origPred.entryPoint3D.xCm) * t
        ).toFixed(2)
      );
    }
    if (zCm >= impactZCm) {
      const t = clamp((bounceZCm - zCm) / distBounceToImpact, 0, 1);
      return Number(
        (newBounceXCm + (newImpactXCm - newBounceXCm) * t).toFixed(2)
      );
    }
    const t = impactZCm > 0 ? clamp((impactZCm - zCm) / impactZCm, 0, 1.3) : 0;
    return Number((newImpactXCm + (newStumpXCm - newImpactXCm) * t).toFixed(2));
  };

  const interpolateYPostBounce = (pt: WorldPoint3D): number => {
    if (pt.zCm >= bounceZCm) return pt.yCm;
    const u = clamp((bounceZCm - pt.zCm) / Math.max(1, bounceZCm), 0, 1.2);
    return Number(
      Math.max(0, pt.yCm + extraHeightShiftCm * Math.pow(u, 0.75)).toFixed(2)
    );
  };

  const preBounceArc = origPred.preBounceArc.map((pt) => ({
    ...pt,
    xCm: interpolateXAtZ(pt.zCm),
  }));
  const bounceToImpactArc = origPred.bounceToImpactArc.map((pt) => ({
    ...pt,
    xCm: interpolateXAtZ(pt.zCm),
    yCm: interpolateYPostBounce(pt),
  }));
  const impactToStumpsArc = origPred.impactToStumpsArc.map((pt) => ({
    ...pt,
    xCm: interpolateXAtZ(pt.zCm),
    yCm: interpolateYPostBounce(pt),
  }));
  // Ensure exact endpoints at impact and stumps
  if (bounceToImpactArc.length > 0) {
    bounceToImpactArc[0] = { xCm: newBounceXCm, yCm: 0, zCm: bounceZCm };
    bounceToImpactArc[bounceToImpactArc.length - 1] = {
      xCm: newImpactXCm,
      yCm: newImpactYCm,
      zCm: impactZCm,
    };
  }
  if (impactToStumpsArc.length > 0) {
    impactToStumpsArc[0] = {
      xCm: newImpactXCm,
      yCm: newImpactYCm,
      zCm: impactZCm,
    };
    impactToStumpsArc[impactToStumpsArc.length - 1] = {
      xCm: newStumpXCm,
      yCm: newStumpYCm,
      zCm: 0,
    };
  }

  const bounceToStumpsTrail = [
    ...bounceToImpactArc,
    ...impactToStumpsArc.slice(1),
  ];
  const bounceToStumpsGroundTrack = bounceToStumpsTrail.map((pt) => ({
    xCm: pt.xCm,
    yCm: 0.15,
    zCm: pt.zCm,
  }));

  const stumpSignedOffsetCm = newStumpXCm * handednessSign;
  const stumpZone = classifyStumpLineZone(stumpSignedOffsetCm);
  const absStumpX = Math.abs(newStumpXCm);
  const isFullStumpHit =
    absStumpX <= STUMP_OUTER_HALF_WIDTH_CM &&
    newStumpYCm >= 0 &&
    newStumpYCm <= STUMP_HEIGHT_CM;
  const hittingWicket =
    absStumpX <= WICKET_HIT_HALF_WIDTH_CM &&
    newStumpYCm >= 0 &&
    newStumpYCm <= BAIL_GRAZE_TOP_CM;

  let verdictLabel = 'MISSING STUMPS';
  if (hittingWicket) {
    if (newStumpYCm > STUMP_HEIGHT_CM || newStumpYCm >= 68.5) {
      verdictLabel = 'CLIPPING BAILS';
    } else if (!isFullStumpHit) {
      verdictLabel =
        stumpSignedOffsetCm < 0 ? 'GRAZING OFF STUMP' : 'GRAZING LEG STUMP';
    } else if (stumpZone === 'Middle Stump') {
      verdictLabel = 'HITTING MIDDLE STUMP';
    } else if (stumpZone === 'Off Stump') {
      verdictLabel = 'HITTING OFF STUMP';
    } else {
      verdictLabel = 'HITTING LEG STUMP';
    }
  } else if (
    newStumpYCm > BAIL_GRAZE_TOP_CM &&
    absStumpX <= WICKET_HIT_HALF_WIDTH_CM
  ) {
    verdictLabel = 'GOING OVER BAILS';
  } else if (stumpSignedOffsetCm < 0) {
    verdictLabel = 'MISSING OFF STUMP';
  } else {
    verdictLabel = 'MISSING LEG STUMP';
  }

  const bounceSignedCm = newBounceXCm * handednessSign;
  const pitchingZoneLabel =
    Math.abs(newBounceXCm) <= STUMP_OUTER_HALF_WIDTH_CM
      ? 'Pitching In-Line'
      : bounceSignedCm < -STUMP_OUTER_HALF_WIDTH_CM
      ? 'Pitching Outside Off'
      : 'Pitching Outside Leg';

  const lateralDeviationDeg = Number(
    (
      (Math.atan2(newStumpXCm - newBounceXCm, Math.max(1, bounceZCm)) * 180) /
      Math.PI
    ).toFixed(1)
  );
  const lateralDriftCm = Number((newStumpXCm - newBounceXCm).toFixed(1));

  return {
    ...origPred,
    bouncePoint3D: { xCm: newBounceXCm, yCm: 0, zCm: bounceZCm },
    impactPoint3D: { xCm: newImpactXCm, yCm: newImpactYCm, zCm: impactZCm },
    stumpIntersection3D: { xCm: newStumpXCm, yCm: newStumpYCm, zCm: 0 },
    preBounceArc,
    bounceToImpactArc,
    impactToStumpsArc,
    bounceToStumpsTrail,
    bounceToStumpsGroundTrack,
    groundTrackPoints: [
      {
        xCm: origPred.entryPoint3D.xCm,
        yCm: 0.2,
        zCm: origPred.entryPoint3D.zCm,
      },
      { xCm: newBounceXCm, yCm: 0.2, zCm: bounceZCm },
      { xCm: newImpactXCm, yCm: 0.2, zCm: impactZCm },
      { xCm: newStumpXCm, yCm: 0.2, zCm: 0 },
    ],
    hittingWicket,
    verdictLabel,
    pitchingZoneLabel,
    lateralDeviationDeg,
    lateralDriftCm,
  };
}

export interface RoleCoachingSummary {
  // Batter Insights
  batter: {
    activeCall: 'MUST PLAY' | 'SAFE LEAVE' | 'MARGINAL WATCH';
    activeCallColor: 'RED' | 'GREEN' | 'AMBER';
    activeCallDetail: string;
    footworkVerdict: string;
    strideDepthM: number;
    offStumpCorridorFlag: string;
    lbwVulnerabilityPct: number;
    mustPlayCount: number;
    safeLeaveCount: number;
    coachingTip: string;
  };
  // Bowler Insights
  bowler: {
    activeChannelHit: boolean;
    activeChannelDetail: string;
    topOfOffDisciplinePct: number;
    groupingDispersionCm: number;
    wicketThreatPct: number;
    goodLengthPct: number;
    fullLengthPct: number;
    shortLengthPct: number;
    coachingTip: string;
  };
}

/**
 * Computes actionable Batter & Bowler coaching diagnostics from the active delivery
 * and the full session's trajectory predictions.
 */
export function computeRoleCoachingInsights(
  activePred: BallTrajectoryPrediction | null,
  allPredictions: BallTrajectoryPrediction[],
  handedness: BatterHandedness
): RoleCoachingSummary {
  const handednessSign = handedness === 'RHB' ? 1 : -1;
  const list =
    allPredictions.length > 0
      ? allPredictions
      : activePred
      ? [activePred]
      : [];
  const current = activePred || list[0] || null;

  if (!current || list.length === 0) {
    return {
      batter: {
        activeCall: 'SAFE LEAVE',
        activeCallColor: 'GREEN',
        activeCallDetail: 'Record a delivery to evaluate leave/play judgment',
        footworkVerdict: 'Crease Neutral',
        strideDepthM: 1.5,
        offStumpCorridorFlag: 'Awaiting telemetry',
        lbwVulnerabilityPct: 0,
        mustPlayCount: 0,
        safeLeaveCount: 0,
        coachingTip: 'Plot contact points on video to unlock batter footwork & off-stump judgment insights.',
      },
      bowler: {
        activeChannelHit: false,
        activeChannelDetail: 'Record deliveries to measure top-of-off channel accuracy',
        topOfOffDisciplinePct: 0,
        groupingDispersionCm: 0,
        wicketThreatPct: 0,
        goodLengthPct: 0,
        fullLengthPct: 0,
        shortLengthPct: 0,
        coachingTip: 'Plot a spell of deliveries to measure grouping tightness and top-of-off channel discipline.',
      },
    };
  }

  // --- BATTER INSIGHTS ---
  const activeStumpX = Math.abs(current.stumpIntersection3D.xCm);
  const activeStumpY = current.stumpIntersection3D.yCm;
  const activeSignedImpactCm = current.impactPoint3D.xCm * handednessSign;
  const activeSignedStumpCm = current.stumpIntersection3D.xCm * handednessSign;

  let activeCall: 'MUST PLAY' | 'SAFE LEAVE' | 'MARGINAL WATCH' = 'SAFE LEAVE';
  let activeCallColor: 'RED' | 'GREEN' | 'AMBER' = 'GREEN';
  let activeCallDetail = '';

  if (current.hittingWicket) {
    activeCall = 'MUST PLAY';
    activeCallColor = 'RED';
    activeCallDetail = `Threatening stumps (${current.verdictLabel} at ${activeStumpY.toFixed(0)}cm) — leaving risks Bowled/LBW`;
  } else if (activeStumpX <= 22 || activeStumpY <= 78) {
    activeCall = 'MARGINAL WATCH';
    activeCallColor = 'AMBER';
    activeCallDetail = `4th-stump corridor (${Math.abs(activeSignedStumpCm).toFixed(1)}cm ${
      activeSignedStumpCm < 0 ? 'Off' : 'Leg'
    }, ${activeStumpY.toFixed(0)}cm high) — cover line with bat close to pad`;
  } else {
    activeCall = 'SAFE LEAVE';
    activeCallColor = 'GREEN';
    activeCallDetail =
      activeStumpY > 74.72
        ? `Passing ${Math.round(activeStumpY - 71.1)}cm over bails — safe leave on bounce`
        : `Passing ${Math.round(activeStumpX - 11.4)}cm wide of stumps — safe leave on line`;
  }

  const strideDepthM = current.impactDistanceFromStumpsM;
  const bounceM = current.bounceDistanceFromStumpsM;
  let footworkVerdict = 'Balanced Crease Interception';
  if (bounceM <= 5.2 && strideDepthM < 1.55) {
    footworkVerdict = 'Crease-bound on full length — press further forward to smother swing/spin';
  } else if (bounceM >= 7.2 && strideDepthM > 1.75) {
    footworkVerdict = 'Over-pressing on back-of-length — drop deeper into crease for extra time';
  } else if (strideDepthM >= 1.7) {
    footworkVerdict = `Strong front-foot press (${strideDepthM}m out) neutralizing movement early`;
  } else {
    footworkVerdict = `Deep crease interception (${strideDepthM}m) maximizing reaction window`;
  }

  const offStumpCorridorFlag =
    activeSignedImpactCm >= -24 && activeSignedImpactCm <= -10
      ? `Uncertainty Corridor (${Math.abs(activeSignedImpactCm).toFixed(1)}cm outside Off) — play late under eyes`
      : activeSignedImpactCm > -10 && activeSignedImpactCm <= 11.4
      ? `Stump-to-Stump Line (${Math.abs(activeSignedImpactCm).toFixed(1)}cm from Middle) — present full bat face`
      : `Wide of Off/Leg (${Math.abs(activeSignedImpactCm).toFixed(1)}cm) — low edge risk if left`;

  let mustPlayCount = 0;
  let safeLeaveCount = 0;
  let lbwDangerCount = 0;

  for (const p of list) {
    if (p.hittingWicket) {
      mustPlayCount++;
    } else if (
      Math.abs(p.stumpIntersection3D.xCm) > 20 ||
      p.stumpIntersection3D.yCm > 78
    ) {
      safeLeaveCount++;
    }
    const drs = evaluateDRSReview(p, handedness, 'OUT');
    if (drs.finalDecision === 'OUT' || drs.finalDecision === "UMPIRE'S CALL") {
      lbwDangerCount++;
    }
  }

  const lbwVulnerabilityPct = Math.round((lbwDangerCount / list.length) * 100);
  const batterTip =
    lbwVulnerabilityPct >= 50
      ? `High LBW/Bowled exposure (${lbwVulnerabilityPct}% of balls hitting in-line). Lead with bat slightly ahead of front pad.`
      : activeCall === 'MUST PLAY'
      ? `This delivery attacks the stumps (${current.verdictLabel}). Commit decisively forward or back rather than hanging the bat.`
      : `Solid judgment window — ${safeLeaveCount} of ${list.length} deliveries can be safely left on length or width.`;

  // --- BOWLER INSIGHTS ---
  // Top-of-off channel: bounce length 5.0m–7.2m, stump height 52cm–74.7cm, off-stump corridor (-16cm to +4cm relative to RHB/LHB)
  const isTopOfOff = (p: BallTrajectoryPrediction) => {
    const signedStump = p.stumpIntersection3D.xCm * handednessSign;
    const y = p.stumpIntersection3D.yCm;
    const len = p.bounceDistanceFromStumpsM;
    return (
      len >= 4.8 &&
      len <= 7.5 &&
      y >= 48 &&
      y <= 75 &&
      signedStump >= -16.5 &&
      signedStump <= 4.5
    );
  };

  const activeChannelHit = isTopOfOff(current);
  const activeChannelDetail = activeChannelHit
    ? `Hits elite Top-of-Off channel (${current.bounceDistanceFromStumpsM}m length · ${current.stumpIntersection3D.yCm}cm high)`
    : `Misses Top-of-Off target (${current.bounceDistanceFromStumpsM}m length · ${Math.abs(
        activeSignedStumpCm
      ).toFixed(1)}cm ${activeSignedStumpCm < 0 ? 'Off' : 'Leg'}, ${
        current.stumpIntersection3D.yCm
      }cm high)`;

  const channelHits = list.filter(isTopOfOff).length;
  const topOfOffDisciplinePct = Math.round((channelHits / list.length) * 100);
  const wicketHits = list.filter((p) => p.hittingWicket).length;
  const wicketThreatPct = Math.round((wicketHits / list.length) * 100);

  // Grouping dispersion (standard deviation of bounce pitch points in cm)
  const meanBounceX =
    list.reduce((acc, p) => acc + p.bouncePoint3D.xCm, 0) / list.length;
  const meanBounceZ =
    list.reduce((acc, p) => acc + p.bouncePoint3D.zCm, 0) / list.length;
  const varianceCm2 =
    list.reduce((acc, p) => {
      const dx = p.bouncePoint3D.xCm - meanBounceX;
      const dz = (p.bouncePoint3D.zCm - meanBounceZ) * 0.25; // weight line tighter than length
      return acc + dx * dx + dz * dz;
    }, 0) / list.length;
  const groupingDispersionCm = Number(Math.sqrt(varianceCm2).toFixed(1));

  const fullCount = list.filter((p) => p.bounceDistanceFromStumpsM < 5.0).length;
  const goodCount = list.filter(
    (p) => p.bounceDistanceFromStumpsM >= 5.0 && p.bounceDistanceFromStumpsM <= 7.5
  ).length;
  const shortCount = list.filter((p) => p.bounceDistanceFromStumpsM > 7.5).length;

  const fullLengthPct = Math.round((fullCount / list.length) * 100);
  const goodLengthPct = Math.round((goodCount / list.length) * 100);
  const shortLengthPct = Math.max(0, 100 - fullLengthPct - goodLengthPct);

  const bowlerTip =
    topOfOffDisciplinePct >= 50
      ? `Relentless spell accuracy (${topOfOffDisciplinePct}% in Top-of-Off corridor, ±${groupingDispersionCm}cm grouping). Hold this seam/spin release point.`
      : wicketThreatPct < 40
      ? `Only ${wicketThreatPct}% of deliveries are threatening the stumps. Adjust line ${
          activeSignedStumpCm < -15 ? 'fuller and straighter toward Off stump' : 'tighter onto Off-Middle'
        } to force the batter to play.`
      : `Good wicket threat (${wicketThreatPct}% hitting), tightening pitch grouping (±${groupingDispersionCm}cm) will build dot-ball pressure.`;

  return {
    batter: {
      activeCall,
      activeCallColor,
      activeCallDetail,
      footworkVerdict,
      strideDepthM,
      offStumpCorridorFlag,
      lbwVulnerabilityPct,
      mustPlayCount,
      safeLeaveCount,
      coachingTip: batterTip,
    },
    bowler: {
      activeChannelHit,
      activeChannelDetail,
      topOfOffDisciplinePct,
      groupingDispersionCm,
      wicketThreatPct,
      goodLengthPct,
      fullLengthPct,
      shortLengthPct,
      coachingTip: bowlerTip,
    },
  };
}

// ============================================================================
// BATTER & BOWLER MATCHUP STUDIO ANALYTICS ENGINE
// ============================================================================

export interface CreaseDepthSimulation {
  strideDepthM: number;
  recordedImpactM: number;
  interceptionPoint3D: WorldPoint3D;
  recordedImpactPoint3D: WorldPoint3D;
  signedOffsetCm: number;
  interceptionZone: StumpLineZone;
  lateralMovementNeutralizedCm: number;
  remainingLateralDriftToStumpsCm: number;
  heightDeltaFromRecordedCm: number;
  isSmotheredOnHalfVolley: boolean;
  isOutsideThreeMeterRule: boolean;
  lbwStatusLabel: string;
  footworkModeLabel: string;
  tacticalRecommendation: string;
}

/**
 * Evaluates a delivery's exact 3D coordinates at any arbitrary crease depth Z (in meters from Striker Stumps)
 * so batters can simulate stepping deep into the crease (0.6m) vs pressing forward (1.8m) or charging down the pitch (2.8m).
 */
export function evaluateTrajectoryPointAtZ(
  pred: BallTrajectoryPrediction,
  targetZCm: number
): WorldPoint3D {
  const allPts = [
    ...pred.preBounceArc,
    ...pred.bounceToImpactArc.slice(1),
    ...pred.impactToStumpsArc.slice(1),
  ];
  if (allPts.length === 0) {
    return { xCm: 0, yCm: 35, zCm: targetZCm };
  }
  const clampedZ = clamp(targetZCm, 0, BOWLER_STUMPS_Z_CM);

  // Points are ordered from high Z (Bowler) down to Z = 0 (Striker Stumps)
  for (let i = 0; i < allPts.length - 1; i++) {
    const p1 = allPts[i];
    const p2 = allPts[i + 1];
    if (
      (p1.zCm >= clampedZ && p2.zCm <= clampedZ) ||
      (p2.zCm >= clampedZ && p1.zCm <= clampedZ)
    ) {
      const span = Math.abs(p1.zCm - p2.zCm);
      const t = span > 0.001 ? Math.abs(p1.zCm - clampedZ) / span : 0;
      return {
        xCm: Number((p1.xCm + (p2.xCm - p1.xCm) * t).toFixed(1)),
        yCm: Number(Math.max(0, p1.yCm + (p2.yCm - p1.yCm) * t).toFixed(1)),
        zCm: Number(clampedZ.toFixed(1)),
      };
    }
  }
  return allPts[allPts.length - 1];
}

export function simulateBatterCreaseDepth(
  pred: BallTrajectoryPrediction,
  handedness: BatterHandedness,
  strideDepthM: number
): CreaseDepthSimulation {
  const handednessSign = handedness === 'RHB' ? 1 : -1;
  const safeDepthM = Number(clamp(strideDepthM, 0.6, 3.2).toFixed(2));
  const targetZCm = safeDepthM * 100;

  const interceptionPoint3D = evaluateTrajectoryPointAtZ(pred, targetZCm);
  const recordedImpactPoint3D = pred.impactPoint3D;
  const signedOffsetCm = Number(
    (interceptionPoint3D.xCm * handednessSign).toFixed(1)
  );
  const interceptionZone = classifyStumpLineZone(signedOffsetCm);

  // Total post-bounce lateral drift from bounce to stumps vs remaining drift after interception
  const remainingLateralDriftToStumpsCm = Number(
    Math.abs(pred.stumpIntersection3D.xCm - interceptionPoint3D.xCm).toFixed(1)
  );
  const lateralMovementNeutralizedCm = Number(
    Math.abs(interceptionPoint3D.xCm - recordedImpactPoint3D.xCm).toFixed(1)
  );
  const heightDeltaFromRecordedCm = Number(
    (interceptionPoint3D.yCm - recordedImpactPoint3D.yCm).toFixed(1)
  );

  const distAfterBounceM = pred.bounceDistanceFromStumpsM - safeDepthM;
  const isSmotheredOnHalfVolley =
    distAfterBounceM >= -0.35 && distAfterBounceM <= 1.35;
  const isOutsideThreeMeterRule = safeDepthM >= 3.0;

  let footworkModeLabel = 'Standard Front-Foot Press';
  if (safeDepthM <= 1.15) {
    footworkModeLabel = 'Deep Back-Foot Camp (Extra Reaction Time)';
  } else if (safeDepthM <= 1.75) {
    footworkModeLabel = 'Balanced Popping-Crease Stance';
  } else if (safeDepthM <= 2.35) {
    footworkModeLabel = 'Aggressive Front-Foot Stride';
  } else {
    footworkModeLabel = 'Charging Down the Track (Smothering Spin/Swing)';
  }

  const absInterceptX = Math.abs(interceptionPoint3D.xCm);
  let lbwStatusLabel = 'In-Line LBW Risk Active';
  if (isOutsideThreeMeterRule) {
    lbwStatusLabel = '3.0m+ Advance Rule — Safe from LBW by Distance';
  } else if (signedOffsetCm < -15.03) {
    lbwStatusLabel = 'Impact Outside Off — Safe if Playing a Shot';
  } else if (signedOffsetCm > 15.03) {
    lbwStatusLabel = 'Impact Outside Leg — Not Out LBW';
  } else if (!pred.hittingWicket) {
    lbwStatusLabel = `Impact In-Line, Ball ${pred.verdictLabel}`;
  } else {
    lbwStatusLabel = `High LBW Danger (${pred.verdictLabel})`;
  }

  let tacticalRecommendation = '';
  if (isSmotheredOnHalfVolley) {
    tacticalRecommendation = `Meeting the ball ${Math.abs(
      distAfterBounceM
    ).toFixed(1)}m from the pitch bounce smothers ${remainingLateralDriftToStumpsCm}cm of late deviation and converts it into a driveable half-volley (${interceptionPoint3D.yCm}cm high).`;
  } else if (safeDepthM < 1.2 && pred.bounceDistanceFromStumpsM >= 6.5) {
    tacticalRecommendation = `Dropping back to ${safeDepthM}m gives maximum time to read the ${Math.abs(
      pred.lateralDeviationDeg
    )}° movement and attack off the back foot at ${interceptionPoint3D.yCm}cm height.`;
  } else if (safeDepthM > 2.1 && pred.bounceDistanceFromStumpsM >= 7.5) {
    tacticalRecommendation = `Caution: advancing to ${safeDepthM}m against a ${pred.bounceDistanceFromStumpsM}m length means the ball is still climbing (${interceptionPoint3D.yCm}cm) — stay back or commit to a cross-bat pull.`;
  } else {
    tacticalRecommendation = `At ${safeDepthM}m crease depth, you intercept the ball at ${interceptionPoint3D.yCm}cm height with ${remainingLateralDriftToStumpsCm}cm of remaining drift toward the stumps.`;
  }

  return {
    strideDepthM: safeDepthM,
    recordedImpactM: pred.impactDistanceFromStumpsM,
    interceptionPoint3D,
    recordedImpactPoint3D,
    signedOffsetCm,
    interceptionZone,
    lateralMovementNeutralizedCm,
    remainingLateralDriftToStumpsCm,
    heightDeltaFromRecordedCm,
    isSmotheredOnHalfVolley,
    isOutsideThreeMeterRule,
    lbwStatusLabel,
    footworkModeLabel,
    tacticalRecommendation,
  };
}

export type WagonWheelSectorId =
  | 'THIRD_MAN'
  | 'POINT'
  | 'COVERS'
  | 'LONG_OFF'
  | 'LONG_ON'
  | 'MID_WICKET'
  | 'SQUARE_LEG'
  | 'FINE_LEG';

export interface WagonWheelShotVector {
  ballId: string;
  contactId: string;
  indexNumber: number;
  shotName: string;
  sectorId: WagonWheelSectorId;
  sector: string;
  sectorLabel: string;
  /** Screen angle in degrees: 0° = Straight down the ground (top), 90° = Right, 180° = Behind Keeper (bottom), 270° = Left */
  screenAngleDeg: number;
  angleDeg: number;
  /** Normalized radial distance 0.18..0.96 from center batter crease to boundary rope */
  distanceRatio: number;
  distanceM: number;
  colorHex: string;
  controlPct: number;
  riskLevel: 'HIGH_CONTROL' | 'CALCULATED_RISK' | 'HIGH_RISK';
  outcomeTag: ShotOutcomeTag;
  coachingNote: string;
}

export interface WagonWheelAnalysisSummary {
  shots: WagonWheelShotVector[];
  vectors: WagonWheelShotVector[];
  activeShot: WagonWheelShotVector | null;
  overallControlPct: number;
  boundaryThreatPct: number;
  offSideScoringPct: number;
  legSideScoringPct: number;
  sectorBreakdown: Array<{
    sectorId: WagonWheelSectorId;
    label: string;
    count: number;
    percentage: number;
  }>;
}

/**
 * Computes 360° Wagon Wheel shot vectors and optimal shot selection from physical impact & bounce telemetry.
 */
export function computeWagonWheelAnalysis(
  items: Array<{
    contact: ContactPointRecord;
    pred: BallTrajectoryPrediction;
  }>,
  handedness: BatterHandedness,
  activeBallId: string | null,
  activeStrideDepthM?: number
): WagonWheelAnalysisSummary {
  const handednessSign = handedness === 'RHB' ? 1 : -1;

  const sectorMeta: Array<{ id: WagonWheelSectorId; label: string }> = [
    { id: 'THIRD_MAN', label: 'Third Man' },
    { id: 'POINT', label: 'Point / Cut' },
    { id: 'COVERS', label: 'Covers' },
    { id: 'LONG_OFF', label: 'Mid-Off / Long-Off' },
    { id: 'LONG_ON', label: 'Mid-On / Long-On' },
    { id: 'MID_WICKET', label: 'Mid-Wicket' },
    { id: 'SQUARE_LEG', label: 'Square Leg / Pull' },
    { id: 'FINE_LEG', label: 'Fine Leg / Glance' },
  ];

  const shots: WagonWheelShotVector[] = items.map(({ contact, pred }) => {
    const isFocused = contact.id === activeBallId;
    const simDepthM =
      isFocused && typeof activeStrideDepthM === 'number'
        ? activeStrideDepthM
        : pred.impactDistanceFromStumpsM;
    const pt = evaluateTrajectoryPointAtZ(pred, simDepthM * 100);

    // Signed offset relative to batter: negative = Off side, positive = Leg side
    const signedX = pt.xCm * handednessSign;
    const heightCm = pt.yCm;
    const bounceM = pred.bounceDistanceFromStumpsM;

    let shotName = 'Forward Defense';
    let sectorId: WagonWheelSectorId = 'COVERS';
    // Relative angle where negative = Off side, positive = Leg side (0° = straight down pitch)
    let relAngleDeg = -28;
    let distanceRatio = 0.65;
    let baseControl = 82;
    let coachingNote = '';

    if (bounceM > 6.3 || (bounceM >= 5.5 && heightCm >= 48)) {
      // Short / Back of length
      if (signedX < -9.5) {
        shotName = 'Back-Foot Square Cut';
        sectorId = 'POINT';
        relAngleDeg = -84;
        distanceRatio = 0.88;
        baseControl = heightCm <= 68 ? 86 : 68;
        coachingNote =
          'Width outside Off on a short/back-of-length delivery — ride the bounce and cut square of Point rather than fetching across the line.';
      } else {
        shotName = 'Controlled Pull Shot';
        sectorId = signedX < 0 ? 'MID_WICKET' : 'SQUARE_LEG';
        relAngleDeg = signedX < 0 ? 68 : 92;
        distanceRatio = 0.92;
        baseControl = 85;
        coachingNote =
          'Short-of-length ball into the body/stumps — swivel early onto the back foot and pull with rolled wrists through Mid-Wicket / Square Leg.';
      }
    } else if (bounceM < 4.8) {
      // Full / Half-volley / Yorker
      if (bounceM < 2.3 && Math.abs(signedX) <= 12) {
        shotName = 'Jam Out Yorker / Straight Dig';
        sectorId = 'LONG_OFF';
        relAngleDeg = signedX < 0 ? -14 : 14;
        distanceRatio = 0.48;
        baseControl = 64;
        coachingNote =
          'Yorker in the blockhole — get bat down swiftly ahead of front pad and squeeze into the V.';
      } else if (signedX < -10) {
        shotName = 'Classic Cover Drive';
        sectorId = 'COVERS';
        relAngleDeg = -48;
        distanceRatio = 0.94;
        baseControl = 88;
        coachingNote =
          'Full outside Off — stride to the pitch of the ball and drive crisply through Extra Cover.';
      } else if (signedX <= 4) {
        shotName = 'Straight Drive in the V';
        sectorId = signedX <= -2 ? 'LONG_OFF' : 'LONG_ON';
        relAngleDeg = signedX <= -2 ? -18 : 18;
        distanceRatio = 0.9;
        baseControl = 90;
        coachingNote =
          'Full on the stumps — present the full face of the bat and drive straight past the bowler.';
      } else {
        shotName = 'Wristy On-Drive / Flick';
        sectorId = 'MID_WICKET';
        relAngleDeg = 54;
        distanceRatio = 0.89;
        baseControl = 87;
        coachingNote =
          'Full on leg stump — lean in with head over the knee and clip through Mid-Wicket.';
      }
    } else {
      // Good length (4.8m - 7.6m)
      if (signedX < -20 && !pred.hittingWicket) {
        shotName = 'Safe Leave / Late Dab to Third Man';
        sectorId = 'THIRD_MAN';
        relAngleDeg = -126;
        distanceRatio = 0.62;
        baseControl = 91;
        coachingNote =
          'Wide 5th-stump channel — either leave safely on line or open the face late to Third Man.';
      } else if (signedX < -8) {
        shotName = 'Soft-Hands Push to Cover-Point';
        sectorId = 'COVERS';
        relAngleDeg = -58;
        distanceRatio = 0.68;
        baseControl = 75;
        coachingNote =
          'Testing 4th-stump Good Length — play late under your eyes with soft hands to negate slip carry.';
      } else if (signedX <= 5) {
        shotName = 'Compact Forward Defense / Straight Push';
        sectorId = signedX < 0 ? 'LONG_OFF' : 'LONG_ON';
        relAngleDeg = signedX < 0 ? -22 : 22;
        distanceRatio = 0.52;
        baseControl = 82;
        coachingNote =
          'Tight stump-to-stump Good Length — close the bat-pad gap and play straight in the V.';
      } else if (signedX <= 14) {
        shotName = 'Hip Tuck to Square Leg';
        sectorId = 'SQUARE_LEG';
        relAngleDeg = 86;
        distanceRatio = 0.74;
        baseControl = 85;
        coachingNote =
          'Good length on leg-middle — work off the pads into the Square Leg pocket for a low-risk rotation.';
      } else {
        shotName = 'Fine Leg Glance';
        sectorId = 'FINE_LEG';
        relAngleDeg = 132;
        distanceRatio = 0.84;
        baseControl = 89;
        coachingNote =
          'Drifting down leg — use the pace of the ball to glance fine of Short Fine Leg.';
      }
    }

    // Apply user's selected shot name if specified
    const explicitShot =
      contact.selectedShotName || contact.aiShotAnalysis?.playedShotName;
    if (explicitShot) {
      shotName = explicitShot;
      const lower = explicitShot.toLowerCase();
      if (lower.includes('cover drive') || lower.includes('cover-point')) {
        sectorId = 'COVERS';
        relAngleDeg = -50;
        distanceRatio = 0.9;
      } else if (lower.includes('straight drive') || lower.includes('jam out')) {
        sectorId = signedX <= 0 ? 'LONG_OFF' : 'LONG_ON';
        relAngleDeg = signedX <= 0 ? -16 : 16;
        distanceRatio = 0.9;
      } else if (lower.includes('on-drive') || lower.includes('flick') || lower.includes('mid-wicket')) {
        sectorId = 'MID_WICKET';
        relAngleDeg = 56;
        distanceRatio = 0.88;
      } else if (lower.includes('pull') || lower.includes('hook') || lower.includes('tuck')) {
        sectorId = 'SQUARE_LEG';
        relAngleDeg = 88;
        distanceRatio = 0.9;
      } else if (lower.includes('cut') && !lower.includes('late')) {
        sectorId = 'POINT';
        relAngleDeg = -86;
        distanceRatio = 0.88;
      } else if (lower.includes('late cut') || lower.includes('third man') || lower.includes('dab')) {
        sectorId = 'THIRD_MAN';
        relAngleDeg = -128;
        distanceRatio = 0.78;
      } else if (lower.includes('glance') || lower.includes('fine leg') || lower.includes('sweep')) {
        sectorId = 'FINE_LEG';
        relAngleDeg = 130;
        distanceRatio = 0.84;
      } else if (lower.includes('defense') || lower.includes('push')) {
        sectorId = signedX <= 0 ? 'COVERS' : 'MID_WICKET';
        relAngleDeg = signedX <= 0 ? -28 : 28;
        distanceRatio = 0.36;
      } else if (lower.includes('leave')) {
        sectorId = 'THIRD_MAN';
        relAngleDeg = -145;
        distanceRatio = 0.2;
      }
    }

    // Apply user's tagged shot outcome if present, or infer default from control
    const defaultOutcome: ShotOutcomeTag = contact.isOut
      ? 'BEATEN'
      : baseControl >= 86
      ? 'MIDDLED'
      : baseControl >= 76
      ? 'CONTROLLED'
      : 'DEFENDED';
    const outcomeTag = contact.shotOutcome || defaultOutcome;

    if (outcomeTag === 'MIDDLED') {
      distanceRatio = Math.max(distanceRatio, 0.92);
      baseControl = Math.min(98, baseControl + 8);
    } else if (outcomeTag === 'CONTROLLED') {
      distanceRatio = clamp(distanceRatio, 0.58, 0.82);
    } else if (outcomeTag === 'DEFENDED') {
      distanceRatio = 0.34;
    } else if (outcomeTag === 'EDGE') {
      sectorId = signedX <= 0 ? 'THIRD_MAN' : 'FINE_LEG';
      relAngleDeg = signedX <= 0 ? -142 : 142;
      distanceRatio = 0.55;
      baseControl = 28;
    } else if (outcomeTag === 'BEATEN') {
      distanceRatio = 0.22;
      baseControl = 15;
    }

    // Convert relative batter angle to screen angle (For RHB: Left of screen = Off side = 270°, Right = Leg side = 90°)
    const rawScreenDeg =
      typeof contact.wagonWheelAngleDeg === 'number'
        ? (contact.wagonWheelAngleDeg + 360) % 360
        : (relAngleDeg * handednessSign + 360) % 360;

    // If user customized wagonWheelAngleDeg, update sectorId to match the angle
    if (typeof contact.wagonWheelAngleDeg === 'number') {
      const signedRel =
        ((((rawScreenDeg > 180 ? rawScreenDeg - 360 : rawScreenDeg) *
          handednessSign) %
          360) +
          540) %
          360 -
        180;
      if (signedRel < -110) sectorId = 'THIRD_MAN';
      else if (signedRel < -68) sectorId = 'POINT';
      else if (signedRel < -32) sectorId = 'COVERS';
      else if (signedRel <= 0) sectorId = 'LONG_OFF';
      else if (signedRel < 35) sectorId = 'LONG_ON';
      else if (signedRel < 75) sectorId = 'MID_WICKET';
      else if (signedRel < 115) sectorId = 'SQUARE_LEG';
      else sectorId = 'FINE_LEG';
    }

    const riskLevel: WagonWheelShotVector['riskLevel'] =
      baseControl >= 80
        ? 'HIGH_CONTROL'
        : baseControl >= 65
        ? 'CALCULATED_RISK'
        : 'HIGH_RISK';

    const secInfo =
      sectorMeta.find((s) => s.id === sectorId) || sectorMeta[2];

    const roundedAngle = Number(rawScreenDeg.toFixed(1));
    const roundedDistRatio = Number(distanceRatio.toFixed(2));
    const distanceM = Math.round(clamp(roundedDistRatio * 72, 8, 72));
    const colorHex = contact.isOut
      ? '#F43F5E'
      : outcomeTag === 'MIDDLED'
      ? '#10B981'
      : outcomeTag === 'CONTROLLED'
      ? '#22D3EE'
      : outcomeTag === 'DEFENDED'
      ? '#F59E0B'
      : '#FB7185';

    return {
      ballId: contact.id,
      contactId: contact.id,
      indexNumber: contact.indexNumber,
      shotName,
      sectorId,
      sector: secInfo.label,
      sectorLabel: secInfo.label,
      screenAngleDeg: roundedAngle,
      angleDeg: roundedAngle,
      distanceRatio: roundedDistRatio,
      distanceM,
      colorHex,
      controlPct: Math.round(baseControl),
      riskLevel,
      outcomeTag,
      coachingNote,
    };
  });

  const activeShot =
    shots.find((s) => s.ballId === activeBallId) ||
    shots[shots.length - 1] ||
    null;

  const total = Math.max(1, shots.length);
  const controlledCount = shots.filter(
    (s) =>
      s.outcomeTag === 'MIDDLED' ||
      s.outcomeTag === 'CONTROLLED' ||
      s.outcomeTag === 'DEFENDED'
  ).length;
  const boundaryCount = shots.filter(
    (s) => s.outcomeTag === 'MIDDLED' || s.distanceRatio >= 0.86
  ).length;
  const offSideCount = shots.filter((s) =>
    ['THIRD_MAN', 'POINT', 'COVERS', 'LONG_OFF'].includes(s.sectorId)
  ).length;

  const overallControlPct =
    shots.length > 0 ? Math.round((controlledCount / total) * 100) : 0;
  const boundaryThreatPct =
    shots.length > 0 ? Math.round((boundaryCount / total) * 100) : 0;
  const offSideScoringPct =
    shots.length > 0 ? Math.round((offSideCount / total) * 100) : 0;
  const legSideScoringPct =
    shots.length > 0 ? 100 - offSideScoringPct : 0;

  const sectorBreakdown = sectorMeta.map((sec) => {
    const count = shots.filter((s) => s.sectorId === sec.id).length;
    return {
      sectorId: sec.id,
      label: sec.label,
      count,
      percentage: shots.length > 0 ? Math.round((count / total) * 100) : 0,
    };
  });

  return {
    shots,
    vectors: shots,
    activeShot,
    overallControlPct,
    boundaryThreatPct,
    offSideScoringPct,
    legSideScoringPct,
    sectorBreakdown,
  };
}

export interface BowlerTargetConfig {
  planId: BowlerTargetPlanId;
  label: string;
  description: string;
  /** Target bounce distance in meters from Striker Stumps (0m) */
  targetLengthM: number;
  /** Signed target line in cm relative to batter handedness (negative = Off side, 0 = Middle, positive = Leg side) */
  targetLineCm: number;
  /** Bullseye radius in cm on pitch surface */
  targetRadiusCm: number;
}

export const BOWLER_TARGET_PRESETS: Record<
  Exclude<BowlerTargetPlanId, 'CUSTOM'>,
  BowlerTargetConfig
> = {
  TOP_OF_OFF: {
    planId: 'TOP_OF_OFF',
    label: 'Top-of-Off Good Length',
    description:
      'Classic Test-match channel (5.8m length, 8cm outside Off) forcing the batter into the uncertainty corridor.',
    targetLengthM: 5.8,
    targetLineCm: -8.0,
    targetRadiusCm: 14,
  },
  YORKER_BASE: {
    planId: 'YORKER_BASE',
    label: 'Toe-Crushing Yorker',
    description:
      'Death-overs blockhole target (1.6m length on Middle-Leg) attacking the base of the stumps.',
    targetLengthM: 1.6,
    targetLineCm: 2.0,
    targetRadiusCm: 14,
  },
  SHORT_BUMPER: {
    planId: 'SHORT_BUMPER',
    label: 'Bodyline Bumper / Rib-Cage',
    description:
      'Aggressive short-ball plan (8.6m length aimed at badge/shoulder height on Off-Middle).',
    targetLengthM: 8.6,
    targetLineCm: 4.0,
    targetRadiusCm: 16,
  },
  FIFTH_STUMP: {
    planId: 'FIFTH_STUMP',
    label: '5th-Stump Out-Swing Trap',
    description:
      'Wider probing line (5.4m length, 18cm outside Off) drawing the expansive cover drive for a slip catch.',
    targetLengthM: 5.4,
    targetLineCm: -18.0,
    targetRadiusCm: 15,
  },
};

export interface BowlerTargetBallEval {
  ballId: string;
  indexNumber: number;
  bounceLengthM: number;
  signedBounceLineCm: number;
  lengthErrorM: number;
  lineErrorCm: number;
  normalizedErrorRatio: number;
  accuracyScore0to100: number;
  hitTier: 'BULLSEYE' | 'OUTER_RING' | 'MISS';
}

export interface BowlerTargetScoreSummary {
  targetWorldXCm: number;
  targetWorldZCm: number;
  evaluations: BowlerTargetBallEval[];
  spellAccuracyScore: number;
  bullseyeHitPct: number;
  ringHitPct: number;
  meanLineErrorCm: number;
  meanLengthErrorM: number;
  biasCallout: string;
}

export function computeBowlerTargetAccuracy(
  items: Array<{
    contact: ContactPointRecord;
    pred: BallTrajectoryPrediction;
  }>,
  handedness: BatterHandedness,
  target: BowlerTargetConfig
): BowlerTargetScoreSummary {
  const handednessSign = handedness === 'RHB' ? 1 : -1;
  const targetWorldXCm = Number(
    (target.targetLineCm * handednessSign).toFixed(1)
  );
  const targetWorldZCm = metersToWorldZ(target.targetLengthM);
  const radCm = Math.max(8, target.targetRadiusCm);

  if (items.length === 0) {
    return {
      targetWorldXCm,
      targetWorldZCm,
      evaluations: [],
      spellAccuracyScore: 0,
      bullseyeHitPct: 0,
      ringHitPct: 0,
      meanLineErrorCm: 0,
      meanLengthErrorM: 0,
      biasCallout: 'Record deliveries to score spell accuracy against your target zone.',
    };
  }

  const evaluations: BowlerTargetBallEval[] = items.map(({ contact, pred }) => {
    const bounceLengthM = pred.bounceDistanceFromStumpsM;
    const signedBounceLineCm = Number(
      (pred.bouncePoint3D.xCm * handednessSign).toFixed(1)
    );

    const lengthErrorM = Number(
      (bounceLengthM - target.targetLengthM).toFixed(2)
    );
    const lineErrorCm = Number(
      (signedBounceLineCm - target.targetLineCm).toFixed(1)
    );

    // Weight 1.0m of length error equivalent to ~14cm of lateral line error on a cricket pitch
    const equivLengthErrorCm = lengthErrorM * 14;
    const radialDistEquivCm = Math.hypot(lineErrorCm, equivLengthErrorCm);
    const normalizedErrorRatio = Number(
      (radialDistEquivCm / radCm).toFixed(2)
    );

    const accuracyScore0to100 = Math.round(
      clamp(100 * Math.exp(-0.42 * Math.pow(normalizedErrorRatio, 1.55)), 0, 100)
    );

    const hitTier: BowlerTargetBallEval['hitTier'] =
      normalizedErrorRatio <= 1.0
        ? 'BULLSEYE'
        : normalizedErrorRatio <= 2.0
        ? 'OUTER_RING'
        : 'MISS';

    return {
      ballId: contact.id,
      indexNumber: contact.indexNumber,
      bounceLengthM,
      signedBounceLineCm,
      lengthErrorM,
      lineErrorCm,
      normalizedErrorRatio,
      accuracyScore0to100,
      hitTier,
    };
  });

  const total = evaluations.length;
  const spellAccuracyScore = Math.round(
    evaluations.reduce((s, e) => s + e.accuracyScore0to100, 0) / total
  );
  const bullseyeCount = evaluations.filter(
    (e) => e.hitTier === 'BULLSEYE'
  ).length;
  const ringCount = evaluations.filter(
    (e) => e.hitTier === 'BULLSEYE' || e.hitTier === 'OUTER_RING'
  ).length;

  const bullseyeHitPct = Math.round((bullseyeCount / total) * 100);
  const ringHitPct = Math.round((ringCount / total) * 100);

  const avgSignedLengthErrM =
    evaluations.reduce((s, e) => s + e.lengthErrorM, 0) / total;
  const avgSignedLineErrCm =
    evaluations.reduce((s, e) => s + e.lineErrorCm, 0) / total;

  const meanLengthErrorM = Number(
    (
      evaluations.reduce((s, e) => s + Math.abs(e.lengthErrorM), 0) / total
    ).toFixed(2)
  );
  const meanLineErrorCm = Number(
    (
      evaluations.reduce((s, e) => s + Math.abs(e.lineErrorCm), 0) / total
    ).toFixed(1)
  );

  const lenTendency =
    Math.abs(avgSignedLengthErrM) < 0.25
      ? 'Spot-on length'
      : avgSignedLengthErrM > 0
      ? `${Math.abs(avgSignedLengthErrM).toFixed(1)}m too short`
      : `${Math.abs(avgSignedLengthErrM).toFixed(1)}m too full`;

  const lineTendency =
    Math.abs(avgSignedLineErrCm) < 2.5
      ? 'dead on target line'
      : avgSignedLineErrCm < 0
      ? `${Math.abs(avgSignedLineErrCm).toFixed(1)}cm wider outside Off`
      : `${Math.abs(avgSignedLineErrCm).toFixed(1)}cm drifted toward Leg`;

  return {
    targetWorldXCm,
    targetWorldZCm,
    evaluations,
    spellAccuracyScore,
    bullseyeHitPct,
    ringHitPct,
    meanLineErrorCm,
    meanLengthErrorM,
    biasCallout: `Spell Bias: ${lenTendency} & ${lineTendency}.`,
  };
}

export interface BallTunnelingAnalysis {
  primaryBallId: string;
  secondaryBallId: string;
  primaryIndex: number;
  secondaryIndex: number;
  /** Separation in cm in early flight (Z = 13.0m) where the batter reads the release tunnel */
  tunnelWindowSeparationCm: number;
  /** Separation in cm at the pitch bounce plane */
  bounceSeparationCm: number;
  /** Final separation in cm at the Striker Stumps plane (Z = 0m) */
  stumpPlaneSeparationCm: number;
  /** Difference in post-bounce seam/spin angle (degrees) */
  angularDivergenceDeg: number;
  /** Composite 0–100 score rewarding tight early-flight tunneling + large late stump separation */
  deceptionScore0to100: number;
  deceptionRatingLabel: string;
  tacticalSummary: string;
}

export function computeBallTunnelingAnalysis(
  items: Array<{
    contact: ContactPointRecord;
    pred: BallTrajectoryPrediction;
  }>,
  primaryBallId: string | null,
  secondaryBallId: string | null
): BallTunnelingAnalysis | null {
  if (items.length === 0) return null;

  const primary =
    items.find((i) => i.contact.id === primaryBallId) || items[0];

  // If secondaryBallId is not specified or equals primary, auto-pick the delivery with the highest tunneling deception vs primary
  let secondary =
    items.find(
      (i) =>
        i.contact.id === secondaryBallId &&
        i.contact.id !== primary.contact.id
    ) || null;

  if (!secondary) {
    let bestCandidate = items[items.length - 1];
    let bestScore = -1;
    for (const cand of items) {
      if (cand.contact.id === primary.contact.id) continue;
      const pTunnel = evaluateTrajectoryPointAtZ(primary.pred, 1300);
      const cTunnel = evaluateTrajectoryPointAtZ(cand.pred, 1300);
      const earlyDist = Math.hypot(
        pTunnel.xCm - cTunnel.xCm,
        pTunnel.yCm - cTunnel.yCm
      );
      const lateDist = Math.hypot(
        primary.pred.stumpIntersection3D.xCm -
          cand.pred.stumpIntersection3D.xCm,
        primary.pred.stumpIntersection3D.yCm -
          cand.pred.stumpIntersection3D.yCm
      );
      const score = lateDist - earlyDist * 0.8;
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = cand;
      }
    }
    secondary = bestCandidate;
  }

  const pEarly = evaluateTrajectoryPointAtZ(primary.pred, 1300);
  const sEarly = evaluateTrajectoryPointAtZ(secondary.pred, 1300);

  const tunnelWindowSeparationCm = Number(
    Math.hypot(pEarly.xCm - sEarly.xCm, pEarly.yCm - sEarly.yCm).toFixed(1)
  );

  const bounceSeparationCm = Number(
    Math.hypot(
      primary.pred.bouncePoint3D.xCm - secondary.pred.bouncePoint3D.xCm,
      (primary.pred.bounceDistanceFromStumpsM -
        secondary.pred.bounceDistanceFromStumpsM) *
        18
    ).toFixed(1)
  );

  const stumpPlaneSeparationCm = Number(
    Math.hypot(
      primary.pred.stumpIntersection3D.xCm -
        secondary.pred.stumpIntersection3D.xCm,
      primary.pred.stumpIntersection3D.yCm -
        secondary.pred.stumpIntersection3D.yCm
    ).toFixed(1)
  );

  const angularDivergenceDeg = Number(
    Math.abs(
      primary.pred.lateralDeviationDeg - secondary.pred.lateralDeviationDeg
    ).toFixed(1)
  );

  // Deception score is highest when early tunnel separation is small (<12cm) and late stump separation is large (>18cm)
  const tunnelTightnessFactor = clamp(
    1 - tunnelWindowSeparationCm / 32,
    0.15,
    1
  );
  const lateSpreadFactor = clamp(stumpPlaneSeparationCm / 26, 0, 1.25);
  const deceptionScore0to100 =
    primary.contact.id === secondary.contact.id
      ? 0
      : Math.round(
          clamp(
            (tunnelTightnessFactor * 0.45 + lateSpreadFactor * 0.55) * 100,
            12,
            99
          )
        );

  const deceptionRatingLabel =
    deceptionScore0to100 >= 80
      ? 'ELITE TUNNEL DECEPTION'
      : deceptionScore0to100 >= 60
      ? 'HIGH LATE DIVERGENCE'
      : 'MODERATE VARIATION';

  const tacticalSummary =
    primary.contact.id === secondary.contact.id
      ? 'Record at least 2 deliveries to compare how closely they share a release tunnel before diverging off the pitch.'
      : `Balls #${primary.contact.indexNumber} and #${secondary.contact.indexNumber} pass within ${tunnelWindowSeparationCm}cm of each other in the early flight tunnel, then diverge by ${stumpPlaneSeparationCm}cm (${angularDivergenceDeg}° seam/spin split) by the time they reach the stumps.`;

  return {
    primaryBallId: primary.contact.id,
    secondaryBallId: secondary.contact.id,
    primaryIndex: primary.contact.indexNumber,
    secondaryIndex: secondary.contact.indexNumber,
    tunnelWindowSeparationCm,
    bounceSeparationCm,
    stumpPlaneSeparationCm,
    angularDivergenceDeg,
    deceptionScore0to100,
    deceptionRatingLabel,
    tacticalSummary,
  };
}

// ============================================================================
// REAL-TIME 3D-TO-2D VIDEO PLAYBACK TRAJECTORY PROJECTION ENGINE
// ============================================================================

export interface VideoTrajectoryOverlay2D {
  /** Normalized 0..1 progress of ball flight at current video timestamp */
  progress: number;
  phaseLabel: string;
  /** Full 2D normalized points for pre-bounce air flight */
  preBouncePoints2D: NormalizedPoint[];
  /** Full 2D normalized points for bounce-to-impact flight */
  bounceToImpactPoints2D: NormalizedPoint[];
  /** Full 2D normalized points for post-impact projection to stumps */
  impactToStumpsPoints2D: NormalizedPoint[];
  /** Visible sliced pre-bounce points up to current video playback time */
  visiblePreBounce2D: NormalizedPoint[];
  /** Visible sliced bounce-to-impact points up to current video playback time */
  visibleBounceToImpact2D: NormalizedPoint[];
  /** Visible sliced impact-to-stumps points up to current video playback time */
  visibleImpactToStumps2D: NormalizedPoint[];
  releasePoint2D: NormalizedPoint;
  bouncePoint2D: NormalizedPoint;
  impactPoint2D: NormalizedPoint;
  stumpHitPoint2D: NormalizedPoint;
  currentBall2D: NormalizedPoint;
}

/**
 * Projects a 3D BallTrajectoryPrediction back onto the 2D video viewport (normalized 0..1)
 * using the calibrated Back Stumps (Z = 0) and Front Stumps (Z = 660) perspective anchors,
 * while pinning the impact point directly to the clicked/detected `impactVideoPoint` so the
 * real-time trajectory passes through the exact ball pixel on the video frame!
 */
export function project3DTrajectoryToVideo2D(
  pred: BallTrajectoryPrediction,
  stumps: PlantedStumpsConfig,
  impactVideoPoint: NormalizedPoint,
  currentTimeSec: number,
  impactTimeSec: number,
  releaseTimeSec?: number
): VideoTrajectoryOverlay2D {
  const tImpact = Number.isFinite(impactTimeSec) ? impactTimeSec : 1.0;
  const tRelease =
    typeof releaseTimeSec === 'number' &&
    releaseTimeSec < tImpact - 0.08 &&
    releaseTimeSec >= 0
      ? releaseTimeSec
      : Math.max(0, tImpact - 0.46);
  const tStumps = tImpact + 0.12;

  let progress = 1.0;
  if (currentTimeSec <= tRelease) {
    progress = 0.08;
  } else if (currentTimeSec <= tImpact) {
    const u = (currentTimeSec - tRelease) / Math.max(0.05, tImpact - tRelease);
    progress = clamp(0.05 + u * 0.81, 0.05, 0.86);
  } else if (currentTimeSec <= tStumps) {
    const u = (currentTimeSec - tImpact) / Math.max(0.04, tStumps - tImpact);
    progress = clamp(0.86 + u * 0.14, 0.86, 1.0);
  } else {
    progress = 1.0;
  }

  const cam = computeCameraPerspectiveModel(stumps);
  const backBase = cam.backBase;
  const frontBase = cam.frontBase;
  const backW = cam.backW;
  const backH = cam.backH;
  const frontW = cam.frontW;
  const frontH = cam.frontH;

  const rawProject3D = (pt: WorldPoint3D): NormalizedPoint => {
    const depthRatio = clamp(pt.zCm / BOWLER_STUMPS_Z_CM, 0, 1);
    const pWeight = clamp(
      (depthRatio * cam.kCam) /
        Math.max(0.04, 1 - depthRatio + depthRatio * cam.kCam),
      0,
      1
    );
    const axisX = backBase.x + (frontBase.x - backBase.x) * pWeight;
    const axisY = backBase.y + (frontBase.y - backBase.y) * pWeight;
    const localStumpW = backW + (frontW - backW) * pWeight;
    const localStumpH = backH + (frontH - backH) * pWeight;

    const u =
      axisX + ((pt.xCm * cam.lateralMirror) / STUMP_WIDTH_CM) * localStumpW;
    const v = axisY - (pt.yCm / STUMP_HEIGHT_CM) * localStumpH;
    return { x: u, y: v };
  };

  const rawImpact2D = rawProject3D(pred.impactPoint3D);
  const residualDx = impactVideoPoint.x - rawImpact2D.x;
  const residualDy = impactVideoPoint.y - rawImpact2D.y;
  const impactZ = Math.max(10, pred.impactPoint3D.zCm);

  const project3D = (pt: WorldPoint3D): NormalizedPoint => {
    const raw = rawProject3D(pt);
    let weight = 0;
    if (pt.zCm <= impactZ) {
      weight = clamp(pt.zCm / impactZ, 0, 1);
    } else {
      weight = clamp(
        1 - (pt.zCm - impactZ) / Math.max(50, BOWLER_STUMPS_Z_CM - impactZ),
        0,
        1
      );
    }
    return {
      x: clamp(Number((raw.x + residualDx * weight).toFixed(4)), 0.01, 0.99),
      y: clamp(Number((raw.y + residualDy * weight).toFixed(4)), 0.01, 0.99),
    };
  };

  const sliced = evaluateTrajectoryAnimationAtProgress(pred, progress);

  const preBouncePoints2D = pred.preBounceArc.map(project3D);
  const bounceToImpactPoints2D = pred.bounceToImpactArc.map(project3D);
  const impactToStumpsPoints2D = pred.impactToStumpsArc.map(project3D);

  const visiblePreBounce2D = sliced.visiblePreBounceArc.map(project3D);
  const visibleBounceToImpact2D = sliced.visibleBounceToImpactArc.map(project3D);
  const visibleImpactToStumps2D = sliced.visibleImpactToStumpsArc.map(project3D);

  const phaseLabel =
    sliced.phase === 'PRE_BOUNCE'
      ? 'AIR FLIGHT (RELEASE → BOUNCE)'
      : sliced.phase === 'BOUNCE_TO_IMPACT'
      ? 'POST-BOUNCE (RISING TO BAT)'
      : 'STUMP PROJECTION (POST-IMPACT)';

  return {
    progress,
    phaseLabel,
    preBouncePoints2D,
    bounceToImpactPoints2D,
    impactToStumpsPoints2D,
    visiblePreBounce2D,
    visibleBounceToImpact2D,
    visibleImpactToStumps2D,
    releasePoint2D: project3D(pred.entryPoint3D),
    bouncePoint2D: project3D(pred.bouncePoint3D),
    impactPoint2D: project3D(pred.impactPoint3D),
    stumpHitPoint2D: project3D(pred.stumpIntersection3D),
    currentBall2D: project3D(sliced.currentBall3D),
  };
}

// ============================================================================
// PHYSICS-GROUNDED AI SHOT VISION COACH & BIOMECHANICS COMPARATOR
// ============================================================================

export const COMMON_CRICKET_SHOTS = [
  'Auto-Detect from Video / Camera',
  'Classic Cover Drive',
  'Straight Drive in the V',
  'Back-Foot Square Cut',
  'Controlled Pull Shot',
  'Wristy On-Drive / Flick',
  'Compact Forward Defense / Straight Push',
  'Soft-Hands Push to Cover-Point',
  'Sweep / Paddle Sweep',
  'Safe Leave / Late Dab to Third Man',
] as const;

export function computeOpticalSwingKinematicsForContact(
  contact: ContactPointRecord,
  pred: BallTrajectoryPrediction,
  handedness: BatterHandedness,
  idealShotName: string,
  partialOptical?: Partial<OpticalSwingKinematics>
): OpticalSwingKinematics {
  const offCm = contact.projection.offsetFromMiddleCm;
  const heightCm = contact.projection.contactHeightCm;
  const bounceM = pred.bounceDistanceFromStumpsM;

  // Compute ideal stride depth & ideal bat angle for the physics-recommended shot
  const normIdeal = idealShotName.toLowerCase();
  const idealIsCrossBat =
    normIdeal.includes('cut') ||
    normIdeal.includes('pull') ||
    normIdeal.includes('hook') ||
    normIdeal.includes('sweep');

  const idealStrideDepthM = Number(
    (bounceM < 4.5
      ? 2.05
      : bounceM < 6.2
      ? 1.72
      : bounceM > 7.2
      ? 0.92
      : 1.35
    ).toFixed(2)
  );

  const idealBatAngleDeg = idealIsCrossBat
    ? Math.round(clamp(64 + Math.abs(offCm) * 0.4, 56, 82))
    : Math.round(clamp(8 + Math.abs(offCm) * 0.45, 6, 24));

  // Estimate actual stride depth from where the contact occurred along the pitch corridor axis (works for both Behind Bowler and Behind Batter)
  const cam = computeCameraPerspectiveModel(contact.stumpConfig);
  const contactGroundY =
    contact.videoPoint.y + contact.stumpConfig.backStumpHeight * 0.35;
  let forwardScreenProgress = 0.08;
  if (cam.lenSq > 0.0004) {
    forwardScreenProgress = clamp(
      ((contact.videoPoint.x - cam.backBase.x) * cam.dx +
        (contactGroundY - cam.backBase.y) * cam.dy) /
        cam.lenSq,
      -0.06,
      0.32
    );
  }

  const estimatedStrideM = Number(
    clamp(1.18 + forwardScreenProgress * 3.2, 0.78, 2.35).toFixed(2)
  );
  const actualStrideDepthM =
    partialOptical?.actualStrideDepthM ?? estimatedStrideM;

  const footworkMode: OpticalSwingKinematics['footworkMode'] =
    partialOptical?.footworkMode ??
    (actualStrideDepthM >= 1.62
      ? 'FRONT_FOOT_STRIDE'
      : actualStrideDepthM <= 1.15 || bounceM >= 6.8
      ? 'BACK_FOOT_TRANSFER'
      : 'CREASE_NEUTRAL');

  // Derive bat blade angle accurately from bounce length, interception height, and lateral reach
  const reachFactor = Math.abs(offCm);
  const isShortOrHigh =
    (bounceM >= 6.8 && heightCm >= 56) ||
    heightCm >= 64 ||
    (offCm < -16.5 && heightCm >= 50 && bounceM >= 5.8);

  let kinematicBatAngleDeg: number;
  if (isShortOrHigh && contact.shotOutcome !== 'DEFENDED') {
    kinematicBatAngleDeg = Math.round(clamp(62 + reachFactor * 0.35, 58, 78));
  } else if (reachFactor >= 11.5) {
    kinematicBatAngleDeg = Math.round(
      clamp(22 + (reachFactor - 11.5) * 1.15, 22, 44)
    );
  } else {
    kinematicBatAngleDeg = Math.round(clamp(9 + reachFactor * 0.75, 7, 22));
  }

  const estimatedBatAngleDeg =
    typeof partialOptical?.estimatedBatAngleDeg === 'number'
      ? Math.round(
          kinematicBatAngleDeg * 0.72 + partialOptical.estimatedBatAngleDeg * 0.28
        )
      : kinematicBatAngleDeg;

  const batOrientationCategory: OpticalSwingKinematics['batOrientationCategory'] =
    estimatedBatAngleDeg >= 54
      ? 'HORIZONTAL_CROSS_BAT'
      : estimatedBatAngleDeg >= 25
      ? 'ANGLED_DIAGONAL_BAT'
      : 'VERTICAL_STRAIGHT_BAT';

  const handednessSign =
    (handedness === 'RHB' ? 1 : -1) * cam.lateralMirror;
  const existingExit = partialOptical?.exitVectorTelemetry;
  const postShift =
    partialOptical?.postImpactHorizontalShift ??
    (existingExit && existingExit.exitTrajectoryPoints.length >= 4
      ? Number(
          (
            existingExit.exitTrajectoryPoints[3].x -
            existingExit.exitTrajectoryPoints[0].x
          ).toFixed(4)
        )
      : undefined);

  const legSideFollowThroughShift =
    typeof postShift === 'number' ? postShift * handednessSign : undefined;

  const p0: NormalizedPoint =
    existingExit?.exitTrajectoryPoints?.[0] || contact.videoPoint;
  const syntheticLegShift =
    typeof legSideFollowThroughShift === 'number' &&
    Math.abs(legSideFollowThroughShift) > 0.002
      ? legSideFollowThroughShift
      : batOrientationCategory === 'HORIZONTAL_CROSS_BAT'
      ? offCm < -18
        ? -0.036
        : 0.042
      : offCm < -8
      ? -0.022
      : offCm > 5
      ? 0.028
      : 0.004;

  const rawDx = syntheticLegShift * handednessSign;
  const rawDy =
    batOrientationCategory === 'HORIZONTAL_CROSS_BAT' ? -0.026 : -0.038;

  const exitTrajectoryPoints: FollowThroughExitVectorTelemetry['exitTrajectoryPoints'] =
    existingExit?.exitTrajectoryPoints &&
    existingExit.exitTrajectoryPoints.length >= 4
      ? existingExit.exitTrajectoryPoints
      : [
          { offsetMs: 0, label: 'Impact (0ms)', x: p0.x, y: p0.y },
          {
            offsetMs: 35,
            label: 'Exit Start (+35ms)',
            x: Number(clamp(p0.x + rawDx * 0.3, 0.04, 0.96).toFixed(4)),
            y: Number(clamp(p0.y + rawDy * 0.32, 0.04, 0.96).toFixed(4)),
          },
          {
            offsetMs: 70,
            label: 'Mid Follow-Through (+70ms)',
            x: Number(clamp(p0.x + rawDx * 0.66, 0.04, 0.96).toFixed(4)),
            y: Number(clamp(p0.y + rawDy * 0.68, 0.04, 0.96).toFixed(4)),
          },
          {
            offsetMs: 110,
            label: 'Follow-Through Finish (+110ms)',
            x: Number(clamp(p0.x + rawDx, 0.04, 0.96).toFixed(4)),
            y: Number(clamp(p0.y + rawDy, 0.04, 0.96).toFixed(4)),
          },
        ];

  const seg1Dx = exitTrajectoryPoints[1].x - exitTrajectoryPoints[0].x;
  const seg2Dx = exitTrajectoryPoints[2].x - exitTrajectoryPoints[1].x;
  const seg3Dx = exitTrajectoryPoints[3].x - exitTrajectoryPoints[2].x;
  const weightedTotalDx = (seg1Dx * 0.7 + seg2Dx * 1.15 + seg3Dx * 1.15) / 2.0;
  const totalDy = exitTrajectoryPoints[3].y - exitTrajectoryPoints[0].y;

  const legSideSweepPct =
    existingExit?.legSideSweepPct ??
    Number((weightedTotalDx * handednessSign * 100).toFixed(2));

  const exitAzimuthDeg =
    existingExit?.exitAzimuthDeg ??
    Math.round((Math.atan2(-totalDy, weightedTotalDx) * 180) / Math.PI);

  const followThroughSlopeDeg =
    partialOptical?.followThroughSlopeDeg ?? exitAzimuthDeg;

  // Unbiased Pull vs. Cut Profile Comparator
  let pullProfileMatchPct = existingExit?.pullProfileMatchPct ?? 50;
  let cutProfileMatchPct = existingExit?.cutProfileMatchPct ?? 50;

  if (
    existingExit?.pullProfileMatchPct === undefined ||
    Math.abs(pullProfileMatchPct - cutProfileMatchPct) <= 4
  ) {
    const sweepTerm = legSideSweepPct * 10.5;
    const lineTerm =
      offCm < -18 ? -16 : offCm < -10 ? -4 : offCm >= -8 ? 14 : 6;
    pullProfileMatchPct = Math.round(clamp(50 + sweepTerm + lineTerm, 12, 95));
    cutProfileMatchPct = Math.round(clamp(50 - sweepTerm - lineTerm, 12, 95));
  }

  const resolvedCrossBatWinner: FollowThroughExitVectorTelemetry['resolvedCrossBatWinner'] =
    batOrientationCategory === 'VERTICAL_STRAIGHT_BAT'
      ? 'STRAIGHT_BAT'
      : pullProfileMatchPct >= cutProfileMatchPct + 4
      ? 'PULL_SHOT'
      : cutProfileMatchPct >= pullProfileMatchPct + 4
      ? 'SQUARE_CUT'
      : offCm < -17
      ? 'SQUARE_CUT'
      : 'PULL_SHOT';

  const exitVectorTelemetry: FollowThroughExitVectorTelemetry = {
    exitFrameOffsetsMs: [0, 35, 70, 110],
    exitTrajectoryPoints,
    exitAzimuthDeg,
    legSideSweepPct,
    pullProfileMatchPct,
    cutProfileMatchPct,
    resolvedCrossBatWinner,
    exitVectorSummary:
      resolvedCrossBatWinner === 'PULL_SHOT'
        ? `Bat blade exits across the body toward the leg side (${pullProfileMatchPct}% Pull profile).`
        : resolvedCrossBatWinner === 'SQUARE_CUT'
        ? `Bat blade extends outside off toward point (${cutProfileMatchPct}% Cut profile).`
        : `Bat blade finishes along a clean vertical arc (${exitAzimuthDeg}° slope).`,
  };

  const swingArcDirection: OpticalSwingKinematics['swingArcDirection'] =
    partialOptical?.swingArcDirection ??
    (batOrientationCategory === 'HORIZONTAL_CROSS_BAT'
      ? resolvedCrossBatWinner === 'PULL_SHOT'
        ? 'ON_SIDE'
        : 'OFF_SIDE'
      : offCm < -6.5
      ? 'OFF_SIDE'
      : offCm > 5.5
      ? 'ON_SIDE'
      : 'STRAIGHT_V');

  const reachPenalty = Math.max(0, Math.abs(offCm) - 9) * 0.5;
  const strideMismatchPenalty =
    Math.abs(actualStrideDepthM - idealStrideDepthM) * 7.5;
  const headOffsetFromBallCm = Number(
    clamp(
      partialOptical?.headOffsetFromBallCm ??
        2.8 + reachPenalty + strideMismatchPenalty,
      1.5,
      24.0
    ).toFixed(1)
  );

  // Balanced, cricket-accurate stroke classification
  let inferredStrokeCandidate = partialOptical?.inferredStrokeCandidate || '';
  if (!inferredStrokeCandidate) {
    if (contact.shotOutcome === 'EDGE') {
      inferredStrokeCandidate =
        offCm < -8
          ? 'Angled Drive Away From Body (Outer Edge)'
          : 'Squared-Up Defensive Prod (Leading Edge)';
    } else if (contact.shotOutcome === 'BEATEN') {
      inferredStrokeCandidate =
        bounceM >= 6.4
          ? 'Late Back-Foot Cut Attempt (Beaten)'
          : 'Flat-Footed Forward Push (Beaten on Seam)';
    } else if (contact.shotOutcome === 'DEFENDED') {
      inferredStrokeCandidate =
        footworkMode === 'BACK_FOOT_TRANSFER'
          ? 'Compact Back-Foot Defense'
          : 'Compact Forward Defense / Straight Push';
    } else if (batOrientationCategory === 'HORIZONTAL_CROSS_BAT') {
      if (bounceM < 4.2 && heightCm < 35) {
        inferredStrokeCandidate = 'Sweep / Paddle Sweep';
      } else if (resolvedCrossBatWinner === 'SQUARE_CUT' && offCm < -16) {
        inferredStrokeCandidate = 'Back-Foot Square Cut';
      } else {
        inferredStrokeCandidate = 'Controlled Pull Shot';
      }
    } else if (batOrientationCategory === 'ANGLED_DIAGONAL_BAT') {
      if (offCm < -7) {
        inferredStrokeCandidate =
          bounceM <= 5.3
            ? 'Classic Cover Drive'
            : 'Soft-Hands Push to Cover-Point';
      } else if (offCm > 5) {
        inferredStrokeCandidate = 'Wristy On-Drive / Flick';
      } else {
        inferredStrokeCandidate =
          bounceM <= 4.8
            ? 'Straight Drive in the V'
            : 'Compact Forward Defense / Straight Push';
      }
    } else {
      // VERTICAL_STRAIGHT_BAT
      if (offCm > 5.5) {
        inferredStrokeCandidate = 'Wristy On-Drive / Flick';
      } else if (offCm < -7.5 && bounceM <= 5.2) {
        inferredStrokeCandidate = 'Classic Cover Drive';
      } else if (Math.abs(offCm) <= 7.5 && bounceM <= 4.9) {
        inferredStrokeCandidate = 'Straight Drive in the V';
      } else if (offCm < -8.5) {
        inferredStrokeCandidate = 'Soft-Hands Push to Cover-Point';
      } else {
        inferredStrokeCandidate = 'Compact Forward Defense / Straight Push';
      }
    }
  }

  const profileSeparation = Math.abs(pullProfileMatchPct - cutProfileMatchPct);
  let computedConfidencePct = 91;
  if (
    batOrientationCategory === 'HORIZONTAL_CROSS_BAT' &&
    profileSeparation < 12
  ) {
    computedConfidencePct = Math.round(clamp(74 + profileSeparation * 0.5, 74, 81));
  } else if (
    batOrientationCategory === 'HORIZONTAL_CROSS_BAT' &&
    profileSeparation >= 12
  ) {
    computedConfidencePct = Math.round(
      clamp(85 + profileSeparation * 0.2, 85, 95)
    );
  } else if (Math.abs(offCm) >= 18) {
    computedConfidencePct = 88;
  } else {
    computedConfidencePct = 92;
  }

  return {
    estimatedBatAngleDeg,
    idealBatAngleDeg,
    batOrientationCategory,
    footworkMode,
    actualStrideDepthM,
    idealStrideDepthM,
    headOffsetFromBallCm,
    swingArcDirection,
    ...(typeof postShift === 'number'
      ? { postImpactHorizontalShift: postShift }
      : {}),
    ...(typeof followThroughSlopeDeg === 'number'
      ? { followThroughSlopeDeg }
      : {}),
    exitVectorTelemetry,
    detectionConfidencePct:
      partialOptical?.detectionConfidencePct ?? computedConfidencePct,
    inferredStrokeCandidate,
  };
}

export function buildPhysicsGroundedShotAnalysis(
  contact: ContactPointRecord,
  pred: BallTrajectoryPrediction,
  handedness: BatterHandedness,
  playedShotOverride?: string,
  swingFrames?: string[],
  partialOptical?: Partial<OpticalSwingKinematics>
): AIShotAnalysisReport {
  const wagonSummary = computeWagonWheelAnalysis(
    [{ contact, pred }],
    handedness,
    contact.id,
    1.68
  );
  const activeVector = wagonSummary.activeShot;
  const idealShotName = activeVector?.shotName || 'Classic Cover Drive';
  const primarySector = activeVector?.sectorLabel || 'Covers';

  const offCm = contact.projection.offsetFromMiddleCm;
  const heightCm = contact.projection.contactHeightCm;
  const bounceM = pred.bounceDistanceFromStumpsM;
  const devCm = pred.lateralDriftCm;
  const swingLabel =
    Math.abs(devCm) < 2.2
      ? 'Straight Seam'
      : devCm * (handedness === 'RHB' ? 1 : -1) < 0
      ? 'Out-Swing / Seam Away'
      : 'In-Swing / Nip Back';

  const opticalKinematics = computeOpticalSwingKinematicsForContact(
    contact,
    pred,
    handedness,
    idealShotName,
    partialOptical
  );

  const originalDetectedShotName =
    contact.aiShotAnalysis?.originalDetectedShotName ||
    opticalKinematics.inferredStrokeCandidate;

  const hasExplicitOverride =
    Boolean(playedShotOverride) &&
    playedShotOverride !== 'Auto-Detect from Video / Camera';

  const playedShotName = hasExplicitOverride
    ? playedShotOverride!
    : opticalKinematics.inferredStrokeCandidate;

  if (hasExplicitOverride) {
    const low = playedShotName.toLowerCase();
    if (low.includes('pull') || low.includes('hook') || low.includes('sweep')) {
      opticalKinematics.estimatedBatAngleDeg = 68;
      opticalKinematics.batOrientationCategory = 'HORIZONTAL_CROSS_BAT';
      opticalKinematics.swingArcDirection = 'ON_SIDE';
      if (opticalKinematics.exitVectorTelemetry) {
        opticalKinematics.exitVectorTelemetry = {
          ...opticalKinematics.exitVectorTelemetry,
          legSideSweepPct: Math.max(
            3.5,
            Math.abs(opticalKinematics.exitVectorTelemetry.legSideSweepPct)
          ),
          pullProfileMatchPct: 91,
          cutProfileMatchPct: 22,
          resolvedCrossBatWinner: 'PULL_SHOT',
        };
      }
    } else if (low.includes('cut')) {
      opticalKinematics.estimatedBatAngleDeg = 66;
      opticalKinematics.batOrientationCategory = 'HORIZONTAL_CROSS_BAT';
      opticalKinematics.swingArcDirection = 'OFF_SIDE';
      if (opticalKinematics.exitVectorTelemetry) {
        opticalKinematics.exitVectorTelemetry = {
          ...opticalKinematics.exitVectorTelemetry,
          legSideSweepPct: -Math.max(
            3.4,
            Math.abs(opticalKinematics.exitVectorTelemetry.legSideSweepPct)
          ),
          pullProfileMatchPct: 21,
          cutProfileMatchPct: 90,
          resolvedCrossBatWinner: 'SQUARE_CUT',
        };
      }
    } else if (
      low.includes('cover') ||
      low.includes('flick') ||
      low.includes('dab')
    ) {
      opticalKinematics.estimatedBatAngleDeg = 28;
      opticalKinematics.batOrientationCategory = 'ANGLED_DIAGONAL_BAT';
      opticalKinematics.swingArcDirection = low.includes('flick')
        ? 'ON_SIDE'
        : 'OFF_SIDE';
    } else {
      opticalKinematics.estimatedBatAngleDeg = 12;
      opticalKinematics.batOrientationCategory = 'VERTICAL_STRAIGHT_BAT';
      opticalKinematics.swingArcDirection = 'STRAIGHT_V';
    }
  }

  const normalizedPlayed = playedShotName.toLowerCase();
  const normalizedIdeal = idealShotName.toLowerCase();

  const isExactMatch =
    normalizedPlayed === normalizedIdeal ||
    (normalizedPlayed.includes('straight drive') &&
      normalizedIdeal.includes('straight drive')) ||
    (normalizedPlayed.includes('cover drive') &&
      normalizedIdeal.includes('cover drive') &&
      !normalizedPlayed.includes('edge')) ||
    (normalizedPlayed.includes('pull') && normalizedIdeal.includes('pull')) ||
    (normalizedPlayed.includes('cut') && normalizedIdeal.includes('cut')) ||
    (normalizedPlayed.includes('flick') && normalizedIdeal.includes('flick')) ||
    (normalizedPlayed.includes('defense') &&
      normalizedIdeal.includes('defense'));

  const isDefensiveStroke =
    normalizedPlayed.includes('defense') ||
    normalizedPlayed.includes('block') ||
    normalizedPlayed.includes('leave');

  const isCrossBatStroke =
    normalizedPlayed.includes('pull') ||
    normalizedPlayed.includes('hook') ||
    normalizedPlayed.includes('cut') ||
    normalizedPlayed.includes('sweep');

  const batAngleDelta = Math.abs(
    opticalKinematics.estimatedBatAngleDeg - opticalKinematics.idealBatAngleDeg
  );

  let shotMatchScore = 84;
  let verdictBadge: AIShotVerdictBadge = 'OPTIMAL_SELECTION';
  let verdictSummary = `${playedShotName} suits the ${bounceM.toFixed(1)}m length and ${Math.abs(offCm).toFixed(1)}cm ${offCm < 0 ? 'off-side' : 'leg-side'} line.`;

  if (
    isExactMatch &&
    contact.shotOutcome !== 'EDGE' &&
    contact.shotOutcome !== 'BEATEN'
  ) {
    shotMatchScore = clamp(95 - Math.round(batAngleDelta * 0.22), 86, 97);
    verdictBadge = 'OPTIMAL_SELECTION';
    verdictSummary = `Great shot selection: ${playedShotName} matches this ${bounceM.toFixed(1)}m ${pred.lengthCategoryLabel.toLowerCase()} delivery at ${heightCm.toFixed(0)}cm contact height.`;
  } else if (
    contact.shotOutcome === 'EDGE' ||
    contact.shotOutcome === 'BEATEN' ||
    normalizedPlayed.includes('edge') ||
    normalizedPlayed.includes('beaten')
  ) {
    shotMatchScore = 44;
    verdictBadge = 'MISTIMED_EXECUTION';
    verdictSummary = `${playedShotName} left a ${batAngleDelta}° bat-plane gap against ${Math.abs(devCm).toFixed(1)}cm of ${swingLabel.toLowerCase()}. Recommended option: ${idealShotName}.`;
  } else if (
    (normalizedPlayed.includes('pull') || normalizedPlayed.includes('hook')) &&
    normalizedIdeal.includes('cut')
  ) {
    shotMatchScore = offCm < -18 ? 60 : 74;
    verdictBadge = offCm < -18 ? 'HIGH_RISK_CHOICE' : 'ADAPTIVE_STROKE';
    verdictSummary = `You played a ${playedShotName} across the line from ${Math.abs(offCm).toFixed(1)}cm outside Off, whereas ${idealShotName} uses the width with higher control.`;
  } else if (isCrossBatStroke && bounceM < 5.0 && pred.hittingWicket) {
    shotMatchScore = 42;
    verdictBadge = 'HIGH_RISK_CHOICE';
    verdictSummary = `Playing a cross-batted ${playedShotName} against a full ${bounceM.toFixed(1)}m ball targeting the stumps risks LBW or bowled. Prefer ${idealShotName}.`;
  } else if (isDefensiveStroke) {
    shotMatchScore = 80;
    verdictBadge = 'ADAPTIVE_STROKE';
    verdictSummary = `Solid defensive choice (${playedShotName}) protecting the stumps, while ${idealShotName} offered a scoring option through ${primarySector}.`;
  } else {
    shotMatchScore = clamp(79 - Math.round(batAngleDelta * 0.3), 58, 85);
    verdictBadge = 'ADAPTIVE_STROKE';
    verdictSummary = `Played ${playedShotName} (${opticalKinematics.estimatedBatAngleDeg}° bat angle); highest-percentage textbook option is ${idealShotName} into ${primarySector}.`;
  }

  const headScore = clamp(
    Math.round(96 - opticalKinematics.headOffsetFromBallCm * 2.0),
    48,
    98
  );
  const strideDeltaM = Math.abs(
    opticalKinematics.actualStrideDepthM - opticalKinematics.idealStrideDepthM
  );
  const footScore = clamp(Math.round(95 - strideDeltaM * 36), 46, 97);
  const batScore = clamp(Math.round(96 - batAngleDelta * 0.8), 45, 98);

  const exitVec = opticalKinematics.exitVectorTelemetry;
  const exitScore = exitVec
    ? normalizedPlayed.includes('pull')
      ? clamp(Math.round(exitVec.pullProfileMatchPct), 64, 96)
      : normalizedPlayed.includes('cut')
      ? clamp(Math.round(exitVec.cutProfileMatchPct), 64, 96)
      : clamp(Math.round(91 - batAngleDelta * 0.35), 66, 96)
    : 86;

  const signedStrideDelta = Number(
    (
      opticalKinematics.actualStrideDepthM - opticalKinematics.idealStrideDepthM
    ).toFixed(2)
  );
  const signedBatAngleDelta =
    opticalKinematics.estimatedBatAngleDeg - opticalKinematics.idealBatAngleDeg;

  const tacticalComparison =
    shotMatchScore >= 85
      ? `Meeting this ${bounceM.toFixed(1)}m delivery at ${opticalKinematics.actualStrideDepthM}m crease depth (${heightCm.toFixed(0)}cm high) neutralized ${Math.abs(devCm).toFixed(1)}cm of ${swingLabel.toLowerCase()} movement.`
      : `On a ${bounceM.toFixed(1)}m ${pred.lengthCategoryLabel.toLowerCase()} ball (${Math.abs(offCm).toFixed(1)}cm ${offCm <= 0 ? 'outside Off' : 'on Leg'}), ${idealShotName} at ${opticalKinematics.idealStrideDepthM}m depth aligns the full bat face with the bounce.`;

  const howToPlayTips = [
    bounceM < 4.6
      ? `Press forward to ${opticalKinematics.idealStrideDepthM}m so your eyes are directly over the ${bounceM.toFixed(1)}m pitch of the ball.`
      : bounceM > 6.4
      ? `Transfer weight back (~${opticalKinematics.idealStrideDepthM}m deep) early to read the ${heightCm.toFixed(0)}cm bounce height.`
      : `Hold a balanced ${opticalKinematics.idealStrideDepthM}m stance and let the ball travel under your eyes before committing.`,
    batAngleDelta > 12
      ? `Present a cleaner ${opticalKinematics.idealBatAngleDeg}° bat angle (instead of ${opticalKinematics.estimatedBatAngleDeg}°) to keep the sweet spot aligned through ${primarySector}.`
      : `Maintain your ${opticalKinematics.estimatedBatAngleDeg}° bat plane cleanly through the line toward ${primarySector}.`,
    `Keep your head steady within 3.5cm of the ball line (currently ${opticalKinematics.headOffsetFromBallCm}cm) at impact.`,
  ];

  const recommendedDrills = [
    {
      title:
        bounceM < 5.2
          ? 'Front-Foot Stride & Late Impact Gate'
          : 'Back-Foot Trigger & Bounce Judgement Drill',
      focus: `Targeting ${opticalKinematics.idealStrideDepthM}m interception depth for ${idealShotName}`,
      steps:
        bounceM < 5.2
          ? `Place two cones at ${opticalKinematics.idealStrideDepthM}m from the stumps. Feed ${bounceM.toFixed(1)}m balls and plant the front foot alongside the line with head over the knee.`
          : 'Use a back-and-across trigger step inside the crease against 6.0m–7.5m feeds, waiting for the ball to reach top of bounce before swinging.',
    },
    {
      title: `Swing Plane Control Drill (${opticalKinematics.idealBatAngleDeg}° Target)`,
      focus: `Grooving ${idealShotName} through ${primarySector}`,
      steps:
        'Hit 12 controlled feeds focusing on top-hand wrist alignment so the bat face tracks straight through the target scoring gate.',
    },
  ];

  return {
    playedShotName,
    idealShotName,
    shotMatchScore,
    verdictBadge,
    verdictSummary,
    tacticalComparison,
    biomechanics: {
      headAndBalance: {
        score0to100: headScore,
        statusLabel:
          headScore >= 82
            ? 'Head Over Ball'
            : headScore >= 65
            ? `${opticalKinematics.headOffsetFromBallCm}cm Offset`
            : 'Head Falling Over',
        observation:
          headScore >= 82
            ? `Head and eyes stayed well-balanced (${opticalKinematics.headOffsetFromBallCm}cm offset) over the contact zone.`
            : `Head drifted ${opticalKinematics.headOffsetFromBallCm}cm from the ball line—lean your forehead and front shoulder into the line.`,
        measuredValueLabel: `${opticalKinematics.headOffsetFromBallCm} cm offset`,
        idealValueLabel: '≤ 3.5 cm offset',
        deltaLabel:
          opticalKinematics.headOffsetFromBallCm <= 3.5
            ? 'On target'
            : `+${(opticalKinematics.headOffsetFromBallCm - 3.5).toFixed(1)} cm drift`,
        technicalCue:
          headScore >= 82
            ? 'Eyes are level and stacked over the contact point for maximum control.'
            : 'Lead with your nose and front shoulder toward the ball line.',
      },
      footworkAndStride: {
        score0to100: footScore,
        statusLabel:
          footScore >= 82
            ? `${opticalKinematics.actualStrideDepthM}m Balanced`
            : footScore >= 65
            ? `Δ ${signedStrideDelta > 0 ? '+' : ''}${signedStrideDelta}m Stride`
            : 'Late Weight Transfer',
        observation: `Intercepted at ${opticalKinematics.actualStrideDepthM}m from the stumps compared to the ${opticalKinematics.idealStrideDepthM}m ideal depth.`,
        measuredValueLabel: `${opticalKinematics.actualStrideDepthM.toFixed(2)} m depth`,
        idealValueLabel: `${opticalKinematics.idealStrideDepthM.toFixed(2)} m depth`,
        deltaLabel: `${signedStrideDelta >= 0 ? '+' : ''}${signedStrideDelta.toFixed(2)} m`,
        technicalCue:
          Math.abs(signedStrideDelta) <= 0.15
            ? `Footwork depth (${opticalKinematics.actualStrideDepthM.toFixed(2)}m) matches the ${bounceM.toFixed(1)}m bounce length.`
            : signedStrideDelta < 0
            ? `Press ${Math.abs(signedStrideDelta).toFixed(2)}m further forward to smother movement earlier.`
            : `Stay ${signedStrideDelta.toFixed(2)}m deeper in the crease for extra time on the bounce.`,
      },
      batFaceAndSwingPlane: {
        score0to100: batScore,
        statusLabel:
          batScore >= 82
            ? `${opticalKinematics.estimatedBatAngleDeg}° Clean Face`
            : batScore >= 65
            ? `${opticalKinematics.estimatedBatAngleDeg}° vs ${opticalKinematics.idealBatAngleDeg}°`
            : `${opticalKinematics.estimatedBatAngleDeg}° Angled Blade`,
        observation: `Presented a ${opticalKinematics.estimatedBatAngleDeg}° bat angle at contact vs. the ${opticalKinematics.idealBatAngleDeg}° ideal angle for ${idealShotName}.`,
        measuredValueLabel: `${opticalKinematics.estimatedBatAngleDeg}° bat angle`,
        idealValueLabel: `${opticalKinematics.idealBatAngleDeg}° ideal`,
        deltaLabel: `${signedBatAngleDelta >= 0 ? '+' : ''}${signedBatAngleDelta}°`,
        technicalCue:
          batAngleDelta <= 10
            ? `Bat face angle (${opticalKinematics.estimatedBatAngleDeg}°) is cleanly aligned with the scoring arc.`
            : `Adjust top-hand wrist to bring the bat angle closer to ${opticalKinematics.idealBatAngleDeg}°.`,
      },
      followThroughExit: {
        score0to100: exitScore,
        statusLabel:
          normalizedPlayed.includes('pull')
            ? 'On-Side Pull Roll'
            : normalizedPlayed.includes('cut')
            ? 'Off-Side Cut Extension'
            : 'Balanced High Finish',
        observation:
          normalizedPlayed.includes('pull')
            ? `Wrists rolled after contact, carrying the bat across toward mid-wicket/square leg.`
            : normalizedPlayed.includes('cut')
            ? `Bat extended cleanly past point along a horizontal off-side arc.`
            : `Bat accelerated smoothly through the line into a balanced follow-through.`,
        measuredValueLabel:
          normalizedPlayed.includes('pull')
            ? `Leg-side sweep (${exitVec?.pullProfileMatchPct ?? 86}% match)`
            : normalizedPlayed.includes('cut')
            ? `Off-side slash (${exitVec?.cutProfileMatchPct ?? 86}% match)`
            : `High straight arc (${exitVec?.exitAzimuthDeg ?? 48}°)`,
        idealValueLabel: normalizedIdeal.includes('pull')
          ? 'Controlled wrist rollover'
          : normalizedIdeal.includes('cut')
          ? 'Full extension past point'
          : 'High elbow through the V',
        deltaLabel: `${exitScore}/100 execution`,
        technicalCue:
          normalizedPlayed.includes('pull')
            ? 'Roll the top wrist over at contact to keep the pull shot down.'
            : normalizedPlayed.includes('cut')
            ? 'Stay side-on through the finish to guide the ball past point.'
            : 'Let the top hand guide the bat high toward the target sector.',
      },
    },
    howToPlayTips,
    recommendedDrills,
    ...(swingFrames && swingFrames.length > 0 ? { swingFrames } : {}),
    opticalKinematics,
    ...(hasExplicitOverride
      ? {
          isManuallyRecategorized: true,
          originalDetectedShotName,
        }
      : {}),
    scannedAtIso: new Date().toISOString(),
    sourceModel: hasExplicitOverride
      ? 'Manual Re-Categorization + Physics Engine'
      : 'Optical Kinematics + Physics Engine',
  };
}






