import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  Flame,
  FlipHorizontal,
  Gauge,
  Grid,
  Layers,
  Lock,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Target,
  Trash2,
  Tv,
  Unlock,
  UserCheck,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  BatterHandedness,
  CoachingRole,
  ContactPointRecord,
  PendingContactPreview,
  PlantedStumpsConfig,
} from '../types/cricket';
import {
  applyWhatIfToTrajectory,
  autoDetectBounceFromContactPoint,
  BallTrajectoryPrediction,
  BOWLER_POPPING_CREASE_Z_CM,
  BOWLER_STUMPS_Z_CM,
  calculateBallTrajectory,
  calculateImaginaryStumpPoint,
  clamp,
  computeBeehiveHeatmap,
  computePitchHeatmapData,
  computePitchZoneMatrix,
  computeRoleCoachingInsights,
  computeStopwatchSpeedKph,
  DEFAULT_IMPACT_Z_CM,
  DRSCheckColor,
  DRSWhatIfOverrides,
  estimateNaturalBounceLengthM,
  evaluateDRSReview,
  evaluateTrajectoryAnimationAtProgress,
  getThermalColorRgba,
  getZoneColorConfig,
  metersToWorldZ,
  OnFieldUmpireCall,
  PITCH_LENGTH_METERS,
  PitchHeatmapMode,
  PitchHeatmapScope,
  PitchLengthBandId,
  PitchLineChannelId,
  STRIKER_POPPING_CREASE_Z_CM,
  TrajectoryDeliveryMode,
  WorldPoint3D,
} from '../utils/stumpProjection';

export type DashboardWorkspaceTab =
  | 'PITCH_3D'
  | 'HEATMAPS_ZONES'
  | 'DRS_TELEMETRY';

interface ImaginaryStumpDashboardProps {
  handedness: BatterHandedness;
  contacts: ContactPointRecord[];
  selectedId: string | null;
  pendingPreview: PendingContactPreview | null;
  activeStumps: PlantedStumpsConfig;
  activeVideoUrl?: string;
  activeWorkspaceTab?: DashboardWorkspaceTab;
  onChangeWorkspaceTab?: (
    tab: DashboardWorkspaceTab | 'VIDEO'
  ) => void;
  onCommitPendingPreview: (customBounceLengthM?: number | null) => void;
  onDiscardPendingPreview: () => void;
  onSelectContact: (id: string | null) => void;
  onToggleLockContact: (id: string) => void;
  onDeleteContact: (id: string) => void;
  onUpdateContactBounceLength?: (
    id: string,
    bounceLengthM: number | undefined
  ) => void;
  onUpdateContactSpeed?: (
    id: string,
    calibratedSpeedKph: number | undefined
  ) => void;
  onUpdateContactMeta?: (
    id: string,
    patch: Partial<ContactPointRecord>
  ) => void;
  onClearAll: () => void;
  onRestoreSamples: () => void;
  onSwitchToVideoTab?: () => void;
}

export type PitchCameraPresetId =
  | 'FRONT_VIEW'
  | 'BACK_WK_VIEW'
  | 'DRONE_TOP_DOWN_VIEW'
  | 'SIDE_PARALLEL_VIEW'
  | 'ORBIT_3D_VIEW';

interface CameraState {
  yawDeg: number;
  pitchDeg: number;
  zoom: number;
  pivotZ: number;
  screenYRatio: number;
  zCompress: number;
  sideBlend: number;
  droneBlend: number;
}

const CAMERA_PRESETS: Record<
  PitchCameraPresetId,
  { label: string; shortLabel: string; subtitle: string; state: CameraState }
> = {
  FRONT_VIEW: {
    label: 'Front View (Bowler End)',
    shortLabel: 'Front 3D',
    subtitle: 'Full 22-yard telephoto view from Bowler End down to Striker Stumps',
    state: {
      yawDeg: 0,
      pitchDeg: 21,
      zoom: 1.0,
      pivotZ: 350,
      screenYRatio: 0.49,
      zCompress: 0.68,
      sideBlend: 0,
      droneBlend: 0,
    },
  },
  BACK_WK_VIEW: {
    label: 'Back View (Wicketkeeper)',
    shortLabel: 'Keeper',
    subtitle: 'Behind Striker Stumps looking down the full 22-yard strip to Bowler End',
    state: {
      yawDeg: 180,
      pitchDeg: 20,
      zoom: 1.02,
      pivotZ: 350,
      screenYRatio: 0.50,
      zCompress: 0.68,
      sideBlend: 0,
      droneBlend: 0,
    },
  },
  DRONE_TOP_DOWN_VIEW: {
    label: 'Drone View (Top-Down Pitch Map)',
    shortLabel: 'Drone 90°',
    subtitle: 'Direct 90° overhead 22-yard pitch map showing exact landing heatmap & length zones',
    state: {
      yawDeg: -90,
      pitchDeg: 88,
      zoom: 1.0,
      pivotZ: 350,
      screenYRatio: 0.49,
      zCompress: 0.94,
      sideBlend: 0,
      droneBlend: 1,
    },
  },
  SIDE_PARALLEL_VIEW: {
    label: 'Side View (Square Leg / Point)',
    shortLabel: 'Side Profile',
    subtitle: '100% parallel 22-yard profile showing true bounce height, length & carry',
    state: {
      yawDeg: -90,
      pitchDeg: 6,
      zoom: 1.0,
      pivotZ: 350,
      screenYRatio: 0.55,
      zCompress: 0.94,
      sideBlend: 1,
      droneBlend: 0,
    },
  },
  ORBIT_3D_VIEW: {
    label: '3D Stadium Orbit',
    shortLabel: '3D Orbit',
    subtitle: 'Full 22-yard isometric broadcast view (drag anywhere to rotate 360°)',
    state: {
      yawDeg: -38,
      pitchDeg: 23,
      zoom: 1.0,
      pivotZ: 350,
      screenYRatio: 0.50,
      zCompress: 0.86,
      sideBlend: 0,
      droneBlend: 0,
    },
  },
};

const TRAJECTORY_MODES: Array<{
  id: TrajectoryDeliveryMode;
  label: string;
}> = [
  { id: 'AUTO_PITCH', label: 'Auto' },
  { id: 'STRAIGHT', label: 'Straight' },
  { id: 'ANGLE_IN', label: 'In-Swing' },
  { id: 'SEAM_AWAY', label: 'Out-Seam' },
];

