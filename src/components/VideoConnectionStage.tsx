import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Compass,
  Crosshair,
  Eye,
  EyeOff,
  Film,
  Flame,
  Grid,
  Lock,
  Maximize2,
  Minimize2,
  Move,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Sliders,
  Sparkles,
  Target,
  Unlock,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  AIShotAnalysisReport,
  BatterHandedness,
  CameraDistanceTelemetry,
  ContactPointRecord,
  DismissalType,
  NormalizedPoint,
  PendingContactPreview,
  PlantedStumpsConfig,
  RecentVideoClip,
  TrackedBallFramePoint,
} from '../types/cricket';
import {
  autoDetectBounceFromContactPoint,
  calculateBallTrajectory,
  calculateCameraStumpDistances,
  calculateImaginaryStumpPoint,
  captureFrameWithContact,
  clamp,
  COMMON_CRICKET_SHOTS,
  computePitchCorridorHomography,
  createDefaultPlantedStumps,
  getVideoContentRect,
  project3DPitchBounceToVideo,
  project3DTrajectoryToVideo,
  projectVideoBounceTo3DPitch,
  resolveFourPointCalibration,
} from '../utils/stumpProjection';
import {
  detectRealBounceInflection,
  DetectedTurfBounceResult,
} from '../utils/bounceTracker';
import {
  autoDetectThreePointDeliveryFromVideo,
  FilmstripFrame,
  generateSwingFilmstrip,
  runAICalibrationWizardScan,
} from '../utils/frameExtractor';

interface VideoConnectionStageProps {
  handedness: BatterHandedness;
  activeStumps: PlantedStumpsConfig;
  onChangeActiveStumps: (next: PlantedStumpsConfig) => void;
  contacts: ContactPointRecord[];
  selectedContact: ContactPointRecord | null;
  pendingPreview: PendingContactPreview | null;
  onStagePreviewPoint: (preview: PendingContactPreview) => void;
  onUpdatePendingMeta?: (patch: Partial<PendingContactPreview>) => void;
  onUpdateContactMeta?: (id: string, patch: Partial<ContactPointRecord>) => void;
  onCommitPendingPreview: (customBounceLengthM?: number | null) => void;
  onDiscardPendingPreview: () => void;
  onToggleLockContact: (id: string) => void;
  onClearSelection: () => void;
  onUpdateContactBounceLength?: (
    id: string,
    bounceLengthM: number | undefined
  ) => void;
  onUpdateContactSpeed?: (
    id: string,
    calibratedSpeedKph: number | undefined
  ) => void;
  onUpdateContactShotAnalysis?: (
    id: string,
    analysis: AIShotAnalysisReport
  ) => void;
  onVideoUrlChange?: (url: string) => void;
  onVideoTrimChange?: (
    trimStartSec: number,
    trimEndSec: number,
    durationSec: number,
    isCustomTrim: boolean
  ) => void;
  seekRequest?: { timestampSec: number; seq: number } | null;
  onOpen3DPitch?: () => void;
  onOpenMatchupStudio?: () => void;
}

type ClickMode =
  | 'FOLLOW_BALL'
  | 'MANUAL_RELEASE'
  | 'MANUAL_BOUNCE'
  | 'MANUAL_CONTACT'
  | 'BACK_STUMPS'
  | 'FRONT_STUMPS'
  | 'POPPING_CREASE';

type StumpEditAction = 'MOVE' | 'RESIZE';

type DragHandle =
  | 'NONE'
  | 'BACK_STUMPS'
  | 'BACK_STUMPS_RESIZE'
  | 'FRONT_STUMPS'
  | 'FRONT_STUMPS_RESIZE'
  | 'POPPING_CREASE'
  | 'RELEASE_POINT'
  | 'BOUNCE_POINT'
  | 'CONTACT_POINT';

const MANUAL_SHOT_OPTIONS = COMMON_CRICKET_SHOTS.filter(
  (s) => s !== 'Auto-Detect from Video / Camera'
);

const DISMISSAL_OPTIONS: Array<{ id: DismissalType; label: string }> = [
  { id: 'BOWLED', label: 'Bowled' },
  { id: 'LBW', label: 'LBW' },
  { id: 'CAUGHT', label: 'Caught' },
  { id: 'EDGED', label: 'Edged Behind' },
  { id: 'STUMPED', label: 'Stumped' },
  { id: 'RUN_OUT', label: 'Run Out' },
];

