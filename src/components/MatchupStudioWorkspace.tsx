import React, { useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  FileText,
  Flame,
  Layers,
  RotateCcw,
  Sliders,
  Target,
  Video,
} from 'lucide-react';
import {
  AIShotAnalysisReport,
  BatterHandedness,
  ContactPointRecord,
  DismissalType,
  ShotOutcomeTag,
} from '../types/cricket';
import {
  calculateBallTrajectory,
  clamp,
  COMMON_CRICKET_SHOTS,
  computeWagonWheelAnalysis,
  DEFAULT_IMPACT_Z_CM,
  getZoneColorConfig,
} from '../utils/stumpProjection';

interface MatchupStudioWorkspaceProps {
  handedness: BatterHandedness;
  contacts: ContactPointRecord[];
  selectedId: string | null;
  activeVideoUrl?: string;
  onSelectContact: (id: string | null) => void;
  onUpdateContactOutcome: (
    id: string,
    shotOutcome: ShotOutcomeTag | undefined
  ) => void;
  onUpdateContactShotAnalysis?: (
    id: string,
    report: AIShotAnalysisReport
  ) => void;
  onUpdateContactMeta?: (
    id: string,
    patch: Partial<ContactPointRecord>
  ) => void;
  onOpen3DPitch: () => void;
  onSwitchToVideoTab: () => void;
  onSeekMainVideo?: (timestampSec: number) => void;
}

const SHOT_OUTCOME_OPTIONS: Array<{
  id: ShotOutcomeTag;
  label: string;
  badgeClass: string;
}> = [
  {
    id: 'MIDDLED',
    label: 'Middled / Boundary',
    badgeClass:
      'bg-emerald-500/20 text-emerald-300 border-emerald-400/50 hover:bg-emerald-500/30',
  },
  {
    id: 'CONTROLLED',
    label: 'Controlled',
    badgeClass:
      'bg-cyan-500/20 text-cyan-300 border-cyan-400/50 hover:bg-cyan-500/30',
  },
  {
    id: 'DEFENDED',
    label: 'Defended',
    badgeClass:
      'bg-slate-800 text-slate-200 border-slate-600 hover:bg-slate-700',
  },
  {
    id: 'EDGE',
    label: 'Edge / Risk',
    badgeClass:
      'bg-amber-500/20 text-amber-300 border-amber-400/50 hover:bg-amber-500/30',
  },
  {
    id: 'BEATEN',
    label: 'Beaten / Miss',
    badgeClass:
      'bg-rose-500/20 text-rose-300 border-rose-400/50 hover:bg-rose-500/30',
  },
];

const DISMISSAL_OPTIONS: Array<{ id: DismissalType; label: string }> = [
  { id: 'BOWLED', label: 'Bowled' },
  { id: 'LBW', label: 'LBW' },
  { id: 'CAUGHT', label: 'Caught' },
  { id: 'EDGED', label: 'Edged Behind' },
  { id: 'STUMPED', label: 'Stumped' },
  { id: 'RUN_OUT', label: 'Run Out' },
];

interface ShotPresetGuide {
  name: string;
  shortLabel: string;
  rhbAngleDeg: number;
  rhbConeSpreadDeg: number;
  sectorName: string;
  footwork: 'Front-Foot Stride' | 'Back-Foot Transfer' | 'Crease / Low Base';
  batArcType:
    | 'COVER_DRIVE_ARC'
    | 'STRAIGHT_DRIVE_ARC'
    | 'ON_FLICK_ARC'
    | 'PULL_HOOK_ARC'
    | 'SQUARE_CUT_ARC'
    | 'LATE_GUIDE_ARC'
    | 'DEFENSE_BLOCK_ARC'
    | 'SWEEP_ARC';
  idealLength: string;
  idealLine: string;
  elevationProfile: string;
  coachingCue: string;
}

const SHOT_PRESET_BUTTONS: ShotPresetGuide[] = [
  {
    name: 'Classic Cover Drive',
    shortLabel: 'Cover Drive',
    rhbAngleDeg: 225,
    rhbConeSpreadDeg: 22,
    sectorName: 'Extra Cover / Cover',
    footwork: 'Front-Foot Stride',
    batArcType: 'COVER_DRIVE_ARC',
    idealLength: 'Full / Half-Volley (2.4m–4.8m)',
    idealLine: 'Outside Off (4th–5th Stump)',
    elevationProfile: 'Crisp along turf through Extra Cover gap',
    coachingCue:
      'Lead with head & front shoulder into line; high front elbow, full angled bat face at impact.',
  },
  {
    name: 'Straight Drive in the V',
    shortLabel: 'Straight Drive',
    rhbAngleDeg: 185,
    rhbConeSpreadDeg: 18,
    sectorName: 'Straight V (Long-Off / Long-On)',
    footwork: 'Front-Foot Stride',
    batArcType: 'STRAIGHT_DRIVE_ARC',
    idealLength: 'Full / Overpitched (2.2m–4.6m)',
    idealLine: 'Off & Middle Stump Line',
    elevationProfile: 'Straight past non-striker stumps in the V',
    coachingCue:
      'Keep head balanced directly over front knee; present full vertical blade with extended follow-through.',
  },
  {
    name: 'Wristy On-Drive / Flick',
    shortLabel: 'On-Drive / Flick',
    rhbAngleDeg: 135,
    rhbConeSpreadDeg: 24,
    sectorName: 'Mid-Wicket / Wide Long-On',
    footwork: 'Front-Foot Stride',
    batArcType: 'ON_FLICK_ARC',
    idealLength: 'Full to Good Length (2.5m–5.8m)',
    idealLine: 'Middle & Leg Stump',
    elevationProfile: 'Whipped along ground or aerial over Mid-Wicket',
    coachingCue:
      'Meet ball out in front of front pad; roll wrists smoothly after contact to keep ball down.',
  },
  {
    name: 'Controlled Pull Shot',
    shortLabel: 'Pull / Hook',
    rhbAngleDeg: 85,
    rhbConeSpreadDeg: 26,
    sectorName: 'Deep Mid-Wicket / Square Leg',
    footwork: 'Back-Foot Transfer',
    batArcType: 'PULL_HOOK_ARC',
    idealLength: 'Short / Back of a Length (7.2m–10.5m)',
    idealLine: 'Middle to Off / Body Line',
    elevationProfile: 'Cross-batted power arc from chest/waist height',
    coachingCue:
      'Transfer weight back & across, rotate hips & shoulders briskly, roll wrists to control elevation.',
  },
  {
    name: 'Back-Foot Square Cut',
    shortLabel: 'Square Cut',
    rhbAngleDeg: 270,
    rhbConeSpreadDeg: 20,
    sectorName: 'Point / Deep Point',
    footwork: 'Back-Foot Transfer',
    batArcType: 'SQUARE_CUT_ARC',
    idealLength: 'Short & Wide (6.8m–9.8m)',
    idealLine: 'Wide Outside Off (5th–6th Stump)',
    elevationProfile: 'Horizontal high-to-low slice square of the wicket',
    coachingCue:
      'Move back & across toward off-stump; extend arms fully and hit down on top of the bounce.',
  },
  {
    name: 'Late Cut / Third-Man Guide',
    shortLabel: 'Late Cut / Guide',
    rhbAngleDeg: 315,
    rhbConeSpreadDeg: 18,
    sectorName: 'Third Man / Gully',
    footwork: 'Back-Foot Transfer',
    batArcType: 'LATE_GUIDE_ARC',
    idealLength: 'Good to Short-of-Good (5.5m–7.8m)',
    idealLine: 'Outside Off Corridor',
    elevationProfile: 'Deflected late under eyes past slip/gully cordon',
    coachingCue:
      'Let the ball come right beside back hip/stumps; open the blade face with soft hands to use pace.',
  },
  {
    name: 'Compact Forward Defense / Straight Push',
    shortLabel: 'Forward Defense',
    rhbAngleDeg: 190,
    rhbConeSpreadDeg: 15,
    sectorName: 'Pitch / Mid-Off',
    footwork: 'Front-Foot Stride',
    batArcType: 'DEFENSE_BLOCK_ARC',
    idealLength: 'Good Length (4.8m–6.8m)',
    idealLine: 'Top of Off & Middle Stump',
    elevationProfile: 'Deadened downward into turf beside front pad',
    coachingCue:
      'Close the gap between bat and front pad; angled vertical blade with relaxed bottom-hand grip.',
  },
  {
    name: 'Back-Foot Defense / Tuck',
    shortLabel: 'Back-Foot Defense',
    rhbAngleDeg: 155,
    rhbConeSpreadDeg: 16,
    sectorName: 'Short Mid-Wicket / Pitch',
    footwork: 'Back-Foot Transfer',
    batArcType: 'DEFENSE_BLOCK_ARC',
    idealLength: 'Back of a Length (6.4m–8.2m)',
    idealLine: 'Stump-to-Stump Channel',
    elevationProfile: 'Played right under the eyes onto the pitch',
    coachingCue:
      'Get tall on the back foot in line with the ball; high top hand controls steep bounce.',
  },
  {
    name: 'Soft-Hands Push to Cover-Point',
    shortLabel: 'Cover-Point Push',
    rhbAngleDeg: 248,
    rhbConeSpreadDeg: 18,
    sectorName: 'Cover-Point',
    footwork: 'Front-Foot Stride',
    batArcType: 'COVER_DRIVE_ARC',
    idealLength: 'Good Length (4.6m–6.4m)',
    idealLine: '4th Stump Corridor',
    elevationProfile: 'Controlled placement into infield gap for quick single',
    coachingCue:
      'Wait for the ball to arrive under head; angle the face slightly open without pushing hard at the ball.',
  },
  {
    name: 'Sweep / Paddle Sweep',
    shortLabel: 'Sweep / Paddle',
    rhbAngleDeg: 55,
    rhbConeSpreadDeg: 24,
    sectorName: 'Fine Leg / Deep Square Leg',
    footwork: 'Crease / Low Base',
    batArcType: 'SWEEP_ARC',
    idealLength: 'Full to Good Spin Length (3.2m–5.6m)',
    idealLine: 'Middle & Leg / Outside Off',
    elevationProfile: 'Low kneeling horizontal arc behind square on leg side',
    coachingCue:
      'Drop back knee stably, get head outside the line of off-break or in-line, sweep from high to low.',
  },
];

