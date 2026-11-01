import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Camera,
  ChevronLeft,
  ChevronRight,
  Circle,
  Compass,
  Crosshair,
  Download,
  Eraser,
  Eye,
  EyeOff,
  Grid,
  Maximize2,
  Minimize2,
  Minus,
  Move,
  Pause,
  PenTool,
  Play,
  Redo2,
  RotateCcw,
  Square,
  Trash2,
  Type,
  Undo2,
  Upload,
  ZoomIn,
} from 'lucide-react';
import { BatterHandedness, ContactPointRecord } from '../types/cricket';
import { clamp } from '../utils/stumpProjection';

export type TelestratorTool =
  | 'PEN'
  | 'LINE'
  | 'ARROW'
  | 'CIRCLE'
  | 'RECT'
  | 'ANGLE'
  | 'PLUMB_LINE'
  | 'TEXT'
  | 'ERASER';

export interface NormalizedTelestratorPoint {
  x: number;
  y: number;
}

export interface TelestratorAnnotation {
  id: string;
  tool: Exclude<TelestratorTool, 'ERASER'>;
  color: string;
  strokeWidth: number;
  dashed: boolean;
  frameNumber: number;
  timestampSec: number;
  points: NormalizedTelestratorPoint[];
  text?: string;
  angleDeg?: number;
}

export interface BiomechanicsKeyframeBookmark {
  id: string;
  label: string;
  phaseTag:
    | 'Back-Lift / Gather'
    | 'Trigger Movement'
    | 'Front-Foot Stride'
    | 'Downswing Plane'
    | 'Ball Impact'
    | 'Follow-Through'
    | 'Bowling Release';
  frameNumber: number;
  timestampSec: number;
  coachNote: string;
  snapshotDataUrl: string;
  annotationCount: number;
}

interface BiomechanicsTelestratorProps {
  handedness: BatterHandedness;
  activeVideoUrl: string;
  contacts: ContactPointRecord[];
  selectedContactId: string | null;
  onSelectContact: (id: string | null) => void;
  onVideoUrlChange?: (url: string) => void;
  videoTrimWindow?: {
    trimStartSec: number;
    trimEndSec: number;
    durationSec: number;
    isCustomTrim: boolean;
  };
  seekRequest?: { timestampSec: number; seq: number } | null;
}

type BiomechClipScope = 'BALL_CLIP' | 'TRIMMED_CLIP' | 'FULL_VIDEO';

const TELESTRATOR_COLORS: Array<{ label: string; hex: string }> = [
  { label: 'Cyan', hex: '#22D3EE' },
  { label: 'Amber Gold', hex: '#F59E0B' },
  { label: 'Emerald', hex: '#10B981' },
  { label: 'Crimson', hex: '#F43F5E' },
  { label: 'Violet', hex: '#A855F7' },
  { label: 'White', hex: '#FFFFFF' },
];

const STROKE_WIDTH_OPTIONS = [2, 3.5, 5, 7];

const BIOMECH_PHASE_TAGS: BiomechanicsKeyframeBookmark['phaseTag'][] = [
  'Back-Lift / Gather',
  'Trigger Movement',
  'Front-Foot Stride',
  'Downswing Plane',
  'Ball Impact',
  'Follow-Through',
  'Bowling Release',
];

function computeThreePointAngleDeg(
  p1: NormalizedTelestratorPoint,
  vertex: NormalizedTelestratorPoint,
  p3: NormalizedTelestratorPoint,
  aspectRatio: number
): number {
  const v1x = (p1.x - vertex.x) * aspectRatio;
  const v1y = p1.y - vertex.y;
  const v2x = (p3.x - vertex.x) * aspectRatio;
  const v2y = p3.y - vertex.y;
  const mag1 = Math.hypot(v1x, v1y);
  const mag2 = Math.hypot(v2x, v2y);
  if (mag1 < 1e-5 || mag2 < 1e-5) return 0;
  const cosTheta = clamp((v1x * v2x + v1y * v2y) / (mag1 * mag2), -1, 1);
  return Number(((Math.acos(cosTheta) * 180) / Math.PI).toFixed(1));
}

