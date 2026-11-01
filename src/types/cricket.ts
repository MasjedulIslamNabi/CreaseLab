export type BatterHandedness = 'RHB' | 'LHB';

export type StumpLineZone =
  | 'Outside Off'
  | 'Off Stump'
  | 'Middle Stump'
  | 'Leg Stump'
  | 'Outside Leg';

export type PitchAnchorMode = 'FRONT_STUMPS' | 'CREASE_ARROW';

export type CameraViewingAngle =
  | 'BEHIND_BOWLER'
  | 'BEHIND_BATTER'
  | 'SIDE_DIAGONAL';

export type FarEndCalibrationMode =
  | 'VISIBLE_PITCH_AXIS'
  | 'BOWLER_STUMPS_20M';

export type DeliverySourceType =
  | 'BOWLER_STUMPS'
  | 'BOWLING_MACHINE'
  | 'SIDE_ARM_THROWER';

export interface NormalizedPoint {
  x: number; // 0..1 inside true video content rect
  y: number; // 0..1 inside true video content rect
}

/** Normalized 0..1 bounding box for visual confirmation of the Top-to-Toe Bat Blade */
export interface BoundingBox2D {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export type ReleaseVisibilityMode = 'VISIBLE_RELEASE' | 'UNSEEN_RELEASE';

export type BowlerWicketSide = 'OVER_THE_WICKET' | 'AROUND_THE_WICKET';

export type BowlerSpeedType = 'PACE' | 'SPIN';

export interface CameraDistanceTelemetry {
  /** Measured or overridden distance in meters from camera optical center to batting-end stump base (P1) */
  cameraToBattingStumpsM: number;
  /** Auto-estimated pinhole distance in meters before any manual slider override */
  autoEstimatedCameraToBattingM: number;
  /** Distance in meters from camera optical center to bowling-end stumps (20.12m away) */
  cameraToBowlingStumpsM: number;
  /** Distance in meters from camera optical center to bowling popping crease (18.90m from batting stumps) */
  cameraToReleaseCreaseM: number;
  /** Effective physical pitch span in meters visible between Striker Stumps and the Pitch Arrow tip */
  visiblePitchSpanM: number;
  /** True when the camera is stationed in front of the bowler stumps (D_bat < 20.12m) */
  isCameraInFrontOfBowlerStumps: boolean;
  /** Human-readable camera station zone label (e.g. 'Mid-Pitch (In Front of Bowler)', 'Behind Bowler Stumps') */
  cameraStationZoneLabel: string;
  /** Camera perspective foreshortening ratio k_cam = D_near / D_far */
  perspectiveForeshorteningK: number;
  /** Estimated camera optical elevation angle in degrees above ground plane */
  cameraElevationDeg: number;
  /** True when bowling-end stumps are visible in frame; false when only batting-end stumps are visible */
  bowlingStumpsVisible: boolean;
  /** Normalized 2D coordinate of bowling-end stumps (user-pinned or virtual projected 20.12m) */
  virtualBowlingStumps2D: NormalizedPoint;
  /** Normalized 2D coordinate of bowling popping crease (18.90m from batting stumps) */
  virtualReleaseCrease2D: NormalizedPoint;
  /** Ground shadow projection of bowler release point along the 18.90m popping crease */
  reconstructedReleaseGround2D?: NormalizedPoint;
  /** Physically reconstructed bowler release height in cm above turf plane */
  reconstructedReleaseHeightCm?: number;
  /** Physically reconstructed bowler lateral release offset in cm from pitch center line */
  reconstructedReleaseLateralCm?: number;
}

export interface PlantedStumpsConfig {
  anchorMode: PitchAnchorMode;
  cameraAngle?: CameraViewingAngle;
  farEndMode?: FarEndCalibrationMode;
  deliverySource?: DeliverySourceType;
  /** Whether the bowler's release point is visible in the video or unseen (camera in front of bowler stumps) */
  releaseVisibilityMode?: ReleaseVisibilityMode;
  /** Over the Wicket vs Around the Wicket preset for unseen release reconstruction */
  bowlerWicketSide?: BowlerWicketSide;
  /** Pace vs Spin delivery preset for unseen release height & trajectory arc */
  bowlerSpeedType?: BowlerSpeedType;
  /** Optional manual override for camera distance from batting stumps in meters (4.0m - 35.0m) */
  customCameraDistanceM?: number;
  /** P1: Striker Stump Base (0.00m ground origin) */
  backStumps: NormalizedPoint;
  /** P2: Striker Stump Bails / Top (71.12cm height & width scale reference) */
  stumpTopPoint?: NormalizedPoint;
  /** P3: Striker Popping Crease Line (1.22m depth reference in front of batter) */
  poppingCreasePoint?: NormalizedPoint;
  /** P4: Visible Pitch Corridor Axis / Delivery End (or Bowler Stumps at 20.12m) */
  frontStumps: NormalizedPoint;
  backStumpWidth: number;
  backStumpHeight: number;
  frontStumpWidth: number;
  frontStumpHeight: number;
}

export interface ImaginaryStumpProjection {
  /** Signed offset relative to batter handedness (negative = Off Side, positive = Leg Side) */
  offsetFromMiddleCm: number;
  /** Direct 1-to-1 horizontal screen offset from Back Stump middle in cm (-11.43 = Left Stump, 0 = Middle, +11.43 = Right Stump) */
  screenOffsetCm: number;
  /** Normalized horizontal ratio relative to backStumpWidth (-0.5 = Left Stump, 0 = Middle, +0.5 = Right Stump) */
  relX: number;
  /** Normalized vertical height ratio relative to backStumpHeight (0 = Crease base, 1.0 = Top of bails) */
  relY: number;
  contactHeightCm: number;
  zone: StumpLineZone;
  hittingStumps: boolean;
  axisGroundPoint: NormalizedPoint;
}

export type CoachingRole = 'BATTER' | 'BOWLER';

export type ShotOutcomeTag =
  | 'MIDDLED'
  | 'CONTROLLED'
  | 'DEFENDED'
  | 'BEATEN'
  | 'EDGE';

export type BowlerTargetPlanId =
  | 'TOP_OF_OFF'
  | 'YORKER_BASE'
  | 'SHORT_BUMPER'
  | 'FIFTH_STUMP'
  | 'CUSTOM';

export type AIShotVerdictBadge =
  | 'OPTIMAL_SELECTION'
  | 'ADAPTIVE_STROKE'
  | 'HIGH_RISK_CHOICE'
  | 'MISTIMED_EXECUTION';

export interface BiomechanicsPillarAudit {
  score0to100: number;
  statusLabel: string;
  observation: string;
  measuredValueLabel?: string;
  idealValueLabel?: string;
  deltaLabel?: string;
  technicalCue?: string;
}

export interface FollowThroughExitVectorTelemetry {
  /** Frame offsets in ms after exact bat-ball impact: [0, 35, 70, 110] */
  exitFrameOffsetsMs?: [number, number, number, number];
  /** Normalized (0..1) bat blade / hand centroids at [0ms, +35ms, +70ms, +110ms] */
  exitTrajectoryPoints: Array<NormalizedPoint & { offsetMs?: number; label?: string }>;
  /** Continuous post-impact exit angle in degrees (-180..180, 0 = toward leg side for RHB) */
  exitAzimuthDeg: number;
  /** Signed percentage of post-impact sweep toward batter's leg side (+ = Pull leg-side sweep, - = Cut off-side extension) */
  legSideSweepPct: number;
  /** Percentage of upward blade lift at finish (+ = high pull rollover or upper-cut finish) */
  upwardFinishPct?: number;
  /** 0..100 match score against canonical Pull / Hook post-impact exit profile */
  pullProfileMatchPct: number;
  /** 0..100 match score against canonical Back-Foot Square Cut post-impact exit profile */
  cutProfileMatchPct: number;
  /** Deterministic winner when resolving cross-bat Pull vs Cut ambiguity */
  resolvedCrossBatWinner: 'PULL_SHOT' | 'SQUARE_CUT' | 'STRAIGHT_BAT' | 'STRAIGHT_ARC';
  /** Human-readable exit trajectory summary */
  exitVectorSummary?: string;
}

export interface AttributeCropSnapshots {
  headCropUrl: string;
  footworkCropUrl: string;
  batFaceCropUrl: string;
  followThroughCropUrl: string;
}

export interface OpticalSwingKinematics {
  /** Estimated bat blade angle in degrees from vertical (0° = straight vertical bat, 80° = horizontal cross-bat) */
  estimatedBatAngleDeg: number;
  /** Ideal bat blade angle in degrees from vertical for the recommended shot */
  idealBatAngleDeg: number;
  batOrientationCategory:
    | 'VERTICAL_STRAIGHT_BAT'
    | 'ANGLED_DIAGONAL_BAT'
    | 'HORIZONTAL_CROSS_BAT';
  footworkMode:
    | 'FRONT_FOOT_STRIDE'
    | 'BACK_FOOT_TRANSFER'
    | 'CREASE_NEUTRAL';
  actualStrideDepthM: number;
  idealStrideDepthM: number;
  headOffsetFromBallCm: number;
  swingArcDirection: 'OFF_SIDE' | 'STRAIGHT_V' | 'ON_SIDE';
  /** Measured post-impact bat/hand horizontal shift (t=0ms -> t+110ms) in normalized video coords */
  postImpactHorizontalShift?: number;
  /** Measured post-impact bat/hand follow-through vector angle in degrees */
  followThroughSlopeDeg?: number;
  /** 3-segment post-impact exit trajectory analyzer (0ms -> +35ms -> +70ms -> +110ms) */
  exitVectorTelemetry?: FollowThroughExitVectorTelemetry;
  detectionConfidencePct: number;
  inferredStrokeCandidate: string;
}

export interface AIShotAnalysisReport {
  playedShotName: string;
  idealShotName: string;
  shotMatchScore: number;
  verdictBadge: AIShotVerdictBadge;
  verdictSummary: string;
  tacticalComparison: string;
  biomechanics: {
    headAndBalance: BiomechanicsPillarAudit;
    footworkAndStride: BiomechanicsPillarAudit;
    batFaceAndSwingPlane: BiomechanicsPillarAudit;
    followThroughExit?: BiomechanicsPillarAudit;
  };
  howToPlayTips: string[];
  recommendedDrills: Array<{
    title: string;
    focus: string;
    steps: string;
  }>;
  swingFrames?: string[];
  stitchedStoryboardUrl?: string;
  /** 4 post-impact frames [0ms Impact, +35ms Exit Start, +70ms Mid Follow-Through, +110ms Finish] */
  postImpactFrames?: string[];
  /** Stitched 4-frame Impact-to-Follow-Through Storyboard (0ms, +35ms, +70ms, +110ms) with exit vector arrows */
  postImpactStoryboardUrl?: string;
  /** Cropped clip zoom-ins for Head, Footwork, Bat Face, and Follow-Through attribute cards */
  attributeCropSnapshots?: AttributeCropSnapshots;
  opticalKinematics?: OpticalSwingKinematics;
  isManuallyRecategorized?: boolean;
  originalDetectedShotName?: string;
  scannedAtIso: string;
  sourceModel: string;
}

export type DismissalType =
  | 'BOWLED'
  | 'LBW'
  | 'CAUGHT'
  | 'EDGED'
  | 'EDGED_BEHIND'
  | 'STUMPED'
  | 'RUN_OUT'
  | 'HIT_WICKET';

export interface RecentVideoClip {
  id: string;
  name: string;
  url: string;
  durationSec: number;
  trimStartSec: number;
  trimEndSec: number;
  addedAt: number;
}

export interface TrackedBallFramePoint {
  frameIndex: number;
  timestampSec: number;
  point: NormalizedPoint;
  phase: 'RELEASE' | 'PRE_BOUNCE' | 'BOUNCE' | 'POST_BOUNCE' | 'CONTACT';
  confidencePct: number;
}

export interface PendingContactPreview {
  videoPoint: NormalizedPoint;
  releasePoint?: NormalizedPoint;
  bouncePoint?: NormalizedPoint;
  bounceLengthM?: number;
  batBladeBox?: BoundingBox2D;
  timestampSec: number;
  releaseTimestampSec?: number;
  bounceTimestampSec?: number;
  calibratedSpeedKph?: number;
  aiShotAnalysis?: AIShotAnalysisReport;
  selectedShotName?: string;
  wagonWheelAngleDeg?: number;
  isOut?: boolean;
  dismissalType?: DismissalType;
  ballNote?: string;
  bounceConfidence?: number;
  bounceInflectionMethod?: 'OPTICAL_V_POINT' | 'TRAJECTORY_PHYSICS_FALLBACK';
  trackedWaypoints?: TrackedBallFramePoint[];
  bowlerReleaseAngleLabel?: string;
  source: 'AI Auto-Detect' | 'Manual Point';
  clipLabel: string;
  snapshotUrl?: string;
}

export interface ContactPointRecord {
  id: string;
  indexNumber: number;
  timestampSec: number;
  /** Optional bowler release frame timestamp (t0) for real stopwatch speed calculation */
  releaseTimestampSec?: number;
  /** Optional turf bounce frame timestamp (t1) for synchronized 3D Hawk-Eye scrubbing */
  bounceTimestampSec?: number;
  /** Optional calibrated or radar-entered delivery speed in km/h (null/undefined if uncalibrated) */
  calibratedSpeedKph?: number;
  /** Optional batter shot outcome tag for Wagon Wheel & session control tracking */
  shotOutcome?: ShotOutcomeTag;
  /** Optional user-selected shot name for this ball */
  selectedShotName?: string;
  /** Optional user-customized 360° Wagon Wheel angle in degrees for this ball */
  wagonWheelAngleDeg?: number;
  /** Whether the batter got OUT on this delivery */
  isOut?: boolean;
  /** Optional dismissal mode when isOut is true */
  dismissalType?: DismissalType;
  /** Optional user note for this ball (e.g. "Out LBW", "Beaten outside off", etc.) */
  ballNote?: string;
  /** Optional AI Shot Vision Coach report comparing Played Shot vs Ideal Shot */
  aiShotAnalysis?: AIShotAnalysisReport;
  videoPoint: NormalizedPoint;
  /** Optional 2D video bowler release point (t0) for 3-point perspective homography */
  releasePoint?: NormalizedPoint;
  /** Optional 2D video turf bounce point (t1) for 3-point perspective homography */
  bouncePoint?: NormalizedPoint;
  /** Detected Top-to-Toe Bat Blade Bounding Box on the impact frame */
  batBladeBox?: BoundingBox2D;
  stumpConfig: PlantedStumpsConfig;
  projection: ImaginaryStumpProjection;
  frameSnapshotUrl: string;
  source: 'AI Auto-Detect' | 'Manual Point';
  clipLabel?: string;
  /** When true (default after Save & Lock Distance), moving stumps on the video never mutates this point */
  isLocked?: boolean;
  /** Optional per-ball bounce distance in meters from Striker Stumps (0m) */
  bounceLengthM?: number;
  bounceConfidence?: number;
  bounceInflectionMethod?: 'OPTICAL_V_POINT' | 'TRAJECTORY_PHYSICS_FALLBACK';
  /** Frame-by-frame stroboscopic ball positions tracked automatically across the delivery */
  trackedWaypoints?: TrackedBallFramePoint[];
  /** Detected bowler release angle classification (e.g. Over the Wicket, Round the Wicket, Wide Crease) */
  bowlerReleaseAngleLabel?: string;
}

export interface Pass1DetectionResponse {
  impactFrameIndex: number;
  frontStumpsVisible: boolean;
  anchorMode: PitchAnchorMode;
  backStumps: NormalizedPoint;
  frontStumps: NormalizedPoint;
  hittingZoneCenter: NormalizedPoint;
  handedness: BatterHandedness;
}

export interface Pass2ZoomDetectionResponse {
  /** Normalized (0..1) inside the 2.5x zoom crop */
  cropContactPoint: NormalizedPoint;
  /** Normalized (0..1) inside the 2.5x zoom crop */
  cropBatBladeBox: BoundingBox2D;
  confidencePct: number;
  summary: string;
}

