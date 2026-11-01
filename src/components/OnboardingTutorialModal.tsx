import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Check,
  ChevronRight,
  ChevronLeft,
  X,
  Play,
  Layers,
  ArrowRight,
} from 'lucide-react';

export type TutorialTargetTab =
  | 'VIDEO'
  | 'MATCHUP_STUDIO'
  | 'PITCH_3D'
  | 'DRS_TELEMETRY'
  | 'BIOMECHANICS';

interface OnboardingTutorialModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectWorkspaceTab?: (tab: TutorialTargetTab) => void;
}

interface TutorialStepConfig {
  id: string;
  badge: string;
  title: string;
  subtitle: string;
  description: string;
  highlights: string[];
  targetTab: TutorialTargetTab;
  targetTabLabel: string;
  accentColor: string;
}

const TUTORIAL_STEPS: TutorialStepConfig[] = [
  {
    id: 'welcome',
    badge: 'WELCOME · STUDIO OVERVIEW',
    title: 'Precision 3D Cricket Ball Tracking & Hawk-Eye',
    subtitle: 'Carbon black broadcast stage with instant auto-reset delivery tagging.',
    description:
      'CreaseLab transforms standard net or match footage into a broadcast-grade 3D Hawk-Eye tracking and DRS ballistics suite. Follow this quick tour to learn the 4-step workflow.',
    highlights: [
      'Minimalist Carbon Black and Vivid Emerald broadcast color scheme',
      'Expansive widescreen video stage with top control bar and quick "+ New Ball" reset',
      'All markers automatically clear when saving a delivery, ready for the next ball',
    ],
    targetTab: 'VIDEO',
    targetTabLabel: 'Enter Video Studio',
    accentColor: '#10B981',
  },
  {
    id: 'calibrate',
    badge: 'STEP 01 · STUMPS CALIBRATION',
    title: 'Batting Stumps & Suggested Stump Line',
    subtitle: 'Lock 3D perspective in two intuitive drag actions.',
    description:
      'Place the Batting Stumps box over the striker wickets. CreaseLab automatically estimates camera distance from the 71.1cm wicket height and projects an aligned Stump Line arrow down the pitch.',
    highlights: [
      'Automatic camera distance & elevation estimation from stump pixels',
      'Drag the Stump Line vector arrow to match angled net cameras with one click',
      'Supports single-end camera angles as well as dual-wicket pitch layouts',
    ],
    targetTab: 'VIDEO',
    targetTabLabel: 'Calibrate Stumps',
    accentColor: '#38BDF8',
  },
  {
    id: 'track-save',
    badge: 'STEP 02 · 2-CLICK TRACKING & AUTO-RESET',
    title: 'Click Bounce (B) → Contact (C) → Save',
    subtitle: 'Rapid delivery logging with complete mark clearing on save.',
    description:
      'Scrub to where the ball pitches and click Bounce (B). Then scrub to the bat impact frame and click Contact (C). Click Save Delivery — your delivery is recorded and all marks vanish so you can log the next ball immediately.',
    highlights: [
      'Fast 2-click workflow (B → C) with optional 3-click (R → B → C) bowler release',
      'Floating 3.2× precision loupe with reticle for pixel-accurate placement',
      'Auto-clears all marks on save so you can tag an entire over in under two minutes',
    ],
    targetTab: 'VIDEO',
    targetTabLabel: 'Mark Deliveries',
    accentColor: '#10B981',
  },
  {
    id: 'hawkeye-drs',
    badge: 'STEP 03 · 3D HAWK-EYE & DRS DECISION',
    title: '3D Trajectory Orbit & Real-Time DRS Review',
    subtitle: 'Inspect ball trajectory from Bowler, Batter, Umpire and Top views.',
    description:
      'Switch to the 3D Hawk-Eye view to orbit the ball flight trajectory in virtual space. Test LBW criteria with the DRS review engine: Pitching Line, Impact Position, and Wicket Projection.',
    highlights: [
      'Full 3-tier DRS review: Pitching In-Line, Impact In-Line, Wickets Hitting',
      'Interactive 3D camera presets (Bowler, Batter, Umpire, Side, Pitch-Map)',
      'Restitution coefficient, rebound angles, and ball velocity metrics',
    ],
    targetTab: 'PITCH_3D',
    targetTabLabel: 'Explore 3D Hawk-Eye',
    accentColor: '#10B981',
  },
  {
    id: 'matchup-biomech',
    badge: 'STEP 04 · WAGON WHEEL & BIOMECHANICS',
    title: '360° Wagon Wheel & Biomechanics Telestrator',
    subtitle: 'Analyze scoring sectors, dismissal tags, and batter movement.',
    description:
      'Review your session deliveries on the 360° Wagon Wheel to see scoring directions and dismissal types. Open the Biomechanics Lab to draw joint angles, head-stability plumb lines, and swing paths.',
    highlights: [
      'Interactive 360° Wagon Wheel filtered by outcome (Runs, Dot, Out)',
      'Frame-by-frame biomechanical telestration with angle protractors and cones',
      'Switch between session balls anytime from the top deliveries ledger',
    ],
    targetTab: 'MATCHUP_STUDIO',
    targetTabLabel: 'Open Matchup Studio',
    accentColor: '#38BDF8',
  },
];

