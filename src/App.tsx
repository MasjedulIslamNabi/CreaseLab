import React, { useEffect, useState } from 'react';
import {
  Activity,
  Box,
  Compass,
  PenTool,
  Plus,
  ShieldCheck,
  Sparkles,
  Upload,
  Video,
  Check,
} from 'lucide-react';
import {
  AIShotAnalysisReport,
  BatterHandedness,
  ContactPointRecord,
  PendingContactPreview,
  PlantedStumpsConfig,
  ShotOutcomeTag,
} from './types/cricket';
import {
  autoDetectBounceFromContactPoint,
  calculateImaginaryStumpPoint,
  createDefaultPlantedStumps,
  getZoneColorConfig,
  project3DPitchBounceToVideo,
  projectVideoBounceTo3DPitch,
} from './utils/stumpProjection';
import { getInitialContactPoints } from './data/referenceDeliveries';
import { VideoConnectionStage } from './components/VideoConnectionStage';
import {
  DashboardWorkspaceTab,
  ImaginaryStumpDashboard,
} from './components/ImaginaryStumpDashboard';
import { MatchupStudioWorkspace } from './components/MatchupStudioWorkspace';
import { BiomechanicsTelestrator } from './components/BiomechanicsTelestrator';
import { OnboardingTutorialModal } from './components/OnboardingTutorialModal';

const STORAGE_KEY_STUMPS = 'creaselabb_working_stumps_v10';
const STORAGE_KEY_TUTORIAL = 'creaselabb_onboarding_tour_broadcast_v5';

type TopLevelWorkspaceTab =
  | 'VIDEO'
  | 'MATCHUP_STUDIO'
  | 'PITCH_3D'
  | 'DRS_TELEMETRY'
  | 'BIOMECHANICS';

