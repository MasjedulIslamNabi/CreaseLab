# CreaseLab Hawk-Eye: Carbon Black & Emerald Complete Redesign Plan

## 1. Executive Summary & Design Direction
Based on your feedback and preferences, the studio interface will undergo a complete ground-up aesthetic rework:
- **Palette: Carbon Black Minimalist with Crisp White and Emerald**:
  - Deep obsidian carbon backgrounds (`#08090D`, `#0D1017`)
  - Elevated glass cards and control panels (`#131722`, `#1A2030`) with razor-sharp hairline borders (`rgba(255, 255, 255, 0.08)`)
  - Vivid Emerald green accents (`#10B981` / `#059669`) for active tools, trajectory tracking markers, and primary broadcast highlights
  - High-contrast crisp white typography (`#FFFFFF`) with slate-zinc secondary information (`#94A3B8`)
  - Absolute elimination of muddy ivory, terracotta, and warm pastel colors
- **Prominent Interactive Animated Tutorial Modal**:
  - Auto-launches immediately when the app opens with a prominent, high-contrast modal backdrop
  - Clear **"Skip Tutorial"** button to dismiss instantly
  - 4 animated visual walkthrough cards (Video Setup & Stumps Calibration, 2-Click Bounce & Contact Marker, Hawk-Eye 3D Trajectory & DRS Virtual Pitch, Delivery Archive & Comparison)
  - Top header "Tutorial & Guide" button to replay the interactive guide at any time
- **Expansive Widescreen Stage with Top Broadcast Control Bar**:
  - Full-width broadcast layout maximizing the video analysis viewport and 3D Hawk-Eye split
  - Sleek top control bar housing:
    - Clip selector / video upload
    - Calibration & tracking mode indicators
    - Delivery ledger drawer & quick "+ New Ball" reset
    - Tutorial modal trigger and layout toggle (Side-by-Side vs Focused Video)
- **Automatic Post-Save Reset**:
  - When a delivery is saved, all video overlay markers (stumps, stump line, bounce, contact, ball trajectory) automatically reset to a clean state ready for the next delivery.

---

## 2. Architecture & Component Blueprint

```
+---------------------------------------------------------------------------------------------------+
|  [CREASELAB HAWK-EYE]  • LIVE BROADCAST  |  [Sample Clip v]  [+ Custom Video]  |  [Tutorial] [New Ball] [Save]  |
+---------------------------------------------------------------------------------------------------+
|                                                                                                   |
|  +------------------------------------------------+  +-----------------------------------------+  |
|  | VIDEO TRACKING STAGE (Full Widescreen 16:9)    |  | HAWK-EYE 3D PITCH & DRS INSPECTOR      |  |
|  | - Ultra-clear carbon canvas overlay             |  | - 3D Pitch trajectory (Emerald line)    |  |
|  | - Batting Stump calibration box               |  | - Stumps impact cylinder (Wickets)      |  |
|  | - Direction Arrow calibration                  |  | - DRS Decision Card: PITCHING/IMPACT/   |  |
|  | - 2-Click: 1. Bounce (B) -> 2. Contact (C)      |  |   WICKETS (HITTING / MISSING)           |  |
|  | - Instant clear on save for next delivery       |  | - Trajectory metrics & pitch map        |  |
|  +------------------------------------------------+  +-----------------------------------------+  |
|                                                                                                   |
|  +---------------------------------------------------------------------------------------------+  |
|  | DELIVERIES SESSION LEDGER (Horizontal Broadcast Strip)                                      |  |
|  | [Ball 1: Good Length - Hitting Wickets]  [Ball 2: Full Toss - Missing]  [+ Add New Delivery] |  |
|  +---------------------------------------------------------------------------------------------+  |
|                                                                                                   |
+---------------------------------------------------------------------------------------------------+
```

---

## 3. Step-by-Step Implementation Strategy

### Step 1: Color System & Global Styling Overhaul (`src/index.css`)
- Replace the current soft theme variables with precision dark tokens:
  - `--bg-canvas`: `#08090D`
  - `--bg-surface`: `#0F121A`
  - `--bg-card`: `#141824`
  - `--border-subtle`: `rgba(255, 255, 255, 0.08)`
  - `--border-focus`: `#10B981`
  - `--accent-emerald`: `#10B981`
  - `--text-primary`: `#FFFFFF`
  - `--text-secondary`: `#94A3B8`
- Add smooth CSS transition classes and emerald glow pulses for active marker indicators.

### Step 2: Interactive Animated Tutorial Modal (`src/components/OnboardingTutorialModal.tsx`)
- Guarantee auto-launch on page load by default.
- Include a prominent, easily accessible "Skip Tutorial" button in the top right and bottom footer.
- 4 rich animated SVG visual slides illustrating:
  1. **Calibrating Batting Stumps**: Dragging the target box to batsman stumps and adjusting the pitch line arrow.
  2. **Marking Delivery (2-Click)**: Setting Bounce Point and Bat Contact Point on the video timeline.
  3. **3D Hawk-Eye & DRS Engine**: Calculating trajectory curve, bounce angle, stump height, and wicket projection.
  4. **Multi-Delivery Comparison**: Saving deliveries and reviewing session pitch maps.
- Provide step indicator dots, "Previous", "Next", and "Get Started" buttons.

### Step 3: Top Broadcast Header & Stage Layout (`src/App.tsx`)
- Re-architect top navigation into an expansive broadcast bar:
  - Brand identity with live emerald badge
  - Quick action toolbar: Clip loader, tutorial launcher, session delivery count
  - Delivery ledger drawer displaying all marked balls with quick replay & comparison
  - Ensure `handleSaveDelivery` immediately wipes active marks (`bouncePoint = null`, `contactPoint = null`, trajectory cleared) so the user can immediately mark the next ball without manual reset steps.

### Step 4: Tracking Stage & Inspector Modernization (`src/components/VideoConnectionStage.tsx`)
- Upgrade all overlay markers to crisp high-contrast emerald & white graphics:
  - Batting stump box: hairline emerald grid with precision corners
  - Direction line: glowing emerald vector arrow
  - Bounce & Contact markers: pulsing emerald badge rings
- Simplify controls bar beneath the video with high-visibility step indicators:
  - `[Step 1: Stumps Calibration]` -> `[Step 2: Mark Bounce]` -> `[Step 3: Mark Contact]` -> `[Step 4: Save & Next]`

### Step 5: Verification & Polish
- Validate clean TypeScript compilation (`tsc --noEmit`).
- Verify smooth responsiveness across widescreen desktop viewports.
- Confirm marks reset cleanly after each delivery save.