export const BiomechanicsTelestrator: React.FC<BiomechanicsTelestratorProps> = ({
  handedness,
  activeVideoUrl,
  contacts,
  selectedContactId,
  onSelectContact,
  onVideoUrlChange,
  videoTrimWindow,
  seekRequest,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [localVideoUrl, setLocalVideoUrl] = useState<string>('');
  const [videoName, setVideoName] = useState<string>('Session Coaching Clip');
  const effectiveVideoUrl = localVideoUrl || activeVideoUrl;

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(2.0);
  const [playbackRate, setPlaybackRate] = useState<number>(0.25);
  const [fps] = useState<number>(30);

  // Clip Scope: If coach visits early before tagging or trimming, show FULL_VIDEO;
  // once balls are tagged or clip is trimmed, show the trimmed/ball delivery clip by default.
  const [clipScope, setClipScope] = useState<BiomechClipScope>('FULL_VIDEO');
  const hasAutoSwitchedScopeRef = useRef<boolean>(false);

  const focusedContact = useMemo(
    () =>
      contacts.find((c) => c.id === selectedContactId) ||
      contacts[contacts.length - 1] ||
      null,
    [contacts, selectedContactId]
  );

  useEffect(() => {
    if (
      !hasAutoSwitchedScopeRef.current &&
      (contacts.length > 0 || videoTrimWindow?.isCustomTrim)
    ) {
      hasAutoSwitchedScopeRef.current = true;
      setClipScope('TRIMMED_CLIP');
    }
  }, [contacts.length, videoTrimWindow?.isCustomTrim]);

  // Compute active playback/scrubber start & end bounds based on clipScope
  const { scopeStartSec, scopeEndSec } = useMemo(() => {
    const safeDur = Math.max(0.1, duration);
    const trimS = clamp(videoTrimWindow?.trimStartSec ?? 0, 0, safeDur);
    const trimE = clamp(
      videoTrimWindow?.trimEndSec && videoTrimWindow.trimEndSec > trimS + 0.05
        ? videoTrimWindow.trimEndSec
        : safeDur,
      trimS + 0.05,
      safeDur
    );

    if (clipScope === 'FULL_VIDEO') {
      return { scopeStartSec: 0, scopeEndSec: safeDur };
    }

    if (clipScope === 'BALL_CLIP' && focusedContact) {
      const bStart = clamp(
        Math.max(trimS, focusedContact.timestampSec - 0.55),
        0,
        safeDur - 0.05
      );
      const bEnd = clamp(
        Math.min(trimE, focusedContact.timestampSec + 0.45),
        bStart + 0.1,
        safeDur
      );
      return { scopeStartSec: bStart, scopeEndSec: bEnd };
    }

    // TRIMMED_CLIP: If custom trim exists, use [trimS, trimE]. Otherwise if contacts exist, span around all tagged contacts or [trimS, trimE].
    if (videoTrimWindow?.isCustomTrim) {
      return { scopeStartSec: trimS, scopeEndSec: trimE };
    }
    if (contacts.length > 0) {
      const times = contacts.map((c) => c.timestampSec);
      const minT = Math.min(...times);
      const maxT = Math.max(...times);
      const cStart = clamp(minT - 0.6, 0, safeDur - 0.05);
      const cEnd = clamp(maxT + 0.5, cStart + 0.15, safeDur);
      return { scopeStartSec: cStart, scopeEndSec: cEnd };
    }
    return { scopeStartSec: trimS, scopeEndSec: trimE };
  }, [clipScope, duration, videoTrimWindow, focusedContact, contacts]);

  const [activeTool, setActiveTool] = useState<TelestratorTool>('LINE');
  const [activeColor, setActiveColor] = useState<string>('#22D3EE');
  const [strokeWidth, setStrokeWidth] = useState<number>(3.5);
  const [isDashed, setIsDashed] = useState<boolean>(false);
  const [showPostureGrid, setShowPostureGrid] = useState<boolean>(false);
  const [showDrawings, setShowDrawings] = useState<boolean>(true);
  const [frameFilterMode, setFrameFilterMode] = useState<'ALL_FRAMES' | 'CURRENT_FRAME'>('ALL_FRAMES');

  const [annotations, setAnnotations] = useState<TelestratorAnnotation[]>([]);
  const [redoStack, setRedoStack] = useState<TelestratorAnnotation[]>([]);
  const [draftAnnotation, setDraftAnnotation] = useState<TelestratorAnnotation | null>(null);
  const [pendingAnglePoints, setPendingAnglePoints] = useState<NormalizedTelestratorPoint[]>([]);
  const [hoverPoint, setHoverPoint] = useState<NormalizedTelestratorPoint | null>(null);

  const [customTextDraft, setCustomTextDraft] = useState<string>('Head over front knee');
  const [selectedPhaseTag, setSelectedPhaseTag] =
    useState<BiomechanicsKeyframeBookmark['phaseTag']>('Ball Impact');
  const [keyframeNoteDraft, setKeyframeNoteDraft] = useState<string>('');
  const [bookmarks, setBookmarks] = useState<BiomechanicsKeyframeBookmark[]>([]);

  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [canvasZoom, setCanvasZoom] = useState<number>(1.0);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanMode, setIsPanMode] = useState<boolean>(false);
  const [isDraggingPan, setIsDraggingPan] = useState<boolean>(false);
  const panStartRef = useRef<{
    clientX: number;
    clientY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);

  // Dedicated Coach Zoom Option (Optional Coach Focus Box & Smooth Zoom Inspector)
  const [isCoachZoomOpen, setIsCoachZoomOpen] = useState<boolean>(false);
  const [isZoomBoxMode, setIsZoomBoxMode] = useState<boolean>(false);
  const [zoomBoxDraft, setZoomBoxDraft] = useState<{
    start: NormalizedTelestratorPoint;
    end: NormalizedTelestratorPoint;
  } | null>(null);

  const [stageDims, setStageDims] = useState({ width: 880, height: 495 });
  const [videoDims, setVideoDims] = useState({ width: 960, height: 540 });

  const currentFrameNumber = Math.max(1, Math.round(currentTime * fps) + 1);
  const totalFrames = Math.max(1, Math.round(duration * fps) + 1);
  const scopeStartFrame = Math.max(1, Math.round(scopeStartSec * fps) + 1);
  const scopeEndFrame = Math.max(1, Math.round(scopeEndSec * fps) + 1);
  const aspectRatio = videoDims.width / Math.max(1, videoDims.height);

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
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)
      ) {
        return;
      }
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepFrames(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepFrames(1);
      } else if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let rafId = 0;
    const syncTime = () => {
      if (v && !v.paused) {
        setCurrentTime(v.currentTime);
        if (v.currentTime >= scopeEndSec) {
          v.pause();
          v.currentTime = scopeStartSec;
          setCurrentTime(scopeStartSec);
          setIsPlaying(false);
        } else {
          rafId = window.requestAnimationFrame(syncTime);
        }
      }
    };
    if (isPlaying) {
      rafId = window.requestAnimationFrame(syncTime);
    }
    const onTimeUpdate = () => setCurrentTime(v.currentTime);
    const onEnded = () => setIsPlaying(false);
    v.addEventListener('timeupdate', onTimeUpdate);
    v.addEventListener('ended', onEnded);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      v.removeEventListener('timeupdate', onTimeUpdate);
      v.removeEventListener('ended', onEnded);
    };
  }, [isPlaying, scopeStartSec, scopeEndSec]);

  // Respond immediately when coach clicks any ball/delivery number in the global header or Biomechanics Lab
  useEffect(() => {
    if (!seekRequest || !videoRef.current) return;
    const v = videoRef.current;
    v.pause();
    setIsPlaying(false);
    const clamped = clamp(seekRequest.timestampSec, 0, Math.max(0.05, duration));
    v.currentTime = clamped;
    setCurrentTime(clamped);
  }, [seekRequest, duration]);

  const visibleAnnotations = useMemo(() => {
    if (frameFilterMode === 'ALL_FRAMES') return annotations;
    return annotations.filter((a) => Math.abs(a.frameNumber - currentFrameNumber) <= 1);
  }, [annotations, frameFilterMode, currentFrameNumber]);

  const clientToNormalized = (
    clientX: number,
    clientY: number
  ): NormalizedTelestratorPoint | null => {
    const el = stageRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const stageX = (clientX - rect.left - panOffset.x) / canvasZoom;
    const stageY = (clientY - rect.top - panOffset.y) / canvasZoom;
    return {
      x: Number(clamp(stageX / Math.max(1, stageDims.width), 0.005, 0.995).toFixed(4)),
      y: Number(clamp(stageY / Math.max(1, stageDims.height), 0.005, 0.995).toFixed(4)),
    };
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime >= scopeEndSec - 0.02 || v.currentTime < scopeStartSec) {
        v.currentTime = scopeStartSec;
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

  const seekToSecond = (targetSec: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    setIsPlaying(false);
    const clamped = clamp(targetSec, 0, Math.max(0.05, duration));
    v.currentTime = clamped;
    setCurrentTime(clamped);
  };

  const stepFrames = (deltaFrames: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    setIsPlaying(false);
    const nextSec = clamp(
      v.currentTime + deltaFrames * (1 / fps),
      scopeStartSec,
      Math.max(scopeStartSec + 0.03, scopeEndSec)
    );
    v.currentTime = nextSec;
    setCurrentTime(nextSec);
  };

  const focusCoachZoomOnNormalizedRegion = (
    centerX: number,
    centerY: number,
    targetZoom: number
  ) => {
    const z = Number(clamp(targetZoom, 1.0, 4.0).toFixed(2));
    if (z <= 1.02) {
      setCanvasZoom(1.0);
      setPanOffset({ x: 0, y: 0 });
      setIsPanMode(false);
      return;
    }
    const desiredPanX = stageDims.width * (0.5 - centerX * z);
    const desiredPanY = stageDims.height * (0.5 - centerY * z);
    const minPanX = stageDims.width * (1 - z);
    const minPanY = stageDims.height * (1 - z);
    setCanvasZoom(z);
    setPanOffset({
      x: clamp(desiredPanX, minPanX, 0),
      y: clamp(desiredPanY, minPanY, 0),
    });
  };

  const handleUploadVideoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setLocalVideoUrl(url);
    setVideoName(file.name);
    setIsPlaying(false);
    setCurrentTime(0);
    if (onVideoUrlChange) {
      onVideoUrlChange(url);
    }
    e.target.value = '';
  };

  const commitAnnotation = (newAnn: TelestratorAnnotation) => {
    setAnnotations((prev) => [...prev, newAnn]);
    setRedoStack([]);
  };

  const handleUndo = () => {
    if (pendingAnglePoints.length > 0) {
      setPendingAnglePoints((prev) => prev.slice(0, -1));
      return;
    }
    setAnnotations((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setRedoStack((r) => [last, ...r]);
      return prev.slice(0, -1);
    });
  };

  const handleRedo = () => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const [first, ...rest] = prev;
      setAnnotations((a) => [...a, first]);
      return rest;
    });
  };

  const handleClearCurrentFrame = () => {
    setAnnotations((prev) =>
      prev.filter((a) => Math.abs(a.frameNumber - currentFrameNumber) > 1)
    );
    setPendingAnglePoints([]);
  };

  const handleClearAll = () => {
    setAnnotations([]);
    setRedoStack([]);
    setPendingAnglePoints([]);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
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

    const norm = clientToNormalized(e.clientX, e.clientY);
    if (!norm) return;

    const v = videoRef.current;
    if (v && !v.paused) {
      v.pause();
      setIsPlaying(false);
    }

    // Coach Focus Box Zoom Mode: drag a region on the video to zoom directly into that anatomical area
    if (isZoomBoxMode) {
      setZoomBoxDraft({ start: norm, end: norm });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    if (activeTool === 'ERASER') {
      // Erase closest annotation within threshold
      setAnnotations((prev) => {
        let bestIdx = -1;
        let bestDist = 0.055;
        prev.forEach((ann, idx) => {
          for (const pt of ann.points) {
            const d = Math.hypot(pt.x - norm.x, pt.y - norm.y);
            if (d < bestDist) {
              bestDist = d;
              bestIdx = idx;
            }
          }
          if (ann.points.length >= 2) {
            const midX = (ann.points[0].x + ann.points[ann.points.length - 1].x) / 2;
            const midY = (ann.points[0].y + ann.points[ann.points.length - 1].y) / 2;
            const dMid = Math.hypot(midX - norm.x, midY - norm.y);
            if (dMid < bestDist) {
              bestDist = dMid;
              bestIdx = idx;
            }
          }
        });
        if (bestIdx === -1) return prev;
        return prev.filter((_, i) => i !== bestIdx);
      });
      return;
    }

    if (activeTool === 'PLUMB_LINE') {
      commitAnnotation({
        id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        tool: 'PLUMB_LINE',
        color: activeColor,
        strokeWidth,
        dashed: true,
        frameNumber: currentFrameNumber,
        timestampSec: currentTime,
        points: [norm],
      });
      return;
    }

    if (activeTool === 'TEXT') {
      const label = customTextDraft.trim() || 'Coaching Cue';
      commitAnnotation({
        id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        tool: 'TEXT',
        color: activeColor,
        strokeWidth,
        dashed: false,
        frameNumber: currentFrameNumber,
        timestampSec: currentTime,
        points: [norm],
        text: label,
      });
      return;
    }

    if (activeTool === 'ANGLE') {
      const nextPts = [...pendingAnglePoints, norm];
      if (nextPts.length < 3) {
        setPendingAnglePoints(nextPts);
      } else {
        const deg = computeThreePointAngleDeg(
          nextPts[0],
          nextPts[1],
          nextPts[2],
          aspectRatio
        );
        commitAnnotation({
          id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          tool: 'ANGLE',
          color: activeColor,
          strokeWidth,
          dashed: isDashed,
          frameNumber: currentFrameNumber,
          timestampSec: currentTime,
          points: nextPts,
          angleDeg: deg,
        });
        setPendingAnglePoints([]);
      }
      return;
    }

    // Standard drag tools: PEN, LINE, ARROW, CIRCLE, RECT
    const newDraft: TelestratorAnnotation = {
      id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      tool: activeTool,
      color: activeColor,
      strokeWidth,
      dashed: isDashed,
      frameNumber: currentFrameNumber,
      timestampSec: currentTime,
      points: activeTool === 'PEN' ? [norm] : [norm, norm],
    };
    setDraftAnnotation(newDraft);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const norm = clientToNormalized(e.clientX, e.clientY);
    if (norm) {
      setHoverPoint(norm);
    }

    if (isDraggingPan && panStartRef.current && canvasZoom > 1.0) {
      const dx = e.clientX - panStartRef.current.clientX;
      const dy = e.clientY - panStartRef.current.clientY;
      const minPanX = stageDims.width * (1 - canvasZoom);
      const minPanY = stageDims.height * (1 - canvasZoom);
      setPanOffset({
        x: clamp(panStartRef.current.startPanX + dx, minPanX, 0),
        y: clamp(panStartRef.current.startPanY + dy, minPanY, 0),
      });
      return;
    }

    if (zoomBoxDraft && norm) {
      setZoomBoxDraft((prev) => (prev ? { ...prev, end: norm } : null));
      return;
    }

    if (!draftAnnotation || !norm) return;

    if (draftAnnotation.tool === 'PEN') {
      setDraftAnnotation((prev) =>
        prev ? { ...prev, points: [...prev.points, norm] } : null
      );
    } else {
      setDraftAnnotation((prev) =>
        prev ? { ...prev, points: [prev.points[0], norm] } : null
      );
    }
  };

  const handlePointerUp = () => {
    if (isDraggingPan) {
      setIsDraggingPan(false);
      panStartRef.current = null;
    }
    if (zoomBoxDraft) {
      const wBox = Math.abs(zoomBoxDraft.end.x - zoomBoxDraft.start.x);
      const hBox = Math.abs(zoomBoxDraft.end.y - zoomBoxDraft.start.y);
      const cx = (zoomBoxDraft.start.x + zoomBoxDraft.end.x) / 2;
      const cy = (zoomBoxDraft.start.y + zoomBoxDraft.end.y) / 2;
      if (wBox > 0.04 && hBox > 0.04) {
        const computedZoom = clamp(1 / Math.max(wBox, hBox), 1.4, 4.0);
        focusCoachZoomOnNormalizedRegion(cx, cy, computedZoom);
      } else {
        // Single click in Zoom Box mode zooms 2.2x centered on the clicked point
        focusCoachZoomOnNormalizedRegion(cx, cy, Math.min(4.0, canvasZoom < 1.8 ? 2.2 : canvasZoom + 0.6));
      }
      setZoomBoxDraft(null);
      setIsZoomBoxMode(false);
      return;
    }
    if (!draftAnnotation) return;
    if (draftAnnotation.tool === 'PEN' && draftAnnotation.points.length >= 2) {
      commitAnnotation(draftAnnotation);
    } else if (draftAnnotation.points.length >= 2) {
      const p0 = draftAnnotation.points[0];
      const p1 = draftAnnotation.points[1];
      if (Math.hypot(p1.x - p0.x, p1.y - p0.y) > 0.008) {
        commitAnnotation(draftAnnotation);
      }
    }
    setDraftAnnotation(null);
  };

  // Export composite PNG of video frame + telestrator annotations
  const captureAnnotatedFrameDataUrl = (): string => {
    const v = videoRef.current;
    const w = v && v.videoWidth > 0 ? v.videoWidth : 960;
    const h = v && v.videoHeight > 0 ? v.videoHeight : 540;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    if (v && v.readyState >= 2) {
      ctx.drawImage(v, 0, 0, w, h);
    } else {
      ctx.fillStyle = '#05080F';
      ctx.fillRect(0, 0, w, h);
    }

    const scaleFactor = w / Math.max(1, stageDims.width);

    if (showPostureGrid) {
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.22)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 8; i++) {
        const gx = (w * i) / 8;
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
        ctx.stroke();
      }
      for (let j = 1; j < 6; j++) {
        const gy = (h * j) / 6;
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }
    }

    for (const ann of visibleAnnotations) {
      ctx.save();
      ctx.strokeStyle = ann.color;
      ctx.fillStyle = ann.color;
      ctx.lineWidth = ann.strokeWidth * scaleFactor;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (ann.dashed) {
        ctx.setLineDash([8 * scaleFactor, 6 * scaleFactor]);
      }

      if (ann.tool === 'PEN' && ann.points.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(ann.points[0].x * w, ann.points[0].y * h);
        for (let i = 1; i < ann.points.length; i++) {
          ctx.lineTo(ann.points[i].x * w, ann.points[i].y * h);
        }
        ctx.stroke();
      } else if (
        (ann.tool === 'LINE' || ann.tool === 'ARROW') &&
        ann.points.length >= 2
      ) {
        const x1 = ann.points[0].x * w;
        const y1 = ann.points[0].y * h;
        const x2 = ann.points[1].x * w;
        const y2 = ann.points[1].y * h;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        if (ann.tool === 'ARROW') {
          ctx.setLineDash([]);
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const headLen = 14 * scaleFactor;
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(
            x2 - headLen * Math.cos(angle - Math.PI / 6),
            y2 - headLen * Math.sin(angle - Math.PI / 6)
          );
          ctx.lineTo(
            x2 - headLen * Math.cos(angle + Math.PI / 6),
            y2 - headLen * Math.sin(angle + Math.PI / 6)
          );
          ctx.closePath();
          ctx.fill();
        }
      } else if (ann.tool === 'CIRCLE' && ann.points.length >= 2) {
        const x1 = ann.points[0].x * w;
        const y1 = ann.points[0].y * h;
        const x2 = ann.points[1].x * w;
        const y2 = ann.points[1].y * h;
        const r = Math.hypot(x2 - x1, y2 - y1);
        ctx.beginPath();
        ctx.arc(x1, y1, r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (ann.tool === 'RECT' && ann.points.length >= 2) {
        const x1 = ann.points[0].x * w;
        const y1 = ann.points[0].y * h;
        const x2 = ann.points[1].x * w;
        const y2 = ann.points[1].y * h;
        ctx.strokeRect(
          Math.min(x1, x2),
          Math.min(y1, y2),
          Math.abs(x2 - x1),
          Math.abs(y2 - y1)
        );
      } else if (ann.tool === 'PLUMB_LINE' && ann.points.length >= 1) {
        const px = ann.points[0].x * w;
        const py = ann.points[0].y * h;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, h);
        ctx.moveTo(Math.max(0, px - 60 * scaleFactor), py);
        ctx.lineTo(Math.min(w, px + 60 * scaleFactor), py);
        ctx.stroke();
      } else if (ann.tool === 'ANGLE' && ann.points.length === 3) {
        const p1 = { x: ann.points[0].x * w, y: ann.points[0].y * h };
        const pv = { x: ann.points[1].x * w, y: ann.points[1].y * h };
        const p3 = { x: ann.points[2].x * w, y: ann.points[2].y * h };
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(pv.x, pv.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = `bold ${Math.round(14 * scaleFactor)}px monospace`;
        ctx.fillText(
          `${ann.angleDeg ?? 0}°`,
          pv.x + 12 * scaleFactor,
          pv.y - 10 * scaleFactor
        );
      } else if (ann.tool === 'TEXT' && ann.points.length >= 1 && ann.text) {
        const tx = ann.points[0].x * w;
        const ty = ann.points[0].y * h;
        ctx.font = `bold ${Math.round(14 * scaleFactor)}px sans-serif`;
        ctx.fillText(ann.text, tx, ty);
      }
      ctx.restore();
    }

    // Watermark footer strip
    ctx.fillStyle = 'rgba(5, 8, 15, 0.82)';
    ctx.fillRect(0, h - 32, w, 32);
    ctx.fillStyle = '#22D3EE';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(
      `CREASELAB BIOMECHANICS · Frame #${currentFrameNumber} (${currentTime.toFixed(2)}s) · ${selectedPhaseTag}`,
      14,
      h - 11
    );

    return canvas.toDataURL('image/png');
  };

  const handleSaveBiomechanicsKeyframe = () => {
    const snap = captureAnnotatedFrameDataUrl();
    const newBookmark: BiomechanicsKeyframeBookmark = {
      id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: `${selectedPhaseTag} @ F${currentFrameNumber}`,
      phaseTag: selectedPhaseTag,
      frameNumber: currentFrameNumber,
      timestampSec: currentTime,
      coachNote:
        keyframeNoteDraft.trim() ||
        `${visibleAnnotations.length} biomechanical overlay(s) recorded at Frame #${currentFrameNumber}.`,
      snapshotDataUrl: snap,
      annotationCount: visibleAnnotations.length,
    };
    setBookmarks((prev) => [newBookmark, ...prev]);
    setKeyframeNoteDraft('');
  };

  const handleDownloadCurrentFramePng = () => {
    const dataUrl = captureAnnotatedFrameDataUrl();
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `biomechanics-frame-${currentFrameNumber}-${selectedPhaseTag
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const renderSvgAnnotation = (ann: TelestratorAnnotation, isDraft = false) => {
    const w = stageDims.width;
    const h = stageDims.height;
    const dashArray = ann.dashed ? '7 5' : undefined;

    if (ann.tool === 'PEN' && ann.points.length >= 2) {
      const d = ann.points
        .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x * w} ${pt.y * h}`)
        .join(' ');
      return (
        <path
          key={ann.id}
          d={d}
          fill="none"
          stroke={ann.color}
          strokeWidth={ann.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={dashArray}
          opacity={isDraft ? 0.85 : 1}
        />
      );
    }

    if ((ann.tool === 'LINE' || ann.tool === 'ARROW') && ann.points.length >= 2) {
      const x1 = ann.points[0].x * w;
      const y1 = ann.points[0].y * h;
      const x2 = ann.points[1].x * w;
      const y2 = ann.points[1].y * h;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = 13 + ann.strokeWidth * 1.2;
      const ax1 = x2 - headLen * Math.cos(angle - Math.PI / 6);
      const ay1 = y2 - headLen * Math.sin(angle - Math.PI / 6);
      const ax2 = x2 - headLen * Math.cos(angle + Math.PI / 6);
      const ay2 = y2 - headLen * Math.sin(angle + Math.PI / 6);
      const distPx = Math.hypot(x2 - x1, y2 - y1);
      const slopeDeg = Number(
        (((Math.atan2(-(y2 - y1), x2 - x1) * 180) / Math.PI + 360) % 180).toFixed(1)
      );

      return (
        <g key={ann.id} opacity={isDraft ? 0.85 : 1}>
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={ann.color}
            strokeWidth={ann.strokeWidth}
            strokeLinecap="round"
            strokeDasharray={dashArray}
          />
          <circle cx={x1} cy={y1} r={ann.strokeWidth * 0.9} fill={ann.color} />
          {ann.tool === 'ARROW' ? (
            <polygon
              points={`${x2},${y2} ${ax1},${ay1} ${ax2},${ay2}`}
              fill={ann.color}
            />
          ) : (
            <circle cx={x2} cy={y2} r={ann.strokeWidth * 0.9} fill={ann.color} />
          )}
          {distPx > 32 && (
            <g transform={`translate(${(x1 + x2) / 2}, ${(y1 + y2) / 2 - 8})`}>
              <rect
                x="-22"
                y="-10"
                width="44"
                height="14"
                rx="3"
                fill="rgba(5, 8, 15, 0.82)"
                stroke={ann.color}
                strokeWidth="0.8"
              />
              <text
                x="0"
                y="0"
                textAnchor="middle"
                fill="#F8FAFC"
                fontSize="9.5"
                fontFamily="monospace"
                fontWeight="bold"
              >
                {slopeDeg}°
              </text>
            </g>
          )}
        </g>
      );
    }

    if (ann.tool === 'CIRCLE' && ann.points.length >= 2) {
      const x1 = ann.points[0].x * w;
      const y1 = ann.points[0].y * h;
      const x2 = ann.points[1].x * w;
      const y2 = ann.points[1].y * h;
      const r = Math.hypot(x2 - x1, y2 - y1);
      return (
        <g key={ann.id} opacity={isDraft ? 0.85 : 1}>
          <circle
            cx={x1}
            cy={y1}
            r={r}
            fill={`${ann.color}18`}
            stroke={ann.color}
            strokeWidth={ann.strokeWidth}
            strokeDasharray={dashArray}
          />
          <circle cx={x1} cy={y1} r="2.5" fill={ann.color} />
        </g>
      );
    }

    if (ann.tool === 'RECT' && ann.points.length >= 2) {
      const x1 = ann.points[0].x * w;
      const y1 = ann.points[0].y * h;
      const x2 = ann.points[1].x * w;
      const y2 = ann.points[1].y * h;
      return (
        <rect
          key={ann.id}
          x={Math.min(x1, x2)}
          y={Math.min(y1, y2)}
          width={Math.abs(x2 - x1)}
          height={Math.abs(y2 - y1)}
          rx="4"
          fill={`${ann.color}14`}
          stroke={ann.color}
          strokeWidth={ann.strokeWidth}
          strokeDasharray={dashArray}
          opacity={isDraft ? 0.85 : 1}
        />
      );
    }

    if (ann.tool === 'PLUMB_LINE' && ann.points.length >= 1) {
      const px = ann.points[0].x * w;
      const py = ann.points[0].y * h;
      return (
        <g key={ann.id}>
          <line
            x1={px}
            y1={0}
            x2={px}
            y2={h}
            stroke={ann.color}
            strokeWidth={ann.strokeWidth * 0.75}
            strokeDasharray="6 4"
          />
          <line
            x1={Math.max(0, px - 56)}
            y1={py}
            x2={Math.min(w, px + 56)}
            y2={py}
            stroke={ann.color}
            strokeWidth={ann.strokeWidth * 0.75}
            strokeDasharray="4 4"
          />
          <circle
            cx={px}
            cy={py}
            r="5"
            fill="none"
            stroke={ann.color}
            strokeWidth="2"
          />
          <text
            x={px + 8}
            y={20}
            fill={ann.color}
            fontSize="10"
            fontFamily="monospace"
            fontWeight="bold"
          >
            PLUMB AXIS (90°)
          </text>
        </g>
      );
    }

    if (ann.tool === 'ANGLE' && ann.points.length === 3) {
      const p1 = { x: ann.points[0].x * w, y: ann.points[0].y * h };
      const pv = { x: ann.points[1].x * w, y: ann.points[1].y * h };
      const p3 = { x: ann.points[2].x * w, y: ann.points[2].y * h };
      const deg =
        ann.angleDeg ??
        computeThreePointAngleDeg(
          ann.points[0],
          ann.points[1],
          ann.points[2],
          aspectRatio
        );
      return (
        <g key={ann.id}>
          <line
            x1={pv.x}
            y1={pv.y}
            x2={p1.x}
            y2={p1.y}
            stroke={ann.color}
            strokeWidth={ann.strokeWidth}
            strokeLinecap="round"
          />
          <line
            x1={pv.x}
            y1={pv.y}
            x2={p3.x}
            y2={p3.y}
            stroke={ann.color}
            strokeWidth={ann.strokeWidth}
            strokeLinecap="round"
          />
          {[p1, pv, p3].map((pt, idx) => (
            <circle
              key={idx}
              cx={pt.x}
              cy={pt.y}
              r={idx === 1 ? 5 : 3.8}
              fill={idx === 1 ? '#05080F' : ann.color}
              stroke={ann.color}
              strokeWidth="2"
            />
          ))}
          <g transform={`translate(${pv.x + 12}, ${pv.y - 12})`}>
            <rect
              x="0"
              y="-14"
              width="52"
              height="18"
              rx="4"
              fill="rgba(5, 8, 15, 0.9)"
              stroke={ann.color}
              strokeWidth="1.2"
            />
            <text
              x="26"
              y="-2"
              textAnchor="middle"
              fill={ann.color}
              fontSize="11"
              fontFamily="monospace"
              fontWeight="bold"
            >
              {deg}°
            </text>
          </g>
        </g>
      );
    }

    if (ann.tool === 'TEXT' && ann.points.length >= 1 && ann.text) {
      const tx = ann.points[0].x * w;
      const ty = ann.points[0].y * h;
      const boxW = Math.max(64, ann.text.length * 7.2 + 16);
      return (
        <g key={ann.id} transform={`translate(${tx}, ${ty})`}>
          <rect
            x="0"
            y="-18"
            width={boxW}
            height="24"
            rx="5"
            fill="rgba(5, 8, 15, 0.88)"
            stroke={ann.color}
            strokeWidth="1.4"
          />
          <text
            x="8"
            y="-2"
            fill={ann.color}
            fontSize="11.5"
            fontFamily="sans-serif"
            fontWeight="bold"
          >
            {ann.text}
          </text>
        </g>
      );
    }

    return null;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        onChange={handleUploadVideoFile}
        className="hidden"
      />

      {/* LEFT 8 COLUMNS (OR FULLSCREEN STUDIO): BIOMECHANICS TELESTRATOR CANVAS & FRAME STEPPER */}
      <div
        className={
          isFullscreen
            ? 'fixed inset-0 z-[100] bg-[#070A10] flex flex-col p-3 gap-2.5 overflow-hidden'
            : 'lg:col-span-8 space-y-3'
        }
      >
        {/* BALL-BY-BALL CLIP SCOPE & DELIVERY QUICK-SEEK BAR */}
        <div className="bg-[#0C111C] border border-slate-800/80 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* Clip Scope Switcher: Ball-by-Ball Clip vs Trimmed Sequence vs Full Video */}
            <div className="flex items-center bg-[#070A10] p-0.5 rounded-lg border border-slate-800/80">
              {focusedContact && (
                <button
                  type="button"
                  onClick={() => {
                    setClipScope('BALL_CLIP');
                    seekToSecond(focusedContact.timestampSec);
                  }}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-mono cursor-pointer transition ${
                    clipScope === 'BALL_CLIP'
                      ? 'bg-cyan-400 text-slate-950 font-bold'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Ball #{focusedContact.indexNumber} Clip
                </button>
              )}
              <button
                type="button"
                onClick={() => setClipScope('TRIMMED_CLIP')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-mono tabular-nums cursor-pointer transition ${
                  clipScope === 'TRIMMED_CLIP'
                    ? 'bg-cyan-400 text-slate-950 font-bold'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {videoTrimWindow?.isCustomTrim
                  ? `Trimmed Clip (${scopeStartSec.toFixed(2)}s–${scopeEndSec.toFixed(2)}s)`
                  : contacts.length > 0
                  ? 'Delivery Sequence Clip'
                  : 'Active Clip'}
              </button>
              <button
                type="button"
                onClick={() => setClipScope('FULL_VIDEO')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-mono tabular-nums cursor-pointer transition ${
                  clipScope === 'FULL_VIDEO'
                    ? 'bg-cyan-400 text-slate-950 font-bold'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Full Video (0s–{duration.toFixed(2)}s)
              </button>
            </div>

            {/* Tagged Deliveries Instant Jump Strip */}
            {contacts.length > 0 ? (
              <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                  Jump to Contact:
                </span>
                {contacts.map((c) => {
                  const isSel = c.id === focusedContact?.id;
                  const isNearContactFrame =
                    Math.abs(currentTime - c.timestampSec) <= 1.2 / fps;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        onSelectContact(c.id);
                        seekToSecond(c.timestampSec);
                      }}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono tabular-nums cursor-pointer transition shrink-0 ${
                        isSel
                          ? c.isOut
                            ? 'bg-rose-500/20 border border-rose-400 text-white font-bold'
                            : 'bg-cyan-500/20 border border-cyan-400 text-white font-bold'
                          : 'bg-[#070A10] hover:bg-[#111827] border border-slate-800/80 text-slate-300'
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          c.isOut
                            ? 'bg-rose-500'
                            : isNearContactFrame
                            ? 'bg-emerald-400'
                            : 'bg-cyan-400'
                        }`}
                      />
                      <span>Ball #{c.indexNumber}</span>
                      <span className="text-[10px] text-slate-400 tabular-nums">
                        {c.timestampSec.toFixed(2)}s
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <span className="text-[11px] font-mono text-slate-400">
                Early Full-Video Mode · Tag contact points in Step 01 to add contact markers on the timeline
              </span>
            )}
          </div>
        </div>

        {/* TOP TELESTRATOR DRAWING RIBBON */}
        <div className="bg-[#0C111C] border border-slate-800/80 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
          {/* Drawing Shape Tools */}
          <div className="flex flex-wrap items-center gap-1">
            {(
              [
                {
                  id: 'PEN',
                  label: 'Freehand',
                  icon: <PenTool className="w-3.5 h-3.5" />,
                },
                {
                  id: 'LINE',
                  label: 'Line',
                  icon: <Minus className="w-3.5 h-3.5 -rotate-45" />,
                },
                {
                  id: 'ARROW',
                  label: 'Arrow',
                  icon: <ArrowUpRight className="w-3.5 h-3.5" />,
                },
                {
                  id: 'CIRCLE',
                  label: 'Circle',
                  icon: <Circle className="w-3.5 h-3.5" />,
                },
                {
                  id: 'ANGLE',
                  label: '3-Pt Angle',
                  icon: <Compass className="w-3.5 h-3.5" />,
                },
                {
                  id: 'PLUMB_LINE',
                  label: 'Plumb Axis',
                  icon: <Crosshair className="w-3.5 h-3.5" />,
                },
                {
                  id: 'RECT',
                  label: 'Box',
                  icon: <Square className="w-3.5 h-3.5" />,
                },
                {
                  id: 'TEXT',
                  label: 'Label',
                  icon: <Type className="w-3.5 h-3.5" />,
                },
                {
                  id: 'ERASER',
                  label: 'Erase',
                  icon: <Eraser className="w-3.5 h-3.5" />,
                },
              ] as Array<{
                id: TelestratorTool;
                label: string;
                icon: React.ReactNode;
              }>
            ).map((t) => {
              const isSelected = activeTool === t.id && !isPanMode && !isZoomBoxMode;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setIsPanMode(false);
                    setIsZoomBoxMode(false);
                    setActiveTool(t.id);
                    if (t.id !== 'ANGLE') setPendingAnglePoints([]);
                  }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer whitespace-nowrap ${
                    isSelected
                      ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                      : 'bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800'
                  }`}
                >
                  {t.icon}
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          {/* Undo / Redo / Clear & Fullscreen */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleUndo}
              disabled={annotations.length === 0 && pendingAnglePoints.length === 0}
              className="p-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 disabled:opacity-40 border border-slate-800 text-slate-200 cursor-pointer"
              title="Undo last drawing (Ctrl+Z)"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              className="p-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 disabled:opacity-40 border border-slate-800 text-slate-200 cursor-pointer"
              title="Redo drawing"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleClearCurrentFrame}
              className="px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs font-mono text-slate-300 cursor-pointer whitespace-nowrap"
              title="Clear drawings made on this frame"
            >
              Clear Frame
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-xs font-mono text-rose-300 cursor-pointer whitespace-nowrap"
              title="Clear all drawings"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear All</span>
            </button>

            <button
              type="button"
              onClick={() => setIsFullscreen((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition whitespace-nowrap ${
                isFullscreen
                  ? 'bg-rose-500 text-white shadow-sm'
                  : 'bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30'
              }`}
            >
              {isFullscreen ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span>Exit Fullscreen</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>Fullscreen</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* SECOND ROW: COLOR SWATCHES, STROKE WIDTH, DASHED TOGGLE, OPTIONAL COACH ZOOM & FRAME SCOPE */}
        <div className="bg-[#0C111C] border border-slate-800/80 rounded-xl px-3 py-2.5 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {/* Colors */}
              <div className="flex items-center gap-1.5 pr-2 border-r border-slate-800">
                {TELESTRATOR_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => setActiveColor(c.hex)}
                    className={`w-5 h-5 rounded-full cursor-pointer transition transform ${
                      activeColor === c.hex
                        ? 'scale-125 ring-2 ring-white ring-offset-1 ring-offset-slate-950'
                        : 'opacity-80 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: c.hex }}
                    title={c.label}
                  />
                ))}
              </div>

              {/* Stroke Widths */}
              <div className="flex items-center gap-1 pr-2 border-r border-slate-800">
                {STROKE_WIDTH_OPTIONS.map((sw) => (
                  <button
                    key={sw}
                    type="button"
                    onClick={() => setStrokeWidth(sw)}
                    className={`px-2 py-0.5 rounded text-[11px] font-mono cursor-pointer transition ${
                      strokeWidth === sw
                        ? 'bg-cyan-500 text-slate-950 font-bold'
                        : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                    }`}
                  >
                    {sw}px
                  </button>
                ))}
              </div>

              {/* Solid vs Dashed */}
              <button
                type="button"
                onClick={() => setIsDashed((v) => !v)}
                className={`px-2.5 py-0.5 rounded text-[11px] font-mono border cursor-pointer transition ${
                  isDashed
                    ? 'bg-amber-500/20 border-amber-400 text-amber-300 font-bold'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {isDashed ? 'Dashed' : 'Solid'}
              </button>

              {/* Posture Grid */}
              <button
                type="button"
                onClick={() => setShowPostureGrid((v) => !v)}
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-mono border cursor-pointer transition ${
                  showPostureGrid
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 font-semibold'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <Grid className="w-3 h-3" />
                <span>Posture Grid</span>
              </button>

              {/* Show/Hide Drawings */}
              <button
                type="button"
                onClick={() => setShowDrawings((v) => !v)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-slate-950 border border-slate-800 text-slate-300 hover:text-white cursor-pointer"
              >
                {showDrawings ? (
                  <Eye className="w-3 h-3 text-cyan-400" />
                ) : (
                  <EyeOff className="w-3 h-3 text-slate-500" />
                )}
                <span>{showDrawings ? 'Hide Ink' : 'Show Ink'}</span>
              </button>

              {activeTool === 'TEXT' && (
                <input
                  type="text"
                  value={customTextDraft}
                  onChange={(e) => setCustomTextDraft(e.target.value)}
                  placeholder="Type coaching label then click video..."
                  className="bg-slate-950 border border-cyan-500/50 rounded px-2.5 py-0.5 text-xs text-white focus:outline-none w-48"
                />
              )}
            </div>

            {/* Dedicated Coach Focus Zoom Toggle + Frame Persistence Scope */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setIsCoachZoomOpen((v) => !v);
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-mono border cursor-pointer transition ${
                  isCoachZoomOpen || canvasZoom > 1.0 || isZoomBoxMode
                    ? 'bg-amber-500/20 border-amber-400 text-amber-200 font-bold'
                    : 'bg-slate-950 border-slate-800 text-slate-300 hover:text-white'
                }`}
                title="Open optional Coach Focus Zoom & Region-of-Interest Inspector"
              >
                <ZoomIn className="w-3.5 h-3.5 text-amber-400" />
                <span>
                  Coach Zoom{' '}
                  {canvasZoom > 1.0 ? `(${Math.round(canvasZoom * 100)}%)` : '(Optional)'}
                </span>
              </button>

              {canvasZoom > 1.0 && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setIsPanMode((v) => !v);
                      setIsZoomBoxMode(false);
                    }}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-mono border cursor-pointer ${
                      isPanMode
                        ? 'bg-amber-400 text-slate-950 border-amber-300 font-bold'
                        : 'bg-slate-950 text-slate-300 border-slate-800'
                    }`}
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
                      setIsZoomBoxMode(false);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-mono bg-slate-950 border border-slate-800 text-slate-300 hover:text-white cursor-pointer"
                    title="Reset Coach Zoom to 100%"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>100%</span>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() =>
                  setFrameFilterMode((m) =>
                    m === 'ALL_FRAMES' ? 'CURRENT_FRAME' : 'ALL_FRAMES'
                  )
                }
                className="px-2.5 py-1 rounded-lg text-[11px] font-mono bg-slate-950 border border-slate-800 text-cyan-300 hover:border-cyan-500/40 cursor-pointer"
                title="Toggle between keeping drawings visible across all frames vs only on the frame they were drawn"
              >
                {frameFilterMode === 'ALL_FRAMES'
                  ? 'Ink: Persistent'
                  : `Ink: Frame #${currentFrameNumber} Only`}
              </button>
            </div>
          </div>

          {/* EXPANDABLE COACH FOCUS ZOOM INSPECTOR (Unlike the Upload tab's contact loupe, lets the coach drag a focus box or focus on specific biomechanical joints) */}
          {isCoachZoomOpen && (
            <div className="pt-2 border-t border-slate-800/90 flex flex-wrap items-center justify-between gap-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsZoomBoxMode((v) => !v);
                    setIsPanMode(false);
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-mono border cursor-pointer transition ${
                    isZoomBoxMode
                      ? 'bg-amber-400 text-slate-950 border-amber-300 font-bold'
                      : 'bg-slate-950 hover:bg-slate-800 border-amber-500/40 text-amber-300'
                  }`}
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>
                    {isZoomBoxMode
                      ? 'Drag a Box on Video to Zoom...'
                      : 'Draw Focus Box to Zoom'}
                  </span>
                </button>

                <div className="flex items-center gap-2 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
                  <span className="text-[11px] font-mono text-slate-400">
                    Magnification:
                  </span>
                  <input
                    type="range"
                    min={100}
                    max={400}
                    step={10}
                    value={Math.round(canvasZoom * 100)}
                    onChange={(e) => {
                      const nextZ = parseInt(e.target.value, 10) / 100;
                      const focusX = focusedContact?.videoPoint.x ?? 0.5;
                      const focusY = focusedContact?.videoPoint.y ?? 0.65;
                      focusCoachZoomOnNormalizedRegion(focusX, focusY, nextZ);
                    }}
                    className="w-24 accent-amber-400 cursor-pointer"
                  />
                  <span className="text-[11px] font-mono text-amber-300 font-bold tabular-nums w-10">
                    {Math.round(canvasZoom * 100)}%
                  </span>
                </div>
              </div>

              {/* 1-Click Biomechanical Focus Regions */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                  Quick Focus:
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const bx = focusedContact?.videoPoint.x ?? 0.5;
                    const by = clamp((focusedContact?.videoPoint.y ?? 0.72) - 0.22, 0.15, 0.85);
                    focusCoachZoomOnNormalizedRegion(bx, by, 2.3);
                  }}
                  className="px-2 py-1 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] font-mono text-slate-200 cursor-pointer"
                >
                  Head &amp; Eyes
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const bx = focusedContact?.videoPoint.x ?? 0.5;
                    const by = clamp((focusedContact?.videoPoint.y ?? 0.72) - 0.08, 0.2, 0.9);
                    focusCoachZoomOnNormalizedRegion(bx, by, 2.5);
                  }}
                  className="px-2 py-1 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] font-mono text-slate-200 cursor-pointer"
                >
                  Bat Grip &amp; Hands
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const bx = focusedContact?.videoPoint.x ?? 0.5;
                    const by = focusedContact?.videoPoint.y ?? 0.74;
                    focusCoachZoomOnNormalizedRegion(bx, by, 2.6);
                  }}
                  className="px-2 py-1 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] font-mono text-cyan-300 cursor-pointer"
                >
                  Impact &amp; Front Base
                </button>
                <button
                  type="button"
                  onClick={() => focusCoachZoomOnNormalizedRegion(0.5, 0.5, 1.0)}
                  className="px-2 py-1 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] font-mono text-slate-400 hover:text-white cursor-pointer"
                >
                  Reset 100%
                </button>
              </div>
            </div>
          )}
        </div>

        {/* INTERACTIVE VIDEO + SVG TELESTRATOR CANVAS */}
        <div
          ref={stageRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={() => {
            setHoverPoint(null);
            if (isDraggingPan) setIsDraggingPan(false);
          }}
          className={`relative w-full bg-[#05080F] rounded-xl overflow-hidden border border-slate-800 select-none touch-none ${
            isPanMode
              ? 'cursor-grab active:cursor-grabbing'
              : isZoomBoxMode
              ? 'cursor-zoom-in'
              : activeTool === 'ERASER'
              ? 'cursor-pointer'
              : 'cursor-crosshair'
          } ${isFullscreen ? 'flex-1 min-h-0' : 'aspect-video'}`}
        >
          <div
            className="absolute inset-0 w-full h-full origin-top-left transition-transform duration-75"
            style={{
              transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${canvasZoom})`,
            }}
          >
            <video
              ref={videoRef}
              src={effectiveVideoUrl || undefined}
              muted
              playsInline
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                const d =
                  Number.isFinite(v.duration) && v.duration > 0
                    ? v.duration
                    : 2.0;
                setDuration(d);
                setVideoDims({
                  width: v.videoWidth || 960,
                  height: v.videoHeight || 540,
                });
              }}
              onDurationChange={(e) => {
                const v = e.currentTarget;
                if (Number.isFinite(v.duration) && v.duration > 0) {
                  setDuration(v.duration);
                }
              }}
              className="w-full h-full object-contain pointer-events-none"
            />

            {/* SVG Telestrator Overlay */}
            <svg
              viewBox={`0 0 ${stageDims.width} ${stageDims.height}`}
              className="absolute inset-0 w-full h-full pointer-events-none z-10"
            >
              {/* Optional Biomechanical Posture Reference Grid */}
              {showPostureGrid && (
                <g opacity="0.45">
                  {[1, 2, 3, 4, 5, 6, 7].map((i) => {
                    const gx = (stageDims.width * i) / 8;
                    return (
                      <line
                        key={`vg-${i}`}
                        x1={gx}
                        y1={0}
                        x2={gx}
                        y2={stageDims.height}
                        stroke={i === 4 ? '#F59E0B' : '#22D3EE'}
                        strokeWidth={i === 4 ? '1.3' : '0.8'}
                        strokeDasharray={i === 4 ? '6 4' : '3 3'}
                      />
                    );
                  })}
                  {[1, 2, 3, 4, 5].map((j) => {
                    const gy = (stageDims.height * j) / 6;
                    return (
                      <line
                        key={`hg-${j}`}
                        x1={0}
                        y1={gy}
                        x2={stageDims.width}
                        y2={gy}
                        stroke="#22D3EE"
                        strokeWidth="0.8"
                        strokeDasharray="3 3"
                      />
                    );
                  })}
                </g>
              )}

              {/* Saved Telestrator Shapes */}
              {showDrawings &&
                visibleAnnotations.map((ann) => renderSvgAnnotation(ann, false))}

              {/* Active Drag Shape Preview */}
              {showDrawings &&
                draftAnnotation &&
                renderSvgAnnotation(draftAnnotation, true)}

              {/* Active Coach Focus Box Marquee Preview */}
              {zoomBoxDraft && (
                <rect
                  x={Math.min(zoomBoxDraft.start.x, zoomBoxDraft.end.x) * stageDims.width}
                  y={Math.min(zoomBoxDraft.start.y, zoomBoxDraft.end.y) * stageDims.height}
                  width={Math.abs(zoomBoxDraft.end.x - zoomBoxDraft.start.x) * stageDims.width}
                  height={Math.abs(zoomBoxDraft.end.y - zoomBoxDraft.start.y) * stageDims.height}
                  rx="4"
                  fill="rgba(251, 191, 36, 0.16)"
                  stroke="#FBBF24"
                  strokeWidth="2"
                  strokeDasharray="5 3"
                />
              )}

              {/* 3-Point Angle Tool In-Progress Preview */}
              {activeTool === 'ANGLE' && pendingAnglePoints.length > 0 && (
                <g>
                  {pendingAnglePoints.map((pt, idx) => (
                    <circle
                      key={idx}
                      cx={pt.x * stageDims.width}
                      cy={pt.y * stageDims.height}
                      r="4.5"
                      fill={activeColor}
                      stroke="#05080F"
                      strokeWidth="1.5"
                    />
                  ))}
                  {pendingAnglePoints.length === 1 && hoverPoint && (
                    <line
                      x1={pendingAnglePoints[0].x * stageDims.width}
                      y1={pendingAnglePoints[0].y * stageDims.height}
                      x2={hoverPoint.x * stageDims.width}
                      y2={hoverPoint.y * stageDims.height}
                      stroke={activeColor}
                      strokeWidth={strokeWidth}
                      strokeDasharray="4 4"
                    />
                  )}
                  {pendingAnglePoints.length === 2 && hoverPoint && (
                    <>
                      <line
                        x1={pendingAnglePoints[0].x * stageDims.width}
                        y1={pendingAnglePoints[0].y * stageDims.height}
                        x2={pendingAnglePoints[1].x * stageDims.width}
                        y2={pendingAnglePoints[1].y * stageDims.height}
                        stroke={activeColor}
                        strokeWidth={strokeWidth}
                      />
                      <line
                        x1={pendingAnglePoints[1].x * stageDims.width}
                        y1={pendingAnglePoints[1].y * stageDims.height}
                        x2={hoverPoint.x * stageDims.width}
                        y2={hoverPoint.y * stageDims.height}
                        stroke={activeColor}
                        strokeWidth={strokeWidth}
                        strokeDasharray="4 4"
                      />
                      <text
                        x={pendingAnglePoints[1].x * stageDims.width + 12}
                        y={pendingAnglePoints[1].y * stageDims.height - 10}
                        fill={activeColor}
                        fontSize="11"
                        fontFamily="monospace"
                        fontWeight="bold"
                      >
                        {computeThreePointAngleDeg(
                          pendingAnglePoints[0],
                          pendingAnglePoints[1],
                          hoverPoint,
                          aspectRatio
                        )}
                        °
                      </text>
                    </>
                  )}
                </g>
              )}
            </svg>
          </div>

          {/* Top-Left Live Coaching HUD Badge */}
          <div className="absolute top-2.5 left-2.5 z-20 pointer-events-none flex items-center gap-2 bg-slate-950/85 backdrop-blur-md border border-slate-800 px-3 py-1 rounded-lg text-[11px] font-mono">
            <span className="text-cyan-300 font-bold">
              Frame #{currentFrameNumber} / {totalFrames}
            </span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-200 tabular-nums">
              {currentTime.toFixed(2)}s
            </span>
            {isZoomBoxMode && (
              <>
                <span className="text-slate-600">·</span>
                <span className="text-amber-300 font-bold">
                  Drag box on video to Coach Zoom
                </span>
              </>
            )}
            {activeTool === 'ANGLE' && !isZoomBoxMode && (
              <>
                <span className="text-slate-600">·</span>
                <span className="text-amber-300">
                  Click {3 - pendingAnglePoints.length} point(s) for joint angle
                </span>
              </>
            )}
          </div>
        </div>

        {/* FRAME-BY-FRAME PRECISION TRANSPORT & TIMELINE SCRUBBER WITH CONTACT MARKERS */}
        <div className="bg-[#0C111C] border border-slate-800/80 rounded-xl p-4 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Frame Stepping Buttons */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={togglePlay}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold cursor-pointer transition"
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
                onClick={() => stepFrames(-10)}
                className="px-2 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs font-mono text-slate-300 cursor-pointer"
                title="Step Back 10 Frames"
              >
                -10f
              </button>
              <button
                type="button"
                onClick={() => stepFrames(-5)}
                className="px-2 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs font-mono text-slate-300 cursor-pointer"
                title="Step Back 5 Frames"
              >
                -5f
              </button>
              <button
                type="button"
                onClick={() => stepFrames(-1)}
                className="inline-flex items-center gap-0.5 px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-cyan-500/40 text-xs font-mono font-bold text-cyan-300 cursor-pointer"
                title="Previous Frame (Left Arrow)"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Prev Frame</span>
              </button>
              <button
                type="button"
                onClick={() => stepFrames(1)}
                className="inline-flex items-center gap-0.5 px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-cyan-500/40 text-xs font-mono font-bold text-cyan-300 cursor-pointer"
                title="Next Frame (Right Arrow)"
              >
                <span>Next Frame</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => stepFrames(5)}
                className="px-2 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs font-mono text-slate-300 cursor-pointer"
                title="Step Forward 5 Frames"
              >
                +5f
              </button>
              <button
                type="button"
                onClick={() => stepFrames(10)}
                className="px-2 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs font-mono text-slate-300 cursor-pointer"
                title="Step Forward 10 Frames"
              >
                +10f
              </button>
            </div>

            {/* Slow-Motion Speed & Snapshot Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800">
                {[0.1, 0.25, 0.5, 1.0].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => {
                      setPlaybackRate(rate);
                      if (videoRef.current) videoRef.current.playbackRate = rate;
                    }}
                    className={`px-2 py-0.5 rounded text-[11px] font-mono cursor-pointer ${
                      playbackRate === rate
                        ? 'bg-slate-800 text-cyan-300 font-bold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={handleDownloadCurrentFramePng}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold cursor-pointer transition"
                title="Download annotated coaching frame as PNG"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Frame PNG</span>
              </button>
            </div>
          </div>

          {/* Frame-Accurate Timeline Scrubber with Visual Contact Point Markers */}
          <div className="space-y-1.5 pt-1">
            {contacts.length > 0 && (
              <div className="relative h-5 w-full select-none">
                {contacts.map((c) => {
                  const span = Math.max(0.05, scopeEndSec - scopeStartSec);
                  const pct = clamp(
                    ((c.timestampSec - scopeStartSec) / span) * 100,
                    1,
                    99
                  );
                  const isSel = c.id === focusedContact?.id;
                  return (
                    <button
                      key={`scrubber-marker-${c.id}`}
                      type="button"
                      onClick={() => {
                        onSelectContact(c.id);
                        seekToSecond(c.timestampSec);
                      }}
                      style={{ left: `${pct}%` }}
                      className={`absolute -translate-x-1/2 top-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold cursor-pointer transition shadow-sm ${
                        c.isOut
                          ? 'bg-rose-500 text-white border border-rose-300'
                          : isSel
                          ? 'bg-cyan-400 text-slate-950 border border-white'
                          : 'bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/40'
                      }`}
                      title={`Click to jump to Ball #${c.indexNumber} Contact Frame (${c.timestampSec.toFixed(2)}s)`}
                    >
                      <span>#{c.indexNumber}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="relative flex items-center">
              <input
                type="range"
                min={scopeStartSec}
                max={Math.max(scopeStartSec + 0.05, scopeEndSec)}
                step={1 / fps}
                value={clamp(
                  currentTime,
                  scopeStartSec,
                  Math.max(scopeStartSec + 0.05, scopeEndSec)
                )}
                onChange={(e) => seekToSecond(parseFloat(e.target.value))}
                className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg relative z-10"
              />
              {/* Vertical Contact Tick Marks on the Scrubber Track */}
              {contacts.map((c) => {
                const span = Math.max(0.05, scopeEndSec - scopeStartSec);
                if (c.timestampSec < scopeStartSec || c.timestampSec > scopeEndSec) {
                  return null;
                }
                const pct = clamp(
                  ((c.timestampSec - scopeStartSec) / span) * 100,
                  0.5,
                  99.5
                );
                return (
                  <div
                    key={`tick-${c.id}`}
                    style={{ left: `${pct}%` }}
                    className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1 h-3.5 rounded-full pointer-events-none z-20 ${
                      c.isOut ? 'bg-rose-500' : 'bg-amber-400'
                    }`}
                  />
                );
              })}
            </div>

            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 tabular-nums">
              <span>
                Frame {scopeStartFrame} ({scopeStartSec.toFixed(2)}s)
              </span>
              <span className="text-cyan-300 font-semibold">
                Current: Frame #{currentFrameNumber} ({currentTime.toFixed(2)}s) ·{' '}
                {visibleAnnotations.length} active drawing(s)
              </span>
              <span>
                Frame {scopeEndFrame} ({scopeEndSec.toFixed(2)}s)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT 4 COLUMNS: COACH BIOMECHANICS WORKBENCH, DELIVERY JUMP & KEYFRAME SNAPSHOT GALLERY */}
      <div className="lg:col-span-4 space-y-4">
        {/* Card 1: Video Clip Source & Tagged Deliveries Quick-Jump */}
        <div className="bg-[#0C111C] border border-slate-800/80 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-white">
                Biomechanics Video Source
              </h3>
              <p className="text-[11px] text-slate-400 truncate max-w-[210px]">
                {videoName} ({handedness})
              </p>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 text-xs font-bold cursor-pointer transition shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload Clip</span>
            </button>
          </div>

          {contacts.length > 0 && (
            <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
              <span className="block text-[10px] font-mono uppercase tracking-wider text-slate-400">
                Click Delivery Number to Seek to Exact Contact Moment
              </span>
              <div className="flex flex-wrap gap-1.5">
                {contacts.map((c) => {
                  const isSel = c.id === focusedContact?.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        onSelectContact(c.id);
                        seekToSecond(c.timestampSec);
                      }}
                      className={`px-2.5 py-1 rounded-lg border text-xs font-mono tabular-nums cursor-pointer transition ${
                        isSel
                          ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 font-bold'
                          : 'bg-[#070A10] hover:bg-[#111827] border-slate-800/80 text-slate-300'
                      }`}
                    >
                      Ball #{c.indexNumber} ({c.timestampSec.toFixed(2)}s)
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Card 2: Pin Biomechanical Keyframe & Coaching Note */}
        <div className="bg-[#0C111C] border border-slate-800/80 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-wider text-cyan-400 font-bold">
              Bookmark Annotated Keyframe
            </span>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              Frame #{currentFrameNumber}
            </span>
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1">
              Biomechanical Phase
            </label>
            <div className="flex flex-wrap gap-1.5">
              {BIOMECH_PHASE_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setSelectedPhaseTag(tag)}
                  className={`px-2 py-1 rounded-lg border text-[11px] font-mono cursor-pointer transition ${
                    selectedPhaseTag === tag
                      ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 font-bold'
                      : 'bg-[#070A10] border-slate-800/80 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1">
              Coach Biomechanics Observation
            </label>
            <textarea
              rows={2}
              value={keyframeNoteDraft}
              onChange={(e) => setKeyframeNoteDraft(e.target.value)}
              placeholder="e.g., Head aligned over front knee at 142° elbow extension; bat coming down straight through the V..."
              className="w-full bg-[#070A10] border border-slate-800/80 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
            />
          </div>

          <button
            type="button"
            onClick={handleSaveBiomechanicsKeyframe}
            className="w-full inline-flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 text-xs font-bold cursor-pointer transition"
          >
            <Camera className="w-4 h-4" />
            <span>Save Annotated Keyframe Snapshot</span>
          </button>
        </div>

        {/* Card 3: Saved Biomechanical Keyframe Gallery */}
        <div className="bg-[#0C111C] border border-slate-800/80 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-wider text-slate-300 font-bold tabular-nums">
              Saved Keyframe Snapshots ({bookmarks.length})
            </span>
            {bookmarks.length > 0 && (
              <button
                type="button"
                onClick={() => setBookmarks([])}
                className="text-[11px] font-mono text-slate-400 hover:text-rose-300 cursor-pointer"
              >
                Clear List
              </button>
            )}
          </div>

          {bookmarks.length === 0 ? (
            <div className="bg-[#070A10] border border-slate-800/80 rounded-lg p-4 text-center space-y-1">
              <p className="text-xs font-medium text-slate-300">
                No biomechanics snapshots saved yet
              </p>
              <p className="text-[11px] text-slate-500">
                Step frame-by-frame, draw lines, circles, or 3-point joint angles on the video, then click &ldquo;Save Annotated Keyframe Snapshot&rdquo;.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
              {bookmarks.map((bm) => (
                <div
                  key={bm.id}
                  className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => seekToSecond(bm.timestampSec)}
                      className="text-left group cursor-pointer"
                    >
                      <span className="text-xs font-bold text-cyan-300 group-hover:underline">
                        {bm.phaseTag}
                      </span>
                      <span className="text-[11px] font-mono text-slate-400 ml-2">
                        F{bm.frameNumber} ({bm.timestampSec.toFixed(2)}s)
                      </span>
                    </button>

                    <a
                      href={bm.snapshotDataUrl}
                      download={`biomechanics-F${bm.frameNumber}.png`}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] font-mono text-emerald-300"
                    >
                      <Download className="w-3 h-3" />
                      <span>PNG</span>
                    </a>
                  </div>

                  {bm.snapshotDataUrl && (
                    <img
                      src={bm.snapshotDataUrl}
                      alt={bm.label}
                      referrerPolicy="no-referrer"
                      onClick={() => seekToSecond(bm.timestampSec)}
                      className="w-full h-28 object-cover rounded border border-slate-800 cursor-pointer"
                    />
                  )}

                  <p className="text-[11px] text-slate-300 leading-snug">
                    {bm.coachNote}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