export const ImaginaryStumpDashboard: React.FC<ImaginaryStumpDashboardProps> = ({
  handedness,
  contacts,
  selectedId,
  pendingPreview,
  activeStumps,
  activeVideoUrl,
  activeWorkspaceTab = 'PITCH_3D',
  onChangeWorkspaceTab,
  onCommitPendingPreview,
  onDiscardPendingPreview,
  onSelectContact,
  onToggleLockContact,
  onDeleteContact,
  onUpdateContactBounceLength,
  onUpdateContactSpeed,
  onUpdateContactMeta,
  onClearAll,
  onRestoreSamples,
  onSwitchToVideoTab,
}) => {
  const [zoomedPoint, setZoomedPoint] = useState<ContactPointRecord | null>(null);
  const [activePreset, setActivePreset] =
    useState<PitchCameraPresetId>('FRONT_VIEW');
  const [cam, setCam] = useState<CameraState>(CAMERA_PRESETS.FRONT_VIEW.state);
  const [sideViewDirection, setSideViewDirection] = useState<
    'BOWLER_LEFT' | 'BOWLER_RIGHT'
  >('BOWLER_LEFT');

  const [hoveredBallId, setHoveredBallId] = useState<string | null>(null);
  const [trajectoryMode, setTrajectoryMode] =
    useState<TrajectoryDeliveryMode>('AUTO_PITCH');

  // Immersive Full-Canvas Glassmorphic HUD States
  const [isImmersiveMode, setIsImmersiveMode] = useState<boolean>(false);
  const [isHudCollapsed, setIsHudCollapsed] = useState<boolean>(false);
  const [showMiniStumpCard, setShowMiniStumpCard] = useState<boolean>(false);
  const [showSyncedVideoPiP, setShowSyncedVideoPiP] = useState<boolean>(true);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const [coachingRole, setCoachingRole] = useState<CoachingRole>('BATTER');

  // Keyboard Escape shortcut to exit Fullscreen Immersive Mode
  useEffect(() => {
    if (!isImmersiveMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsImmersiveMode(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isImmersiveMode]);

  useEffect(() => {
    if (activeWorkspaceTab === 'DRS_TELEMETRY' && isImmersiveMode) {
      setIsImmersiveMode(false);
    }
  }, [activeWorkspaceTab, isImmersiveMode]);

  // Pitch Landing Point Heatmap Controls (Default OFF in 3D Pitch so the 3D pitch starts ultra-clean; auto-enabled when entering Heatmaps tab)
  const [heatmapMode, setHeatmapMode] = useState<PitchHeatmapMode>('OFF');
  const [heatmapScope, setHeatmapScope] = useState<PitchHeatmapScope>('ALL');
  const [showBeehiveOverlay, setShowBeehiveOverlay] = useState<boolean>(true);
  const [highlightedZoneKey, setHighlightedZoneKey] = useState<string | null>(
    null
  );

  // Interactive Broadcast DRS Studio & Live "What-If" Simulator States
  const [onFieldCall, setOnFieldCall] = useState<OnFieldUmpireCall>('NOT_OUT');
  const [drsRevealStep, setDrsRevealStep] = useState<0 | 1 | 2 | 3 | 4>(4);
  const [isPlayingDrsSequence, setIsPlayingDrsSequence] =
    useState<boolean>(false);
  const [drsSequenceRunId, setDrsSequenceRunId] = useState<number>(0);
  const [drsAnimProgress, setDrsAnimProgress] = useState<number>(1);
  const [drsMonitorCamera, setDrsMonitorCamera] = useState<
    'BOWLER_HAWK_EYE' | 'SIDE_PROFILE' | 'SPLIT_DUAL'
  >('SPLIT_DUAL');
  const [whatIfOverrides, setWhatIfOverrides] = useState<DRSWhatIfOverrides>({
    enabled: false,
    pitchLineShiftCm: 0,
    impactLateralShiftCm: 0,
    bounceLengthM: null,
    heightMultiplier: 1.0,
    heightShiftCm: 0,
  });

  // Only default to 'BOTH' when transitioning INTO HEATMAPS_ZONES from another tab, so clicking 'Clean Turf' ('OFF') inside HEATMAPS_ZONES stays on 'OFF'
  const prevHeatmapTabRef = useRef<DashboardWorkspaceTab>(activeWorkspaceTab);
  useEffect(() => {
    if (
      prevHeatmapTabRef.current !== 'HEATMAPS_ZONES' &&
      activeWorkspaceTab === 'HEATMAPS_ZONES' &&
      heatmapMode === 'OFF'
    ) {
      setHeatmapMode('BOTH');
    }
    prevHeatmapTabRef.current = activeWorkspaceTab;
  }, [activeWorkspaceTab, heatmapMode]);

  const [trackingScope, setTrackingScope] = useState<'ALL' | 'SELECTED'>('ALL');
  const [checkedBallIds, setCheckedBallIds] = useState<string[]>([]);

  const [previewBounceLengthM, setPreviewBounceLengthM] = useState<
    number | null
  >(null);

  useEffect(() => {
    setPreviewBounceLengthM(null);
  }, [pendingPreview]);

  useEffect(() => {
    setCheckedBallIds((prev) => {
      if (prev.length === 0) return prev;
      const validIds = new Set(contacts.map((c) => c.id));
      const next = prev.filter((id) => validIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [contacts]);

  const pitchViewportRef = useRef<HTMLDivElement | null>(null);
  const zoomBarRef = useRef<HTMLDivElement | null>(null);

  const camRef = useRef<CameraState>(cam);
  useEffect(() => {
    camRef.current = cam;
  }, [cam]);

  const animFrameRef = useRef<number | null>(null);

  const cancelCameraAnimation = useCallback(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => cancelCameraAnimation();
  }, [cancelCameraAnimation]);

  const animateCameraTo = useCallback(
    (targetState: CameraState, durationMs = 540) => {
      cancelCameraAnimation();

      const startCam: CameraState = { ...camRef.current };
      const startTime = performance.now();

      const deltaYaw =
        ((targetState.yawDeg - startCam.yawDeg + 540) % 360) - 180;

      const step = (now: number) => {
        const elapsed = now - startTime;
        const t = clamp(elapsed / durationMs, 0, 1);
        const ease =
          t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

        let nextYaw = startCam.yawDeg + deltaYaw * ease;
        if (nextYaw > 180) nextYaw -= 360;
        if (nextYaw < -180) nextYaw += 360;

        const interpolated: CameraState = {
          yawDeg: Number(nextYaw.toFixed(2)),
          pitchDeg: Number(
            (
              startCam.pitchDeg +
              (targetState.pitchDeg - startCam.pitchDeg) * ease
            ).toFixed(2)
          ),
          zoom: Number(
            (startCam.zoom + (targetState.zoom - startCam.zoom) * ease).toFixed(
              3
            )
          ),
          pivotZ: Number(
            (
              startCam.pivotZ +
              (targetState.pivotZ - startCam.pivotZ) * ease
            ).toFixed(1)
          ),
          screenYRatio: Number(
            (
              startCam.screenYRatio +
              (targetState.screenYRatio - startCam.screenYRatio) * ease
            ).toFixed(3)
          ),
          zCompress: Number(
            (
              startCam.zCompress +
              (targetState.zCompress - startCam.zCompress) * ease
            ).toFixed(3)
          ),
          sideBlend: Number(
            (
              startCam.sideBlend +
              (targetState.sideBlend - startCam.sideBlend) * ease
            ).toFixed(3)
          ),
          droneBlend: Number(
            (
              startCam.droneBlend +
              (targetState.droneBlend - startCam.droneBlend) * ease
            ).toFixed(3)
          ),
        };

        camRef.current = interpolated;
        setCam(interpolated);

        if (t < 1) {
          animFrameRef.current = requestAnimationFrame(step);
        } else {
          camRef.current = targetState;
          setCam(targetState);
          animFrameRef.current = null;
        }
      };

      animFrameRef.current = requestAnimationFrame(step);
    },
    [cancelCameraAnimation]
  );

  const dragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startYaw: number;
    startPitch: number;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    startYaw: 0,
    startPitch: 0,
  });

  const svgW = 1280;
  const svgH = 620;
  const pitchHalfW = 56;

  const applyPreset = (
    id: PitchCameraPresetId,
    overrideDirection?: 'BOWLER_LEFT' | 'BOWLER_RIGHT'
  ) => {
    setActivePreset(id);
    const dir = overrideDirection ?? sideViewDirection;
    const baseTarget = CAMERA_PRESETS[id].state;
    const targetYaw =
      id === 'SIDE_PARALLEL_VIEW' || id === 'DRONE_TOP_DOWN_VIEW'
        ? dir === 'BOWLER_LEFT'
          ? -90
          : 90
        : baseTarget.yawDeg;

    animateCameraTo({
      ...baseTarget,
      yawDeg: targetYaw,
    });
  };

  const projectSideParallel = (yCm: number, zCm: number) => {
    const padLeft = 74;
    const padRight = 78;
    const usableW = (svgW - padLeft - padRight) * clamp(cam.zoom, 0.65, 1.45);
    const centerOffset = (svgW - (padLeft + padRight + usableW)) * 0.5;

    const normZ = zCm / BOWLER_STUMPS_Z_CM;
    const horizFraction =
      sideViewDirection === 'BOWLER_LEFT' ? 1 - normZ : normZ;

    const screenX = padLeft + centerOffset + horizFraction * usableW;
    const groundY = svgH * 0.72;
    const vertScale = 1.66 * clamp(cam.zoom, 0.7, 1.35);
    const screenY = groundY - yCm * vertScale;

    return {
      x: screenX,
      y: screenY,
      groundY,
      vertScale,
    };
  };

  const projectDroneTopDown = (xCm: number, zCm: number) => {
    const padLeft = 74;
    const padRight = 74;
    const usableW = (svgW - padLeft - padRight) * clamp(cam.zoom, 0.68, 1.45);
    const centerOffset = (svgW - (padLeft + padRight + usableW)) * 0.5;

    const normZ = zCm / BOWLER_STUMPS_Z_CM;
    const horizFraction =
      sideViewDirection === 'BOWLER_LEFT' ? 1 - normZ : normZ;

    const screenX = padLeft + centerOffset + horizFraction * usableW;
    const centerY = svgH * 0.48;
    const lateralScale = 1.56 * clamp(cam.zoom, 0.72, 1.38);
    const screenY = centerY + xCm * lateralScale;

    return {
      x: screenX,
      y: screenY,
      centerY,
      lateralScale,
      pitchLeftX: padLeft + centerOffset,
      pitchRightX: padLeft + centerOffset + usableW,
    };
  };

  const project3D = (xCm: number, yCm: number, zCm: number) => {
    const yawRad = (cam.yawDeg * Math.PI) / 180;
    const pitchRad = (cam.pitchDeg * Math.PI) / 180;

    const pivotY = 28;
    const pivotZ = cam.pivotZ;
    const zScale = cam.zCompress ?? 0.72;

    const dx = xCm * 1.04;
    const dy = yCm * 0.82 - pivotY;
    const dz = (zCm - pivotZ) * zScale;

    const rx = dx * Math.cos(yawRad) + dz * Math.sin(yawRad);
    const rz1 = -dx * Math.sin(yawRad) + dz * Math.cos(yawRad);

    const ry = dy * Math.cos(pitchRad) - rz1 * Math.sin(pitchRad);
    const rz2 = dy * Math.sin(pitchRad) + rz1 * Math.cos(pitchRad);

    const camDist = 1120;
    const depthOffset = camDist - rz2;
    const safeDepth = Math.max(220, depthOffset);
    const baseScale = 2.65 * cam.zoom;
    const perspectiveScale = (camDist / safeDepth) * baseScale;

    const screenYOrigin = svgH * (cam.screenYRatio ?? 0.49);
    const p3dX = svgW * 0.5 + rx * perspectiveScale;
    const p3dY = screenYOrigin - ry * perspectiveScale;

    const sBlend = cam.sideBlend ?? 0;
    const dBlend = cam.droneBlend ?? 0;

    if (sBlend <= 0.001 && dBlend <= 0.001) {
      return {
        x: p3dX,
        y: p3dY,
        scale: perspectiveScale,
        depth: safeDepth,
      };
    }

    const w3d = Math.max(0, 1 - sBlend - dBlend);
    const sidePt =
      sBlend > 0.001 ? projectSideParallel(yCm, zCm) : { x: 0, y: 0 };
    const dronePt =
      dBlend > 0.001 ? projectDroneTopDown(xCm, zCm) : { x: 0, y: 0 };

    return {
      x: p3dX * w3d + sidePt.x * sBlend + dronePt.x * dBlend,
      y: p3dY * w3d + sidePt.y * sBlend + dronePt.y * dBlend,
      scale: perspectiveScale * w3d + 2.3 * cam.zoom * (sBlend + dBlend),
      depth: safeDepth,
    };
  };

  const toPolyPoints = (pts: Array<{ x: number; y: number }>) =>
    pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const project3DPathToSvgD = (pts: WorldPoint3D[]): string => {
    if (pts.length === 0) return '';
    return pts
      .map((p, idx) => {
        const proj = project3D(p.xCm, p.yCm, p.zCm);
        return `${idx === 0 ? 'M' : 'L'} ${proj.x.toFixed(1)} ${proj.y.toFixed(1)}`;
      })
      .join(' ');
  };

  const projectSidePathToSvgD = (pts: WorldPoint3D[]): string => {
    if (pts.length === 0) return '';
    return pts
      .map((p, idx) => {
        const proj = projectSideParallel(p.yCm, p.zCm);
        return `${idx === 0 ? 'M' : 'L'} ${proj.x.toFixed(1)} ${proj.y.toFixed(1)}`;
      })
      .join(' ');
  };

  const projectDronePathToSvgD = (pts: WorldPoint3D[]): string => {
    if (pts.length === 0) return '';
    return pts
      .map((p, idx) => {
        const proj = projectDroneTopDown(p.xCm, p.zCm);
        return `${idx === 0 ? 'M' : 'L'} ${proj.x.toFixed(1)} ${proj.y.toFixed(1)}`;
      })
      .join(' ');
  };

  const livePendingProjection = pendingPreview
    ? calculateImaginaryStumpPoint(
        pendingPreview.videoPoint,
        activeStumps,
        handedness,
        pendingPreview.bouncePoint
      )
    : null;

  const focusedContact =
    contacts.find((c) => c.id === selectedId) ||
    contacts.find((c) => c.id === hoveredBallId) ||
    contacts.find((c) => checkedBallIds.includes(c.id)) ||
    contacts[contacts.length - 1] ||
    null;

  // Auto-sync 3D camera preset when user changes video camera viewing angle (Behind Bowler vs Behind Batter vs Side)
  const prevCameraAngleRef = useRef<string | undefined>(activeStumps.cameraAngle);
  useEffect(() => {
    const effectiveAngle =
      (pendingPreview ? activeStumps.cameraAngle : focusedContact?.stumpConfig?.cameraAngle) ||
      activeStumps.cameraAngle;
    if (effectiveAngle && effectiveAngle !== prevCameraAngleRef.current) {
      prevCameraAngleRef.current = effectiveAngle;
      if (effectiveAngle === 'BEHIND_BATTER') {
        applyPreset('BACK_WK_VIEW');
      } else if (effectiveAngle === 'SIDE_DIAGONAL') {
        applyPreset('ORBIT_3D_VIEW');
      } else {
        applyPreset('FRONT_VIEW');
      }
    }
  }, [activeStumps.cameraAngle, focusedContact?.stumpConfig?.cameraAngle, pendingPreview]);

  const getCalibratedSpeedForContact = useCallback(
    (c: ContactPointRecord): number | undefined => {
      if (
        typeof c.calibratedSpeedKph === 'number' &&
        c.calibratedSpeedKph > 0
      ) {
        return c.calibratedSpeedKph;
      }
      return undefined;
    },
    []
  );

  const getPredictionForContact = useCallback(
    (c: ContactPointRecord) =>
      calculateBallTrajectory(
        c.stumpConfig,
        c.projection,
        handedness,
        trajectoryMode,
        DEFAULT_IMPACT_Z_CM,
        c.bounceLengthM,
        getCalibratedSpeedForContact(c),
        {
          releasePoint: c.releasePoint,
          bouncePoint: c.bouncePoint,
          contactPoint: c.videoPoint,
        }
      ),
    [handedness, trajectoryMode, getCalibratedSpeedForContact]
  );

  const pendingCalibratedSpeedKph = useMemo(() => {
    if (!pendingPreview) return undefined;
    if (
      typeof pendingPreview.calibratedSpeedKph === 'number' &&
      pendingPreview.calibratedSpeedKph > 0
    ) {
      return pendingPreview.calibratedSpeedKph;
    }
    return undefined;
  }, [pendingPreview]);

  const recordedTrajectoryPrediction = livePendingProjection
    ? calculateBallTrajectory(
        activeStumps,
        livePendingProjection,
        handedness,
        trajectoryMode,
        DEFAULT_IMPACT_Z_CM,
        previewBounceLengthM ?? pendingPreview?.bounceLengthM,
        pendingCalibratedSpeedKph,
        {
          releasePoint: pendingPreview?.releasePoint,
          bouncePoint: pendingPreview?.bouncePoint,
          contactPoint: pendingPreview?.videoPoint,
        }
      )
    : focusedContact
    ? getPredictionForContact(focusedContact)
    : null;

  // In DRS What-If mode, compute the live simulated trajectory alongside the recorded one
  const activeTrajectoryPrediction = useMemo(() => {
    if (!recordedTrajectoryPrediction) return null;
    if (!whatIfOverrides.enabled) return recordedTrajectoryPrediction;
    const baseStumps = livePendingProjection
      ? activeStumps
      : focusedContact
      ? focusedContact.stumpConfig
      : activeStumps;
    const baseProj =
      livePendingProjection || focusedContact?.projection || null;
    if (!baseProj) return recordedTrajectoryPrediction;
    const baseBounceM = livePendingProjection
      ? previewBounceLengthM ?? pendingPreview?.bounceLengthM ?? undefined
      : focusedContact?.bounceLengthM;
    const calSpeed = livePendingProjection
      ? pendingCalibratedSpeedKph
      : focusedContact
      ? getCalibratedSpeedForContact(focusedContact)
      : undefined;
    const flightAnchors = livePendingProjection
      ? {
          releasePoint: pendingPreview?.releasePoint,
          bouncePoint: pendingPreview?.bouncePoint,
          contactPoint: pendingPreview?.videoPoint,
        }
      : focusedContact
      ? {
          releasePoint: focusedContact.releasePoint,
          bouncePoint: focusedContact.bouncePoint,
          contactPoint: focusedContact.videoPoint,
        }
      : null;
    return applyWhatIfToTrajectory(
      baseStumps,
      baseProj,
      handedness,
      trajectoryMode,
      baseBounceM,
      whatIfOverrides,
      calSpeed,
      flightAnchors
    );
  }, [
    recordedTrajectoryPrediction,
    whatIfOverrides,
    livePendingProjection,
    activeStumps,
    focusedContact,
    previewBounceLengthM,
    pendingPreview,
    handedness,
    trajectoryMode,
    pendingCalibratedSpeedKph,
    getCalibratedSpeedForContact,
  ]);

  const activeDRSReview = useMemo(
    () =>
      activeTrajectoryPrediction
        ? evaluateDRSReview(
            activeTrajectoryPrediction,
            handedness,
            onFieldCall
          )
        : null,
    [activeTrajectoryPrediction, handedness, onFieldCall]
  );

  const recordedDRSReview = useMemo(
    () =>
      recordedTrajectoryPrediction
        ? evaluateDRSReview(
            recordedTrajectoryPrediction,
            handedness,
            onFieldCall
          )
        : null,
    [recordedTrajectoryPrediction, handedness, onFieldCall]
  );

  const activeTrajectoryRef = useRef<BallTrajectoryPrediction | null>(null);
  useEffect(() => {
    activeTrajectoryRef.current = activeTrajectoryPrediction;
  }, [activeTrajectoryPrediction]);

  // Reset What-If overrides when user switches to a different ball
  useEffect(() => {
    setWhatIfOverrides({
      enabled: false,
      pitchLineShiftCm: 0,
      impactLateralShiftCm: 0,
      bounceLengthM: null,
      heightMultiplier: 1.0,
      heightShiftCm: 0,
    });
  }, [focusedContact?.id]);

  // Choreographed TV Broadcast DRS Reveal Sequence Engine (Pitching -> Impact -> Wickets -> Big Screen Verdict)
  const triggerDrsBroadcastSequence = useCallback(() => {
    setDrsRevealStep(0);
    setDrsAnimProgress(0);
    setIsPlayingDrsSequence(true);
    setDrsSequenceRunId((n) => n + 1);
  }, []);

  // Automatically play the TV Broadcast DRS sequence when entering the DRS & Telemetry tab
  const prevWorkspaceTabRef = useRef<DashboardWorkspaceTab>(activeWorkspaceTab);
  useEffect(() => {
    if (
      prevWorkspaceTabRef.current !== 'DRS_TELEMETRY' &&
      activeWorkspaceTab === 'DRS_TELEMETRY'
    ) {
      triggerDrsBroadcastSequence();
    }
    prevWorkspaceTabRef.current = activeWorkspaceTab;
  }, [activeWorkspaceTab, triggerDrsBroadcastSequence]);

  useEffect(() => {
    if (!isPlayingDrsSequence) return;

    let rafId: number | null = null;
    const startMs = performance.now();
    const totalDurationMs = 3400; // 3.4s choreographed broadcast reveal

    const step = (now: number) => {
      const pred = activeTrajectoryRef.current;
      if (!pred) {
        setIsPlayingDrsSequence(false);
        return;
      }

      const elapsed = now - startMs;
      const t = clamp(elapsed / totalDurationMs, 0, 1);

      const pBounce = pred.bounceProgress;
      const pImpact = pred.impactProgress;

      let ballProg = 0;
      let nextStep: 0 | 1 | 2 | 3 | 4 = 0;
      if (t < 0.28) {
        ballProg = (t / 0.28) * pBounce;
        nextStep = 0;
      } else if (t < 0.36) {
        ballProg = pBounce;
        nextStep = 1;
      } else if (t < 0.58) {
        const u = (t - 0.36) / 0.22;
        ballProg = pBounce + u * (pImpact - pBounce);
        nextStep = 1;
      } else if (t < 0.66) {
        ballProg = pImpact;
        nextStep = 2;
      } else if (t < 0.84) {
        const u = (t - 0.66) / 0.18;
        ballProg = pImpact + u * (1 - pImpact);
        nextStep = 2;
      } else if (t < 0.93) {
        ballProg = 1;
        nextStep = 3;
      } else {
        ballProg = 1;
        nextStep = 4;
      }

      setDrsRevealStep((prev) => (prev === nextStep ? prev : nextStep));
      setDrsAnimProgress(Number(clamp(ballProg, 0, 1).toFixed(3)));

      if (t < 1) {
        rafId = requestAnimationFrame(step);
      } else {
        setDrsAnimProgress(1);
        setDrsRevealStep(4);
        setIsPlayingDrsSequence(false);
      }
    };

    rafId = requestAnimationFrame(step);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [isPlayingDrsSequence, drsSequenceRunId]);

  const handleJumpToDrsStep = (stepIdx: 1 | 2 | 3 | 4) => {
    setIsPlayingDrsSequence(false);
    setDrsRevealStep(stepIdx);
    if (!activeTrajectoryPrediction) return;
    if (stepIdx === 1) {
      setDrsAnimProgress(activeTrajectoryPrediction.bounceProgress);
    } else if (stepIdx === 2) {
      setDrsAnimProgress(activeTrajectoryPrediction.impactProgress);
    } else {
      setDrsAnimProgress(1);
    }
  };

  const handleScrubDrsProgress = (nextProg: number) => {
    const clampedProg = Number(clamp(nextProg, 0, 1).toFixed(3));
    setIsPlayingDrsSequence(false);
    setDrsAnimProgress(clampedProg);
    if (!activeTrajectoryPrediction) return;
    if (clampedProg >= 0.995) {
      setDrsRevealStep(4);
    } else if (clampedProg >= activeTrajectoryPrediction.impactProgress) {
      setDrsRevealStep(2);
    } else if (clampedProg >= activeTrajectoryPrediction.bounceProgress) {
      setDrsRevealStep(1);
    } else {
      setDrsRevealStep(0);
    }
  };

  const applyWhatIfPreset = (
    preset:
      | 'RECORDED'
      | 'THREE_REDS'
      | 'UMPIRES_CALL'
      | 'OUTSIDE_LEG'
      | 'OVER_BAILS'
  ) => {
    if (!recordedTrajectoryPrediction) return;
    setIsPlayingDrsSequence(false);
    setDrsRevealStep(4);
    setDrsAnimProgress(1);

    const baseStumpX = recordedTrajectoryPrediction.stumpIntersection3D.xCm;
    const baseStumpY = recordedTrajectoryPrediction.stumpIntersection3D.yCm;
    const baseBounceX = recordedTrajectoryPrediction.bouncePoint3D.xCm;
    const handednessSign = handedness === 'RHB' ? 1 : -1;

    if (preset === 'RECORDED') {
      setWhatIfOverrides({
        enabled: false,
        pitchLineShiftCm: 0,
        impactLateralShiftCm: 0,
        bounceLengthM: null,
        heightMultiplier: 1.0,
        heightShiftCm: 0,
      });
      return;
    }

    if (preset === 'THREE_REDS') {
      // Center on Middle Stump (x = 0cm, y = 42cm) and pitch in-line
      const latShift = Number((-baseStumpX).toFixed(1));
      const hShift = Number((42 - baseStumpY).toFixed(1));
      setWhatIfOverrides({
        enabled: true,
        pitchLineShiftCm: 0,
        impactLateralShiftCm: latShift,
        bounceLengthM: 5.6,
        heightMultiplier: 1.0,
        heightShiftCm: hShift,
      });
      return;
    }

    if (preset === 'UMPIRES_CALL') {
      // Graze outer edge of Off Stump (~13.2cm outside middle -> ~25% ball overlap) at 48cm height
      const targetX = -handednessSign * 13.2;
      const latShift = Number((targetX - baseStumpX).toFixed(1));
      const hShift = Number((48 - baseStumpY).toFixed(1));
      setWhatIfOverrides({
        enabled: true,
        pitchLineShiftCm: 0,
        impactLateralShiftCm: latShift,
        bounceLengthM: 5.8,
        heightMultiplier: 1.0,
        heightShiftCm: hShift,
      });
      return;
    }

    if (preset === 'OUTSIDE_LEG') {
      // Pitch outside Leg Stump (+16cm on leg side) while angling back toward middle stump
      const legPitchTargetX = handednessSign * 17.5;
      const latShift = Number((-baseStumpX).toFixed(1));
      const pitchShift = Number(
        (legPitchTargetX - (baseBounceX + latShift)).toFixed(1)
      );
      setWhatIfOverrides({
        enabled: true,
        pitchLineShiftCm: clamp(pitchShift, -30, 30),
        impactLateralShiftCm: latShift,
        bounceLengthM: 5.4,
        heightMultiplier: 1.0,
        heightShiftCm: Number((40 - baseStumpY).toFixed(1)),
      });
      return;
    }

    if (preset === 'OVER_BAILS') {
      // Short-of-good-length bounce rising over the bails (stumpY = 79cm > 74.72cm)
      const latShift = Number((-baseStumpX).toFixed(1));
      const hShift = Number((79 - baseStumpY).toFixed(1));
      setWhatIfOverrides({
        enabled: true,
        pitchLineShiftCm: 0,
        impactLateralShiftCm: latShift,
        bounceLengthM: 7.8,
        heightMultiplier: 1.0,
        heightShiftCm: hShift,
      });
    }
  };

  const displayedBounceM =
    whatIfOverrides.enabled && whatIfOverrides.bounceLengthM !== null
      ? whatIfOverrides.bounceLengthM
      : livePendingProjection
      ? previewBounceLengthM ??
        pendingPreview?.bounceLengthM ??
        activeTrajectoryPrediction?.bounceDistanceFromStumpsM ??
        5.8
      : focusedContact
      ? focusedContact.bounceLengthM ??
        activeTrajectoryPrediction?.bounceDistanceFromStumpsM ??
        5.8
      : 5.8;

  const handleBounceLengthChange = (nextMeters: number) => {
    const clampedM = Number(clamp(nextMeters, 1.3, 13.0).toFixed(1));
    if (whatIfOverrides.enabled) {
      setWhatIfOverrides((prev) => ({
        ...prev,
        bounceLengthM: clampedM,
      }));
      return;
    }
    if (livePendingProjection) {
      setPreviewBounceLengthM(clampedM);
    } else if (focusedContact && onUpdateContactBounceLength) {
      onUpdateContactBounceLength(focusedContact.id, clampedM);
    }
  };

  const handleResetBounceLengthAuto = () => {
    if (whatIfOverrides.enabled) {
      setWhatIfOverrides((prev) => ({
        ...prev,
        bounceLengthM: null,
      }));
      return;
    }
    if (livePendingProjection) {
      setPreviewBounceLengthM(null);
    } else if (focusedContact && onUpdateContactBounceLength) {
      const naturalM = estimateNaturalBounceLengthM(
        focusedContact.projection.contactHeightCm
      );
      onUpdateContactBounceLength(focusedContact.id, naturalM);
    }
  };

  // Interactive Dragging on the 1:1 DRS Stump SVG for live "What-If" simulation
  const drsStumpDragRef = useRef<boolean>(false);

  const updateWhatIfFromStumpSvgEvent = (
    e: React.PointerEvent<SVGSVGElement>
  ) => {
    if (!recordedTrajectoryPrediction) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    // SVG viewBox is "-38 -16 76 98"
    const svgX = -38 + ((e.clientX - rect.left) / rect.width) * 76;
    const svgY = -16 + ((e.clientY - rect.top) / rect.height) * 98;

    const targetStumpXCm = clamp(svgX, -34, 34);
    const targetStumpYCm = clamp(71.12 - svgY, 2, 88);

    const baseStumpX = recordedTrajectoryPrediction.stumpIntersection3D.xCm;
    const baseStumpY = recordedTrajectoryPrediction.stumpIntersection3D.yCm;

    // Account for any active pitchLineShiftCm when computing lateral shift so the stump ball stays 1:1 under pointer
    const bounceZCm = recordedTrajectoryPrediction.bouncePoint3D.zCm;
    const impactZCm = recordedTrajectoryPrediction.impactPoint3D.zCm;
    const distBounceToImpact = Math.max(16, bounceZCm - impactZCm);
    const pitchEffectCm =
      Math.abs(whatIfOverrides.pitchLineShiftCm) > 0.05
        ? -whatIfOverrides.pitchLineShiftCm *
          (impactZCm / distBounceToImpact) *
          0.72
        : 0;

    const lateralShift = Number(
      clamp(targetStumpXCm - baseStumpX - pitchEffectCm, -34, 34).toFixed(1)
    );
    const heightShift = Number(
      clamp(targetStumpYCm - baseStumpY, -55, 55).toFixed(1)
    );

    setWhatIfOverrides((prev) => ({
      ...prev,
      enabled: true,
      impactLateralShiftCm: lateralShift,
      heightShiftCm: heightShift,
    }));
    setDrsRevealStep(4);
    setDrsAnimProgress(1);
    setIsPlayingDrsSequence(false);
  };

  const visibleContacts = useMemo(() => {
    if (trackingScope === 'ALL') {
      return contacts;
    }
    if (checkedBallIds.length > 0) {
      const filtered = contacts.filter((c) => checkedBallIds.includes(c.id));
      if (filtered.length > 0) return filtered;
    }
    if (focusedContact) {
      return [focusedContact];
    }
    return contacts;
  }, [trackingScope, contacts, checkedBallIds, focusedContact]);

  // =========================================================================
  // PITCH HEATMAP, ZONE MATRIX & BEEHIVE COMPUTATIONS
  // =========================================================================
  const heatmapSourceContacts =
    heatmapScope === 'ALL' ? contacts : visibleContacts;

  const heatmapSourceItems = useMemo(
    () =>
      heatmapSourceContacts.map((c) => ({
        id: c.id,
        indexNumber: c.indexNumber,
        contact: c,
        pred: getPredictionForContact(c),
      })),
    [heatmapSourceContacts, getPredictionForContact]
  );

  const pitchHeatmapData = useMemo(
    () => computePitchHeatmapData(heatmapSourceItems),
    [heatmapSourceItems]
  );

  const pitchZoneMatrix = useMemo(
    () => computePitchZoneMatrix(heatmapSourceItems, handedness),
    [heatmapSourceItems, handedness]
  );

  const beehiveSummary = useMemo(
    () => computeBeehiveHeatmap(heatmapSourceItems, handedness),
    [heatmapSourceItems, handedness]
  );

  const roleCoachingInsights = useMemo(
    () =>
      computeRoleCoachingInsights(
        activeTrajectoryPrediction,
        heatmapSourceItems.map((i) => i.pred),
        handedness
      ),
    [activeTrajectoryPrediction, heatmapSourceItems, handedness]
  );

  // =========================================================================
  // HAWK-EYE BALL TRAJECTORY ANIMATION ENGINE
  // =========================================================================
  const [animProgress, setAnimProgress] = useState<number>(0);
  const [isPlayingAnim, setIsPlayingAnim] = useState<boolean>(true);
  const [animSpeedMultiplier, setAnimSpeedMultiplier] = useState<number>(1.0);
  const [isLoopingAnim, setIsLoopingAnim] = useState<boolean>(false);

  const trajectoryRafRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const loopHoldTimeoutRef = useRef<number | null>(null);

  const masterFlightDurationMs = (() => {
    if (livePendingProjection && activeTrajectoryPrediction) {
      return activeTrajectoryPrediction.realFlightDurationMs;
    }
    if (visibleContacts.length === 0) return 540;
    if (visibleContacts.length === 1) {
      return getPredictionForContact(visibleContacts[0]).realFlightDurationMs;
    }
    return Math.max(
      ...visibleContacts.map(
        (c) => getPredictionForContact(c).realFlightDurationMs
      ),
      480
    );
  })();

  const triggerTrajectoryReplay = useCallback(() => {
    if (loopHoldTimeoutRef.current !== null) {
      window.clearTimeout(loopHoldTimeoutRef.current);
      loopHoldTimeoutRef.current = null;
    }
    lastFrameTimeRef.current = null;
    setAnimProgress(0);
    setIsPlayingAnim(true);
  }, []);

  const prevSelectedIdRef = useRef<string | null | undefined>(selectedId);
  useEffect(() => {
    if (prevSelectedIdRef.current !== selectedId) {
      prevSelectedIdRef.current = selectedId;
      triggerTrajectoryReplay();
    }
  }, [selectedId, triggerTrajectoryReplay]);

  useEffect(() => {
    if (pendingPreview) {
      triggerTrajectoryReplay();
    }
  }, [pendingPreview, triggerTrajectoryReplay]);

  useEffect(() => {
    if (!isPlayingAnim) {
      if (trajectoryRafRef.current !== null) {
        cancelAnimationFrame(trajectoryRafRef.current);
        trajectoryRafRef.current = null;
      }
      lastFrameTimeRef.current = null;
      return;
    }

    const tick = (now: number) => {
      if (lastFrameTimeRef.current === null) {
        lastFrameTimeRef.current = now;
      }
      const deltaMs = Math.min(64, Math.max(0, now - lastFrameTimeRef.current));
      lastFrameTimeRef.current = now;

      setAnimProgress((prev) => {
        const step =
          (deltaMs * animSpeedMultiplier) / Math.max(250, masterFlightDurationMs);
        const next = prev + step;
        if (next >= 1) {
          if (isLoopingAnim) {
            setIsPlayingAnim(false);
            loopHoldTimeoutRef.current = window.setTimeout(() => {
              lastFrameTimeRef.current = null;
              setAnimProgress(0);
              setIsPlayingAnim(true);
            }, 460);
          } else {
            setIsPlayingAnim(false);
          }
          return 1;
        }
        return Number(next.toFixed(4));
      });

      trajectoryRafRef.current = requestAnimationFrame(tick);
    };

    trajectoryRafRef.current = requestAnimationFrame(tick);

    return () => {
      if (trajectoryRafRef.current !== null) {
        cancelAnimationFrame(trajectoryRafRef.current);
        trajectoryRafRef.current = null;
      }
    };
  }, [isPlayingAnim, animSpeedMultiplier, masterFlightDurationMs, isLoopingAnim]);

  useEffect(() => {
    return () => {
      if (loopHoldTimeoutRef.current !== null) {
        window.clearTimeout(loopHoldTimeoutRef.current);
      }
    };
  }, []);

  const getBallProgress = useCallback(
    (pred: BallTrajectoryPrediction): number => {
      if (animProgress >= 0.999) return 1;
      if (animProgress <= 0.001) return 0;
      const elapsedPhysicalMs = animProgress * masterFlightDurationMs;
      return clamp(
        elapsedPhysicalMs / Math.max(250, pred.realFlightDurationMs),
        0,
        1
      );
    },
    [animProgress, masterFlightDurationMs]
  );

  // Compute time-synced video timestamp (sec) for the active delivery as animProgress moves 0..1
  const syncedVideoTimestampSec = useMemo(() => {
    const tImpact = pendingPreview
      ? pendingPreview.timestampSec
      : focusedContact?.timestampSec ?? 0;
    const tRelease = pendingPreview
      ? pendingPreview.releaseTimestampSec ?? Math.max(0, tImpact - 0.44)
      : focusedContact?.releaseTimestampSec ?? Math.max(0, tImpact - 0.44);
    const tBounce = pendingPreview
      ? pendingPreview.bounceTimestampSec ??
        Number((tRelease + (tImpact - tRelease) * 0.65).toFixed(3))
      : focusedContact?.bounceTimestampSec ??
        Number((tRelease + (tImpact - tRelease) * 0.65).toFixed(3));

    const pBounce = activeTrajectoryPrediction?.bounceProgress ?? 0.68;
    const pImpact = activeTrajectoryPrediction?.impactProgress ?? 0.92;

    if (animProgress <= pBounce) {
      const u = pBounce > 0.01 ? clamp(animProgress / pBounce, 0, 1) : 0;
      return Number((tRelease + (tBounce - tRelease) * u).toFixed(3));
    }
    if (animProgress <= pImpact) {
      const u =
        pImpact - pBounce > 0.01
          ? clamp((animProgress - pBounce) / (pImpact - pBounce), 0, 1)
          : 1;
      return Number((tBounce + (tImpact - tBounce) * u).toFixed(3));
    }
    const u =
      1 - pImpact > 0.01
        ? clamp((animProgress - pImpact) / (1 - pImpact), 0, 1)
        : 1;
    return Number((tImpact + 0.095 * u).toFixed(3));
  }, [
    animProgress,
    pendingPreview,
    focusedContact,
    activeTrajectoryPrediction,
  ]);

  // Seek the PiP video element in real time when scrubbing or animating 3D trajectory
  useEffect(() => {
    const vid = pipVideoRef.current;
    if (!vid || !activeVideoUrl || !showSyncedVideoPiP) return;
    if (Math.abs(vid.currentTime - syncedVideoTimestampSec) > 0.025) {
      try {
        vid.currentTime = syncedVideoTimestampSec;
      } catch {
        // ignore seek errors while loading
      }
    }
  }, [syncedVideoTimestampSec, activeVideoUrl, showSyncedVideoPiP]);

  const handleTrackSingleBall = (contactId: string) => {
    onSelectContact(contactId);
    setTrackingScope('SELECTED');
    setCheckedBallIds([contactId]);
    setHighlightedZoneKey(null);
    triggerTrajectoryReplay();
  };

  const handleToggleBallCheck = (contactId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTrackingScope('SELECTED');
    setHighlightedZoneKey(null);
    setCheckedBallIds((prev) => {
      const base =
        trackingScope === 'ALL'
          ? focusedContact
            ? [focusedContact.id]
            : []
          : prev;
      if (base.includes(contactId)) {
        const next = base.filter((id) => id !== contactId);
        if (next.length === 0) {
          setTrackingScope('ALL');
          return [];
        }
        if (selectedId === contactId) {
          onSelectContact(next[0]);
        }
        return next;
      } else {
        onSelectContact(contactId);
        return [...base, contactId];
      }
    });
    triggerTrajectoryReplay();
  };

  const handleTrackAllBalls = () => {
    setTrackingScope('ALL');
    setCheckedBallIds([]);
    setHighlightedZoneKey(null);
    triggerTrajectoryReplay();
  };

  const handleFilterByZoneCell = (cellKey: string, ballIds: string[]) => {
    if (highlightedZoneKey === cellKey) {
      setHighlightedZoneKey(null);
      handleTrackAllBalls();
      return;
    }
    setHighlightedZoneKey(cellKey);
    if (ballIds.length > 0) {
      setTrackingScope('SELECTED');
      setCheckedBallIds(ballIds);
      onSelectContact(ballIds[0]);
      triggerTrajectoryReplay();
    }
  };

  const handleExportSessionCsv = () => {
    if (contacts.length === 0) return;
    const headers = [
      'Ball_Number',
      'Zone',
      'Bounce_Length_m',
      'Length_Category',
      'Calibrated_Speed_Kph',
      'Calibrated_Speed_Mph',
      'Offset_From_Middle_cm',
      'Contact_Height_cm',
      'Stump_Height_cm',
      'Lateral_Deviation_Deg',
      'Lateral_Drift_cm',
      'DRS_Pitching',
      'DRS_Impact',
      'DRS_Wickets',
      'DRS_Final_Decision',
    ];
    const rows = contacts.map((c) => {
      const pred = getPredictionForContact(c);
      const drs = evaluateDRSReview(pred, handedness);
      return [
        c.indexNumber,
        `"${c.projection.zone}"`,
        pred.bounceDistanceFromStumpsM,
        `"${pred.lengthCategoryLabel}"`,
        pred.hasCalibratedSpeed && pred.calibratedSpeedKph
          ? pred.calibratedSpeedKph
          : '"Uncalibrated"',
        pred.hasCalibratedSpeed && pred.calibratedSpeedMph
          ? pred.calibratedSpeedMph
          : '"Uncalibrated"',
        c.projection.offsetFromMiddleCm,
        c.projection.contactHeightCm,
        pred.stumpIntersection3D.yCm,
        pred.lateralDeviationDeg,
        pred.lateralDriftCm,
        `"${drs.pitching.verdict}"`,
        `"${drs.impact.verdict}"`,
        `"${drs.wickets.verdict}"`,
        `"${drs.finalDecision}"`,
      ].join(',');
    });
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `creaselabb-telemetry-${handedness.toLowerCase()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if ((e.target as HTMLElement).dataset.ballmarker) return;
    if (activePreset === 'SIDE_PARALLEL_VIEW' && cam.sideBlend > 0.9) return;
    if (activePreset === 'DRONE_TOP_DOWN_VIEW' && cam.droneBlend > 0.9) {
      const svgRect = e.currentTarget.getBoundingClientRect();
      if (svgRect.width > 0) {
        const svgX = ((e.clientX - svgRect.left) / svgRect.width) * svgW;
        const leftEnd = projectDroneTopDown(0, BOWLER_STUMPS_Z_CM);
        const rightEnd = projectDroneTopDown(0, 0);
        const minX = Math.min(leftEnd.x, rightEnd.x);
        const maxX = Math.max(leftEnd.x, rightEnd.x);
        if (svgX >= minX && svgX <= maxX) {
          const frac = (svgX - minX) / Math.max(1, maxX - minX);
          const normZ =
            sideViewDirection === 'BOWLER_LEFT' ? 1 - frac : frac;
          const clickedMeters = normZ * PITCH_LENGTH_METERS;
          if (clickedMeters >= 1.3 && clickedMeters <= 13.0) {
            handleBounceLengthChange(clickedMeters);
          }
        }
      }
      return;
    }

    cancelCameraAnimation();
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      startYaw: cam.yawDeg,
      startPitch: cam.pitchDeg,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    let nextYaw = dragRef.current.startYaw + dx * 0.35;
    if (nextYaw > 180) nextYaw -= 360;
    if (nextYaw < -180) nextYaw += 360;
    setCam((prev) => ({
      ...prev,
      yawDeg: Number(nextYaw.toFixed(1)),
      pitchDeg: clamp(dragRef.current.startPitch - dy * 0.22, 6, 68),
      sideBlend: 0,
      droneBlend: 0,
    }));
  };

  const handlePointerUp = () => {
    dragRef.current.active = false;
  };

  useEffect(() => {
    const viewportEl = pitchViewportRef.current;
    const zoomBarEl = zoomBarRef.current;

    const onNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rawDelta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      if (rawDelta === 0) return;
      cancelCameraAnimation();
      const step = e.ctrlKey ? 0.06 : 0.08;
      const delta = rawDelta < 0 ? step : -step;
      setCam((prev) => ({
        ...prev,
        zoom: Number(clamp(prev.zoom + delta, 0.35, 1.75).toFixed(2)),
      }));
    };

    const preventSafariGesture = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };

    if (viewportEl) {
      viewportEl.addEventListener('wheel', onNativeWheel, { passive: false });
      viewportEl.addEventListener('gesturestart', preventSafariGesture, {
        passive: false,
      });
      viewportEl.addEventListener('gesturechange', preventSafariGesture, {
        passive: false,
      });
    }
    if (zoomBarEl) {
      zoomBarEl.addEventListener('wheel', onNativeWheel, { passive: false });
    }

    return () => {
      if (viewportEl) {
        viewportEl.removeEventListener('wheel', onNativeWheel);
        viewportEl.removeEventListener('gesturestart', preventSafariGesture);
        viewportEl.removeEventListener('gesturechange', preventSafariGesture);
      }
      if (zoomBarEl) {
        zoomBarEl.removeEventListener('wheel', onNativeWheel);
      }
    };
  }, [cancelCameraAnimation]);

  const leftSideLabel = handedness === 'RHB' ? 'OFF SIDE' : 'LEG SIDE';
  const rightSideLabel = handedness === 'RHB' ? 'LEG SIDE' : 'OFF SIDE';

  const leftStumpName = handedness === 'RHB' ? 'OFF' : 'LEG';
  const rightStumpName = handedness === 'RHB' ? 'LEG' : 'OFF';

  const strikerStumps3D = [
    { name: leftStumpName, xCm: -11.43 },
    { name: 'MID', xCm: 0 },
    { name: rightStumpName, xCm: 11.43 },
  ];

  const bowlerStumps3D = [
    { name: leftStumpName, xCm: -11.43 },
    { name: 'MID', xCm: 0 },
    { name: rightStumpName, xCm: 11.43 },
  ];

  const isLookingFromWicketkeeperEnd = Math.abs(cam.yawDeg) > 90;

  // Helper: Does a delivery actually hit/break the striker stumps & lift the Zing bails?
  // Caught or Edged dismissals mean the ball deflected off the bat to a fielder/keeper and did NOT break the stumps.
  const isCatchOrEdgeDismissal = (c: ContactPointRecord): boolean =>
    Boolean(
      c.isOut &&
        (c.dismissalType === 'CAUGHT' || c.dismissalType === 'EDGED')
    );

  const hasVisibleStumpBreakingOut = useMemo(() => {
    return visibleContacts.some((c) => {
      if (!c.isOut) return false;
      if (c.dismissalType === 'CAUGHT' || c.dismissalType === 'EDGED') {
        return false;
      }
      if (c.dismissalType === 'LBW') {
        const pred = getPredictionForContact(c);
        return pred.hittingWicket;
      }
      // BOWLED, STUMPED, RUN_OUT, or default unspecified wicket
      return true;
    });
  }, [visibleContacts, getPredictionForContact]);

  const isStrikerZingIlluminated = useMemo(() => {
    return visibleContacts.some((c) => {
      if (c.isOut) {
        if (c.dismissalType === 'CAUGHT' || c.dismissalType === 'EDGED') {
          return false;
        }
        if (c.dismissalType === 'LBW') {
          const pred = getPredictionForContact(c);
          return pred.hittingWicket;
        }
        return true;
      }
      const pred = getPredictionForContact(c);
      if (!pred.hittingWicket) return false;
      const prog = getBallProgress(pred);
      return prog >= 0.96;
    });
  }, [visibleContacts, getPredictionForContact, getBallProgress]);

  const renderStumpSet3D = (
    zPlaneCm: number,
    isStrikerEnd: boolean,
    stumpsList: Array<{ name: string; xCm: number }>,
    forceZingFlash = false
  ) => {
    const zingActive =
      isStrikerEnd && (isStrikerZingIlluminated || forceZingFlash);

    const woodBaseColor = zingActive
      ? '#BE123C'
      : isStrikerEnd
      ? '#B45309'
      : '#0369A1';
    const woodLightColor = zingActive
      ? '#FFE4E6'
      : isStrikerEnd
      ? '#FDE68A'
      : '#BAE6FD';
    const woodMidColor = zingActive
      ? '#F43F5E'
      : isStrikerEnd
      ? '#F59E0B'
      : '#38BDF8';
    const radiusCm = 1.85;
    const bailLiftCm = zingActive
      ? hasVisibleStumpBreakingOut
        ? 8.5
        : 3.2
      : 0;

    return (
      <g key={`stumps-${zPlaneCm}`}>
        <polygon
          points={toPolyPoints([
            project3D(-15, 0, zPlaneCm - 4),
            project3D(15, 0, zPlaneCm - 4),
            project3D(15, 0, zPlaneCm + 4),
            project3D(-15, 0, zPlaneCm + 4),
          ])}
          fill={
            zingActive
              ? 'rgba(244, 63, 94, 0.42)'
              : isStrikerEnd
              ? 'rgba(245, 158, 11, 0.22)'
              : 'rgba(56, 189, 248, 0.22)'
          }
        />

        {stumpsList.map((st, idx) => {
          const bL = project3D(st.xCm - radiusCm, 0, zPlaneCm);
          const bR = project3D(st.xCm + radiusCm, 0, zPlaneCm);
          const tR = project3D(st.xCm + radiusCm, 71.12, zPlaneCm);
          const tL = project3D(st.xCm - radiusCm, 71.12, zPlaneCm);
          const baseCenter = project3D(st.xCm, -5.5, zPlaneCm);

          return (
            <g key={idx}>
              <polygon
                points={toPolyPoints([bL, bR, tR, tL])}
                fill={woodMidColor}
                stroke={woodBaseColor}
                strokeWidth={zingActive ? '1.8' : '1'}
              >
                {zingActive && hasVisibleStumpBreakingOut && (
                  <animate
                    attributeName="opacity"
                    values="1;0.65;1"
                    dur="0.85s"
                    repeatCount="indefinite"
                  />
                )}
              </polygon>
              <line
                x1={(bL.x + bR.x) * 0.5}
                y1={bL.y}
                x2={(tL.x + tR.x) * 0.5}
                y2={tL.y}
                stroke={woodLightColor}
                strokeWidth={Math.max(1.2, bL.scale * (zingActive ? 1.25 : 0.8))}
                opacity={zingActive ? '0.98' : '0.8'}
              />
              <text
                x={baseCenter.x}
                y={baseCenter.y + 8}
                textAnchor="middle"
                fill={woodLightColor}
                fontSize={isStrikerEnd ? '10' : '9'}
                fontFamily="monospace"
                fontWeight="bold"
              >
                {st.name}
              </text>
            </g>
          );
        })}

        {[
          {
            x1: -12.2,
            x2: -0.4,
            tilt: zingActive ? (hasVisibleStumpBreakingOut ? 5.2 : 1.8) : 0,
          },
          {
            x1: 0.4,
            x2: 12.2,
            tilt: zingActive ? (hasVisibleStumpBreakingOut ? -4.8 : -1.6) : 0,
          },
        ].map((bail, bIdx) => {
          const b1 = project3D(
            bail.x1,
            71.5 + bailLiftCm,
            zPlaneCm
          );
          const b2 = project3D(
            bail.x2,
            71.5 + bailLiftCm + bail.tilt,
            zPlaneCm
          );
          const b3 = project3D(
            bail.x2,
            73.5 + bailLiftCm + bail.tilt,
            zPlaneCm
          );
          const b4 = project3D(
            bail.x1,
            73.5 + bailLiftCm,
            zPlaneCm
          );
          return (
            <polygon
              key={bIdx}
              points={toPolyPoints([b1, b2, b3, b4])}
              fill={zingActive ? '#FDA4AF' : woodLightColor}
              stroke={zingActive ? '#F43F5E' : woodBaseColor}
              strokeWidth={zingActive ? '1.6' : '0.9'}
            >
              {zingActive && hasVisibleStumpBreakingOut && (
                <animate
                  attributeName="opacity"
                  values="1;0.35;1"
                  dur="0.65s"
                  repeatCount="indefinite"
                />
              )}
            </polygon>
          );
        })}

        {(() => {
          const topLabelPos = project3D(0, 84, zPlaneCm);
          return (
            <g>
              <rect
                x={topLabelPos.x - 74}
                y={topLabelPos.y - 11}
                width="148"
                height="18"
                rx="5"
                fill="rgba(6, 9, 15, 0.88)"
                stroke={
                  zingActive
                    ? '#F43F5E'
                    : isStrikerEnd
                    ? '#F59E0B'
                    : '#38BDF8'
                }
                strokeWidth="1.2"
              />
              <text
                x={topLabelPos.x}
                y={topLabelPos.y + 1}
                textAnchor="middle"
                fill={woodLightColor}
                fontSize="9.5"
                fontFamily="monospace"
                fontWeight="bold"
              >
                {zingActive
                  ? 'ZING WICKET HIT (0m)'
                  : isStrikerEnd
                  ? 'STRIKER STUMPS (0m)'
                  : 'BOWLER STUMPS (20.12m)'}
              </text>
            </g>
          );
        })()}
      </g>
    );
  };

  const showSideParallelHud =
    activePreset === 'SIDE_PARALLEL_VIEW' && cam.sideBlend >= 0.96;
  const showDroneTopDownHud =
    activePreset === 'DRONE_TOP_DOWN_VIEW' && cam.droneBlend >= 0.96;

  const renderDrsLampBadge = (color: DRSCheckColor, verdict: string) => {
    const styles =
      color === 'RED'
        ? 'bg-rose-500/20 text-rose-200 border-rose-500/60'
        : color === 'AMBER'
        ? 'bg-amber-500/20 text-amber-200 border-amber-500/60'
        : 'bg-emerald-500/20 text-emerald-200 border-emerald-500/60';
    const dotColor =
      color === 'RED'
        ? '#F43F5E'
        : color === 'AMBER'
        ? '#F59E0B'
        : '#10B981';

    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-mono text-xs font-bold tracking-tight ${styles}`}
      >
        <svg className="w-2.5 h-2.5 shrink-0" viewBox="0 0 10 10">
          <circle cx="5" cy="5" r="4.5" fill={dotColor} />
        </svg>
        {verdict}
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      {/* =====================================================================
       * IMMERSIVE FULL-CANVAS 22-YARD PITCH STUDIO WITH FLOATING GLASSMORPHIC DOCKS
       * ===================================================================== */}
      {activeWorkspaceTab !== 'DRS_TELEMETRY' && (
        <div
          className={
            isImmersiveMode
              ? 'fixed inset-0 z-[100] w-screen h-screen bg-[#070A10] flex flex-col justify-between overflow-hidden'
              : 'relative bg-[#0C111C] border border-slate-800/80 rounded-xl overflow-hidden flex flex-col'
          }
        >
          {/* UNSAVED PREVIEW BANNER (Only appears when staging a new video point) */}
          {pendingPreview && livePendingProjection && (
            <div className="px-4 py-3 bg-emerald-500/10 border-b border-emerald-500/40 flex flex-wrap items-center justify-between gap-3 z-30">
              <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums">
                <span className="px-2.5 py-0.5 rounded-lg bg-emerald-500/20 border border-emerald-400/40 font-bold text-emerald-300">
                  STAGED CONTACT
                </span>
                <span className="text-white font-bold">
                  {livePendingProjection.zone} ·{' '}
                  {Math.abs(livePendingProjection.offsetFromMiddleCm)} cm{' '}
                  {livePendingProjection.offsetFromMiddleCm === 0
                    ? 'Mid'
                    : livePendingProjection.offsetFromMiddleCm < 0
                    ? 'Off'
                    : 'Leg'}{' '}
                  · {livePendingProjection.contactHeightCm} cm High
                  {activeTrajectoryPrediction
                    ? ` · BOUNCE ${activeTrajectoryPrediction.bounceDistanceFromStumpsM}m`
                    : ''}
                  {typeof pendingCalibratedSpeedKph === 'number'
                    ? ` · ⚡ ${pendingCalibratedSpeedKph} km/h`
                    : ''}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onCommitPendingPreview(previewBounceLengthM);
                    setPreviewBounceLengthM(null);
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-bold bg-emerald-400 hover:bg-emerald-300 text-slate-950 cursor-pointer transition"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Save Delivery
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPreviewBounceLengthM(null);
                    onDiscardPendingPreview();
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#070A10] hover:bg-[#111827] text-slate-300 border border-slate-800/80 cursor-pointer transition"
                >
                  Discard
                </button>
              </div>
            </div>
          )}

          {/* HIGH-CONTRAST MINIMALIST 3D PITCH TELEMETRY GRID (BOUNCE POSITION, SPEED & SEAM, CONTACT POINT, WICKET DRS) */}
          {!isImmersiveMode &&
            activeTrajectoryPrediction &&
            focusedContact &&
            activeDRSReview && (
              <div className="p-4 bg-[#0C111C] border-b border-slate-800/80">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-mono">
                  {/* CARD 01: BOUNCE POSITION & LENGTH */}
                  <div className="group relative bg-[#070A10] hover:bg-[#111827] border border-slate-800/80 hover:border-emerald-500/40 rounded-lg p-3.5 flex flex-col justify-between gap-2 transition">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 group-hover:text-emerald-300 transition">
                        01 · BOUNCE POSITION
                      </span>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-400/35">
                        {focusedContact.bouncePoint ? 'POINTED · ' : 'AUTO · '}
                        {
                          activeTrajectoryPrediction.lengthCategoryLabel.split(
                            ' '
                          )[0]
                        }
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <div>
                        <div className="text-[10px] text-slate-500 uppercase">
                          PITCH DISTANCE
                        </div>
                        <div className="text-xl font-bold text-emerald-300 tabular-nums">
                          {
                            activeTrajectoryPrediction.bounceDistanceFromStumpsM
                          }
                          m
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-slate-500 uppercase">
                          PITCH LINE
                        </div>
                        <div className="text-base font-bold text-white tabular-nums">
                          {Math.abs(
                            activeTrajectoryPrediction.bouncePoint3D.xCm
                          ).toFixed(1)}
                          cm{' '}
                          {activeTrajectoryPrediction.bouncePoint3D.xCm === 0
                            ? 'MID'
                            : activeTrajectoryPrediction.bouncePoint3D.xCm < 0
                            ? 'OFF'
                            : 'LEG'}
                        </div>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
                      <span>PITCHING ZONE</span>
                      <span className="text-emerald-300 font-bold">
                        {activeDRSReview.pitching.verdict}
                      </span>
                    </div>
                  </div>

                  {/* CARD 02: DELIVERY SPEED & SEAM MOVEMENT */}
                  <div className="group relative bg-[#070A10] hover:bg-[#111827] border border-slate-800/80 hover:border-cyan-500/40 rounded-lg p-3.5 flex flex-col justify-between gap-2 transition">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 group-hover:text-cyan-300 transition">
                        02 · SPEED &amp; SEAM
                      </span>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-400/35">
                        {activeTrajectoryPrediction.hasCalibratedSpeed
                          ? 'RADAR LOCK'
                          : '2-PT SOLVER'}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <div>
                        <div className="text-[10px] text-slate-500 uppercase">
                          RELEASE PACE
                        </div>
                        <div className="text-xl font-bold text-cyan-300 tabular-nums">
                          {activeTrajectoryPrediction.hasCalibratedSpeed &&
                          activeTrajectoryPrediction.calibratedSpeedKph
                            ? `${activeTrajectoryPrediction.calibratedSpeedKph} km/h`
                            : `${Math.abs(
                                activeTrajectoryPrediction.lateralDeviationDeg
                              )}° Seam`}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-slate-500 uppercase">
                          LATERAL DRIFT
                        </div>
                        <div className="text-base font-bold text-white tabular-nums">
                          {activeTrajectoryPrediction.lateralDriftCm > 0
                            ? '+'
                            : ''}
                          {activeTrajectoryPrediction.lateralDriftCm} cm
                        </div>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
                      <span>DEVIATION ANGLE</span>
                      <span className="text-cyan-300 font-bold tabular-nums">
                        {Math.abs(
                          activeTrajectoryPrediction.lateralDeviationDeg
                        )}
                        ° OFF TURF
                      </span>
                    </div>
                  </div>

                  {/* CARD 03: CONTACT POINT & IMPACT HEIGHT */}
                  <div className="group relative bg-[#070A10] hover:bg-[#111827] border border-slate-800/80 hover:border-amber-500/40 rounded-lg p-3.5 flex flex-col justify-between gap-2 transition">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 group-hover:text-amber-300 transition">
                        03 · CONTACT POINT
                      </span>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-400/35">
                        {focusedContact.projection.zone.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <div>
                        <div className="text-[10px] text-slate-500 uppercase">
                          LATERAL OFFSET
                        </div>
                        <div className="text-xl font-bold text-amber-300 tabular-nums">
                          {Math.abs(
                            focusedContact.projection.offsetFromMiddleCm
                          )}
                          cm{' '}
                          {focusedContact.projection.offsetFromMiddleCm === 0
                            ? 'MID'
                            : focusedContact.projection.offsetFromMiddleCm < 0
                            ? 'OFF'
                            : 'LEG'}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-slate-500 uppercase">
                          CONTACT HT
                        </div>
                        <div className="text-base font-bold text-white tabular-nums">
                          {focusedContact.projection.contactHeightCm} cm
                        </div>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
                      <span>IMPACT IN-LINE</span>
                      <span className="text-amber-300 font-bold">
                        {activeDRSReview.impact.verdict}
                      </span>
                    </div>
                  </div>

                  {/* CARD 04: STUMP PROJECTION & DRS VERDICT */}
                  <div className="group relative bg-[#070A10] hover:bg-[#111827] border border-slate-800/80 hover:border-rose-500/40 rounded-lg p-3.5 flex flex-col justify-between gap-2 transition">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 group-hover:text-rose-300 transition">
                        04 · WICKET PROJECTION
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                          activeDRSReview.bigScreenVerdict === 'OUT'
                            ? 'bg-rose-500/20 text-rose-300 border-rose-400/40'
                            : activeDRSReview.finalDecision === "UMPIRE'S CALL"
                            ? 'bg-amber-500/20 text-amber-300 border-amber-400/40'
                            : 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40'
                        }`}
                      >
                        {activeDRSReview.finalDecision}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <div>
                        <div className="text-[10px] text-slate-500 uppercase">
                          WICKET OVERLAP
                        </div>
                        <div
                          className={`text-xl font-bold tabular-nums ${
                            activeTrajectoryPrediction.hittingWicket
                              ? 'text-rose-400'
                              : 'text-emerald-300'
                          }`}
                        >
                          {activeDRSReview.wickets.overlapPct}%
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-slate-500 uppercase">
                          STUMP HT
                        </div>
                        <div className="text-base font-bold text-white tabular-nums">
                          {activeTrajectoryPrediction.stumpIntersection3D.yCm} cm
                        </div>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
                      <span>WICKET CALL</span>
                      <span className="text-rose-300 font-bold">
                        {activeDRSReview.wickets.verdict}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

          {/* 1. DEDICATED CAMERA, LAYER & IMMERSIVE TOOLBAR */}
          <div
            className={
              isImmersiveMode
                ? 'w-full shrink-0 z-40 flex flex-wrap items-center justify-between gap-2.5 px-5 py-3 bg-[#0C111C] border-b border-slate-800/80'
                : 'w-full flex flex-wrap items-center justify-between gap-2.5 px-4 py-2.5 bg-[#070A10] border-b border-slate-800/80 transition-all duration-300'
            }
          >
            {/* Camera Angle Switcher */}
            <div className="flex flex-wrap items-center gap-1">
                {(Object.keys(CAMERA_PRESETS) as PitchCameraPresetId[]).map(
                  (id) => {
                    const isSelected = activePreset === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => applyPreset(id)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer whitespace-nowrap ${
                          isSelected
                            ? 'bg-cyan-400 text-slate-950 font-semibold shadow-sm'
                            : 'text-slate-300 hover:text-white hover:bg-white/[0.06]'
                        }`}
                      >
                        {CAMERA_PRESETS[id].shortLabel}
                      </button>
                    );
                  }
                )}

                {(activePreset === 'SIDE_PARALLEL_VIEW' ||
                  activePreset === 'DRONE_TOP_DOWN_VIEW') && (
                  <button
                    type="button"
                    onClick={() => {
                      const nextDir =
                        sideViewDirection === 'BOWLER_LEFT'
                          ? 'BOWLER_RIGHT'
                          : 'BOWLER_LEFT';
                      setSideViewDirection(nextDir);
                      applyPreset(activePreset, nextDir);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 cursor-pointer whitespace-nowrap"
                    title="Flip Bowler Left vs Right"
                  >
                    <FlipHorizontal className="w-3.5 h-3.5" />
                    <span>Flip</span>
                  </button>
                )}

                {activePreset === 'ORBIT_3D_VIEW' && (
                  <div className="flex items-center gap-1 pl-1 border-l border-white/10">
                    {[
                      {
                        label: 'Off 3D',
                        yaw: -38,
                        pitch: 23,
                        zCompress: 0.86,
                      },
                      {
                        label: 'Leg 3D',
                        yaw: 38,
                        pitch: 23,
                        zCompress: 0.86,
                      },
                      {
                        label: 'High Drone',
                        yaw: -24,
                        pitch: 48,
                        zCompress: 0.88,
                      },
                    ].map((sub) => (
                      <button
                        key={sub.label}
                        type="button"
                        onClick={() =>
                          animateCameraTo({
                            ...camRef.current,
                            yawDeg: sub.yaw,
                            pitchDeg: sub.pitch,
                            zCompress: sub.zCompress,
                            sideBlend: 0,
                            droneBlend: 0,
                          })
                        }
                        className={`px-2 py-1 rounded-md text-[11px] font-medium cursor-pointer transition whitespace-nowrap ${
                          Math.abs(cam.yawDeg - sub.yaw) < 4 &&
                          Math.abs(cam.pitchDeg - sub.pitch) < 4
                            ? 'bg-white/15 text-cyan-300 font-semibold'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {sub.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <span className="h-4 w-px bg-white/10 hidden sm:inline-block" />

              {/* Surface Layer Switcher (Clean Turf / Thermal Glow / Zone Grid / Both) */}
              <div className="flex items-center gap-1">
                {(
                  [
                    { id: 'OFF', label: 'Clean Turf' },
                    { id: 'THERMAL', label: 'Thermal' },
                    { id: 'GRID', label: 'Zone Grid' },
                    { id: 'BOTH', label: 'Both' },
                  ] as Array<{ id: PitchHeatmapMode; label: string }>
                ).map((hm) => (
                  <button
                    key={hm.id}
                    type="button"
                    onClick={() => setHeatmapMode(hm.id)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer whitespace-nowrap ${
                      heatmapMode === hm.id
                        ? 'bg-amber-400 text-slate-950 font-semibold shadow-sm'
                        : 'text-slate-300 hover:text-white hover:bg-white/[0.06]'
                    }`}
                  >
                    {hm.label}
                  </button>
                ))}

                {heatmapMode !== 'OFF' && (
                  <button
                    type="button"
                    onClick={() =>
                      setHeatmapScope((s) =>
                        s === 'ALL' ? 'SELECTED' : 'ALL'
                      )
                    }
                    className="px-2 py-1 rounded-lg text-[11px] font-mono text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/25 cursor-pointer whitespace-nowrap"
                    title="Toggle Heatmap Scope: All Stored vs Tracked"
                  >
                    {heatmapScope === 'ALL'
                      ? `All (${contacts.length})`
                      : `Tracked (${visibleContacts.length})`}
                  </button>
                )}
              </div>

              <span className="h-4 w-px bg-white/10 hidden md:inline-block" />

              {/* Compact Zoom, Reset & Immersive Mode Toggle Controls */}
              <div
                ref={zoomBarRef}
                className="flex items-center gap-1 text-xs font-mono overscroll-none"
              >
                <button
                  type="button"
                  onClick={() =>
                    animateCameraTo(
                      {
                        ...camRef.current,
                        zoom: Number(
                          clamp(camRef.current.zoom - 0.12, 0.35, 1.75).toFixed(
                            2
                          )
                        ),
                      },
                      220
                    )
                  }
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] cursor-pointer"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="text-[11px] text-cyan-300 tabular-nums w-10 text-center">
                  {Math.round(cam.zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() =>
                    animateCameraTo(
                      {
                        ...camRef.current,
                        zoom: Number(
                          clamp(camRef.current.zoom + 0.12, 0.35, 1.75).toFixed(
                            2
                          )
                        ),
                      },
                      220
                    )
                  }
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] cursor-pointer"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset(activePreset)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] cursor-pointer"
                  title="Reset Camera"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>

                <span className="h-4 w-px bg-white/10 mx-0.5" />

                <button
                  type="button"
                  onClick={() => {
                    setIsImmersiveMode((prev) => {
                      const next = !prev;
                      if (next) setIsHudCollapsed(false);
                      return next;
                    });
                  }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-sans font-semibold transition cursor-pointer whitespace-nowrap ${
                    isImmersiveMode
                      ? 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 shadow-sm'
                      : 'bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30'
                  }`}
                  title={
                    isImmersiveMode
                      ? 'Exit Fullscreen Immersive Mode (Esc)'
                      : 'Expand 3D Pitch to Fullscreen Immersive HUD Mode'
                  }
                >
                  {isImmersiveMode ? (
                    <>
                      <Minimize2 className="w-3.5 h-3.5 text-rose-300" />
                      <span>Exit Immersive (Esc)</span>
                    </>
                  ) : (
                    <>
                      <Maximize2 className="w-3.5 h-3.5 text-cyan-300" />
                      <span>Immersive Mode</span>
                    </>
                  )}
                </button>
              </div>
            </div>

          {/* FULL-CANVAS 22-YARD PITCH VIEWPORT */}
          <div
            ref={pitchViewportRef}
            className={`relative bg-[#04070D] select-none overscroll-none touch-none flex items-center justify-center ${
              isImmersiveMode
                ? 'flex-1 min-h-0 w-full h-full'
                : 'min-h-[540px] lg:min-h-[580px]'
            }`}
          >
            {/* FLOATING TOP-CENTER IMMERSIVE CAMERA SWITCHER & EXIT HUD PILL */}
            {isImmersiveMode && (
              <div className="absolute top-3.5 left-1/2 -translate-x-1/2 z-30 flex flex-wrap items-center justify-center gap-1.5 px-3 py-1.5 rounded-2xl bg-slate-950/90 backdrop-blur-2xl border border-cyan-400/35 shadow-[0_16px_40px_rgba(0,0,0,0.9)]">
                <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-300 font-bold px-1.5">
                  View:
                </span>
                {(Object.keys(CAMERA_PRESETS) as PitchCameraPresetId[]).map(
                  (id) => {
                    const isSelected = activePreset === id;
                    return (
                      <button
                        key={`imm-${id}`}
                        type="button"
                        onClick={() => applyPreset(id)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer whitespace-nowrap ${
                          isSelected
                            ? 'bg-cyan-400 text-slate-950 font-bold shadow-sm'
                            : 'text-slate-300 hover:text-white hover:bg-white/[0.08]'
                        }`}
                      >
                        {CAMERA_PRESETS[id].shortLabel}
                      </button>
                    );
                  }
                )}
                <span className="h-4 w-px bg-white/15 mx-1" />
                <button
                  type="button"
                  onClick={() => setIsImmersiveMode(false)}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-500 hover:bg-rose-400 text-white text-xs font-bold shadow-sm cursor-pointer whitespace-nowrap"
                  title="Exit Immersive Mode (Esc)"
                >
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span>Exit Immersive</span>
                </button>
              </div>
            )}

            {/* 2. FLOATING TOP-LEFT GLASSMORPHIC TELEMETRY HUD (Spin/Seam, Impact, Bounce, DRS & Calibrated Speed) */}
            {activeTrajectoryPrediction && focusedContact && activeDRSReview && (
              <div
                className="absolute top-3.5 left-3.5 z-20 max-w-xs sm:w-80"
              >
                <div className="bg-white/[0.04] hover:bg-white/[0.06] backdrop-blur-2xl border border-white/[0.12] hover:border-cyan-400/45 rounded-2xl px-4 py-3 shadow-[0_20px_50px_rgba(0,0,0,0.85)] hover:shadow-[0_0_28px_rgba(34,211,238,0.2)] transition-all duration-300">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs font-mono">
                      <span className="font-bold text-cyan-300">
                        Ball #{focusedContact.indexNumber}
                      </span>
                      <span aria-hidden="true" className="text-slate-600">
                        ·
                      </span>
                      {activeTrajectoryPrediction.hasCalibratedSpeed &&
                      activeTrajectoryPrediction.calibratedSpeedKph ? (
                        <span className="text-emerald-300 font-bold tabular-nums">
                          ⚡ {activeTrajectoryPrediction.calibratedSpeedKph} km/h
                        </span>
                      ) : (
                        <span className="text-white font-semibold tabular-nums">
                          {Math.abs(
                            activeTrajectoryPrediction.lateralDeviationDeg
                          )}
                          ° Seam
                        </span>
                      )}
                      <span aria-hidden="true" className="text-slate-600">
                        ·
                      </span>
                      <span
                        className={
                          activeDRSReview.bigScreenVerdict === 'OUT'
                            ? 'text-rose-400 font-bold'
                            : activeDRSReview.finalDecision === "UMPIRE'S CALL"
                            ? 'text-amber-300 font-bold'
                            : 'text-emerald-300 font-bold'
                        }
                      >
                        {activeDRSReview.finalDecision}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsHudCollapsed((p) => !p)}
                      className="p-1 rounded-lg text-slate-400 hover:text-white cursor-pointer"
                      title={
                        isHudCollapsed
                          ? 'Expand telemetry details'
                          : 'Minimize telemetry'
                      }
                    >
                      {isHudCollapsed ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronUp className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  {!isHudCollapsed && (
                    <div className="mt-2.5 pt-2.5 border-t border-white/[0.08] space-y-2 text-[11px] font-mono text-slate-300 tabular-nums">
                      {/* 2x2 Glassmorphic Telemetry Pill Grid with Hover Glow */}
                      <div className="grid grid-cols-2 gap-1.5">
                        <div className="bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-cyan-400/50 rounded-xl px-2.5 py-1.5 transition-all duration-200 hover:shadow-[0_0_16px_rgba(34,211,238,0.2)]">
                          <div className="text-[9px] text-slate-400 uppercase">
                            Spin / Seam Drift
                          </div>
                          <div className="text-xs font-bold text-cyan-300">
                            {Math.abs(
                              activeTrajectoryPrediction.lateralDeviationDeg
                            )}
                            ° (
                            {activeTrajectoryPrediction.lateralDriftCm > 0
                              ? '+'
                              : ''}
                            {activeTrajectoryPrediction.lateralDriftCm}cm)
                          </div>
                        </div>
                        <div className="bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-amber-400/50 rounded-xl px-2.5 py-1.5 transition-all duration-200 hover:shadow-[0_0_16px_rgba(245,158,11,0.2)]">
                          <div className="text-[9px] text-slate-400 uppercase">
                            Impact Coordinates
                          </div>
                          <div className="text-xs font-bold text-white">
                            {Math.abs(
                              focusedContact.projection.offsetFromMiddleCm
                            )}
                            cm{' '}
                            {focusedContact.projection.offsetFromMiddleCm === 0
                              ? 'Mid'
                              : focusedContact.projection.offsetFromMiddleCm < 0
                              ? 'Off'
                              : 'Leg'}{' '}
                            · {focusedContact.projection.contactHeightCm}cm
                          </div>
                        </div>
                        <div className="bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-emerald-400/50 rounded-xl px-2.5 py-1.5 transition-all duration-200 hover:shadow-[0_0_16px_rgba(16,185,129,0.2)]">
                          <div className="text-[9px] text-slate-400 uppercase">
                            Bounce Length
                          </div>
                          <div className="text-xs font-bold text-emerald-300">
                            {activeTrajectoryPrediction.bounceDistanceFromStumpsM}
                            m (
                            {
                              activeTrajectoryPrediction.lengthCategoryLabel.split(
                                ' '
                              )[0]
                            }
                            )
                          </div>
                        </div>
                        <div className="bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-rose-400/50 rounded-xl px-2.5 py-1.5 transition-all duration-200 hover:shadow-[0_0_16px_rgba(244,63,94,0.2)]">
                          <div className="text-[9px] text-slate-400 uppercase">
                            Stump Projection
                          </div>
                          <div
                            className={`text-xs font-bold ${
                              activeTrajectoryPrediction.hittingWicket
                                ? 'text-rose-300'
                                : 'text-sky-300'
                            }`}
                          >
                            {activeDRSReview.wickets.overlapPct}% ·{' '}
                            {activeTrajectoryPrediction.stumpIntersection3D.yCm}
                            cm
                          </div>
                        </div>
                      </div>

                      <div className="text-slate-300 flex items-center justify-between gap-2 pt-0.5">
                        <span className="truncate font-semibold text-cyan-200">
                          {activeTrajectoryPrediction.verdictLabel}
                        </span>
                        {onUpdateContactSpeed && (
                          <label className="inline-flex items-center gap-1 text-[10px] text-slate-400 shrink-0">
                            <span>Radar:</span>
                            <input
                              type="number"
                              min={40}
                              max={175}
                              step={0.5}
                              placeholder="km/h"
                              value={focusedContact.calibratedSpeedKph ?? ''}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                onUpdateContactSpeed(
                                  focusedContact.id,
                                  Number.isFinite(val) && val >= 40 && val <= 175
                                    ? Number(val.toFixed(1))
                                    : undefined
                                );
                              }}
                              className="w-14 bg-black/50 text-cyan-200 placeholder-slate-600 px-1.5 py-0.5 rounded-lg border border-white/10 focus:outline-none focus:border-cyan-400 text-[10px] font-mono"
                              title="Enter calibrated radar speed (km/h) or leave blank to hide uncalibrated speed"
                            />
                          </label>
                        )}
                      </div>

                      {/* Role-Specific Coaching Callout inside Floating Glassmorphic HUD */}
                      <div className="pt-1.5 border-t border-white/[0.07] flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-sans font-bold text-slate-400 uppercase tracking-wider">
                            {coachingRole === 'BATTER'
                              ? 'Batter Call'
                              : 'Bowler Target'}
                          </span>
                          <div className="inline-flex rounded-lg bg-white/[0.05] p-0.5 border border-white/[0.08]">
                            {(['BATTER', 'BOWLER'] as CoachingRole[]).map(
                              (role) => (
                                <button
                                  key={role}
                                  type="button"
                                  onClick={() => setCoachingRole(role)}
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-sans font-bold cursor-pointer transition ${
                                    coachingRole === role
                                      ? 'bg-cyan-400 text-slate-950'
                                      : 'text-slate-400 hover:text-white'
                                  }`}
                                >
                                  {role === 'BATTER' ? 'Batter' : 'Bowler'}
                                </button>
                              )
                            )}
                          </div>
                        </div>
                        {coachingRole === 'BATTER' ? (
                          <div className="text-[10px] text-slate-200 leading-snug">
                            <span
                              className={`font-bold ${
                                roleCoachingInsights.batter.activeCallColor ===
                                'RED'
                                  ? 'text-rose-400'
                                  : roleCoachingInsights.batter
                                      .activeCallColor === 'AMBER'
                                  ? 'text-amber-300'
                                  : 'text-emerald-300'
                              }`}
                            >
                              {roleCoachingInsights.batter.activeCall}:
                            </span>{' '}
                            {roleCoachingInsights.batter.footworkVerdict}
                          </div>
                        ) : (
                          <div className="text-[10px] text-slate-200 leading-snug">
                            <span
                              className={`font-bold ${
                                roleCoachingInsights.bowler.activeChannelHit
                                  ? 'text-emerald-300'
                                  : 'text-amber-300'
                              }`}
                            >
                              {roleCoachingInsights.bowler.activeChannelHit
                                ? 'TOP-OF-OFF HIT:'
                                : 'CHANNEL MISS:'}
                            </span>{' '}
                            {roleCoachingInsights.bowler.topOfOffDisciplinePct}%
                            spell accuracy · ±
                            {roleCoachingInsights.bowler.groupingDispersionCm}cm
                            spread
                          </div>
                        )}
                      </div>

                      {heatmapMode !== 'OFF' &&
                        pitchHeatmapData.hotspotCenter3D && (
                          <div className="text-amber-300 pt-0.5">
                            Heatmap Mean: {pitchHeatmapData.hotspotCenter3D.meters}m (
                            {heatmapSourceItems.length} balls)
                          </div>
                        )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 3. FLOATING TOP-RIGHT TOGGLEABLE 1:1 STUMP BEEHIVE CARD & SYNCED VIDEO PiP */}
            <div className="absolute top-3.5 right-3.5 z-20 flex flex-col items-end">
              {!showMiniStumpCard ? (
                <button
                  type="button"
                  onClick={() => setShowMiniStumpCard(true)}
                  className="bg-white/[0.04] hover:bg-white/[0.08] backdrop-blur-2xl border border-white/[0.12] hover:border-cyan-400/50 rounded-xl px-3 py-2 text-xs font-mono text-slate-200 shadow-2xl hover:shadow-[0_0_24px_rgba(34,211,238,0.2)] flex items-center gap-2 cursor-pointer transition-all duration-300"
                >
                  <Target className="w-3.5 h-3.5 text-cyan-400" />
                  <span>1:1 Stump Map</span>
                  <span className="text-slate-500">·</span>
                  <span className="text-rose-300 font-semibold tabular-nums">
                    {beehiveSummary.hittingWicketsPct}% Hit
                  </span>
                </button>
              ) : (
                <div className="bg-white/[0.04] hover:bg-white/[0.06] backdrop-blur-2xl border border-white/[0.12] hover:border-cyan-400/45 rounded-2xl p-3 shadow-2xl hover:shadow-[0_0_28px_rgba(34,211,238,0.2)] w-52 transition-all duration-300">
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-300 mb-1.5">
                    <span className="font-bold text-cyan-300">
                      1:1 STUMP BEEHIVE
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setShowBeehiveOverlay((p) => !p)}
                        className={`px-1.5 py-0.5 rounded text-[9px] font-semibold cursor-pointer border ${
                          showBeehiveOverlay
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            : 'bg-slate-900 text-slate-400 border-slate-700'
                        }`}
                      >
                        {showBeehiveOverlay ? 'Heat On' : 'Heat Off'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowMiniStumpCard(false)}
                        className="p-0.5 rounded text-slate-400 hover:text-white cursor-pointer"
                        title="Minimize 1:1 Stump Map"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <svg
                    viewBox="-34 -14 68 94"
                    className="w-full h-24 overflow-visible pointer-events-none"
                  >
                    {showBeehiveOverlay &&
                      beehiveSummary.cells.map((cell) => (
                        <rect
                          key={cell.id}
                          x={cell.xCm}
                          y={71.12 - cell.yCm - cell.heightCm}
                          width={cell.widthCm}
                          height={cell.heightCm}
                          rx="1.5"
                          fill={cell.fillRgba}
                        />
                      ))}
                    <line
                      x1="-30"
                      y1="71.12"
                      x2="30"
                      y2="71.12"
                      stroke="#64748B"
                      strokeWidth="1.5"
                    />
                    {[-11.43, 0, 11.43].map((x, i) => (
                      <line
                        key={i}
                        x1={x}
                        y1="0"
                        x2={x}
                        y2="71.12"
                        stroke="#F59E0B"
                        strokeWidth="3.2"
                        strokeLinecap="round"
                      />
                    ))}
                    <line
                      x1="-12"
                      y1="0"
                      x2="12"
                      y2="0"
                      stroke="#FDE68A"
                      strokeWidth="2.5"
                    />
                    {visibleContacts.map((c) => {
                      const pred = getPredictionForContact(c);
                      const anim = evaluateTrajectoryAnimationAtProgress(
                        pred,
                        getBallProgress(pred)
                      );
                      const cx = pred.impactPoint3D.xCm;
                      const cy = 71.12 - clamp(pred.impactPoint3D.yCm, 0, 82);
                      const sx = pred.stumpIntersection3D.xCm;
                      const sy =
                        71.12 - clamp(pred.stumpIntersection3D.yCm, 0, 82);
                      const liveX = anim.currentBall3D.xCm;
                      const liveY =
                        71.12 - clamp(anim.currentBall3D.yCm, 0, 86);
                      const isFocus =
                        visibleContacts.length === 1 ||
                        focusedContact?.id === c.id;
                      const zoneColors = getZoneColorConfig(c.projection.zone);
                      const hex = c.isOut ? '#F43F5E' : zoneColors.hex;
                      const stumpColor =
                        pred.hittingWicket || c.isOut ? '#F43F5E' : '#38BDF8';
                      return (
                        <g key={c.id} opacity={isFocus || c.isOut ? 1 : 0.55}>
                          {anim.hasImpacted && (
                            <line
                              x1={cx}
                              y1={cy}
                              x2={anim.hasReachedStumps ? sx : liveX}
                              y2={anim.hasReachedStumps ? sy : liveY}
                              stroke={stumpColor}
                              strokeWidth={isFocus || c.isOut ? '2.2' : '1.4'}
                              strokeDasharray="2.5 2"
                            />
                          )}
                          {anim.hasReachedStumps && (
                            <circle
                              cx={sx}
                              cy={sy}
                              r={isFocus || c.isOut ? '3.8' : '2.6'}
                              fill={stumpColor}
                              stroke="#FFFFFF"
                              strokeWidth="1"
                            />
                          )}
                          {anim.hasImpacted && (
                            <>
                              {c.isOut && (
                                <circle
                                  cx={cx}
                                  cy={cy}
                                  r="6"
                                  fill="none"
                                  stroke="#F43F5E"
                                  strokeWidth="1.5"
                                >
                                  <animate
                                    attributeName="r"
                                    values="4.5;11;4.5"
                                    dur="1.15s"
                                    repeatCount="indefinite"
                                  />
                                  <animate
                                    attributeName="opacity"
                                    values="0.95;0.1;0.95"
                                    dur="1.15s"
                                    repeatCount="indefinite"
                                  />
                                </circle>
                              )}
                              <circle
                                cx={cx}
                                cy={cy}
                                r={isFocus || c.isOut ? '4.8' : '3.4'}
                                fill={hex}
                                stroke={c.isOut ? '#FFE4E6' : '#FFFFFF'}
                                strokeWidth="1.2"
                              />
                            </>
                          )}
                          {!anim.hasReachedStumps && (
                            <circle
                              cx={liveX}
                              cy={liveY}
                              r={isFocus ? '3.8' : '2.8'}
                              fill="#EF4444"
                              stroke="#FEF08A"
                              strokeWidth="1.2"
                            />
                          )}
                        </g>
                      );
                    })}
                  </svg>
                </div>
              )}

              {/* 3B. TIME-SYNCED ORIGINAL VIDEO FRAME PREVIEW (PiP MONITOR) */}
              {activeWorkspaceTab === 'PITCH_3D' && (
                <div className="mt-2 flex flex-col items-end">
                  {!showSyncedVideoPiP ? (
                    <button
                      type="button"
                      onClick={() => setShowSyncedVideoPiP(true)}
                      className="bg-white/[0.04] hover:bg-white/[0.08] backdrop-blur-2xl border border-cyan-500/35 hover:border-cyan-400/60 rounded-xl px-3 py-1.5 text-[11px] font-mono text-cyan-200 shadow-2xl hover:shadow-[0_0_24px_rgba(34,211,238,0.25)] flex items-center gap-2 cursor-pointer transition-all duration-300"
                    >
                      <Tv className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Synced Video PiP</span>
                      <span className="text-slate-500">·</span>
                      <span className="text-emerald-300 tabular-nums font-bold">
                        {syncedVideoTimestampSec.toFixed(2)}s
                      </span>
                    </button>
                  ) : (
                    <div className="bg-white/[0.04] hover:bg-white/[0.06] backdrop-blur-2xl border border-cyan-500/35 hover:border-cyan-400/55 rounded-2xl p-2.5 shadow-2xl hover:shadow-[0_0_28px_rgba(34,211,238,0.22)] w-64 sm:w-72 flex flex-col gap-1.5 transition-all duration-300">
                      <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                        <div className="flex items-center gap-1.5">
                          <Tv className="w-3.5 h-3.5 text-cyan-400" />
                          <span className="font-bold text-white uppercase tracking-wider">
                            Synced Clip Monitor
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 font-bold tabular-nums">
                            {syncedVideoTimestampSec.toFixed(2)}s
                          </span>
                          <button
                            type="button"
                            onClick={() => setShowSyncedVideoPiP(false)}
                            className="p-0.5 rounded text-slate-400 hover:text-white cursor-pointer"
                            title="Minimize Synced Video Monitor"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-slate-950 border border-white/10">
                        {activeVideoUrl ? (
                          <video
                            ref={pipVideoRef}
                            src={activeVideoUrl}
                            muted
                            playsInline
                            preload="auto"
                            className="w-full h-full object-cover"
                          />
                        ) : (() => {
                          const frames =
                            pendingPreview?.aiShotAnalysis?.swingFrames ||
                            focusedContact?.aiShotAnalysis?.swingFrames;
                          const fallbackSnap =
                            pendingPreview?.snapshotUrl ||
                            focusedContact?.frameSnapshotUrl;
                          const pImpact =
                            activeTrajectoryPrediction?.impactProgress ?? 0.92;
                          const pBounce =
                            activeTrajectoryPrediction?.bounceProgress ?? 0.68;
                          let activeSnap = fallbackSnap;
                          if (frames && frames.length >= 5) {
                            if (animProgress < pBounce * 0.6) {
                              activeSnap = frames[0];
                            } else if (animProgress < pBounce) {
                              activeSnap = frames[1];
                            } else if (animProgress < pImpact * 0.96) {
                              activeSnap = frames[2];
                            } else if (animProgress <= pImpact + 0.03) {
                              activeSnap = frames[3];
                            } else {
                              activeSnap = frames[4];
                            }
                          }
                          return activeSnap ? (
                            <img
                              src={activeSnap}
                              alt="Time-synced delivery frame"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-center p-3 gap-1">
                              <span className="text-[11px] text-slate-300 font-semibold">
                                Load Video Clip in Video Calibration
                              </span>
                              <span className="text-[10px] text-slate-500">
                                Scrubbing the 3D Hawk-Eye slider seeks the real video frame
                              </span>
                            </div>
                          );
                        })()}

                        {/* Release -> Bounce -> Contact Overlay on PiP Monitor */}
                        {(() => {
                          const impPt =
                            pendingPreview?.videoPoint ||
                            focusedContact?.videoPoint;
                          if (!impPt) return null;
                          const refStumps = pendingPreview
                            ? activeStumps
                            : focusedContact?.stumpConfig || activeStumps;
                          const isUnseen =
                            (refStumps.releaseVisibilityMode ||
                              'UNSEEN_RELEASE') === 'UNSEEN_RELEASE';
                          const autoBnc = autoDetectBounceFromContactPoint(
                            impPt,
                            refStumps,
                            handedness,
                            pendingPreview?.timestampSec ||
                              focusedContact?.timestampSec ||
                              1.0,
                            focusedContact?.bounceLengthM
                          );
                          const bncPt =
                            pendingPreview?.bouncePoint ||
                            focusedContact?.bouncePoint ||
                            autoBnc.bouncePoint;
                          const relPt = isUnseen
                            ? null
                            : pendingPreview?.releasePoint ||
                              focusedContact?.releasePoint ||
                              autoBnc.releasePoint;
                          return (
                            <svg
                              viewBox="0 0 100 100"
                              preserveAspectRatio="none"
                              className="absolute inset-0 w-full h-full pointer-events-none"
                            >
                              {relPt && (
                                <line
                                  x1={relPt.x * 100}
                                  y1={relPt.y * 100}
                                  x2={bncPt.x * 100}
                                  y2={bncPt.y * 100}
                                  stroke="#A78BFA"
                                  strokeWidth="1"
                                  strokeDasharray="2 1.5"
                                />
                              )}
                              <line
                                x1={bncPt.x * 100}
                                y1={bncPt.y * 100}
                                x2={impPt.x * 100}
                                y2={impPt.y * 100}
                                stroke="#22D3EE"
                                strokeWidth="1.2"
                                strokeDasharray="2.5 2"
                              />
                              {relPt && (
                                <circle
                                  cx={relPt.x * 100}
                                  cy={relPt.y * 100}
                                  r="2.4"
                                  fill="#A78BFA"
                                  stroke="#FEF08A"
                                  strokeWidth="0.8"
                                />
                              )}
                              <ellipse
                                cx={bncPt.x * 100}
                                cy={bncPt.y * 100}
                                rx="3.5"
                                ry="1.8"
                                fill="rgba(16, 185, 129, 0.35)"
                                stroke="#10B981"
                                strokeWidth="0.9"
                              />
                              <circle
                                cx={impPt.x * 100}
                                cy={impPt.y * 100}
                                r="3"
                                fill="#22D3EE"
                                stroke="#FFFFFF"
                                strokeWidth="1"
                              />
                            </svg>
                          );
                        })()}

                        {/* Phase Status Pill */}
                        <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between gap-1 px-2 py-0.5 rounded bg-slate-950/85 border border-white/10 text-[9px] font-mono">
                          <span className="text-cyan-300 font-bold">
                            {animProgress <
                            (activeTrajectoryPrediction?.bounceProgress ?? 0.68)
                              ? 'PHASE 1: RELEASE → BOUNCE'
                              : animProgress <
                                (activeTrajectoryPrediction?.impactProgress ??
                                  0.92)
                              ? 'PHASE 2: BOUNCE → CONTACT'
                              : 'PHASE 3: IMPACT → STUMPS'}
                          </span>
                          <span className="font-bold text-emerald-300">
                            {(pendingPreview
                              ? activeStumps.releaseVisibilityMode
                              : focusedContact?.stumpConfig
                                  ?.releaseVisibilityMode ||
                                'UNSEEN_RELEASE') === 'UNSEEN_RELEASE'
                              ? '2-PT B → C'
                              : '3-PT R → B → C'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* SVG RENDERING: Unified Smoothly Interpolated 22-Yard Pitch Viewport */}
            <svg
              viewBox={`0 0 ${svgW} ${svgH}`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className={`w-full block touch-none ${
                isImmersiveMode
                  ? 'h-full max-h-screen object-contain'
                  : 'h-auto max-h-[650px]'
              } ${
                activePreset === 'SIDE_PARALLEL_VIEW'
                  ? 'cursor-default'
                  : activePreset === 'DRONE_TOP_DOWN_VIEW'
                  ? 'cursor-crosshair'
                  : 'cursor-grab active:cursor-grabbing'
              }`}
            >
              <defs>
                <radialGradient id="stadiumGlow" cx="50%" cy="45%" r="60%">
                  <stop offset="0%" stopColor="#0E2420" stopOpacity="0.88" />
                  <stop offset="60%" stopColor="#080F1B" stopOpacity="0.96" />
                  <stop offset="100%" stopColor="#05080E" stopOpacity="1" />
                </radialGradient>

                <linearGradient
                  id="pitchSurface3D"
                  x1="0%"
                  y1="0%"
                  x2="0%"
                  y2="100%"
                >
                  <stop offset="0%" stopColor="#5C4D3C" />
                  <stop offset="50%" stopColor="#72604B" />
                  <stop offset="100%" stopColor="#4F4132" />
                </linearGradient>

                <radialGradient id="thermalSpotRadial" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#FEF08A" stopOpacity="0.95" />
                  <stop offset="28%" stopColor="#F43F5E" stopOpacity="0.78" />
                  <stop offset="58%" stopColor="#F59E0B" stopOpacity="0.48" />
                  <stop offset="82%" stopColor="#10B981" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#06B6D4" stopOpacity="0" />
                </radialGradient>

                <filter
                  id="pitchThermalBlur"
                  x="-30%"
                  y="-30%"
                  width="160%"
                  height="160%"
                >
                  <feGaussianBlur stdDeviation="8" />
                </filter>
              </defs>

              <rect width={svgW} height={svgH} fill="url(#stadiumGlow)" />

              {showSideParallelHud ? (
                /* =====================================================================
                 * MODE A: TRUE SIDE-ON PARALLEL VIEW (SQUARE LEG / POINT — 100% PARALLEL)
                 * ===================================================================== */
                (() => {
                  const bowlerEnd = projectSideParallel(0, BOWLER_STUMPS_Z_CM);
                  const strikerEnd = projectSideParallel(0, 0);
                  const bowlerPop = projectSideParallel(
                    0,
                    BOWLER_POPPING_CREASE_Z_CM
                  );
                  const strikerPop = projectSideParallel(
                    0,
                    STRIKER_POPPING_CREASE_Z_CM
                  );
                  const bailLineLeft = projectSideParallel(
                    71.12,
                    BOWLER_STUMPS_Z_CM
                  );
                  const bailLineRight = projectSideParallel(71.12, 0);

                  const pitchLeftX = Math.min(bowlerEnd.x, strikerEnd.x);
                  const pitchRightX = Math.max(bowlerEnd.x, strikerEnd.x);
                  const groundY = strikerEnd.groundY;

                  const lengthZones = [
                    {
                      id: 'SHORT' as PitchLengthBandId,
                      label: 'SHORT / BOUNCER (10m+)',
                      z1: metersToWorldZ(10.0),
                      z2: BOWLER_STUMPS_Z_CM,
                      fill: 'rgba(168, 85, 247, 0.14)',
                      textColor: '#D8B4FE',
                    },
                    {
                      id: 'BACK_OF_LENGTH' as PitchLengthBandId,
                      label: 'BACK OF LENGTH (7.4m–10m)',
                      z1: metersToWorldZ(7.4),
                      z2: metersToWorldZ(10.0),
                      fill: 'rgba(244, 63, 94, 0.16)',
                      textColor: '#FDA4AF',
                    },
                    {
                      id: 'GOOD' as PitchLengthBandId,
                      label: 'GOOD LENGTH (4.8m–7.4m)',
                      z1: metersToWorldZ(4.8),
                      z2: metersToWorldZ(7.4),
                      fill: 'rgba(16, 185, 129, 0.20)',
                      textColor: '#6EE7B7',
                    },
                    {
                      id: 'FULL' as PitchLengthBandId,
                      label: 'FULL / HALF-VOLLEY (2.6m–4.8m)',
                      z1: metersToWorldZ(2.6),
                      z2: metersToWorldZ(4.8),
                      fill: 'rgba(56, 189, 248, 0.18)',
                      textColor: '#7DD3FC',
                    },
                    {
                      id: 'YORKER' as PitchLengthBandId,
                      label: 'YORKER (0m–2.6m)',
                      z1: metersToWorldZ(0),
                      z2: metersToWorldZ(2.6),
                      fill: 'rgba(245, 158, 11, 0.18)',
                      textColor: '#FDE68A',
                    },
                  ];

                  return (
                    <g>
                      {[25, 50, 71.12, 100, 136].map((hCm) => {
                        const p = projectSideParallel(hCm, 0);
                        const isBailHeight = Math.abs(hCm - 71.12) < 1;
                        return (
                          <g key={hCm}>
                            <line
                              x1={pitchLeftX - 30}
                              y1={p.y}
                              x2={pitchRightX + 30}
                              y2={p.y}
                              stroke={isBailHeight ? '#F59E0B' : '#1E293B'}
                              strokeWidth={isBailHeight ? '1.6' : '1'}
                              strokeDasharray={isBailHeight ? '6 4' : '3 5'}
                              opacity={isBailHeight ? '0.85' : '0.7'}
                            />
                            <text
                              x={pitchRightX + 36}
                              y={p.y + 4}
                              fill={isBailHeight ? '#FDE68A' : '#64748B'}
                              fontSize="10"
                              fontFamily="monospace"
                              fontWeight={isBailHeight ? 'bold' : 'normal'}
                            >
                              {isBailHeight ? '71.1cm (BAILS)' : `${hCm}cm`}
                            </text>
                          </g>
                        );
                      })}

                      <rect
                        x={pitchLeftX - 28}
                        y={groundY}
                        width={pitchRightX - pitchLeftX + 56}
                        height={34}
                        rx="6"
                        fill="url(#pitchSurface3D)"
                        stroke="#94A3B8"
                        strokeWidth="1.5"
                      />

                      {lengthZones.map((lz, idx) => {
                        const p1 = projectSideParallel(0, lz.z1);
                        const p2 = projectSideParallel(0, lz.z2);
                        const xLeft = Math.min(p1.x, p2.x);
                        const w = Math.abs(p2.x - p1.x);
                        const lenTotal = pitchZoneMatrix.lengthTotals.find(
                          (lt) => lt.lengthId === lz.id
                        );
                        return (
                          <g key={idx}>
                            <rect
                              x={xLeft}
                              y={groundY - 12}
                              width={w}
                              height={24}
                              fill={lz.fill}
                              stroke="rgba(255,255,255,0.14)"
                            />
                            <text
                              x={xLeft + w * 0.5}
                              y={groundY + 52}
                              textAnchor="middle"
                              fill={lz.textColor}
                              fontSize="9.5"
                              fontFamily="monospace"
                              fontWeight="bold"
                            >
                              {lz.label}
                            </text>
                            {heatmapMode !== 'OFF' && lenTotal && (
                              <text
                                x={xLeft + w * 0.5}
                                y={groundY - 18}
                                textAnchor="middle"
                                fill={lz.textColor}
                                fontSize="10"
                                fontFamily="monospace"
                                fontWeight="bold"
                              >
                                {lenTotal.percentage}% ({lenTotal.count})
                              </text>
                            )}
                          </g>
                        );
                      })}

                      {/* Side-On Longitudinal Thermal Density Ribbon when Heatmap is Active */}
                      {(heatmapMode === 'THERMAL' ||
                        heatmapMode === 'BOTH') && (
                        <g>
                          {pitchHeatmapData.sideSegments.map((seg, sIdx) => {
                            const p1 = projectSideParallel(0, seg.z1Cm);
                            const p2 = projectSideParallel(0, seg.z2Cm);
                            const xLeft = Math.min(p1.x, p2.x);
                            const w = Math.abs(p2.x - p1.x);
                            const barH = 8 + seg.intensity * 26;
                            return (
                              <rect
                                key={sIdx}
                                x={xLeft}
                                y={groundY - barH * 0.65}
                                width={w + 1}
                                height={barH}
                                rx="4"
                                fill={seg.fillRgba}
                                filter="url(#pitchThermalBlur)"
                              />
                            );
                          })}
                        </g>
                      )}

                      {[0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20].map((m) => {
                        const p = projectSideParallel(0, metersToWorldZ(m));
                        const yds = Math.round((m / PITCH_LENGTH_METERS) * 22);
                        return (
                          <g key={m}>
                            <line
                              x1={p.x}
                              y1={groundY}
                              x2={p.x}
                              y2={groundY + 12}
                              stroke="#E2E8F0"
                              strokeWidth="1.5"
                            />
                            <text
                              x={p.x}
                              y={groundY + 26}
                              textAnchor="middle"
                              fill="#CBD5E1"
                              fontSize="10"
                              fontFamily="monospace"
                              fontWeight="bold"
                            >
                              {m}m ({yds}yd)
                            </text>
                          </g>
                        );
                      })}

                      {[
                        { p: strikerPop, label: 'POPPING CREASE (1.22m)' },
                        { p: bowlerPop, label: 'BOWLER CREASE (18.90m)' },
                      ].map((cr, idx) => (
                        <g key={idx}>
                          <line
                            x1={cr.p.x}
                            y1={groundY - 18}
                            x2={cr.p.x}
                            y2={groundY + 8}
                            stroke="#F8FAFC"
                            strokeWidth="2.5"
                          />
                        </g>
                      ))}

                      {/* Bowler & Striker Stumps */}
                      <g>
                        <rect
                          x={bowlerEnd.x - 4}
                          y={bailLineLeft.y}
                          width="8"
                          height={groundY - bailLineLeft.y}
                          rx="2"
                          fill="#38BDF8"
                          stroke="#BAE6FD"
                          strokeWidth="1.5"
                        />
                        <rect
                          x={bowlerEnd.x - 6}
                          y={bailLineLeft.y - 4}
                          width="12"
                          height="4"
                          rx="1"
                          fill="#E0F2FE"
                        />
                        <text
                          x={bowlerEnd.x}
                          y={bailLineLeft.y - 12}
                          textAnchor="middle"
                          fill="#7DD3FC"
                          fontSize="10.5"
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          BOWLER STUMPS (20.12m)
                        </text>
                      </g>

                      <g>
                        <rect
                          x={strikerEnd.x - 4.5}
                          y={bailLineRight.y}
                          width="9"
                          height={groundY - bailLineRight.y}
                          rx="2"
                          fill="#F59E0B"
                          stroke="#FDE68A"
                          strokeWidth="1.5"
                        />
                        <rect
                          x={strikerEnd.x - 6.5}
                          y={bailLineRight.y - 4}
                          width="13"
                          height="4"
                          rx="1"
                          fill="#FEF08A"
                        />
                        <text
                          x={strikerEnd.x}
                          y={bailLineRight.y - 12}
                          textAnchor="middle"
                          fill="#FDE68A"
                          fontSize="10.5"
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          STRIKER STUMPS (0m)
                        </text>
                      </g>

                      {/* Side-On Ball Trajectories */}
                      {visibleContacts.map((c) => {
                        const isFocused =
                          visibleContacts.length === 1 ||
                          focusedContact?.id === c.id;
                        const pred = getPredictionForContact(c);
                        const anim = evaluateTrajectoryAnimationAtProgress(
                          pred,
                          getBallProgress(pred)
                        );
                        const zoneColors = getZoneColorConfig(c.projection.zone);
                        const hex = c.isOut ? '#F43F5E' : zoneColors.hex;

                        const releasePt = projectSideParallel(
                          pred.entryPoint3D.yCm,
                          pred.entryPoint3D.zCm
                        );
                        const bouncePt = projectSideParallel(
                          0,
                          pred.bouncePoint3D.zCm
                        );
                        const impactPt = projectSideParallel(
                          pred.impactPoint3D.yCm,
                          pred.impactPoint3D.zCm
                        );
                        const impactGroundPt = projectSideParallel(
                          0,
                          pred.impactPoint3D.zCm
                        );
                        const stumpPt = projectSideParallel(
                          pred.stumpIntersection3D.yCm,
                          0
                        );
                        const liveBallPt = projectSideParallel(
                          anim.currentBall3D.yCm,
                          anim.currentBall3D.zCm
                        );
                        const liveGroundPt = projectSideParallel(
                          0,
                          anim.currentBall3D.zCm
                        );

                        const prePathD = projectSidePathToSvgD(
                          anim.visiblePreBounceArc
                        );
                        const midPathD = projectSidePathToSvgD(
                          anim.visibleBounceToImpactArc
                        );
                        const postPathD = projectSidePathToSvgD(
                          anim.visibleImpactToStumpsArc
                        );
                        const fullTrailD = projectSidePathToSvgD(
                          anim.visibleBounceToStumpsTrail
                        );
                        const wakePathD = projectSidePathToSvgD(
                          anim.ballTrailWake3D
                        );

                        const sideCurtainPoints =
                          anim.visibleBounceToStumpsTrail.length > 1
                            ? toPolyPoints([
                                ...anim.visibleBounceToStumpsTrail.map((pt) =>
                                  projectSideParallel(pt.yCm, pt.zCm)
                                ),
                                projectSideParallel(
                                  0,
                                  anim.visibleBounceToStumpsTrail[
                                    anim.visibleBounceToStumpsTrail.length - 1
                                  ].zCm
                                ),
                                bouncePt,
                              ])
                            : '';

                        return (
                          <g
                            key={c.id}
                            opacity={isFocused || c.isOut ? 1 : 0.45}
                            onClick={() => handleTrackSingleBall(c.id)}
                            className="cursor-pointer"
                          >
                            {sideCurtainPoints && (
                              <polygon
                                points={sideCurtainPoints}
                                fill={hex}
                                opacity={isFocused || c.isOut ? '0.18' : '0.07'}
                              />
                            )}
                            <path
                              d={prePathD}
                              fill="none"
                              stroke={c.isOut ? '#F43F5E' : '#38BDF8'}
                              strokeWidth={isFocused || c.isOut ? '3.2' : '2'}
                              strokeDasharray="6 4"
                            />
                            {fullTrailD && (
                              <path
                                d={fullTrailD}
                                fill="none"
                                stroke={hex}
                                strokeWidth={isFocused || c.isOut ? '11' : '6'}
                                strokeLinecap="round"
                                opacity={isFocused || c.isOut ? '0.26' : '0.12'}
                              />
                            )}
                            {midPathD && (
                              <path
                                d={midPathD}
                                fill="none"
                                stroke={hex}
                                strokeWidth={isFocused || c.isOut ? '4.8' : '2.6'}
                                strokeLinecap="round"
                              />
                            )}
                            {postPathD && !isCatchOrEdgeDismissal(c) && (
                              <path
                                d={postPathD}
                                fill="none"
                                stroke={
                                  pred.hittingWicket || c.isOut ? '#F43F5E' : '#38BDF8'
                                }
                                strokeWidth={isFocused || c.isOut ? '4.2' : '2.2'}
                                strokeDasharray="5 3"
                              />
                            )}
                            {isCatchOrEdgeDismissal(c) && anim.hasImpacted && (
                              <path
                                d={`M ${impactPt.x} ${impactPt.y} Q ${impactPt.x + 28} ${impactPt.y - 34} ${impactPt.x + 62} ${impactPt.y - 18}`}
                                fill="none"
                                stroke="#F59E0B"
                                strokeWidth="3.2"
                                strokeDasharray="5 3"
                              />
                            )}
                            <circle
                              cx={releasePt.x}
                              cy={releasePt.y}
                              r={isFocused ? '6.5' : '4.5'}
                              fill={c.isOut ? '#F43F5E' : '#38BDF8'}
                              stroke="#FFFFFF"
                              strokeWidth="1.5"
                            />
                            {anim.hasBounced && (
                              <g>
                                <ellipse
                                  cx={bouncePt.x}
                                  cy={bouncePt.y}
                                  rx={isFocused ? '12' : '7.5'}
                                  ry={isFocused ? '4.8' : '3'}
                                  fill="rgba(16, 185, 129, 0.38)"
                                  stroke="#10B981"
                                  strokeWidth="2.2"
                                />
                                {isFocused && (
                                  <text
                                    x={bouncePt.x}
                                    y={bouncePt.y - 10}
                                    textAnchor="middle"
                                    fill="#6EE7B7"
                                    fontSize="10"
                                    fontFamily="monospace"
                                    fontWeight="bold"
                                  >
                                    #{c.indexNumber} BOUNCE (
                                    {pred.bounceDistanceFromStumpsM}m)
                                  </text>
                                )}
                              </g>
                            )}
                            {anim.hasImpacted && (
                              <g>
                                <line
                                  x1={impactPt.x}
                                  y1={impactPt.y}
                                  x2={impactGroundPt.x}
                                  y2={impactGroundPt.y}
                                  stroke={hex}
                                  strokeWidth={isFocused || c.isOut ? '1.8' : '1.2'}
                                  strokeDasharray="3 3"
                                />
                                {c.isOut && (
                                  <>
                                    <circle
                                      cx={impactPt.x}
                                      cy={impactPt.y}
                                      r="13"
                                      fill="none"
                                      stroke="#F43F5E"
                                      strokeWidth="2.4"
                                    >
                                      <animate
                                        attributeName="r"
                                        values="9;26;9"
                                        dur="1.2s"
                                        repeatCount="indefinite"
                                      />
                                      <animate
                                        attributeName="opacity"
                                        values="0.95;0.05;0.95"
                                        dur="1.2s"
                                        repeatCount="indefinite"
                                      />
                                    </circle>
                                    <g>
                                      <rect
                                        x={impactPt.x - 48}
                                        y={impactPt.y - 34}
                                        width="96"
                                        height="18"
                                        rx="5"
                                        fill="rgba(159, 18, 57, 0.96)"
                                        stroke="#FECDD3"
                                        strokeWidth="1.2"
                                      />
                                      <text
                                        x={impactPt.x}
                                        y={impactPt.y - 22}
                                        textAnchor="middle"
                                        fill="#FFFFFF"
                                        fontSize="9"
                                        fontFamily="monospace"
                                        fontWeight="bold"
                                      >
                                        WICKET #{c.indexNumber} · {c.dismissalType || 'OUT'}
                                      </text>
                                    </g>
                                  </>
                                )}
                                <circle
                                  cx={impactPt.x}
                                  cy={impactPt.y}
                                  r={isFocused || c.isOut ? '9.5' : '6.5'}
                                  fill={hex}
                                  stroke={c.isOut ? '#FFE4E6' : '#FFFFFF'}
                                  strokeWidth="2"
                                />
                                <text
                                  x={impactPt.x}
                                  y={impactPt.y + 3}
                                  textAnchor="middle"
                                  fill={c.isOut ? '#FFFFFF' : '#090D16'}
                                  fontSize="9"
                                  fontFamily="monospace"
                                  fontWeight="bold"
                                >
                                  {c.indexNumber}
                                </text>
                              </g>
                            )}
                            {anim.hasReachedStumps && !isCatchOrEdgeDismissal(c) && (
                              <circle
                                cx={stumpPt.x}
                                cy={stumpPt.y}
                                r={isFocused || c.isOut ? '7.5' : '5'}
                                fill={
                                  pred.hittingWicket || c.isOut ? '#F43F5E' : '#38BDF8'
                                }
                                stroke="#FFFFFF"
                                strokeWidth="2"
                              />
                            )}
                            {!anim.hasReachedStumps && (
                              <g>
                                {wakePathD && (
                                  <path
                                    d={wakePathD}
                                    fill="none"
                                    stroke="#FEF08A"
                                    strokeWidth={isFocused ? '6.5' : '4'}
                                    strokeLinecap="round"
                                    opacity="0.65"
                                  />
                                )}
                                <ellipse
                                  cx={liveGroundPt.x}
                                  cy={liveGroundPt.y}
                                  rx={isFocused ? '7' : '4.5'}
                                  ry="2.4"
                                  fill="rgba(2, 6, 23, 0.7)"
                                />
                                <circle
                                  cx={liveBallPt.x}
                                  cy={liveBallPt.y}
                                  r={isFocused ? '8.5' : '6'}
                                  fill="#DC2626"
                                  stroke="#FEF08A"
                                  strokeWidth="2"
                                />
                              </g>
                            )}
                          </g>
                        );
                      })}
                    </g>
                  );
                })()
              ) : showDroneTopDownHud ? (
                /* =====================================================================
                 * MODE B: 90° OVERHEAD DRONE TOP-DOWN PITCH MAP + LANDING HEATMAP
                 * ===================================================================== */
                (() => {
                  const bowlerEnd = projectDroneTopDown(0, BOWLER_STUMPS_Z_CM);
                  const strikerEnd = projectDroneTopDown(0, 0);
                  const topEdge = projectDroneTopDown(-68, 0);
                  const bottomEdge = projectDroneTopDown(68, 0);
                  const wicketTop = projectDroneTopDown(-11.43, 0);
                  const wicketBot = projectDroneTopDown(11.43, 0);

                  const pitchLeftX = Math.min(bowlerEnd.x, strikerEnd.x);
                  const pitchRightX = Math.max(bowlerEnd.x, strikerEnd.x);
                  const pitchTopY = topEdge.y;
                  const pitchBotY = bottomEdge.y;
                  const pitchHeight = pitchBotY - pitchTopY;

                  const strikerPop = projectDroneTopDown(
                    0,
                    STRIKER_POPPING_CREASE_Z_CM
                  );
                  const bowlerPop = projectDroneTopDown(
                    0,
                    BOWLER_POPPING_CREASE_Z_CM
                  );

                  const droneLengthZones = [
                    {
                      id: 'YORKER',
                      title: 'YORKER',
                      rangeLabel: '0.0m – 2.6m',
                      minM: 0,
                      maxM: 2.6,
                      z1: metersToWorldZ(0),
                      z2: metersToWorldZ(2.6),
                      fill: 'rgba(245, 158, 11, 0.16)',
                      border: '#F59E0B',
                      textColor: '#FDE68A',
                    },
                    {
                      id: 'FULL',
                      title: 'FULL / HALF-VOLLEY',
                      rangeLabel: '2.6m – 4.8m',
                      minM: 2.6,
                      maxM: 4.8,
                      z1: metersToWorldZ(2.6),
                      z2: metersToWorldZ(4.8),
                      fill: 'rgba(56, 189, 248, 0.16)',
                      border: '#38BDF8',
                      textColor: '#7DD3FC',
                    },
                    {
                      id: 'GOOD',
                      title: 'GOOD LENGTH',
                      rangeLabel: '4.8m – 7.4m',
                      minM: 4.8,
                      maxM: 7.4,
                      z1: metersToWorldZ(4.8),
                      z2: metersToWorldZ(7.4),
                      fill: 'rgba(16, 185, 129, 0.18)',
                      border: '#10B981',
                      textColor: '#6EE7B7',
                    },
                    {
                      id: 'BACK_OF_LENGTH',
                      title: 'BACK OF LENGTH',
                      rangeLabel: '7.4m – 10.0m',
                      minM: 7.4,
                      maxM: 10.0,
                      z1: metersToWorldZ(7.4),
                      z2: metersToWorldZ(10.0),
                      fill: 'rgba(244, 63, 94, 0.16)',
                      border: '#F43F5E',
                      textColor: '#FDA4AF',
                    },
                    {
                      id: 'SHORT',
                      title: 'SHORT / BOWLER HALF',
                      rangeLabel: '10.0m – 20.12m',
                      minM: 10.0,
                      maxM: PITCH_LENGTH_METERS + 0.1,
                      z1: metersToWorldZ(10.0),
                      z2: BOWLER_STUMPS_Z_CM,
                      fill: 'rgba(168, 85, 247, 0.12)',
                      border: '#A855F7',
                      textColor: '#D8B4FE',
                    },
                  ];

                  const visiblePredictions = visibleContacts.map((c) => ({
                    contact: c,
                    pred: getPredictionForContact(c),
                  }));

                  return (
                    <g>
                      <rect
                        x={pitchLeftX - 38}
                        y={pitchTopY - 24}
                        width={pitchRightX - pitchLeftX + 76}
                        height={pitchHeight + 48}
                        rx="14"
                        fill="rgba(12, 30, 25, 0.75)"
                        stroke="#1E293B"
                        strokeWidth="1.5"
                      />

                      <rect
                        x={pitchLeftX - 22}
                        y={pitchTopY}
                        width={pitchRightX - pitchLeftX + 44}
                        height={pitchHeight}
                        rx="6"
                        fill="url(#pitchSurface3D)"
                        stroke="#CBD5E1"
                        strokeWidth="2"
                      />

                      {droneLengthZones.map((zone) => {
                        const p1 = projectDroneTopDown(0, zone.z1);
                        const p2 = projectDroneTopDown(0, zone.z2);
                        const xLeft = Math.min(p1.x, p2.x);
                        const w = Math.abs(p2.x - p1.x);

                        return (
                          <g key={zone.id}>
                            <rect
                              x={xLeft}
                              y={pitchTopY}
                              width={w}
                              height={pitchHeight}
                              fill={zone.fill}
                              stroke="rgba(255,255,255,0.16)"
                            />
                            <text
                              x={xLeft + w * 0.5}
                              y={pitchTopY + 17}
                              textAnchor="middle"
                              fill={zone.textColor}
                              fontSize="10"
                              fontFamily="monospace"
                              fontWeight="bold"
                            >
                              {zone.title}
                            </text>
                            <text
                              x={xLeft + w * 0.5}
                              y={pitchTopY + 30}
                              textAnchor="middle"
                              fill="#E2E8F0"
                              fontSize="9"
                              fontFamily="monospace"
                              opacity="0.85"
                            >
                              {zone.rangeLabel}
                            </text>
                          </g>
                        );
                      })}

                      {/* === DRONE PITCH HEATMAP LAYER: ZONE GRID CELLS === */}
                      {(heatmapMode === 'GRID' || heatmapMode === 'BOTH') && (
                        <g>
                          {pitchZoneMatrix.cells.map((cell) => {
                            const p1 = projectDroneTopDown(
                              cell.x1Cm,
                              cell.z1Cm
                            );
                            const p2 = projectDroneTopDown(
                              cell.x2Cm,
                              cell.z2Cm
                            );
                            const rx = Math.min(p1.x, p2.x);
                            const ry = Math.min(p1.y, p2.y);
                            const rw = Math.abs(p2.x - p1.x);
                            const rh = Math.abs(p2.y - p1.y);
                            const isHighlighted =
                              highlightedZoneKey === cell.key;
                            const fill =
                              cell.count > 0
                                ? getThermalColorRgba(
                                    0.25 + cell.intensity * 0.75,
                                    heatmapMode === 'BOTH' ? 0.52 : 0.75
                                  )
                                : 'rgba(15, 23, 42, 0.18)';

                            return (
                              <g
                                key={cell.key}
                                data-ballmarker="true"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleFilterByZoneCell(
                                    cell.key,
                                    cell.ballIds
                                  );
                                }}
                                className="cursor-pointer"
                              >
                                <rect
                                  x={rx + 1}
                                  y={ry + 1}
                                  width={Math.max(2, rw - 2)}
                                  height={Math.max(2, rh - 2)}
                                  rx="4"
                                  fill={fill}
                                  stroke={
                                    isHighlighted
                                      ? '#22D3EE'
                                      : cell.count > 0
                                      ? 'rgba(254, 240, 138, 0.55)'
                                      : 'rgba(255, 255, 255, 0.12)'
                                  }
                                  strokeWidth={isHighlighted ? '2.4' : '1'}
                                />
                                {cell.count > 0 && (
                                  <text
                                    x={rx + rw * 0.5}
                                    y={ry + rh * 0.5 + 4}
                                    textAnchor="middle"
                                    fill="#FFFFFF"
                                    fontSize="10.5"
                                    fontFamily="monospace"
                                    fontWeight="bold"
                                  >
                                    {cell.percentage}% ({cell.count})
                                  </text>
                                )}
                              </g>
                            );
                          })}
                        </g>
                      )}

                      {/* === DRONE PITCH HEATMAP LAYER: GAUSSIAN THERMAL GLOW === */}
                      {(heatmapMode === 'THERMAL' ||
                        heatmapMode === 'BOTH') && (
                        <g className="pointer-events-none">
                          {/* KDE Thermal Tiles */}
                          {pitchHeatmapData.tiles.map((tile) => {
                            const p1 = projectDroneTopDown(
                              tile.x1Cm,
                              tile.z1Cm
                            );
                            const p2 = projectDroneTopDown(
                              tile.x2Cm,
                              tile.z2Cm
                            );
                            const rx = Math.min(p1.x, p2.x);
                            const ry = Math.min(p1.y, p2.y);
                            const rw = Math.abs(p2.x - p1.x);
                            const rh = Math.abs(p2.y - p1.y);
                            return (
                              <rect
                                key={tile.id}
                                x={rx}
                                y={ry}
                                width={rw + 1.5}
                                height={rh + 1.5}
                                rx="6"
                                fill={tile.fillRgba}
                                filter="url(#pitchThermalBlur)"
                              />
                            );
                          })}

                          {/* Radial Thermal Hotspots around each delivery bounce point */}
                          {heatmapSourceItems.map((item) => {
                            const bp = projectDroneTopDown(
                              item.pred.bouncePoint3D.xCm,
                              item.pred.bouncePoint3D.zCm
                            );
                            return (
                              <g key={`drone-heat-${item.id}`}>
                                <ellipse
                                  cx={bp.x}
                                  cy={bp.y}
                                  rx="44"
                                  ry="28"
                                  fill="url(#thermalSpotRadial)"
                                  opacity="0.72"
                                />
                                <ellipse
                                  cx={bp.x}
                                  cy={bp.y}
                                  rx="24"
                                  ry="15"
                                  fill="none"
                                  stroke="rgba(254, 240, 138, 0.55)"
                                  strokeWidth="1.1"
                                  strokeDasharray="3 2"
                                />
                              </g>
                            );
                          })}

                          {/* Mean Landing Centroid Marker */}
                          {pitchHeatmapData.hotspotCenter3D && (
                            <g>
                              {(() => {
                                const cp = projectDroneTopDown(
                                  pitchHeatmapData.hotspotCenter3D.xCm,
                                  pitchHeatmapData.hotspotCenter3D.zCm
                                );
                                return (
                                  <>
                                    <circle
                                      cx={cp.x}
                                      cy={cp.y}
                                      r="16"
                                      fill="none"
                                      stroke="#FEF08A"
                                      strokeWidth="1.6"
                                      strokeDasharray="3 3"
                                    />
                                    <line
                                      x1={cp.x - 20}
                                      y1={cp.y}
                                      x2={cp.x + 20}
                                      y2={cp.y}
                                      stroke="#FEF08A"
                                      strokeWidth="1.2"
                                    />
                                    <line
                                      x1={cp.x}
                                      y1={cp.y - 20}
                                      x2={cp.x}
                                      y2={cp.y + 20}
                                      stroke="#FEF08A"
                                      strokeWidth="1.2"
                                    />
                                  </>
                                );
                              })()}
                            </g>
                          )}
                        </g>
                      )}

                      {/* Stump-to-Stump Wicket Corridor */}
                      <rect
                        x={pitchLeftX}
                        y={wicketTop.y}
                        width={pitchRightX - pitchLeftX}
                        height={wicketBot.y - wicketTop.y}
                        fill="rgba(245, 158, 11, 0.16)"
                        stroke="#FBBF24"
                        strokeWidth="1.3"
                      />

                      {Array.from({ length: 21 }, (_, m) => m).map((m) => {
                        const p = projectDroneTopDown(0, metersToWorldZ(m));
                        const isEven = m % 2 === 0;
                        const yds = Math.round((m / PITCH_LENGTH_METERS) * 22);
                        return (
                          <g key={m}>
                            <line
                              x1={p.x}
                              y1={pitchTopY}
                              x2={p.x}
                              y2={pitchBotY}
                              stroke="rgba(255, 255, 255, 0.12)"
                              strokeWidth={isEven ? '1.1' : '0.5'}
                            />
                            {isEven && (
                              <text
                                x={p.x}
                                y={pitchBotY + 22}
                                textAnchor="middle"
                                fill="#E2E8F0"
                                fontSize="9.5"
                                fontFamily="monospace"
                                fontWeight="bold"
                              >
                                {m}m ({yds}yd)
                              </text>
                            )}
                          </g>
                        );
                      })}

                      {[strikerPop, bowlerPop].map((cr, idx) => (
                        <line
                          key={idx}
                          x1={cr.x}
                          y1={pitchTopY}
                          x2={cr.x}
                          y2={pitchBotY}
                          stroke="#FFFFFF"
                          strokeWidth="2.4"
                        />
                      ))}

                      {[
                        {
                          x: bowlerEnd.x,
                          label: 'BOWLER STUMPS (20.12m)',
                          color: '#38BDF8',
                          stumps: bowlerStumps3D,
                        },
                        {
                          x: strikerEnd.x,
                          label: 'STRIKER STUMPS (0.00m)',
                          color: '#F59E0B',
                          stumps: strikerStumps3D,
                        },
                      ].map((end, idx) => (
                        <g key={idx}>
                          <line
                            x1={end.x}
                            y1={wicketTop.y}
                            x2={end.x}
                            y2={wicketBot.y}
                            stroke={end.color}
                            strokeWidth="5"
                            strokeLinecap="round"
                          />
                          {end.stumps.map((st, sIdx) => {
                            const sp = projectDroneTopDown(st.xCm, 0);
                            return (
                              <circle
                                key={sIdx}
                                cx={end.x}
                                cy={sp.y}
                                r="4.2"
                                fill={end.color}
                                stroke="#FFFFFF"
                                strokeWidth="1.5"
                              />
                            );
                          })}
                          <text
                            x={end.x}
                            y={pitchTopY - 10}
                            textAnchor="middle"
                            fill={end.color}
                            fontSize="10"
                            fontFamily="monospace"
                            fontWeight="bold"
                          >
                            {end.label}
                          </text>
                        </g>
                      ))}

                      {/* Overhead Ball Trajectories in Drone View */}
                      {visiblePredictions.map(({ contact: c, pred }) => {
                        const isFocused =
                          visiblePredictions.length === 1 ||
                          focusedContact?.id === c.id;
                        const anim = evaluateTrajectoryAnimationAtProgress(
                          pred,
                          getBallProgress(pred)
                        );
                        const zoneColors = getZoneColorConfig(c.projection.zone);
                        const hex = c.isOut ? '#F43F5E' : zoneColors.hex;

                        const releasePt = projectDroneTopDown(
                          pred.entryPoint3D.xCm,
                          pred.entryPoint3D.zCm
                        );
                        const bouncePt = projectDroneTopDown(
                          pred.bouncePoint3D.xCm,
                          pred.bouncePoint3D.zCm
                        );
                        const impactPt = projectDroneTopDown(
                          pred.impactPoint3D.xCm,
                          pred.impactPoint3D.zCm
                        );
                        const stumpPt = projectDroneTopDown(
                          pred.stumpIntersection3D.xCm,
                          0
                        );
                        const liveBallPt = projectDroneTopDown(
                          anim.currentBall3D.xCm,
                          anim.currentBall3D.zCm
                        );

                        const preD = projectDronePathToSvgD(
                          anim.visiblePreBounceArc
                        );
                        const midD = projectDronePathToSvgD(
                          anim.visibleBounceToImpactArc
                        );
                        const postD = projectDronePathToSvgD(
                          anim.visibleImpactToStumpsArc
                        );
                        const fullTrailDroneD = projectDronePathToSvgD(
                          anim.visibleBounceToStumpsTrail
                        );

                        return (
                          <g
                            key={c.id}
                            data-ballmarker="true"
                            opacity={isFocused || c.isOut ? 1 : 0.65}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTrackSingleBall(c.id);
                            }}
                            className="cursor-pointer"
                          >
                            <path
                              d={preD}
                              fill="none"
                              stroke={c.isOut ? '#F43F5E' : '#38BDF8'}
                              strokeWidth={isFocused || c.isOut ? '2.8' : '1.6'}
                              strokeDasharray="6 4"
                            />
                            {fullTrailDroneD && (
                              <path
                                d={fullTrailDroneD}
                                fill="none"
                                stroke={hex}
                                strokeWidth={isFocused || c.isOut ? '9' : '5'}
                                strokeLinecap="round"
                                opacity={isFocused || c.isOut ? '0.28' : '0.14'}
                              />
                            )}
                            {midD && (
                              <path
                                d={midD}
                                fill="none"
                                stroke={hex}
                                strokeWidth={isFocused || c.isOut ? '4.2' : '2.2'}
                              />
                            )}
                            {postD && (
                              <path
                                d={postD}
                                fill="none"
                                stroke={
                                  pred.hittingWicket || c.isOut ? '#F43F5E' : '#38BDF8'
                                }
                                strokeWidth={isFocused || c.isOut ? '3.8' : '2'}
                                strokeDasharray="5 3"
                              />
                            )}
                            <circle
                              cx={releasePt.x}
                              cy={releasePt.y}
                              r={isFocused ? '5' : '3.8'}
                              fill={c.isOut ? '#F43F5E' : '#38BDF8'}
                              stroke="#FFFFFF"
                              strokeWidth="1.3"
                            />
                            {anim.hasBounced && (
                              <g>
                                <circle
                                  cx={bouncePt.x}
                                  cy={bouncePt.y}
                                  r={isFocused ? '9.5' : '6.5'}
                                  fill="#10B981"
                                  stroke="#FFFFFF"
                                  strokeWidth="2"
                                />
                                <text
                                  x={bouncePt.x}
                                  y={bouncePt.y + 3.2}
                                  textAnchor="middle"
                                  fill="#052E16"
                                  fontSize="9"
                                  fontFamily="monospace"
                                  fontWeight="bold"
                                >
                                  {c.indexNumber}
                                </text>
                              </g>
                            )}
                            {anim.hasImpacted && (
                              <>
                                {c.isOut && (
                                  <circle
                                    cx={impactPt.x}
                                    cy={impactPt.y}
                                    r="12"
                                    fill="none"
                                    stroke="#F43F5E"
                                    strokeWidth="2.2"
                                  >
                                    <animate
                                      attributeName="r"
                                      values="8;22;8"
                                      dur="1.15s"
                                      repeatCount="indefinite"
                                    />
                                    <animate
                                      attributeName="opacity"
                                      values="0.95;0.1;0.95"
                                      dur="1.15s"
                                      repeatCount="indefinite"
                                    />
                                  </circle>
                                )}
                                <circle
                                  cx={impactPt.x}
                                  cy={impactPt.y}
                                  r={isFocused || c.isOut ? '7.5' : '5'}
                                  fill={hex}
                                  stroke={c.isOut ? '#FFE4E6' : '#FFFFFF'}
                                  strokeWidth="1.8"
                                />
                              </>
                            )}
                            {anim.hasReachedStumps && (
                              <circle
                                cx={stumpPt.x}
                                cy={stumpPt.y}
                                r={isFocused || c.isOut ? '6.5' : '4.5'}
                                fill={
                                  pred.hittingWicket || c.isOut ? '#F43F5E' : '#38BDF8'
                                }
                                stroke="#FFFFFF"
                                strokeWidth="1.5"
                              />
                            )}
                            {!anim.hasReachedStumps && (
                              <circle
                                cx={liveBallPt.x}
                                cy={liveBallPt.y}
                                r={isFocused ? '8' : '5.5'}
                                fill="#DC2626"
                                stroke="#FEF08A"
                                strokeWidth="2"
                              />
                            )}
                          </g>
                        );
                      })}
                    </g>
                  );
                })()
              ) : (
                /* =====================================================================
                 * MODE C: 100% RIGID EUCLIDEAN 3D 22-YARD PITCH + 3D HEATMAP LAYER
                 * ===================================================================== */
                (() => {
                  const stripZNear = -26;
                  const stripZFar = BOWLER_STUMPS_Z_CM + 26;

                  const turfCorners = [
                    project3D(-pitchHalfW, 0, stripZNear),
                    project3D(pitchHalfW, 0, stripZNear),
                    project3D(pitchHalfW, 0, stripZFar),
                    project3D(-pitchHalfW, 0, stripZFar),
                  ];

                  const wicketCorridor = [
                    project3D(-11.43, 0, 0),
                    project3D(11.43, 0, 0),
                    project3D(11.43, 0, BOWLER_STUMPS_Z_CM),
                    project3D(-11.43, 0, BOWLER_STUMPS_Z_CM),
                  ];

                  const bands3D = [
                    {
                      name: 'SHORT / BOWLER HALF',
                      z1: metersToWorldZ(10.0),
                      z2: BOWLER_STUMPS_Z_CM,
                      fill: 'rgba(168, 85, 247, 0.10)',
                      color: '#D8B4FE',
                    },
                    {
                      name: 'BACK OF LENGTH (7.4m–10.0m)',
                      z1: metersToWorldZ(7.4),
                      z2: metersToWorldZ(10.0),
                      fill: 'rgba(244, 63, 94, 0.14)',
                      color: '#FDA4AF',
                    },
                    {
                      name: 'GOOD LENGTH (4.8m–7.4m)',
                      z1: metersToWorldZ(4.8),
                      z2: metersToWorldZ(7.4),
                      fill: 'rgba(16, 185, 129, 0.18)',
                      color: '#6EE7B7',
                    },
                    {
                      name: 'FULL (2.6m–4.8m)',
                      z1: metersToWorldZ(2.6),
                      z2: metersToWorldZ(4.8),
                      fill: 'rgba(56, 189, 248, 0.16)',
                      color: '#7DD3FC',
                    },
                    {
                      name: 'YORKER (0m–2.6m)',
                      z1: metersToWorldZ(0),
                      z2: metersToWorldZ(2.6),
                      fill: 'rgba(245, 158, 11, 0.15)',
                      color: '#FDE68A',
                    },
                  ];

                  const farStumpsNode = isLookingFromWicketkeeperEnd
                    ? renderStumpSet3D(BOWLER_STUMPS_Z_CM, false, bowlerStumps3D)
                    : renderStumpSet3D(0, true, strikerStumps3D);

                  const nearStumpsNode = isLookingFromWicketkeeperEnd
                    ? renderStumpSet3D(0, true, strikerStumps3D)
                    : renderStumpSet3D(
                        BOWLER_STUMPS_Z_CM,
                        false,
                        bowlerStumps3D
                      );

                  return (
                    <g>
                      {/* 1. 3D Pitch Turf Surface */}
                      <polygon
                        points={toPolyPoints(turfCorners)}
                        fill="url(#pitchSurface3D)"
                        stroke="#94A3B8"
                        strokeWidth="1.8"
                      />

                      {/* 2. Base Length Zone Bands */}
                      {bands3D.map((b, i) => {
                        const poly = [
                          project3D(-pitchHalfW, 0, b.z1),
                          project3D(pitchHalfW, 0, b.z1),
                          project3D(pitchHalfW, 0, b.z2),
                          project3D(-pitchHalfW, 0, b.z2),
                        ];
                        const labelPos = project3D(
                          pitchHalfW + 24,
                          0,
                          (b.z1 + b.z2) * 0.5
                        );
                        return (
                          <g key={i}>
                            <polygon points={toPolyPoints(poly)} fill={b.fill} />
                            <text
                              x={labelPos.x}
                              y={labelPos.y + 3}
                              textAnchor="middle"
                              fill={b.color}
                              fontSize="9"
                              fontFamily="monospace"
                              fontWeight="bold"
                            >
                              {b.name}
                            </text>
                          </g>
                        );
                      })}

                      {/* === 2A. 3D PITCH LANDING HEATMAP: 5x3 ZONE GRID POLYGONS ON TURF === */}
                      {(heatmapMode === 'GRID' || heatmapMode === 'BOTH') && (
                        <g>
                          {pitchZoneMatrix.cells.map((cell) => {
                            const cellPoly = [
                              project3D(cell.x1Cm, 0.2, cell.z1Cm),
                              project3D(cell.x2Cm, 0.2, cell.z1Cm),
                              project3D(cell.x2Cm, 0.2, cell.z2Cm),
                              project3D(cell.x1Cm, 0.2, cell.z2Cm),
                            ];
                            const center3D = project3D(
                              (cell.x1Cm + cell.x2Cm) * 0.5,
                              0.5,
                              (cell.z1Cm + cell.z2Cm) * 0.5
                            );
                            const isHighlighted =
                              highlightedZoneKey === cell.key;
                            const fill =
                              cell.count > 0
                                ? getThermalColorRgba(
                                    0.25 + cell.intensity * 0.75,
                                    heatmapMode === 'BOTH' ? 0.55 : 0.78
                                  )
                                : 'rgba(15, 23, 42, 0.16)';

                            return (
                              <g
                                key={`3d-grid-${cell.key}`}
                                data-ballmarker="true"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleFilterByZoneCell(
                                    cell.key,
                                    cell.ballIds
                                  );
                                }}
                                className="cursor-pointer"
                              >
                                <polygon
                                  points={toPolyPoints(cellPoly)}
                                  fill={fill}
                                  stroke={
                                    isHighlighted
                                      ? '#22D3EE'
                                      : cell.count > 0
                                      ? 'rgba(254, 240, 138, 0.65)'
                                      : 'rgba(255, 255, 255, 0.14)'
                                  }
                                  strokeWidth={isHighlighted ? '2.2' : '0.9'}
                                />
                                {cell.count > 0 && (
                                  <text
                                    x={center3D.x}
                                    y={center3D.y + 3}
                                    textAnchor="middle"
                                    fill="#FFFFFF"
                                    fontSize="9.5"
                                    fontFamily="monospace"
                                    fontWeight="bold"
                                  >
                                    {cell.percentage}% ({cell.count})
                                  </text>
                                )}
                              </g>
                            );
                          })}
                        </g>
                      )}

                      {/* === 2B. 3D PITCH LANDING HEATMAP: GAUSSIAN KDE THERMAL GLOW ON TURF === */}
                      {(heatmapMode === 'THERMAL' ||
                        heatmapMode === 'BOTH') && (
                        <g className="pointer-events-none">
                          {/* Perspective-Projected 3D KDE Thermal Turf Tiles */}
                          {pitchHeatmapData.tiles.map((tile) => {
                            const tilePoly = [
                              project3D(tile.x1Cm, 0.3, tile.z1Cm),
                              project3D(tile.x2Cm, 0.3, tile.z1Cm),
                              project3D(tile.x2Cm, 0.3, tile.z2Cm),
                              project3D(tile.x1Cm, 0.3, tile.z2Cm),
                            ];
                            return (
                              <polygon
                                key={`3d-kde-${tile.id}`}
                                points={toPolyPoints(tilePoly)}
                                fill={tile.fillRgba}
                                stroke={tile.strokeRgba}
                                strokeWidth="0.4"
                              />
                            );
                          })}

                          {/* Perspective-Correct Multi-Ring Radial Thermal Contours at each Landing Point */}
                          {heatmapSourceItems.map((item) => {
                            const bx = item.pred.bouncePoint3D.xCm;
                            const bz = item.pred.bouncePoint3D.zCm;
                            const bp = project3D(bx, 0.45, bz);
                            const rxOuter = Math.max(14, bp.scale * 11.5);
                            const ryOuter = Math.max(6.5, bp.scale * 4.8);
                            return (
                              <g key={`3d-spot-${item.id}`}>
                                <ellipse
                                  cx={bp.x}
                                  cy={bp.y}
                                  rx={rxOuter}
                                  ry={ryOuter}
                                  fill="url(#thermalSpotRadial)"
                                  opacity="0.82"
                                />
                                <ellipse
                                  cx={bp.x}
                                  cy={bp.y}
                                  rx={rxOuter * 0.58}
                                  ry={ryOuter * 0.58}
                                  fill="none"
                                  stroke="rgba(254, 240, 138, 0.65)"
                                  strokeWidth="1.1"
                                  strokeDasharray="3 2"
                                />
                              </g>
                            );
                          })}

                          {/* 3D Mean Landing Cluster Centroid Target */}
                          {pitchHeatmapData.hotspotCenter3D &&
                            (() => {
                              const hc = pitchHeatmapData.hotspotCenter3D;
                              const cp = project3D(hc.xCm, 0.6, hc.zCm);
                              return (
                                <g>
                                  <ellipse
                                    cx={cp.x}
                                    cy={cp.y}
                                    rx={Math.max(11, cp.scale * 6.5)}
                                    ry={Math.max(5, cp.scale * 2.8)}
                                    fill="none"
                                    stroke="#FEF08A"
                                    strokeWidth="1.6"
                                    strokeDasharray="3 3"
                                  />
                                  <circle
                                    cx={cp.x}
                                    cy={cp.y}
                                    r="3"
                                    fill="#FEF08A"
                                  />
                                </g>
                              );
                            })()}
                        </g>
                      )}

                      {/* 2-Meter Distance Markers */}
                      {[2, 4, 6, 8, 10, 12, 14, 16, 18].map((m) => {
                        const zVal = metersToWorldZ(m);
                        const edgeIn = project3D(-pitchHalfW, 0, zVal);
                        const edgeOut = project3D(-pitchHalfW - 6, 0, zVal);
                        const labelPt = project3D(-pitchHalfW - 18, 0, zVal);
                        const isMidPitch = m === 10;
                        const rightEdge = project3D(pitchHalfW, 0, zVal);
                        return (
                          <g key={m}>
                            <line
                              x1={edgeIn.x}
                              y1={edgeIn.y}
                              x2={rightEdge.x}
                              y2={rightEdge.y}
                              stroke={
                                isMidPitch
                                  ? 'rgba(251, 191, 36, 0.35)'
                                  : 'rgba(255, 255, 255, 0.12)'
                              }
                              strokeWidth={isMidPitch ? '1.3' : '0.8'}
                              strokeDasharray={isMidPitch ? '5 4' : '2 4'}
                            />
                            <line
                              x1={edgeIn.x}
                              y1={edgeIn.y}
                              x2={edgeOut.x}
                              y2={edgeOut.y}
                              stroke="#CBD5E1"
                              strokeWidth="1.4"
                            />
                            <text
                              x={labelPt.x}
                              y={labelPt.y + 3}
                              textAnchor="middle"
                              fill={isMidPitch ? '#FDE68A' : '#94A3B8'}
                              fontSize="8.5"
                              fontFamily="monospace"
                              fontWeight="bold"
                            >
                              {isMidPitch ? '10m (11yd)' : `${m}m`}
                            </text>
                          </g>
                        );
                      })}

                      {/* 3. Stump-to-Stump Wicket Corridor */}
                      <polygon
                        points={toPolyPoints(wicketCorridor)}
                        fill="rgba(245, 158, 11, 0.14)"
                        stroke="rgba(251, 191, 36, 0.45)"
                        strokeWidth="1"
                      />

                      {/* 4. Regulation Crease Lines */}
                      {[
                        {
                          x1: -pitchHalfW,
                          z1: 0,
                          x2: pitchHalfW,
                          z2: 0,
                          w: 2.2,
                        },
                        {
                          x1: -pitchHalfW,
                          z1: STRIKER_POPPING_CREASE_Z_CM,
                          x2: pitchHalfW,
                          z2: STRIKER_POPPING_CREASE_Z_CM,
                          w: 2.2,
                        },
                        {
                          x1: -pitchHalfW,
                          z1: BOWLER_STUMPS_Z_CM,
                          x2: pitchHalfW,
                          z2: BOWLER_STUMPS_Z_CM,
                          w: 2.2,
                        },
                        {
                          x1: -pitchHalfW,
                          z1: BOWLER_POPPING_CREASE_Z_CM,
                          x2: pitchHalfW,
                          z2: BOWLER_POPPING_CREASE_Z_CM,
                          w: 2.2,
                        },
                      ].map((ln, idx) => {
                        const p1 = project3D(ln.x1, 0, ln.z1);
                        const p2 = project3D(ln.x2, 0, ln.z2);
                        return (
                          <line
                            key={idx}
                            x1={p1.x}
                            y1={p1.y}
                            x2={p2.x}
                            y2={p2.y}
                            stroke="#F8FAFC"
                            strokeWidth={ln.w}
                            opacity="0.9"
                          />
                        );
                      })}

                      {(() => {
                        const leftPos = project3D(-pitchHalfW - 34, 0, 200);
                        const rightPos = project3D(pitchHalfW + 34, 0, 200);
                        return (
                          <>
                            <text
                              x={leftPos.x}
                              y={leftPos.y}
                              textAnchor="middle"
                              fill="#94A3B8"
                              fontSize="11"
                              fontFamily="monospace"
                              fontWeight="bold"
                            >
                              {leftSideLabel}
                            </text>
                            <text
                              x={rightPos.x}
                              y={rightPos.y}
                              textAnchor="middle"
                              fill="#94A3B8"
                              fontSize="11"
                              fontFamily="monospace"
                              fontWeight="bold"
                            >
                              {rightSideLabel}
                            </text>
                          </>
                        );
                      })()}

                      {farStumpsNode}

                      {/* 6. 3D Ball Trajectories & Progressive Hawk-Eye Animation */}
                      {visibleContacts.map((c) => {
                        const isFocused =
                          visibleContacts.length === 1 ||
                          focusedContact?.id === c.id;
                        const pred = getPredictionForContact(c);
                        const anim = evaluateTrajectoryAnimationAtProgress(
                          pred,
                          getBallProgress(pred)
                        );
                        const zoneColors = getZoneColorConfig(c.projection.zone);
                        const hex = c.isOut ? '#F43F5E' : zoneColors.hex;

                        const groundTrackD = project3DPathToSvgD(
                          anim.visibleGroundTrackPoints
                        );
                        const preBounceD = project3DPathToSvgD(
                          anim.visiblePreBounceArc
                        );
                        const midBounceD = project3DPathToSvgD(
                          anim.visibleBounceToImpactArc
                        );
                        const postImpactD = project3DPathToSvgD(
                          anim.visibleImpactToStumpsArc
                        );
                        const bounceToStumpsTrailD = project3DPathToSvgD(
                          anim.visibleBounceToStumpsTrail
                        );
                        const bounceToStumpsGroundD = project3DPathToSvgD(
                          anim.visibleBounceToStumpsGroundTrack
                        );
                        const wake3DD = project3DPathToSvgD(
                          anim.ballTrailWake3D
                        );

                        const curtain3DPoints =
                          anim.visibleBounceToStumpsTrail.length > 1
                            ? toPolyPoints([
                                ...anim.visibleBounceToStumpsTrail.map((pt) =>
                                  project3D(pt.xCm, pt.yCm, pt.zCm)
                                ),
                                ...[...anim.visibleBounceToStumpsGroundTrack]
                                  .reverse()
                                  .map((pt) =>
                                    project3D(pt.xCm, pt.yCm, pt.zCm)
                                  ),
                              ])
                            : '';

                        const releasePt = project3D(
                          pred.entryPoint3D.xCm,
                          pred.entryPoint3D.yCm,
                          pred.entryPoint3D.zCm
                        );
                        const bouncePt = project3D(
                          pred.bouncePoint3D.xCm,
                          0,
                          pred.bouncePoint3D.zCm
                        );
                        const impactPt = project3D(
                          pred.impactPoint3D.xCm,
                          pred.impactPoint3D.yCm,
                          pred.impactPoint3D.zCm
                        );
                        const impactGroundPt = project3D(
                          pred.impactPoint3D.xCm,
                          0,
                          pred.impactPoint3D.zCm
                        );
                        const stumpHitPt = project3D(
                          pred.stumpIntersection3D.xCm,
                          pred.stumpIntersection3D.yCm,
                          0
                        );
                        const liveBallPt = project3D(
                          anim.currentBall3D.xCm,
                          anim.currentBall3D.yCm,
                          anim.currentBall3D.zCm
                        );
                        const liveGroundPt = project3D(
                          anim.currentGround3D.xCm,
                          0,
                          anim.currentGround3D.zCm
                        );

                        return (
                          <g
                            key={c.id}
                            data-ballmarker="true"
                            onClick={() => handleTrackSingleBall(c.id)}
                            onMouseEnter={() => setHoveredBallId(c.id)}
                            onMouseLeave={() => setHoveredBallId(null)}
                            className="cursor-pointer"
                            opacity={isFocused || c.isOut ? 1 : 0.48}
                          >
                            <path
                              d={groundTrackD}
                              fill="none"
                              stroke="rgba(15, 23, 42, 0.75)"
                              strokeWidth={isFocused ? '2.5' : '1.5'}
                              strokeDasharray="4 4"
                            />
                            {bounceToStumpsGroundD && (
                              <path
                                d={bounceToStumpsGroundD}
                                fill="none"
                                stroke={hex}
                                strokeWidth={isFocused || c.isOut ? '3.5' : '1.8'}
                                opacity={isFocused || c.isOut ? '0.6' : '0.25'}
                              />
                            )}
                            {curtain3DPoints && (
                              <polygon
                                points={curtain3DPoints}
                                fill={hex}
                                opacity={isFocused || c.isOut ? '0.22' : '0.08'}
                              />
                            )}
                            <path
                              d={preBounceD}
                              fill="none"
                              stroke={c.isOut ? '#F43F5E' : '#38BDF8'}
                              strokeWidth={isFocused || c.isOut ? '3.2' : '2'}
                              strokeDasharray="6 4"
                            />
                            {anim.hasBounced && (
                              <g>
                                <ellipse
                                  cx={bouncePt.x}
                                  cy={bouncePt.y}
                                  rx={Math.max(5.5, bouncePt.scale * 3.4)}
                                  ry={Math.max(2.8, bouncePt.scale * 1.5)}
                                  fill="rgba(16, 185, 129, 0.42)"
                                  stroke="#10B981"
                                  strokeWidth="2.2"
                                />
                                {isFocused && (
                                  <text
                                    x={bouncePt.x}
                                    y={bouncePt.y - 10}
                                    textAnchor="middle"
                                    fill="#6EE7B7"
                                    fontSize="9.5"
                                    fontFamily="monospace"
                                    fontWeight="bold"
                                  >
                                    #{c.indexNumber} BOUNCE (
                                    {pred.bounceDistanceFromStumpsM}m)
                                  </text>
                                )}
                              </g>
                            )}
                            {bounceToStumpsTrailD && (
                              <path
                                d={bounceToStumpsTrailD}
                                fill="none"
                                stroke={hex}
                                strokeWidth={isFocused || c.isOut ? '11' : '6'}
                                strokeLinecap="round"
                                opacity={isFocused || c.isOut ? '0.28' : '0.12'}
                              />
                            )}
                            {midBounceD && (
                              <path
                                d={midBounceD}
                                fill="none"
                                stroke={hex}
                                strokeWidth={isFocused || c.isOut ? '5' : '2.8'}
                                strokeLinecap="round"
                              />
                            )}
                            {postImpactD && !isCatchOrEdgeDismissal(c) && (
                              <path
                                d={postImpactD}
                                fill="none"
                                stroke={
                                  pred.hittingWicket || c.isOut ? '#F43F5E' : '#38BDF8'
                                }
                                strokeWidth={isFocused || c.isOut ? '4.4' : '2.4'}
                                strokeDasharray="5 3"
                              />
                            )}
                            {isCatchOrEdgeDismissal(c) && anim.hasImpacted && (
                              <g>
                                <path
                                  d={`M ${impactPt.x} ${impactPt.y} Q ${impactPt.x + (handedness === 'RHB' ? -34 : 34)} ${impactPt.y - 42} ${impactPt.x + (handedness === 'RHB' ? -64 : 64)} ${impactPt.y - 20}`}
                                  fill="none"
                                  stroke="#F59E0B"
                                  strokeWidth="3.2"
                                  strokeDasharray="5 3"
                                />
                                <circle
                                  cx={impactPt.x + (handedness === 'RHB' ? -64 : 64)}
                                  cy={impactPt.y - 20}
                                  r="6.5"
                                  fill="#F59E0B"
                                  stroke="#FFFFFF"
                                  strokeWidth="1.5"
                                />
                                <text
                                  x={impactPt.x + (handedness === 'RHB' ? -64 : 64)}
                                  y={impactPt.y - 30}
                                  textAnchor="middle"
                                  fill="#FDE68A"
                                  fontSize="8.5"
                                  fontFamily="monospace"
                                  fontWeight="bold"
                                >
                                  {c.dismissalType === 'EDGED' ? 'EDGED CATCH' : 'CAUGHT'}
                                </text>
                              </g>
                            )}
                            <circle
                              cx={releasePt.x}
                              cy={releasePt.y}
                              r={isFocused ? '6' : '4'}
                              fill={c.isOut ? '#F43F5E' : '#38BDF8'}
                              stroke="#FFFFFF"
                              strokeWidth="1.5"
                            />
                            {anim.hasImpacted && (
                              <g>
                                <line
                                  x1={impactPt.x}
                                  y1={impactPt.y}
                                  x2={impactGroundPt.x}
                                  y2={impactGroundPt.y}
                                  stroke={hex}
                                  strokeWidth="1.6"
                                  strokeDasharray="3 3"
                                />
                                {/* REAL-LIFE TV BROADCAST WICKET ANIMATION FOR OUT DELIVERIES */}
                                {c.isOut && (
                                  <>
                                    <circle
                                      cx={impactPt.x}
                                      cy={impactPt.y}
                                      r="14"
                                      fill="none"
                                      stroke="#F43F5E"
                                      strokeWidth="2.5"
                                    >
                                      <animate
                                        attributeName="r"
                                        values="10;30;10"
                                        dur="1.2s"
                                        repeatCount="indefinite"
                                      />
                                      <animate
                                        attributeName="opacity"
                                        values="0.95;0.05;0.95"
                                        dur="1.2s"
                                        repeatCount="indefinite"
                                      />
                                    </circle>
                                    <circle
                                      cx={impactPt.x}
                                      cy={impactPt.y}
                                      r="11"
                                      fill="rgba(244, 63, 94, 0.25)"
                                      stroke="#FDE047"
                                      strokeWidth="1.8"
                                    >
                                      <animate
                                        attributeName="r"
                                        values="9;19;9"
                                        dur="0.85s"
                                        repeatCount="indefinite"
                                      />
                                      <animate
                                        attributeName="opacity"
                                        values="0.9;0.2;0.9"
                                        dur="0.85s"
                                        repeatCount="indefinite"
                                      />
                                    </circle>
                                    <g>
                                      <rect
                                        x={impactPt.x - 52}
                                        y={impactPt.y - 35}
                                        width="104"
                                        height="19"
                                        rx="5"
                                        fill="rgba(159, 18, 57, 0.96)"
                                        stroke="#FECDD3"
                                        strokeWidth="1.3"
                                      />
                                      <text
                                        x={impactPt.x}
                                        y={impactPt.y - 22.5}
                                        textAnchor="middle"
                                        fill="#FFFFFF"
                                        fontSize="9"
                                        fontFamily="monospace"
                                        fontWeight="bold"
                                      >
                                        WICKET #{c.indexNumber} · {c.dismissalType || 'OUT'}
                                      </text>
                                    </g>
                                  </>
                                )}
                                <circle
                                  cx={impactPt.x}
                                  cy={impactPt.y}
                                  r={isFocused || c.isOut ? '9.8' : '6.5'}
                                  fill={hex}
                                  stroke={c.isOut ? '#FFE4E6' : '#FFFFFF'}
                                  strokeWidth="2.2"
                                />
                                <text
                                  x={impactPt.x}
                                  y={impactPt.y + 3}
                                  textAnchor="middle"
                                  fill={c.isOut ? '#FFFFFF' : '#090D16'}
                                  fontSize="9"
                                  fontFamily="monospace"
                                  fontWeight="bold"
                                >
                                  {c.indexNumber}
                                </text>
                              </g>
                            )}
                            {anim.hasReachedStumps && !isCatchOrEdgeDismissal(c) && (
                              <g>
                                {c.isOut && (
                                  <circle
                                    cx={stumpHitPt.x}
                                    cy={stumpHitPt.y}
                                    r="12"
                                    fill="none"
                                    stroke="#F43F5E"
                                    strokeWidth="2.2"
                                  >
                                    <animate
                                      attributeName="r"
                                      values="8;24;8"
                                      dur="0.95s"
                                      repeatCount="indefinite"
                                    />
                                    <animate
                                      attributeName="opacity"
                                      values="0.95;0.1;0.95"
                                      dur="0.95s"
                                      repeatCount="indefinite"
                                    />
                                  </circle>
                                )}
                                <circle
                                  cx={stumpHitPt.x}
                                  cy={stumpHitPt.y}
                                  r={isFocused || c.isOut ? '7.5' : '5'}
                                  fill={
                                    pred.hittingWicket || c.isOut ? '#F43F5E' : '#38BDF8'
                                  }
                                  stroke="#FFFFFF"
                                  strokeWidth="1.8"
                                />
                              </g>
                            )}
                            {!anim.hasReachedStumps && (
                              <g>
                                {wake3DD && (
                                  <path
                                    d={wake3DD}
                                    fill="none"
                                    stroke="#FEF08A"
                                    strokeWidth={isFocused ? '6.5' : '4'}
                                    strokeLinecap="round"
                                    opacity="0.68"
                                  />
                                )}
                                <ellipse
                                  cx={liveGroundPt.x}
                                  cy={liveGroundPt.y}
                                  rx={Math.max(4, liveGroundPt.scale * 2.1)}
                                  ry={Math.max(2, liveGroundPt.scale * 0.9)}
                                  fill="rgba(2, 6, 23, 0.72)"
                                />
                                <circle
                                  cx={liveBallPt.x}
                                  cy={liveBallPt.y}
                                  r={
                                    isFocused
                                      ? Math.max(7.2, liveBallPt.scale * 2.8)
                                      : Math.max(5.2, liveBallPt.scale * 2.0)
                                  }
                                  fill="#DC2626"
                                  stroke="#FEF08A"
                                  strokeWidth="2"
                                />
                              </g>
                            )}
                          </g>
                        );
                      })}

                      {nearStumpsNode}
                    </g>
                  );
                })()
              )}
            </svg>
          </div>

          {/* 4. DEDICATED GLASSMORPHIC PLAYBACK & DELIVERY DOCK (DOCKED BELOW CANVAS TO PREVENT OVERLAPS) */}
          <div
            className={
              isImmersiveMode
                ? 'fixed bottom-3.5 left-1/2 -translate-x-1/2 z-30 w-[96%] max-w-5xl rounded-2xl bg-slate-950/85 backdrop-blur-2xl border border-white/[0.14] shadow-[0_20px_50px_rgba(0,0,0,0.9)] px-4 py-2.5 flex flex-col gap-2'
                : 'w-full bg-slate-950/85 backdrop-blur-2xl border-t border-white/[0.08] px-4 py-3 flex flex-col gap-2.5 transition-all duration-300'
            }
          >
            {/* Top Row of Dock: Playback Controls, Phase Scrubber & Speed Multipliers */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                {/* Transport Buttons */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (animProgress >= 0.999) {
                        triggerTrajectoryReplay();
                      } else {
                        setIsPlayingAnim((p) => !p);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-slate-950 text-xs font-bold transition cursor-pointer shadow-sm"
                  >
                    {isPlayingAnim ? (
                      <>
                        <Pause className="w-3.5 h-3.5 fill-current" />
                        <span>Pause</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>{animProgress >= 0.999 ? 'Replay' : 'Play'}</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={triggerTrajectoryReplay}
                    className="p-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-slate-300 hover:text-white border border-white/[0.08] cursor-pointer"
                    title="Restart trajectory from bowler release"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsLoopingAnim((l) => !l)}
                    className={`p-1.5 rounded-xl border transition cursor-pointer ${
                      isLoopingAnim
                        ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/40'
                        : 'bg-white/[0.06] text-slate-400 hover:text-white border-white/[0.08]'
                    }`}
                    title="Toggle continuous loop replay"
                  >
                    <Repeat className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Center Scrubber + Quick Phase Jump Links */}
                <div className="flex-1 min-w-[220px] flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                    <div className="flex items-center gap-2">
                      {[
                        { label: 'Release', p: 0 },
                        {
                          label: 'Bounce',
                          p: activeTrajectoryPrediction?.bounceProgress ?? 0.68,
                        },
                        {
                          label: 'Impact',
                          p: activeTrajectoryPrediction?.impactProgress ?? 0.93,
                        },
                        { label: 'Stumps', p: 1 },
                      ].map((stage, idx) => (
                        <React.Fragment key={stage.label}>
                          {idx > 0 && <span className="text-slate-600">·</span>}
                          <button
                            type="button"
                            onClick={() => {
                              setIsPlayingAnim(false);
                              setAnimProgress(
                                Number(clamp(stage.p, 0, 1).toFixed(3))
                              );
                            }}
                            className={`hover:text-cyan-300 transition cursor-pointer ${
                              Math.abs(animProgress - stage.p) < 0.06
                                ? 'text-cyan-300 font-bold'
                                : 'text-slate-400'
                            }`}
                          >
                            {stage.label}
                          </button>
                        </React.Fragment>
                      ))}
                    </div>
                    <span className="text-cyan-300 font-bold tabular-nums">
                      {Math.round(animProgress * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.005}
                    value={animProgress}
                    onChange={(e) => {
                      setIsPlayingAnim(false);
                      setAnimProgress(Number(e.target.value));
                    }}
                    className="w-full accent-cyan-400 cursor-pointer h-1.5"
                  />
                </div>

                {/* Playback Speed Selector */}
                <div className="flex items-center gap-1 bg-white/[0.04] p-1 rounded-xl border border-white/[0.08]">
                  <Gauge className="w-3.5 h-3.5 text-slate-400 ml-1 mr-0.5 hidden sm:inline" />
                  {[
                    { label: '0.25×', val: 0.25 },
                    { label: '0.5×', val: 0.5 },
                    { label: '1×', val: 1.0 },
                    { label: '2×', val: 2.0 },
                  ].map((sp) => (
                    <button
                      key={sp.label}
                      type="button"
                      onClick={() => setAnimSpeedMultiplier(sp.val)}
                      className={`px-2 py-0.5 rounded-lg font-mono text-[11px] transition cursor-pointer ${
                        Math.abs(animSpeedMultiplier - sp.val) < 0.01
                          ? 'bg-cyan-400 text-slate-950 font-bold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {sp.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Bottom Row of Dock: Delivery Switcher Pills + Quick Bounce Length & Path Calibration */}
              <div className="pt-2 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
                {/* Delivery Switcher Pills */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleTrackAllBalls}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                      trackingScope === 'ALL'
                        ? 'bg-cyan-400 text-slate-950 font-bold shadow-sm'
                        : 'bg-white/[0.05] hover:bg-white/[0.10] text-slate-300 border border-white/[0.08]'
                    }`}
                  >
                    All ({contacts.length})
                  </button>

                  {contacts.map((c) => {
                    const isFocused =
                      focusedContact?.id === c.id &&
                      trackingScope === 'SELECTED';
                    const isChecked =
                      trackingScope === 'SELECTED' &&
                      checkedBallIds.includes(c.id);
                    const zoneColors = getZoneColorConfig(c.projection.zone);
                    const hex = c.isOut ? '#F43F5E' : zoneColors.hex;

                    return (
                      <div
                        key={c.id}
                        className={`inline-flex items-center rounded-lg border text-xs font-mono transition ${
                          c.isOut
                            ? isFocused
                              ? 'bg-rose-500 text-white border-rose-300 shadow-[0_0_16px_rgba(244,63,94,0.45)]'
                              : 'bg-rose-500/20 border-rose-500/50 text-rose-200'
                            : isFocused
                            ? 'bg-white/[0.14] border-cyan-400 text-white'
                            : isChecked
                            ? 'bg-white/[0.08] border-white/25 text-slate-200'
                            : 'bg-white/[0.03] border-white/[0.08] text-slate-400 hover:text-white'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleTrackSingleBall(c.id)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 cursor-pointer font-bold"
                        >
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: hex }}
                          />
                          <span>#{c.indexNumber}</span>
                          {c.isOut && (
                            <span className="px-1 py-0.2 rounded bg-rose-600 text-white text-[9px] font-black">
                              OUT
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleToggleBallCheck(c.id, e)}
                          className={`px-1.5 py-1 border-l border-white/10 text-[10px] cursor-pointer ${
                            isChecked
                              ? 'text-cyan-300 font-bold'
                              : 'text-slate-500 hover:text-slate-300'
                          }`}
                          title="Compare delivery on pitch"
                        >
                          {isChecked ? '✓' : '+'}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Auto-Detected Bounce Telemetry Pill + Path Mode + Open DRS Button */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-emerald-500/10 border border-emerald-400/35 text-xs font-mono">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#10B981]" />
                    <span className="text-slate-300 text-[11px]">
                      Bounce:
                    </span>
                    <span className="text-emerald-300 font-bold tabular-nums">
                      {displayedBounceM.toFixed(1)}m
                    </span>
                    <span className="text-[10px] text-cyan-300 font-semibold uppercase">
                      · e_y{' '}
                      {(
                        activeTrajectoryPrediction?.bounceRestitutionCoeff ??
                        0.58
                      ).toFixed(2)}{' '}
                      · KE{' '}
                      {(
                        activeTrajectoryPrediction?.impactEnergyRetentionPct ??
                        68
                      ).toFixed(0)}
                      %
                    </span>
                  </div>

                  <div className="hidden md:flex items-center bg-white/[0.04] p-0.5 rounded-lg border border-white/[0.08]">
                    {TRAJECTORY_MODES.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setTrajectoryMode(m.id)}
                        className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition cursor-pointer ${
                          trajectoryMode === m.id
                            ? 'bg-cyan-400 text-slate-950 font-bold'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {m.label.split(' ')[0]}
                      </button>
                    ))}
                  </div>

                  {onChangeWorkspaceTab && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsImmersiveMode(false);
                        onChangeWorkspaceTab('DRS_TELEMETRY');
                        triggerDrsBroadcastSequence();
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 text-xs font-semibold transition cursor-pointer whitespace-nowrap"
                    >
                      <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                      <span>Launch TV DRS Review</span>
                    </button>
                  )}

                  {isImmersiveMode && (
                    <button
                      type="button"
                      onClick={() => setIsImmersiveMode(false)}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-500 hover:bg-rose-400 text-white text-xs font-bold transition cursor-pointer whitespace-nowrap shadow-sm"
                    >
                      <Minimize2 className="w-3.5 h-3.5" />
                      <span>Exit Immersive</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
        </div>
      )}

      {/* =====================================================================
       * BATTER DECISION & CREASE INTELLIGENCE SUITE (GLASSMORPHIC DATA CARDS)
       * ===================================================================== */}
      {activeWorkspaceTab === 'PITCH_3D' && (
        <div className="relative bg-white/[0.03] backdrop-blur-2xl border border-white/[0.1] rounded-3xl p-5 flex flex-col gap-4 shadow-[0_24px_80px_-16px_rgba(0,0,0,0.85)] overflow-hidden">
          <div className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full bg-cyan-500/10 blur-3xl" />

          <div className="relative flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-2xl bg-cyan-400/15 border border-cyan-400/30 text-cyan-300">
                <UserCheck className="w-4 h-4" />
              </div>
              <div>
                <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-cyan-400">
                  CREASE &amp; CORRIDOR TELEMETRY
                </div>
                <h3 className="text-sm sm:text-base font-black text-white tracking-tight">
                  Batter Decision &amp; Crease Intelligence
                </h3>
              </div>
            </div>

            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="px-2.5 py-1 rounded-xl bg-white/[0.04] border border-white/[0.1] text-slate-300 font-bold">
                STANCE: {handedness}
              </span>
              <span className="px-2.5 py-1 rounded-xl bg-cyan-500/15 border border-cyan-400/30 text-cyan-300 font-bold tabular-nums">
                {contacts.length} DELIVERIES
              </span>
            </div>
          </div>

          <div className="relative grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 font-mono">
            {/* CARD 1: LEAVE / PLAY VERDICT */}
            <div className="bg-white/[0.025] hover:bg-white/[0.05] backdrop-blur-xl border border-white/[0.08] hover:border-emerald-400/50 rounded-2xl p-4 flex flex-col justify-between gap-3 transition-all duration-300 hover:shadow-[0_0_28px_rgba(16,185,129,0.2)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                  01 · LEAVE / PLAY
                </span>
                <span
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${
                    roleCoachingInsights.batter.activeCallColor === 'RED'
                      ? 'bg-rose-500/15 text-rose-300 border-rose-500/35'
                      : roleCoachingInsights.batter.activeCallColor === 'AMBER'
                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/35'
                      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35'
                  }`}
                >
                  {roleCoachingInsights.batter.activeCall}
                </span>
              </div>

              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase">
                    MUST PLAY
                  </div>
                  <div className="text-2xl font-black text-white tabular-nums">
                    {roleCoachingInsights.batter.mustPlayCount}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-slate-500 uppercase">
                    SAFE LEAVES
                  </div>
                  <div className="text-2xl font-black text-emerald-300 tabular-nums">
                    {roleCoachingInsights.batter.safeLeaveCount}
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-[10px] text-slate-400">
                <span>STUMP LINE GATE</span>
                <span className="text-cyan-300 font-bold">
                  {focusedContact ? focusedContact.projection.zone.toUpperCase() : 'ACTIVE'}
                </span>
              </div>
            </div>

            {/* CARD 2: CREASE INTERCEPTION DEPTH */}
            <div className="bg-white/[0.025] hover:bg-white/[0.05] backdrop-blur-xl border border-white/[0.08] hover:border-cyan-400/50 rounded-2xl p-4 flex flex-col justify-between gap-3 transition-all duration-300 hover:shadow-[0_0_28px_rgba(34,211,238,0.2)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                  02 · INTERCEPTION
                </span>
                <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/35">
                  {Number(roleCoachingInsights.batter.strideDepthM) >= 1.35
                    ? 'FRONT FOOT'
                    : Number(roleCoachingInsights.batter.strideDepthM) <= 0.95
                    ? 'BACK CAMP'
                    : 'NEUTRAL CREASE'}
                </span>
              </div>

              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase">
                    STRIDE DEPTH
                  </div>
                  <div className="text-2xl font-black text-cyan-300 tabular-nums">
                    {roleCoachingInsights.batter.strideDepthM}m
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-slate-500 uppercase">
                    CONTACT HT
                  </div>
                  <div className="text-2xl font-black text-white tabular-nums">
                    {focusedContact?.projection.contactHeightCm ?? 58}cm
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-[10px] text-slate-400">
                <span>BOUNCE COEFF / FRICTION</span>
                <span className="text-slate-200 font-bold tabular-nums">
                  e_y{' '}
                  {(
                    activeTrajectoryPrediction?.bounceRestitutionCoeff ?? 0.58
                  ).toFixed(2)}{' '}
                  · μ{' '}
                  {(
                    activeTrajectoryPrediction?.turfFrictionCoeff ?? 0.24
                  ).toFixed(2)}
                </span>
              </div>
            </div>

            {/* CARD 3: 4TH/5TH STUMP UNCERTAINTY CHANNEL */}
            <div className="bg-white/[0.025] hover:bg-white/[0.05] backdrop-blur-xl border border-white/[0.08] hover:border-amber-400/50 rounded-2xl p-4 flex flex-col justify-between gap-3 transition-all duration-300 hover:shadow-[0_0_28px_rgba(245,158,11,0.2)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                  03 · OFF CORRIDOR
                </span>
                <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/35">
                  4TH–5TH STUMP
                </span>
              </div>

              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase">
                    CHANNEL DENSITY
                  </div>
                  <div className="text-2xl font-black text-amber-300 tabular-nums">
                    {beehiveSummary.uncertaintyCorridorPct}%
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-slate-500 uppercase">
                    AVG STUMP HT
                  </div>
                  <div className="text-2xl font-black text-white tabular-nums">
                    {beehiveSummary.avgStumpHeightCm}cm
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-[10px] text-slate-400">
                <span>CORRIDOR BAND</span>
                <span className="text-amber-200 font-bold">11.4 – 26.0 cm OFF</span>
              </div>
            </div>

            {/* CARD 4: WICKET & LBW EXPOSURE */}
            <div className="bg-white/[0.025] hover:bg-white/[0.05] backdrop-blur-xl border border-white/[0.08] hover:border-rose-400/50 rounded-2xl p-4 flex flex-col justify-between gap-3 transition-all duration-300 hover:shadow-[0_0_28px_rgba(244,63,94,0.2)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                  04 · WICKET THREAT
                </span>
                <span
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${
                    roleCoachingInsights.batter.lbwVulnerabilityPct >= 50
                      ? 'bg-rose-500/15 text-rose-300 border-rose-500/35'
                      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35'
                  }`}
                >
                  {roleCoachingInsights.batter.lbwVulnerabilityPct >= 50
                    ? 'HIGH RISK'
                    : 'GUARDED'}
                </span>
              </div>

              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase">
                    LBW / BOWLED
                  </div>
                  <div
                    className={`text-2xl font-black tabular-nums ${
                      roleCoachingInsights.batter.lbwVulnerabilityPct >= 50
                        ? 'text-rose-400'
                        : 'text-emerald-300'
                    }`}
                  >
                    {roleCoachingInsights.batter.lbwVulnerabilityPct}%
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-slate-500 uppercase">
                    STUMP HIT RATE
                  </div>
                  <div className="text-2xl font-black text-white tabular-nums">
                    {beehiveSummary.hittingWicketsPct}%
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-[10px] text-slate-400">
                <span>WICKET TARGET</span>
                <span className="text-rose-300 font-bold">22.86 × 71.12 cm</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
       * TAB 1 LOWER DECK: GLASSMORPHIC RECORDED DELIVERIES TELEMETRY DECK
       * ===================================================================== */}
      {activeWorkspaceTab === 'PITCH_3D' && (
        <div className="relative bg-white/[0.03] backdrop-blur-2xl border border-white/[0.1] rounded-3xl p-5 flex flex-col gap-4 shadow-[0_24px_80px_-16px_rgba(0,0,0,0.85)] overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="px-2.5 py-1 rounded-xl bg-cyan-400/15 border border-cyan-400/30 font-mono text-[10px] font-bold uppercase tracking-widest text-cyan-300">
                BALL ARCHIVE
              </span>
              <h3 className="text-sm sm:text-base font-black text-white tracking-tight">
                Recorded Deliveries ({contacts.length})
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {onSwitchToVideoTab && (
                <button
                  type="button"
                  onClick={onSwitchToVideoTab}
                  className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 text-xs font-bold cursor-pointer whitespace-nowrap shadow-[0_0_20px_rgba(34,211,238,0.25)]"
                >
                  + Tag Delivery on Video
                </button>
              )}
              <button
                type="button"
                onClick={onRestoreSamples}
                className="px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border border-white/[0.1] text-xs font-semibold cursor-pointer"
              >
                Reset Samples
              </button>
              {contacts.length > 0 && (
                <button
                  type="button"
                  onClick={onClearAll}
                  className="px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/35 text-xs font-semibold cursor-pointer"
                >
                  Clear All
                </button>
              )}
            </div>
          </div>

          {contacts.length === 0 ? (
            <div className="py-8 text-center text-xs font-mono text-slate-400 bg-white/[0.02] rounded-2xl border border-white/[0.06]">
              NO DELIVERIES STORED · CLICK "+ TAG DELIVERY ON VIDEO"
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {contacts.map((c) => {
                const isSelected = focusedContact?.id === c.id;
                const isVisibleOnPitch = visibleContacts.some(
                  (vc) => vc.id === c.id
                );
                const isLocked = c.isLocked !== false;
                const zoneColors = getZoneColorConfig(c.projection.zone);
                const hex = c.isOut ? '#F43F5E' : zoneColors.hex;
                const pred = getPredictionForContact(c);
                const drs = evaluateDRSReview(pred, handedness, onFieldCall);

                return (
                  <div
                    key={c.id}
                    onClick={() => handleTrackSingleBall(c.id)}
                    className={`p-4 rounded-2xl border backdrop-blur-xl transition-all duration-300 cursor-pointer flex flex-col justify-between gap-3 ${
                      c.isOut
                        ? 'bg-rose-500/[0.09] border-rose-500/50 shadow-[0_0_26px_rgba(244,63,94,0.22)]'
                        : isSelected && trackingScope === 'SELECTED'
                        ? 'bg-cyan-400/[0.09] border-cyan-400/60 shadow-[0_0_28px_rgba(34,211,238,0.24)]'
                        : isVisibleOnPitch
                        ? 'bg-white/[0.025] hover:bg-white/[0.05] border-white/[0.08] hover:border-cyan-400/45 hover:shadow-[0_0_24px_rgba(34,211,238,0.18)]'
                        : 'bg-white/[0.015] hover:bg-white/[0.04] border-white/[0.05] hover:border-white/[0.15] opacity-60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="w-7 h-7 rounded-xl flex items-center justify-center text-xs font-mono font-black text-slate-950 shrink-0 shadow"
                          style={{ backgroundColor: hex }}
                        >
                          #{c.indexNumber}
                        </span>
                        <div>
                          <div className="text-xs font-black text-white tracking-tight flex items-center gap-1.5">
                            <span>{c.projection.zone}</span>
                            {c.isOut && (
                              <span className="px-1.5 py-0.5 rounded bg-rose-500 text-white text-[9px] font-mono font-black uppercase">
                                {c.dismissalType || 'OUT'}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] font-mono text-cyan-300 uppercase">
                            {pred.lengthCategoryLabel.split(' ')[0]} LENGTH ·{' '}
                            {Math.abs(c.projection.offsetFromMiddleCm)}cm{' '}
                            {c.projection.offsetFromMiddleCm === 0
                              ? 'MID'
                              : c.projection.offsetFromMiddleCm < 0
                              ? 'OFF'
                              : 'LEG'}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        {onUpdateContactMeta && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateContactMeta(c.id, {
                                isOut: !c.isOut,
                                dismissalType: !c.isOut
                                  ? c.dismissalType || 'BOWLED'
                                  : undefined,
                              });
                            }}
                            className={`px-2 py-1 rounded-xl font-mono text-[10px] font-black border cursor-pointer transition ${
                              c.isOut
                                ? 'bg-rose-500 text-white border-rose-300 shadow-[0_0_12px_rgba(244,63,94,0.4)]'
                                : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-rose-500/20 hover:text-rose-200'
                            }`}
                            title="Toggle OUT / NOT OUT in 3D Pitch"
                          >
                            {c.isOut ? 'OUT' : 'NOT OUT'}
                          </button>
                        )}
                        {c.frameSnapshotUrl && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setZoomedPoint(c);
                            }}
                            className="p-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.12] text-slate-300 border border-white/[0.08] cursor-pointer"
                            title="View impact frame snapshot"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleLockContact(c.id);
                          }}
                          className={`p-1.5 rounded-xl border cursor-pointer ${
                            isLocked
                              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                              : 'bg-amber-500/15 text-amber-300 border-amber-500/35'
                          }`}
                          title={
                            isLocked
                              ? 'Locked (click to unlock)'
                              : 'Unlocked (click to lock)'
                          }
                        >
                          {isLocked ? (
                            <Lock className="w-3.5 h-3.5" />
                          ) : (
                            <Unlock className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteContact(c.id);
                          }}
                          className="p-1.5 rounded-xl bg-white/[0.05] hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 border border-white/[0.08] cursor-pointer"
                          title="Delete delivery"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Shot Played & Ball Note Input */}
                    {onUpdateContactMeta && (
                      <div
                        className="flex items-center gap-2 pt-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          value={c.ballNote ?? ''}
                          onChange={(e) =>
                            onUpdateContactMeta(c.id, {
                              ballNote: e.target.value,
                            })
                          }
                          placeholder="Add ball note (e.g. Out bowled, inside edge)..."
                          className="w-full px-2.5 py-1 rounded-xl bg-black/40 border border-white/[0.08] focus:border-cyan-400 focus:outline-none text-[11px] text-white placeholder-slate-500"
                        />
                      </div>
                    )}

                    {/* 4-Chip Telemetry Strip */}
                    <div className="grid grid-cols-4 gap-1.5 pt-2 border-t border-white/[0.07] font-mono text-[10px] tabular-nums">
                      <div className="bg-black/40 rounded-xl px-2 py-1.5 border border-white/[0.06]">
                        <div className="text-[9px] text-slate-500">BOUNCE</div>
                        <div className="text-white font-bold">
                          {pred.bounceDistanceFromStumpsM}m
                        </div>
                      </div>
                      <div className="bg-black/40 rounded-xl px-2 py-1.5 border border-white/[0.06]">
                        <div className="text-[9px] text-slate-500">HEIGHT</div>
                        <div className="text-white font-bold">
                          {c.projection.contactHeightCm}cm
                        </div>
                      </div>
                      <div className="bg-black/40 rounded-xl px-2 py-1.5 border border-white/[0.06]">
                        <div className="text-[9px] text-slate-500">
                          {c.selectedShotName ? 'SHOT' : pred.hasCalibratedSpeed ? 'PACE' : 'SEAM'}
                        </div>
                        <div className="text-cyan-300 font-bold truncate">
                          {c.selectedShotName
                            ? c.selectedShotName
                            : pred.hasCalibratedSpeed && pred.calibratedSpeedKph
                            ? `${pred.calibratedSpeedKph}kph`
                            : `${Math.abs(pred.lateralDeviationDeg)}°`}
                        </div>
                      </div>
                      <div className="bg-black/40 rounded-xl px-2 py-1.5 border border-white/[0.06]">
                        <div className="text-[9px] text-slate-500">STATUS</div>
                        <div
                          className={`font-bold truncate ${
                            c.isOut || drs.finalDecision === 'OUT'
                              ? 'text-rose-400'
                              : drs.finalDecision === "UMPIRE'S CALL"
                              ? 'text-amber-300'
                              : 'text-emerald-300'
                          }`}
                        >
                          {c.isOut
                            ? `OUT (${c.dismissalType || 'W'})`
                            : drs.finalDecision === "UMPIRE'S CALL"
                            ? 'UMP CALL'
                            : drs.finalDecision}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
       * TAB 3: INTERACTIVE TV BROADCAST DRS STUDIO & LIVE "WHAT-IF" SIMULATOR
       * ===================================================================== */}
      {activeWorkspaceTab === 'DRS_TELEMETRY' && (
        <div className="flex flex-col gap-6">
          {/* TOP GLASSMORPHIC CONTROL HEADER */}
          <div className="relative bg-white/[0.03] backdrop-blur-2xl border border-white/[0.1] rounded-3xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4 shadow-[0_24px_80px_-16px_rgba(0,0,0,0.85)] overflow-hidden">
            <div className="pointer-events-none absolute -top-20 -left-20 w-64 h-64 rounded-full bg-cyan-500/10 blur-3xl" />

            <div className="relative flex flex-wrap items-center gap-3">
              <div>
                <div className="text-[10px] font-mono font-bold text-cyan-400 tracking-widest uppercase">
                  THIRD UMPIRE HAWK-EYE · BALL TRACKING STUDIO
                </div>
                <h2 className="text-lg sm:text-xl font-black text-white tracking-tight flex items-center gap-2">
                  <span>
                    {focusedContact
                      ? `Delivery #${focusedContact.indexNumber} · ${focusedContact.projection.zone}`
                      : 'Select Delivery'}
                  </span>
                  {whatIfOverrides.enabled && (
                    <span className="text-[10px] font-mono font-bold text-amber-300 bg-amber-500/15 border border-amber-500/40 px-2.5 py-0.5 rounded-xl">
                      WHAT-IF SIM
                    </span>
                  )}
                </h2>
              </div>

              {/* Delivery Switcher Pills */}
              <div className="flex flex-wrap items-center gap-1.5 pl-0 sm:pl-3 sm:border-l border-white/[0.1]">
                {contacts.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      handleTrackSingleBall(c.id);
                      triggerDrsBroadcastSequence();
                    }}
                    className={`px-3 py-1.5 rounded-xl font-mono text-xs font-bold transition cursor-pointer ${
                      focusedContact?.id === c.id
                        ? 'bg-cyan-400 text-slate-950 shadow-[0_0_20px_rgba(34,211,238,0.35)]'
                        : 'bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border border-white/[0.08]'
                    }`}
                  >
                    #{c.indexNumber}
                  </button>
                ))}
              </div>
            </div>

            {/* Right Controls: On-Field Umpire Call Toggle + Play TV Broadcast Sequence */}
            <div className="relative flex flex-wrap items-center gap-2.5">
              <div className="flex items-center bg-black/40 p-1 rounded-2xl border border-white/[0.1]">
                <span className="text-[10px] font-mono font-bold text-slate-400 px-2.5 uppercase">
                  ON-FIELD
                </span>
                <button
                  type="button"
                  onClick={() => setOnFieldCall('NOT_OUT')}
                  className={`px-3 py-1 rounded-xl font-mono text-xs font-bold transition cursor-pointer ${
                    onFieldCall === 'NOT_OUT'
                      ? 'bg-emerald-400 text-slate-950 shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  NOT OUT
                </button>
                <button
                  type="button"
                  onClick={() => setOnFieldCall('OUT')}
                  className={`px-3 py-1 rounded-xl font-mono text-xs font-bold transition cursor-pointer ${
                    onFieldCall === 'OUT'
                      ? 'bg-rose-500 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  OUT
                </button>
              </div>

              <button
                type="button"
                onClick={triggerDrsBroadcastSequence}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-gradient-to-r from-cyan-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 text-xs font-extrabold tracking-tight shadow-[0_0_24px_rgba(34,211,238,0.3)] cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>
                  {isPlayingDrsSequence
                    ? 'Playing Sequence...'
                    : 'Replay Broadcast Sequence'}
                </span>
              </button>
            </div>
          </div>

          {/* MAIN DRS STUDIO WORKSPACE (7 COLS BROADCAST MONITOR + 5 COLS WHAT-IF SIMULATOR) */}
          {activeDRSReview && activeTrajectoryPrediction ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* LEFT 7 COLUMNS: CHOREOGRAPHED TV BROADCAST MONITOR & 3-CHECK ILLUMINATION */}
              <div className="lg:col-span-7 bg-white/[0.03] backdrop-blur-2xl border border-white/[0.1] rounded-3xl p-5 flex flex-col gap-4 shadow-[0_24px_80px_-16px_rgba(0,0,0,0.85)]">
                {/* 4 Interactive Broadcast Reveal Stage Pills + TV Camera View Switcher */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/[0.08]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(
                      [
                        { step: 1, label: '01 · Pitching' },
                        { step: 2, label: '02 · Impact' },
                        { step: 3, label: '03 · Wickets' },
                        { step: 4, label: '04 · Verdict' },
                      ] as const
                    ).map((st) => {
                      const isReached = drsRevealStep >= st.step;
                      const isCurrent = drsRevealStep === st.step;
                      return (
                        <button
                          key={st.step}
                          type="button"
                          onClick={() => handleJumpToDrsStep(st.step)}
                          className={`px-3 py-1.5 rounded-xl font-mono text-xs font-bold transition cursor-pointer ${
                            isCurrent
                              ? 'bg-cyan-400 text-slate-950 shadow-sm'
                              : isReached
                              ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40'
                              : 'bg-white/[0.04] text-slate-400 hover:text-white border border-white/[0.08]'
                          }`}
                        >
                          {st.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Broadcast Monitor Angle Switcher */}
                  <div className="flex items-center bg-black/40 p-1 rounded-xl border border-white/[0.08] text-[11px] font-mono">
                    {(
                      [
                        { id: 'SPLIT_DUAL', label: 'Split TV' },
                        { id: 'BOWLER_HAWK_EYE', label: 'Bowler End' },
                        { id: 'SIDE_PROFILE', label: 'Side Height' },
                      ] as const
                    ).map((camOpt) => (
                      <button
                        key={camOpt.id}
                        type="button"
                        onClick={() => setDrsMonitorCamera(camOpt.id)}
                        className={`px-2.5 py-1 rounded-lg transition cursor-pointer ${
                          drsMonitorCamera === camOpt.id
                            ? 'bg-white/15 text-cyan-300 font-bold'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {camOpt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* LIVE TV BROADCAST HAWK-EYE MONITOR */}
                <div className="relative bg-[#05080F] border border-white/[0.1] rounded-2xl overflow-hidden p-3">
                  {(() => {
                    const animSlice = evaluateTrajectoryAnimationAtProgress(
                      activeTrajectoryPrediction,
                      drsAnimProgress
                    );
                    const zingFlash =
                      drsRevealStep >= 3 &&
                      activeTrajectoryPrediction.hittingWicket;

                    const ghostAllPoints =
                      whatIfOverrides.enabled && recordedTrajectoryPrediction
                        ? [
                            ...recordedTrajectoryPrediction.preBounceArc,
                            ...recordedTrajectoryPrediction.bounceToStumpsTrail.slice(
                              1
                            ),
                          ]
                        : [];

                    // 1. Bowler-End Hawk-Eye Projection (Camera behind Bowler looking down the LBW Stump Carpet toward Striker Stumps at Top-Center)
                    const renderBowlerEndHawkEye = (
                      xOffsetPx: number,
                      panelWidthPx: number
                    ) => {
                      const cx = xOffsetPx + panelWidthPx * 0.5;
                      const strikerGroundY = 132;
                      const bowlerGroundY = 286;
                      const lateralScale =
                        panelWidthPx > 450 ? 4.4 : 2.95;

                      const mapBowlerEndPt = (p: WorldPoint3D) => {
                        // zCm = 2012 (Bowler near bottom y=286) -> zCm = 0 (Striker target top-center y=132)
                        const depthFromBowler = clamp(
                          1 - p.zCm / BOWLER_STUMPS_Z_CM,
                          0,
                          1
                        );
                        // Perspective scale narrows slightly from foreground bowler (1.28) to striker stumps (0.86)
                        const persp = 1.28 - 0.42 * Math.pow(depthFromBowler, 0.88);
                        const groundY =
                          bowlerGroundY -
                          (bowlerGroundY - strikerGroundY) *
                            Math.pow(depthFromBowler, 0.88);
                        const xPx = cx + p.xCm * lateralScale * persp;
                        const yPx = groundY - p.yCm * 1.08 * persp;
                        return { x: xPx, y: yPx, groundY, persp };
                      };

                      const turfBL = mapBowlerEndPt({
                        xCm: -55,
                        yCm: 0,
                        zCm: BOWLER_STUMPS_Z_CM,
                      });
                      const turfBR = mapBowlerEndPt({
                        xCm: 55,
                        yCm: 0,
                        zCm: BOWLER_STUMPS_Z_CM,
                      });
                      const turfTL = mapBowlerEndPt({
                        xCm: -55,
                        yCm: 0,
                        zCm: 0,
                      });
                      const turfTR = mapBowlerEndPt({
                        xCm: 55,
                        yCm: 0,
                        zCm: 0,
                      });

                      const carpetBL = mapBowlerEndPt({
                        xCm: -11.43,
                        yCm: 0,
                        zCm: BOWLER_STUMPS_Z_CM,
                      });
                      const carpetBR = mapBowlerEndPt({
                        xCm: 11.43,
                        yCm: 0,
                        zCm: BOWLER_STUMPS_Z_CM,
                      });
                      const carpetTL = mapBowlerEndPt({
                        xCm: -11.43,
                        yCm: 0,
                        zCm: 0,
                      });
                      const carpetTR = mapBowlerEndPt({
                        xCm: 11.43,
                        yCm: 0,
                        zCm: 0,
                      });

                      const popL = mapBowlerEndPt({
                        xCm: -55,
                        yCm: 0,
                        zCm: STRIKER_POPPING_CREASE_Z_CM,
                      });
                      const popR = mapBowlerEndPt({
                        xCm: 55,
                        yCm: 0,
                        zCm: STRIKER_POPPING_CREASE_Z_CM,
                      });

                      const toPath = (pts: WorldPoint3D[]) =>
                        pts
                          .map((pt, i) => {
                            const m = mapBowlerEndPt(pt);
                            return `${i === 0 ? 'M' : 'L'} ${m.x.toFixed(1)} ${m.y.toFixed(1)}`;
                          })
                          .join(' ');

                      const ghostD = toPath(ghostAllPoints);
                      const preD = toPath(animSlice.visiblePreBounceArc);
                      const midD = toPath(animSlice.visibleBounceToImpactArc);
                      const postD = toPath(animSlice.visibleImpactToStumpsArc);

                      const bounceM = mapBowlerEndPt(
                        activeTrajectoryPrediction.bouncePoint3D
                      );
                      const impactM = mapBowlerEndPt(
                        activeTrajectoryPrediction.impactPoint3D
                      );
                      const stumpM = mapBowlerEndPt(
                        activeTrajectoryPrediction.stumpIntersection3D
                      );
                      const ballM = mapBowlerEndPt(animSlice.currentBall3D);

                      return (
                        <g>
                          {/* Panel Title */}
                          <text
                            x={xOffsetPx + 12}
                            y="20"
                            fill="#94A3B8"
                            fontSize="9.5"
                            fontFamily="monospace"
                            fontWeight="bold"
                          >
                            BOWLER-END HAWK-EYE (LBW STUMP CARPET)
                          </text>

                          {/* Pitch Turf Surface */}
                          <polygon
                            points={`${turfTL.x.toFixed(1)},${turfTL.groundY.toFixed(1)} ${turfTR.x.toFixed(1)},${turfTR.groundY.toFixed(1)} ${turfBR.x.toFixed(1)},${turfBR.groundY.toFixed(1)} ${turfBL.x.toFixed(1)},${turfBL.groundY.toFixed(1)}`}
                            fill="url(#drsTurfGrad)"
                            stroke="rgba(148, 163, 184, 0.25)"
                            strokeWidth="1.2"
                          />

                          {/* Official Broadcast Blue/Indigo 22.86cm Stump-to-Stump Carpet */}
                          <polygon
                            points={`${carpetTL.x.toFixed(1)},${carpetTL.groundY.toFixed(1)} ${carpetTR.x.toFixed(1)},${carpetTR.groundY.toFixed(1)} ${carpetBR.x.toFixed(1)},${carpetBR.groundY.toFixed(1)} ${carpetBL.x.toFixed(1)},${carpetBL.groundY.toFixed(1)}`}
                            fill="url(#drsStumpCarpet)"
                            stroke="rgba(56, 189, 248, 0.55)"
                            strokeWidth="1.2"
                          />

                          {/* Striker Popping Crease Line (1.22m) */}
                          <line
                            x1={popL.x}
                            y1={popL.groundY}
                            x2={popR.x}
                            y2={popR.groundY}
                            stroke="rgba(255,255,255,0.45)"
                            strokeWidth="1.3"
                          />

                          {/* Striker Stumps & LED Zing Bails at Target Plane (Z = 0m) */}
                          {[
                            { x: -11.43, lbl: leftStumpName },
                            { x: 0, lbl: 'MID' },
                            { x: 11.43, lbl: rightStumpName },
                          ].map((st, idx) => {
                            const base = mapBowlerEndPt({
                              xCm: st.x,
                              yCm: 0,
                              zCm: 0,
                            });
                            const top = mapBowlerEndPt({
                              xCm: st.x,
                              yCm: 71.12,
                              zCm: 0,
                            });
                            return (
                              <g key={idx}>
                                {zingFlash && (
                                  <line
                                    x1={base.x}
                                    y1={base.y}
                                    x2={top.x}
                                    y2={top.y}
                                    stroke="#F43F5E"
                                    strokeWidth="10"
                                    strokeLinecap="round"
                                    opacity="0.4"
                                  />
                                )}
                                <line
                                  x1={base.x}
                                  y1={base.y}
                                  x2={top.x}
                                  y2={top.y}
                                  stroke={zingFlash ? '#FB7185' : '#F59E0B'}
                                  strokeWidth="4.2"
                                  strokeLinecap="round"
                                />
                                <text
                                  x={top.x}
                                  y={top.y - 8}
                                  textAnchor="middle"
                                  fill="#FDE68A"
                                  fontSize="8.5"
                                  fontFamily="monospace"
                                  fontWeight="bold"
                                >
                                  {st.lbl}
                                </text>
                              </g>
                            );
                          })}

                          {/* Striker Bails */}
                          {(() => {
                            const bL = mapBowlerEndPt({
                              xCm: -11.43,
                              yCm: zingFlash ? 76.5 : 71.12,
                              zCm: 0,
                            });
                            const bR = mapBowlerEndPt({
                              xCm: 11.43,
                              yCm: zingFlash ? 77.2 : 71.12,
                              zCm: 0,
                            });
                            return (
                              <line
                                x1={bL.x}
                                y1={bL.y}
                                x2={bR.x}
                                y2={bR.y}
                                stroke={zingFlash ? '#FDA4AF' : '#FEF08A'}
                                strokeWidth={zingFlash ? '4' : '2.8'}
                                strokeLinecap="round"
                              />
                            );
                          })()}

                          {/* Ghost Recorded Path when What-If is active */}
                          {ghostD && (
                            <path
                              d={ghostD}
                              fill="none"
                              stroke="rgba(148, 163, 184, 0.55)"
                              strokeWidth="2"
                              strokeDasharray="4 4"
                            />
                          )}

                          {/* Pre-Bounce Flight */}
                          {preD && (
                            <path
                              d={preD}
                              fill="none"
                              stroke="#38BDF8"
                              strokeWidth="3"
                              strokeDasharray="5 3"
                              strokeLinecap="round"
                            />
                          )}

                          {/* Bounce to Impact Flight */}
                          {midD && (
                            <path
                              d={midD}
                              fill="none"
                              stroke="#22D3EE"
                              strokeWidth="4.2"
                              strokeLinecap="round"
                            />
                          )}

                          {/* Post-Impact Predicted Continuation to Stumps */}
                          {postD && (
                            <path
                              d={postD}
                              fill="none"
                              stroke={
                                activeTrajectoryPrediction.hittingWicket
                                  ? '#F43F5E'
                                  : '#38BDF8'
                              }
                              strokeWidth="3.8"
                              strokeLinecap="round"
                            />
                          )}

                          {/* Step 1 Lock Marker: PITCHING */}
                          {animSlice.hasBounced && (
                            <g>
                              <ellipse
                                cx={bounceM.x}
                                cy={bounceM.groundY}
                                rx="8"
                                ry="3.8"
                                fill={
                                  activeDRSReview.pitching.color === 'RED'
                                    ? 'rgba(244, 63, 94, 0.45)'
                                    : 'rgba(16, 185, 129, 0.45)'
                                }
                                stroke={
                                  activeDRSReview.pitching.color === 'RED'
                                    ? '#F43F5E'
                                    : '#10B981'
                                }
                                strokeWidth="2"
                              />
                              <text
                                x={bounceM.x + 12}
                                y={bounceM.groundY + 3}
                                fill="#E2E8F0"
                                fontSize="9.5"
                                fontFamily="monospace"
                                fontWeight="bold"
                              >
                                1. {activeDRSReview.pitching.verdict} (
                                {
                                  activeTrajectoryPrediction.bounceDistanceFromStumpsM
                                }
                                m)
                              </text>
                            </g>
                          )}

                          {/* Step 2 Lock Marker: PAD IMPACT */}
                          {animSlice.hasImpacted && (
                            <g>
                              <line
                                x1={impactM.x}
                                y1={impactM.y}
                                x2={impactM.x}
                                y2={impactM.groundY}
                                stroke="rgba(255,255,255,0.45)"
                                strokeWidth="1.4"
                                strokeDasharray="3 3"
                              />
                              <circle
                                cx={impactM.x}
                                cy={impactM.y}
                                r="6.2"
                                fill={
                                  activeDRSReview.impact.color === 'RED'
                                    ? '#F43F5E'
                                    : activeDRSReview.impact.color === 'AMBER'
                                    ? '#F59E0B'
                                    : '#10B981'
                                }
                                stroke="#FFFFFF"
                                strokeWidth="1.8"
                              />
                              <text
                                x={impactM.x - 10}
                                y={impactM.y + 3}
                                textAnchor="end"
                                fill="#F8FAFC"
                                fontSize="9.5"
                                fontFamily="monospace"
                                fontWeight="bold"
                              >
                                2. {activeDRSReview.impact.verdict}
                              </text>
                            </g>
                          )}

                          {/* Live Ball or Final Stump Impact Ball */}
                          <circle
                            cx={
                              drsAnimProgress >= 0.999 ? stumpM.x : ballM.x
                            }
                            cy={
                              drsAnimProgress >= 0.999 ? stumpM.y : ballM.y
                            }
                            r="7.5"
                            fill="#DC2626"
                            stroke="#FEF08A"
                            strokeWidth="2"
                          />
                        </g>
                      );
                    };

                    // 2. Side-On Height Profile Projection (Bowler Left -> Striker Stumps Right with 71.12cm Bail Height Line)
                    const renderSideHeightProfile = (
                      xOffsetPx: number,
                      panelWidthPx: number
                    ) => {
                      const padL = xOffsetPx + 24;
                      const padR = xOffsetPx + panelWidthPx - 28;
                      const usableW = Math.max(80, padR - padL);
                      const groundY = 258;
                      const vertScale = 1.48; // 71.12cm = 105px tall

                      const mapSidePt = (p: WorldPoint3D) => {
                        const normFromBowler = clamp(
                          1 - p.zCm / BOWLER_STUMPS_Z_CM,
                          0,
                          1
                        );
                        return {
                          x: padL + normFromBowler * usableW,
                          y: groundY - p.yCm * vertScale,
                        };
                      };

                      const toSidePath = (pts: WorldPoint3D[]) =>
                        pts
                          .map((pt, i) => {
                            const m = mapSidePt(pt);
                            return `${i === 0 ? 'M' : 'L'} ${m.x.toFixed(1)} ${m.y.toFixed(1)}`;
                          })
                          .join(' ');

                      const ghostSideD = toSidePath(ghostAllPoints);
                      const preSideD = toSidePath(animSlice.visiblePreBounceArc);
                      const midSideD = toSidePath(
                        animSlice.visibleBounceToImpactArc
                      );
                      const postSideD = toSidePath(
                        animSlice.visibleImpactToStumpsArc
                      );

                      const bounceS = mapSidePt(
                        activeTrajectoryPrediction.bouncePoint3D
                      );
                      const impactS = mapSidePt(
                        activeTrajectoryPrediction.impactPoint3D
                      );
                      const stumpS = mapSidePt(
                        activeTrajectoryPrediction.stumpIntersection3D
                      );
                      const ballS = mapSidePt(animSlice.currentBall3D);
                      const bailLineY = groundY - 71.12 * vertScale;
                      const popCreaseX = mapSidePt({
                        xCm: 0,
                        yCm: 0,
                        zCm: STRIKER_POPPING_CREASE_Z_CM,
                      }).x;

                      return (
                        <g>
                          {/* Panel Title */}
                          <text
                            x={xOffsetPx + 12}
                            y="20"
                            fill="#94A3B8"
                            fontSize="9.5"
                            fontFamily="monospace"
                            fontWeight="bold"
                          >
                            SIDE-ON BOUNCE & BAIL HEIGHT PROFILE
                          </text>

                          {/* 71.12cm Regulation Bail Top Reference Line */}
                          <line
                            x1={padL}
                            y1={bailLineY}
                            x2={padR}
                            y2={bailLineY}
                            stroke="rgba(250, 204, 21, 0.45)"
                            strokeWidth="1.2"
                            strokeDasharray="4 4"
                          />
                          <text
                            x={padL + 4}
                            y={bailLineY - 5}
                            fill="#FDE047"
                            fontSize="8.5"
                            fontFamily="monospace"
                          >
                            BAIL TOP HEIGHT (71.1cm)
                          </text>

                          {/* Pitch Turf Line */}
                          <line
                            x1={padL}
                            y1={groundY}
                            x2={padR}
                            y2={groundY}
                            stroke="#10B981"
                            strokeWidth="3"
                            strokeLinecap="round"
                          />

                          {/* Popping Crease Tick */}
                          <line
                            x1={popCreaseX}
                            y1={groundY - 8}
                            x2={popCreaseX}
                            y2={groundY + 6}
                            stroke="#E2E8F0"
                            strokeWidth="1.5"
                          />

                          {/* Bowler Stump at Left */}
                          <line
                            x1={padL}
                            y1={groundY}
                            x2={padL}
                            y2={bailLineY}
                            stroke="#64748B"
                            strokeWidth="3"
                            strokeLinecap="round"
                          />

                          {/* Striker Stump at Right */}
                          <line
                            x1={padR}
                            y1={groundY}
                            x2={padR}
                            y2={bailLineY}
                            stroke={zingFlash ? '#F43F5E' : '#F59E0B'}
                            strokeWidth="4.5"
                            strokeLinecap="round"
                          />
                          <text
                            x={padR}
                            y={groundY + 15}
                            textAnchor="middle"
                            fill="#FDE68A"
                            fontSize="8.5"
                            fontFamily="monospace"
                            fontWeight="bold"
                          >
                            0.0m STUMPS
                          </text>

                          {/* Ghost Recorded Path */}
                          {ghostSideD && (
                            <path
                              d={ghostSideD}
                              fill="none"
                              stroke="rgba(148, 163, 184, 0.55)"
                              strokeWidth="2"
                              strokeDasharray="4 4"
                            />
                          )}

                          {/* Pre-Bounce Arc */}
                          {preSideD && (
                            <path
                              d={preSideD}
                              fill="none"
                              stroke="#38BDF8"
                              strokeWidth="2.8"
                              strokeDasharray="5 3"
                            />
                          )}

                          {/* Bounce to Impact Arc */}
                          {midSideD && (
                            <path
                              d={midSideD}
                              fill="none"
                              stroke="#22D3EE"
                              strokeWidth="3.8"
                            />
                          )}

                          {/* Post-Impact Arc to Stumps */}
                          {postSideD && (
                            <path
                              d={postSideD}
                              fill="none"
                              stroke={
                                activeTrajectoryPrediction.hittingWicket
                                  ? '#F43F5E'
                                  : '#38BDF8'
                              }
                              strokeWidth="3.5"
                              strokeDasharray="5 3"
                            />
                          )}

                          {/* Bounce Marker */}
                          {animSlice.hasBounced && (
                            <g>
                              <circle
                                cx={bounceS.x}
                                cy={groundY}
                                r="5"
                                fill="#10B981"
                                stroke="#FFFFFF"
                                strokeWidth="1.5"
                              />
                              <text
                                x={bounceS.x}
                                y={groundY + 15}
                                textAnchor="middle"
                                fill="#6EE7B7"
                                fontSize="8.5"
                                fontFamily="monospace"
                                fontWeight="bold"
                              >
                                {
                                  activeTrajectoryPrediction.bounceDistanceFromStumpsM
                                }
                                m
                              </text>
                            </g>
                          )}

                          {/* Impact Marker */}
                          {animSlice.hasImpacted && (
                            <g>
                              <line
                                x1={impactS.x}
                                y1={impactS.y}
                                x2={impactS.x}
                                y2={groundY}
                                stroke="rgba(255,255,255,0.35)"
                                strokeWidth="1.2"
                                strokeDasharray="3 3"
                              />
                              <circle
                                cx={impactS.x}
                                cy={impactS.y}
                                r="5.5"
                                fill="#22D3EE"
                                stroke="#FFFFFF"
                                strokeWidth="1.5"
                              />
                              <text
                                x={impactS.x - 6}
                                y={impactS.y - 8}
                                textAnchor="end"
                                fill="#67E8F9"
                                fontSize="8.5"
                                fontFamily="monospace"
                                fontWeight="bold"
                              >
                                {
                                  activeTrajectoryPrediction.impactPoint3D.yCm
                                }
                                cm
                              </text>
                            </g>
                          )}

                          {/* Live Ball / Final Stump Ball */}
                          <circle
                            cx={
                              drsAnimProgress >= 0.999 ? stumpS.x : ballS.x
                            }
                            cy={
                              drsAnimProgress >= 0.999 ? stumpS.y : ballS.y
                            }
                            r="6.5"
                            fill="#DC2626"
                            stroke="#FEF08A"
                            strokeWidth="1.8"
                          />
                        </g>
                      );
                    };

                    return (
                      <svg
                        viewBox="0 0 680 305"
                        className="w-full h-64 sm:h-72 overflow-visible select-none"
                      >
                        <defs>
                          <linearGradient
                            id="drsTurfGrad"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop offset="0%" stopColor="#13251B" />
                            <stop offset="100%" stopColor="#09130E" />
                          </linearGradient>
                          <linearGradient
                            id="drsStumpCarpet"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                          >
                            <stop
                              offset="0%"
                              stopColor="rgba(99, 102, 241, 0.42)"
                            />
                            <stop
                              offset="100%"
                              stopColor="rgba(56, 189, 248, 0.16)"
                            />
                          </linearGradient>
                        </defs>

                        {drsMonitorCamera === 'SPLIT_DUAL' ? (
                          <>
                            {renderSideHeightProfile(0, 326)}
                            <line
                              x1="336"
                              y1="8"
                              x2="336"
                              y2="296"
                              stroke="rgba(255,255,255,0.10)"
                              strokeWidth="1.5"
                            />
                            {renderBowlerEndHawkEye(344, 336)}
                          </>
                        ) : drsMonitorCamera === 'BOWLER_HAWK_EYE' ? (
                          renderBowlerEndHawkEye(0, 680)
                        ) : (
                          renderSideHeightProfile(0, 680)
                        )}
                      </svg>
                    );
                  })()}

                  {/* Interactive DRS Sequence Timeline Scrubber Bar inside Monitor */}
                  <div className="mt-2 pt-2.5 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          if (drsAnimProgress >= 0.995) {
                            triggerDrsBroadcastSequence();
                          } else {
                            setIsPlayingDrsSequence((p) => !p);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 text-xs font-bold cursor-pointer"
                      >
                        {isPlayingDrsSequence ? (
                          <>
                            <Pause className="w-3 h-3 fill-current" />
                            <span>Pause</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3 h-3 fill-current" />
                            <span>
                              {drsAnimProgress >= 0.995
                                ? 'Replay Sequence'
                                : 'Resume'}
                            </span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={triggerDrsBroadcastSequence}
                        className="p-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-slate-300 hover:text-white border border-white/[0.08] cursor-pointer"
                        title="Restart TV Broadcast DRS sequence from release"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex-1 min-w-[180px] flex items-center gap-2.5">
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.005}
                        value={drsAnimProgress}
                        onChange={(e) =>
                          handleScrubDrsProgress(Number(e.target.value))
                        }
                        className="w-full accent-cyan-400 cursor-pointer h-1.5"
                      />
                      <span className="text-[11px] font-mono text-cyan-300 font-bold tabular-nums w-10 text-right">
                        {Math.round(drsAnimProgress * 100)}%
                      </span>
                    </div>

                    <div className="text-[11px] font-mono text-slate-400">
                      {handedness} ·{' '}
                      {activeTrajectoryPrediction.hasCalibratedSpeed &&
                      activeTrajectoryPrediction.calibratedSpeedKph
                        ? `⚡ ${activeTrajectoryPrediction.calibratedSpeedKph} km/h`
                        : `${Math.abs(
                            activeTrajectoryPrediction.lateralDeviationDeg
                          )}° Seam (${
                            activeTrajectoryPrediction.lateralDriftCm > 0
                              ? '+'
                              : ''
                          }${activeTrajectoryPrediction.lateralDriftCm}cm)`}
                    </div>
                  </div>
                </div>

                {/* 3 SEQUENTIAL ICC DRS CHECK CARDS (GLASSMORPHIC TELEMETRY) */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  {[
                    {
                      stepNum: 1,
                      stepLabel: '01 · PITCHING',
                      verdict: activeDRSReview.pitching.verdict,
                      color: activeDRSReview.pitching.color,
                      detail: activeDRSReview.pitching.detail,
                    },
                    {
                      stepNum: 2,
                      stepLabel: '02 · IMPACT',
                      verdict: activeDRSReview.impact.verdict,
                      color: activeDRSReview.impact.color,
                      detail: activeDRSReview.impact.detail,
                    },
                    {
                      stepNum: 3,
                      stepLabel: '03 · WICKETS',
                      verdict: activeDRSReview.wickets.verdict,
                      color: activeDRSReview.wickets.color,
                      detail: activeDRSReview.wickets.detail,
                    },
                  ].map((chk) => {
                    const isRevealed = drsRevealStep >= chk.stepNum;
                    return (
                      <div
                        key={chk.stepLabel}
                        onClick={() =>
                          handleJumpToDrsStep(chk.stepNum as 1 | 2 | 3)
                        }
                        className={`rounded-2xl p-4 border backdrop-blur-xl transition cursor-pointer flex flex-col justify-between gap-2.5 ${
                          isRevealed
                            ? 'bg-white/[0.035] border-white/[0.12] shadow-md'
                            : 'bg-white/[0.015] border-white/[0.05] opacity-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">
                            {chk.stepLabel}
                          </span>
                          {isRevealed ? (
                            renderDrsLampBadge(chk.color, chk.verdict)
                          ) : (
                            <span className="text-[10px] font-mono text-slate-500">
                              LOCKING...
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-mono font-semibold text-white tabular-nums">
                          {isRevealed ? chk.detail : 'Awaiting Hawk-Eye'}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* 3D PATH SMOOTHING CONTROL NODE TELEMETRY STRIP */}
                {activeTrajectoryPrediction.pathSmoothingApplied &&
                  activeTrajectoryPrediction.smoothingControlNode3D &&
                  activeTrajectoryPrediction.impactTangentVector3D && (
                    <div className="rounded-2xl px-4 py-2.5 bg-cyan-950/20 border border-cyan-500/25 flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono">
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
                        <span className="font-bold text-cyan-300 uppercase tracking-wider">
                          3D Hermite Spline Smoothing
                        </span>
                        <span className="text-slate-400">
                          Control Node (Bounce):{' '}
                          <span className="text-slate-200 font-semibold tabular-nums">
                            X:{activeTrajectoryPrediction.smoothingControlNode3D.xCm}cm · Z:
                            {(
                              activeTrajectoryPrediction.smoothingControlNode3D
                                .zCm / 100
                            ).toFixed(2)}
                            m
                          </span>
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-slate-400 tabular-nums">
                        <span>
                          Tangent Vector:{' '}
                          <span className="text-emerald-300 font-semibold">
                            (
                            {
                              activeTrajectoryPrediction.impactTangentVector3D
                                .dx
                            }
                            ,{' '}
                            {
                              activeTrajectoryPrediction.impactTangentVector3D
                                .dy
                            }
                            ,{' '}
                            {
                              activeTrajectoryPrediction.impactTangentVector3D
                                .dz
                            }
                            )
                          </span>
                        </span>
                        {typeof activeTrajectoryPrediction.postImpactCurvatureKappa ===
                          'number' && (
                          <span>
                            κ:{' '}
                            <span className="text-cyan-300 font-semibold">
                              {activeTrajectoryPrediction.postImpactCurvatureKappa.toFixed(
                                4
                              )}
                            </span>
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                {/* STEP 4: BIG-SCREEN THIRD UMPIRE VERDICT BANNER */}
                <div
                  className={`p-4 sm:p-5 rounded-2xl border backdrop-blur-xl transition flex flex-wrap items-center justify-between gap-4 ${
                    drsRevealStep < 4
                      ? 'bg-white/[0.025] border-white/[0.08]'
                      : activeDRSReview.bigScreenVerdict === 'OUT'
                      ? 'bg-rose-500/[0.14] border-rose-500/50 shadow-[0_0_30px_rgba(244,63,94,0.2)]'
                      : 'bg-emerald-500/[0.14] border-emerald-500/50 shadow-[0_0_30px_rgba(16,185,129,0.2)]'
                  }`}
                >
                  <div>
                    <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-300 flex items-center gap-2">
                      <span>THIRD UMPIRE VERDICT</span>
                      <span className="text-slate-500">·</span>
                      <span className="text-cyan-300">
                        {activeDRSReview.reviewOutcomeLabel}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-3 mt-1">
                      <span className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                        {drsRevealStep < 4
                          ? 'TRACKING IN PROGRESS...'
                          : activeDRSReview.bigScreenVerdict}
                      </span>
                      {drsRevealStep >= 4 && (
                        <span
                          className={`text-xs font-mono font-bold px-2.5 py-0.5 rounded-xl border ${
                            activeDRSReview.finalDecision === 'OUT'
                              ? 'bg-rose-500/20 text-rose-200 border-rose-500/50'
                              : activeDRSReview.finalDecision ===
                                "UMPIRE'S CALL"
                              ? 'bg-amber-500/20 text-amber-200 border-amber-500/50'
                              : 'bg-emerald-500/20 text-emerald-200 border-emerald-500/50'
                          }`}
                        >
                          DRS: {activeDRSReview.finalDecision}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-slate-300 mt-1">
                      {activeDRSReview.decisionReason}
                    </div>
                  </div>

                  {/* Recorded vs Simulated Comparison Badge when What-If is Active */}
                  {whatIfOverrides.enabled && recordedDRSReview ? (
                    <div className="bg-black/50 border border-amber-500/40 rounded-2xl px-3.5 py-2.5 font-mono text-xs space-y-1">
                      <div className="text-[10px] text-amber-300 font-bold">
                        RECORDED VS WHAT-IF
                      </div>
                      <div className="text-slate-300">
                        REC:{' '}
                        <span className="text-white font-bold">
                          {recordedDRSReview.finalDecision}
                        </span>
                      </div>
                      <div className="text-cyan-300">
                        SIM:{' '}
                        <span className="text-white font-bold">
                          {activeDRSReview.finalDecision}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 font-mono text-xs tabular-nums">
                      <div className="px-3 py-2 rounded-xl bg-black/40 border border-white/[0.08] text-right">
                        <div className="text-[10px] text-slate-400">OVERLAP</div>
                        <div className="text-sm font-black text-white">
                          {activeDRSReview.wickets.overlapPct}%
                        </div>
                      </div>
                      <div className="px-3 py-2 rounded-xl bg-black/40 border border-white/[0.08] text-right">
                        <div className="text-[10px] text-slate-400">BOUNCE</div>
                        <div className="text-sm font-black text-cyan-300">
                          {activeTrajectoryPrediction.bounceDistanceFromStumpsM}m
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT 5 COLUMNS: INTERACTIVE "WHAT-IF" DRS SIMULATOR & DRAGGABLE 1:1 STUMP PLANE */}
              <div className="lg:col-span-5 bg-white/[0.03] backdrop-blur-2xl border border-white/[0.1] rounded-3xl p-5 flex flex-col gap-4 shadow-[0_24px_80px_-16px_rgba(0,0,0,0.85)]">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-mono font-bold text-cyan-400 uppercase tracking-widest">
                      COUNTERFACTUAL PHYSICS
                    </div>
                    <h3 className="text-base font-black text-white flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-cyan-400" />
                      Interactive "What-If" DRS Simulator
                    </h3>
                  </div>
                  {whatIfOverrides.enabled && (
                    <button
                      type="button"
                      onClick={() => applyWhatIfPreset('RECORDED')}
                      className="px-2.5 py-1 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-mono font-bold cursor-pointer shrink-0"
                    >
                      Reset
                    </button>
                  )}
                </div>

                {/* 1-Tap Quick DRS Scenario Presets */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      { id: 'THREE_REDS', label: '3 Reds (Plumb)' },
                      { id: 'UMPIRES_CALL', label: "Umpire's Call Edge" },
                      { id: 'OUTSIDE_LEG', label: 'Pitched Outside Leg' },
                      { id: 'OVER_BAILS', label: 'Over Bails' },
                    ] as const
                  ).map((pr) => (
                    <button
                      key={pr.id}
                      type="button"
                      onClick={() => applyWhatIfPreset(pr.id)}
                      className="px-2.5 py-1 rounded-xl bg-white/[0.04] hover:bg-cyan-400/20 text-slate-300 hover:text-cyan-300 border border-white/[0.08] hover:border-cyan-400/40 text-[11px] font-mono font-semibold transition cursor-pointer"
                    >
                      {pr.label}
                    </button>
                  ))}
                </div>

                {/* Interactive Draggable 1:1 Front-On Stump Verification Canvas */}
                <div className="bg-[#05080F] border border-white/[0.08] rounded-xl p-3.5">
                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-2">
                    <span>DRAG BALL ON STUMP PLANE (1:1 SCALE)</span>
                    <span className="text-cyan-300 font-bold tabular-nums">
                      Overlap: {activeDRSReview.wickets.overlapPct}% · Height:{' '}
                      {activeTrajectoryPrediction.stumpIntersection3D.yCm}cm
                    </span>
                  </div>

                  <svg
                    viewBox="-38 -16 76 98"
                    onPointerDown={(e) => {
                      drsStumpDragRef.current = true;
                      e.currentTarget.setPointerCapture(e.pointerId);
                      updateWhatIfFromStumpSvgEvent(e);
                    }}
                    onPointerMove={(e) => {
                      if (!drsStumpDragRef.current) return;
                      updateWhatIfFromStumpSvgEvent(e);
                    }}
                    onPointerUp={() => {
                      drsStumpDragRef.current = false;
                    }}
                    className="w-full h-52 overflow-visible cursor-crosshair select-none touch-none"
                  >
                    {/* Umpire's Call Outer Graze Box (30.06cm x 74.72cm) */}
                    <rect
                      x="-15.03"
                      y="-3.6"
                      width="30.06"
                      height="74.72"
                      fill="rgba(245, 158, 11, 0.05)"
                      stroke="rgba(245, 158, 11, 0.30)"
                      strokeWidth="0.5"
                      strokeDasharray="1.5 1.5"
                    />
                    {/* Regulation Stump Hit Zone Box (22.86cm x 71.12cm) */}
                    <rect
                      x="-11.43"
                      y="0"
                      width="22.86"
                      height="71.12"
                      fill="rgba(244, 63, 94, 0.12)"
                      stroke="rgba(244, 63, 94, 0.45)"
                      strokeWidth="0.6"
                      strokeDasharray="2 2"
                    />
                    <line
                      x1="-34"
                      y1="71.12"
                      x2="34"
                      y2="71.12"
                      stroke="#94A3B8"
                      strokeWidth="1.2"
                    />

                    {/* 3 Regulation Stumps */}
                    {[
                      { x: -11.43, label: leftStumpName },
                      { x: 0, label: 'MID' },
                      { x: 11.43, label: rightStumpName },
                    ].map((st, i) => (
                      <g key={i}>
                        <line
                          x1={st.x}
                          y1="0"
                          x2={st.x}
                          y2="71.12"
                          stroke="#F59E0B"
                          strokeWidth="3.2"
                          strokeLinecap="round"
                        />
                        <text
                          x={st.x}
                          y="77.5"
                          textAnchor="middle"
                          fill="#FDE68A"
                          fontSize="3.8"
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          {st.label}
                        </text>
                      </g>
                    ))}
                    <line
                      x1="-12.2"
                      y1="0"
                      x2="12.2"
                      y2="0"
                      stroke="#FEF08A"
                      strokeWidth="2.2"
                    />

                    {/* Ghost Recorded Stump Intersection when What-If is active */}
                    {whatIfOverrides.enabled && recordedTrajectoryPrediction && (
                      <circle
                        cx={
                          recordedTrajectoryPrediction.stumpIntersection3D.xCm
                        }
                        cy={
                          71.12 -
                          clamp(
                            recordedTrajectoryPrediction.stumpIntersection3D
                              .yCm,
                            0,
                            84
                          )
                        }
                        r="3.6"
                        fill="none"
                        stroke="#94A3B8"
                        strokeWidth="1"
                        strokeDasharray="1.5 1.5"
                      />
                    )}

                    {/* Active Impact -> Stump Vector & 3.60cm Regulation Ball Radius */}
                    {(() => {
                      const cx = activeTrajectoryPrediction.impactPoint3D.xCm;
                      const cy =
                        71.12 -
                        clamp(
                          activeTrajectoryPrediction.impactPoint3D.yCm,
                          0,
                          84
                        );
                      const sx =
                        activeTrajectoryPrediction.stumpIntersection3D.xCm;
                      const sy =
                        71.12 -
                        clamp(
                          activeTrajectoryPrediction.stumpIntersection3D.yCm,
                          0,
                          84
                        );
                      return (
                        <g>
                          <line
                            x1={cx}
                            y1={cy}
                            x2={sx}
                            y2={sy}
                            stroke="#22D3EE"
                            strokeWidth="1.8"
                            strokeDasharray="2.5 2"
                          />
                          {/* Pad Impact Point */}
                          <circle
                            cx={cx}
                            cy={cy}
                            r="3.0"
                            fill="#10B981"
                            stroke="#FFFFFF"
                            strokeWidth="0.9"
                          />
                          {/* Stump Plane Ball (Exact 3.60cm Cricket Ball Radius) */}
                          <circle
                            cx={sx}
                            cy={sy}
                            r="3.6"
                            fill={
                              activeTrajectoryPrediction.hittingWicket
                                ? '#F43F5E'
                                : '#38BDF8'
                            }
                            stroke="#FEF08A"
                            strokeWidth="1.2"
                          />
                        </g>
                      );
                    })()}
                  </svg>
                </div>

                {/* 4 Counterfactual What-If Sliders */}
                <div className="space-y-3 pt-1 font-mono text-xs">
                  {/* 1. Pitching Line Shift */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-300">
                        1. Pitching Line Shift:
                      </span>
                      <span className="text-cyan-300 font-bold tabular-nums">
                        {whatIfOverrides.pitchLineShiftCm > 0 ? '+' : ''}
                        {whatIfOverrides.pitchLineShiftCm.toFixed(1)} cm (
                        {activeDRSReview.pitching.verdict})
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-30}
                      max={30}
                      step={0.5}
                      value={whatIfOverrides.pitchLineShiftCm}
                      onChange={(e) => {
                        setIsPlayingDrsSequence(false);
                        setDrsRevealStep(4);
                        setDrsAnimProgress(1);
                        setWhatIfOverrides((prev) => ({
                          ...prev,
                          enabled: true,
                          pitchLineShiftCm: Number(e.target.value),
                        }));
                      }}
                      className="w-full accent-cyan-400 cursor-pointer h-1.5"
                    />
                  </div>

                  {/* 2. Pad Impact & Stump Corridor Shift */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-300">
                        2. Impact & Stump Line Shift:
                      </span>
                      <span className="text-cyan-300 font-bold tabular-nums">
                        {whatIfOverrides.impactLateralShiftCm > 0 ? '+' : ''}
                        {whatIfOverrides.impactLateralShiftCm.toFixed(1)} cm (
                        {activeDRSReview.impact.verdict})
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-30}
                      max={30}
                      step={0.5}
                      value={whatIfOverrides.impactLateralShiftCm}
                      onChange={(e) => {
                        setIsPlayingDrsSequence(false);
                        setDrsRevealStep(4);
                        setDrsAnimProgress(1);
                        setWhatIfOverrides((prev) => ({
                          ...prev,
                          enabled: true,
                          impactLateralShiftCm: Number(e.target.value),
                        }));
                      }}
                      className="w-full accent-cyan-400 cursor-pointer h-1.5"
                    />
                  </div>

                  {/* 3. Bounce Length */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-300">
                        3. Pitch Bounce Length:
                      </span>
                      <span className="text-cyan-300 font-bold tabular-nums">
                        {displayedBounceM.toFixed(1)} m (
                        {
                          activeTrajectoryPrediction.lengthCategoryLabel.split(
                            ' '
                          )[0]
                        }
                        )
                      </span>
                    </div>
                    <input
                      type="range"
                      min={1.4}
                      max={12.0}
                      step={0.1}
                      value={displayedBounceM}
                      onChange={(e) => {
                        setIsPlayingDrsSequence(false);
                        setDrsRevealStep(4);
                        setDrsAnimProgress(1);
                        setWhatIfOverrides((prev) => ({
                          ...prev,
                          enabled: true,
                          bounceLengthM: Number(e.target.value),
                        }));
                      }}
                      className="w-full accent-cyan-400 cursor-pointer h-1.5"
                    />
                  </div>

                  {/* 4. Stump Impact Height Shift (cm) */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-300">
                        4. Stump Impact Height Shift:
                      </span>
                      <span className="text-cyan-300 font-bold tabular-nums">
                        {(whatIfOverrides.heightShiftCm ?? 0) > 0 ? '+' : ''}
                        {(whatIfOverrides.heightShiftCm ?? 0).toFixed(1)} cm (
                        {activeTrajectoryPrediction.stumpIntersection3D.yCm}cm
                        high)
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-45}
                      max={45}
                      step={0.5}
                      value={whatIfOverrides.heightShiftCm ?? 0}
                      onChange={(e) => {
                        setIsPlayingDrsSequence(false);
                        setDrsRevealStep(4);
                        setDrsAnimProgress(1);
                        setWhatIfOverrides((prev) => ({
                          ...prev,
                          enabled: true,
                          heightShiftCm: Number(e.target.value),
                        }));
                      }}
                      className="w-full accent-cyan-400 cursor-pointer h-1.5"
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Full Session Delivery Telemetry Table */}
          <div className="bg-white/[0.03] backdrop-blur-2xl border border-white/[0.1] rounded-3xl p-6 shadow-[0_24px_80px_-16px_rgba(0,0,0,0.85)]">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2.5">
                <span className="px-2.5 py-1 rounded-xl bg-cyan-400/15 border border-cyan-400/30 font-mono text-[10px] font-bold uppercase tracking-widest text-cyan-300">
                  SESSION LOG
                </span>
                <h3 className="text-base font-black text-white">
                  Delivery Telemetry Matrix ({contacts.length})
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportSessionCsv}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 text-xs font-bold cursor-pointer shadow-sm"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export CSV
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
                <thead>
                  <tr className="border-b border-white/[0.08] text-slate-400 font-sans">
                    <th className="py-2.5 px-3">Ball</th>
                    <th className="py-2.5 px-3">Line Zone</th>
                    <th className="py-2.5 px-3">Bounce Length</th>
                    <th className="py-2.5 px-3">Seam / Speed</th>
                    <th className="py-2.5 px-3">Contact Height</th>
                    <th className="py-2.5 px-3">Pitching</th>
                    <th className="py-2.5 px-3">Impact</th>
                    <th className="py-2.5 px-3">Wickets</th>
                    <th className="py-2.5 px-3">DRS Verdict</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {contacts.map((c) => {
                    const pred = getPredictionForContact(c);
                    const drs = evaluateDRSReview(
                      pred,
                      handedness,
                      onFieldCall
                    );
                    const isFocus = focusedContact?.id === c.id;
                    const { hex } = getZoneColorConfig(c.projection.zone);

                    return (
                      <tr
                        key={c.id}
                        onClick={() => {
                          handleTrackSingleBall(c.id);
                          triggerDrsBroadcastSequence();
                        }}
                        className={`cursor-pointer transition ${
                          isFocus
                            ? 'bg-white/[0.08]'
                            : 'hover:bg-white/[0.04]'
                        }`}
                      >
                        <td className="py-3 px-3">
                          <span
                            className="inline-flex w-6 h-6 rounded-full items-center justify-center font-bold text-slate-950"
                            style={{ backgroundColor: hex }}
                          >
                            {c.indexNumber}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-sans font-semibold text-white">
                          {c.projection.zone}
                        </td>
                        <td className="py-3 px-3 text-cyan-300 font-semibold">
                          {pred.bounceDistanceFromStumpsM}m (
                          {pred.lengthCategoryLabel.split(' ')[0]})
                        </td>
                        <td
                          className="py-3 px-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-slate-200">
                              {Math.abs(pred.lateralDeviationDeg)}° (
                              {pred.lateralDriftCm > 0 ? '+' : ''}
                              {pred.lateralDriftCm}cm)
                            </span>
                            {onUpdateContactSpeed && (
                              <input
                                type="number"
                                min={40}
                                max={175}
                                step={0.5}
                                placeholder="km/h"
                                value={c.calibratedSpeedKph ?? ''}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value);
                                  onUpdateContactSpeed(
                                    c.id,
                                    Number.isFinite(val) &&
                                      val >= 40 &&
                                      val <= 175
                                      ? Number(val.toFixed(1))
                                      : undefined
                                  );
                                }}
                                className="w-16 bg-slate-950 text-emerald-300 placeholder-slate-600 px-1.5 py-0.5 rounded border border-white/10 focus:outline-none focus:border-cyan-400 text-[11px] font-mono"
                                title="Optional calibrated radar speed (km/h)"
                              />
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-slate-300">
                          {c.projection.contactHeightCm} cm
                        </td>
                        <td className="py-3 px-3">
                          {renderDrsLampBadge(
                            drs.pitching.color,
                            drs.pitching.verdict
                          )}
                        </td>
                        <td className="py-3 px-3">
                          {renderDrsLampBadge(
                            drs.impact.color,
                            drs.impact.verdict
                          )}
                        </td>
                        <td className="py-3 px-3">
                          {renderDrsLampBadge(
                            drs.wickets.color,
                            drs.wickets.verdict
                          )}
                        </td>
                        <td className="py-3 px-3 font-bold">
                          <span
                            className={
                              drs.finalDecision === 'OUT'
                                ? 'text-rose-400'
                                : drs.finalDecision === "UMPIRE'S CALL"
                                ? 'text-amber-300'
                                : 'text-emerald-300'
                            }
                          >
                            {drs.finalDecision} ({drs.bigScreenVerdict})
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTrackSingleBall(c.id);
                              onChangeWorkspaceTab?.('PITCH_3D');
                            }}
                            className="px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-cyan-400 hover:text-slate-950 text-cyan-300 font-sans font-semibold transition cursor-pointer"
                          >
                            View in 3D
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Snapshot Lightbox Modal */}
      {zoomedPoint && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setZoomedPoint(null)}
        >
          <div
            className="bg-[#090E1A] border border-white/[0.12] rounded-2xl max-w-xl w-full overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-white/[0.08] flex items-center justify-between">
              <span className="text-sm font-bold text-white">
                Delivery #{zoomedPoint.indexNumber} ·{' '}
                {zoomedPoint.projection.zone}
              </span>
              <button
                type="button"
                onClick={() => setZoomedPoint(null)}
                className="p-1 rounded-lg bg-white/10 text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4">
              {zoomedPoint.frameSnapshotUrl ? (
                <img
                  src={zoomedPoint.frameSnapshotUrl}
                  alt={`Delivery ${zoomedPoint.indexNumber}`}
                  className="w-full rounded-xl border border-white/[0.08]"
                />
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

