import React from 'react';
import { CheckCircle2, Crosshair, Loader2, Radar, Sparkles, ZoomIn } from 'lucide-react';

interface AnalysisLoadingOverlayProps {
  isOpen: boolean;
  progressPct: number;
  activeStageIndex: number; // 0..3
  currentPreviewFrame?: string;
  scannedFrameCount: number;
  totalFrames: number;
  audioPeakDetected?: boolean;
}

const STAGES = [
  {
    title: 'Stage 1: Capturing 3-Frame Impact Triplet (t - 35ms, t, t + 35ms)',
    subtitle: 'Isolating exact impact frame and adjacent millisecond frames',
  },
  {
    title: 'Stage 2: Computing Temporal Motion-Difference Mask',
    subtitle: 'Subtracting static background so ONLY the moving Bat & Ball remain',
  },
  {
    title: 'Stage 3: 2.2x High-Res AI Zoom Lock (Bat Blade + Ball Contact)',
    subtitle: 'Pinpointing Top-to-Toe Bat Blade Box & exact Ball Contact on 0..1000 grid',
  },
  {
    title: 'Stage 4: Projecting onto Imaginary Back Stumps View',
    subtitle: 'Calculating off/middle/leg stump zone and updating Imaginary Stumps dashboard',
  },
];

export const AnalysisLoadingOverlay: React.FC<AnalysisLoadingOverlayProps> = ({
  isOpen,
  progressPct,
  activeStageIndex,
  currentPreviewFrame,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/88 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-[#0D1322] border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5">
        {/* Top Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              {activeStageIndex >= 1 ? (
                <ZoomIn className="w-5 h-5 animate-pulse" />
              ) : (
                <Radar className="w-5 h-5 animate-spin" />
              )}
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">
                3-Frame Temporal Motion + AI Contact Snap
              </h3>
              <p className="text-xs text-slate-400">
                {activeStageIndex === 1
                  ? 'Isolating moving Bat & Ball pixels across (t - 35ms, t, t + 35ms)...'
                  : 'Locking onto Top-to-Toe Bat Blade Box & Ball Contact Point'}
              </p>
            </div>
          </div>

          <div className="px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono text-sm font-bold">
            {Math.round(progressPct)}%
          </div>
        </div>

        {/* Live Video Frame / Temporal Motion Diff Scanner Window */}
        <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 shadow-inner">
          {currentPreviewFrame ? (
            <img
              src={currentPreviewFrame}
              alt="Scanning frame"
              className="w-full h-full object-contain bg-slate-950 opacity-95"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-500 font-mono text-xs">
              Capturing 3-frame impact triplet (t - 35ms, t, t + 35ms)...
            </div>
          )}

          {/* Animated SVG Radar & Laser Scan Overlay */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 400 225">
            <defs>
              <linearGradient id="scanGlow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10B981" stopOpacity="0" />
                <stop offset="50%" stopColor="#10B981" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#10B981" stopOpacity="0" />
              </linearGradient>
            </defs>

            <line
              x1="200"
              y1="0"
              x2="200"
              y2="225"
              stroke="rgba(245, 158, 11, 0.35)"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
            <line
              x1="0"
              y1="112"
              x2="400"
              y2="112"
              stroke="rgba(16, 185, 129, 0.35)"
              strokeWidth="1"
              strokeDasharray="4 4"
            />

            <rect
              x="0"
              y={((progressPct * 2.5) % 100) * 2.0}
              width="400"
              height="24"
              fill="url(#scanGlow)"
            />
            <line
              x1="0"
              y1={((progressPct * 2.5) % 100) * 2.0 + 12}
              x2="400"
              y2={((progressPct * 2.5) % 100) * 2.0 + 12}
              stroke="#34D399"
              strokeWidth="2"
            />
          </svg>

          {/* Bottom HUD inside preview */}
          <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between px-3 py-1.5 rounded-xl bg-slate-950/85 backdrop-blur-md border border-slate-800 text-xs font-mono">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <Crosshair className="w-3.5 h-3.5 animate-pulse" />
              {activeStageIndex >= 1
                ? '3-FRAME TEMPORAL MOTION MASK (BAT + BALL)'
                : 'IMPACT FRAME TRIPLET LOCK'}
            </span>
            <span className="text-amber-300">2.2x HIGH-RES ZOOM</span>
          </div>
        </div>

        {/* Smooth Progress Bar */}
        <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-amber-400 transition-all duration-300 rounded-full"
            style={{ width: `${Math.max(6, Math.min(100, progressPct))}%` }}
          />
        </div>

        {/* 4-Stage Checklist */}
        <div className="space-y-2">
          {STAGES.map((stage, idx) => {
            const isDone = idx < activeStageIndex;
            const isCurrent = idx === activeStageIndex;

            return (
              <div
                key={stage.title}
                className={`flex items-center gap-3 px-3.5 py-2 rounded-xl border transition ${
                  isCurrent
                    ? 'bg-emerald-500/10 border-emerald-500/40 text-white'
                    : isDone
                    ? 'bg-slate-900/70 border-slate-800/80 text-slate-300'
                    : 'bg-slate-900/30 border-slate-800/40 text-slate-500'
                }`}
              >
                <div className="shrink-0">
                  {isDone ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : isCurrent ? (
                    <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4 text-slate-600" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold">{stage.title}</div>
                  <div className="text-[11px] text-slate-400 truncate">
                    {stage.subtitle}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