function findShotPresetGuide(shotName: string): ShotPresetGuide {
  const exact = SHOT_PRESET_BUTTONS.find((s) => s.name === shotName);
  if (exact) return exact;
  const lower = shotName.toLowerCase();
  if (lower.includes('pull') || lower.includes('hook')) {
    return { ...SHOT_PRESET_BUTTONS[3], name: shotName || 'Pull / Hook Shot' };
  }
  if (lower.includes('late') || lower.includes('third') || lower.includes('upper')) {
    return { ...SHOT_PRESET_BUTTONS[5], name: shotName || 'Late Cut / Guide' };
  }
  if (lower.includes('cut')) {
    return { ...SHOT_PRESET_BUTTONS[4], name: shotName || 'Square Cut' };
  }
  if (lower.includes('sweep') || lower.includes('scoop')) {
    return { ...SHOT_PRESET_BUTTONS[9], name: shotName || 'Sweep / Scoop' };
  }
  if (lower.includes('flick') || lower.includes('on-drive') || lower.includes('glance')) {
    return { ...SHOT_PRESET_BUTTONS[2], name: shotName || 'On-Drive / Flick' };
  }
  if (lower.includes('defen') || lower.includes('leave')) {
    return { ...SHOT_PRESET_BUTTONS[6], name: shotName || 'Defensive Stroke' };
  }
  if (lower.includes('straight') || lower.includes('loft')) {
    return { ...SHOT_PRESET_BUTTONS[1], name: shotName || 'Straight Drive' };
  }
  return {
    ...SHOT_PRESET_BUTTONS[0],
    name: shotName || 'Classic Cover Drive',
  };
}

const SECTOR_QUICK_ANGLES_RHB: Array<{
  label: string;
  rhbAngleDeg: number;
  startDeg: number;
  endDeg: number;
  typicalShot: string;
}> = [
  {
    label: 'Third Man',
    rhbAngleDeg: 315,
    startDeg: 292.5,
    endDeg: 337.5,
    typicalShot: 'Late Cut / Third-Man Guide',
  },
  {
    label: 'Point',
    rhbAngleDeg: 270,
    startDeg: 247.5,
    endDeg: 292.5,
    typicalShot: 'Back-Foot Square Cut',
  },
  {
    label: 'Cover',
    rhbAngleDeg: 225,
    startDeg: 205,
    endDeg: 247.5,
    typicalShot: 'Classic Cover Drive',
  },
  {
    label: 'Long Off',
    rhbAngleDeg: 195,
    startDeg: 186,
    endDeg: 205,
    typicalShot: 'Straight Drive in the V',
  },
  {
    label: 'Straight V',
    rhbAngleDeg: 180,
    startDeg: 171,
    endDeg: 186,
    typicalShot: 'Straight Drive in the V',
  },
  {
    label: 'Long On',
    rhbAngleDeg: 162,
    startDeg: 145,
    endDeg: 171,
    typicalShot: 'Straight Drive in the V',
  },
  {
    label: 'Mid-Wicket',
    rhbAngleDeg: 120,
    startDeg: 102.5,
    endDeg: 145,
    typicalShot: 'Wristy On-Drive / Flick',
  },
  {
    label: 'Square Leg',
    rhbAngleDeg: 85,
    startDeg: 65,
    endDeg: 102.5,
    typicalShot: 'Controlled Pull Shot',
  },
  {
    label: 'Fine Leg',
    rhbAngleDeg: 45,
    startDeg: 22.5,
    endDeg: 65,
    typicalShot: 'Sweep / Paddle Sweep',
  },
];

type PitchZoneFilterId =
  | 'ALL'
  | 'YORKER'
  | 'FULL'
  | 'GOOD'
  | 'BACK_OF_LENGTH'
  | 'SHORT';

interface PitchLengthZoneDef {
  id: PitchZoneFilterId;
  label: string;
  shortLabel: string;
  rangeLabel: string;
  minM: number;
  maxM: number;
  accentHex: string;
  badgeClass: string;
}

const PITCH_LENGTH_ZONES: PitchLengthZoneDef[] = [
  {
    id: 'ALL',
    label: 'All Pitch Lengths',
    shortLabel: 'All Zones',
    rangeLabel: '0.0m – 20.1m',
    minM: 0,
    maxM: 99,
    accentHex: '#22D3EE',
    badgeClass: 'border-cyan-400/60 bg-cyan-500/15 text-cyan-200',
  },
  {
    id: 'YORKER',
    label: 'Yorker / Blockhole',
    shortLabel: 'Yorker',
    rangeLabel: '< 2.2m',
    minM: 0,
    maxM: 2.2,
    accentHex: '#F59E0B',
    badgeClass: 'border-amber-400/60 bg-amber-500/15 text-amber-200',
  },
  {
    id: 'FULL',
    label: 'Full / Half-Volley',
    shortLabel: 'Full',
    rangeLabel: '2.2m – 4.8m',
    minM: 2.2,
    maxM: 4.8,
    accentHex: '#10B981',
    badgeClass: 'border-emerald-400/60 bg-emerald-500/15 text-emerald-200',
  },
  {
    id: 'GOOD',
    label: 'Good Length Channel',
    shortLabel: 'Good Length',
    rangeLabel: '4.8m – 6.8m',
    minM: 4.8,
    maxM: 6.8,
    accentHex: '#38BDF8',
    badgeClass: 'border-sky-400/60 bg-sky-500/15 text-sky-200',
  },
  {
    id: 'BACK_OF_LENGTH',
    label: 'Back of a Length',
    shortLabel: 'Back of Length',
    rangeLabel: '6.8m – 8.8m',
    minM: 6.8,
    maxM: 8.8,
    accentHex: '#A855F7',
    badgeClass: 'border-purple-400/60 bg-purple-500/15 text-purple-200',
  },
  {
    id: 'SHORT',
    label: 'Short / Bouncer',
    shortLabel: 'Short',
    rangeLabel: '> 8.8m',
    minM: 8.8,
    maxM: 99,
    accentHex: '#F43F5E',
    badgeClass: 'border-rose-400/60 bg-rose-500/15 text-rose-200',
  },
];

function classifyPitchLengthZone(bounceM: number): PitchZoneFilterId {
  if (bounceM < 2.2) return 'YORKER';
  if (bounceM < 4.8) return 'FULL';
  if (bounceM < 6.8) return 'GOOD';
  if (bounceM < 8.8) return 'BACK_OF_LENGTH';
  return 'SHORT';
}

const MANUAL_SHOT_LIST = COMMON_CRICKET_SHOTS.filter(
  (s) => s !== 'Auto-Detect from Video / Camera'
);