export const OnboardingTutorialModal: React.FC<OnboardingTutorialModalProps> = ({
  isOpen,
  onClose,
  onSelectWorkspaceTab,
}) => {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setStepIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowRight') {
        setStepIndex((prev) => Math.min(TUTORIAL_STEPS.length - 1, prev + 1));
      } else if (e.key === 'ArrowLeft') {
        setStepIndex((prev) => Math.max(0, prev - 1));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const step = TUTORIAL_STEPS[stepIndex];
  const isLastStep = stepIndex === TUTORIAL_STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="CreaseLab Interactive Feature Tour"
    >
      <div className="relative w-full max-w-4xl rounded-3xl bg-[#0B0E14] border border-white/10 shadow-[0_32px_120px_rgba(0,0,0,0.9)] overflow-hidden text-white">
        {/* Top Emerald Ambient Accent Bar */}
        <div
          className="h-1 w-full transition-all duration-500"
          style={{
            background: `linear-gradient(90deg, ${step.accentColor}, #38BDF8, rgba(255,255,255,0.05))`,
          }}
        />

        {/* Header Bar with Step Progress & Skip Button */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#0E1118]">
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-xl flex items-center justify-center border"
              style={{
                backgroundColor: `${step.accentColor}18`,
                borderColor: `${step.accentColor}50`,
              }}
            >
              <Sparkles
                className="w-3.5 h-3.5"
                style={{ color: step.accentColor }}
              />
            </div>
            <span className="text-xs font-mono uppercase tracking-widest text-zinc-300 font-semibold">
              Interactive Feature Tour
            </span>
            <span className="text-xs font-mono text-zinc-500 tabular-nums">
              ({stepIndex + 1}/{TUTORIAL_STEPS.length})
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-emerald-500 hover:text-black hover:border-emerald-400 border border-white/15 text-xs font-semibold text-white transition cursor-pointer"
          >
            <span>Skip Tutorial</span>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Main Animated Split Content */}
        <div
          key={step.id}
          className="grid grid-cols-1 lg:grid-cols-12 min-h-[400px] animate-workspace-enter"
        >
          {/* Left 6 Columns: Animated Visual Graphic Stage */}
          <div className="lg:col-span-6 bg-[#080A0F] border-b lg:border-b-0 lg:border-r border-white/10 p-6 flex flex-col justify-between relative overflow-hidden">
            <div
              className="pointer-events-none absolute -top-24 -left-24 w-80 h-80 rounded-full blur-3xl opacity-20 transition-all duration-700"
              style={{ backgroundColor: step.accentColor }}
            />

            <div className="relative z-10 flex items-center justify-between">
              <span
                className="text-[10px] font-mono uppercase tracking-widest px-2.5 py-1 rounded-lg border font-bold"
                style={{
                  color: step.accentColor,
                  borderColor: `${step.accentColor}45`,
                  backgroundColor: `${step.accentColor}15`,
                }}
              >
                {step.badge}
              </span>
              <span className="text-[11px] font-mono text-zinc-400">
                Interactive Preview
              </span>
            </div>

            {/* Step-Specific Animated High-Contrast SVG Showcase */}
            <div className="relative z-10 my-4 flex items-center justify-center">
              {stepIndex === 0 && (
                <svg
                  viewBox="0 0 360 220"
                  className="w-full max-w-[340px] h-auto rounded-2xl bg-[#0D1017] border border-white/10 p-3 shadow-inner"
                >
                  {/* Pitch Turf Corridor */}
                  <polygon
                    points="125,42 235,42 310,192 50,192"
                    fill="rgba(16, 185, 129, 0.08)"
                    stroke="rgba(16, 185, 129, 0.45)"
                    strokeWidth="1.2"
                  />
                  <line
                    x1="180"
                    y1="42"
                    x2="180"
                    y2="192"
                    stroke="rgba(255,255,255,0.18)"
                    strokeWidth="1"
                    strokeDasharray="4 4"
                  />
                  {/* Bowler End Stumps */}
                  <g stroke="#38BDF8" strokeWidth="2">
                    <line x1="173" y1="42" x2="173" y2="24" />
                    <line x1="180" y1="42" x2="180" y2="24" />
                    <line x1="187" y1="42" x2="187" y2="24" />
                    <line x1="172" y1="24" x2="188" y2="24" />
                  </g>
                  {/* Striker Batting Stumps */}
                  <g stroke="#FBBF24" strokeWidth="2.5">
                    <line x1="166" y1="185" x2="166" y2="142" />
                    <line x1="180" y1="185" x2="180" y2="142" />
                    <line x1="194" y1="185" x2="194" y2="142" />
                    <line x1="165" y1="142" x2="195" y2="142" stroke="#FFFFFF" />
                  </g>
                  {/* Ball Flight Arc: Bowler Hand -> Bounce B -> Contact C */}
                  <path
                    d="M 164 34 Q 170 85 176 128"
                    fill="none"
                    stroke="#10B981"
                    strokeWidth="2.5"
                    strokeDasharray="5 3"
                    className="animate-pulse"
                  />
                  <path
                    d="M 176 128 Q 181 146 184 162"
                    fill="none"
                    stroke="#34D399"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                  />
                  <ellipse
                    cx="176"
                    cy="128"
                    rx="9"
                    ry="5"
                    fill="rgba(16, 185, 129, 0.25)"
                    stroke="#10B981"
                    strokeWidth="1.5"
                  />
                  <circle cx="184" cy="162" r="6" fill="#10B981" stroke="#FFFFFF" strokeWidth="1.5" />
                  <text
                    x="194"
                    y="131"
                    fill="#34D399"
                    fontSize="9"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    Bounce 5.8m
                  </text>
                  <text
                    x="198"
                    y="165"
                    fill="#FFFFFF"
                    fontSize="9"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    Contact Point (C)
                  </text>
                </svg>
              )}

              {stepIndex === 1 && (
                <svg
                  viewBox="0 0 360 220"
                  className="w-full max-w-[340px] h-auto rounded-2xl bg-[#0D1017] border border-white/10 p-3 shadow-inner"
                >
                  <rect
                    x="18"
                    y="16"
                    width="324"
                    height="188"
                    rx="8"
                    fill="rgba(255,255,255,0.015)"
                    stroke="rgba(255,255,255,0.08)"
                  />
                  {/* Suggested Stump Line Vector Arrow */}
                  <polygon
                    points="160,178 200,178 228,48 196,48"
                    fill="rgba(56, 189, 248, 0.12)"
                  />
                  <line
                    x1="180"
                    y1="178"
                    x2="212"
                    y2="48"
                    stroke="#38BDF8"
                    strokeWidth="2.8"
                  />
                  <circle
                    cx="212"
                    cy="48"
                    r="11"
                    fill="rgba(56, 189, 248, 0.22)"
                    stroke="#38BDF8"
                    strokeWidth="1.6"
                  />
                  <circle cx="212" cy="48" r="4" fill="#FFFFFF" />
                  <text
                    x="230"
                    y="52"
                    fill="#38BDF8"
                    fontSize="9.5"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    Stump Line Vector Arrow
                  </text>
                  {/* Striker Stumps Calibration Box */}
                  <g stroke="#10B981" strokeWidth="2.8">
                    <line x1="164" y1="178" x2="164" y2="122" />
                    <line x1="180" y1="178" x2="180" y2="122" />
                    <line x1="196" y1="178" x2="196" y2="122" />
                    <line x1="163" y1="122" x2="197" y2="122" stroke="#FFFFFF" />
                  </g>
                  <circle
                    cx="180"
                    cy="178"
                    r="5.5"
                    fill="#10B981"
                    stroke="#FFFFFF"
                    strokeWidth="1.4"
                  />
                  <rect
                    x="156"
                    y="114"
                    width="48"
                    height="72"
                    rx="4"
                    fill="none"
                    stroke="#10B981"
                    strokeWidth="1.4"
                    strokeDasharray="4 3"
                  />
                  <text
                    x="42"
                    y="142"
                    fill="#10B981"
                    fontSize="9.5"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    1. Align Batting Stumps
                  </text>
                </svg>
              )}

              {stepIndex === 2 && (
                <svg
                  viewBox="0 0 360 220"
                  className="w-full max-w-[340px] h-auto rounded-2xl bg-[#0D1017] border border-white/10 p-3 shadow-inner"
                >
                  {/* 2-Click Sequence: B -> C */}
                  <line
                    x1="60"
                    y1="80"
                    x2="150"
                    y2="150"
                    stroke="#10B981"
                    strokeWidth="2.2"
                    strokeDasharray="4 4"
                  />
                  <line
                    x1="150"
                    y1="150"
                    x2="250"
                    y2="110"
                    stroke="#34D399"
                    strokeWidth="3.2"
                  />
                  {/* Bounce B Node */}
                  <circle
                    cx="150"
                    cy="150"
                    r="12"
                    fill="rgba(16, 185, 129, 0.2)"
                    stroke="#10B981"
                    strokeWidth="2"
                    className="animate-pulse"
                  />
                  <circle cx="150" cy="150" r="4.5" fill="#10B981" />
                  <text
                    x="132"
                    y="180"
                    fill="#10B981"
                    fontSize="10"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    Click 1: Bounce (B)
                  </text>
                  {/* Contact C Node */}
                  <circle
                    cx="250"
                    cy="110"
                    r="14"
                    fill="rgba(56, 189, 248, 0.25)"
                    stroke="#38BDF8"
                    strokeWidth="2"
                  />
                  <circle cx="250" cy="110" r="5" fill="#FFFFFF" />
                  <text
                    x="220"
                    y="88"
                    fill="#38BDF8"
                    fontSize="10"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    Click 2: Contact (C)
                  </text>
                  {/* Auto-Reset Card */}
                  <rect
                    x="48"
                    y="190"
                    width="264"
                    height="24"
                    rx="6"
                    fill="#10B981"
                  />
                  <text
                    x="180"
                    y="206"
                    textAnchor="middle"
                    fill="#051D12"
                    fontSize="10"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    ✓ Save Delivery → All Marks Clear Automatically
                  </text>
                </svg>
              )}

              {stepIndex === 3 && (
                <svg
                  viewBox="0 0 360 220"
                  className="w-full max-w-[340px] h-auto rounded-2xl bg-[#0D1017] border border-white/10 p-3 shadow-inner"
                >
                  {/* 3D Pitch Orbit & DRS review */}
                  <polygon
                    points="70,170 290,170 240,60 120,60"
                    fill="rgba(16, 185, 129, 0.08)"
                    stroke="#10B981"
                    strokeWidth="1.2"
                  />
                  <g stroke="#38BDF8" strokeWidth="2.4">
                    <line x1="172" y1="60" x2="172" y2="35" />
                    <line x1="180" y1="60" x2="180" y2="35" />
                    <line x1="188" y1="60" x2="188" y2="35" />
                    <line x1="171" y1="35" x2="189" y2="35" />
                  </g>
                  {/* DRS Decision Badge */}
                  <rect
                    x="60"
                    y="18"
                    width="78"
                    height="28"
                    rx="6"
                    fill="#10B981"
                  />
                  <text
                    x="99"
                    y="35"
                    textAnchor="middle"
                    fill="#051D12"
                    fontSize="10"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    HITTING
                  </text>
                  <rect
                    x="222"
                    y="18"
                    width="78"
                    height="28"
                    rx="6"
                    fill="#151A24"
                    stroke="#38BDF8"
                    strokeWidth="1.2"
                  />
                  <text
                    x="261"
                    y="35"
                    textAnchor="middle"
                    fill="#38BDF8"
                    fontSize="9.5"
                    fontFamily="monospace"
                    fontWeight="bold"
                  >
                    IN-LINE
                  </text>
                  {/* Ball 3D Arc */}
                  <path
                    d="M 180 50 Q 186 110 190 140"
                    fill="none"
                    stroke="#10B981"
                    strokeWidth="3"
                  />
                  <circle cx="190" cy="140" r="5" fill="#FFFFFF" />
                  <path
                    d="M 190 140 Q 183 90 180 60"
                    fill="none"
                    stroke="#38BDF8"
                    strokeWidth="2.5"
                    strokeDasharray="4 3"
                  />
                </svg>
              )}

              {stepIndex === 4 && (
                <svg
                  viewBox="0 0 360 220"
                  className="w-full max-w-[340px] h-auto rounded-2xl bg-[#0D1017] border border-white/10 p-3 shadow-inner"
                >
                  {/* 360 Wagon Wheel Circle */}
                  <circle
                    cx="180"
                    cy="110"
                    r="84"
                    fill="none"
                    stroke="rgba(255,255,255,0.12)"
                    strokeWidth="1.5"
                  />
                  <circle
                    cx="180"
                    cy="110"
                    r="48"
                    fill="none"
                    stroke="rgba(255,255,255,0.08)"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  <rect
                    x="176"
                    y="102"
                    width="8"
                    height="16"
                    rx="2"
                    fill="#10B981"
                  />
                  {/* Shot vectors */}
                  <line x1="180" y1="110" x2="238" y2="48" stroke="#10B981" strokeWidth="2.8" />
                  <circle cx="238" cy="48" r="4.5" fill="#10B981" />
                  <line x1="180" y1="110" x2="115" y2="58" stroke="#38BDF8" strokeWidth="2.8" />
                  <circle cx="115" cy="58" r="4.5" fill="#38BDF8" />
                  <line x1="180" y1="110" x2="252" y2="135" stroke="#FBBF24" strokeWidth="2.5" />
                  <circle cx="252" cy="135" r="4.5" fill="#FBBF24" />
                  <text
                    x="180"
                    y="205"
                    textAnchor="middle"
                    fill="#CBD5E1"
                    fontSize="9.5"
                    fontFamily="monospace"
                  >
                    360° Shot Dispersion &amp; Scoring Sectors
                  </text>
                </svg>
              )}
            </div>

            {/* Bottom Step Indicator Dots */}
            <div className="relative z-10 flex items-center justify-between pt-2 border-t border-white/10">
              <div className="flex items-center gap-2">
                {TUTORIAL_STEPS.map((s, idx) => {
                  const active = idx === stepIndex;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setStepIndex(idx)}
                      className={`h-2 rounded-full transition-all duration-300 cursor-pointer ${
                        active ? 'w-7' : 'w-2 bg-zinc-700 hover:bg-zinc-500'
                      }`}
                      style={
                        active ? { backgroundColor: step.accentColor } : undefined
                      }
                      aria-label={`Go to tutorial step ${idx + 1}`}
                    />
                  );
                })}
              </div>
              <span className="text-[11px] font-mono text-zinc-500">
                ← / → arrow keys to navigate
              </span>
            </div>
          </div>

          {/* Right 6 Columns: Narrative Copy + Feature Checklist + Actions */}
          <div className="lg:col-span-6 p-6 sm:p-7 flex flex-col justify-between space-y-5 bg-[#0B0E14]">
            <div className="space-y-3.5">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white leading-snug">
                {step.title}
              </h2>
              <p
                className="text-xs sm:text-sm font-semibold"
                style={{ color: step.accentColor }}
              >
                {step.subtitle}
              </p>
              <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
                {step.description}
              </p>

              <div className="pt-2 space-y-2">
                {step.highlights.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2.5 p-2.5 rounded-xl bg-white/[0.03] border border-white/10"
                  >
                    <div
                      className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                      style={{
                        backgroundColor: `${step.accentColor}25`,
                        color: step.accentColor,
                      }}
                    >
                      <Check className="w-2.5 h-2.5" />
                    </div>
                    <span className="text-xs text-zinc-200 leading-snug">
                      {item}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer Controls */}
            <div className="pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={stepIndex === 0}
                  onClick={() => setStepIndex((prev) => Math.max(0, prev - 1))}
                  className={`inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-medium border transition ${
                    stepIndex === 0
                      ? 'border-white/5 text-zinc-700 cursor-not-allowed'
                      : 'border-white/15 bg-white/5 hover:bg-white/10 text-zinc-200 cursor-pointer'
                  }`}
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Back</span>
                </button>

                {onSelectWorkspaceTab && (
                  <button
                    type="button"
                    onClick={() => {
                      onSelectWorkspaceTab(step.targetTab);
                      onClose();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-mono text-zinc-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/15 transition cursor-pointer"
                  >
                    <Layers
                      className="w-3.5 h-3.5"
                      style={{ color: step.accentColor }}
                    />
                    <span>{step.targetTabLabel}</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                {!isLastStep ? (
                  <button
                    type="button"
                    onClick={() =>
                      setStepIndex((prev) =>
                        Math.min(TUTORIAL_STEPS.length - 1, prev + 1)
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold shadow-sm transition cursor-pointer text-black hover:opacity-95"
                    style={{ backgroundColor: step.accentColor }}
                  >
                    <span>Next Feature</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (onSelectWorkspaceTab) {
                        onSelectWorkspaceTab('VIDEO');
                      }
                      onClose();
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-black text-xs font-bold shadow-sm transition cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Start Analyzing</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OnboardingTutorialModal;