export function App() {
  const [activeTab, setActiveTab] =
    useState<TopLevelWorkspaceTab>('VIDEO');
  const [isTutorialOpen, setIsTutorialOpen] = useState<boolean>(true);
  const [savedToastBallNum, setSavedToastBallNum] = useState<number | null>(
    null
  );
  const [handedness, setHandedness] = useState<BatterHandedness>('RHB');
  const [activeVideoUrl, setActiveVideoUrl] = useState<string>('');
  const [videoTrimWindow, setVideoTrimWindow] = useState<{
    trimStartSec: number;
    trimEndSec: number;
    durationSec: number;
    isCustomTrim: boolean;
  }>({
    trimStartSec: 0,
    trimEndSec: 2.0,
    durationSec: 2.0,
    isCustomTrim: false,
  });

  const [workingStumps, setWorkingStumps] = useState<PlantedStumpsConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_STUMPS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.backStumps && parsed?.frontStumps) {
          return {
            anchorMode: parsed.anchorMode || 'CREASE_ARROW',
            farEndMode: parsed.farEndMode || 'VISIBLE_PITCH_AXIS',
            releaseVisibilityMode:
              parsed.releaseVisibilityMode || 'UNSEEN_RELEASE',
            ...parsed,
          };
        }
      }
    } catch {
      // ignore
    }
    return createDefaultPlantedStumps();
  });

  const [contacts, setContacts] = useState<ContactPointRecord[]>([]);

  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    null
  );
  const [pendingPreview, setPendingPreview] =
    useState<PendingContactPreview | null>(null);
  const [seekRequest, setSeekRequest] = useState<{
    timestampSec: number;
    seq: number;
  } | null>(null);

  const explicitSelectedContact = selectedContactId
    ? contacts.find((c) => c.id === selectedContactId) || null
    : null;

  // When no ball is explicitly selected from the ledger, selectedContact is null,
  // ensuring all previous delivery marks disappear cleanly so the user can mark the next ball
  const selectedContact = explicitSelectedContact;

  const activeStumps =
    explicitSelectedContact &&
    explicitSelectedContact.isLocked === false &&
    !pendingPreview
      ? explicitSelectedContact.stumpConfig
      : workingStumps;

  const handleChangeActiveStumps = (nextStumps: PlantedStumpsConfig) => {
    setWorkingStumps(nextStumps);

    if (pendingPreview) {
      const isUnseen =
        (nextStumps.releaseVisibilityMode || 'UNSEEN_RELEASE') ===
        'UNSEEN_RELEASE';
      const updatedBounceM = pendingPreview.bouncePoint
        ? projectVideoBounceTo3DPitch(
            pendingPreview.bouncePoint,
            nextStumps,
            isUnseen ? null : pendingPreview.releasePoint,
            pendingPreview.videoPoint
          ).bounceDistanceFromStumpsM
        : pendingPreview.bounceLengthM;
      setPendingPreview((prev) =>
        prev
          ? {
              ...prev,
              bounceLengthM: updatedBounceM,
              ...(isUnseen ? { releasePoint: undefined } : {}),
            }
          : prev
      );
    }

    if (selectedContactId) {
      const target = contacts.find((c) => c.id === selectedContactId);
      if (target && target.isLocked === false) {
        setContacts((prev) =>
          prev.map((item) => {
            if (item.id !== selectedContactId) return item;
            const isUnseen =
              (nextStumps.releaseVisibilityMode || 'UNSEEN_RELEASE') ===
              'UNSEEN_RELEASE';
            const autoBounce = autoDetectBounceFromContactPoint(
              item.videoPoint,
              nextStumps,
              handedness,
              item.timestampSec,
              undefined,
              item.bouncePoint
            );
            return {
              ...item,
              stumpConfig: nextStumps,
              bouncePoint: item.bouncePoint ?? autoBounce.bouncePoint,
              releasePoint: isUnseen
                ? undefined
                : item.releasePoint ?? autoBounce.releasePoint,
              bounceLengthM: item.bouncePoint
                ? projectVideoBounceTo3DPitch(
                    item.bouncePoint,
                    nextStumps,
                    isUnseen ? null : item.releasePoint,
                    item.videoPoint
                  ).bounceDistanceFromStumpsM
                : autoBounce.bounceDistanceFromStumpsM,
              projection: calculateImaginaryStumpPoint(
                item.videoPoint,
                nextStumps,
                handedness,
                item.bouncePoint ?? autoBounce.bouncePoint
              ),
            };
          })
        );
      }
    }
  };

  useEffect(() => {
    setContacts((prev) =>
      prev.map((item) => ({
        ...item,
        projection: calculateImaginaryStumpPoint(
          item.videoPoint,
          item.stumpConfig,
          handedness,
          item.bouncePoint
        ),
      }))
    );
  }, [handedness]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_STUMPS, JSON.stringify(workingStumps));
    } catch {
      // ignore
    }
  }, [workingStumps]);

  const handleStagePreviewPoint = (preview: PendingContactPreview) => {
    if (
      explicitSelectedContact &&
      explicitSelectedContact.isLocked === false
    ) {
      setContacts((prev) =>
        prev.map((item) => {
          if (item.id !== explicitSelectedContact.id) return item;
          const isUnseen =
            (item.stumpConfig.releaseVisibilityMode || 'UNSEEN_RELEASE') ===
            'UNSEEN_RELEASE';
          const autoBounce = autoDetectBounceFromContactPoint(
            preview.videoPoint,
            item.stumpConfig,
            handedness,
            preview.timestampSec,
            preview.bounceLengthM,
            preview.bouncePoint ?? item.bouncePoint
          );
          const resolvedBouncePt =
            preview.bouncePoint ?? autoBounce.bouncePoint ?? item.bouncePoint;
          const refinedBounceM =
            typeof preview.bounceLengthM === 'number' && preview.bounceLengthM > 0
              ? preview.bounceLengthM
              : resolvedBouncePt
              ? projectVideoBounceTo3DPitch(
                  resolvedBouncePt,
                  item.stumpConfig,
                  isUnseen ? null : preview.releasePoint ?? item.releasePoint,
                  preview.videoPoint
                ).bounceDistanceFromStumpsM
              : autoBounce.bounceDistanceFromStumpsM;
          return {
            ...item,
            videoPoint: preview.videoPoint,
            releasePoint: isUnseen
              ? undefined
              : preview.releasePoint ??
                autoBounce.releasePoint ??
                item.releasePoint,
            bouncePoint: resolvedBouncePt,
            bounceLengthM: refinedBounceM,
            bounceTimestampSec:
              preview.bounceTimestampSec ??
              autoBounce.bounceTimestampSec ??
              item.bounceTimestampSec,
            batBladeBox: preview.batBladeBox ?? item.batBladeBox,
            timestampSec: preview.timestampSec,
            frameSnapshotUrl: preview.snapshotUrl || item.frameSnapshotUrl,
            releaseTimestampSec:
              preview.releaseTimestampSec ??
              autoBounce.releaseTimestampSec ??
              item.releaseTimestampSec,
            calibratedSpeedKph:
              preview.calibratedSpeedKph ?? item.calibratedSpeedKph,
            aiShotAnalysis: preview.aiShotAnalysis ?? item.aiShotAnalysis,
            selectedShotName: preview.selectedShotName ?? item.selectedShotName,
            wagonWheelAngleDeg:
              preview.wagonWheelAngleDeg ?? item.wagonWheelAngleDeg,
            isOut: preview.isOut ?? item.isOut,
            dismissalType: preview.dismissalType ?? item.dismissalType,
            ballNote: preview.ballNote ?? item.ballNote,
            trackedWaypoints:
              preview.trackedWaypoints ?? item.trackedWaypoints,
            bowlerReleaseAngleLabel:
              preview.bowlerReleaseAngleLabel ?? item.bowlerReleaseAngleLabel,
            projection: calculateImaginaryStumpPoint(
              preview.videoPoint,
              item.stumpConfig,
              handedness,
              resolvedBouncePt
            ),
          };
        })
      );
      return;
    }

    if (selectedContactId) {
      setSelectedContactId(null);
    }
    setPendingPreview((prev) => ({
      ...preview,
      selectedShotName: preview.selectedShotName ?? prev?.selectedShotName,
      wagonWheelAngleDeg: preview.wagonWheelAngleDeg ?? prev?.wagonWheelAngleDeg,
      isOut: preview.isOut ?? prev?.isOut ?? false,
      dismissalType: preview.dismissalType ?? prev?.dismissalType,
      ballNote: preview.ballNote ?? prev?.ballNote ?? '',
    }));
  };

  const handleUpdatePendingMeta = (patch: Partial<PendingContactPreview>) => {
    setPendingPreview((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const handleUpdateContactMeta = (
    id: string,
    patch: Partial<ContactPointRecord>
  ) => {
    setContacts((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
  };

  const handleCommitPendingPreview = (customBounceLengthM?: number | null) => {
    if (!pendingPreview) return;

    const lockedStumpConfig: PlantedStumpsConfig = {
      ...activeStumps,
      backStumps: { ...activeStumps.backStumps },
      frontStumps: { ...activeStumps.frontStumps },
      ...(activeStumps.stumpTopPoint
        ? { stumpTopPoint: { ...activeStumps.stumpTopPoint } }
        : {}),
      ...(activeStumps.poppingCreasePoint
        ? { poppingCreasePoint: { ...activeStumps.poppingCreasePoint } }
        : {}),
    };

    const nextIdx =
      contacts.length > 0
        ? Math.max(...contacts.map((c) => c.indexNumber)) + 1
        : 1;

    const explicitBounceM =
      typeof customBounceLengthM === 'number' && customBounceLengthM > 0
        ? customBounceLengthM
        : typeof pendingPreview.bounceLengthM === 'number' &&
          pendingPreview.bounceLengthM > 0
        ? pendingPreview.bounceLengthM
        : undefined;

    const autoBounce = autoDetectBounceFromContactPoint(
      pendingPreview.videoPoint,
      lockedStumpConfig,
      handedness,
      pendingPreview.timestampSec,
      explicitBounceM
    );

    const isUnseen =
      (lockedStumpConfig.releaseVisibilityMode || 'UNSEEN_RELEASE') ===
      'UNSEEN_RELEASE';
    const resolvedBouncePoint =
      pendingPreview.bouncePoint ?? autoBounce.bouncePoint;
    const resolvedReleasePoint = isUnseen
      ? undefined
      : pendingPreview.releasePoint ?? autoBounce.releasePoint;

    const projection = calculateImaginaryStumpPoint(
      pendingPreview.videoPoint,
      lockedStumpConfig,
      handedness,
      resolvedBouncePoint
    );

    const homographyBounceM = resolvedBouncePoint
      ? projectVideoBounceTo3DPitch(
          resolvedBouncePoint,
          lockedStumpConfig,
          resolvedReleasePoint,
          pendingPreview.videoPoint
        )?.bounceDistanceFromStumpsM
      : autoBounce.bounceDistanceFromStumpsM;

    const resolvedBounceLengthM =
      typeof explicitBounceM === 'number' && explicitBounceM > 0
        ? explicitBounceM
        : homographyBounceM ?? autoBounce.bounceDistanceFromStumpsM;

    const newRecord: ContactPointRecord = {
      id: `pt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      indexNumber: nextIdx,
      timestampSec: pendingPreview.timestampSec,
      videoPoint: { ...pendingPreview.videoPoint },
      releasePoint: resolvedReleasePoint,
      bouncePoint: resolvedBouncePoint,
      bounceTimestampSec:
        pendingPreview.bounceTimestampSec ?? autoBounce.bounceTimestampSec,
      releaseTimestampSec:
        pendingPreview.releaseTimestampSec ?? autoBounce.releaseTimestampSec,
      batBladeBox: pendingPreview.batBladeBox,
      stumpConfig: lockedStumpConfig,
      projection,
      frameSnapshotUrl: pendingPreview.snapshotUrl || '',
      source: pendingPreview.source,
      clipLabel: pendingPreview.clipLabel,
      isLocked: true,
      selectedShotName: pendingPreview.selectedShotName,
      wagonWheelAngleDeg: pendingPreview.wagonWheelAngleDeg,
      isOut: pendingPreview.isOut ?? false,
      dismissalType: pendingPreview.dismissalType,
      ballNote: pendingPreview.ballNote,
      ...(pendingPreview.trackedWaypoints?.length
        ? { trackedWaypoints: pendingPreview.trackedWaypoints }
        : {}),
      ...(pendingPreview.bowlerReleaseAngleLabel
        ? { bowlerReleaseAngleLabel: pendingPreview.bowlerReleaseAngleLabel }
        : {}),
      ...(typeof resolvedBounceLengthM === 'number' && resolvedBounceLengthM > 0
        ? { bounceLengthM: resolvedBounceLengthM }
        : {}),
      ...(typeof pendingPreview.calibratedSpeedKph === 'number' &&
      pendingPreview.calibratedSpeedKph > 0
        ? { calibratedSpeedKph: pendingPreview.calibratedSpeedKph }
        : {}),
      ...(pendingPreview.aiShotAnalysis
        ? { aiShotAnalysis: pendingPreview.aiShotAnalysis }
        : {}),
    };

    setContacts((prev) => [...prev, newRecord]);
    setPendingPreview(null);
    // Clear selectedContactId so all delivery marks vanish from the video stage
    // and the user can immediately record the next delivery cleanly.
    setSelectedContactId(null);
    setSavedToastBallNum(newRecord.indexNumber);
  };

  useEffect(() => {
    if (savedToastBallNum === null) return;
    const timer = window.setTimeout(() => {
      setSavedToastBallNum(null);
    }, 3200);
    return () => window.clearTimeout(timer);
  }, [savedToastBallNum]);

  const handleCloseTutorial = () => {
    setIsTutorialOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY_TUTORIAL, 'dismissed');
    } catch {
      // ignore
    }
  };

  const handleToggleLockContact = (id: string) => {
    setContacts((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const currentlyLocked = c.isLocked !== false;
        return {
          ...c,
          isLocked: !currentlyLocked,
        };
      })
    );
    const target = contacts.find((c) => c.id === id);
    if (target) {
      const willBeLocked = target.isLocked === false;
      if (!willBeLocked) {
        setPendingPreview(null);
        setSelectedContactId(id);
        setWorkingStumps(target.stumpConfig);
        setSeekRequest((prev) => ({
          timestampSec: target.timestampSec,
          seq: (prev?.seq || 0) + 1,
        }));
      } else {
        setSelectedContactId(null);
      }
    }
  };

  const handleSelectContact = (id: string | null) => {
    setSelectedContactId(id);
    if (id) {
      const found = contacts.find((c) => c.id === id);
      if (found) {
        if (found.isLocked === false) {
          setWorkingStumps(found.stumpConfig);
        }
        setSeekRequest((prev) => ({
          timestampSec: found.timestampSec,
          seq: (prev?.seq || 0) + 1,
        }));
      }
    }
  };

  const handleDeleteContact = (id: string) => {
    setContacts((prev) => prev.filter((c) => c.id !== id));
    if (selectedContactId === id) setSelectedContactId(null);
  };

  const handleUpdateContactBounceLength = (
    id: string,
    bounceLengthM: number | undefined
  ) => {
    setContacts((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        if (typeof bounceLengthM !== 'number' || bounceLengthM <= 0) {
          return { ...c, bounceLengthM: undefined };
        }
        const currentBounce3D = c.bouncePoint
          ? projectVideoBounceTo3DPitch(c.bouncePoint, c.stumpConfig)
          : { bounceXCm: c.projection.screenOffsetCm };
        const updatedBouncePoint = project3DPitchBounceToVideo(
          bounceLengthM,
          currentBounce3D.bounceXCm,
          c.stumpConfig
        );
        return {
          ...c,
          bounceLengthM,
          bouncePoint: updatedBouncePoint,
        };
      })
    );
  };

  const handleUpdateContactSpeed = (
    id: string,
    calibratedSpeedKph: number | undefined
  ) => {
    setContacts((prev) =>
      prev.map((c) => (c.id === id ? { ...c, calibratedSpeedKph } : c))
    );
  };

  const handleUpdateContactOutcome = (
    id: string,
    shotOutcome: ShotOutcomeTag | undefined
  ) => {
    setContacts((prev) =>
      prev.map((c) => (c.id === id ? { ...c, shotOutcome } : c))
    );
  };

  const handleUpdateContactShotAnalysis = (
    id: string,
    aiShotAnalysis: AIShotAnalysisReport
  ) => {
    setContacts((prev) =>
      prev.map((c) => (c.id === id ? { ...c, aiShotAnalysis } : c))
    );
  };

  const handleSeekMainVideo = (timestampSec: number) => {
    setSeekRequest((prev) => ({
      timestampSec,
      seq: (prev?.seq || 0) + 1,
    }));
  };

  const [studioTheme, setStudioTheme] = useState<'carbon' | 'carbon-high-contrast' | 'carbon-midnight'>(() => {
    try {
      const saved = localStorage.getItem('creaselabb_studio_theme_v2');
      if (saved === 'carbon' || saved === 'carbon-high-contrast' || saved === 'carbon-midnight') {
        return saved;
      }
    } catch {
      // ignore
    }
    return 'carbon';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', studioTheme);
    try {
      localStorage.setItem('creaselabb_studio_theme_v2', studioTheme);
    } catch {
      // ignore
    }
  }, [studioTheme]);

  const dashboardTab: DashboardWorkspaceTab =
    activeTab === 'DRS_TELEMETRY' ? 'DRS_TELEMETRY' : 'PITCH_3D';

  const navItems: Array<{
    id: TopLevelWorkspaceTab;
    stepNum: string;
    label: string;
    sublabel: string;
    icon: React.ReactNode;
  }> = [
    {
      id: 'VIDEO',
      stepNum: '01',
      label: 'Video & Track',
      sublabel: 'Calibrate & mark B → C',
      icon: <Video className="w-4 h-4" />,
    },
    {
      id: 'PITCH_3D',
      stepNum: '02',
      label: '3D Hawk-Eye',
      sublabel: 'Interactive 3D pitch orbit',
      icon: <Box className="w-4 h-4" />,
    },
    {
      id: 'DRS_TELEMETRY',
      stepNum: '03',
      label: 'DRS Review',
      sublabel: 'Pitching, impact & wickets',
      icon: <ShieldCheck className="w-4 h-4" />,
    },
    {
      id: 'MATCHUP_STUDIO',
      stepNum: '04',
      label: 'Shot & Wagon Wheel',
      sublabel: '360° scoring sectors',
      icon: <Compass className="w-4 h-4" />,
    },
    {
      id: 'BIOMECHANICS',
      stepNum: '05',
      label: 'Biomechanics Lab',
      sublabel: 'Pose & angle telestrator',
      icon: <PenTool className="w-4 h-4" />,
    },
  ];

  const themeOptions: Array<{
    id: 'carbon' | 'carbon-high-contrast' | 'carbon-midnight';
    label: string;
    swatch: string;
  }> = [
    { id: 'carbon', label: 'Carbon Emerald', swatch: '#10B981' },
    { id: 'carbon-high-contrast', label: 'High Contrast', swatch: '#34D399' },
    { id: 'carbon-midnight', label: 'Midnight Pitch', swatch: '#38BDF8' },
  ];

  const handleStartNewBall = () => {
    setPendingPreview(null);
    setSelectedContactId(null);
    if (activeTab !== 'VIDEO') {
      setActiveTab('VIDEO');
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col transition-colors duration-300"
      style={{
        backgroundColor: 'var(--bg-canvas)',
        color: 'var(--text-primary)',
      }}
    >
      {/* Animated Multi-Step Feature Onboarding Modal with Skip Button */}
      <OnboardingTutorialModal
        isOpen={isTutorialOpen}
        onClose={handleCloseTutorial}
        onSelectWorkspaceTab={(tab) => setActiveTab(tab)}
      />

      {/* =====================================================================
       * SLEEK TOP BROADCAST CONTROL BAR (Expansive Widescreen Studio)
       * ===================================================================== */}
      <header
        className="w-full border-b sticky top-0 z-40 shadow-sm"
        style={{
          backgroundColor: 'var(--bg-panel)',
          borderColor: 'var(--border-subtle)',
        }}
      >
        {/* Upper Row: Brand, Workspace Switcher, Quick Actions & Theme */}
        <div className="max-w-[1780px] mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
          {/* Left: Brand Identity & Batter Handedness Switch */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-emerald-400 flex items-center justify-center shadow-sm text-black">
                <Activity className="w-4 h-4 stroke-[2.5]" />
              </div>
              <div>
                <div className="flex items-center gap-2 leading-none">
                  <span className="text-sm font-extrabold tracking-tight text-white">
                    CreaseLab
                  </span>
                  <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">
                    Hawk-Eye DRS
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[10px] text-zinc-400">
                    Live Broadcast Stage
                  </span>
                </div>
              </div>
            </div>

            {/* Batter Handedness Switch */}
            <div className="flex items-center p-0.5 rounded-xl border border-white/10 bg-[#121212] ml-2">
              {(['RHB', 'LHB'] as BatterHandedness[]).map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setHandedness(h)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                    handedness === h
                      ? 'bg-white text-black font-bold shadow-sm'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                  title={`Batter stance: ${h === 'RHB' ? 'Right-Hand Bat' : 'Left-Hand Bat'}`}
                >
                  {h}
                </button>
              ))}
            </div>
          </div>

          {/* Center: Sleek Horizontal Workspace Navigation */}
          <nav className="flex items-center gap-1 p-1 rounded-xl bg-[#121212] border border-white/10 overflow-x-auto max-w-full">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 cursor-pointer shrink-0 ${
                    isActive
                      ? 'bg-white text-black font-bold shadow-sm'
                      : 'text-zinc-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <span className={isActive ? 'text-black' : 'text-zinc-400'}>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Right: Quick "+ New Ball", "Interactive Tour", & Theme Controls */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Quick + New Ball Reset Button */}
            <button
              type="button"
              onClick={handleStartNewBall}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-400 hover:bg-emerald-300 text-black cursor-pointer transition shadow-sm"
              title="Clear video marks and start recording a new delivery"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>+ New Ball</span>
            </button>

            {/* Interactive Feature Tour Modal Trigger */}
            <button
              type="button"
              onClick={() => setIsTutorialOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-[#141414] hover:bg-[#1E1E1E] text-white border border-white/10 cursor-pointer transition"
              title="Open animated interactive guide to review all features"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Tutorial &amp; Guide</span>
            </button>
          </div>
        </div>

        {/* Interactive Feature Tour Launch Banner */}
        <div className="bg-gradient-to-r from-emerald-950/40 via-neutral-900 to-neutral-950 border-t border-emerald-500/20 px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="font-semibold text-white">Hawk-Eye DRS Tracking Studio:</span>
            <span className="text-zinc-400">
              1. Stumps → <strong className="text-emerald-400">2. Bounce (B)</strong> → <strong className="text-white">3. Contact (C)</strong>. Deliveries auto-reset marks on save.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsTutorialOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-400 hover:bg-emerald-300 text-black font-bold text-xs cursor-pointer transition shadow-sm shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Open Feature Tour</span>
          </button>
        </div>

        {/* Lower Row: Session Deliveries Ledger Strip (Horizontal Ticker) */}
        <div
          className="border-t px-4 sm:px-6 py-1.5"
          style={{
            backgroundColor: 'var(--bg-well)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          <div className="max-w-[1780px] mx-auto flex items-center justify-between gap-3 overflow-x-auto">
            <div className="flex items-center gap-2 shrink-0">
              <span
                className="text-[10px] font-mono uppercase tracking-wider font-bold tabular-nums"
                style={{ color: 'var(--text-secondary)' }}
              >
                Saved Deliveries ({contacts.length}):
              </span>
            </div>

            {contacts.length === 0 ? (
              <div className="flex-1 min-w-0">
                <span
                  className="text-xs"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Step to pitch frame and click <strong className="text-emerald-400">Bounce (B)</strong>, then step to bat impact and click <strong className="text-sky-400">Contact (C)</strong>. Clicking Save Delivery logs the ball and clears all marks automatically.
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 flex-1 min-w-0">
                {contacts.map((c) => {
                  const isSelected =
                    (activeTab === 'VIDEO'
                      ? explicitSelectedContact?.id === c.id
                      : selectedContact?.id === c.id) && !pendingPreview;
                  const { hex } = getZoneColorConfig(c.projection.zone);
                  const dotHex = c.isOut ? '#F43F5E' : hex;
                  const bLen =
                    typeof c.bounceLengthM === 'number'
                      ? `${c.bounceLengthM.toFixed(1)}m`
                      : '';
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setPendingPreview(null);
                        if (
                          activeTab === 'VIDEO' &&
                          explicitSelectedContact?.id === c.id
                        ) {
                          setSelectedContactId(null);
                        } else {
                          handleSelectContact(c.id);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-mono tabular-nums cursor-pointer border transition shrink-0"
                      style={{
                        backgroundColor: isSelected
                          ? 'var(--bg-panel)'
                          : 'transparent',
                        borderColor: isSelected
                          ? 'var(--border-strong)'
                          : 'var(--border-subtle)',
                      }}
                      title={`Inspect Ball #${c.indexNumber}`}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: dotHex }}
                      />
                      <span className="font-bold">Ball #{c.indexNumber}</span>
                      {bLen && (
                        <span
                          className="text-[10px] font-semibold opacity-90"
                          style={{ color: 'var(--accent-positive)' }}
                        >
                          {bLen}
                        </span>
                      )}
                      {c.isOut && (
                        <span className="text-[9px] font-bold uppercase bg-rose-500 text-white px-1 rounded">
                          OUT
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Saved Toast Status Badge */}
            <div className="flex items-center gap-2 shrink-0">
              {savedToastBallNum !== null && !pendingPreview && (
                <div className="inline-flex items-center gap-1.5 text-xs font-mono tabular-nums bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 px-3 py-0.5 rounded-full whitespace-nowrap animate-toast-slide font-semibold">
                  <Check className="w-3 h-3" />
                  <span>
                    Ball #{savedToastBallNum} saved · Marks cleared for next delivery
                  </span>
                </div>
              )}

              {pendingPreview && (
                <span className="text-xs font-mono tabular-nums bg-amber-500/15 border border-amber-500/40 text-amber-400 px-3 py-0.5 rounded-full whitespace-nowrap animate-toast-slide font-semibold">
                  Delivery Staged ({pendingPreview.timestampSec.toFixed(2)}s) — Click Save Delivery
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* =====================================================================
       * EXPANSIVE WIDESCREEN WORKSPACE VIEWPORT
       * ===================================================================== */}
      <main className="flex-1 w-full max-w-[1780px] mx-auto px-4 sm:px-6 py-4">
        <div
          className={
            activeTab === 'VIDEO' ? 'block animate-workspace-enter' : 'hidden'
          }
        >
            <VideoConnectionStage
              handedness={handedness}
              activeStumps={activeStumps}
              onChangeActiveStumps={handleChangeActiveStumps}
              contacts={contacts}
              selectedContact={explicitSelectedContact}
              pendingPreview={pendingPreview}
              onStagePreviewPoint={handleStagePreviewPoint}
              onUpdatePendingMeta={handleUpdatePendingMeta}
              onUpdateContactMeta={handleUpdateContactMeta}
              onCommitPendingPreview={handleCommitPendingPreview}
              onDiscardPendingPreview={() => setPendingPreview(null)}
              onToggleLockContact={handleToggleLockContact}
              onClearSelection={() => setSelectedContactId(null)}
              onUpdateContactBounceLength={handleUpdateContactBounceLength}
              onUpdateContactSpeed={handleUpdateContactSpeed}
              seekRequest={seekRequest}
              onOpen3DPitch={() => setActiveTab('PITCH_3D')}
              onOpenMatchupStudio={() => setActiveTab('MATCHUP_STUDIO')}
              onUpdateContactShotAnalysis={handleUpdateContactShotAnalysis}
              onVideoUrlChange={setActiveVideoUrl}
              onVideoTrimChange={(trimStartSec, trimEndSec, durationSec, isCustomTrim) =>
                setVideoTrimWindow((prev) =>
                  prev.trimStartSec === trimStartSec &&
                  prev.trimEndSec === trimEndSec &&
                  prev.durationSec === durationSec &&
                  prev.isCustomTrim === isCustomTrim
                    ? prev
                    : { trimStartSec, trimEndSec, durationSec, isCustomTrim }
                )
              }
            />
          </div>

          <div
            className={
              activeTab === 'MATCHUP_STUDIO'
                ? 'block animate-workspace-enter'
                : 'hidden'
            }
          >
            <MatchupStudioWorkspace
              handedness={handedness}
              contacts={contacts}
              selectedId={selectedContact?.id || null}
              activeVideoUrl={activeVideoUrl}
              onSelectContact={handleSelectContact}
              onUpdateContactOutcome={handleUpdateContactOutcome}
              onUpdateContactShotAnalysis={handleUpdateContactShotAnalysis}
              onUpdateContactMeta={handleUpdateContactMeta}
              onOpen3DPitch={() => setActiveTab('PITCH_3D')}
              onSwitchToVideoTab={() => setActiveTab('VIDEO')}
              onSeekMainVideo={handleSeekMainVideo}
            />
          </div>

          <div
            className={
              activeTab === 'BIOMECHANICS'
                ? 'block animate-workspace-enter'
                : 'hidden'
            }
          >
            <BiomechanicsTelestrator
              handedness={handedness}
              activeVideoUrl={activeVideoUrl}
              contacts={contacts}
              selectedContactId={selectedContact?.id || null}
              onSelectContact={handleSelectContact}
              onVideoUrlChange={setActiveVideoUrl}
              videoTrimWindow={videoTrimWindow}
              seekRequest={seekRequest}
            />
          </div>

          <div
            className={
              activeTab === 'PITCH_3D' || activeTab === 'DRS_TELEMETRY'
                ? 'block animate-workspace-enter'
                : 'hidden'
            }
          >
            <ImaginaryStumpDashboard
              handedness={handedness}
              contacts={contacts}
              selectedId={selectedContact?.id || null}
              pendingPreview={pendingPreview}
              activeStumps={activeStumps}
              activeVideoUrl={activeVideoUrl}
              activeWorkspaceTab={dashboardTab}
              onChangeWorkspaceTab={(tab) => {
                if (tab === 'HEATMAPS_ZONES') {
                  setActiveTab('PITCH_3D');
                } else {
                  setActiveTab(tab);
                }
              }}
              onCommitPendingPreview={handleCommitPendingPreview}
              onDiscardPendingPreview={() => setPendingPreview(null)}
              onSelectContact={handleSelectContact}
              onToggleLockContact={handleToggleLockContact}
              onDeleteContact={handleDeleteContact}
              onUpdateContactBounceLength={handleUpdateContactBounceLength}
              onUpdateContactSpeed={handleUpdateContactSpeed}
              onUpdateContactMeta={handleUpdateContactMeta}
              onClearAll={() => {
                setContacts([]);
                setSelectedContactId(null);
                setPendingPreview(null);
              }}
              onRestoreSamples={() => {
                const initial = getInitialContactPoints();
                setContacts(initial);
                setSelectedContactId(null);
                setPendingPreview(null);
              }}
              onSwitchToVideoTab={() => setActiveTab('VIDEO')}
            />
          </div>
        </main>
    </div>
  );
}

export default App;