export const VideoConnectionStage: React.FC<VideoConnectionStageProps> = ({
  handedness,
  activeStumps,
  onChangeActiveStumps,
  contacts,
  selectedContact,
  pendingPreview,
  onStagePreviewPoint,
  onUpdatePendingMeta,
  onUpdateContactMeta,
  onCommitPendingPreview,
  onDiscardPendingPreview,
  onToggleLockContact,
  onClearSelection,
  onVideoUrlChange,
  onVideoTrimChange,
  seekRequest,
  onOpen3DPitch,
  onOpenMatchupStudio,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [videoUrl, setVideoUrl] = useState<string>('');
  const [videoName, setVideoName] = useState<string>('Demo Delivery Clip');
  const [recentVideos, setRecentVideos] = useState<RecentVideoClip[]>([]);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(2.0);
  const [playbackRate, setPlaybackRate] = useState<number>(0.25);

  const [isTrimOpen, setIsTrimOpen] = useState<boolean>(false);
  const [trimStart, setTrimStart] = useState<number>(0);
  const [trimEnd, setTrimEnd] = useState<number>(2.0);
  const hasCustomTrimRef = useRef<boolean>(false);
  const [showFilmstrip, setShowFilmstrip] = useState<boolean>(true);

  const [clickMode, setClickMode] = useState<ClickMode>('MANUAL_BOUNCE');
  const [stumpEditAction, setStumpEditAction] =
    useState<StumpEditAction>('MOVE');
  const [dragHandle, setDragHandle] = useState<DragHandle>('NONE');
  // Stores the user-pointed Release Marker (R) from any bowling angle
  const [stagedReleaseDraft, setStagedReleaseDraft] = useState<{
    releasePoint: NormalizedPoint;
    releaseTimestampSec: number;
  } | null>(null);
  // Stores the user-pointed Bounce Marker before (or while) pointing the Contact/Shot point
  const [stagedBounceDraft, setStagedBounceDraft] = useState<{
    bouncePoint: NormalizedPoint;
    bounceLengthM: number;
    bounceTimestampSec: number;
  } | null>(null);
  const dragStartRef = useRef<{
    startNorm: NormalizedPoint;
    startBackW: number;
    startBackH: number;
    startFrontW: number;
    startFrontH: number;
    directCorner: boolean;
  } | null>(null);
  const [showOverlay, setShowOverlay] = useState<boolean>(true);
  const [showCalibrationGrid, setShowCalibrationGrid] =
    useState<boolean>(false);
  const [stumpOpacity, setStumpOpacity] = useState<number>(75);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Precision Loupe Magnifier (Follows cursor with 3.2x zoom and crosshair reticle)
  const [showLoupe, setShowLoupe] = useState<boolean>(true);
  const [isHoveringVideo, setIsHoveringVideo] = useState<boolean>(false);
  const [pointerPos, setPointerPos] = useState<{
    stageX: number;
    stageY: number;
    normX: number;
    normY: number;
  } | null>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Full Canvas Zoom & Panning
  const [canvasZoom, setCanvasZoom] = useState<number>(1.0);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [isPanMode, setIsPanMode] = useState<boolean>(false);
  const [isDraggingPan, setIsDraggingPan] = useState<boolean>(false);
  const panStartRef = useRef<{
    clientX: number;
    clientY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);

  // Automated V-Inflection Bounce Scanner & Hybrid Auto-Track Engine
  const [isAnalyzingBounce, setIsAnalyzingBounce] = useState<boolean>(false);
  const [isAutoTrackingBall, setIsAutoTrackingBall] = useState<boolean>(false);
  const [autoTrackStatusText, setAutoTrackStatusText] = useState<string>('');
  const [autoTrackProgressPct, setAutoTrackProgressPct] = useState<number>(0);
  const [liveStreamingWaypoints, setLiveStreamingWaypoints] = useState<
    TrackedBallFramePoint[]
  >([]);
  const [isAutoFittingCorridor, setIsAutoFittingCorridor] =
    useState<boolean>(false);
  const [bounceDetectionInfo, setBounceDetectionInfo] = useState<{
    method: 'OPTICAL_V_POINT' | 'TRAJECTORY_PHYSICS_FALLBACK';
    confidence: number;
    lengthM: number;
  } | null>(null);

  const [filmstripFrames, setFilmstripFrames] = useState<FilmstripFrame[]>([]);

  const [videoDims, setVideoDims] = useState({ width: 960, height: 540 });
  const [stageDims, setStageDims] = useState({ width: 800, height: 450 });

  const registerRecentVideo = (
    name: string,
    url: string,
    durSec?: number,
    tStart?: number,
    tEnd?: number
  ) => {
    setRecentVideos((prev) => {
      const existing = prev.find((item) => item.url === url || item.name === name);
      const entry: RecentVideoClip = {
        id: existing?.id || `clip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        url,
        durationSec: durSec ?? existing?.durationSec ?? 2.0,
        trimStartSec: tStart !== undefined ? tStart : existing?.trimStartSec ?? 0,
        trimEndSec:
          tEnd !== undefined
            ? tEnd
            : durSec !== undefined
            ? durSec
            : existing?.trimEndSec ?? existing?.durationSec ?? 2.0,
        addedAt: Date.now(),
      };
      const filtered = prev.filter((item) => item.url !== url && item.name !== name);
      const next = [entry, ...filtered];
      // Keep last 5 videos in session; revoke blob URLs of evicted clips
      if (next.length > 5) {
        const evicted = next.slice(5);
        evicted.forEach((ev) => {
          if (ev.url.startsWith('blob:') && ev.url !== url) {
            try {
              URL.revokeObjectURL(ev.url);
            } catch {
              // ignore
            }
          }
        });
      }
      return next.slice(0, 5);
    });
  };

  // Generate clean synthetic demo clip
  const generateSyntheticDemoClip = async () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 960;
      canvas.height = 540;
      const ctx = canvas.getContext('2d');
      if (
        !ctx ||
        typeof canvas.captureStream !== 'function' ||
        typeof MediaRecorder === 'undefined'
      ) {
        return;
      }

      const stream = canvas.captureStream(30);
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : MediaRecorder.isTypeSupported('video/webm')
        ? 'video/webm'
        : '';
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      const donePromise = new Promise<string>((resolve) => {
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
          resolve(URL.createObjectURL(blob));
        };
      });

      recorder.start();

      const totalFrames = 34;
      const w = canvas.width;
      const h = canvas.height;

      for (let f = 0; f < totalFrames; f++) {
        const t = f / (totalFrames - 1);
        const bounceT = 11 / (totalFrames - 1);
        const impactT = 20 / (totalFrames - 1);

        const bx = w * 0.48;
        const by = h * 0.57;
        const fx = w * 0.52;
        const fy = h * 0.82;

        // Stadium sky & outfield
        ctx.fillStyle = '#080D18';
        ctx.fillRect(0, 0, w, h * 0.32);
        ctx.fillStyle = '#0C231B';
        ctx.fillRect(0, h * 0.32, w, h * 0.68);

        // 22-yard pitch turf strip
        ctx.fillStyle = '#4B3C2C';
        ctx.beginPath();
        ctx.moveTo(bx - 76, by - 18);
        ctx.lineTo(bx + 76, by - 18);
        ctx.lineTo(fx + 185, h);
        ctx.lineTo(fx - 185, h);
        ctx.closePath();
        ctx.fill();

        // Popping & bowling creases
        ctx.strokeStyle = 'rgba(241, 245, 249, 0.82)';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(bx - 84, by);
        ctx.lineTo(bx + 84, by);
        ctx.moveTo(bx - 106, by + 44);
        ctx.lineTo(bx + 106, by + 44);
        ctx.stroke();

        // Striker stumps
        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = 2.5;
        for (const dx of [-12, 0, 12]) {
          ctx.beginPath();
          ctx.moveTo(bx + dx, by);
          ctx.lineTo(bx + dx, by - 51);
          ctx.stroke();
        }

        // Batter silhouette
        const hipX = bx + 14;
        const hipY = by - 52;
        const shX = hipX - 6;
        const shY = hipY - 46;

        ctx.strokeStyle = '#CBD5E1';
        ctx.lineWidth = 9;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(hipX + 6, hipY);
        ctx.lineTo(bx + 18, by - 2);
        ctx.moveTo(hipX - 5, hipY);
        ctx.lineTo(bx - 4, by + 22);
        ctx.stroke();

        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.moveTo(hipX, hipY);
        ctx.lineTo(shX, shY);
        ctx.stroke();

        const swingAngle =
          t < impactT
            ? -1.05 + (t / impactT) * 1.28
            : 0.23 + ((t - impactT) / (1 - impactT)) * 0.85;

        const handsX = shX - 8 + Math.sin(swingAngle) * 19;
        const handsY = shY + 23 + Math.cos(swingAngle) * 11;
        const batTipX = handsX - Math.sin(swingAngle) * 62;
        const batTipY = handsY + Math.cos(swingAngle) * 62;

        ctx.strokeStyle = '#FDE68A';
        ctx.lineWidth = 8.5;
        ctx.beginPath();
        ctx.moveTo(handsX, handsY);
        ctx.lineTo(batTipX, batTipY);
        ctx.stroke();

        // Ball flight
        const relX = fx - 14;
        const relY = fy - 58;
        const bncX = bx - 9 + (fx - bx) * 0.36;
        const bncY = by + (fy - by) * 0.36;
        const contactX = bx - 12;
        const contactY = by - 14;

        let ballX = contactX;
        let ballY = contactY;
        if (t <= bounceT) {
          const p = t / bounceT;
          ballX = relX + (bncX - relX) * p;
          ballY = relY + (bncY - relY) * p;
        } else if (t <= impactT) {
          const p = (t - bounceT) / (impactT - bounceT);
          ballX = bncX + (contactX - bncX) * p;
          ballY = bncY + (contactY - bncY) * p;
        } else {
          const ep = (t - impactT) / (1 - impactT);
          ballX = contactX - ep * 155;
          ballY = contactY + ep * 62;
        }

        ctx.fillStyle = '#EF4444';
        ctx.beginPath();
        ctx.arc(ballX, ballY, 6.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.4;
        ctx.stroke();

        await new Promise((r) => setTimeout(r, 15));
      }

      recorder.stop();
      const url = await donePromise;
      setVideoUrl(url);
      registerRecentVideo('Demo Delivery Clip', url, 1.1, 0, 1.1);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    generateSyntheticDemoClip();
  }, []);

  useEffect(() => {
    if (videoUrl && onVideoUrlChange) {
      onVideoUrlChange(videoUrl);
    }
  }, [videoUrl, onVideoUrlChange]);

  useEffect(() => {
    if (onVideoTrimChange) {
      onVideoTrimChange(
        trimStart,
        trimEnd,
        duration,
        Boolean(hasCustomTrimRef.current || trimStart > 0.01 || trimEnd < duration - 0.01)
      );
    }
  }, [trimStart, trimEnd, duration, onVideoTrimChange]);

  const buildFilmstripForWindow = async (startSec: number, endSec: number) => {
    if (!videoUrl) return;
    try {
      const res = await generateSwingFilmstrip(videoUrl, startSec, endSec, 8);
      setFilmstripFrames(res.frames);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!videoUrl) return;
    buildFilmstripForWindow(trimStart, trimEnd);
  }, [videoUrl]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const updateSize = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setStageDims({ width: r.width, height: r.height });
      }
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isFullscreen]);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullscreen]);

  // Playback loop sync bounded strictly by [trimStart, trimEnd]
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    let rafId = 0;
    const syncLoop = () => {
      if (v && !v.paused) {
        setCurrentTime(v.currentTime);
        if (v.currentTime >= trimEnd) {
          v.pause();
          v.currentTime = trimStart;
          setCurrentTime(trimStart);
          setIsPlaying(false);
        } else {
          rafId = window.requestAnimationFrame(syncLoop);
        }
      }
    };

    if (isPlaying) {
      rafId = window.requestAnimationFrame(syncLoop);
    }

    const handleTime = () => setCurrentTime(v.currentTime);
    v.addEventListener('timeupdate', handleTime);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      v.removeEventListener('timeupdate', handleTime);
    };
  }, [trimStart, trimEnd, isPlaying]);

  useEffect(() => {
    if (!seekRequest || !videoRef.current) return;
    const v = videoRef.current;
    v.pause();
    setIsPlaying(false);
    v.currentTime = clamp(seekRequest.timestampSec, 0, Math.max(0.1, duration));
    setCurrentTime(v.currentTime);
  }, [seekRequest, duration]);

  // Automatically clear all delivery marks and reset to Step 1 (Point Bounce)
  // whenever a new delivery is saved to the session ledger.
  const prevContactsLenRef = useRef<number>(contacts.length);
  useEffect(() => {
    if (contacts.length > prevContactsLenRef.current) {
      setStagedReleaseDraft(null);
      setStagedBounceDraft(null);
      setLiveStreamingWaypoints([]);
      setBounceDetectionInfo(null);
      setClickMode('MANUAL_BOUNCE');
    }
    prevContactsLenRef.current = contacts.length;
  }, [contacts.length]);

  const isEditingUnlockedContact = Boolean(
    selectedContact && selectedContact.isLocked === false && !pendingPreview
  );

  const activeImpactPoint: NormalizedPoint | null = pendingPreview
    ? pendingPreview.videoPoint
    : stagedBounceDraft && !isEditingUnlockedContact
    ? null
    : selectedContact
    ? selectedContact.videoPoint
    : null;

  const contentRect = getVideoContentRect(
    stageDims.width,
    stageDims.height,
    videoDims.width,
    videoDims.height
  );

  const clientToNormalized = (
    clientX: number,
    clientY: number
  ): NormalizedPoint | null => {
    const el = stageRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();

    // Map screen click into stage coordinates taking canvasZoom & panOffset into account
    const stageX = (clientX - rect.left - panOffset.x) / canvasZoom;
    const stageY = (clientY - rect.top - panOffset.y) / canvasZoom;

    const rx = stageX - contentRect.left;
    const ry = stageY - contentRect.top;
    return {
      x: clamp(
        Number((rx / Math.max(1, contentRect.width)).toFixed(4)),
        0.01,
        0.99
      ),
      y: clamp(
        Number((ry / Math.max(1, contentRect.height)).toFixed(4)),
        0.01,
        0.99
      ),
    };
  };

  const drawLoupeCanvas = (norm: NormalizedPoint) => {
    const canvas = loupeCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !video.videoWidth || !video.videoHeight) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = 150;
    canvas.width = size;
    canvas.height = size;

    const zoom = 3.2;
    const cropW =
      (video.videoWidth * (size / Math.max(1, contentRect.width))) / zoom;
    const cropH =
      (video.videoHeight * (size / Math.max(1, contentRect.height))) / zoom;

    const centerVidX = norm.x * video.videoWidth;
    const centerVidY = norm.y * video.videoHeight;

    const sx = clamp(
      centerVidX - cropW / 2,
      0,
      Math.max(0, video.videoWidth - cropW)
    );
    const sy = clamp(
      centerVidY - cropH / 2,
      0,
      Math.max(0, video.videoHeight - cropH)
    );

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();

    ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, size, size);

    // Crosshair reticle
    const cx = size / 2;
    const cy = size / 2;

    ctx.strokeStyle = '#22D3EE';
    ctx.lineWidth = 1.2;

    ctx.beginPath();
    ctx.moveTo(6, cy);
    ctx.lineTo(cx - 5, cy);
    ctx.moveTo(cx + 5, cy);
    ctx.lineTo(size - 6, cy);

    ctx.moveTo(cx, 6);
    ctx.lineTo(cx, cy - 5);
    ctx.moveTo(cx, cy + 5);
    ctx.lineTo(cx, size - 6);
    ctx.stroke();

    // Fine tick marks
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.65)';
    ctx.lineWidth = 1;
    for (const d of [-34, -18, 18, 34]) {
      ctx.beginPath();
      ctx.moveTo(cx + d, cy - 3.5);
      ctx.lineTo(cx + d, cy + 3.5);
      ctx.moveTo(cx - 3.5, cy + d);
      ctx.moveTo(cx + 3.5, cy + d);
      ctx.stroke();
    }

    // Center aperture target ring
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.restore();
  };

  const activeImpactTimestampSec: number = pendingPreview
    ? pendingPreview.timestampSec
    : selectedContact
    ? selectedContact.timestampSec
    : currentTime;

  const userPointedBounceForAuto =
    stagedBounceDraft?.bouncePoint ||
    pendingPreview?.bouncePoint ||
    (!pendingPreview && selectedContact?.bouncePoint) ||
     null;

  const activeAutoBounce = useMemo(() => {
    if (!activeImpactPoint) return null;
    return autoDetectBounceFromContactPoint(
      activeImpactPoint,
      activeStumps,
      handedness,
      activeImpactTimestampSec,
      undefined,
      userPointedBounceForAuto
    );
  }, [
    activeImpactPoint,
    activeStumps,
    handedness,
    activeImpactTimestampSec,
    userPointedBounceForAuto,
  ]);

  const resolvedBouncePoint: NormalizedPoint | null = useMemo(() => {
    if (stagedBounceDraft?.bouncePoint) return stagedBounceDraft.bouncePoint;
    if (pendingPreview?.bouncePoint) return pendingPreview.bouncePoint;
    if (!pendingPreview && selectedContact?.bouncePoint) {
      return selectedContact.bouncePoint;
    }
    return activeAutoBounce?.bouncePoint || null;
  }, [stagedBounceDraft, pendingPreview, selectedContact, activeAutoBounce]);

  const activeProjection = useMemo(() => {
    if (!activeImpactPoint) return null;
    return calculateImaginaryStumpPoint(
      activeImpactPoint,
      activeStumps,
      handedness,
      resolvedBouncePoint
    );
  }, [activeImpactPoint, activeStumps, handedness, resolvedBouncePoint]);

  const isUnseenRelease =
    (activeStumps.releaseVisibilityMode || 'UNSEEN_RELEASE') ===
    'UNSEEN_RELEASE';
  const activeBowlerWicketSide =
    activeStumps.bowlerWicketSide || 'OVER_THE_WICKET';
  const activeBowlerSpeedType = activeStumps.bowlerSpeedType || 'PACE';

  const resolvedReleasePoint: NormalizedPoint | null = useMemo(() => {
    if (isUnseenRelease) return null;
    if (stagedReleaseDraft?.releasePoint) return stagedReleaseDraft.releasePoint;
    if (pendingPreview?.releasePoint) return pendingPreview.releasePoint;
    if (!pendingPreview && selectedContact?.releasePoint) {
      return selectedContact.releasePoint;
    }
    return activeAutoBounce?.releasePoint || null;
  }, [
    isUnseenRelease,
    stagedReleaseDraft,
    pendingPreview,
    selectedContact,
    activeAutoBounce,
  ]);

  const resolvedBounceLengthM: number = useMemo(() => {
    if (resolvedBouncePoint) {
      return projectVideoBounceTo3DPitch(
        resolvedBouncePoint,
        activeStumps,
        resolvedReleasePoint,
        activeImpactPoint
      ).bounceDistanceFromStumpsM;
    }
    if (
      stagedBounceDraft &&
      typeof stagedBounceDraft.bounceLengthM === 'number' &&
      stagedBounceDraft.bounceLengthM > 0
    ) {
      return stagedBounceDraft.bounceLengthM;
    }
    if (
      pendingPreview &&
      typeof pendingPreview.bounceLengthM === 'number' &&
      pendingPreview.bounceLengthM > 0
    ) {
      return pendingPreview.bounceLengthM;
    }
    if (
      !pendingPreview &&
      selectedContact &&
      typeof selectedContact.bounceLengthM === 'number' &&
      selectedContact.bounceLengthM > 0
    ) {
      return selectedContact.bounceLengthM;
    }
    return activeAutoBounce?.bounceDistanceFromStumpsM ?? 5.8;
  }, [
    stagedBounceDraft,
    pendingPreview,
    selectedContact,
    resolvedBouncePoint,
    resolvedReleasePoint,
    activeImpactPoint,
    activeStumps,
    activeAutoBounce,
  ]);

  const activeSpeedKph: number | undefined = useMemo(() => {
    if (pendingPreview?.calibratedSpeedKph) {
      return pendingPreview.calibratedSpeedKph;
    }
    if (!pendingPreview && selectedContact?.calibratedSpeedKph) {
      return selectedContact.calibratedSpeedKph;
    }
    return undefined;
  }, [pendingPreview, selectedContact]);

  const activeTrajectoryPred = useMemo(() => {
    if (!activeProjection) return null;
    return calculateBallTrajectory(
      activeStumps,
      activeProjection,
      handedness,
      'AUTO_PITCH',
      undefined,
      resolvedBounceLengthM,
      activeSpeedKph,
      {
        releasePoint: resolvedReleasePoint || undefined,
        bouncePoint: resolvedBouncePoint || undefined,
        contactPoint: activeImpactPoint || undefined,
      }
    );
  }, [
    activeStumps,
    activeProjection,
    handedness,
    resolvedBounceLengthM,
    activeSpeedKph,
    resolvedReleasePoint,
    resolvedBouncePoint,
    activeImpactPoint,
  ]);

  const activeVideoTrajectory2D = useMemo(() => {
    if (!activeTrajectoryPred) return null;
    return project3DTrajectoryToVideo(activeTrajectoryPred, activeStumps, {
      releasePoint: resolvedReleasePoint || undefined,
      bouncePoint: resolvedBouncePoint || undefined,
      contactPoint: activeImpactPoint || undefined,
    });
  }, [
    activeTrajectoryPred,
    activeStumps,
    resolvedReleasePoint,
    resolvedBouncePoint,
    activeImpactPoint,
  ]);

  const activeTrackedWaypoints: TrackedBallFramePoint[] = useMemo(() => {
    if (isAutoTrackingBall && liveStreamingWaypoints.length > 0) {
      return liveStreamingWaypoints;
    }
    if (pendingPreview?.trackedWaypoints?.length) {
      return pendingPreview.trackedWaypoints;
    }
    if (!pendingPreview && selectedContact?.trackedWaypoints?.length) {
      return selectedContact.trackedWaypoints;
    }
    // Synthesize frame-synced waypoints from R -> B -> C (or B -> C when Unseen Release is active)
    if (resolvedBouncePoint && activeImpactPoint) {
      const bSec =
        stagedBounceDraft?.bounceTimestampSec ??
        pendingPreview?.bounceTimestampSec ??
        selectedContact?.bounceTimestampSec ??
        Math.max(0, activeImpactTimestampSec - 0.14);
      const cSec = Math.max(bSec + 0.04, activeImpactTimestampSec);
      const synth: TrackedBallFramePoint[] = [];

      if (resolvedReleasePoint) {
        const rSec =
          stagedReleaseDraft?.releaseTimestampSec ??
          pendingPreview?.releaseTimestampSec ??
          selectedContact?.releaseTimestampSec ??
          Math.max(0, bSec - 0.3);
        const stepsPre = 6;
        for (let i = 0; i <= stepsPre; i++) {
          const u = i / stepsPre;
          synth.push({
            frameIndex: i,
            timestampSec: Number((rSec + (bSec - rSec) * u).toFixed(3)),
            point: {
              x:
                resolvedReleasePoint.x +
                (resolvedBouncePoint.x - resolvedReleasePoint.x) * u,
              y:
                resolvedReleasePoint.y +
                (resolvedBouncePoint.y - resolvedReleasePoint.y) * u,
            },
            phase:
              i === 0 ? 'RELEASE' : i === stepsPre ? 'BOUNCE' : 'PRE_BOUNCE',
            confidencePct: 92,
          });
        }
      } else {
        synth.push({
          frameIndex: 0,
          timestampSec: Number(bSec.toFixed(3)),
          point: resolvedBouncePoint,
          phase: 'BOUNCE',
          confidencePct: 94,
        });
      }

      const baseIdx = synth.length - 1;
      const stepsPost = 5;
      for (let j = 1; j <= stepsPost; j++) {
        const u = j / stepsPost;
        synth.push({
          frameIndex: baseIdx + j,
          timestampSec: Number((bSec + (cSec - bSec) * u).toFixed(3)),
          point: {
            x:
              resolvedBouncePoint.x +
              (activeImpactPoint.x - resolvedBouncePoint.x) * u,
            y:
              resolvedBouncePoint.y +
              (activeImpactPoint.y - resolvedBouncePoint.y) * u,
          },
          phase: j === stepsPost ? 'CONTACT' : 'POST_BOUNCE',
          confidencePct: 92,
        });
      }
      return synth;
    }
    return [];
  }, [
    isAutoTrackingBall,
    liveStreamingWaypoints,
    pendingPreview,
    selectedContact,
    resolvedReleasePoint,
    resolvedBouncePoint,
    activeImpactPoint,
    stagedReleaseDraft,
    stagedBounceDraft,
    activeImpactTimestampSec,
  ]);

  // Live Frame-Synced Ball Lock Reticle & Progressive Trail at currentTime
  const activeBallLockAtCurrentFrame = useMemo(() => {
    if (activeTrackedWaypoints.length === 0) return null;
    const wps = activeTrackedWaypoints;
    if (wps.length === 1) {
      return {
        point: wps[0].point,
        phase: wps[0].phase,
        trailPoints: [wps[0].point],
      };
    }

    const t = currentTime;
    const first = wps[0];
    const last = wps[wps.length - 1];

    if (t <= first.timestampSec) {
      return {
        point: first.point,
        phase: first.phase,
        trailPoints: [first.point],
      };
    }

    if (t >= last.timestampSec) {
      const trail = wps.map((w) => w.point);
      // If slightly past contact and we have a stump projection, interpolate post-contact continuation for 0.12s
      if (
        activeVideoTrajectory2D?.stumpIntersection2D &&
        t <= last.timestampSec + 0.14
      ) {
        const uPost = clamp((t - last.timestampSec) / 0.12, 0, 1);
        const postPt = {
          x:
            last.point.x +
            (activeVideoTrajectory2D.stumpIntersection2D.x - last.point.x) *
              uPost,
          y:
            last.point.y +
            (activeVideoTrajectory2D.stumpIntersection2D.y - last.point.y) *
              uPost,
        };
        return {
          point: postPt,
          phase: 'CONTACT' as const,
          trailPoints: [...trail, postPt],
        };
      }
      return {
        point: last.point,
        phase: last.phase,
        trailPoints: trail,
      };
    }

    const trailPoints: NormalizedPoint[] = [first.point];
    for (let i = 0; i < wps.length - 1; i++) {
      const a = wps[i];
      const b = wps[i + 1];
      if (t >= a.timestampSec && t <= b.timestampSec) {
        const dt = Math.max(0.001, b.timestampSec - a.timestampSec);
        const u = clamp((t - a.timestampSec) / dt, 0, 1);
        const interpPt = {
          x: a.point.x + (b.point.x - a.point.x) * u,
          y: a.point.y + (b.point.y - a.point.y) * u,
        };
        trailPoints.push(interpPt);
        return {
          point: interpPt,
          phase: u < 0.5 ? a.phase : b.phase,
          trailPoints,
        };
      }
      trailPoints.push(b.point);
    }

    return {
      point: last.point,
      phase: last.phase,
      trailPoints: wps.map((w) => w.point),
    };
  }, [activeTrackedWaypoints, currentTime, activeVideoTrajectory2D]);

  const activeReleaseAngleLabel: string | undefined = useMemo(() => {
    if (pendingPreview?.bowlerReleaseAngleLabel) {
      return pendingPreview.bowlerReleaseAngleLabel;
    }
    if (!pendingPreview && selectedContact?.bowlerReleaseAngleLabel) {
      return selectedContact.bowlerReleaseAngleLabel;
    }
    return undefined;
  }, [pendingPreview, selectedContact]);

  const pitchCorridorHomography = useMemo(
    () => computePitchCorridorHomography(activeStumps),
    [activeStumps]
  );

  const cameraTelemetry: CameraDistanceTelemetry = useMemo(
    () => calculateCameraStumpDistances(activeStumps, resolvedReleasePoint),
    [activeStumps, resolvedReleasePoint]
  );

  // Active shot, out status, dismissal type, and note for either PendingPreview or SelectedContact
  const activeShotName = pendingPreview
    ? pendingPreview.selectedShotName || ''
    : selectedContact?.selectedShotName ||
      selectedContact?.aiShotAnalysis?.playedShotName ||
      '';
  const activeIsOut = pendingPreview
    ? Boolean(pendingPreview.isOut)
    : Boolean(selectedContact?.isOut);
  const activeDismissalType: DismissalType =
    (pendingPreview
      ? pendingPreview.dismissalType
      : selectedContact?.dismissalType) || 'BOWLED';
  const activeBallNote = pendingPreview
    ? pendingPreview.ballNote || ''
    : selectedContact?.ballNote || '';

  const updateActiveBallMeta = (patch: {
    selectedShotName?: string;
    isOut?: boolean;
    dismissalType?: DismissalType;
    ballNote?: string;
  }) => {
    if (pendingPreview && onUpdatePendingMeta) {
      onUpdatePendingMeta(patch);
    } else if (selectedContact && onUpdateContactMeta) {
      onUpdateContactMeta(selectedContact.id, patch);
    }
  };

  const hasManualStumpLineRef = useRef<boolean>(false);
  const [isStumpLineAutoSuggested, setIsStumpLineAutoSuggested] =
    useState<boolean>(true);

  // Suggests a realistic 2D Stump Line (frontStumps & poppingCreasePoint) from the marked Striker Stumps
  const computeSuggestedStumpLine = useCallback(
    (
      base: NormalizedPoint,
      stumpW: number,
      stumpH: number,
      cameraAngle: PlantedStumpsConfig['cameraAngle'] = activeStumps.cameraAngle
    ): {
      suggestedFrontStumps: NormalizedPoint;
      suggestedPoppingCrease: NormalizedPoint;
      suggestedFrontW: number;
      suggestedFrontH: number;
    } => {
      // Sample video frame turf/crease below or above base if video is ready
      let opticalSlopeX = (0.5 - base.x) * 0.22;
      const v = videoRef.current;
      if (v && v.videoWidth > 0 && v.videoHeight > 0) {
        try {
          const c = document.createElement('canvas');
          c.width = 96;
          c.height = 54;
          const ctx = c.getContext('2d');
          if (ctx) {
            ctx.drawImage(v, 0, 0, c.width, c.height);
            const img = ctx.getImageData(0, 0, c.width, c.height).data;
            const startY = Math.round(clamp(base.y + 0.04, 0.05, 0.88) * c.height);
            const endY = Math.round(clamp(base.y + 0.28, 0.12, 0.95) * c.height);
            const minX = Math.round(clamp(base.x - 0.22, 0.04, 0.96) * c.width);
            const maxX = Math.round(clamp(base.x + 0.22, 0.04, 0.96) * c.width);
            let weightedXSum = 0;
            let weightTotal = 0;
            for (let py = startY; py <= endY; py += 2) {
              for (let px = minX; px <= maxX; px += 2) {
                const idx = (py * c.width + px) * 4;
                const r = img[idx];
                const g = img[idx + 1];
                const b = img[idx + 2];
                // Pitch turf is typically brighter & warmer/tan compared to dark/green outfield
                const luma = 0.299 * r + 0.587 * g + 0.114 * b;
                const tanScore = Math.max(0, r - b * 0.85) + luma * 0.35;
                const distPenalty =
                  1 - Math.min(1, Math.abs(px / c.width - base.x) / 0.24);
                const w = Math.max(0, tanScore * distPenalty);
                weightedXSum += (px / c.width) * w;
                weightTotal += w;
              }
            }
            if (weightTotal > 10) {
              const centroidX = weightedXSum / weightTotal;
              const rawDeltaX = clamp(centroidX - base.x, -0.14, 0.14);
              opticalSlopeX = rawDeltaX * 0.65 + (0.5 - base.x) * 0.12;
            }
          }
        } catch {
          // fallback to perspective geometry
        }
      }

      const spanY =
        cameraAngle === 'BEHIND_BATTER'
          ? -clamp(stumpH * 2.15, 0.18, 0.34)
          : cameraAngle === 'SIDE_DIAGONAL'
          ? clamp(stumpH * 1.65, 0.14, 0.28)
          : clamp(stumpH * 2.45, 0.22, 0.38);

      const spanX =
        cameraAngle === 'SIDE_DIAGONAL'
          ? clamp(0.24, 0.16, 0.32)
          : clamp(opticalSlopeX, -0.16, 0.16);

      const fx = Number(clamp(base.x + spanX, 0.06, 0.94).toFixed(4));
      const fy = Number(clamp(base.y + spanY, 0.08, 0.95).toFixed(4));

      const dx = fx - base.x;
      const dy = fy - base.y;
      const len = Math.hypot(dx, dy);
      const ux = len > 0.001 ? dx / len : 0;
      const uy = len > 0.001 ? dy / len : 1;
      const creaseDist = clamp(stumpH * 0.38, 0.022, 0.16);

      const suggestedPoppingCrease: NormalizedPoint = {
        x: Number(clamp(base.x + ux * creaseDist, 0.03, 0.97).toFixed(4)),
        y: Number(clamp(base.y + uy * creaseDist, 0.03, 0.97).toFixed(4)),
      };

      // Perspective-scaled bowler end width & height
      const suggestedFrontW = Number(
        clamp(stumpW * 1.45, 0.02, 0.14).toFixed(4)
      );
      const suggestedFrontH = Number(
        clamp(stumpH * 1.38, 0.05, 0.26).toFixed(4)
      );

      return {
        suggestedFrontStumps: { x: fx, y: fy },
        suggestedPoppingCrease,
        suggestedFrontW,
        suggestedFrontH,
      };
    },
    [activeStumps.cameraAngle]
  );

  const handleApplySuggestedStumpLine = useCallback(() => {
    const suggestion = computeSuggestedStumpLine(
      activeStumps.backStumps,
      activeStumps.backStumpWidth,
      activeStumps.backStumpHeight,
      activeStumps.cameraAngle
    );
    hasManualStumpLineRef.current = false;
    setIsStumpLineAutoSuggested(true);
    onChangeActiveStumps({
      ...activeStumps,
      frontStumps: suggestion.suggestedFrontStumps,
      poppingCreasePoint: suggestion.suggestedPoppingCrease,
      frontStumpWidth: suggestion.suggestedFrontW,
      frontStumpHeight: suggestion.suggestedFrontH,
    });
  }, [activeStumps, computeSuggestedStumpLine, onChangeActiveStumps]);

  // Dragging handles or dragging directly on the video canvas
  useEffect(() => {
    if (dragHandle === 'NONE') return;

    const onMove = (e: PointerEvent) => {
      const norm = clientToNormalized(e.clientX, e.clientY);
      if (!norm) return;

      if (dragHandle === 'BACK_STUMPS') {
        const dxShift = norm.x - activeStumps.backStumps.x;
        const dyShift = norm.y - activeStumps.backStumps.y;
        const prevCal = resolveFourPointCalibration(activeStumps);

        if (!hasManualStumpLineRef.current) {
          const suggestion = computeSuggestedStumpLine(
            norm,
            activeStumps.backStumpWidth,
            activeStumps.backStumpHeight,
            activeStumps.cameraAngle
          );
          setIsStumpLineAutoSuggested(true);
          onChangeActiveStumps({
            ...activeStumps,
            backStumps: norm,
            stumpTopPoint: {
              x: norm.x,
              y: Number(
                clamp(norm.y - activeStumps.backStumpHeight, 0.03, 0.94).toFixed(
                  4
                )
              ),
            },
            frontStumps: suggestion.suggestedFrontStumps,
            poppingCreasePoint: suggestion.suggestedPoppingCrease,
          });
        } else {
          // If the user already customized the stump line or placed bowler stumps,
          // in Arrow Mode shift the arrow vector with the stumps; in Both Stumps mode keep bowler stumps anchored
          const nextFrontStumps =
            activeStumps.anchorMode === 'CREASE_ARROW'
              ? {
                  x: Number(
                    clamp(activeStumps.frontStumps.x + dxShift, 0.04, 0.96).toFixed(4)
                  ),
                  y: Number(
                    clamp(activeStumps.frontStumps.y + dyShift, 0.04, 0.96).toFixed(4)
                  ),
                }
              : activeStumps.frontStumps;
          onChangeActiveStumps({
            ...activeStumps,
            backStumps: norm,
            frontStumps: nextFrontStumps,
            stumpTopPoint: {
              x: norm.x,
              y: Number(
                clamp(norm.y - activeStumps.backStumpHeight, 0.03, 0.94).toFixed(
                  4
                )
              ),
            },
            poppingCreasePoint: {
              x: Number(
                clamp(prevCal.p3PoppingCrease.x + dxShift, 0.03, 0.97).toFixed(4)
              ),
              y: Number(
                clamp(prevCal.p3PoppingCrease.y + dyShift, 0.03, 0.97).toFixed(4)
              ),
            },
          });
        }
      } else if (dragHandle === 'BACK_STUMPS_RESIZE') {
        const session = dragStartRef.current;
        const base = activeStumps.backStumps;
        let nextW = activeStumps.backStumpWidth;
        let nextH = activeStumps.backStumpHeight;

        if (session && !session.directCorner) {
          const dX = norm.x - session.startNorm.x;
          const dY = session.startNorm.y - norm.y;
          nextW = Number(
            clamp(session.startBackW + dX * 0.65, 0.014, 0.14).toFixed(4)
          );
          nextH = Number(
            clamp(session.startBackH + dY * 0.95, 0.035, 0.28).toFixed(4)
          );
        } else {
          nextW = Number(
            clamp(Math.abs(norm.x - base.x) * 2, 0.014, 0.14).toFixed(4)
          );
          nextH = Number(clamp(base.y - norm.y, 0.035, 0.28).toFixed(4));
        }

        if (!hasManualStumpLineRef.current) {
          const suggestion = computeSuggestedStumpLine(
            base,
            nextW,
            nextH,
            activeStumps.cameraAngle
          );
          setIsStumpLineAutoSuggested(true);
          onChangeActiveStumps({
            ...activeStumps,
            backStumpWidth: nextW,
            backStumpHeight: nextH,
            stumpTopPoint: {
              x: base.x,
              y: Number(clamp(base.y - nextH, 0.03, 0.94).toFixed(4)),
            },
            frontStumps: suggestion.suggestedFrontStumps,
            poppingCreasePoint: suggestion.suggestedPoppingCrease,
            frontStumpWidth: suggestion.suggestedFrontW,
            frontStumpHeight: suggestion.suggestedFrontH,
          });
        } else {
          const dx = activeStumps.frontStumps.x - base.x;
          const dy = activeStumps.frontStumps.y - base.y;
          const len = Math.hypot(dx, dy);
          const ux = len > 0.001 ? dx / len : 0;
          const uy = len > 0.001 ? dy / len : 1;
          const autoCreaseSpan = clamp(nextH * 0.38, 0.018, 0.22);

          onChangeActiveStumps({
            ...activeStumps,
            backStumpWidth: nextW,
            backStumpHeight: nextH,
            stumpTopPoint: {
              x: base.x,
              y: Number(clamp(base.y - nextH, 0.03, 0.94).toFixed(4)),
            },
            poppingCreasePoint: {
              x: Number(
                clamp(base.x + ux * autoCreaseSpan, 0.03, 0.97).toFixed(4)
              ),
              y: Number(
                clamp(base.y + uy * autoCreaseSpan, 0.03, 0.97).toFixed(4)
              ),
            },
          });
        }
      } else if (dragHandle === 'FRONT_STUMPS') {
        hasManualStumpLineRef.current = true;
        setIsStumpLineAutoSuggested(false);
        const prevCal = resolveFourPointCalibration(activeStumps);
        const prevDx = activeStumps.frontStumps.x - activeStumps.backStumps.x;
        const prevDy = activeStumps.frontStumps.y - activeStumps.backStumps.y;
        const prevLen = Math.hypot(prevDx, prevDy);
        const prevUx = prevLen > 0.001 ? prevDx / prevLen : 0;
        const prevUy = prevLen > 0.001 ? prevDy / prevLen : 1;
        const creaseSpan = clamp(
          (prevCal.p3PoppingCrease.x - activeStumps.backStumps.x) * prevUx +
            (prevCal.p3PoppingCrease.y - activeStumps.backStumps.y) * prevUy,
          0.018,
          0.22
        );
        const nextDx = norm.x - activeStumps.backStumps.x;
        const nextDy = norm.y - activeStumps.backStumps.y;
        const nextLen = Math.hypot(nextDx, nextDy);
        const nextUx = nextLen > 0.001 ? nextDx / nextLen : 0;
        const nextUy = nextLen > 0.001 ? nextDy / nextLen : 1;

        onChangeActiveStumps({
          ...activeStumps,
          frontStumps: norm,
          poppingCreasePoint: {
            x: Number(
              clamp(
                activeStumps.backStumps.x + nextUx * creaseSpan,
                0.03,
                0.97
              ).toFixed(4)
            ),
            y: Number(
              clamp(
                activeStumps.backStumps.y + nextUy * creaseSpan,
                0.03,
                0.97
              ).toFixed(4)
            ),
          },
        });
      } else if (dragHandle === 'FRONT_STUMPS_RESIZE') {
        hasManualStumpLineRef.current = true;
        setIsStumpLineAutoSuggested(false);
        const session = dragStartRef.current;
        const base = activeStumps.frontStumps;
        let nextW = activeStumps.frontStumpWidth;
        let nextH = activeStumps.frontStumpHeight;

        if (session && !session.directCorner) {
          const dX = norm.x - session.startNorm.x;
          const dY = session.startNorm.y - norm.y;
          nextW = Number(
            clamp(session.startFrontW + dX * 0.65, 0.014, 0.14).toFixed(4)
          );
          nextH = Number(
            clamp(session.startFrontH + dY * 0.95, 0.035, 0.28).toFixed(4)
          );
        } else {
          nextW = Number(
            clamp(Math.abs(norm.x - base.x) * 2, 0.014, 0.14).toFixed(4)
          );
          nextH = Number(clamp(base.y - norm.y, 0.035, 0.28).toFixed(4));
        }

        onChangeActiveStumps({
          ...activeStumps,
          frontStumpWidth: nextW,
          frontStumpHeight: nextH,
        });
      } else if (dragHandle === 'POPPING_CREASE') {
        const dx = activeStumps.frontStumps.x - activeStumps.backStumps.x;
        const dy = activeStumps.frontStumps.y - activeStumps.backStumps.y;
        const len = Math.hypot(dx, dy);
        const ux = len > 0.001 ? dx / len : 0;
        const uy = len > 0.001 ? dy / len : 1;
        const projDist = clamp(
          (norm.x - activeStumps.backStumps.x) * ux +
            (norm.y - activeStumps.backStumps.y) * uy,
          0.018,
          0.22
        );
        onChangeActiveStumps({
          ...activeStumps,
          poppingCreasePoint: {
            x: Number(
              clamp(
                activeStumps.backStumps.x + ux * projDist,
                0.03,
                0.97
              ).toFixed(4)
            ),
            y: Number(
              clamp(
                activeStumps.backStumps.y + uy * projDist,
                0.03,
                0.97
              ).toFixed(4)
            ),
          },
        });
      } else if (dragHandle === 'RELEASE_POINT') {
        const rTime = clamp(
          currentTime,
          trimStart,
          Math.max(trimStart + 0.02, trimEnd)
        );
        const currentBouncePt =
          stagedBounceDraft?.bouncePoint ??
          pendingPreview?.bouncePoint ??
          selectedContact?.bouncePoint ??
          null;
        const recalcBounceLen = currentBouncePt
          ? projectVideoBounceTo3DPitch(
              currentBouncePt,
              activeStumps,
              norm,
              activeImpactPoint
            ).bounceDistanceFromStumpsM
          : undefined;
        setStagedReleaseDraft({
          releasePoint: norm,
          releaseTimestampSec: rTime,
        });
        if (currentBouncePt && recalcBounceLen !== undefined) {
          setStagedBounceDraft((prev) =>
            prev
              ? { ...prev, bounceLengthM: recalcBounceLen }
              : {
                  bouncePoint: currentBouncePt,
                  bounceLengthM: recalcBounceLen,
                  bounceTimestampSec:
                    pendingPreview?.bounceTimestampSec ??
                    selectedContact?.bounceTimestampSec ??
                    rTime,
                }
          );
        }
        if (pendingPreview && onUpdatePendingMeta) {
          onUpdatePendingMeta({
            releasePoint: norm,
            releaseTimestampSec: rTime,
            ...(recalcBounceLen !== undefined
              ? { bounceLengthM: recalcBounceLen }
              : {}),
          });
        } else if (selectedContact && onUpdateContactMeta) {
          onUpdateContactMeta(selectedContact.id, {
            releasePoint: norm,
            releaseTimestampSec: rTime,
            ...(recalcBounceLen !== undefined
              ? { bounceLengthM: recalcBounceLen }
              : {}),
          });
        }
      } else if (dragHandle === 'BOUNCE_POINT') {
        const bProj = projectVideoBounceTo3DPitch(
          norm,
          activeStumps,
          resolvedReleasePoint,
          activeImpactPoint
        );
        const bLen = bProj.bounceDistanceFromStumpsM;
        const bTime = clamp(currentTime, trimStart, Math.max(trimStart + 0.02, trimEnd));
        setStagedBounceDraft({
          bouncePoint: norm,
          bounceLengthM: bLen,
          bounceTimestampSec: bTime,
        });
        if (pendingPreview && onUpdatePendingMeta) {
          onUpdatePendingMeta({
            bouncePoint: norm,
            bounceLengthM: bLen,
            bounceTimestampSec: bTime,
          });
        } else if (selectedContact && onUpdateContactMeta) {
          onUpdateContactMeta(selectedContact.id, {
            bouncePoint: norm,
            bounceLengthM: bLen,
            bounceTimestampSec: bTime,
          });
        }
      } else if (dragHandle === 'CONTACT_POINT') {
        const userPointedBounce =
          stagedBounceDraft?.bouncePoint ||
          pendingPreview?.bouncePoint ||
          (!pendingPreview ? selectedContact?.bouncePoint : undefined);
        const finalReleasePt = isUnseenRelease
          ? undefined
          : stagedReleaseDraft?.releasePoint ??
            pendingPreview?.releasePoint ??
            (!pendingPreview ? selectedContact?.releasePoint : undefined);
        const recalcUserBounceLen = userPointedBounce
          ? projectVideoBounceTo3DPitch(
              userPointedBounce,
              activeStumps,
              finalReleasePt,
              norm
            ).bounceDistanceFromStumpsM
          : undefined;

        const autoBnc = autoDetectBounceFromContactPoint(
          norm,
          activeStumps,
          handedness,
          activeImpactTimestampSec,
          recalcUserBounceLen,
          userPointedBounce
        );
        const bounceInfo = detectRealBounceInflection(
          videoRef.current,
          videoUrl,
          norm,
          activeImpactTimestampSec,
          activeStumps,
          handedness
        );
        const finalBouncePt = userPointedBounce || autoBnc.bouncePoint;
        const finalBounceLen =
          recalcUserBounceLen ?? autoBnc.bounceDistanceFromStumpsM;
        const resolvedRelPt = isUnseenRelease
          ? undefined
          : finalReleasePt ?? autoBnc.releasePoint;

        setBounceDetectionInfo({
          method: bounceInfo.inflectionMethod,
          confidence: userPointedBounce ? 99 : bounceInfo.confidencePct,
          lengthM: finalBounceLen,
        });

        onStagePreviewPoint({
          videoPoint: norm,
          bouncePoint: finalBouncePt,
          bounceLengthM: finalBounceLen,
          bounceTimestampSec:
            stagedBounceDraft?.bounceTimestampSec ??
            pendingPreview?.bounceTimestampSec ??
            autoBnc.bounceTimestampSec,
          bounceConfidence: userPointedBounce ? 99 : bounceInfo.confidencePct,
          bounceInflectionMethod: bounceInfo.inflectionMethod,
          releasePoint: resolvedRelPt,
          releaseTimestampSec:
            stagedReleaseDraft?.releaseTimestampSec ??
            pendingPreview?.releaseTimestampSec ??
            autoBnc.releaseTimestampSec,
          timestampSec: pendingPreview?.timestampSec ?? activeImpactTimestampSec,
          source: 'Manual Point',
          clipLabel:
            pendingPreview?.clipLabel ??
            `${videoName} @ ${activeImpactTimestampSec.toFixed(2)}s`,
          snapshotUrl:
            pendingPreview?.snapshotUrl ??
            selectedContact?.frameSnapshotUrl ??
            '',
          calibratedSpeedKph:
            pendingPreview?.calibratedSpeedKph ??
            selectedContact?.calibratedSpeedKph,
          selectedShotName:
            pendingPreview?.selectedShotName ??
            selectedContact?.selectedShotName,
          wagonWheelAngleDeg:
            pendingPreview?.wagonWheelAngleDeg ??
            selectedContact?.wagonWheelAngleDeg,
          isOut: pendingPreview?.isOut ?? selectedContact?.isOut ?? false,
          dismissalType:
            pendingPreview?.dismissalType ?? selectedContact?.dismissalType,
          ballNote: pendingPreview?.ballNote ?? selectedContact?.ballNote ?? '',
        });
      }
    };

    const onUp = () => {
      if (dragHandle === 'RELEASE_POINT') {
        // After pointing/dragging Release (R), advance to Bounce (B) if not pointed yet, else Contact (C)
        if (!stagedBounceDraft && !pendingPreview?.bouncePoint) {
          setClickMode('MANUAL_BOUNCE');
        } else if (!pendingPreview?.videoPoint) {
          setClickMode('MANUAL_CONTACT');
        }
      } else if (dragHandle === 'BOUNCE_POINT') {
        // Always advance to Step 2: Point Contact after pointing/dragging the Bounce Point
        // so the user can immediately point the Contact (or click Step 1 again to re-point Bounce)
        setClickMode('MANUAL_CONTACT');
      }
      setDragHandle('NONE');
      dragStartRef.current = null;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [
    dragHandle,
    activeStumps,
    handedness,
    activeImpactTimestampSec,
    activeImpactPoint,
    isEditingUnlockedContact,
    stagedReleaseDraft,
    stagedBounceDraft,
    pendingPreview,
    selectedContact,
    resolvedReleasePoint,
    resolvedBouncePoint,
    resolvedBounceLengthM,
    currentTime,
    trimStart,
    trimEnd,
    contentRect.left,
    contentRect.top,
    contentRect.width,
    contentRect.height,
  ]);

  const stageReleaseAtPoint = (norm: NormalizedPoint) => {
    const v = videoRef.current;
    if (v && !v.paused) {
      v.pause();
      setIsPlaying(false);
    }
    const clickTimestamp = clamp(
      currentTime,
      trimStart,
      Math.max(trimStart + 0.02, trimEnd)
    );

    if (!pendingPreview && selectedContact && selectedContact.isLocked !== false) {
      onClearSelection();
    }

    setStagedReleaseDraft({
      releasePoint: { ...norm },
      releaseTimestampSec: clickTimestamp,
    });

    const existingBouncePt =
      stagedBounceDraft?.bouncePoint ??
      pendingPreview?.bouncePoint ??
      (isEditingUnlockedContact ? selectedContact?.bouncePoint : undefined) ??
      null;
    const recalcBounceLen = existingBouncePt
      ? projectVideoBounceTo3DPitch(
          existingBouncePt,
          activeStumps,
          norm,
          activeImpactPoint
        ).bounceDistanceFromStumpsM
      : undefined;

    if (existingBouncePt && recalcBounceLen !== undefined) {
      setStagedBounceDraft((prev) =>
        prev
          ? { ...prev, bounceLengthM: recalcBounceLen }
          : {
              bouncePoint: existingBouncePt,
              bounceLengthM: recalcBounceLen,
              bounceTimestampSec:
                pendingPreview?.bounceTimestampSec ??
                selectedContact?.bounceTimestampSec ??
                clickTimestamp,
            }
      );
    }

    if (pendingPreview && onUpdatePendingMeta) {
      onUpdatePendingMeta({
        releasePoint: { ...norm },
        releaseTimestampSec: clickTimestamp,
        ...(recalcBounceLen !== undefined
          ? { bounceLengthM: recalcBounceLen }
          : {}),
      });
    } else if (
      isEditingUnlockedContact &&
      selectedContact &&
      onUpdateContactMeta
    ) {
      onUpdateContactMeta(selectedContact.id, {
        releasePoint: { ...norm },
        releaseTimestampSec: clickTimestamp,
        ...(recalcBounceLen !== undefined
          ? { bounceLengthM: recalcBounceLen }
          : {}),
      });
    }
  };

  const stageBounceAtPoint = (norm: NormalizedPoint) => {
    const v = videoRef.current;
    if (v && !v.paused) {
      v.pause();
      setIsPlaying(false);
    }
    const clickTimestamp = clamp(
      currentTime,
      trimStart,
      Math.max(trimStart + 0.02, trimEnd)
    );
    const activeRelPt =
      stagedReleaseDraft?.releasePoint ??
      pendingPreview?.releasePoint ??
      (isEditingUnlockedContact ? selectedContact?.releasePoint : null);
    const activeImpPt =
      pendingPreview?.videoPoint ??
      (isEditingUnlockedContact ? selectedContact?.videoPoint : null);

    const bProj = projectVideoBounceTo3DPitch(
      norm,
      activeStumps,
      isUnseenRelease ? null : activeRelPt,
      activeImpPt
    );
    const bLen = bProj.bounceDistanceFromStumpsM;

    // If a previously saved locked delivery was selected, clear selection so pointing bounce starts a clean delivery draft
    if (!pendingPreview && selectedContact && selectedContact.isLocked !== false) {
      onClearSelection();
    }

    setStagedBounceDraft({
      bouncePoint: { ...norm },
      bounceLengthM: bLen,
      bounceTimestampSec: clickTimestamp,
    });

    if (pendingPreview && onUpdatePendingMeta) {
      onUpdatePendingMeta({
        bouncePoint: { ...norm },
        bounceLengthM: bLen,
        bounceTimestampSec: clickTimestamp,
      });
    } else if (isEditingUnlockedContact && selectedContact && onUpdateContactMeta) {
      onUpdateContactMeta(selectedContact.id, {
        bouncePoint: { ...norm },
        bounceLengthM: bLen,
        bounceTimestampSec: clickTimestamp,
      });
    }
  };

  const stageImpactAtPoint = (norm: NormalizedPoint) => {
    const v = videoRef.current;
    if (v && !v.paused) {
      v.pause();
      setIsPlaying(false);
    }

    const clickTimestamp = clamp(
      currentTime,
      trimStart,
      Math.max(trimStart + 0.02, trimEnd)
    );
    let lockedStumpsForPreview: PlantedStumpsConfig = {
      ...activeStumps,
      backStumps: { ...activeStumps.backStumps },
      frontStumps: { ...activeStumps.frontStumps },
    };

    const existingBounceCandidate =
      stagedBounceDraft?.bouncePoint ?? pendingPreview?.bouncePoint ?? null;

    // Guard against reversed clicks (e.g. if user clicked Bat Contact first and Pitch Bounce second):
    // The bat contact point is always closer to the batting stumps center than the turf bounce point.
    let finalContactPoint = { ...norm };
    let swappedBouncePoint = existingBounceCandidate;
    if (existingBounceCandidate) {
      const stumpMidY =
        lockedStumpsForPreview.backStumps.y -
        (lockedStumpsForPreview.backStumpHeight || 0.095) * 0.35;
      const distFirstToStumps = Math.hypot(
        existingBounceCandidate.x - lockedStumpsForPreview.backStumps.x,
        existingBounceCandidate.y - stumpMidY
      );
      const distSecondToStumps = Math.hypot(
        norm.x - lockedStumpsForPreview.backStumps.x,
        norm.y - stumpMidY
      );
      if (
        distSecondToStumps > distFirstToStumps + 0.05 &&
        norm.y > existingBounceCandidate.y + 0.03
      ) {
        finalContactPoint = { ...existingBounceCandidate };
        swappedBouncePoint = { ...norm };
      }
    }

    const autoBounceResult: DetectedTurfBounceResult = detectRealBounceInflection(
      v,
      videoUrl,
      finalContactPoint,
      clickTimestamp,
      lockedStumpsForPreview,
      handedness
    );

    const chosenBouncePoint =
      swappedBouncePoint ?? autoBounceResult.bouncePoint;
    const chosenBounceTime =
      stagedBounceDraft?.bounceTimestampSec ??
      pendingPreview?.bounceTimestampSec ??
      autoBounceResult.bounceTimestampSec;

    const prelimReleasePoint = isUnseenRelease
      ? null
      : stagedReleaseDraft?.releasePoint ??
        pendingPreview?.releasePoint ??
        null;

    // Recompute 3D bounce length directly from marked Batting Stump height & camera angle
    const chosenBounceLengthM = swappedBouncePoint
      ? projectVideoBounceTo3DPitch(
          chosenBouncePoint,
          lockedStumpsForPreview,
          prelimReleasePoint,
          finalContactPoint
        ).bounceDistanceFromStumpsM
      : autoBounceResult.bounceDistanceFromStumpsM;

    if (swappedBouncePoint) {
      setStagedBounceDraft({
        bouncePoint: chosenBouncePoint,
        bounceLengthM: chosenBounceLengthM,
        bounceTimestampSec: chosenBounceTime,
      });
    }

    const proj = calculateImaginaryStumpPoint(
      finalContactPoint,
      lockedStumpsForPreview,
      handedness,
      chosenBouncePoint
    );

    setBounceDetectionInfo({
      method: autoBounceResult.inflectionMethod,
      confidence: swappedBouncePoint ? 99 : autoBounceResult.confidencePct,
      lengthM: chosenBounceLengthM,
    });

    const autoRelease = autoDetectBounceFromContactPoint(
      finalContactPoint,
      lockedStumpsForPreview,
      handedness,
      clickTimestamp,
      chosenBounceLengthM,
      chosenBouncePoint
    ).releasePoint;

    const chosenReleasePoint = isUnseenRelease
      ? undefined
      : stagedReleaseDraft?.releasePoint ??
        pendingPreview?.releasePoint ??
        autoRelease;
    const chosenReleaseTime =
      stagedReleaseDraft?.releaseTimestampSec ??
      pendingPreview?.releaseTimestampSec ??
      Number(Math.max(0, clickTimestamp - 0.44).toFixed(3));

    const snap = v
      ? captureFrameWithContact(
          v,
          finalContactPoint,
          lockedStumpsForPreview,
          proj.zone,
          chosenBouncePoint,
          handedness,
          chosenReleasePoint
        )
      : '';

    const initialPreview: PendingContactPreview = {
      videoPoint: finalContactPoint,
      bouncePoint: chosenBouncePoint,
      releasePoint: chosenReleasePoint,
      bounceLengthM: chosenBounceLengthM,
      bounceTimestampSec: chosenBounceTime,
      bounceConfidence: swappedBouncePoint ? 99 : autoBounceResult.confidencePct,
      bounceInflectionMethod: autoBounceResult.inflectionMethod,
      releaseTimestampSec: chosenReleaseTime,
      timestampSec: clickTimestamp,
      source: 'Manual Point',
      clipLabel: `${videoName} @ ${clickTimestamp.toFixed(2)}s`,
      snapshotUrl: snap,
      selectedShotName: pendingPreview?.selectedShotName,
      wagonWheelAngleDeg: pendingPreview?.wagonWheelAngleDeg,
      isOut: pendingPreview?.isOut ?? false,
      dismissalType: pendingPreview?.dismissalType,
      ballNote: pendingPreview?.ballNote ?? '',
    };

    onStagePreviewPoint(initialPreview);
  };

  // One-Click Automatic or Seeded ("Catch & Follow") Hawk-Eye Ball Tracker
  const handleAutoTrackDelivery = async (seedBall?: {
    point: NormalizedPoint;
    timestampSec: number;
  }) => {
    if (!videoUrl || isAutoTrackingBall) return;
    const v = videoRef.current;
    if (v && !v.paused) {
      v.pause();
      setIsPlaying(false);
    }

    setIsAutoTrackingBall(true);
    setLiveStreamingWaypoints([]);
    setAutoTrackStatusText(
      seedBall
        ? 'Locking onto clicked ball & following frame-by-frame...'
        : 'Sampling 20-frame delivery sequence...'
    );
    setAutoTrackProgressPct(10);

    try {
      const anchorSec = clamp(
        seedBall ? seedBall.timestampSec : currentTime,
        trimStart,
        Math.max(trimStart + 0.05, trimEnd)
      );

      // Clear locked selection so auto-track stages a fresh delivery preview
      if (
        !pendingPreview &&
        selectedContact &&
        selectedContact.isLocked !== false
      ) {
        onClearSelection();
      }

      const result = await autoDetectThreePointDeliveryFromVideo(
        videoUrl,
        anchorSec,
        activeStumps.backStumps,
        activeStumps.frontStumps,
        undefined,
        activeStumps,
        handedness,
        (status, pct) => {
          setAutoTrackStatusText(status);
          setAutoTrackProgressPct(pct);
        },
        {
          trimStartSec: trimStart,
          trimEndSec: trimEnd,
          seedBallPoint: seedBall,
          onFrameTracked: async (frameSec, _ballPt, phase, progressWaypoints) => {
            setLiveStreamingWaypoints(progressWaypoints);
            setAutoTrackStatusText(
              `Following ball [${phase}] @ ${frameSec.toFixed(2)}s...`
            );
            if (v) {
              const safeSec = clamp(
                frameSec,
                trimStart,
                Math.max(trimStart + 0.04, trimEnd)
              );
              v.currentTime = safeSec;
              setCurrentTime(safeSec);
            }
            await new Promise((r) => setTimeout(r, 38));
          },
        }
      );

      // Seek main video player to the detected bat-ball impact frame so snapshot matches
      if (v) {
        const targetImpactSec = clamp(
          result.impactTimestampSec,
          trimStart,
          Math.max(trimStart + 0.04, trimEnd)
        );
        v.currentTime = targetImpactSec;
        setCurrentTime(targetImpactSec);
        await new Promise((r) => setTimeout(r, 45));
      }

      const lockedStumpsForPreview: PlantedStumpsConfig = {
        ...activeStumps,
        backStumps: { ...activeStumps.backStumps },
        frontStumps: { ...activeStumps.frontStumps },
      };

      const proj = calculateImaginaryStumpPoint(
        result.contactPoint,
        lockedStumpsForPreview,
        handedness,
        result.bouncePoint
      );

      const snap = v
        ? captureFrameWithContact(
            v,
            result.contactPoint,
            lockedStumpsForPreview,
            proj.zone,
            result.bouncePoint,
            handedness,
            result.releasePoint
          )
        : '';

      setStagedReleaseDraft({
        releasePoint: result.releasePoint,
        releaseTimestampSec: result.releaseTimestampSec,
      });
      setStagedBounceDraft({
        bouncePoint: result.bouncePoint,
        bounceLengthM: result.bounceDistanceFromStumpsM,
        bounceTimestampSec: result.bounceTimestampSec,
      });

      setBounceDetectionInfo({
        method: 'OPTICAL_V_POINT',
        confidence: result.trackingConfidencePct,
        lengthM: result.bounceDistanceFromStumpsM,
      });

      onStagePreviewPoint({
        videoPoint: result.contactPoint,
        bouncePoint: result.bouncePoint,
        releasePoint: result.releasePoint,
        bounceLengthM: result.bounceDistanceFromStumpsM,
        bounceTimestampSec: result.bounceTimestampSec,
        releaseTimestampSec: result.releaseTimestampSec,
        bounceConfidence: result.trackingConfidencePct,
        bounceInflectionMethod: 'OPTICAL_V_POINT',
        timestampSec: result.impactTimestampSec,
        source: 'AI Auto-Detect',
        clipLabel: `${videoName} @ ${result.impactTimestampSec.toFixed(2)}s`,
        snapshotUrl: snap,
        calibratedSpeedKph: result.calibratedSpeedKph,
        trackedWaypoints: result.trackedWaypoints,
        bowlerReleaseAngleLabel: result.bowlerReleaseAngleLabel,
        selectedShotName: pendingPreview?.selectedShotName,
        wagonWheelAngleDeg: pendingPreview?.wagonWheelAngleDeg,
        isOut: pendingPreview?.isOut ?? false,
        dismissalType: pendingPreview?.dismissalType,
        ballNote: pendingPreview?.ballNote ?? '',
      });

      setClickMode('MANUAL_CONTACT');
    } catch {
      // Fallback if video decode fails
    } finally {
      setIsAutoTrackingBall(false);
      setLiveStreamingWaypoints([]);
      setAutoTrackStatusText('');
      setAutoTrackProgressPct(0);
    }
  };

  // One-Click 3D Pitch Corridor Homography Auto-Fit
  const handleAutoFitPitchCorridor = async () => {
    const v = videoRef.current;
    if (!v || isAutoFittingCorridor) return;
    if (!v.paused) {
      v.pause();
      setIsPlaying(false);
    }

    setIsAutoFittingCorridor(true);
    try {
      const wiz = await runAICalibrationWizardScan(v, videoName);
      const nextBackH = clamp(
        Math.abs(wiz.p1StumpBase.y - wiz.p2StumpBails.y),
        0.04,
        0.24
      );
      onChangeActiveStumps({
        ...activeStumps,
        anchorMode: 'FRONT_STUMPS',
        farEndMode: 'BOWLER_STUMPS_20M',
        cameraAngle: wiz.cameraAngle,
        backStumps: wiz.p1StumpBase,
        stumpTopPoint: wiz.p2StumpBails,
        poppingCreasePoint: wiz.p3PoppingCrease,
        frontStumps: wiz.p4PitchAxis,
        backStumpHeight: Number(nextBackH.toFixed(4)),
      });
      setShowCalibrationGrid(true);
    } catch {
      // ignore
    } finally {
      setIsAutoFittingCorridor(false);
    }
  };

  const handleStageClick = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).dataset.handle) {
      return;
    }
    const norm = clientToNormalized(e.clientX, e.clientY);
    if (!norm) return;

    dragStartRef.current = {
      startNorm: norm,
      startBackW: activeStumps.backStumpWidth,
      startBackH: activeStumps.backStumpHeight,
      startFrontW: activeStumps.frontStumpWidth,
      startFrontH: activeStumps.frontStumpHeight,
      directCorner: false,
    };

    if (clickMode === 'BACK_STUMPS') {
      if (stumpEditAction === 'RESIZE') {
        setDragHandle('BACK_STUMPS_RESIZE');
      } else {
        const dxShift = norm.x - activeStumps.backStumps.x;
        const dyShift = norm.y - activeStumps.backStumps.y;
        const prevCal = resolveFourPointCalibration(activeStumps);

        if (!hasManualStumpLineRef.current) {
          const suggestion = computeSuggestedStumpLine(
            norm,
            activeStumps.backStumpWidth,
            activeStumps.backStumpHeight,
            activeStumps.cameraAngle
          );
          setIsStumpLineAutoSuggested(true);
          onChangeActiveStumps({
            ...activeStumps,
            backStumps: norm,
            stumpTopPoint: {
              x: norm.x,
              y: Number(
                clamp(norm.y - activeStumps.backStumpHeight, 0.03, 0.94).toFixed(
                  4
                )
              ),
            },
            frontStumps: suggestion.suggestedFrontStumps,
            poppingCreasePoint: suggestion.suggestedPoppingCrease,
          });
        } else {
          const nextFrontStumps =
            activeStumps.anchorMode === 'CREASE_ARROW'
              ? {
                  x: Number(
                    clamp(activeStumps.frontStumps.x + dxShift, 0.04, 0.96).toFixed(4)
                  ),
                  y: Number(
                    clamp(activeStumps.frontStumps.y + dyShift, 0.04, 0.96).toFixed(4)
                  ),
                }
              : activeStumps.frontStumps;
          onChangeActiveStumps({
            ...activeStumps,
            backStumps: norm,
            frontStumps: nextFrontStumps,
            stumpTopPoint: {
              x: norm.x,
              y: Number(
                clamp(norm.y - activeStumps.backStumpHeight, 0.03, 0.94).toFixed(
                  4
                )
              ),
            },
            poppingCreasePoint: {
              x: Number(
                clamp(prevCal.p3PoppingCrease.x + dxShift, 0.03, 0.97).toFixed(4)
              ),
              y: Number(
                clamp(prevCal.p3PoppingCrease.y + dyShift, 0.03, 0.97).toFixed(4)
              ),
            },
          });
        }
        setDragHandle('BACK_STUMPS');
      }
    } else if (clickMode === 'FRONT_STUMPS') {
      hasManualStumpLineRef.current = true;
      setIsStumpLineAutoSuggested(false);
      if (
        stumpEditAction === 'RESIZE' &&
        activeStumps.anchorMode !== 'CREASE_ARROW'
      ) {
        setDragHandle('FRONT_STUMPS_RESIZE');
      } else {
        const prevCal = resolveFourPointCalibration(activeStumps);
        const prevDx = activeStumps.frontStumps.x - activeStumps.backStumps.x;
        const prevDy = activeStumps.frontStumps.y - activeStumps.backStumps.y;
        const prevLen = Math.hypot(prevDx, prevDy);
        const prevUx = prevLen > 0.001 ? prevDx / prevLen : 0;
        const prevUy = prevLen > 0.001 ? prevDy / prevLen : 1;
        const creaseSpan = clamp(
          (prevCal.p3PoppingCrease.x - activeStumps.backStumps.x) * prevUx +
            (prevCal.p3PoppingCrease.y - activeStumps.backStumps.y) * prevUy,
          0.018,
          0.22
        );
        const nextDx = norm.x - activeStumps.backStumps.x;
        const nextDy = norm.y - activeStumps.backStumps.y;
        const nextLen = Math.hypot(nextDx, nextDy);
        const nextUx = nextLen > 0.001 ? nextDx / nextLen : 0;
        const nextUy = nextLen > 0.001 ? nextDy / nextLen : 1;

        onChangeActiveStumps({
          ...activeStumps,
          frontStumps: norm,
          poppingCreasePoint: {
            x: Number(
              clamp(
                activeStumps.backStumps.x + nextUx * creaseSpan,
                0.03,
                0.97
              ).toFixed(4)
            ),
            y: Number(
              clamp(
                activeStumps.backStumps.y + nextUy * creaseSpan,
                0.03,
                0.97
              ).toFixed(4)
            ),
          },
        });
        setDragHandle('FRONT_STUMPS');
      }
    } else if (clickMode === 'POPPING_CREASE') {
      const dx = activeStumps.frontStumps.x - activeStumps.backStumps.x;
      const dy = activeStumps.frontStumps.y - activeStumps.backStumps.y;
      const len = Math.hypot(dx, dy);
      const ux = len > 0.001 ? dx / len : 0;
      const uy = len > 0.001 ? dy / len : 1;
      const projDist = clamp(
        (norm.x - activeStumps.backStumps.x) * ux +
          (norm.y - activeStumps.backStumps.y) * uy,
        0.018,
        0.22
      );
      onChangeActiveStumps({
        ...activeStumps,
        poppingCreasePoint: {
          x: Number(
            clamp(
              activeStumps.backStumps.x + ux * projDist,
              0.03,
              0.97
            ).toFixed(4)
          ),
          y: Number(
            clamp(
              activeStumps.backStumps.y + uy * projDist,
              0.03,
              0.97
            ).toFixed(4)
          ),
        },
      });
      setDragHandle('POPPING_CREASE');
    } else if (clickMode === 'MANUAL_RELEASE') {
      stageReleaseAtPoint(norm);
      setDragHandle('RELEASE_POINT');
    } else if (clickMode === 'MANUAL_BOUNCE') {
      stageBounceAtPoint(norm);
      setDragHandle('BOUNCE_POINT');
    } else {
      stageImpactAtPoint(norm);
      setDragHandle('CONTACT_POINT');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const nextUrl = URL.createObjectURL(file);
    hasCustomTrimRef.current = false;
    setIsTrimOpen(false);
    setTrimStart(0);
    setCurrentTime(0);
    setVideoUrl(nextUrl);
    setVideoName(file.name);
    setIsPlaying(false);
    setFilmstripFrames([]);
    onDiscardPendingPreview();
    e.target.value = '';
  };

  const handleSwitchRecentVideo = (clipId: string) => {
    const found = recentVideos.find((c) => c.id === clipId);
    if (!found) return;
    const fullDur = found.durationSec ?? 2.0;
    const startSec = found.trimStartSec ?? 0;
    const endSec = found.trimEndSec ?? fullDur;
    hasCustomTrimRef.current =
      startSec > 0.01 || Math.abs(endSec - fullDur) > 0.05;
    setVideoUrl(found.url);
    setVideoName(found.name);
    setIsPlaying(false);
    setDuration(fullDur);
    setTrimStart(startSec);
    setTrimEnd(endSec);
    setCurrentTime(startSec);
    setFilmstripFrames([]);
    onDiscardPendingPreview();
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime >= trimEnd || v.currentTime < trimStart) {
        v.currentTime = trimStart;
      }
      v.playbackRate = playbackRate;
      v.play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    } else {
      v.pause();
      setIsPlaying(false);
    }
  };

  const stepFrame = (deltaFrames: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    setIsPlaying(false);
    const frameSec = 1 / 30;
    const next = clamp(
      v.currentTime + deltaFrames * frameSec,
      trimStart,
      Math.max(trimStart + 0.04, trimEnd)
    );
    v.currentTime = next;
    setCurrentTime(next);
  };

  const seekToSecond = (targetSec: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    setIsPlaying(false);
    const safe = clamp(targetSec, trimStart, Math.max(trimStart + 0.04, trimEnd));
    v.currentTime = safe;
    setCurrentTime(safe);
  };

  const currentFrameNumber = Math.max(1, Math.round(currentTime * 30) + 1);
  const startFrameNumber = Math.max(1, Math.round(trimStart * 30) + 1);
  const endFrameNumber = Math.max(
    startFrameNumber + 1,
    Math.round(trimEnd * 30) + 1
  );
  const totalFrameCount = Math.max(1, Math.round(duration * 30) + 1);

  const isArrowMode = activeStumps.anchorMode === 'CREASE_ARROW';

  const bx = contentRect.left + activeStumps.backStumps.x * contentRect.width;
  const by = contentRect.top + activeStumps.backStumps.y * contentRect.height;
  const fx = contentRect.left + activeStumps.frontStumps.x * contentRect.width;
  const fy = contentRect.top + activeStumps.frontStumps.y * contentRect.height;

  const bw = activeStumps.backStumpWidth * contentRect.width;
  const bh = activeStumps.backStumpHeight * contentRect.height;
  const fw = activeStumps.frontStumpWidth * contentRect.width;
  const fh = activeStumps.frontStumpHeight * contentRect.height;

  const [rightInspectorTab, setRightInspectorTab] = useState<
    'TRACK' | 'CALIBRATE' | 'CLIP'
  >('TRACK');

  const handleSaveAndResetDelivery = () => {
    onCommitPendingPreview(resolvedBounceLengthM);
    setStagedReleaseDraft(null);
    setStagedBounceDraft(null);
    setLiveStreamingWaypoints([]);
    setBounceDetectionInfo(null);
    onClearSelection();
    setClickMode('MANUAL_BOUNCE');
    setRightInspectorTab('TRACK');
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* LEFT 8 COLUMNS (OR FULLSCREEN VIEWPORT): VIDEO PLAYER + CONTROLS */}
      <div
        className={
          isFullscreen
            ? 'fixed inset-0 z-50 bg-[#090A0F] flex flex-col p-3 gap-2.5'
            : 'lg:col-span-8 space-y-3'
        }
      >
        {/* Professional Broadcast Tracking HUD Header */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-2.5 bg-[#0E0E0E] border border-white/10 rounded-2xl shadow-lg">
          {/* Left: Step-by-Step Production Tracking Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center bg-[#141414] p-1 rounded-xl border border-white/10">
              {/* Step 1: Batting Stumps */}
              <button
                type="button"
                onClick={() => {
                  setClickMode('BACK_STUMPS');
                  setStumpEditAction('MOVE');
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  clickMode === 'BACK_STUMPS'
                    ? 'bg-white text-black font-bold shadow-sm'
                    : 'text-zinc-400 hover:text-white hover:bg-white/5'
                }`}
                title="Mark Batting Stumps on video (corridor calculates automatically)"
              >
                <Target className="w-3.5 h-3.5 text-emerald-400" />
                <span>1. Stumps</span>
              </button>

              <div className="w-[1px] h-4 bg-white/10 mx-1" />

              {/* Step 2: Pitch Bounce (B) */}
              <button
                type="button"
                onClick={() => setClickMode('MANUAL_BOUNCE')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  clickMode === 'MANUAL_BOUNCE'
                    ? 'bg-emerald-400 text-black font-bold shadow-sm'
                    : resolvedBouncePoint
                    ? 'text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20'
                    : 'text-zinc-400 hover:text-white hover:bg-white/5'
                }`}
                title="Click or drag where the ball pitches on the turf"
              >
                <span
                  className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold ${
                    clickMode === 'MANUAL_BOUNCE'
                      ? 'bg-black text-emerald-400'
                      : resolvedBouncePoint
                      ? 'bg-emerald-400 text-black'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  B
                </span>
                <span>2. Bounce</span>
                {resolvedBouncePoint && (
                  <span className="text-[10px] font-mono font-bold tabular-nums ml-0.5">
                    ({resolvedBounceLengthM.toFixed(1)}m)
                  </span>
                )}
              </button>

              <div className="w-[1px] h-4 bg-white/10 mx-1" />

              {/* Step 3: Bat Contact (C) */}
              <button
                type="button"
                onClick={() => setClickMode('MANUAL_CONTACT')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  clickMode === 'MANUAL_CONTACT'
                    ? 'bg-white text-black font-bold shadow-sm'
                    : activeImpactPoint
                    ? 'text-white bg-white/10 hover:bg-white/20'
                    : 'text-zinc-400 hover:text-white hover:bg-white/5'
                }`}
                title="Click or drag where the ball meets the bat"
              >
                <span
                  className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold ${
                    clickMode === 'MANUAL_CONTACT'
                      ? 'bg-black text-white'
                      : activeImpactPoint
                      ? 'bg-white text-black'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  C
                </span>
                <span>3. Contact</span>
                {activeProjection && (
                  <span className="text-[10px] font-mono font-bold tabular-nums ml-0.5">
                    ({activeProjection.contactHeightCm}cm)
                  </span>
                )}
              </button>
            </div>

            {/* Glowing Save Button when delivery is ready */}
            {pendingPreview && (
              <button
                type="button"
                onClick={handleSaveAndResetDelivery}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-black text-xs font-bold cursor-pointer transition shadow-[0_0_20px_rgba(16,185,129,0.35)] animate-toast-slide"
                title="Save this delivery and automatically clear video markers for the next ball"
              >
                <Check className="w-4 h-4 stroke-[2.5]" />
                <span>Save Delivery (Auto-Reset)</span>
              </button>
            )}

            {/* Live Camera Elevation Telemetry Pill */}
            <div
              className="hidden xl:inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#141414] border border-white/10 text-[11px] font-mono tabular-nums text-zinc-300"
              title={`Camera Perspective: ${cameraTelemetry.cameraToBattingStumpsM.toFixed(1)}m from Batting Stumps, 20.12m Turf Corridor.`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-zinc-400">Corridor:</span>
              <span className="text-emerald-400 font-semibold">20.12m</span>
              <span className="text-zinc-600">·</span>
              <span className="text-zinc-400">Dist:</span>
              <span className="text-white font-semibold">{cameraTelemetry.cameraToBattingStumpsM.toFixed(1)}m</span>
            </div>
          </div>

          {/* Right: Minimalist Zoom & Loupe Controls */}
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex items-center gap-1 bg-[#141414] px-1.5 py-0.5 rounded-xl border border-white/10">
              <ZoomIn className="w-3.5 h-3.5 text-zinc-400 mr-0.5" />
              {[1.0, 1.5, 2.0, 3.0].map((z) => (
                <button
                  key={z}
                  type="button"
                  onClick={() => {
                    setCanvasZoom(z);
                    if (z === 1.0) setPanOffset({ x: 0, y: 0 });
                  }}
                  className={`px-1.5 py-0.5 rounded-md text-[11px] font-mono tabular-nums font-semibold cursor-pointer transition ${
                    canvasZoom === z
                      ? 'bg-emerald-400 text-black font-bold'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {z}x
                </button>
              ))}
            </div>

            {canvasZoom > 1.0 && (
              <>
                <button
                  type="button"
                  onClick={() => setIsPanMode((v) => !v)}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-xl text-xs font-mono transition cursor-pointer border ${
                    isPanMode
                      ? 'bg-amber-400 text-zinc-950 border-amber-300 font-bold'
                      : 'bg-[#090A0F] text-zinc-300 border-white/[0.07] hover:text-white'
                  }`}
                  title="Toggle Pan Mode to drag viewport"
                >
                  <Move className="w-3 h-3" />
                  <span>Pan</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCanvasZoom(1.0);
                    setPanOffset({ x: 0, y: 0 });
                    setIsPanMode(false);
                  }}
                  className="px-2 py-1 rounded-xl text-xs font-mono text-zinc-400 hover:text-white cursor-pointer"
                >
                  Reset
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => setShowLoupe((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-mono transition cursor-pointer border ${
                showLoupe
                  ? 'bg-teal-400/15 text-teal-300 border-teal-400/45 font-semibold'
                  : 'bg-[#090A0F] text-zinc-400 border-white/[0.07] hover:text-zinc-200'
              }`}
              title="Floating 3.2x Precision Magnifier Loupe with Crosshair Reticle"
            >
              <Crosshair className="w-3.5 h-3.5 text-teal-300" />
              <span>Loupe {showLoupe ? 'ON' : 'OFF'}</span>
            </button>
          </div>
        </div>

        {/* Video Viewport */}
        <div
          ref={stageRef}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).dataset.handle) return;
            if (isPanMode || e.button === 1 || e.shiftKey) {
              setIsDraggingPan(true);
              panStartRef.current = {
                clientX: e.clientX,
                clientY: e.clientY,
                startPanX: panOffset.x,
                startPanY: panOffset.y,
              };
              return;
            }
            handleStageClick(e);
          }}
          onPointerMove={(e) => {
            const el = stageRef.current;
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const stageX = e.clientX - rect.left;
            const stageY = e.clientY - rect.top;
            const norm = clientToNormalized(e.clientX, e.clientY);
            if (norm) {
              setPointerPos({ stageX, stageY, normX: norm.x, normY: norm.y });
              if (showLoupe) {
                drawLoupeCanvas(norm);
              }
            }

            if (isDraggingPan && panStartRef.current && canvasZoom > 1.0) {
              const dx = e.clientX - panStartRef.current.clientX;
              const dy = e.clientY - panStartRef.current.clientY;
              const maxPanX = (stageDims.width * (canvasZoom - 1)) / 2;
              const maxPanY = (stageDims.height * (canvasZoom - 1)) / 2;
              setPanOffset({
                x: clamp(panStartRef.current.startPanX + dx, -maxPanX, maxPanX),
                y: clamp(panStartRef.current.startPanY + dy, -maxPanY, maxPanY),
              });
            }
          }}
          onPointerEnter={() => setIsHoveringVideo(true)}
          onPointerLeave={() => {
            setIsHoveringVideo(false);
            setPointerPos(null);
            setIsDraggingPan(false);
          }}
          onPointerUp={() => {
            setIsDraggingPan(false);
            panStartRef.current = null;
          }}
          className={`cinema-stage relative w-full rounded-2xl overflow-hidden border select-none shadow-lg ${
            isPanMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'
          } ${
            isFullscreen ? 'flex-1 min-h-0' : 'aspect-video'
          } ${
            clickMode === 'MANUAL_RELEASE'
              ? 'border-violet-500/60'
              : clickMode === 'MANUAL_BOUNCE'
              ? 'border-emerald-500/60'
              : clickMode === 'MANUAL_CONTACT'
              ? 'border-cyan-500/50'
              : 'border-amber-400/70'
          }`}
        >
          {/* Zoomable & Pannable Viewport Surface */}
          <div
            className="absolute inset-0 w-full h-full origin-top-left transition-transform duration-75"
            style={{
              transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${canvasZoom})`,
            }}
          >
            <video
              ref={videoRef}
              src={videoUrl || undefined}
              muted
              playsInline
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                const d =
                  Number.isFinite(v.duration) && v.duration > 0
                    ? v.duration
                    : 2.0;
                setDuration(d);
                const existingRecent = recentVideos.find((r) => r.url === videoUrl);
                const nextStart =
                  hasCustomTrimRef.current && existingRecent?.trimStartSec
                    ? existingRecent.trimStartSec
                    : 0;
                const nextEnd =
                  hasCustomTrimRef.current &&
                  existingRecent?.trimEndSec &&
                  existingRecent.trimEndSec <= d
                    ? existingRecent.trimEndSec
                    : d;
                setTrimStart(nextStart);
                setTrimEnd(nextEnd);
                setVideoDims({
                  width: v.videoWidth || 960,
                  height: v.videoHeight || 540,
                });
                registerRecentVideo(videoName, videoUrl, d, nextStart, nextEnd);
                buildFilmstripForWindow(nextStart, nextEnd);
              }}
              onDurationChange={(e) => {
                const v = e.currentTarget;
                if (Number.isFinite(v.duration) && v.duration > 0) {
                  const d = v.duration;
                  setDuration(d);
                  if (!hasCustomTrimRef.current) {
                    setTrimStart(0);
                    setTrimEnd(d);
                    registerRecentVideo(videoName, videoUrl, d, 0, d);
                  }
                }
              }}
              className="w-full h-full object-contain pointer-events-none"
            />

            {/* Clean Minimal SVG Stumps / Pitch Arrow + Bounce Marker (B) + Contact Marker (C) */}
            {showOverlay && (
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none z-10"
                viewBox={`0 0 ${stageDims.width} ${stageDims.height}`}
              >
                {/* 4-Corner 3D Pitch Corridor Homography & Length Zone Lines */}
                {showCalibrationGrid &&
                  (() => {
                    const toScreen = (pt: NormalizedPoint) => ({
                      x: contentRect.left + pt.x * contentRect.width,
                      y: contentRect.top + pt.y * contentRect.height,
                    });

                    const outerPolygonPoints =
                      pitchCorridorHomography.corridorPolygon
                        .map((pt) => {
                          const s = toScreen(pt);
                          return `${s.x.toFixed(1)},${s.y.toFixed(1)}`;
                        })
                        .join(' ');

                    const wicketCarpetPoints =
                      pitchCorridorHomography.wicketPolygon
                        .map((pt) => {
                          const s = toScreen(pt);
                          return `${s.x.toFixed(1)},${s.y.toFixed(1)}`;
                        })
                        .join(' ');

                    const sL = toScreen(
                      pitchCorridorHomography.strikerLeftCorner
                    );
                    const sR = toScreen(
                      pitchCorridorHomography.strikerRightCorner
                    );
                    const bL = toScreen(
                      pitchCorridorHomography.bowlerLeftCorner
                    );
                    const bR = toScreen(
                      pitchCorridorHomography.bowlerRightCorner
                    );

                    const lateralFracs = [-0.66, -0.33, 0, 0.33, 0.66];

                    return (
                      <g opacity={0.9}>
                        <polygon
                          points={outerPolygonPoints}
                          fill="rgba(34, 211, 238, 0.06)"
                          stroke="rgba(34, 211, 238, 0.55)"
                          strokeWidth="1.3"
                        />
                        <polygon
                          points={wicketCarpetPoints}
                          fill="rgba(251, 191, 36, 0.12)"
                          stroke="rgba(251, 191, 36, 0.65)"
                          strokeWidth="1.2"
                        />
                        {lateralFracs.map((lf, idx) => {
                          const t = (lf + 1) / 2;
                          const nx = sL.x + (sR.x - sL.x) * t;
                          const ny = sL.y + (sR.y - sL.y) * t;
                          const fxPt = bL.x + (bR.x - bL.x) * t;
                          const fyPt = bL.y + (bR.y - bL.y) * t;
                          return (
                            <line
                              key={`lon-${idx}`}
                              x1={nx}
                              y1={ny}
                              x2={fxPt}
                              y2={fyPt}
                              stroke={
                                lf === 0
                                  ? 'rgba(251, 191, 36, 0.65)'
                                  : 'rgba(34, 211, 238, 0.28)'
                              }
                              strokeWidth={lf === 0 ? '1.3' : '0.9'}
                              strokeDasharray={lf === 0 ? '4 3' : undefined}
                            />
                          );
                        })}
                        {pitchCorridorHomography.lengthZoneLines.map(
                          (zl, idx) => {
                            const lp = toScreen(zl.leftPt);
                            const rp = toScreen(zl.rightPt);
                            const isCrease = zl.meters === 1.22;
                            return (
                              <g key={`zl-${idx}`}>
                                <line
                                  x1={lp.x}
                                  y1={lp.y}
                                  x2={rp.x}
                                  y2={rp.y}
                                  stroke={
                                    isCrease
                                      ? 'rgba(251, 191, 36, 0.88)'
                                      : 'rgba(34, 211, 238, 0.38)'
                                  }
                                  strokeWidth={isCrease ? '1.7' : '1.0'}
                                />
                                <text
                                  x={rp.x + 5}
                                  y={rp.y + 3}
                                  fill={
                                    isCrease
                                      ? '#FDE68A'
                                      : 'rgba(103, 232, 249, 0.85)'
                                  }
                                  fontSize="8.5"
                                  fontFamily="monospace"
                                >
                                  {zl.label}
                                </text>
                              </g>
                            );
                          }
                        )}
                      </g>
                    );
                  })()}

                {/* SUGGESTED STUMP LINE & 3-RAIL WICKET CORRIDOR (Always visible & directly adjustable) */}
                {(() => {
                  const adx = fx - bx;
                  const ady = fy - by;
                  const alen = Math.hypot(adx, ady);
                  const ux = alen > 1 ? adx / alen : 0;
                  const uy = alen > 1 ? ady / alen : 1;
                  const px = -uy;
                  const py = ux;
                  const headLen = 14;
                  const headHalfW = 7;
                  const arrowHeadPoints = `${fx},${fy} ${
                    fx - ux * headLen + px * headHalfW
                  },${fy - uy * headLen + py * headHalfW} ${
                    fx - ux * headLen - px * headHalfW
                  },${fy - uy * headLen - py * headHalfW}`;

                  const midLineX = (bx + fx) / 2;
                  const midLineY = (by + fy) / 2;

                  return (
                    <g opacity={stumpOpacity / 100}>
                      {/* Wicket-to-Wicket Shaded Stump Line Carpet (22.86cm wide strip) */}
                      <polygon
                        points={`${bx - bw * 0.5},${by} ${bx + bw * 0.5},${by} ${
                          fx + fw * 0.5
                        },${fy} ${fx - fw * 0.5},${fy}`}
                        fill="rgba(34, 211, 238, 0.10)"
                        stroke="none"
                      />

                      {/* Left & Right Stump-to-Stump Outer Rails */}
                      <line
                        x1={bx - bw * 0.5}
                        y1={by}
                        x2={fx - fw * 0.5}
                        y2={fy}
                        stroke="rgba(56, 189, 248, 0.55)"
                        strokeWidth="1.3"
                        strokeDasharray="5 3"
                      />
                      <line
                        x1={bx + bw * 0.5}
                        y1={by}
                        x2={fx + fw * 0.5}
                        y2={fy}
                        stroke="rgba(56, 189, 248, 0.55)"
                        strokeWidth="1.3"
                        strokeDasharray="5 3"
                      />

                      {/* Center Suggested Stump Line (Middle-to-Middle Axis) */}
                      <line
                        x1={bx}
                        y1={by}
                        x2={fx}
                        y2={fy}
                        stroke={
                          clickMode === 'FRONT_STUMPS' ||
                          dragHandle === 'FRONT_STUMPS'
                            ? '#38BDF8'
                            : '#22D3EE'
                        }
                        strokeWidth={
                          clickMode === 'FRONT_STUMPS' ||
                          dragHandle === 'FRONT_STUMPS'
                            ? '3.0'
                            : '2.2'
                        }
                      />

                      {/* Stump Line Status Label along the Pitch Axis */}
                      <g
                        transform={`translate(${Math.round(midLineX + 10)}, ${Math.round(
                          midLineY - 8
                        )})`}
                      >
                        <rect
                          x="0"
                          y="0"
                          width={isArrowMode ? 148 : 124}
                          height="16"
                          rx="4"
                          fill="rgba(5, 8, 15, 0.85)"
                          stroke="rgba(34, 211, 238, 0.45)"
                          strokeWidth="0.9"
                        />
                        <text
                          x="6"
                          y="11"
                          fill="#67E8F9"
                          fontSize="8.5"
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          {!isArrowMode
                            ? 'Both Stumps Line (20.1m)'
                            : isStumpLineAutoSuggested
                            ? 'Suggested Stump Line (Drag)'
                            : 'Adjusted Stump Line (Drag)'}
                        </text>
                      </g>

                      {/* FAR END: Either Visible Bowler Stumps OR Suggested Stump Line Arrow (Directly Draggable) */}
                      <g
                        className="pointer-events-auto cursor-grab active:cursor-grabbing"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          dragStartRef.current = {
                            startNorm: activeStumps.frontStumps,
                            startBackW: activeStumps.backStumpWidth,
                            startBackH: activeStumps.backStumpHeight,
                            startFrontW: activeStumps.frontStumpWidth,
                            startFrontH: activeStumps.frontStumpHeight,
                            directCorner: false,
                          };
                          setClickMode('FRONT_STUMPS');
                          setDragHandle('FRONT_STUMPS');
                        }}
                      >
                        {/* Invisible larger hit target for easy dragging */}
                        <circle
                          cx={fx}
                          cy={fy}
                          r="18"
                          fill="transparent"
                        />
                        {!isArrowMode ? (
                          <>
                            {[-0.5, 0, 0.5].map((r, idx) => (
                              <line
                                key={idx}
                                x1={fx + r * fw}
                                y1={fy}
                                x2={fx + r * fw}
                                y2={fy - fh}
                                stroke="#38BDF8"
                                strokeWidth={
                                  clickMode === 'FRONT_STUMPS' ? '2.8' : '2.2'
                                }
                              />
                            ))}
                            <line
                              x1={fx - fw * 0.5}
                              y1={fy - fh}
                              x2={fx + fw * 0.5}
                              y2={fy - fh}
                              stroke="#38BDF8"
                              strokeWidth={
                                clickMode === 'FRONT_STUMPS' ? '2.8' : '2.2'
                              }
                            />
                            <circle
                              cx={fx}
                              cy={fy}
                              r="5"
                              fill="#38BDF8"
                              stroke="#05080F"
                              strokeWidth="1.4"
                            />
                          </>
                        ) : (
                          <>
                            <circle
                              cx={fx}
                              cy={fy}
                              r="12"
                              fill="rgba(34, 211, 238, 0.20)"
                              stroke="#22D3EE"
                              strokeWidth="1.5"
                            />
                            <polygon points={arrowHeadPoints} fill="#22D3EE" />
                            <circle
                              cx={fx}
                              cy={fy}
                              r="4"
                              fill="#FEF08A"
                              stroke="#05080F"
                              strokeWidth="1.2"
                            />
                          </>
                        )}
                      </g>
                    </g>
                  );
                })()}

                {/* Virtual Bowling Popping Crease & Virtual Bowler Stumps (When in Batting Stumps Only mode) */}
                {!cameraTelemetry.bowlingStumpsVisible && (
                  (() => {
                    const vCrease = cameraTelemetry.virtualReleaseCrease2D;
                    const vStumps = cameraTelemetry.virtualBowlingStumps2D;
                    const vcScr = {
                      x: contentRect.left + vCrease.x * contentRect.width,
                      y: contentRect.top + vCrease.y * contentRect.height,
                    };
                    const vsScr = {
                      x: contentRect.left + vStumps.x * contentRect.width,
                      y: contentRect.top + vStumps.y * contentRect.height,
                    };
                    const creaseHalfW = Math.max(28, bw * 1.5);

                    return (
                      <g key="virtual-bowling-crease-guide" pointerEvents="none" opacity={0.88}>
                        {/* 18.90m Bowling Crease */}
                        <line
                          x1={vcScr.x - creaseHalfW}
                          y1={vcScr.y}
                          x2={vcScr.x + creaseHalfW}
                          y2={vcScr.y}
                          stroke="rgba(167, 139, 250, 0.75)"
                          strokeWidth="1.6"
                          strokeDasharray="4 3"
                        />
                        <text
                          x={vcScr.x + creaseHalfW + 5}
                          y={vcScr.y + 3}
                          fill="#C4B5FD"
                          fontSize="8.5"
                          fontFamily="monospace"
                        >
                          Bowling Crease 18.9m
                        </text>

                        {/* 20.12m Virtual Bowling Stumps Marker */}
                        <line
                          x1={vsScr.x - 14}
                          y1={vsScr.y}
                          x2={vsScr.x + 14}
                          y2={vsScr.y}
                          stroke="rgba(56, 189, 248, 0.7)"
                          strokeWidth="1.4"
                          strokeDasharray="3 2"
                        />
                        <circle
                          cx={vsScr.x}
                          cy={vsScr.y}
                          r="3"
                          fill="none"
                          stroke="#38BDF8"
                          strokeWidth="1.2"
                        />
                        <text
                          x={vsScr.x + 18}
                          y={vsScr.y + 3}
                          fill="#7DD3FC"
                          fontSize="8.5"
                          fontFamily="monospace"
                        >
                          Virtual Stumps 20.1m ({cameraTelemetry.cameraToBowlingStumpsM.toFixed(1)}m)
                        </text>
                      </g>
                    );
                  })()
                )}

                {/* Striker (Back) Stumps (Directly Draggable Base + Top Resize Handle) */}
                <g opacity={stumpOpacity / 100}>
                  <g
                    className="pointer-events-auto cursor-grab active:cursor-grabbing"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      dragStartRef.current = {
                        startNorm: activeStumps.backStumps,
                        startBackW: activeStumps.backStumpWidth,
                        startBackH: activeStumps.backStumpHeight,
                        startFrontW: activeStumps.frontStumpWidth,
                        startFrontH: activeStumps.frontStumpHeight,
                        directCorner: false,
                      };
                      setClickMode('BACK_STUMPS');
                      setDragHandle('BACK_STUMPS');
                    }}
                  >
                    <rect
                      x={bx - bw * 0.75}
                      y={by - bh}
                      width={bw * 1.5}
                      height={bh + 10}
                      fill="transparent"
                    />
                    {[-0.5, 0, 0.5].map((r, idx) => (
                      <line
                        key={idx}
                        x1={bx + r * bw}
                        y1={by}
                        x2={bx + r * bw}
                        y2={by - bh}
                        stroke="#FBBF24"
                        strokeWidth={clickMode === 'BACK_STUMPS' ? '2.8' : '2.2'}
                      />
                    ))}
                    <line
                      x1={bx - bw * 0.5}
                      y1={by - bh}
                      x2={bx + bw * 0.5}
                      y2={by - bh}
                      stroke="#FDE68A"
                      strokeWidth={clickMode === 'BACK_STUMPS' ? '2.8' : '2.2'}
                    />
                    <circle
                      cx={bx}
                      cy={by}
                      r="5"
                      fill="#FBBF24"
                      stroke="#05080F"
                      strokeWidth="1.4"
                    />
                  </g>
                  {/* Top Bail Resize Handle for Striker Stumps */}
                  <circle
                    cx={bx + bw * 0.5}
                    cy={by - bh}
                    r="5"
                    fill="#FDE68A"
                    stroke="#05080F"
                    strokeWidth="1.2"
                    className="pointer-events-auto cursor-nwse-resize"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      dragStartRef.current = {
                        startNorm: {
                          x: activeStumps.backStumps.x + activeStumps.backStumpWidth * 0.5,
                          y: activeStumps.backStumps.y - activeStumps.backStumpHeight,
                        },
                        startBackW: activeStumps.backStumpWidth,
                        startBackH: activeStumps.backStumpHeight,
                        startFrontW: activeStumps.frontStumpWidth,
                        startFrontH: activeStumps.frontStumpHeight,
                        directCorner: true,
                      };
                      setClickMode('BACK_STUMPS');
                      setDragHandle('BACK_STUMPS_RESIZE');
                    }}
                  />
                </g>

                {/* Full Broadcast Hawk-Eye 2D Video Trajectory Tube (Release -> Bounce B -> Contact C -> Stumps) */}
                {activeVideoTrajectory2D &&
                  activeTrajectoryPred &&
                  activeImpactPoint &&
                  (() => {
                    const toScreen = (pt: NormalizedPoint) => ({
                      x: contentRect.left + pt.x * contentRect.width,
                      y: contentRect.top + pt.y * contentRect.height,
                    });
                    const buildPathD = (pts: NormalizedPoint[]) => {
                      if (pts.length === 0) return '';
                      return pts
                        .map((pt, i) => {
                          const s = toScreen(pt);
                          return `${i === 0 ? 'M' : 'L'} ${s.x.toFixed(1)} ${s.y.toFixed(1)}`;
                        })
                        .join(' ');
                    };

                    const preD = buildPathD(
                      activeVideoTrajectory2D.preBouncePoints2D
                    );
                    const midD = buildPathD(
                      activeVideoTrajectory2D.bounceToImpactPoints2D
                    );
                    const postD = buildPathD(
                      activeVideoTrajectory2D.impactToStumpsPoints2D
                    );
                    const groundD = buildPathD(
                      activeVideoTrajectory2D.groundTrackPoints2D
                    );

                    const relScreen = toScreen(
                      activeVideoTrajectory2D.entryPoint2D
                    );
                    const impScreen = toScreen(
                      activeVideoTrajectory2D.impactPoint2D
                    );
                    const impGroundScreen = toScreen(
                      activeVideoTrajectory2D.impactGroundPoint2D
                    );
                    const stumpHitScreen = toScreen(
                      activeVideoTrajectory2D.stumpIntersection2D
                    );
                    const stumpGroundScreen = toScreen(
                      activeVideoTrajectory2D.stumpGroundPoint2D
                    );

                    const isGrazeVerdict =
                      activeTrajectoryPred.verdictLabel.includes('GRAZING') ||
                      activeTrajectoryPred.verdictLabel.includes('CLIPPING');
                    const isFullHitVerdict =
                      activeTrajectoryPred.hittingWicket && !isGrazeVerdict;

                    const postTubeColor = isFullHitVerdict
                      ? '#F43F5E'
                      : isGrazeVerdict
                      ? '#F59E0B'
                      : '#38BDF8';
                    const postGlowColor = isFullHitVerdict
                      ? 'rgba(244, 63, 94, 0.28)'
                      : isGrazeVerdict
                      ? 'rgba(245, 158, 11, 0.26)'
                      : 'rgba(56, 189, 248, 0.22)';

                    return (
                      <g className="pointer-events-none">
                        {/* 1. Perspective Ground Shadow Track along the turf surface */}
                        {groundD && (
                          <path
                            d={groundD}
                            fill="none"
                            stroke="rgba(15, 23, 42, 0.55)"
                            strokeWidth="3.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        )}
                        {groundD && (
                          <path
                            d={groundD}
                            fill="none"
                            stroke="rgba(148, 163, 184, 0.42)"
                            strokeWidth="1.2"
                            strokeDasharray="3 3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        )}

                        {/* Vertical Contact Height Drop-Line to Turf Shadow + Stump Height Drop-Line */}
                        <line
                          x1={impScreen.x}
                          y1={impScreen.y}
                          x2={impGroundScreen.x}
                          y2={impGroundScreen.y}
                          stroke="rgba(34, 211, 238, 0.55)"
                          strokeWidth="1.2"
                          strokeDasharray="2.5 2.5"
                        />
                        <ellipse
                          cx={impGroundScreen.x}
                          cy={impGroundScreen.y}
                          rx="4.5"
                          ry="2.2"
                          fill="rgba(34, 211, 238, 0.25)"
                          stroke="rgba(34, 211, 238, 0.65)"
                          strokeWidth="1"
                        />
                        <line
                          x1={stumpHitScreen.x}
                          y1={stumpHitScreen.y}
                          x2={stumpGroundScreen.x}
                          y2={stumpGroundScreen.y}
                          stroke={postTubeColor}
                          strokeWidth="1.1"
                          strokeDasharray="2 2"
                          opacity="0.65"
                        />

                        {/* 2. Phase 1: Bowler Release -> Pitch Bounce (B) Aerial Arc */}
                        {preD && (
                          <>
                            <path
                              d={preD}
                              fill="none"
                              stroke="rgba(16, 185, 129, 0.22)"
                              strokeWidth="6.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <path
                              d={preD}
                              fill="none"
                              stroke="#10B981"
                              strokeWidth="2.2"
                              strokeDasharray="5 3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              opacity="0.88"
                            />
                            <circle
                              cx={relScreen.x}
                              cy={relScreen.y}
                              r="3.6"
                              fill="#10B981"
                              stroke="#05080F"
                              strokeWidth="1.2"
                            />
                            <text
                              x={relScreen.x + 7}
                              y={relScreen.y + 3}
                              fill="#6EE7B7"
                              fontSize="9"
                              fontFamily="monospace"
                              fontWeight="bold"
                            >
                              R
                            </text>
                          </>
                        )}

                        {/* 3. Phase 2: Bounce (B) -> Contact (C) Volumetric Hawk-Eye Rebound Tube */}
                        {midD && (
                          <>
                            <path
                              d={midD}
                              fill="none"
                              stroke="rgba(34, 211, 238, 0.24)"
                              strokeWidth="9.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <path
                              d={midD}
                              fill="none"
                              stroke="#22D3EE"
                              strokeWidth="3.2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <path
                              d={midD}
                              fill="none"
                              stroke="rgba(255, 255, 255, 0.78)"
                              strokeWidth="1.1"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </>
                        )}

                        {/* Stroboscopic Ghost Ball Markers along the trajectory tube */}
                        {activeVideoTrajectory2D.ghostMarkers2D.map(
                          (gm, gIdx) => {
                            const gs = toScreen(gm.point);
                            const rPx = clamp(
                              gm.radiusNorm * contentRect.width,
                              3.2,
                              6.5
                            );
                            const isPost = gm.phase === 'POST_IMPACT';
                            return (
                              <circle
                                key={gIdx}
                                cx={gs.x}
                                cy={gs.y}
                                r={rPx}
                                fill={
                                  isPost
                                    ? postGlowColor
                                    : 'rgba(34, 211, 238, 0.22)'
                                }
                                stroke={isPost ? postTubeColor : '#67E8F9'}
                                strokeWidth="1.1"
                                opacity={isPost ? 0.85 : 0.72}
                              />
                            );
                          }
                        )}

                        {/* 4. Phase 3: Contact (C) -> Striker Stumps (Z = 0) DRS Continuation Tube */}
                        {postD && (
                          <>
                            <path
                              d={postD}
                              fill="none"
                              stroke={postGlowColor}
                              strokeWidth="8.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <path
                              d={postD}
                              fill="none"
                              stroke={postTubeColor}
                              strokeWidth="2.8"
                              strokeDasharray={
                                activeTrajectoryPred.hittingWicket
                                  ? undefined
                                  : '5 3'
                              }
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </>
                        )}

                        {/* 5. Striker Stump Impact Target Bullseye & Live Verdict Pill */}
                        <circle
                          cx={stumpHitScreen.x}
                          cy={stumpHitScreen.y}
                          r="9.5"
                          fill={postGlowColor}
                          stroke={postTubeColor}
                          strokeWidth="1.5"
                        />
                        <circle
                          cx={stumpHitScreen.x}
                          cy={stumpHitScreen.y}
                          r="4.2"
                          fill={postTubeColor}
                          stroke="#FFFFFF"
                          strokeWidth="1.3"
                        />
                        <g
                          transform={`translate(${Math.round(
                            clamp(
                              stumpHitScreen.x - 68,
                              contentRect.left + 8,
                              contentRect.left + contentRect.width - 148
                            )
                          )}, ${Math.round(
                            Math.max(
                              contentRect.top + 10,
                              stumpHitScreen.y - 28
                            )
                          )})`}
                        >
                          <rect
                            x="0"
                            y="0"
                            width="140"
                            height="18"
                            rx="4"
                            fill="rgba(5, 8, 15, 0.88)"
                            stroke={postTubeColor}
                            strokeWidth="1"
                          />
                          <text
                            x="70"
                            y="12.5"
                            textAnchor="middle"
                            fill={
                              isFullHitVerdict
                                ? '#FDA4AF'
                                : isGrazeVerdict
                                ? '#FDE68A'
                                : '#7DD3FC'
                            }
                            fontSize="9"
                            fontFamily="monospace"
                            fontWeight="bold"
                          >
                            {activeTrajectoryPred.verdictLabel} ·{' '}
                            {Math.round(
                              activeTrajectoryPred.stumpIntersection3D.yCm
                            )}
                            cm
                          </text>
                        </g>
                      </g>
                    );
                  })()}

                {/* Stroboscopic Optical Tracked Waypoints + Progressive Frame-by-Frame Ball Follower Reticle */}
                {activeTrackedWaypoints.length > 0 && (
                  <g className="pointer-events-none">
                    {/* Progressive Followed Ball Trail up to currentTime */}
                    {activeBallLockAtCurrentFrame &&
                      activeBallLockAtCurrentFrame.trailPoints.length >= 2 && (
                        <>
                          <polyline
                            fill="none"
                            stroke="rgba(251, 191, 36, 0.28)"
                            strokeWidth="7"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            points={activeBallLockAtCurrentFrame.trailPoints
                              .map(
                                (pt) =>
                                  `${(
                                    contentRect.left +
                                    pt.x * contentRect.width
                                  ).toFixed(1)},${(
                                    contentRect.top +
                                    pt.y * contentRect.height
                                  ).toFixed(1)}`
                              )
                              .join(' ')}
                          />
                          <polyline
                            fill="none"
                            stroke="#FBBF24"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            points={activeBallLockAtCurrentFrame.trailPoints
                              .map(
                                (pt) =>
                                  `${(
                                    contentRect.left +
                                    pt.x * contentRect.width
                                  ).toFixed(1)},${(
                                    contentRect.top +
                                    pt.y * contentRect.height
                                  ).toFixed(1)}`
                              )
                              .join(' ')}
                          />
                        </>
                      )}

                    {/* Individual Frame Waypoint Dots */}
                    {activeTrackedWaypoints.map((wp, idx) => {
                      const sx =
                        contentRect.left + wp.point.x * contentRect.width;
                      const sy =
                        contentRect.top + wp.point.y * contentRect.height;
                      const isBounce = wp.phase === 'BOUNCE';
                      const isContact = wp.phase === 'CONTACT';
                      const isVisited = wp.timestampSec <= currentTime + 0.008;
                      return (
                        <circle
                          key={`wp-${idx}`}
                          cx={sx}
                          cy={sy}
                          r={isBounce || isContact ? 4.8 : 3.4}
                          fill={
                            isBounce
                              ? 'rgba(16, 185, 129, 0.92)'
                              : isContact
                              ? 'rgba(34, 211, 238, 0.95)'
                              : isVisited
                              ? 'rgba(251, 191, 36, 0.92)'
                              : 'rgba(148, 163, 184, 0.45)'
                          }
                          stroke="#05080F"
                          strokeWidth="1.1"
                        />
                      );
                    })}

                    {/* Live Frame-Synced Ball Lock Reticle (Follows Ball Frame-by-Frame) */}
                    {activeBallLockAtCurrentFrame &&
                      (() => {
                        const lx =
                          contentRect.left +
                          activeBallLockAtCurrentFrame.point.x *
                            contentRect.width;
                        const ly =
                          contentRect.top +
                          activeBallLockAtCurrentFrame.point.y *
                            contentRect.height;
                        return (
                          <g>
                            <circle
                              cx={lx}
                              cy={ly}
                              r="14"
                              fill="rgba(251, 191, 36, 0.14)"
                              stroke="#FBBF24"
                              strokeWidth="1.6"
                              strokeDasharray="4 2.5"
                            />
                            <circle
                              cx={lx}
                              cy={ly}
                              r="5"
                              fill="#FDE047"
                              stroke="#05080F"
                              strokeWidth="1.4"
                            />
                            {/* Target Crosshair Ticks */}
                            <line
                              x1={lx - 19}
                              y1={ly}
                              x2={lx - 11}
                              y2={ly}
                              stroke="#FBBF24"
                              strokeWidth="1.5"
                            />
                            <line
                              x1={lx + 11}
                              y1={ly}
                              x2={lx + 19}
                              y2={ly}
                              stroke="#FBBF24"
                              strokeWidth="1.5"
                            />
                            <line
                              x1={lx}
                              y1={ly - 19}
                              x2={lx}
                              y2={ly - 11}
                              stroke="#FBBF24"
                              strokeWidth="1.5"
                            />
                            <line
                              x1={lx}
                              y1={ly + 11}
                              x2={lx}
                              y2={ly + 19}
                              stroke="#FBBF24"
                              strokeWidth="1.5"
                            />
                            <rect
                              x={lx + 15}
                              y={ly - 18}
                              width="116"
                              height="16"
                              rx="3.5"
                              fill="rgba(5, 8, 15, 0.88)"
                              stroke="#FBBF24"
                              strokeWidth="1"
                            />
                            <text
                              x={lx + 73}
                              y={ly - 7}
                              textAnchor="middle"
                              fill="#FEF08A"
                              fontSize="8.5"
                              fontFamily="monospace"
                              fontWeight="bold"
                            >
                              BALL LOCK · F#{currentFrameNumber}
                            </text>
                          </g>
                        );
                      })()}
                  </g>
                )}

                {/* Bowler Release Plumb-Line to 18.90m Popping Crease Ground Plane */}
                {resolvedReleasePoint && (
                  (() => {
                    const rScr = {
                      x: contentRect.left + resolvedReleasePoint.x * contentRect.width,
                      y: contentRect.top + resolvedReleasePoint.y * contentRect.height,
                    };
                    const groundNorm = cameraTelemetry.reconstructedReleaseGround2D || {
                      x: resolvedReleasePoint.x,
                      y: cameraTelemetry.virtualReleaseCrease2D.y,
                    };
                    const gScr = {
                      x: contentRect.left + groundNorm.x * contentRect.width,
                      y: contentRect.top + groundNorm.y * contentRect.height,
                    };
                    const relHt = cameraTelemetry.reconstructedReleaseHeightCm ?? 185;

                    return (
                      <g key="release-plumb-shadow" pointerEvents="none" opacity={0.9}>
                        <line
                          x1={rScr.x}
                          y1={rScr.y}
                          x2={gScr.x}
                          y2={gScr.y}
                          stroke="rgba(167, 139, 250, 0.75)"
                          strokeWidth="1.5"
                          strokeDasharray="3 3"
                        />
                        {/* Crease ground shadow reticle */}
                        <circle
                          cx={gScr.x}
                          cy={gScr.y}
                          r="3"
                          fill="none"
                          stroke="#C4B5FD"
                          strokeWidth="1.2"
                        />
                        <line
                          x1={gScr.x - 5}
                          y1={gScr.y}
                          x2={gScr.x + 5}
                          y2={gScr.y}
                          stroke="#C4B5FD"
                          strokeWidth="1"
                        />
                        {/* Height badge */}
                        <rect
                          x={(rScr.x + gScr.x) / 2 + 6}
                          y={(rScr.y + gScr.y) / 2 - 8}
                          width="56"
                          height="14"
                          rx="3"
                          fill="rgba(5, 8, 15, 0.88)"
                          stroke="rgba(167, 139, 250, 0.55)"
                          strokeWidth="0.8"
                        />
                        <text
                          x={(rScr.x + gScr.x) / 2 + 34}
                          y={(rScr.y + gScr.y) / 2 + 2.5}
                          textAnchor="middle"
                          fill="#DDD6FE"
                          fontSize="8.5"
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          Ht {relHt}cm
                        </text>
                      </g>
                    );
                  })()
                )}

                {/* Bowler Release Point Marker (R) on Video (Directly Draggable) */}
                {resolvedReleasePoint && (
                  <g
                    className="pointer-events-auto cursor-grab active:cursor-grabbing"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setClickMode('MANUAL_RELEASE');
                      setDragHandle('RELEASE_POINT');
                    }}
                  >
                    <circle
                      cx={
                        contentRect.left +
                        resolvedReleasePoint.x * contentRect.width
                      }
                      cy={
                        contentRect.top +
                        resolvedReleasePoint.y * contentRect.height
                      }
                      r="11"
                      fill="rgba(167, 139, 250, 0.22)"
                      stroke="#A78BFA"
                      strokeWidth="1.6"
                    />
                    <circle
                      cx={
                        contentRect.left +
                        resolvedReleasePoint.x * contentRect.width
                      }
                      cy={
                        contentRect.top +
                        resolvedReleasePoint.y * contentRect.height
                      }
                      r="4.5"
                      fill="#A78BFA"
                      stroke="#05080F"
                      strokeWidth="1.2"
                    />
                    <text
                      x={
                        contentRect.left +
                        resolvedReleasePoint.x * contentRect.width +
                        13
                      }
                      y={
                        contentRect.top +
                        resolvedReleasePoint.y * contentRect.height +
                        3
                      }
                      fill="#DDD6FE"
                      fontSize="10"
                      fontFamily="monospace"
                      fontWeight="bold"
                    >
                      R ·{' '}
                      {activeReleaseAngleLabel ||
                        (activeTrajectoryPred
                          ? `${activeTrajectoryPred.entryPoint3D.xCm > 0 ? '+' : ''}${activeTrajectoryPred.entryPoint3D.xCm.toFixed(0)}cm`
                          : 'Release')}
                    </text>
                  </g>
                )}

                {/* Step 1: Bounce Marker (B) on Pitch (Directly Draggable) */}
                {resolvedBouncePoint && (
                  <g
                    className="pointer-events-auto cursor-grab active:cursor-grabbing"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setClickMode('MANUAL_BOUNCE');
                      setDragHandle('BOUNCE_POINT');
                    }}
                  >
                    <ellipse
                      cx={
                        contentRect.left +
                        resolvedBouncePoint.x * contentRect.width
                      }
                      cy={
                        contentRect.top +
                        resolvedBouncePoint.y * contentRect.height
                      }
                      rx="12"
                      ry="7"
                      fill="rgba(16, 185, 129, 0.22)"
                      stroke="#10B981"
                      strokeWidth="1.7"
                    />
                    <circle
                      cx={
                        contentRect.left +
                        resolvedBouncePoint.x * contentRect.width
                      }
                      cy={
                        contentRect.top +
                        resolvedBouncePoint.y * contentRect.height
                      }
                      r="4.5"
                      fill="#10B981"
                      stroke="#05080F"
                      strokeWidth="1.2"
                    />
                    <text
                      x={
                        contentRect.left +
                        resolvedBouncePoint.x * contentRect.width +
                        14
                      }
                      y={
                        contentRect.top +
                        resolvedBouncePoint.y * contentRect.height +
                        3
                      }
                      fill="#6EE7B7"
                      fontSize="10"
                      fontFamily="monospace"
                      fontWeight="bold"
                    >
                      B · {resolvedBounceLengthM.toFixed(1)}m
                    </text>
                  </g>
                )}

                {/* Step 2: Contact Point Marker (C) (Directly Draggable) */}
                {activeImpactPoint && (
                  <g
                    className="pointer-events-auto cursor-grab active:cursor-grabbing"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setClickMode('MANUAL_CONTACT');
                      setDragHandle('CONTACT_POINT');
                    }}
                  >
                    {activeIsOut && (
                      <circle
                        cx={
                          contentRect.left +
                          activeImpactPoint.x * contentRect.width
                        }
                        cy={
                          contentRect.top +
                          activeImpactPoint.y * contentRect.height
                        }
                        r="11.5"
                        fill="none"
                        stroke="#F43F5E"
                        strokeWidth="1.6"
                        opacity="0.85"
                      />
                    )}
                    <circle
                      cx={
                        contentRect.left + activeImpactPoint.x * contentRect.width
                      }
                      cy={
                        contentRect.top + activeImpactPoint.y * contentRect.height
                      }
                      r="6"
                      fill={activeIsOut ? '#F43F5E' : '#22D3EE'}
                      stroke="#05080F"
                      strokeWidth="1.5"
                    />
                    <text
                      x={
                        contentRect.left +
                        activeImpactPoint.x * contentRect.width +
                        12
                      }
                      y={
                        contentRect.top +
                        activeImpactPoint.y * contentRect.height +
                        3
                      }
                      fill={activeIsOut ? '#FDA4AF' : '#67E8F9'}
                      fontSize="10"
                      fontFamily="monospace"
                      fontWeight="bold"
                    >
                      C · Ht {activeProjection?.contactHeightCm ?? 38}cm
                    </text>
                  </g>
                )}
              </svg>
            )}
          </div>

          {/* Floating Precision Magnifier Loupe with Hairline Crosshair Reticle (Active in Release, Bounce & Contact modes) */}
          {showLoupe &&
            isHoveringVideo &&
            pointerPos &&
            (clickMode === 'MANUAL_RELEASE' ||
              clickMode === 'MANUAL_BOUNCE' ||
              clickMode === 'MANUAL_CONTACT' ||
              dragHandle === 'RELEASE_POINT' ||
              dragHandle === 'BOUNCE_POINT' ||
              dragHandle === 'CONTACT_POINT') && (
              <div
                className={`absolute z-40 pointer-events-none rounded-full overflow-hidden border-2 bg-[#05080F]/90 flex items-center justify-center transition-[left,top] duration-75 ${
                  clickMode === 'MANUAL_RELEASE' ||
                  dragHandle === 'RELEASE_POINT'
                    ? 'border-violet-400 shadow-[0_0_24px_rgba(167,139,250,0.45)]'
                    : clickMode === 'MANUAL_BOUNCE' ||
                      dragHandle === 'BOUNCE_POINT'
                    ? 'border-emerald-400 shadow-[0_0_24px_rgba(16,185,129,0.45)]'
                    : 'border-cyan-400 shadow-[0_0_24px_rgba(34,211,238,0.45)]'
                }`}
                style={{
                  width: 150,
                  height: 150,
                  left: Math.max(
                    8,
                    Math.min(
                      stageDims.width - 158,
                      pointerPos.stageX + 24 > stageDims.width - 160
                        ? pointerPos.stageX - 174
                        : pointerPos.stageX + 24
                    )
                  ),
                  top: Math.max(
                    8,
                    Math.min(
                      stageDims.height - 158,
                      pointerPos.stageY - 80 < 8
                        ? pointerPos.stageY + 24
                        : pointerPos.stageY - 80
                    )
                  ),
                }}
              >
                <canvas
                  ref={loupeCanvasRef}
                  width={150}
                  height={150}
                  className="w-full h-full block rounded-full"
                />
                <div className="absolute top-1.5 inset-x-0 flex justify-center pointer-events-none">
                  <span
                    className={`bg-slate-950/90 border text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.2 rounded shadow ${
                      clickMode === 'MANUAL_RELEASE' ||
                      dragHandle === 'RELEASE_POINT'
                        ? 'border-violet-500/60 text-violet-300'
                        : clickMode === 'MANUAL_BOUNCE' ||
                          dragHandle === 'BOUNCE_POINT'
                        ? 'border-emerald-500/60 text-emerald-300'
                        : 'border-cyan-500/60 text-cyan-300'
                    }`}
                  >
                    {clickMode === 'MANUAL_RELEASE' ||
                    dragHandle === 'RELEASE_POINT'
                      ? 'R. Point Release'
                      : clickMode === 'MANUAL_BOUNCE' ||
                        dragHandle === 'BOUNCE_POINT'
                      ? '1. Point Bounce'
                      : '2. Point Contact'}
                  </span>
                </div>
                <div className="absolute bottom-1.5 inset-x-0 flex justify-center pointer-events-none">
                  <span className="bg-slate-950/85 border border-slate-700 text-[9px] font-mono tabular-nums text-slate-200 px-1.5 py-0.2 rounded shadow">
                    X:{(pointerPos.normX * 100).toFixed(1)}% Y:
                    {(pointerPos.normY * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            )}

          {/* Auto-Track Ball & V-Inflection Scanning Indicator */}
          {(isAutoTrackingBall || isAnalyzingBounce) && (
            <div className="absolute top-3 right-3 z-30 pointer-events-none inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#05080F]/90 border border-cyan-400/70 text-xs font-mono text-cyan-200 shadow-lg">
              <Sparkles className="w-3.5 h-3.5 animate-spin text-cyan-400" />
              <span>
                {isAutoTrackingBall
                  ? `${autoTrackStatusText || 'Tracking delivery...'} (${autoTrackProgressPct}%)`
                  : 'Scanning Bounce...'}
              </span>
            </div>
          )}

          {/* Auto-Hide Active Drag Indicator: ONLY shown while actively dragging */}
          {dragHandle !== 'NONE' && (
            <div className="absolute top-3 left-3 z-20 pointer-events-none px-2.5 py-1 rounded-md bg-slate-950/85 border border-slate-700/80 text-[11px] font-mono text-slate-200">
              {dragHandle === 'BACK_STUMPS' && 'Moving Striker Stumps'}
              {dragHandle === 'BACK_STUMPS_RESIZE' && 'Resizing Striker Stumps'}
              {dragHandle === 'FRONT_STUMPS' &&
                (isArrowMode ? 'Moving Pitch Arrow' : 'Moving Bowler Stumps')}
              {dragHandle === 'FRONT_STUMPS_RESIZE' && 'Resizing Bowler Stumps'}
              {dragHandle === 'RELEASE_POINT' && 'R. Bowler Release Pointed'}
              {dragHandle === 'BOUNCE_POINT' &&
                `1. Bounce Marked · ${resolvedBounceLengthM.toFixed(2)}m`}
              {dragHandle === 'CONTACT_POINT' &&
                `2. Contact Marked · Bounce ${resolvedBounceLengthM.toFixed(2)}m`}
            </div>
          )}

          {/* Subtle Mode Hint Pill on Video */}
          {dragHandle === 'NONE' && (
            <div className="absolute top-3 left-3 z-20 pointer-events-none">
              {clickMode === 'MANUAL_RELEASE' ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-950/85 border border-violet-500/50 text-[11px] font-mono text-violet-300 shadow">
                  <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
                  <span>Step R: Click bowler ball release point (any angle)</span>
                </span>
              ) : clickMode === 'MANUAL_BOUNCE' ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-950/85 border border-emerald-500/50 text-[11px] font-mono text-emerald-300 shadow">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Step 1: Click ball bounce on pitch</span>
                </span>
              ) : clickMode === 'MANUAL_CONTACT' ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-950/85 border border-cyan-500/50 text-[11px] font-mono text-cyan-300 shadow">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                  <span>Step 2: Click bat-ball contact point</span>
                </span>
              ) : null}
            </div>
          )}

          {/* Fullscreen Toggle Button on Video */}
          <button
            type="button"
            data-handle="FULLSCREEN_TOGGLE"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setIsFullscreen((v) => !v);
            }}
            className="absolute bottom-3 right-3 z-30 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-950/85 hover:bg-slate-900 border border-slate-700 text-xs font-medium text-white shadow-lg cursor-pointer transition"
            title={isFullscreen ? 'Exit Fullscreen (Esc)' : 'Fullscreen'}
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="w-3.5 h-3.5 text-cyan-400" />
                <span>Exit Fullscreen</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5 text-cyan-400" />
                <span>Fullscreen</span>
              </>
            )}
          </button>
        </div>

        {/* Fullscreen Quick Controls Bar (Only shown when in Fullscreen) */}
        {isFullscreen && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800">
                <button
                  type="button"
                  onClick={() => setClickMode('MANUAL_RELEASE')}
                  className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer ${
                    clickMode === 'MANUAL_RELEASE'
                      ? 'bg-violet-400 text-slate-950 font-bold'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  R. Point Release
                </button>
                <button
                  type="button"
                  onClick={() => setClickMode('MANUAL_BOUNCE')}
                  className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer ${
                    clickMode === 'MANUAL_BOUNCE'
                      ? 'bg-emerald-400 text-slate-950 font-bold'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  1. Point Bounce
                </button>
                <button
                  type="button"
                  onClick={() => setClickMode('MANUAL_CONTACT')}
                  className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer ${
                    clickMode === 'MANUAL_CONTACT'
                      ? 'bg-cyan-400 text-slate-950 font-bold'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  2. Point Contact
                </button>
                <button
                  type="button"
                  onClick={() => setClickMode('BACK_STUMPS')}
                  className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer ${
                    clickMode === 'BACK_STUMPS'
                      ? 'bg-amber-400 text-slate-950 font-bold'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Striker Stumps
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setClickMode('FRONT_STUMPS');
                    if (isArrowMode) setStumpEditAction('MOVE');
                  }}
                  className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer ${
                    clickMode === 'FRONT_STUMPS'
                      ? 'bg-sky-400 text-slate-950 font-bold'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {isArrowMode ? 'Pitch Arrow' : 'Bowler Stumps'}
                </button>
              </div>

              {clickMode !== 'MANUAL_RELEASE' &&
                clickMode !== 'MANUAL_CONTACT' &&
                clickMode !== 'MANUAL_BOUNCE' && (
                  <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800">
                    <button
                      type="button"
                      onClick={() => setStumpEditAction('MOVE')}
                      className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer ${
                        stumpEditAction === 'MOVE'
                          ? 'bg-slate-800 text-amber-300 font-bold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Move
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setStumpEditAction('RESIZE');
                        if (clickMode === 'FRONT_STUMPS' && isArrowMode) {
                          setClickMode('BACK_STUMPS');
                        }
                      }}
                      className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer ${
                        stumpEditAction === 'RESIZE'
                          ? 'bg-slate-800 text-amber-300 font-bold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Resize
                    </button>
                  </div>
                )}

              <button
                type="button"
                onClick={() => setShowCalibrationGrid((v) => !v)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-semibold cursor-pointer transition ${
                  showCalibrationGrid
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                    : 'bg-slate-950 hover:bg-slate-800 border-slate-800 text-slate-300'
                }`}
              >
                <Grid className="w-3.5 h-3.5" />
                <span>Grid</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              {pendingPreview && (
                <button
                  type="button"
                  onClick={handleSaveAndResetDelivery}
                  className="inline-flex items-center gap-1 px-3 py-1 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-zinc-950 text-xs font-bold cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Save Delivery</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsFullscreen(false)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-white/10 text-xs text-zinc-200 cursor-pointer"
              >
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Done</span>
              </button>
            </div>
          </div>
        )}

        {/* Transport, Scrubber & Simple Delivery Sequence Trim Interface */}
        <div className="bg-[#11131A] border border-white/[0.07] rounded-2xl p-4 space-y-2.5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={togglePlay}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold cursor-pointer transition"
              >
                {isPlaying ? (
                  <>
                    <Pause className="w-3.5 h-3.5" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    <span>Play</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => stepFrame(-5)}
                className="px-2 py-1.5 rounded-lg bg-[#070A10] hover:bg-slate-800 border border-slate-800/80 text-xs font-mono tabular-nums text-slate-300 cursor-pointer"
              >
                -5f
              </button>
              <button
                type="button"
                onClick={() => stepFrame(-1)}
                className="inline-flex items-center px-2 py-1.5 rounded-lg bg-[#070A10] hover:bg-slate-800 border border-slate-800/80 text-xs font-mono tabular-nums text-slate-200 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>1f</span>
              </button>
              <button
                type="button"
                onClick={() => stepFrame(1)}
                className="inline-flex items-center px-2 py-1.5 rounded-lg bg-[#070A10] hover:bg-slate-800 border border-slate-800/80 text-xs font-mono tabular-nums text-slate-200 cursor-pointer"
              >
                <span>1f</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => stepFrame(5)}
                className="px-2 py-1.5 rounded-lg bg-[#070A10] hover:bg-slate-800 border border-slate-800/80 text-xs font-mono tabular-nums text-slate-300 cursor-pointer"
              >
                +5f
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowCalibrationGrid((v) => !v)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-mono cursor-pointer transition ${
                  showCalibrationGrid
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 font-semibold'
                    : 'bg-[#070A10] hover:bg-slate-800 border-slate-800/80 text-slate-300'
                }`}
                title="Overlay 1.22m perspective calibration grid matching wicket width"
              >
                <Grid className="w-3.5 h-3.5" />
                <span>Grid</span>
              </button>

              <button
                type="button"
                onClick={() => setShowOverlay((v) => !v)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#070A10] hover:bg-slate-800 border border-slate-800/80 text-xs font-mono text-slate-300 cursor-pointer"
              >
                {showOverlay ? (
                  <Eye className="w-3.5 h-3.5" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5" />
                )}
                <span>Overlay</span>
              </button>

              <button
                type="button"
                onClick={() => setIsTrimOpen((v) => !v)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-mono tabular-nums cursor-pointer transition ${
                  isTrimOpen
                    ? 'bg-amber-500/20 border-amber-400/70 text-amber-300 font-semibold'
                    : 'bg-[#070A10] hover:bg-slate-800 border-slate-800/80 text-slate-300'
                }`}
              >
                <Scissors className="w-3.5 h-3.5" />
                <span>
                  Trim ({startFrameNumber}f–{endFrameNumber}f)
                </span>
              </button>

              <div className="flex items-center bg-[#070A10] p-0.5 rounded-lg border border-slate-800/80">
                {[0.25, 0.5, 1.0].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => {
                      setPlaybackRate(rate);
                      if (videoRef.current) videoRef.current.playbackRate = rate;
                    }}
                    className={`px-2 py-0.5 rounded text-[11px] font-mono tabular-nums cursor-pointer ${
                      playbackRate === rate
                        ? 'bg-slate-800 text-cyan-300 font-semibold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>

              <span className="text-xs font-mono tabular-nums text-slate-300 bg-[#070A10] px-2.5 py-1 rounded-lg border border-slate-800/80">
                F{currentFrameNumber}/{totalFrameCount} · {currentTime.toFixed(2)}s
              </span>
            </div>
          </div>

          {/* Main Scrubber bounded to [trimStart, trimEnd] */}
          <input
            type="range"
            min={trimStart}
            max={Math.max(trimStart + 0.04, trimEnd)}
            step={0.01}
            value={clamp(
              currentTime,
              trimStart,
              Math.max(trimStart + 0.04, trimEnd)
            )}
            onChange={(e) => seekToSecond(parseFloat(e.target.value))}
            className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
          />

          {/* Simple Delivery Sequence Frame Trim Interface */}
          {isTrimOpen && (
            <div className="pt-2.5 border-t border-slate-800/80 bg-[#070A10] rounded-lg p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Scissors className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-[11px] font-mono uppercase tracking-wider text-amber-300 font-semibold">
                    Delivery Sequence Trim (Start & End Frame)
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      hasCustomTrimRef.current = true;
                      const nextStart = clamp(
                        currentTime,
                        0,
                        Math.max(0, trimEnd - 0.05)
                      );
                      setTrimStart(nextStart);
                      registerRecentVideo(
                        videoName,
                        videoUrl,
                        duration,
                        nextStart,
                        trimEnd
                      );
                      buildFilmstripForWindow(nextStart, trimEnd);
                    }}
                    className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] font-mono tabular-nums text-amber-300 cursor-pointer"
                  >
                    Set Start = F{currentFrameNumber}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      hasCustomTrimRef.current = true;
                      const nextEnd = clamp(
                        currentTime,
                        Math.min(duration, trimStart + 0.05),
                        Math.max(0.1, duration)
                      );
                      setTrimEnd(nextEnd);
                      registerRecentVideo(
                        videoName,
                        videoUrl,
                        duration,
                        trimStart,
                        nextEnd
                      );
                      buildFilmstripForWindow(trimStart, nextEnd);
                    }}
                    className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[11px] font-mono tabular-nums text-amber-300 cursor-pointer"
                  >
                    Set End = F{currentFrameNumber}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      hasCustomTrimRef.current = false;
                      setTrimStart(0);
                      setTrimEnd(duration);
                      registerRecentVideo(videoName, videoUrl, duration, 0, duration);
                      buildFilmstripForWindow(0, duration);
                    }}
                    className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] font-mono text-slate-400 hover:text-white cursor-pointer"
                  >
                    Reset Full
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                <div className="sm:col-span-5">
                  <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-400 mb-1">
                    <span>Start Frame: #{startFrameNumber}</span>
                    <span className="text-amber-300">{trimStart.toFixed(2)}s</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0.05, trimEnd - 0.05)}
                    step={1 / 30}
                    value={trimStart}
                    onChange={(e) => {
                      hasCustomTrimRef.current = true;
                      const v = parseFloat(e.target.value);
                      setTrimStart(v);
                      if (currentTime < v) seekToSecond(v);
                    }}
                    className="w-full accent-amber-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                  />
                </div>

                <div className="sm:col-span-5">
                  <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-400 mb-1">
                    <span>End Frame: #{endFrameNumber}</span>
                    <span className="text-amber-300">{trimEnd.toFixed(2)}s</span>
                  </div>
                  <input
                    type="range"
                    min={Math.min(duration, trimStart + 0.05)}
                    max={Math.max(0.1, duration)}
                    step={1 / 30}
                    value={trimEnd}
                    onChange={(e) => {
                      hasCustomTrimRef.current = true;
                      const v = parseFloat(e.target.value);
                      setTrimEnd(v);
                      if (currentTime > v) seekToSecond(v);
                    }}
                    className="w-full accent-amber-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                  />
                </div>

                <div className="sm:col-span-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      registerRecentVideo(
                        videoName,
                        videoUrl,
                        duration,
                        trimStart,
                        trimEnd
                      );
                      buildFilmstripForWindow(trimStart, trimEnd);
                    }}
                    className="w-full py-1.5 px-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold cursor-pointer transition"
                  >
                    Update Strip
                  </button>
                </div>
              </div>
            </div>
          )}

          {!isFullscreen && filmstripFrames.length > 0 && (
            <div className="pt-2 border-t border-slate-800/80">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-mono tabular-nums uppercase tracking-wider text-slate-400">
                  Delivery Frame Strip ({startFrameNumber}f–{endFrameNumber}f)
                </span>
                <button
                  type="button"
                  onClick={() => setShowFilmstrip((v) => !v)}
                  className="text-[11px] font-mono text-cyan-400 hover:underline cursor-pointer"
                >
                  {showFilmstrip ? 'Hide' : 'Show'}
                </button>
              </div>
              {showFilmstrip && (
                <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
                  {filmstripFrames.map((f) => {
                    const isNearCurrent =
                      Math.abs(currentTime - f.timestampSec) < 0.04;
                    const fNum = Math.max(1, Math.round(f.timestampSec * 30) + 1);
                    return (
                      <button
                        key={f.index}
                        type="button"
                        onClick={() => seekToSecond(f.timestampSec)}
                        className={`rounded-lg overflow-hidden border transition cursor-pointer ${
                          isNearCurrent
                            ? 'border-cyan-400 ring-1 ring-cyan-400/50'
                            : 'border-slate-800/80 hover:border-slate-600'
                        }`}
                      >
                        {f.thumbUrl ? (
                          <img
                            src={f.thumbUrl}
                            alt={`Frame ${fNum}`}
                            className="w-full h-12 object-cover block"
                          />
                        ) : (
                          <div className="w-full h-12 bg-slate-900" />
                        )}
                        <div className="bg-[#070A10] px-1 py-0.5 text-[10px] font-mono tabular-nums text-slate-300 text-center">
                          F{fNum} · {f.timestampSec.toFixed(2)}s
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT 4 COLUMNS: MINIMALIST CARBON STUDIO INSPECTOR */}
      <div className="lg:col-span-4 bg-[#0E0E0E] border border-white/10 rounded-2xl overflow-hidden shadow-xl">
        {/* Top Segmented Inspector Switcher */}
        <div className="p-2 border-b border-white/10 bg-[#0A0A0A]">
          <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#141414] border border-white/10">
            {[
              { id: 'TRACK' as const, label: 'Track Ball' },
              { id: 'CALIBRATE' as const, label: 'Calibrate' },
              { id: 'CLIP' as const, label: 'Video Clip' },
            ].map((tab) => {
              const active = rightInspectorTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setRightInspectorTab(tab.id)}
                  className={`py-2 px-2 rounded-lg text-xs font-semibold transition cursor-pointer text-center ${
                    active
                      ? 'bg-white text-black font-bold shadow-sm'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* TAB 3: VIDEO SOURCE & RECENTS */}
        <div
          className={
            rightInspectorTab === 'CLIP'
              ? 'p-4 space-y-3 animate-workspace-enter'
              : 'hidden'
          }
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Film className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-xs font-semibold text-white truncate">
                {videoName}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setIsFullscreen(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#141414] hover:bg-white/10 border border-white/10 text-xs font-medium text-white cursor-pointer transition"
                title="Open Fullscreen"
              >
                <Maximize2 className="w-3.5 h-3.5 text-zinc-400" />
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-black text-xs font-bold cursor-pointer transition"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Upload Video</span>
              </button>
            </div>
          </div>

          {/* Recents Dropdown (Last 5 Videos) */}
          <div className="flex items-center gap-2 bg-[#141414] border border-white/10 rounded-xl px-2.5 py-2">
            <Clock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="text-[11px] font-mono tabular-nums text-zinc-400 shrink-0">
              Recents ({recentVideos.length}/5):
            </span>
            <select
              value={
                recentVideos.find((r) => r.url === videoUrl)?.id ||
                recentVideos[0]?.id ||
                ''
              }
              onChange={(e) => handleSwitchRecentVideo(e.target.value)}
              className="flex-1 min-w-0 bg-transparent text-xs text-zinc-200 font-medium focus:outline-none cursor-pointer truncate"
            >
              {recentVideos.map((clip, i) => (
                <option
                  key={clip.id}
                  value={clip.id}
                  className="bg-zinc-950 text-zinc-200"
                >
                  {i + 1}. {clip.name} ({clip.durationSec.toFixed(1)}s)
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* TAB 1: ICC BROADCAST DRS BALL TRACKER & TELEMETRY HUD */}
        <div
          className={
            rightInspectorTab === 'TRACK'
              ? 'p-4 space-y-4 animate-workspace-enter'
              : 'hidden'
          }
        >
          {/* Top Status & Clip Header */}
          <div className="flex items-center justify-between pb-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <span className="text-xs font-mono uppercase tracking-widest text-white font-bold">
                HAWK-EYE DRS CONSOLE
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-[11px] font-mono text-emerald-400 hover:text-emerald-300 cursor-pointer font-semibold"
              >
                + Clip
              </button>
              {(stagedReleaseDraft || stagedBounceDraft || pendingPreview || selectedContact) && (
                <button
                  type="button"
                  onClick={() => {
                    setStagedReleaseDraft(null);
                    setStagedBounceDraft(null);
                    setLiveStreamingWaypoints([]);
                    setBounceDetectionInfo(null);
                    onDiscardPendingPreview();
                    onClearSelection();
                    setClickMode('MANUAL_BOUNCE');
                  }}
                  className="text-[11px] font-mono text-zinc-400 hover:text-rose-400 cursor-pointer"
                >
                  Clear Marks
                </button>
              )}
            </div>
          </div>

          {/* Point Tracking Steps Selector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-zinc-400 uppercase tracking-wider">
                {isUnseenRelease ? '2-Point Delivery Tracking' : '3-Point Trajectory Tracking'}
              </span>
              <button
                type="button"
                onClick={() => {
                  onChangeActiveStumps({
                    ...activeStumps,
                    releaseVisibilityMode: isUnseenRelease ? 'VISIBLE_RELEASE' : 'UNSEEN_RELEASE',
                  });
                }}
                className="text-emerald-400 hover:underline cursor-pointer"
              >
                {isUnseenRelease ? 'Enable Release (R)' : 'Hide Release'}
              </button>
            </div>

            <div className={`grid ${isUnseenRelease ? 'grid-cols-2' : 'grid-cols-3'} gap-2`}>
              {!isUnseenRelease && (
                <button
                  type="button"
                  onClick={() => setClickMode('MANUAL_RELEASE')}
                  className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                    clickMode === 'MANUAL_RELEASE'
                      ? 'bg-violet-500/15 border-violet-400 text-white shadow-sm'
                      : resolvedReleasePoint
                      ? 'bg-[#10141E] border-violet-500/40 text-zinc-200'
                      : 'bg-[#0E1118] border-white/10 text-zinc-400 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-violet-400 font-bold">
                      1 · Release (R)
                    </span>
                    {resolvedReleasePoint && <Check className="w-3.5 h-3.5 text-violet-400 stroke-[2.5]" />}
                  </div>
                  <div className="text-xs font-bold tabular-nums mt-1 truncate">
                    {resolvedReleasePoint ? 'Release Locked' : 'Mark Hand'}
                  </div>
                  <div className="text-[10px] text-zinc-400 mt-0.5 truncate">
                    {activeReleaseAngleLabel || 'Click bowler hand'}
                  </div>
                </button>
              )}

              <button
                type="button"
                onClick={() => setClickMode('MANUAL_BOUNCE')}
                className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                  clickMode === 'MANUAL_BOUNCE'
                    ? 'bg-emerald-500/15 border-emerald-400 text-white shadow-sm'
                    : resolvedBouncePoint
                    ? 'bg-[#10141E] border-emerald-500/40 text-zinc-200'
                    : 'bg-[#0E1118] border-white/10 text-zinc-400 hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 font-bold">
                    {isUnseenRelease ? '1 · Bounce (B)' : '2 · Bounce (B)'}
                  </span>
                  {resolvedBouncePoint && <Check className="w-3.5 h-3.5 text-emerald-400 stroke-[2.5]" />}
                </div>
                <div className="text-xs font-bold tabular-nums mt-1 truncate">
                  {resolvedBouncePoint
                    ? `${resolvedBounceLengthM.toFixed(2)}m Pitch`
                    : 'Click Turf Pitch'}
                </div>
                <div className="text-[10px] text-zinc-400 mt-0.5 truncate">
                  {resolvedBouncePoint
                    ? activeTrajectoryPred?.lengthCategoryLabel || 'Good Length'
                    : 'Tap ball bounce'}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setClickMode('MANUAL_CONTACT')}
                className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                  clickMode === 'MANUAL_CONTACT'
                    ? 'bg-cyan-500/15 border-cyan-400 text-white shadow-sm'
                    : activeImpactPoint
                    ? 'bg-[#10141E] border-cyan-500/40 text-zinc-200'
                    : 'bg-[#0E1118] border-white/10 text-zinc-400 hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 font-bold">
                    {isUnseenRelease ? '2 · Contact (C)' : '3 · Contact (C)'}
                  </span>
                  {activeImpactPoint && <Check className="w-3.5 h-3.5 text-cyan-400 stroke-[2.5]" />}
                </div>
                <div className="text-xs font-bold tabular-nums mt-1 truncate">
                  {activeProjection
                    ? `${activeProjection.contactHeightCm}cm High`
                    : 'Click Bat Impact'}
                </div>
                <div className="text-[10px] text-zinc-400 mt-0.5 truncate">
                  {activeProjection
                    ? `${activeProjection.offsetFromMiddleCm > 0 ? '+' : ''}${activeProjection.offsetFromMiddleCm.toFixed(1)}cm Line`
                    : 'Tap contact point'}
                </div>
              </button>
            </div>

            {/* Unseen Release Presets (Over/Around, Pace/Spin) */}
            {isUnseenRelease && (
              <div className="grid grid-cols-2 gap-1.5 pt-1">
                <div className="flex bg-[#0E1118] p-0.5 rounded-lg border border-white/10">
                  <button
                    type="button"
                    onClick={() =>
                      onChangeActiveStumps({
                        ...activeStumps,
                        releaseVisibilityMode: 'UNSEEN_RELEASE',
                        bowlerWicketSide: 'OVER_THE_WICKET',
                      })
                    }
                    className={`flex-1 py-1 rounded text-[10px] font-mono font-semibold transition cursor-pointer ${
                      activeBowlerWicketSide === 'OVER_THE_WICKET'
                        ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Over Wicket
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onChangeActiveStumps({
                        ...activeStumps,
                        releaseVisibilityMode: 'UNSEEN_RELEASE',
                        bowlerWicketSide: 'AROUND_THE_WICKET',
                      })
                    }
                    className={`flex-1 py-1 rounded text-[10px] font-mono font-semibold transition cursor-pointer ${
                      activeBowlerWicketSide === 'AROUND_THE_WICKET'
                        ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Around Wicket
                  </button>
                </div>

                <div className="flex bg-[#0E1118] p-0.5 rounded-lg border border-white/10">
                  <button
                    type="button"
                    onClick={() =>
                      onChangeActiveStumps({
                        ...activeStumps,
                        releaseVisibilityMode: 'UNSEEN_RELEASE',
                        bowlerSpeedType: 'PACE',
                      })
                    }
                    className={`flex-1 py-1 rounded text-[10px] font-mono font-semibold transition cursor-pointer ${
                      activeBowlerSpeedType === 'PACE'
                        ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Pace (204cm)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onChangeActiveStumps({
                        ...activeStumps,
                        releaseVisibilityMode: 'UNSEEN_RELEASE',
                        bowlerSpeedType: 'SPIN',
                      })
                    }
                    className={`flex-1 py-1 rounded text-[10px] font-mono font-semibold transition cursor-pointer ${
                      activeBowlerSpeedType === 'SPIN'
                        ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Spin (188cm)
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ICC OFFICIAL DRS DECISION BOARD (BROADCAST HOLOGRAPHIC TILES) */}
          {(resolvedBouncePoint || activeImpactPoint) && (
            <div className="p-3.5 rounded-2xl bg-[#090C12] border border-white/10 space-y-3 shadow-xl">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-400 font-bold flex items-center gap-1.5">
                  <Target className="w-3.5 h-3.5 text-emerald-400" />
                  <span>ICC DRS REVIEW BOARD</span>
                </span>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                  HAWK-EYE 3D
                </span>
              </div>

              {/* 3 DRS Broadcast Cards: Pitching · Impact · Wickets */}
              <div className="grid grid-cols-3 gap-2 text-center">
                {/* 1. Pitching */}
                <div className="p-2.5 rounded-xl bg-[#10141E] border border-white/10 flex flex-col justify-between">
                  <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">
                    Pitching
                  </span>
                  <div className="my-1">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-mono font-bold tracking-tight ${
                        activeTrajectoryPred?.pitchingZoneLabel?.toLowerCase().includes('in-line') ||
                        !activeTrajectoryPred?.pitchingZoneLabel
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      }`}
                    >
                      {activeTrajectoryPred?.pitchingZoneLabel?.toUpperCase() || 'IN LINE'}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-400 tabular-nums">
                    {resolvedBounceLengthM.toFixed(1)}m from stumps
                  </span>
                </div>

                {/* 2. Impact */}
                <div className="p-2.5 rounded-xl bg-[#10141E] border border-white/10 flex flex-col justify-between">
                  <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">
                    Impact
                  </span>
                  <div className="my-1">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-mono font-bold tracking-tight ${
                        activeProjection && Math.abs(activeProjection.offsetFromMiddleCm) <= 15
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      }`}
                    >
                      {activeProjection
                        ? Math.abs(activeProjection.offsetFromMiddleCm) <= 12
                          ? 'IN LINE'
                          : activeProjection.offsetFromMiddleCm > 12
                          ? 'OUTSIDE OFF'
                          : 'OUTSIDE LEG'
                        : 'AWAITING'}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-400 tabular-nums">
                    {activeProjection
                      ? `${activeProjection.offsetFromMiddleCm > 0 ? '+' : ''}${activeProjection.offsetFromMiddleCm.toFixed(1)}cm`
                      : 'Pending'}
                  </span>
                </div>

                {/* 3. Wickets */}
                <div className="p-2.5 rounded-xl bg-[#10141E] border border-white/10 flex flex-col justify-between">
                  <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">
                    Wickets
                  </span>
                  <div className="my-1">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-mono font-bold tracking-tight ${
                        activeProjection?.hittingStumps
                          ? 'bg-rose-500 text-white border border-rose-400 shadow-md'
                          : activeProjection
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {activeProjection?.hittingStumps
                        ? 'HITTING'
                        : activeProjection
                        ? 'MISSING'
                        : 'PROJECTION'}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-400 tabular-nums">
                    {activeProjection ? `${activeProjection.contactHeightCm}cm high` : 'Pending'}
                  </span>
                </div>
              </div>

              {/* Stump Impact Graphic (Wicket Silhouette + Ball Radar) */}
              {activeProjection && (
                <div className="p-3 rounded-xl bg-[#07090E] border border-white/10 flex items-center justify-between gap-3">
                  <svg viewBox="0 0 120 70" className="w-28 h-16 shrink-0 overflow-visible">
                    {/* Turf Ground Line */}
                    <line x1="5" y1="62" x2="115" y2="62" stroke="#10B981" strokeWidth="1.5" strokeOpacity="0.5" />
                    {/* 3 Stumps */}
                    <rect x="36" y="16" width="5" height="46" rx="1.5" fill="#E2E8F0" />
                    <rect x="58" y="16" width="5" height="46" rx="1.5" fill="#E2E8F0" />
                    <rect x="79" y="16" width="5" height="46" rx="1.5" fill="#E2E8F0" />
                    {/* Bails */}
                    <rect x="34" y="13" width="26" height="3" rx="1" fill="#F59E0B" />
                    <rect x="60" y="13" width="26" height="3" rx="1" fill="#F59E0B" />
                    {/* Impact Ball Indicator */}
                    {(() => {
                      const middleX = 60;
                      const groundY = 62;
                      const ballPxX = clamp(middleX + (activeProjection.offsetFromMiddleCm / 22.86) * 44, 10, 110);
                      const ballPxY = clamp(groundY - (activeProjection.contactHeightCm / 71.1) * 46, 6, 60);
                      const isHitting = activeProjection.hittingStumps;
                      return (
                        <g>
                          {/* Animated Radar Pulse Rings */}
                          <circle
                            cx={ballPxX}
                            cy={ballPxY}
                            r="14"
                            fill="none"
                            stroke={isHitting ? '#EF4444' : '#10B981'}
                            strokeWidth="1.5"
                            className="animate-radar-ping"
                          />
                          <circle
                            cx={ballPxX}
                            cy={ballPxY}
                            r="9"
                            fill={isHitting ? 'rgba(239, 68, 68, 0.25)' : 'rgba(16, 185, 129, 0.25)'}
                            stroke={isHitting ? '#EF4444' : '#10B981'}
                            strokeWidth="1.5"
                          />
                          <circle
                            cx={ballPxX}
                            cy={ballPxY}
                            r="5"
                            fill={isHitting ? '#EF4444' : '#10B981'}
                            stroke="#FFFFFF"
                            strokeWidth="1.5"
                          />
                        </g>
                      );
                    })()}
                  </svg>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-xs font-bold text-white flex items-center justify-between">
                      <span>{activeProjection.hittingStumps ? 'Hitting Stumps' : 'Missing Off/Leg'}</span>
                      <span className="text-[10px] font-mono text-emerald-400">
                        {activeProjection.zone || 'Wicket Zone'}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-zinc-400">
                      Line: <span className="text-white font-bold">{activeProjection.offsetFromMiddleCm > 0 ? `+${activeProjection.offsetFromMiddleCm.toFixed(1)}cm Off` : `${activeProjection.offsetFromMiddleCm.toFixed(1)}cm Leg`}</span>
                    </div>
                    <div className="text-[11px] font-mono text-zinc-400">
                      Height: <span className="text-white font-bold">{activeProjection.contactHeightCm} cm</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tactile Pitching Length Adjustment Slider */}
          {(resolvedBouncePoint || activeImpactPoint) && (
            <div className="p-3.5 rounded-2xl bg-[#090C12] border border-white/10 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-zinc-400 uppercase tracking-wider text-[10px]">
                  Pitching Distance (Turf to Stumps)
                </span>
                <span className="font-mono text-emerald-400 font-bold tabular-nums">
                  {resolvedBounceLengthM.toFixed(2)} m
                </span>
              </div>
              <input
                type="range"
                min={1.2}
                max={12.0}
                step={0.1}
                value={resolvedBounceLengthM}
                onChange={(e) => {
                  const nextM = parseFloat(e.target.value);
                  const currentBounce3D = resolvedBouncePoint
                    ? projectVideoBounceTo3DPitch(resolvedBouncePoint, activeStumps)
                    : { bounceXCm: activeProjection?.screenOffsetCm ?? 0 };
                  const nextBouncePt = project3DPitchBounceToVideo(
                    nextM,
                    currentBounce3D.bounceXCm,
                    activeStumps
                  );
                  setStagedBounceDraft({
                    bouncePoint: nextBouncePt,
                    bounceLengthM: nextM,
                    bounceTimestampSec: currentTime,
                  });
                  if (pendingPreview && onUpdatePendingMeta) {
                    onUpdatePendingMeta({
                      bounceLengthM: nextM,
                      bouncePoint: nextBouncePt,
                    });
                  } else if (isEditingUnlockedContact && selectedContact && onUpdateContactMeta) {
                    onUpdateContactMeta(selectedContact.id, {
                      bounceLengthM: nextM,
                      bouncePoint: nextBouncePt,
                    });
                  }
                }}
                className="w-full accent-emerald-400 cursor-pointer h-2 bg-zinc-800 rounded-lg"
              />
              <div className="grid grid-cols-4 gap-1 text-[10px] font-mono text-zinc-400 text-center">
                <button
                  type="button"
                  onClick={() => {
                    const nextM = 1.8;
                    const nextBouncePt = project3DPitchBounceToVideo(nextM, 0, activeStumps);
                    setStagedBounceDraft({ bouncePoint: nextBouncePt, bounceLengthM: nextM, bounceTimestampSec: currentTime });
                    if (pendingPreview && onUpdatePendingMeta) onUpdatePendingMeta({ bounceLengthM: nextM, bouncePoint: nextBouncePt });
                  }}
                  className="py-1 rounded bg-[#10141E] hover:text-white cursor-pointer"
                >
                  Yorker (1.8m)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const nextM = 4.0;
                    const nextBouncePt = project3DPitchBounceToVideo(nextM, 0, activeStumps);
                    setStagedBounceDraft({ bouncePoint: nextBouncePt, bounceLengthM: nextM, bounceTimestampSec: currentTime });
                    if (pendingPreview && onUpdatePendingMeta) onUpdatePendingMeta({ bounceLengthM: nextM, bouncePoint: nextBouncePt });
                  }}
                  className="py-1 rounded bg-[#10141E] hover:text-white cursor-pointer"
                >
                  Full (4.0m)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const nextM = 6.2;
                    const nextBouncePt = project3DPitchBounceToVideo(nextM, 0, activeStumps);
                    setStagedBounceDraft({ bouncePoint: nextBouncePt, bounceLengthM: nextM, bounceTimestampSec: currentTime });
                    if (pendingPreview && onUpdatePendingMeta) onUpdatePendingMeta({ bounceLengthM: nextM, bouncePoint: nextBouncePt });
                  }}
                  className="py-1 rounded bg-[#10141E] hover:text-white cursor-pointer"
                >
                  Good (6.2m)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const nextM = 8.8;
                    const nextBouncePt = project3DPitchBounceToVideo(nextM, 0, activeStumps);
                    setStagedBounceDraft({ bouncePoint: nextBouncePt, bounceLengthM: nextM, bounceTimestampSec: currentTime });
                    if (pendingPreview && onUpdatePendingMeta) onUpdatePendingMeta({ bounceLengthM: nextM, bouncePoint: nextBouncePt });
                  }}
                  className="py-1 rounded bg-[#10141E] hover:text-white cursor-pointer"
                >
                  Short (8.8m)
                </button>
              </div>
            </div>
          )}

          {/* Broadcast Ballistic Telemetry Strip */}
          {activeTrajectoryPred && (
            <div className="grid grid-cols-4 gap-2 bg-[#090C12] border border-white/10 rounded-2xl p-3 text-center">
              <div>
                <div className="text-[9px] font-mono text-zinc-500 uppercase">Length</div>
                <div className="text-xs font-mono font-bold text-emerald-400 mt-0.5">
                  {resolvedBounceLengthM.toFixed(1)}m
                </div>
              </div>
              <div>
                <div className="text-[9px] font-mono text-zinc-500 uppercase">Est. Speed</div>
                <div className="text-xs font-mono font-bold text-white mt-0.5">
                  {activeTrajectoryPred.estimatedSpeedKph ? `${activeTrajectoryPred.estimatedSpeedKph.toFixed(0)}` : '136'} <span className="text-[10px] text-zinc-400">km/h</span>
                </div>
              </div>
              <div>
                <div className="text-[9px] font-mono text-zinc-500 uppercase">Rebound</div>
                <div className="text-xs font-mono font-bold text-cyan-400 mt-0.5">
                  {activeTrajectoryPred.reboundAngleDeg.toFixed(1)}°
                </div>
              </div>
              <div>
                <div className="text-[9px] font-mono text-zinc-500 uppercase">Energy</div>
                <div className="text-xs font-mono font-bold text-amber-400 mt-0.5">
                  {activeTrajectoryPred.impactEnergyRetentionPct.toFixed(0)}%
                </div>
              </div>
            </div>
          )}

          {/* Shot Selection & Matchup Details */}
          {activeImpactPoint && activeProjection && (
            <div className="p-3.5 rounded-2xl bg-[#090C12] border border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 font-bold">
                  Shot &amp; Dismissal Outcome
                </span>
                <span className="text-[10px] font-mono text-cyan-400">
                  {handedness} Stance
                </span>
              </div>

              {/* Shot dropdown */}
              <select
                value={activeShotName}
                onChange={(e) =>
                  updateActiveBallMeta({
                    selectedShotName: e.target.value || undefined,
                  })
                }
                className="w-full bg-[#10141E] border border-white/10 rounded-xl px-3 py-2 text-xs text-white cursor-pointer focus:outline-none focus:border-emerald-400"
              >
                <option value="">-- Select Shot Played --</option>
                {MANUAL_SHOT_OPTIONS.map((shot) => (
                  <option key={shot} value={shot}>
                    {shot}
                  </option>
                ))}
              </select>

              {/* OUT / NOT OUT decision toggle */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => updateActiveBallMeta({ isOut: false })}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold cursor-pointer transition ${
                    !activeIsOut
                      ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                      : 'bg-[#10141E] border-white/10 text-zinc-400 hover:text-white'
                  }`}
                >
                  NOT OUT
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateActiveBallMeta({
                      isOut: true,
                      dismissalType: activeDismissalType,
                    })
                  }
                  className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border text-xs font-bold cursor-pointer transition ${
                    activeIsOut
                      ? 'bg-rose-500 text-white border-rose-400 shadow-md'
                      : 'bg-[#10141E] border-white/10 text-zinc-400 hover:text-rose-400'
                  }`}
                >
                  <Flame className="w-3.5 h-3.5" />
                  <span>OUT</span>
                </button>
              </div>

              {/* Dismissal pills when OUT */}
              {activeIsOut && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {DISMISSAL_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() =>
                        updateActiveBallMeta({ dismissalType: opt.id })
                      }
                      className={`px-2 py-1 rounded-lg text-[10px] font-mono uppercase cursor-pointer transition ${
                        activeDismissalType === opt.id
                          ? 'bg-rose-500/25 border border-rose-400 text-rose-200 font-bold'
                          : 'bg-[#10141E] border border-white/10 text-zinc-400 hover:text-white'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Note input */}
              <input
                type="text"
                value={activeBallNote}
                onChange={(e) => updateActiveBallMeta({ ballNote: e.target.value })}
                placeholder="Ball notes (e.g. In-swinger, inside edge to keeper)..."
                className="w-full bg-[#10141E] border border-white/10 rounded-xl px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-emerald-400"
              />
            </div>
          )}

          {/* PROMINENT SAVE ACTION & AUTO-RESET SECTION */}
          <div className="pt-1 space-y-2.5">
            {pendingPreview ? (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleSaveAndResetDelivery}
                  className="w-full py-4 px-5 rounded-2xl bg-emerald-400 hover:bg-emerald-300 active:scale-[0.98] text-black font-extrabold text-sm tracking-wide shadow-xl shadow-emerald-500/25 cursor-pointer transition-all duration-200 flex items-center justify-center gap-2.5 animate-glow-pulse"
                >
                  <Check className="w-5 h-5 stroke-[3]" />
                  <span>SAVE DELIVERY (AUTO-RESET MARKS)</span>
                </button>
                <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 px-1">
                  <span>Saves Ball #{contacts.length + 1} &amp; resets canvas</span>
                  <button
                    type="button"
                    onClick={() => {
                      setStagedReleaseDraft(null);
                      setStagedBounceDraft(null);
                      setLiveStreamingWaypoints([]);
                      setBounceDetectionInfo(null);
                      onDiscardPendingPreview();
                      setClickMode('MANUAL_BOUNCE');
                    }}
                    className="text-zinc-400 hover:text-rose-400 cursor-pointer"
                  >
                    Discard
                  </button>
                </div>
              </div>
            ) : selectedContact ? (
              <div className="p-3 rounded-2xl bg-[#0E1118] border border-white/10 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-white">
                      Selected Ball #{selectedContact.indexNumber}
                    </span>
                    {selectedContact.isOut && (
                      <span className="text-[10px] font-mono font-bold bg-rose-500 text-white px-2 py-0.5 rounded">
                        OUT ({selectedContact.dismissalType || 'WICKET'})
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleLockContact(selectedContact.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-mono text-zinc-300 cursor-pointer"
                  >
                    {selectedContact.isLocked !== false ? (
                      <>
                        <Lock className="w-3 h-3 text-amber-400" />
                        <span>Locked</span>
                      </>
                    ) : (
                      <>
                        <Unlock className="w-3 h-3 text-emerald-400" />
                        <span>Unlocked</span>
                      </>
                    )}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onClearSelection();
                    setClickMode('MANUAL_BOUNCE');
                  }}
                  className="w-full py-2.5 px-3 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/40 text-xs font-mono font-bold text-emerald-300 cursor-pointer transition text-center"
                >
                  + Start New Delivery (Clear Marks)
                </button>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-[#0E1118] border border-dashed border-white/15 text-center space-y-1">
                <Target className="w-5 h-5 text-emerald-400 mx-auto" />
                <p className="text-xs font-semibold text-white">
                  {resolvedBouncePoint
                    ? 'Bounce Marked! Now click bat contact point'
                    : 'Click ball bounce on the turf to start'}
                </p>
                <p className="text-[11px] text-zinc-400">
                  After saving, marks automatically clear so you are ready for the next ball.
                </p>
              </div>
            )}

            {/* Quick Navigation to 3D Hawk-Eye Pitch & Wagon Wheel */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              {onOpen3DPitch && (
                <button
                  type="button"
                  onClick={onOpen3DPitch}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-[#10141E] hover:bg-white/10 border border-white/10 text-xs font-semibold text-emerald-400 cursor-pointer transition"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>3D Hawk-Eye Corridor</span>
                </button>
              )}
              {onOpenMatchupStudio && (
                <button
                  type="button"
                  onClick={onOpenMatchupStudio}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-[#10141E] hover:bg-white/10 border border-white/10 text-xs font-semibold text-cyan-400 cursor-pointer transition"
                >
                  <Compass className="w-3.5 h-3.5" />
                  <span>Wagon Wheel Studio</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* TAB 2: 3D PITCH CORRIDOR HOMOGRAPHY & STUMPS CALIBRATION */}
        <div
          className={
            rightInspectorTab === 'CALIBRATE'
              ? 'p-4 space-y-3 animate-workspace-enter'
              : 'hidden'
          }
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-mono uppercase tracking-wider text-amber-400 font-bold">
              3D Pitch Corridor Calibration
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isAutoFittingCorridor}
                onClick={handleAutoFitPitchCorridor}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-[11px] font-mono text-amber-300 cursor-pointer transition"
                title="Auto-fit 3D pitch corridor homography to the camera perspective"
              >
                <Sparkles
                  className={`w-3 h-3 ${
                    isAutoFittingCorridor ? 'animate-spin' : ''
                  }`}
                />
                <span>
                  {isAutoFittingCorridor ? 'Fitting...' : 'Auto-Fit Corridor'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const nextArrow = !isArrowMode;
                  const cal = resolveFourPointCalibration(activeStumps);
                  onChangeActiveStumps({
                    ...activeStumps,
                    anchorMode: nextArrow ? 'CREASE_ARROW' : 'FRONT_STUMPS',
                    farEndMode: nextArrow
                      ? 'VISIBLE_PITCH_AXIS'
                      : 'BOWLER_STUMPS_20M',
                    poppingCreasePoint: cal.p3PoppingCrease,
                  });
                }}
                className="text-[11px] font-mono text-cyan-400 hover:underline cursor-pointer"
              >
                {isArrowMode ? 'Bowler Stumps' : 'Pitch Arrow'}
              </button>
              <button
                type="button"
                onClick={() =>
                  onChangeActiveStumps({
                    ...createDefaultPlantedStumps(
                      activeStumps.cameraAngle || 'BEHIND_BOWLER',
                      isArrowMode ? 'VISIBLE_PITCH_AXIS' : 'BOWLER_STUMPS_20M'
                    ),
                    anchorMode: activeStumps.anchorMode,
                  })
                }
                className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-400 hover:text-white cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            </div>
          </div>

          {/* Automated Suggested Stump Line + Interactive Angle Adjustment Card */}
          <div className="bg-[#10141E] border border-white/10 rounded-xl p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Compass className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>
                    {!isArrowMode
                      ? 'Both Stumps Visible (20.12m)'
                      : isStumpLineAutoSuggested
                      ? 'Auto-Suggested Stump Line'
                      : 'Custom Adjusted Stump Line'}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 mt-0.5 leading-snug">
                  {!isArrowMode
                    ? 'Bowler stumps are visible: drag either stump set on the video to lock the exact 20.12m line.'
                    : 'Suggested from marked batting stumps. Drag the line on video or use the slider below.'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleApplySuggestedStumpLine}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/40 text-[11px] font-mono font-bold text-emerald-300 cursor-pointer shrink-0 transition"
                title="Re-compute the suggested stump line from the marked batting stumps"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Suggest Line</span>
              </button>
            </div>

            {/* Quick Stump Line Horizontal Angle Fine-Tune Slider */}
            {(() => {
              const currentOffsetX = Number(
                ((activeStumps.frontStumps.x - activeStumps.backStumps.x) * 100).toFixed(1)
              );
              return (
                <div className="space-y-1 pt-1 border-t border-white/10">
                  <div className="flex items-center justify-between text-[10px] font-mono">
                    <span className="text-zinc-400">
                      Adjust Stump Line Direction:
                    </span>
                    <span className="text-emerald-400 font-bold tabular-nums">
                      {currentOffsetX > 0 ? `+${currentOffsetX}%` : `${currentOffsetX}%`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-30}
                    max={30}
                    step={0.5}
                    value={clamp(currentOffsetX, -30, 30)}
                    onChange={(e) => {
                      const nextPct = parseFloat(e.target.value);
                      hasManualStumpLineRef.current = true;
                      setIsStumpLineAutoSuggested(false);
                      const nextFx = Number(
                        clamp(
                          activeStumps.backStumps.x + nextPct / 100,
                          0.04,
                          0.96
                        ).toFixed(4)
                      );
                      const nextFy = activeStumps.frontStumps.y;
                      const dx = nextFx - activeStumps.backStumps.x;
                      const dy = nextFy - activeStumps.backStumps.y;
                      const len = Math.hypot(dx, dy);
                      const ux = len > 0.001 ? dx / len : 0;
                      const uy = len > 0.001 ? dy / len : 1;
                      const creaseDist = clamp(
                        activeStumps.backStumpHeight * 0.38,
                        0.022,
                        0.16
                      );
                      onChangeActiveStumps({
                        ...activeStumps,
                        frontStumps: { x: nextFx, y: nextFy },
                        poppingCreasePoint: {
                          x: Number(
                            clamp(
                              activeStumps.backStumps.x + ux * creaseDist,
                              0.03,
                              0.97
                            ).toFixed(4)
                          ),
                          y: Number(
                            clamp(
                              activeStumps.backStumps.y + uy * creaseDist,
                              0.03,
                              0.97
                            ).toFixed(4)
                          ),
                        },
                      });
                    }}
                    className="w-full accent-emerald-400 cursor-pointer h-1.5 bg-zinc-800 rounded-lg"
                  />
                </div>
              );
            })()}
          </div>

          {/* Pitch & Bowling End Visibility Mode Segmented Toggle */}
          <div className="bg-[#070A10] p-1.5 rounded-lg border border-slate-800/80 space-y-1.5">
            <div className="text-[10px] font-mono text-slate-400 px-1 uppercase tracking-wider font-semibold flex items-center justify-between">
              <span>Bowling End Visibility</span>
              <span className="text-cyan-400 font-bold">
                {cameraTelemetry.bowlingStumpsVisible
                  ? 'Both Stumps (20.12m)'
                  : 'Batting Stumps Only'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const cal = resolveFourPointCalibration(activeStumps);
                  onChangeActiveStumps({
                    ...activeStumps,
                    anchorMode: 'FRONT_STUMPS',
                    farEndMode: 'BOWLER_STUMPS_20M',
                    poppingCreasePoint: cal.p3PoppingCrease,
                  });
                }}
                className={`px-2.5 py-1.5 rounded-md text-xs font-mono font-semibold transition cursor-pointer text-center ${
                  cameraTelemetry.bowlingStumpsVisible
                    ? 'bg-sky-400 text-slate-950 font-bold shadow-sm'
                    : 'text-slate-300 hover:text-white bg-[#0C111C]'
                }`}
              >
                Both Stumps
              </button>
              <button
                type="button"
                onClick={() => {
                  const cal = resolveFourPointCalibration(activeStumps);
                  onChangeActiveStumps({
                    ...activeStumps,
                    anchorMode: 'CREASE_ARROW',
                    farEndMode: 'VISIBLE_PITCH_AXIS',
                    poppingCreasePoint: cal.p3PoppingCrease,
                  });
                }}
                className={`px-2.5 py-1.5 rounded-md text-xs font-mono font-semibold transition cursor-pointer text-center ${
                  !cameraTelemetry.bowlingStumpsVisible
                    ? 'bg-amber-400 text-slate-950 font-bold shadow-sm'
                    : 'text-slate-300 hover:text-white bg-[#0C111C]'
                }`}
              >
                Batting Stumps Only
              </button>
            </div>
            <p className="text-[10px] text-slate-400 px-1 leading-snug">
              {cameraTelemetry.bowlingStumpsVisible
                ? 'Camera distance to both ends is calculated directly from stump heights (71.12cm).'
                : 'App calculates camera distance from batting stumps, then automatically projects virtual bowling stumps (20.12m) & release crease (18.90m).'}
            </p>
          </div>

          {/* Real-World Camera Distance Auto-Estimate + Manual Override Slider (Supports Mid-Pitch Camera Placement) */}
          <div className="bg-[#070A10] border border-cyan-500/30 rounded-lg p-2.5 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-slate-400">Cam → Bat Stumps:</span>
              <div className="flex items-center gap-1.5">
                <span className="text-cyan-300 font-bold tabular-nums">
                  {cameraTelemetry.cameraToBattingStumpsM.toFixed(1)} m
                </span>
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase ${
                    cameraTelemetry.isCameraInFrontOfBowlerStumps
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                  }`}
                >
                  {cameraTelemetry.isCameraInFrontOfBowlerStumps
                    ? 'In Front of Bowler'
                    : 'Behind Bowler'}
                </span>
              </div>
            </div>

            {/* Camera Distance Override Slider (4.0m – 35.0m) */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] font-mono">
                <span className="text-slate-400">
                  Camera Station Distance ({cameraTelemetry.cameraStationZoneLabel}):
                </span>
                {typeof activeStumps.customCameraDistanceM === 'number' ? (
                  <button
                    type="button"
                    onClick={() =>
                      onChangeActiveStumps({
                        ...activeStumps,
                        customCameraDistanceM: undefined,
                      })
                    }
                    className="text-cyan-400 hover:underline cursor-pointer tabular-nums"
                    title="Reset to auto-estimated distance from marked batting stump height"
                  >
                    Reset Auto ({cameraTelemetry.autoEstimatedCameraToBattingM.toFixed(1)}m)
                  </button>
                ) : (
                  <span className="text-slate-500 tabular-nums">
                    Auto from Stump Size ({cameraTelemetry.autoEstimatedCameraToBattingM.toFixed(1)}m)
                  </span>
                )}
              </div>
              <input
                type="range"
                min={4.0}
                max={35.0}
                step={0.5}
                value={clamp(cameraTelemetry.cameraToBattingStumpsM, 4.0, 35.0)}
                onChange={(e) => {
                  const nextDist = parseFloat(e.target.value);
                  onChangeActiveStumps({
                    ...activeStumps,
                    customCameraDistanceM: nextDist,
                  });
                }}
                className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
              />
              <div className="flex items-center justify-between text-[9px] font-mono text-slate-500 tabular-nums">
                <span>4m (Short Pitch)</span>
                <span>14m (Mid-Pitch Cam)</span>
                <span>20.1m (Stumps)</span>
                <span>35m</span>
              </div>
            </div>

            <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pt-1 border-t border-slate-800/80 tabular-nums">
              <span>
                Visible Pitch Span: <strong className="text-emerald-300">{cameraTelemetry.visiblePitchSpanM.toFixed(1)}m</strong>
              </span>
              <span>
                Bowler End:{' '}
                {cameraTelemetry.cameraToBowlingStumpsM >= 0
                  ? `${cameraTelemetry.cameraToBowlingStumpsM.toFixed(1)}m ahead`
                  : `${Math.abs(cameraTelemetry.cameraToBowlingStumpsM).toFixed(1)}m behind cam`}
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px] font-mono text-violet-300 pt-0.5 tabular-nums">
              <span>
                18.90m Release Ht: {cameraTelemetry.reconstructedReleaseHeightCm ?? 198}cm
              </span>
              <span>
                Crease Lateral: {cameraTelemetry.reconstructedReleaseLateralCm ?? 0}cm
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setClickMode('BACK_STUMPS')}
              className={`py-1.5 px-2.5 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                clickMode === 'BACK_STUMPS'
                  ? 'bg-amber-400 text-slate-950 border-amber-400 font-bold'
                  : 'bg-[#070A10] border-slate-800/80 text-slate-300 hover:border-slate-700'
              }`}
            >
              Striker Stumps
            </button>

            <button
              type="button"
              onClick={() => {
                setClickMode('FRONT_STUMPS');
                if (isArrowMode) setStumpEditAction('MOVE');
              }}
              className={`py-1.5 px-2.5 rounded-lg border text-xs font-semibold transition cursor-pointer ${
                clickMode === 'FRONT_STUMPS'
                  ? 'bg-sky-400 text-slate-950 border-sky-400 font-bold'
                  : 'bg-[#070A10] border-slate-800/80 text-slate-300 hover:border-slate-700'
              }`}
            >
              {isArrowMode ? 'Pitch Arrow' : 'Bowler Stumps'}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-1.5 bg-[#070A10] p-1 rounded-lg border border-slate-800/80">
            <button
              type="button"
              onClick={() => {
                setStumpEditAction('MOVE');
                if (
                  clickMode === 'MANUAL_CONTACT' ||
                  clickMode === 'MANUAL_BOUNCE'
                ) {
                  setClickMode('BACK_STUMPS');
                }
              }}
              className={`py-1 px-2 rounded text-[11px] font-semibold transition cursor-pointer ${
                stumpEditAction === 'MOVE' &&
                clickMode !== 'MANUAL_CONTACT' &&
                clickMode !== 'MANUAL_BOUNCE'
                  ? 'bg-slate-800 text-white font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Drag to Move
            </button>
            <button
              type="button"
              onClick={() => {
                setStumpEditAction('RESIZE');
                if (
                  clickMode === 'MANUAL_CONTACT' ||
                  clickMode === 'MANUAL_BOUNCE' ||
                  (clickMode === 'FRONT_STUMPS' && isArrowMode)
                ) {
                  setClickMode('BACK_STUMPS');
                }
              }}
              className={`py-1 px-2 rounded text-[11px] font-semibold transition cursor-pointer ${
                stumpEditAction === 'RESIZE' &&
                clickMode !== 'MANUAL_CONTACT' &&
                clickMode !== 'MANUAL_BOUNCE'
                  ? 'bg-slate-800 text-white font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Drag to Resize
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2 flex-1">
              <span className="text-[11px] text-slate-400 shrink-0">
                Opacity
              </span>
              <input
                type="range"
                min={10}
                max={100}
                step={5}
                value={stumpOpacity}
                onChange={(e) => setStumpOpacity(Number(e.target.value))}
                className="w-full accent-amber-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
              />
              <span className="text-[11px] font-mono tabular-nums text-amber-300 w-8 text-right">
                {stumpOpacity}%
              </span>
            </div>

            <button
              type="button"
              onClick={() => setShowCalibrationGrid((v) => !v)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer transition shrink-0 ${
                showCalibrationGrid
                  ? 'bg-cyan-400 text-slate-950 font-bold'
                  : 'bg-[#070A10] hover:bg-slate-800 border border-slate-800/80 text-slate-300'
              }`}
            >
              <Grid className="w-3 h-3" />
              <span>1.22m Grid</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