export const MatchupStudioWorkspace: React.FC<MatchupStudioWorkspaceProps> = ({
  handedness,
  contacts,
  selectedId,
  onSelectContact,
  onUpdateContactOutcome,
  onUpdateContactMeta,
  onOpen3DPitch,
  onSwitchToVideoTab,
  onSeekMainVideo,
}) => {
  const wheelSvgRef = useRef<SVGSVGElement | null>(null);
  const [isDraggingWheel, setIsDraggingWheel] = useState<boolean>(false);
  const [showAllBallsOnWheel, setShowAllBallsOnWheel] = useState<boolean>(true);
  const [showShotHeatmap, setShowShotHeatmap] = useState<boolean>(true);
  const [selectedPitchZone, setSelectedPitchZone] =
    useState<PitchZoneFilterId>('ALL');
  const [hoveredShotName, setHoveredShotName] = useState<string | null>(null);
  const [hoveredSectorLabel, setHoveredSectorLabel] = useState<string | null>(
    null
  );
  const [selectedSectorLabel, setSelectedSectorLabel] = useState<string | null>(
    null
  );

  const focusedContact = useMemo(
    () =>
      contacts.find((c) => c.id === selectedId) ||
      contacts[contacts.length - 1] ||
      null,
    [contacts, selectedId]
  );

  const focusedIndexInArray = useMemo(() => {
    if (!focusedContact) return -1;
    return contacts.findIndex((c) => c.id === focusedContact.id);
  }, [contacts, focusedContact]);

  const itemsWithPredictions = useMemo(() => {
    return contacts.map((contact) => {
      const pred = calculateBallTrajectory(
        contact.stumpConfig,
        contact.projection,
        handedness,
        'AUTO_PITCH',
        DEFAULT_IMPACT_Z_CM,
        contact.bounceLengthM,
        contact.calibratedSpeedKph,
        {
          releasePoint: contact.releasePoint,
          bouncePoint: contact.bouncePoint,
          contactPoint: contact.videoPoint,
        }
      );
      const resolvedBounceM =
        contact.bounceLengthM ?? pred.bounceDistanceFromStumpsM ?? 5.4;
      const pitchZoneId = classifyPitchLengthZone(resolvedBounceM);
      return { contact, pred, resolvedBounceM, pitchZoneId };
    });
  }, [contacts, handedness]);

  const wagonWheelSummary = useMemo(
    () =>
      computeWagonWheelAnalysis(
        itemsWithPredictions,
        handedness,
        focusedContact?.id || null,
        1.68
      ),
    [itemsWithPredictions, handedness, focusedContact?.id]
  );

  const activeVector = useMemo(
    () =>
      wagonWheelSummary.vectors.find(
        (v) => v.contactId === focusedContact?.id
      ) ||
      wagonWheelSummary.vectors[wagonWheelSummary.vectors.length - 1] ||
      null,
    [wagonWheelSummary.vectors, focusedContact?.id]
  );

  const convertRhbAngleToHandedness = (rhbAngle: number): number => {
    if (handedness === 'RHB') return rhbAngle;
    return (360 - rhbAngle) % 360;
  };

  // Compute Shot Frequency Heatmap statistics per pitch length zone & sector
  const pitchZoneAnalytics = useMemo(() => {
    const zoneCounts: Record<PitchZoneFilterId, number> = {
      ALL: itemsWithPredictions.length,
      YORKER: 0,
      FULL: 0,
      GOOD: 0,
      BACK_OF_LENGTH: 0,
      SHORT: 0,
    };

    itemsWithPredictions.forEach((item) => {
      zoneCounts[item.pitchZoneId] = (zoneCounts[item.pitchZoneId] || 0) + 1;
    });

    const filteredItems =
      selectedPitchZone === 'ALL'
        ? itemsWithPredictions
        : itemsWithPredictions.filter(
            (item) => item.pitchZoneId === selectedPitchZone
          );

    // Group by Shot Type within the selected Pitch Length Zone
    const shotMap = new Map<
      string,
      {
        shotName: string;
        count: number;
        pct: number;
        outCount: number;
        middledCount: number;
        ballNumbers: number[];
        firstContactId: string;
        primarySector: string;
      }
    >();

    // Group by Sector for Wagon Wheel Thermal Overlay
    const sectorCountMap: Record<string, number> = {};
    SECTOR_QUICK_ANGLES_RHB.forEach((s) => {
      sectorCountMap[s.label] = 0;
    });

    filteredItems.forEach(({ contact }) => {
      const vec = wagonWheelSummary.vectors.find(
        (v) => v.contactId === contact.id
      );
      const ballAng =
        typeof contact.wagonWheelAngleDeg === 'number'
          ? contact.wagonWheelAngleDeg
          : vec?.angleDeg ?? 180;

      const matchedSec =
        SECTOR_QUICK_ANGLES_RHB.find((s) => {
          const tAng =
            handedness === 'RHB' ? s.rhbAngleDeg : (360 - s.rhbAngleDeg) % 360;
          return Math.abs(((ballAng - tAng + 540) % 360) - 180) <= 22.5;
        }) || SECTOR_QUICK_ANGLES_RHB[4];

      sectorCountMap[matchedSec.label] =
        (sectorCountMap[matchedSec.label] || 0) + 1;

      const sName =
        contact.selectedShotName ||
        contact.aiShotAnalysis?.playedShotName ||
        matchedSec.typicalShot;

      const existing = shotMap.get(sName);
      if (existing) {
        existing.count += 1;
        if (contact.isOut) existing.outCount += 1;
        if (
          contact.shotOutcome === 'MIDDLED' ||
          contact.shotOutcome === 'CONTROLLED'
        ) {
          existing.middledCount += 1;
        }
        existing.ballNumbers.push(contact.indexNumber);
      } else {
        shotMap.set(sName, {
          shotName: sName,
          count: 1,
          pct: 0,
          outCount: contact.isOut ? 1 : 0,
          middledCount:
            contact.shotOutcome === 'MIDDLED' ||
            contact.shotOutcome === 'CONTROLLED'
              ? 1
              : 0,
          ballNumbers: [contact.indexNumber],
          firstContactId: contact.id,
          primarySector: matchedSec.label,
        });
      }
    });

    const totalInZone = Math.max(1, filteredItems.length);
    const rankedShots = Array.from(shotMap.values())
      .map((entry) => ({
        ...entry,
        pct: Math.round((entry.count / totalInZone) * 100),
      }))
      .sort((a, b) => b.count - a.count);

    const maxSectorCount = Math.max(1, ...Object.values(sectorCountMap));

    return {
      zoneCounts,
      filteredItems,
      rankedShots,
      sectorCountMap,
      maxSectorCount,
    };
  }, [
    itemsWithPredictions,
    selectedPitchZone,
    wagonWheelSummary.vectors,
    handedness,
  ]);

  const handleSelectPrevBall = () => {
    if (contacts.length === 0) return;
    const prevIdx =
      focusedIndexInArray > 0 ? focusedIndexInArray - 1 : contacts.length - 1;
    const target = contacts[prevIdx];
    if (target) {
      onSelectContact(target.id);
      if (onSeekMainVideo) onSeekMainVideo(target.timestampSec);
    }
  };

  const handleSelectNextBall = () => {
    if (contacts.length === 0) return;
    const nextIdx =
      focusedIndexInArray >= 0 && focusedIndexInArray < contacts.length - 1
        ? focusedIndexInArray + 1
        : 0;
    const target = contacts[nextIdx];
    if (target) {
      onSelectContact(target.id);
      if (onSeekMainVideo) onSeekMainVideo(target.timestampSec);
    }
  };

  const updateAngleFromPointerEvent = (
    clientX: number,
    clientY: number
  ) => {
    if (!focusedContact || !onUpdateContactMeta || !wheelSvgRef.current) return;
    const rect = wheelSvgRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    if (Math.hypot(dx, dy) < 6) return;

    // 0 deg = North (Behind Wicketkeeper), 90 deg = East, 180 deg = South (Straight Bowler), 270 deg = West
    let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    const roundedDeg = Math.round(deg) % 360;

    onUpdateContactMeta(focusedContact.id, {
      wagonWheelAngleDeg: roundedDeg,
    });
  };

  if (contacts.length === 0 || !focusedContact) {
    return (
      <div className="bg-[#0C111C] border border-slate-800/80 rounded-xl p-10 text-center space-y-4">
        <div className="w-12 h-12 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center mx-auto">
          <Compass className="w-6 h-6 text-cyan-400" />
        </div>
        <div className="space-y-1 max-w-md mx-auto">
          <h2 className="text-base font-bold text-white">
            No Deliveries Tagged Yet
          </h2>
          <p className="text-xs text-slate-400">
            Point the ball bounce and bat contact on your video in Step 01
            first, then switch here to inspect the Shot Frequency Heatmap,
            adjust the 360° Wagon Wheel ball by ball, and record OUT / NOT OUT
            notes.
          </p>
        </div>
        <button
          type="button"
          onClick={onSwitchToVideoTab}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 text-xs font-bold cursor-pointer transition"
        >
          <Video className="w-4 h-4" />
          <span>Go to Video &amp; Point Bounce + Contact</span>
        </button>
      </div>
    );
  }

  const activeShotName =
    focusedContact.selectedShotName ||
    focusedContact.aiShotAnalysis?.playedShotName ||
    '';
  const activeAngleDeg =
    typeof focusedContact.wagonWheelAngleDeg === 'number'
      ? focusedContact.wagonWheelAngleDeg
      : activeVector?.angleDeg ?? 180;
  const activeIsOut = Boolean(focusedContact.isOut);
  const activeDismissal: DismissalType =
    focusedContact.dismissalType || 'BOWLED';
  const activeNote = focusedContact.ballNote || '';

  const leftSideLabel = handedness === 'RHB' ? 'OFF SIDE' : 'LEG SIDE';
  const rightSideLabel = handedness === 'RHB' ? 'LEG SIDE' : 'OFF SIDE';

  const activeZoneDef =
    PITCH_LENGTH_ZONES.find((z) => z.id === selectedPitchZone) ||
    PITCH_LENGTH_ZONES[0];

  return (
    <div className="space-y-4">
      {/* TOP BAR: BALL-TO-BALL TOGGLE STRIP + HEATMAP OVERLAY SWITCH */}
      <div className="bg-[#0C111C] border border-slate-800/80 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSelectPrevBall}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#070A10] hover:bg-[#111827] border border-slate-800/80 text-xs font-mono text-slate-200 cursor-pointer transition"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Prev</span>
          </button>

          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
            {contacts.map((c) => {
              const isSelected = c.id === focusedContact.id;
              const { hex } = getZoneColorConfig(c.projection.zone);
              const dotColor = c.isOut ? '#F43F5E' : hex;
              const sName =
                c.selectedShotName ||
                c.aiShotAnalysis?.playedShotName ||
                'Unset Shot';
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    onSelectContact(c.id);
                    if (onSeekMainVideo) onSeekMainVideo(c.timestampSec);
                  }}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono tabular-nums transition cursor-pointer shrink-0 ${
                    isSelected
                      ? c.isOut
                        ? 'bg-rose-500/20 border border-rose-500 text-white font-bold'
                        : 'bg-cyan-500/20 border border-cyan-400 text-white font-bold'
                      : c.isOut
                      ? 'bg-rose-950/40 hover:bg-rose-900/40 border border-rose-500/40 text-rose-200'
                      : 'bg-[#070A10] hover:bg-[#111827] border border-slate-800/80 text-slate-300'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: dotColor }}
                  />
                  <span>Ball #{c.indexNumber}</span>
                  {c.isOut && (
                    <span className="text-[9px] font-bold uppercase bg-rose-500 text-white px-1.5 py-0.2 rounded">
                      OUT
                    </span>
                  )}
                  <span className="text-[11px] font-sans text-slate-400 max-w-[110px] truncate hidden sm:inline">
                    {sName}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={handleSelectNextBall}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#070A10] hover:bg-[#111827] border border-slate-800/80 text-xs font-mono text-slate-200 cursor-pointer transition"
          >
            <span>Next</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowShotHeatmap((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-mono cursor-pointer transition ${
              showShotHeatmap
                ? 'bg-amber-500/20 border-amber-400/70 text-amber-300 font-bold'
                : 'bg-[#070A10] border-slate-800/80 text-slate-300 hover:text-white'
            }`}
          >
            <Flame className="w-3.5 h-3.5 text-amber-400" />
            <span>
              Shot Frequency Heatmap: {showShotHeatmap ? 'ON' : 'OFF'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setShowAllBallsOnWheel((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-mono cursor-pointer transition ${
              showAllBallsOnWheel
                ? 'bg-cyan-500/15 border-cyan-400/60 text-cyan-300 font-semibold'
                : 'bg-[#070A10] border-slate-800/80 text-slate-300'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>
              {showAllBallsOnWheel ? 'All Balls' : 'Single Ball'}
            </span>
          </button>

          <button
            type="button"
            onClick={onOpen3DPitch}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 text-xs font-bold cursor-pointer transition"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>3D Pitch</span>
          </button>
        </div>
      </div>

      {/* SHOT FREQUENCY HEATMAP OVERLAY BY PITCH LENGTH ZONE */}
      {showShotHeatmap && (
        <div className="bg-[#0C111C] border border-slate-800/80 rounded-xl p-4 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-mono uppercase tracking-wider text-amber-300 font-bold">
                  Shot Frequency Heatmap Overlay · Pitch Length Zone Explorer
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Toggle between pitch delivery lengths to inspect which shot types
                and Wagon Wheel sectors are played most frequently.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span
                className={`text-[11px] font-mono px-2.5 py-1 rounded-lg border font-semibold ${activeZoneDef.badgeClass}`}
              >
                {activeZoneDef.label} ({activeZoneDef.rangeLabel}) ·{' '}
                {pitchZoneAnalytics.filteredItems.length} Ball(s)
              </span>
            </div>
          </div>

          {/* Pitch Length Zone Toggle Bar (Visual 22-Yard Pitch Strip + Zone Buttons) */}
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
            {PITCH_LENGTH_ZONES.map((zone) => {
              const count = pitchZoneAnalytics.zoneCounts[zone.id] || 0;
              const pct =
                contacts.length > 0
                  ? Math.round((count / contacts.length) * 100)
                  : 0;
              const isSelected = selectedPitchZone === zone.id;

              return (
                <button
                  key={zone.id}
                  type="button"
                  onClick={() => setSelectedPitchZone(zone.id)}
                  className={`p-2.5 rounded-xl border text-left transition cursor-pointer relative overflow-hidden ${
                    isSelected
                      ? `${zone.badgeClass} ring-1 ring-white/25 font-bold shadow-sm`
                      : 'bg-slate-950/90 hover:bg-slate-900 border-slate-800/90 text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-bold truncate">
                      {zone.shortLabel}
                    </span>
                    <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.2 rounded bg-slate-900/90 border border-slate-700/80 text-slate-200">
                      {count}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mt-1">
                    <span>{zone.rangeLabel}</span>
                    {zone.id !== 'ALL' && <span>{pct}%</span>}
                  </div>
                  {/* Subtle thermal progress bar */}
                  <div className="w-full h-1 bg-slate-900 rounded-full overflow-hidden mt-1.5">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${zone.id === 'ALL' ? 100 : pct}%`,
                        backgroundColor: zone.accentHex,
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>

          {/* Most Frequent Shots Played in Selected Pitch Length Zone */}
          {pitchZoneAnalytics.rankedShots.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1">
              {pitchZoneAnalytics.rankedShots.slice(0, 6).map((item, rankIdx) => {
                const isTopShot = rankIdx === 0;
                return (
                  <div
                    key={item.shotName}
                    onClick={() => onSelectContact(item.firstContactId)}
                    className={`p-3 rounded-xl border cursor-pointer transition flex flex-col justify-between gap-2 ${
                      isTopShot
                        ? 'bg-amber-500/[0.08] border-amber-400/50 hover:border-amber-400'
                        : 'bg-slate-950/90 border-slate-800/90 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`text-[10px] font-mono uppercase px-1.5 py-0.2 rounded font-bold ${
                              isTopShot
                                ? 'bg-amber-400 text-slate-950'
                                : 'bg-slate-800 text-slate-300'
                            }`}
                          >
                            #{rankIdx + 1} Most Frequent
                          </span>
                          <span className="text-[10px] font-mono text-cyan-300">
                            {item.primarySector}
                          </span>
                        </div>
                        <h4 className="text-xs font-bold text-white mt-1 truncate">
                          {item.shotName}
                        </h4>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-sm font-mono font-bold text-amber-300 tabular-nums">
                          {item.pct}%
                        </span>
                        <span className="text-[10px] font-mono text-slate-400 block">
                          {item.count} ball{item.count > 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${item.pct}%`,
                            backgroundColor: isTopShot ? '#F59E0B' : '#22D3EE',
                          }}
                        />
                      </div>

                      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                        <span>
                          Balls:{' '}
                          {item.ballNumbers.map((n) => `#${n}`).join(', ')}
                        </span>
                        {item.outCount > 0 ? (
                          <span className="text-rose-400 font-bold">
                            {item.outCount} OUT
                          </span>
                        ) : (
                          <span className="text-emerald-300">
                            {item.middledCount}/{item.count} Controlled
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 text-center text-xs text-slate-400 font-mono">
              No deliveries recorded in {activeZoneDef.label} ({activeZoneDef.rangeLabel}) yet. Click another pitch length zone above or tag more balls.
            </div>
          )}
        </div>
      )}

      {/* MAIN 12-COLUMN WORKSPACE: LEFT 6 COLS = INTERACTIVE 360° WAGON WHEEL | RIGHT 6 COLS = SHOT & BALL NOTES */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* LEFT 6 COLUMNS: INTERACTIVE 360° WAGON WHEEL */}
        <div className="lg:col-span-6 bg-[#0C111C] border border-slate-800/80 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono uppercase tracking-wider text-cyan-400 font-bold">
                  Interactive 360° Wagon Wheel
                </span>
                <span className="text-[11px] font-mono tabular-nums text-slate-400 bg-[#070A10] border border-slate-800/80 px-2 py-0.5 rounded-lg">
                  Ball #{focusedContact.indexNumber} · {activeAngleDeg}°
                </span>
                {showShotHeatmap && selectedPitchZone !== 'ALL' && (
                  <span className="text-[10px] font-mono text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-lg">
                    Zone: {activeZoneDef.shortLabel}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Click or drag anywhere on the field to aim Ball #{focusedContact.indexNumber}&apos;s shot direction.
              </p>
            </div>

            {typeof focusedContact.wagonWheelAngleDeg === 'number' &&
              onUpdateContactMeta && (
                <button
                  type="button"
                  onClick={() =>
                    onUpdateContactMeta(focusedContact.id, {
                      wagonWheelAngleDeg: undefined,
                    })
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] font-mono text-slate-300 cursor-pointer"
                  title="Reset Wagon Wheel angle to physics default"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset Angle</span>
                </button>
              )}
          </div>

          {/* 360° Cricket Oval SVG */}
          <div className="relative w-full max-w-[460px] mx-auto aspect-square select-none">
            <svg
              ref={wheelSvgRef}
              viewBox="0 0 360 360"
              onPointerDown={(e) => {
                setIsDraggingWheel(true);
                updateAngleFromPointerEvent(e.clientX, e.clientY);
              }}
              onPointerMove={(e) => {
                if (!isDraggingWheel) return;
                updateAngleFromPointerEvent(e.clientX, e.clientY);
              }}
              onPointerUp={() => setIsDraggingWheel(false)}
              onPointerLeave={() => setIsDraggingWheel(false)}
              className="w-full h-full cursor-crosshair rounded-2xl bg-[#06110E] border border-slate-800 shadow-inner"
            >
              <defs>
                <radialGradient id="outfieldGrad" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#0F2E22" />
                  <stop offset="70%" stopColor="#0A2118" />
                  <stop offset="100%" stopColor="#06140F" />
                </radialGradient>
              </defs>

              {/* Outfield Boundary Circle */}
              <circle
                cx="180"
                cy="180"
                r="152"
                fill="url(#outfieldGrad)"
                stroke="rgba(34, 211, 238, 0.45)"
                strokeWidth="2"
              />

              {/* 30-Yard Inner Ring */}
              <circle
                cx="180"
                cy="180"
                r="78"
                fill="none"
                stroke="rgba(255, 255, 255, 0.18)"
                strokeWidth="1.2"
                strokeDasharray="4 4"
              />

              {/* Interactive 360° Fielding Sector Wedges + Thermal Shot Frequency Heatmap Shading */}
              {SECTOR_QUICK_ANGLES_RHB.map((sec) => {
                const sDeg =
                  handedness === 'RHB' ? sec.startDeg : (360 - sec.endDeg + 360) % 360;
                const eDeg =
                  handedness === 'RHB' ? sec.endDeg : (360 - sec.startDeg + 360) % 360;
                const spanDeg = (eDeg - sDeg + 360) % 360;
                const a1 = (sDeg * Math.PI) / 180;
                const a2 = ((sDeg + spanDeg) * Math.PI) / 180;
                const rWedge = 152;
                const x1 = 180 + Math.sin(a1) * rWedge;
                const y1 = 180 - Math.cos(a1) * rWedge;
                const x2 = 180 + Math.sin(a2) * rWedge;
                const y2 = 180 - Math.cos(a2) * rWedge;
                const largeArc = spanDeg > 180 ? 1 : 0;

                const isHoveredSec = hoveredSectorLabel === sec.label;
                const isSelectedSec = selectedSectorLabel === sec.label;
                const targetAngle = convertRhbAngleToHandedness(sec.rhbAngleDeg);
                const isActiveBallInSector =
                  Math.abs(((activeAngleDeg - targetAngle + 540) % 360) - 180) <=
                  Math.max(12, spanDeg / 2);

                const secCount = pitchZoneAnalytics.sectorCountMap[sec.label] || 0;
                const totalZoneBalls = Math.max(
                  1,
                  pitchZoneAnalytics.filteredItems.length
                );
                const secFrequencyPct =
                  pitchZoneAnalytics.filteredItems.length > 0
                    ? Math.round((secCount / totalZoneBalls) * 100)
                    : 0;
                const heatRatio =
                  secCount > 0
                    ? secCount / pitchZoneAnalytics.maxSectorCount
                    : 0;

                // Thermal fill when Shot Frequency Heatmap is ON
                const heatFill =
                  showShotHeatmap && secCount > 0
                    ? heatRatio >= 0.75
                      ? `rgba(245, 158, 11, ${(0.18 + heatRatio * 0.22).toFixed(2)})`
                      : `rgba(16, 185, 129, ${(0.1 + heatRatio * 0.18).toFixed(2)})`
                    : 'rgba(255, 255, 255, 0.001)';

                const midDeg = (sDeg + spanDeg / 2) % 360;
                const midRad = (midDeg * Math.PI) / 180;
                const lx = 180 + Math.sin(midRad) * 122;
                const ly = 180 - Math.cos(midRad) * 122;

                return (
                  <g
                    key={`wedge-${sec.label}`}
                    onMouseEnter={() => setHoveredSectorLabel(sec.label)}
                    onMouseLeave={() =>
                      setHoveredSectorLabel((prev) =>
                        prev === sec.label ? null : prev
                      )
                    }
                    onClick={() => {
                      setSelectedSectorLabel(sec.label);
                      if (onUpdateContactMeta) {
                        onUpdateContactMeta(focusedContact.id, {
                          wagonWheelAngleDeg: targetAngle,
                        });
                      }
                    }}
                    className="cursor-pointer"
                  >
                    <path
                      d={`M 180 180 L ${x1} ${y1} A ${rWedge} ${rWedge} 0 ${largeArc} 1 ${x2} ${y2} Z`}
                      fill={
                        isHoveredSec
                          ? 'rgba(251, 191, 36, 0.24)'
                          : isSelectedSec
                          ? 'rgba(34, 211, 238, 0.18)'
                          : showShotHeatmap && secCount > 0
                          ? heatFill
                          : isActiveBallInSector
                          ? 'rgba(34, 211, 238, 0.06)'
                          : 'rgba(255, 255, 255, 0.001)'
                      }
                      stroke={
                        isHoveredSec
                          ? 'rgba(251, 191, 36, 0.65)'
                          : isSelectedSec
                          ? 'rgba(34, 211, 238, 0.5)'
                          : showShotHeatmap && secCount > 0
                          ? 'rgba(245, 158, 11, 0.35)'
                          : 'rgba(255, 255, 255, 0.08)'
                      }
                      strokeWidth={
                        isHoveredSec || isSelectedSec
                          ? '1.5'
                          : showShotHeatmap && secCount > 0
                          ? '1.1'
                          : '0.8'
                      }
                    />
                    {(isHoveredSec ||
                      isSelectedSec ||
                      (showShotHeatmap && secCount > 0)) && (
                      <text
                        x={lx}
                        y={ly}
                        textAnchor="middle"
                        fill={
                          isHoveredSec
                            ? '#FDE68A'
                            : isSelectedSec
                            ? '#67E8F9'
                            : '#FCD34D'
                        }
                        fontSize="8.5"
                        fontFamily="monospace"
                        fontWeight="bold"
                        className="pointer-events-none"
                      >
                        {sec.label.toUpperCase()}
                        {showShotHeatmap && secCount > 0
                          ? ` (${secFrequencyPct}%)`
                          : ''}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Side Labels */}
              <text
                x="42"
                y="184"
                fill="rgba(148, 163, 184, 0.55)"
                fontSize="10"
                fontFamily="monospace"
                fontWeight="bold"
                className="pointer-events-none"
              >
                {leftSideLabel}
              </text>
              <text
                x="262"
                y="184"
                fill="rgba(148, 163, 184, 0.55)"
                fontSize="10"
                fontFamily="monospace"
                fontWeight="bold"
                className="pointer-events-none"
              >
                {rightSideLabel}
              </text>
              <text
                x="180"
                y="20"
                textAnchor="middle"
                fill="rgba(148, 163, 184, 0.6)"
                fontSize="9"
                fontFamily="monospace"
                className="pointer-events-none"
              >
                KEEPER / BEHIND (0°)
              </text>
              <text
                x="180"
                y="348"
                textAnchor="middle"
                fill="rgba(148, 163, 184, 0.6)"
                fontSize="9"
                fontFamily="monospace"
                className="pointer-events-none"
              >
                STRAIGHT BOWLER (180°)
              </text>

              {/* Center 22-Yard Pitch Strip */}
              <rect
                x="173"
                y="154"
                width="14"
                height="52"
                rx="2"
                fill="#6E563E"
                stroke="rgba(251, 191, 36, 0.55)"
                strokeWidth="1"
                className="pointer-events-none"
              />
              {/* Striker Crease Mark at y=164 */}
              <line
                x1="169"
                y1="164"
                x2="191"
                y2="164"
                stroke="#F8FAFC"
                strokeWidth="1.2"
                className="pointer-events-none"
              />

              {/* Live Shot Preview Sector Cone & Ghost Vector (When deciding/hovering or viewing selected shot) */}
              {(() => {
                const previewTargetName =
                  hoveredShotName || activeShotName || 'Classic Cover Drive';
                const guide = findShotPresetGuide(previewTargetName);
                const centerAngle = hoveredShotName
                  ? convertRhbAngleToHandedness(guide.rhbAngleDeg)
                  : activeAngleDeg;
                const spread = guide.rhbConeSpreadDeg;
                const a1 = ((centerAngle - spread) * Math.PI) / 180;
                const a2 = ((centerAngle + spread) * Math.PI) / 180;
                const ac = (centerAngle * Math.PI) / 180;
                const rCone = 146;
                const x1 = 180 + Math.sin(a1) * rCone;
                const y1 = 164 - Math.cos(a1) * rCone;
                const x2 = 180 + Math.sin(a2) * rCone;
                const y2 = 164 - Math.cos(a2) * rCone;
                const xc = 180 + Math.sin(ac) * rCone;
                const yc = 164 - Math.cos(ac) * rCone;
                const isHoverPreview = Boolean(hoveredShotName);

                return (
                  <g className="pointer-events-none">
                    <path
                      d={`M 180 164 L ${x1} ${y1} A ${rCone} ${rCone} 0 0 1 ${x2} ${y2} Z`}
                      fill={
                        isHoverPreview
                          ? 'rgba(251, 191, 36, 0.16)'
                          : 'rgba(34, 211, 238, 0.09)'
                      }
                      stroke={
                        isHoverPreview
                          ? 'rgba(251, 191, 36, 0.45)'
                          : 'rgba(34, 211, 238, 0.28)'
                      }
                      strokeWidth="1"
                      strokeDasharray="3 3"
                    />
                    {isHoverPreview && (
                      <>
                        <line
                          x1="180"
                          y1="164"
                          x2={xc}
                          y2={yc}
                          stroke="#FBBF24"
                          strokeWidth="2.6"
                          strokeDasharray="5 3"
                        />
                        <circle
                          cx={xc}
                          cy={yc}
                          r="5"
                          fill="#FBBF24"
                          stroke="#05080F"
                          strokeWidth="1.5"
                        />
                        <text
                          x={xc}
                          y={yc - 9}
                          textAnchor="middle"
                          fill="#FDE68A"
                          fontSize="9.5"
                          fontFamily="monospace"
                          fontWeight="bold"
                        >
                          PREVIEW: {guide.shortLabel.toUpperCase()} ({centerAngle}°)
                        </text>
                      </>
                    )}
                  </g>
                );
              })()}

              {/* Wagon Wheel Shot Vectors (Filtered by Pitch Zone when Heatmap Filter is active) */}
              {wagonWheelSummary.vectors.map((vec) => {
                const isFocused = vec.contactId === focusedContact.id;
                if (!showAllBallsOnWheel && !isFocused) return null;

                const matchingEntry = itemsWithPredictions.find(
                  (item) => item.contact.id === vec.contactId
                );
                const matchingContact = matchingEntry?.contact;
                const matchesZoneFilter =
                  selectedPitchZone === 'ALL' ||
                  matchingEntry?.pitchZoneId === selectedPitchZone;

                if (showShotHeatmap && !matchesZoneFilter && !isFocused) {
                  return null;
                }

                const isBallOut = Boolean(matchingContact?.isOut);
                const rad = (vec.angleDeg * Math.PI) / 180;
                const lengthPx = isBallOut
                  ? 82
                  : clamp((vec.distanceM / 85) * 145, 58, 146);
                const endX = 180 + Math.sin(rad) * lengthPx;
                const endY = 164 - Math.cos(rad) * lengthPx;

                const strokeColor = isBallOut
                  ? '#F43F5E'
                  : isFocused
                  ? '#22D3EE'
                  : vec.colorHex;

                return (
                  <g
                    key={vec.contactId}
                    onMouseEnter={() => {
                      const matchedSec = SECTOR_QUICK_ANGLES_RHB.find((s) => {
                        const tAng = convertRhbAngleToHandedness(s.rhbAngleDeg);
                        return (
                          Math.abs(((vec.angleDeg - tAng + 540) % 360) - 180) <= 22.5
                        );
                      });
                      if (matchedSec) setHoveredSectorLabel(matchedSec.label);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectContact(vec.contactId);
                      const matchedSec = SECTOR_QUICK_ANGLES_RHB.find((s) => {
                        const tAng = convertRhbAngleToHandedness(s.rhbAngleDeg);
                        return (
                          Math.abs(((vec.angleDeg - tAng + 540) % 360) - 180) <= 22.5
                        );
                      });
                      if (matchedSec) setSelectedSectorLabel(matchedSec.label);
                    }}
                    className="cursor-pointer"
                  >
                    <line
                      x1="180"
                      y1="164"
                      x2={endX}
                      y2={endY}
                      stroke={strokeColor}
                      strokeWidth={isFocused ? '3.4' : '2'}
                      strokeOpacity={isFocused ? 1 : 0.65}
                      strokeLinecap="round"
                    />
                    {isBallOut && (
                      <circle
                        cx={endX}
                        cy={endY}
                        r={isFocused ? '11' : '8'}
                        fill="none"
                        stroke="#F43F5E"
                        strokeWidth="1.5"
                      >
                        <animate
                          attributeName="r"
                          values="6;14;6"
                          dur="1.5s"
                          repeatCount="indefinite"
                        />
                        <animate
                          attributeName="opacity"
                          values="0.9;0.2;0.9"
                          dur="1.5s"
                          repeatCount="indefinite"
                        />
                      </circle>
                    )}
                    <circle
                      cx={endX}
                      cy={endY}
                      r={isFocused ? '6.5' : '4.5'}
                      fill={strokeColor}
                      stroke="#05080F"
                      strokeWidth="1.5"
                    />
                    <text
                      x={endX + (Math.sin(rad) >= 0 ? 9 : -9)}
                      y={endY + 3}
                      textAnchor={Math.sin(rad) >= 0 ? 'start' : 'end'}
                      fill={
                        isBallOut
                          ? '#FDA4AF'
                          : isFocused
                          ? '#FFFFFF'
                          : '#CBD5E1'
                      }
                      fontSize={isFocused ? '11' : '9.5'}
                      fontFamily="monospace"
                      fontWeight="bold"
                    >
                      #{vec.indexNumber}
                      {isBallOut ? ' OUT' : ''}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Quick Fielding Sector Presets */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
              <span>Quick Sector Aim & Inspector (Hover or Click Sector)</span>
              <span className="text-cyan-300">
                {activeVector?.sector || 'Straight V'} · {activeAngleDeg}°
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SECTOR_QUICK_ANGLES_RHB.map((sec) => {
                const targetAngle = convertRhbAngleToHandedness(sec.rhbAngleDeg);
                const isNear =
                  Math.abs(((activeAngleDeg - targetAngle + 540) % 360) - 180) <=
                  18;
                const isSelectedSec = selectedSectorLabel === sec.label;
                return (
                  <button
                    key={sec.label}
                    type="button"
                    onMouseEnter={() => setHoveredSectorLabel(sec.label)}
                    onMouseLeave={() =>
                      setHoveredSectorLabel((prev) =>
                        prev === sec.label ? null : prev
                      )
                    }
                    onClick={() => {
                      setSelectedSectorLabel(sec.label);
                      if (!onUpdateContactMeta) return;
                      onUpdateContactMeta(focusedContact.id, {
                        wagonWheelAngleDeg: targetAngle,
                      });
                    }}
                    className={`px-2.5 py-1 rounded-md border text-[11px] font-mono cursor-pointer transition ${
                      isNear || isSelectedSec
                        ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 font-bold'
                        : 'bg-slate-950 hover:bg-slate-800 border-slate-800 text-slate-300'
                    }`}
                  >
                    {sec.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* WAGON WHEEL SECTOR SUMMARY CARD (Updates live on sector hover or selection) */}
          {(() => {
            const autoMatchedSec =
              SECTOR_QUICK_ANGLES_RHB.find((s) => {
                const tAng = convertRhbAngleToHandedness(s.rhbAngleDeg);
                return (
                  Math.abs(((activeAngleDeg - tAng + 540) % 360) - 180) <= 22.5
                );
              }) || SECTOR_QUICK_ANGLES_RHB[4];

            const activeSecLabel =
              hoveredSectorLabel || selectedSectorLabel || autoMatchedSec.label;
            const secConfig =
              SECTOR_QUICK_ANGLES_RHB.find((s) => s.label === activeSecLabel) ||
              autoMatchedSec;
            const secTargetAngle = convertRhbAngleToHandedness(
              secConfig.rhbAngleDeg
            );

            // Find all deliveries hit into this sector
            const sectorDeliveries = itemsWithPredictions.filter(({ contact }) => {
              const vec = wagonWheelSummary.vectors.find(
                (v) => v.contactId === contact.id
              );
              const ballAng =
                typeof contact.wagonWheelAngleDeg === 'number'
                  ? contact.wagonWheelAngleDeg
                  : vec?.angleDeg ?? 180;
              return (
                Math.abs(((ballAng - secTargetAngle + 540) % 360) - 180) <= 24
              );
            });

            // Choose the delivery to summarize: focusedContact if it's in this sector (or if no deliveries in this sector), else the latest delivery in this sector
            const primaryEntry =
              sectorDeliveries.find(
                (d) => d.contact.id === focusedContact.id
              ) ||
              sectorDeliveries[sectorDeliveries.length - 1] ||
              itemsWithPredictions.find(
                (d) => d.contact.id === focusedContact.id
              ) ||
              itemsWithPredictions[itemsWithPredictions.length - 1];

            const sumContact = primaryEntry?.contact || focusedContact;
            const sumPred = primaryEntry?.pred;
            const sumVec = wagonWheelSummary.vectors.find(
              (v) => v.contactId === sumContact.id
            );

            const shotTypeDisplay =
              sumContact.selectedShotName ||
              sumContact.aiShotAnalysis?.playedShotName ||
              secConfig.typicalShot;

            const outcomeOption = SHOT_OUTCOME_OPTIONS.find(
              (o) => o.id === sumContact.shotOutcome
            );
            const outcomeLabel = outcomeOption
              ? outcomeOption.label
              : sumContact.isOut
              ? `OUT · ${sumContact.dismissalType || 'WICKET'}`
              : 'Controlled Stroke';

            const bounceM =
              sumContact.bounceLengthM ??
              sumPred?.bounceDistanceFromStumpsM ??
              4.8;
            const lengthCategory =
              bounceM < 2.2
                ? 'Yorker / Full Toss'
                : bounceM < 4.6
                ? 'Full / Half-Volley'
                : bounceM < 6.8
                ? 'Good Length'
                : bounceM < 8.8
                ? 'Back of a Length'
                : 'Short Pitch';

            const lineOffsetCm = sumContact.projection.offsetFromMiddleCm;
            const lineDesc =
              Math.abs(lineOffsetCm) < 3.5
                ? 'Middle Stump'
                : lineOffsetCm < 0
                ? `${Math.abs(lineOffsetCm).toFixed(1)}cm ${
                    handedness === 'RHB' ? 'Off' : 'Leg'
                  }`
                : `${Math.abs(lineOffsetCm).toFixed(1)}cm ${
                    handedness === 'RHB' ? 'Leg' : 'Off'
                  }`;

            const isHoveringSector = Boolean(hoveredSectorLabel);

            return (
              <div
                className={`rounded-xl border p-3.5 transition-all space-y-2.5 ${
                  isHoveringSector
                    ? 'bg-amber-500/[0.08] border-amber-400/50'
                    : 'bg-slate-950/90 border-cyan-500/35'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-mono uppercase tracking-wider font-bold px-2 py-0.5 rounded border ${
                        isHoveringSector
                          ? 'bg-amber-500/20 text-amber-300 border-amber-400/40'
                          : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                      }`}
                    >
                      {isHoveringSector ? 'Hovered Sector' : 'Selected Sector'}
                    </span>
                    <h4 className="text-xs font-bold text-white font-mono">
                      {secConfig.label} ({secTargetAngle}°)
                    </h4>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                    {sectorDeliveries.length > 0
                      ? `${sectorDeliveries.length} ball(s) in sector`
                      : `Showing Ball #${sumContact.indexNumber} details`}
                  </span>
                </div>

                {/* Summary Grid: Shot Type | Outcome | Delivery Details */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                  {/* 1. Shot Type */}
                  <div className="bg-slate-900/90 border border-slate-800/90 rounded-lg p-2.5">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block">
                      Shot Type
                    </span>
                    <span className="text-xs font-bold text-white block mt-0.5 truncate">
                      {shotTypeDisplay}
                    </span>
                    <span className="text-[10px] font-mono text-cyan-300 block mt-0.5 tabular-nums">
                      Angle: {sumContact.wagonWheelAngleDeg ?? sumVec?.angleDeg ?? secTargetAngle}° ·{' '}
                      {sumVec?.distanceM ? `${Math.round(sumVec.distanceM)}m` : 'Infield'}
                    </span>
                  </div>

                  {/* 2. Outcome */}
                  <div className="bg-slate-900/90 border border-slate-800/90 rounded-lg p-2.5">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block">
                      Outcome & Status
                    </span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {sumContact.isOut ? (
                        <span className="text-[10px] font-mono font-bold uppercase bg-rose-500 text-white px-1.5 py-0.5 rounded">
                          OUT ({sumContact.dismissalType || 'WICKET'})
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                          NOT OUT
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] font-medium text-slate-200 block mt-1 truncate">
                      {outcomeLabel}
                    </span>
                  </div>

                  {/* 3. Delivery Details */}
                  <div className="bg-slate-900/90 border border-slate-800/90 rounded-lg p-2.5">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 block">
                      Delivery Details (Ball #{sumContact.indexNumber})
                    </span>
                    <span className="text-xs font-mono font-semibold text-emerald-300 block mt-0.5 tabular-nums">
                      {bounceM.toFixed(1)}m · {lengthCategory}
                    </span>
                    <span className="text-[10px] font-mono text-slate-300 block mt-0.5 tabular-nums">
                      {lineDesc} · {sumContact.projection.contactHeightCm.toFixed(0)}cm High @{' '}
                      {sumContact.timestampSec.toFixed(2)}s
                    </span>
                  </div>
                </div>

                {sumContact.ballNote && (
                  <div className="text-[11px] text-slate-300 bg-slate-900/70 border border-slate-800/80 rounded-lg px-2.5 py-1.5 font-sans">
                    <span className="font-mono text-[10px] uppercase text-amber-300 mr-1.5">
                      Coach Note:
                    </span>
                    {sumContact.ballNote}
                  </div>
                )}

                {sectorDeliveries.length > 1 && (
                  <div className="flex items-center gap-1.5 pt-1 border-t border-slate-800/80 overflow-x-auto">
                    <span className="text-[10px] font-mono text-slate-400 shrink-0">
                      Deliveries in {secConfig.label}:
                    </span>
                    {sectorDeliveries.map(({ contact: sc }) => (
                      <button
                        key={sc.id}
                        type="button"
                        onClick={() => {
                          onSelectContact(sc.id);
                          if (onSeekMainVideo) onSeekMainVideo(sc.timestampSec);
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono cursor-pointer transition ${
                          sc.id === focusedContact.id
                            ? 'bg-cyan-500 text-slate-950 font-bold'
                            : 'bg-slate-900 text-slate-300 border border-slate-800 hover:text-white'
                        }`}
                      >
                        Ball #{sc.indexNumber}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* RIGHT 6 COLUMNS: MANUAL SHOT SELECTOR, OUT / NOT OUT & BALL NOTES */}
        <div className="lg:col-span-6 space-y-4">
          {/* Card 1: Select Shot Played */}
          <div className="bg-[#0C111C] border border-slate-800/80 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-mono uppercase tracking-wider text-cyan-400 font-bold">
                  1. Select Shot Played (Ball #{focusedContact.indexNumber})
                </span>
              </div>
              <span className="text-xs font-mono tabular-nums text-slate-400">
                {focusedContact.timestampSec.toFixed(2)}s
              </span>
            </div>

            {/* INTERACTIVE SHOT PREVIEW CARD (Updates live on hover or selection for ease of deciding the shot) */}
            {(() => {
              const previewShotTitle =
                hoveredShotName || activeShotName || 'Classic Cover Drive';
              const guide = findShotPresetGuide(previewShotTitle);
              const previewAngle = hoveredShotName
                ? convertRhbAngleToHandedness(guide.rhbAngleDeg)
                : activeAngleDeg;
              const isHovering = Boolean(
                hoveredShotName && hoveredShotName !== activeShotName
              );

              return (
                <div
                  className={`rounded-xl border p-3.5 transition-all ${
                    isHovering
                      ? 'bg-amber-500/[0.08] border-amber-400/50'
                      : 'bg-slate-950/90 border-cyan-500/35'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row items-stretch gap-3.5">
                    {/* Left Visual Diagram: Mini Shot Arc & Sector Preview + Optional Video Frame Thumbnail */}
                    <div className="flex items-center gap-2.5 shrink-0">
                      <div className="w-28 h-28 rounded-lg bg-[#06110E] border border-slate-800 p-1.5 flex flex-col justify-between relative overflow-hidden">
                        <span className="text-[9px] font-mono uppercase tracking-wider text-slate-400">
                          {handedness} Arc
                        </span>
                        <svg
                          viewBox="0 0 100 84"
                          className="w-full h-full overflow-visible"
                        >
                          {/* Mini Turf & Crease */}
                          <rect
                            x="43"
                            y="16"
                            width="14"
                            height="56"
                            rx="2"
                            fill="#5C4733"
                            opacity="0.65"
                          />
                          <line
                            x1="34"
                            y1="28"
                            x2="66"
                            y2="28"
                            stroke="#E2E8F0"
                            strokeWidth="1.2"
                          />
                          {/* Stumps */}
                          {[-4, 0, 4].map((dx) => (
                            <circle
                              key={dx}
                              cx={50 + dx}
                              cy="19"
                              r="1.3"
                              fill="#F59E0B"
                            />
                          ))}

                          {/* Dynamic Bat Swing Path Curve based on batArcType */}
                          {(() => {
                            const flip = handedness === 'LHB' ? -1 : 1;
                            let swingPath = `M ${50 - 6 * flip} 22 Q ${50 - 16 * flip} 36 ${50 - 22 * flip} 54`;
                            if (guide.batArcType === 'STRAIGHT_DRIVE_ARC') {
                              swingPath = `M ${50 - 3 * flip} 21 Q ${50 - 4 * flip} 40 ${50 - 2 * flip} 64`;
                            } else if (guide.batArcType === 'ON_FLICK_ARC') {
                              swingPath = `M ${50 - 2 * flip} 22 Q ${50 + 10 * flip} 36 ${50 + 24 * flip} 54`;
                            } else if (guide.batArcType === 'PULL_HOOK_ARC') {
                              swingPath = `M ${50 - 14 * flip} 26 Q ${50 + 6 * flip} 22 ${50 + 30 * flip} 28`;
                            } else if (guide.batArcType === 'SQUARE_CUT_ARC') {
                              swingPath = `M ${50 + 6 * flip} 24 Q ${50 - 14 * flip} 24 ${50 - 34 * flip} 26`;
                            } else if (guide.batArcType === 'LATE_GUIDE_ARC') {
                              swingPath = `M ${50 - 4 * flip} 26 Q ${50 - 16 * flip} 18 ${50 - 28 * flip} 10`;
                            } else if (guide.batArcType === 'DEFENSE_BLOCK_ARC') {
                              swingPath = `M ${50 - 3 * flip} 22 L ${50 - 3 * flip} 36`;
                            } else if (guide.batArcType === 'SWEEP_ARC') {
                              swingPath = `M ${50 - 12 * flip} 30 Q ${50 + 8 * flip} 28 ${50 + 26 * flip} 14`;
                            }

                            const rad = (previewAngle * Math.PI) / 180;
                            const bx = 50 + Math.sin(rad) * 36;
                            const by = 28 - Math.cos(rad) * 36;

                            return (
                              <g>
                                {/* Bat Swing Arc */}
                                <path
                                  d={swingPath}
                                  fill="none"
                                  stroke="#F59E0B"
                                  strokeWidth="2.8"
                                  strokeLinecap="round"
                                />
                                {/* Ball Exit Vector */}
                                <line
                                  x1="50"
                                  y1="28"
                                  x2={bx}
                                  y2={by}
                                  stroke={isHovering ? '#FBBF24' : '#22D3EE'}
                                  strokeWidth="2.2"
                                  strokeDasharray="3 2"
                                />
                                <circle
                                  cx={bx}
                                  cy={by}
                                  r="3.2"
                                  fill={isHovering ? '#FBBF24' : '#22D3EE'}
                                />
                                {/* Impact Point */}
                                <circle
                                  cx="50"
                                  cy="28"
                                  r="3"
                                  fill="#EF4444"
                                  stroke="#FFFFFF"
                                  strokeWidth="1"
                                />
                              </g>
                            );
                          })()}
                        </svg>
                        <span className="text-[9px] font-mono text-cyan-300 text-right tabular-nums">
                          {previewAngle}°
                        </span>
                      </div>

                      {focusedContact.frameSnapshotUrl && (
                        <div className="hidden sm:flex flex-col justify-between w-28 h-28 rounded-lg bg-slate-900 border border-slate-800 overflow-hidden relative">
                          <img
                            src={focusedContact.frameSnapshotUrl}
                            alt={`Ball #${focusedContact.indexNumber} impact frame`}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                          <span className="absolute bottom-1 left-1 right-1 bg-slate-950/85 text-[9px] font-mono text-slate-200 px-1.5 py-0.5 rounded text-center truncate">
                            Impact @ {focusedContact.timestampSec.toFixed(2)}s
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Right Telemetry & Biomechanical Shot Guide */}
                    <div className="flex-1 min-w-0 flex flex-col justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <span
                            className={`text-[10px] font-mono uppercase tracking-wider font-bold ${
                              isHovering ? 'text-amber-300' : 'text-cyan-300'
                            }`}
                          >
                            {isHovering
                              ? 'Hover Shot Preview'
                              : activeShotName
                              ? 'Selected Shot PreviewCard'
                              : 'Suggested Shot Preview'}
                          </span>
                          <span className="text-[11px] font-mono text-slate-300 tabular-nums">
                            {guide.footwork} · {guide.sectorName} ({previewAngle}°)
                          </span>
                        </div>
                        <h4 className="text-sm font-bold text-white mt-0.5 truncate">
                          {guide.name}
                        </h4>
                        <p className="text-[11px] text-slate-300 leading-snug mt-1">
                          {guide.coachingCue}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/90 text-[10px] font-mono">
                        <div>
                          <span className="text-slate-500 block">
                            IDEAL LENGTH & LINE
                          </span>
                          <span className="text-emerald-300 font-semibold">
                            {guide.idealLength}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">
                            BALL TRAJECTORY PROFILE
                          </span>
                          <span className="text-cyan-200 font-semibold">
                            {guide.elevationProfile}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Quick Shot Grid (Hover to preview card & sector cone, click to apply) */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {SHOT_PRESET_BUTTONS.map((preset) => {
                const isSelected = activeShotName === preset.name;
                const defaultAngle = convertRhbAngleToHandedness(
                  preset.rhbAngleDeg
                );
                return (
                  <button
                    key={preset.name}
                    type="button"
                    onMouseEnter={() => setHoveredShotName(preset.name)}
                    onMouseLeave={() => setHoveredShotName(null)}
                    onFocus={() => setHoveredShotName(preset.name)}
                    onBlur={() => setHoveredShotName(null)}
                    onClick={() => {
                      if (!onUpdateContactMeta) return;
                      onUpdateContactMeta(focusedContact.id, {
                        selectedShotName: preset.name,
                        wagonWheelAngleDeg: defaultAngle,
                      });
                    }}
                    className={`px-3 py-2 rounded-lg border text-left transition cursor-pointer flex flex-col justify-between gap-0.5 ${
                      isSelected
                        ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-bold shadow-sm'
                        : 'bg-slate-950 hover:bg-slate-800/90 border-slate-800 hover:border-cyan-500/40 text-slate-200'
                    }`}
                  >
                    <span className="text-xs font-semibold truncate">
                      {preset.shortLabel}
                    </span>
                    <span
                      className={`text-[10px] font-mono ${
                        isSelected ? 'text-slate-900' : 'text-slate-400'
                      }`}
                    >
                      {preset.footwork.split(' ')[0]} · {defaultAngle}°
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Full Shot Dropdown or Custom Shot */}
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1">
                All Shots / Custom Selection
              </label>
              <select
                value={activeShotName}
                onChange={(e) => {
                  if (!onUpdateContactMeta) return;
                  const chosen = e.target.value || undefined;
                  if (chosen) {
                    const matched = findShotPresetGuide(chosen);
                    onUpdateContactMeta(focusedContact.id, {
                      selectedShotName: chosen,
                      wagonWheelAngleDeg: convertRhbAngleToHandedness(
                        matched.rhbAngleDeg
                      ),
                    });
                  } else {
                    onUpdateContactMeta(focusedContact.id, {
                      selectedShotName: undefined,
                    });
                  }
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 cursor-pointer"
              >
                <option value="">-- Choose Shot Played --</option>
                {MANUAL_SHOT_LIST.map((shot) => (
                  <option key={shot} value={shot}>
                    {shot}
                  </option>
                ))}
              </select>
            </div>

            {/* Shot Outcome Tag */}
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1.5">
                Shot Execution Tag
              </label>
              <div className="flex flex-wrap gap-1.5">
                {SHOT_OUTCOME_OPTIONS.map((opt) => {
                  const isSelected = focusedContact.shotOutcome === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() =>
                        onUpdateContactOutcome(
                          focusedContact.id,
                          isSelected ? undefined : opt.id
                        )
                      }
                      className={`px-2.5 py-1 rounded-md border text-xs font-medium cursor-pointer transition ${
                        isSelected
                          ? `${opt.badgeClass} ring-1 ring-white/40 font-bold`
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Card 2: OUT / NOT OUT & Ball Notes */}
          <div className="bg-[#0C111C] border border-slate-800/80 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-mono uppercase tracking-wider text-amber-400 font-bold">
                  2. Ball Status (OUT / NOT OUT) &amp; Notes
                </span>
              </div>
              {activeIsOut && (
                <span className="text-[10px] font-mono font-bold uppercase bg-rose-500 text-white px-2 py-0.5 rounded">
                  Wicket Animation Active in 3D Pitch
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() =>
                  onUpdateContactMeta &&
                  onUpdateContactMeta(focusedContact.id, { isOut: false })
                }
                className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border text-xs font-bold cursor-pointer transition ${
                  !activeIsOut
                    ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                    : 'bg-[#070A10] border-slate-800/80 text-slate-400 hover:text-white'
                }`}
              >
                <Check className="w-3.5 h-3.5" />
                <span>NOT OUT</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  onUpdateContactMeta &&
                  onUpdateContactMeta(focusedContact.id, {
                    isOut: true,
                    dismissalType: activeDismissal,
                  })
                }
                className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border text-xs font-bold cursor-pointer transition ${
                  activeIsOut
                    ? 'bg-rose-500 text-white border-rose-400'
                    : 'bg-[#070A10] border-slate-800/80 text-slate-400 hover:text-rose-300'
                }`}
              >
                <Flame className="w-3.5 h-3.5" />
                <span>OUT (WICKET)</span>
              </button>
            </div>

            {activeIsOut && (
              <div className="space-y-1">
                <label className="block text-[10px] font-mono uppercase tracking-wider text-rose-300">
                  Dismissal Type
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {DISMISSAL_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() =>
                        onUpdateContactMeta &&
                        onUpdateContactMeta(focusedContact.id, {
                          dismissalType: opt.id,
                        })
                      }
                      className={`px-2.5 py-1 rounded-lg border text-xs font-mono cursor-pointer transition ${
                        activeDismissal === opt.id
                          ? 'bg-rose-500/25 border-rose-400 text-rose-200 font-bold'
                          : 'bg-[#070A10] border-slate-800/80 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1">
                Note for Ball #{focusedContact.indexNumber}
              </label>
              <textarea
                rows={2}
                value={activeNote}
                onChange={(e) =>
                  onUpdateContactMeta &&
                  onUpdateContactMeta(focusedContact.id, {
                    ballNote: e.target.value,
                  })
                }
                placeholder="Write coaching or tactical notes for this ball (e.g., 'Squared up by late away movement', 'Got out nicking to 1st slip')..."
                className="w-full bg-[#070A10] border border-slate-800/80 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
              />
            </div>
          </div>

          {/* Card 3: Session Ball-by-Ball Ledger */}
          <div className="bg-[#0C111C] border border-slate-800/80 rounded-xl p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wider text-slate-400 font-semibold tabular-nums">
                All Deliveries Summary ({contacts.length})
              </span>
              <span className="text-[11px] font-mono tabular-nums text-rose-300">
                Wickets: {contacts.filter((c) => c.isOut).length}
              </span>
            </div>

            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {contacts.map((c) => {
                const isSelected = c.id === focusedContact.id;
                const vec = wagonWheelSummary.vectors.find(
                  (v) => v.contactId === c.id
                );
                const shotLabel =
                  c.selectedShotName ||
                  c.aiShotAnalysis?.playedShotName ||
                  'No shot selected';
                return (
                  <div
                    key={c.id}
                    onClick={() => onSelectContact(c.id)}
                    className={`p-2.5 rounded-lg border flex items-center justify-between gap-2 cursor-pointer transition ${
                      isSelected
                        ? c.isOut
                          ? 'bg-rose-500/15 border-rose-500/70'
                          : 'bg-cyan-500/15 border-cyan-400/60'
                        : 'bg-slate-950 hover:bg-slate-900 border-slate-800'
                    }`}
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold text-white">
                          Ball #{c.indexNumber}
                        </span>
                        {c.isOut ? (
                          <span className="text-[10px] font-mono font-bold uppercase bg-rose-500 text-white px-1.5 py-0.2 rounded">
                            OUT ({c.dismissalType || 'WICKET'})
                          </span>
                        ) : (
                          <span className="text-[10px] font-mono uppercase text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.2 rounded">
                            NOT OUT
                          </span>
                        )}
                        <span className="text-xs font-medium text-slate-200 truncate">
                          {shotLabel}
                        </span>
                      </div>
                      {c.ballNote && (
                        <p className="text-[11px] text-slate-400 truncate">
                          Note: {c.ballNote}
                        </p>
                      )}
                    </div>

                    <div className="text-right shrink-0 font-mono text-[11px] text-slate-400">
                      <div>{vec?.sector || 'Straight V'}</div>
                      <div className="text-cyan-300">{vec?.angleDeg ?? 180}°</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
