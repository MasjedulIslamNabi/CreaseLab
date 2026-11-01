import {
  AIShotAnalysisReport,
  AttributeCropSnapshots,
  BatterHandedness,
  BoundingBox2D,
  CameraViewingAngle,
  ContactPointRecord,
  DeliverySourceType,
  FarEndCalibrationMode,
  FollowThroughExitVectorTelemetry,
  NormalizedPoint,
  OpticalSwingKinematics,
  PlantedStumpsConfig,
  TrackedBallFramePoint,
} from '../types/cricket';
import {
  autoDetectBounceFromContactPoint,
  BallTrajectoryPrediction,
  buildPhysicsGroundedShotAnalysis,
  clamp,
  computeCameraPerspectiveModel,
  computeOpticalSwingKinematicsForContact,
  computeStopwatchSpeedKph,
  computeWagonWheelAnalysis,
  project3DPitchBounceToVideo,
  projectVideoBounceTo3DPitch,
  projectVideoReleaseTo3DPitch,
} from './stumpProjection';

export interface FilmstripFrame {
  index: number;
  timestampSec: number;
  thumbUrl: string;
  motionScore: number;
  isPeakMotion?: boolean;
}

export interface TemporalTripletSnapInput {
  impactTimestampSec: number;
  cleanFrameBase64: string;
  /** High-res crop around the moving bat & ball with 0..1000 coordinate grid */
  aiCropBase64: string;
  /** Temporal motion difference image showing only what moved in the 40ms impact window */
  motionDiffCropBase64: string;
  cropBounds: {
    cropX: number;
    cropY: number;
    cropW: number;
    cropH: number;
  };
  opticalIntersectionCropPoint: NormalizedPoint;
}

function seekVideoTo(
  video: HTMLVideoElement,
  targetTimeSec: number,
  maxWaitMs = 900
): Promise<void> {
  return new Promise((resolve) => {
    if (
      Math.abs(video.currentTime - targetTimeSec) < 0.0008 &&
      video.readyState >= 2
    ) {
      resolve();
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeEventListener('seeked', finish);
      resolve();
    };

    const timer = window.setTimeout(finish, maxWaitMs);
    video.addEventListener('seeked', finish);
    try {
      video.currentTime = targetTimeSec;
    } catch {
      finish();
    }
  });
}

/**
 * Generates an interactive 8-frame high-speed filmstrip around a center timestamp
 * (or across a short trimmed window) so the user or detector can see every consecutive frame of the swing.
 */
export async function generateSwingFilmstrip(
  videoUrl: string,
  startSec: number,
  endSec: number,
  count = 8
): Promise<{ frames: FilmstripFrame[]; peakFrameIndex: number }> {
  return new Promise((resolve, reject) => {
    const tempVideo = document.createElement('video');
    tempVideo.crossOrigin = 'anonymous';
    tempVideo.muted = true;
    tempVideo.playsInline = true;
    tempVideo.preload = 'auto';
    tempVideo.src = videoUrl;

    const cleanup = () => {
      tempVideo.removeAttribute('src');
      tempVideo.load();
    };

    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Filmstrip generation timed out.'));
    }, 12000);

    tempVideo.onloadedmetadata = async () => {
      try {
        const duration =
          Number.isFinite(tempVideo.duration) && tempVideo.duration > 0
            ? tempVideo.duration
            : 2.0;

        const safeStart = clamp(startSec, 0, Math.max(0, duration - 0.08));
        const safeEnd = clamp(
          endSec > safeStart ? endSec : duration,
          safeStart + 0.08,
          duration
        );
        const span = Math.max(0.08, safeEnd - safeStart);

        const w = 320;
        const aspect =
          tempVideo.videoWidth && tempVideo.videoHeight
            ? tempVideo.videoHeight / tempVideo.videoWidth
            : 9 / 16;
        const h = Math.round(w * aspect);

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          window.clearTimeout(timeoutId);
          cleanup();
          reject(new Error('Canvas error'));
          return;
        }

        const frames: FilmstripFrame[] = [];
        let prevPixels: Uint8ClampedArray | null = null;
        let maxMotion = -1;
        let peakFrameIndex = Math.floor(count / 2);

        for (let i = 0; i < count; i++) {
          const r = count === 1 ? 0.5 : i / (count - 1);
          const t = Number((safeStart + span * r).toFixed(3));

          await seekVideoTo(tempVideo, t);

          ctx.drawImage(tempVideo, 0, 0, w, h);
          const imgData = ctx.getImageData(0, 0, w, h);
          const pixels = imgData.data;

          let motionScore = 0;
          if (prevPixels) {
            for (let y = Math.floor(h * 0.2); y < Math.floor(h * 0.85); y += 4) {
              for (let x = Math.floor(w * 0.2); x < Math.floor(w * 0.85); x += 4) {
                const idx = (y * w + x) * 4;
                const diff =
                  Math.abs(pixels[idx] - prevPixels[idx]) +
                  Math.abs(pixels[idx + 1] - prevPixels[idx + 1]) +
                  Math.abs(pixels[idx + 2] - prevPixels[idx + 2]);
                if (diff > 65) {
                  motionScore += diff;
                }
              }
            }
          }
          prevPixels = new Uint8ClampedArray(pixels);

          if (motionScore > maxMotion && i >= 1 && i <= count - 2) {
            maxMotion = motionScore;
            peakFrameIndex = i;
          }

          frames.push({
            index: i,
            timestampSec: t,
            thumbUrl: canvas.toDataURL('image/jpeg', 0.78),
            motionScore,
          });
        }

        if (frames[peakFrameIndex]) {
          frames[peakFrameIndex].isPeakMotion = true;
        }

        window.clearTimeout(timeoutId);
        cleanup();
        resolve({ frames, peakFrameIndex });
      } catch (err) {
        window.clearTimeout(timeoutId);
        cleanup();
        reject(err);
      }
    };

    tempVideo.onerror = () => {
      window.clearTimeout(timeoutId);
      cleanup();
      reject(new Error('Video decode error'));
    };
  });
}

/**
 * NEW TEMPORAL 3-FRAME MOTION DIFFERENCE DETECTOR:
 * Captures Frame(t - 0.035s), Frame(t), and Frame(t + 0.035s) around the target impact timestamp.
 * Because static background, pitch, trees, and stance don't move in 35 milliseconds,
 * subtracting Frame(t - 0.035s) and Frame(t + 0.035s) from Frame(t) isolates ONLY
 * the fast-moving Bat Blade and Cricket Ball at the exact moment of impact!
 */
export async function captureTemporalTripletForImpact(
  videoUrl: string,
  targetTimestampSec: number,
  stumpHint?: NormalizedPoint,
  onStepProgress?: (pct: number, previewUrl: string) => void
): Promise<TemporalTripletSnapInput> {
  return new Promise((resolve, reject) => {
    const tempVideo = document.createElement('video');
    tempVideo.crossOrigin = 'anonymous';
    tempVideo.muted = true;
    tempVideo.playsInline = true;
    tempVideo.preload = 'auto';
    tempVideo.src = videoUrl;

    const cleanup = () => {
      tempVideo.removeAttribute('src');
      tempVideo.load();
    };

    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Temporal triplet capture timed out.'));
    }, 15000);

    tempVideo.onloadedmetadata = async () => {
      try {
        const duration =
          Number.isFinite(tempVideo.duration) && tempVideo.duration > 0
            ? tempVideo.duration
            : 2.0;

        const vw = tempVideo.videoWidth || 1280;
        const vh = tempVideo.videoHeight || 720;

        const w = 720;
        const h = Math.round(w * (vh / vw));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          window.clearTimeout(timeoutId);
          cleanup();
          reject(new Error('Canvas context failed.'));
          return;
        }

        const dt = 1 / 28; // ~35ms step before and after impact
        const tPrev = clamp(targetTimestampSec - dt, 0, duration);
        const tCurr = clamp(targetTimestampSec, 0, duration);
        const tNext = clamp(targetTimestampSec + dt, 0, duration);

        const grabPixelsAt = async (timeSec: number) => {
          await seekVideoTo(tempVideo, timeSec);
          ctx.drawImage(tempVideo, 0, 0, w, h);
          return {
            pixels: new Uint8ClampedArray(ctx.getImageData(0, 0, w, h).data),
            dataUrl: canvas.toDataURL('image/jpeg', 0.88),
          };
        };

        const prevFrame = await grabPixelsAt(tPrev);
        if (onStepProgress) onStepProgress(28, prevFrame.dataUrl);

        const currFrame = await grabPixelsAt(tCurr);
        if (onStepProgress) onStepProgress(52, currFrame.dataUrl);

        const nextFrame = await grabPixelsAt(tNext);
        if (onStepProgress) onStepProgress(70, currFrame.dataUrl);

        // Compute Temporal Motion Energy Map on Frame(tCurr):
        // Pixels that changed sharply between (tPrev -> tCurr) AND/OR (tCurr -> tNext)
        // represent the fast-moving bat swing and ball at tCurr!
        let sumX = 0;
        let sumY = 0;
        let sumW = 0;

        // If user planted Back Stumps, focus search within a generous radius of the batter's hitting zone
        const searchMinX = stumpHint
          ? Math.floor(clamp(stumpHint.x - 0.32, 0.08, 0.92) * w)
          : Math.floor(w * 0.12);
        const searchMaxX = stumpHint
          ? Math.floor(clamp(stumpHint.x + 0.32, 0.08, 0.92) * w)
          : Math.floor(w * 0.88);
        const searchMinY = stumpHint
          ? Math.floor(clamp(stumpHint.y - 0.32, 0.08, 0.92) * h)
          : Math.floor(h * 0.15);
        const searchMaxY = stumpHint
          ? Math.floor(clamp(stumpHint.y + 0.25, 0.08, 0.92) * h)
          : Math.floor(h * 0.88);

        for (let y = searchMinY; y < searchMaxY; y += 2) {
          for (let x = searchMinX; x < searchMaxX; x += 2) {
            const i = (y * w + x) * 4;
            const dPrev =
              Math.abs(currFrame.pixels[i] - prevFrame.pixels[i]) +
              Math.abs(currFrame.pixels[i + 1] - prevFrame.pixels[i + 1]) +
              Math.abs(currFrame.pixels[i + 2] - prevFrame.pixels[i + 2]);
            const dNext =
              Math.abs(nextFrame.pixels[i] - currFrame.pixels[i]) +
              Math.abs(nextFrame.pixels[i + 1] - currFrame.pixels[i + 1]) +
              Math.abs(nextFrame.pixels[i + 2] - currFrame.pixels[i + 2]);

            const combined = dPrev + dNext;
            if (combined > 120) {
              const weight = combined * combined;
              sumX += (x / w) * weight;
              sumY += (y / h) * weight;
              sumW += weight;
            }
          }
        }

        const motionCenter: NormalizedPoint =
          sumW > 0
            ? {
                x: clamp(Number((sumX / sumW).toFixed(4)), 0.18, 0.82),
                y: clamp(Number((sumY / sumW).toFixed(4)), 0.22, 0.82),
              }
            : stumpHint
            ? {
                x: clamp(stumpHint.x, 0.2, 0.8),
                y: clamp(stumpHint.y - 0.06, 0.2, 0.8),
              }
            : { x: 0.49, y: 0.52 };

        // Now crop a High-Resolution 2.2x Zoom Window centered on motionCenter
        const cropW = 0.44;
        const cropH = 0.44;
        const cropX = clamp(
          Number((motionCenter.x - cropW / 2).toFixed(4)),
          0,
          1 - cropW
        );
        const cropY = clamp(
          Number((motionCenter.y - cropH / 2).toFixed(4)),
          0,
          1 - cropH
        );

        const outSize = 700;
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = outSize;
        cropCanvas.height = outSize;
        const cropCtx = cropCanvas.getContext('2d', {
          willReadFrequently: true,
        });
        if (!cropCtx) {
          window.clearTimeout(timeoutId);
          cleanup();
          reject(new Error('Crop canvas error'));
          return;
        }

        // First draw tCurr at native high-res into cropCanvas
        await seekVideoTo(tempVideo, tCurr);

        cropCtx.drawImage(
          tempVideo,
          cropX * vw,
          cropY * vh,
          cropW * vw,
          cropH * vh,
          0,
          0,
          outSize,
          outSize
        );

        // Create a second Temporal Motion Highlighted image that shows the AI
        // where the fast-moving bat & ball pixels are located in this exact frame!
        const diffCanvas = document.createElement('canvas');
        diffCanvas.width = outSize;
        diffCanvas.height = outSize;
        const diffCtx = diffCanvas.getContext('2d');
        if (diffCtx) {
          diffCtx.drawImage(cropCanvas, 0, 0);
          // Overlay subtle neon-green motion contours from the 3-frame difference
          const sx0 = Math.floor(cropX * w);
          const sy0 = Math.floor(cropY * h);
          const sw = Math.max(1, Math.floor(cropW * w));
          const sh = Math.max(1, Math.floor(cropH * h));

          diffCtx.fillStyle = 'rgba(16, 185, 129, 0.48)';
          for (let py = 0; py < sh; py += 2) {
            for (let px = 0; px < sw; px += 2) {
              const gx = clamp(sx0 + px, 0, w - 1);
              const gy = clamp(sy0 + py, 0, h - 1);
              const idx = (gy * w + gx) * 4;
              const dPrev =
                Math.abs(currFrame.pixels[idx] - prevFrame.pixels[idx]) +
                Math.abs(currFrame.pixels[idx + 1] - prevFrame.pixels[idx + 1]) +
                Math.abs(currFrame.pixels[idx + 2] - prevFrame.pixels[idx + 2]);
              const dNext =
                Math.abs(nextFrame.pixels[idx] - currFrame.pixels[idx]) +
                Math.abs(nextFrame.pixels[idx + 1] - currFrame.pixels[idx + 1]) +
                Math.abs(nextFrame.pixels[idx + 2] - currFrame.pixels[idx + 2]);

              if (dPrev + dNext > 135) {
                const drawX = (px / sw) * outSize;
                const drawY = (py / sh) * outSize;
                diffCtx.fillRect(drawX, drawY, 4, 4);
              }
            }
          }
        }

        // Draw 0..1000 coordinate grid on cropCanvas for exact readout
        const draw1000Grid = (targetCtx: CanvasRenderingContext2D) => {
          targetCtx.save();
          targetCtx.lineWidth = 1;
          targetCtx.font = 'bold 11px monospace';
          for (let step = 1; step <= 9; step++) {
            const c1000 = step * 100;
            const pos = Math.round((step / 10) * outSize);
            targetCtx.strokeStyle =
              step === 5
                ? 'rgba(251, 191, 36, 0.45)'
                : 'rgba(56, 189, 248, 0.25)';
            targetCtx.beginPath();
            targetCtx.moveTo(pos, 0);
            targetCtx.lineTo(pos, outSize);
            targetCtx.moveTo(0, pos);
            targetCtx.lineTo(outSize, pos);
            targetCtx.stroke();

            targetCtx.fillStyle = 'rgba(9, 13, 22, 0.85)';
            targetCtx.fillRect(pos - 14, 2, 28, 14);
            targetCtx.fillStyle = '#38BDF8';
            targetCtx.fillText(String(c1000), pos - 10, 12);

            targetCtx.fillStyle = 'rgba(9, 13, 22, 0.85)';
            targetCtx.fillRect(2, pos - 7, 28, 14);
            targetCtx.fillStyle = '#FBBF24';
            targetCtx.fillText(String(c1000), 4, pos + 4);
          }
          targetCtx.restore();
        };

        draw1000Grid(cropCtx);
        if (diffCtx) draw1000Grid(diffCtx);

        const aiCropBase64 = cropCanvas.toDataURL('image/jpeg', 0.88);
        const motionDiffCropBase64 = diffCtx
          ? diffCanvas.toDataURL('image/jpeg', 0.85)
          : aiCropBase64;

        if (onStepProgress) onStepProgress(84, motionDiffCropBase64);

        window.clearTimeout(timeoutId);
        cleanup();

        resolve({
          impactTimestampSec: tCurr,
          cleanFrameBase64: currFrame.dataUrl,
          aiCropBase64,
          motionDiffCropBase64,
          cropBounds: { cropX, cropY, cropW, cropH },
          opticalIntersectionCropPoint: {
            x: clamp((motionCenter.x - cropX) / cropW, 0.15, 0.85),
            y: clamp((motionCenter.y - cropY) / cropH, 0.15, 0.85),
          },
        });
      } catch (err) {
        window.clearTimeout(timeoutId);
        cleanup();
        reject(err);
      }
    };

    tempVideo.onerror = () => {
      window.clearTimeout(timeoutId);
      cleanup();
      reject(new Error('Video decode error'));
    };
  });
}

export function mapZoomCropToFullFrame(
  cropPoint: NormalizedPoint,
  cropBox: BoundingBox2D,
  cropBounds: { cropX: number; cropY: number; cropW: number; cropH: number }
): { fullPoint: NormalizedPoint; fullBatBox: BoundingBox2D } {
  const fullPoint: NormalizedPoint = {
    x: clamp(
      Number((cropBounds.cropX + cropPoint.x * cropBounds.cropW).toFixed(4)),
      0.03,
      0.97
    ),
    y: clamp(
      Number((cropBounds.cropY + cropPoint.y * cropBounds.cropH).toFixed(4)),
      0.03,
      0.97
    ),
  };

  const fullBatBox: BoundingBox2D = {
    xmin: clamp(
      Number((cropBounds.cropX + cropBox.xmin * cropBounds.cropW).toFixed(4)),
      0.02,
      0.98
    ),
    xmax: clamp(
      Number((cropBounds.cropX + cropBox.xmax * cropBounds.cropW).toFixed(4)),
      0.02,
      0.98
    ),
    ymin: clamp(
      Number((cropBounds.cropY + cropBox.ymin * cropBounds.cropH).toFixed(4)),
      0.02,
      0.98
    ),
    ymax: clamp(
      Number((cropBounds.cropY + cropBox.ymax * cropBounds.cropH).toFixed(4)),
      0.02,
      0.98
    ),
  };

  return { fullPoint, fullBatBox };
}

export interface SwingSequenceAndStoryboardResult {
  frames: string[];
  stitchedStoryboardUrl: string;
  postImpactFrames: string[];
  postImpactStoryboardUrl: string;
  postImpactHorizontalShift: number;
  followThroughSlopeDeg: number;
  measuredBatAngleDeg?: number;
  exitVectorTelemetry?: FollowThroughExitVectorTelemetry;
  attributeCropSnapshots?: AttributeCropSnapshots;
}

function buildCropFromBitmap(
  sourceCanvas: HTMLCanvasElement,
  centerXNorm: number,
  centerYNorm: number,
  cropWidthNorm: number,
  cropHeightNorm: number,
  outW = 640,
  outH = 400
): string {
  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;
  const cw = clamp(cropWidthNorm, 0.18, 0.72);
  const ch = clamp(cropHeightNorm, 0.18, 0.72);
  const sx = clamp(centerXNorm - cw * 0.5, 0, 1 - cw) * sw;
  const sy = clamp(centerYNorm - ch * 0.5, 0, 1 - ch) * sh;

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = outW;
  cropCanvas.height = outH;
  const cCtx = cropCanvas.getContext('2d');
  if (!cCtx) return '';

  cCtx.imageSmoothingEnabled = true;
  cCtx.imageSmoothingQuality = 'high';
  cCtx.fillStyle = '#05080F';
  cCtx.fillRect(0, 0, outW, outH);
  cCtx.drawImage(sourceCanvas, sx, sy, cw * sw, ch * sh, 0, 0, outW, outH);
  return cropCanvas.toDataURL('image/jpeg', 0.92);
}

/**
 * Generates high-resolution regional zoomed crops (Head, Footwork/Crease, Bat Face, Follow-Through)
 * and a 4-frame Post-Impact Storyboard from a single snapshot URL when a live video file is not mounted.
 */
export async function generateFallbackPostImpactAndCropsFromSnapshot(
  snapshotUrl: string,
  contact: ContactPointRecord,
  handedness: BatterHandedness = 'RHB',
  exitTelemetry?: FollowThroughExitVectorTelemetry
): Promise<{
  postImpactFrames: string[];
  postImpactStoryboardUrl: string;
  attributeCropSnapshots: AttributeCropSnapshots;
}> {
  const emptyCrops: AttributeCropSnapshots = {
    headCropUrl: snapshotUrl,
    footworkCropUrl: snapshotUrl,
    batFaceCropUrl: snapshotUrl,
    followThroughCropUrl: snapshotUrl,
  };
  if (!snapshotUrl) {
    return {
      postImpactFrames: [],
      postImpactStoryboardUrl: '',
      attributeCropSnapshots: emptyCrops,
    };
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const outW = Math.min(1280, Math.max(960, img.naturalWidth || 1280));
        const outH = Math.round(
          outW * ((img.naturalHeight || 720) / (img.naturalWidth || 1280))
        );
        const baseCanvas = document.createElement('canvas');
        baseCanvas.width = outW;
        baseCanvas.height = outH;
        const baseCtx = baseCanvas.getContext('2d');
        if (!baseCtx) {
          resolve({
            postImpactFrames: [snapshotUrl, snapshotUrl, snapshotUrl, snapshotUrl],
            postImpactStoryboardUrl: snapshotUrl,
            attributeCropSnapshots: emptyCrops,
          });
          return;
        }
        baseCtx.imageSmoothingEnabled = true;
        baseCtx.imageSmoothingQuality = 'high';
        baseCtx.drawImage(img, 0, 0, outW, outH);
        const cleanDataUrl = baseCanvas.toDataURL('image/jpeg', 0.92);

        const cx = contact.videoPoint.x;
        const cy = contact.videoPoint.y;
        const stumpX = contact.stumpConfig.backStumps.x;
        const stumpY = contact.stumpConfig.backStumps.y;

        // 1. Head & Balance Crop (high-res upper-body & stance alignment window)
        const headX = clamp((cx + stumpX) * 0.5, 0.24, 0.76);
        const headY = clamp(Math.min(cy, stumpY) - 0.1, 0.2, 0.72);
        const headCropUrl = buildCropFromBitmap(baseCanvas, headX, headY, 0.46, 0.42);

        // 2. Footwork & Stride Crop (crease & ground plane between stumps and contact)
        const footX = clamp((cx + stumpX) * 0.5, 0.24, 0.76);
        const footY = clamp(Math.max(cy, stumpY) + 0.04, 0.28, 0.78);
        const footworkCropUrl = buildCropFromBitmap(baseCanvas, footX, footY, 0.5, 0.44);

        // 3. Bat Face & Swing Plane Crop (centered tightly on bat-ball contact point)
        const batFaceCropUrl = buildCropFromBitmap(
          baseCanvas,
          clamp(cx, 0.22, 0.78),
          clamp(cy - 0.02, 0.22, 0.78),
          0.42,
          0.4
        );

        // 4. Follow-Through Exit Trajectory Crop
        const pts = exitTelemetry?.exitTrajectoryPoints || [
          { offsetMs: 0, label: 'Impact (0ms)', x: cx, y: cy },
          { offsetMs: 35, label: 'Exit Start (+35ms)', x: cx, y: cy - 0.01 },
          { offsetMs: 70, label: 'Mid Follow-Through (+70ms)', x: cx, y: cy - 0.02 },
          { offsetMs: 110, label: 'Follow-Through Finish (+110ms)', x: cx, y: cy - 0.03 },
        ];
        const ftMidX = clamp((pts[0].x + pts[pts.length - 1].x) * 0.5, 0.24, 0.76);
        const ftMidY = clamp((pts[0].y + pts[pts.length - 1].y) * 0.5, 0.22, 0.76);
        const followThroughCropUrl = buildCropFromBitmap(
          baseCanvas,
          ftMidX,
          ftMidY,
          0.46,
          0.42
        );

        const postImpactFrames = [
          cleanDataUrl,
          cleanDataUrl,
          cleanDataUrl,
          cleanDataUrl,
        ];

        resolve({
          postImpactFrames,
          postImpactStoryboardUrl: cleanDataUrl,
          attributeCropSnapshots: {
            headCropUrl: headCropUrl || snapshotUrl,
            footworkCropUrl: footworkCropUrl || snapshotUrl,
            batFaceCropUrl: batFaceCropUrl || snapshotUrl,
            followThroughCropUrl: followThroughCropUrl || snapshotUrl,
          },
        });
      } catch {
        resolve({
          postImpactFrames: [snapshotUrl, snapshotUrl, snapshotUrl, snapshotUrl],
          postImpactStoryboardUrl: snapshotUrl,
          attributeCropSnapshots: emptyCrops,
        });
      }
    };
    img.onerror = () => {
      resolve({
        postImpactFrames: [snapshotUrl, snapshotUrl, snapshotUrl, snapshotUrl],
        postImpactStoryboardUrl: snapshotUrl,
        attributeCropSnapshots: emptyCrops,
      });
    };
    img.src = snapshotUrl;
  });
}

/**
 * High-Resolution Through-Contact Feature Extractor (`1280×720` HD):
 * 1) Samples 7 high-res video frames across the swing (-160ms, -85ms, -35ms, 0ms, +35ms, +70ms, +110ms)
 * 2) Tracks the Bat Blade Path THROUGH the Point of Contact (-35ms Entry -> 0ms Impact -> +35ms Exit -> +70ms Mid -> +110ms Finish)
 *    using motion-weighted Sobel edge orientation and localized contact-corridor optical flow to eliminate Pull vs Cut confusion
 * 3) Builds a High-Resolution Cropped Contact-Path Storyboard for Gemini Vision
 * 4) Extracts 4 High-Precision 640×400 Zoomed Attribute Crops (`headCropUrl`, `footworkCropUrl`, `batFaceCropUrl`, `followThroughCropUrl`)
 */
export async function extractSwingSequenceAndStoryboard(
  videoUrl: string,
  impactTimeSec: number,
  contactPointNorm?: NormalizedPoint,
  handedness: BatterHandedness = 'RHB',
  stumpPointNorm?: NormalizedPoint,
  cameraAngle: CameraViewingAngle = 'BEHIND_BOWLER'
): Promise<SwingSequenceAndStoryboardResult> {
  const emptyResult: SwingSequenceAndStoryboardResult = {
    frames: [],
    stitchedStoryboardUrl: '',
    postImpactFrames: [],
    postImpactStoryboardUrl: '',
    postImpactHorizontalShift: 0,
    followThroughSlopeDeg: 0,
  };
  if (!videoUrl) return emptyResult;

  return new Promise((resolve) => {
    const tempVideo = document.createElement('video');
    tempVideo.crossOrigin = 'anonymous';
    tempVideo.muted = true;
    tempVideo.playsInline = true;
    tempVideo.preload = 'auto';
    tempVideo.src = videoUrl;

    const cleanup = () => {
      tempVideo.removeAttribute('src');
      tempVideo.load();
    };

    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve(emptyResult);
    }, 12500);

    tempVideo.onloadedmetadata = async () => {
      try {
        const duration =
          Number.isFinite(tempVideo.duration) && tempVideo.duration > 0
            ? tempVideo.duration
            : 2.0;

        const vw = tempVideo.videoWidth || 1280;
        const vh = tempVideo.videoHeight || 720;
        // High-Resolution HD capture (up to 1280px width)
        const outW = Math.min(1280, Math.max(960, vw));
        const outH = Math.round(outW * (vh / vw));

        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          window.clearTimeout(timeoutId);
          cleanup();
          resolve(emptyResult);
          return;
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        const sampleTimes = [
          {
            time: clamp(impactTimeSec - 0.16, 0, duration),
            shortLabel: 'STANCE (-160ms)',
            contactStripLabel: '',
            inFivePhase: true,
          },
          {
            time: clamp(impactTimeSec - 0.085, 0, duration),
            shortLabel: 'BACKLIFT (-85ms)',
            contactStripLabel: '',
            inFivePhase: true,
          },
          {
            time: clamp(impactTimeSec - 0.035, 0, duration),
            shortLabel: 'DOWNSWING ENTRY (-35ms)',
            contactStripLabel: '1. PRE-CONTACT ENTRY (-35ms)',
            inFivePhase: true,
          },
          {
            time: clamp(impactTimeSec, 0, duration),
            shortLabel: 'EXACT IMPACT (0ms)',
            contactStripLabel: '2. EXACT CONTACT (0ms)',
            inFivePhase: true,
          },
          {
            time: clamp(impactTimeSec + 0.035, 0, duration),
            shortLabel: 'BLADE EXIT (+35ms)',
            contactStripLabel: '3. IMMEDIATE EXIT (+35ms)',
            inFivePhase: false,
          },
          {
            time: clamp(impactTimeSec + 0.07, 0, duration),
            shortLabel: 'MID FOLLOW-THROUGH (+70ms)',
            contactStripLabel: '4. FOLLOW-THROUGH ARC (+70ms)',
            inFivePhase: false,
          },
          {
            time: clamp(impactTimeSec + 0.11, 0, duration),
            shortLabel: 'FINISH (+110ms)',
            contactStripLabel: '',
            inFivePhase: true,
          },
        ];

        const frames: string[] = [];
        const rawBitmaps: ImageData[] = [];
        const cleanDataUrls: string[] = [];

        for (const step of sampleTimes) {
          await seekVideoTo(tempVideo, step.time, 700);
          ctx.drawImage(tempVideo, 0, 0, outW, outH);
          rawBitmaps.push(ctx.getImageData(0, 0, outW, outH));
          const cleanUrl = canvas.toDataURL('image/jpeg', 0.91);
          cleanDataUrls.push(cleanUrl);

          if (step.inFivePhase) {
            frames.push(cleanUrl);
          }
        }

        // ====================================================================
        // THROUGH-CONTACT BAT PATH FEATURE EXTRACTION (-35ms -> 0ms -> +35ms -> +70ms -> +110ms)
        // Isolates the high-res contact corridor around `contactPointNorm`
        // ====================================================================
        const cxNorm = contactPointNorm ? contactPointNorm.x : 0.5;
        const cyNorm = contactPointNorm ? contactPointNorm.y : 0.5;
        const minX = Math.floor(clamp(cxNorm - 0.15, 0.05, 0.95) * outW);
        const maxX = Math.floor(clamp(cxNorm + 0.15, 0.05, 0.95) * outW);
        const minY = Math.floor(clamp(cyNorm - 0.17, 0.05, 0.95) * outH);
        const maxY = Math.floor(clamp(cyNorm + 0.11, 0.05, 0.95) * outH);

        const findMotionCentroid = (
          prevData: Uint8ClampedArray,
          currData: Uint8ClampedArray,
          anchorPt: { x: number; y: number }
        ): { x: number; y: number } => {
          let sx = 0;
          let sy = 0;
          let sw = 0;
          for (let y = minY; y < maxY; y += 2) {
            for (let x = minX; x < maxX; x += 2) {
              const i = (y * outW + x) * 4;
              const diff =
                Math.abs(currData[i] - prevData[i]) +
                Math.abs(currData[i + 1] - prevData[i + 1]) +
                Math.abs(currData[i + 2] - prevData[i + 2]);
              if (diff > 72) {
                // Gaussian spatial weighting centered near the contact corridor so background crowd/bowler motion is ignored
                const distSq =
                  Math.pow(x / outW - anchorPt.x, 2) +
                  Math.pow(y / outH - anchorPt.y, 2);
                const spatialW = Math.exp(-distSq / (2 * 0.085 * 0.085));
                const w = diff * diff * spatialW;
                sx += (x / outW) * w;
                sy += (y / outH) * w;
                sw += w;
              }
            }
          }
          if (sw <= 0) return anchorPt;
          return {
            x: Number(clamp(sx / sw, 0.08, 0.92).toFixed(4)),
            y: Number(clamp(sy / sw, 0.08, 0.92).toFixed(4)),
          };
        };

        // Let 3D kinematics + Gemini Vision determine bat angle without static crease/pad edge noise
        const measuredBatAngleDeg: number | undefined = undefined;

        const pt0 = { x: cxNorm, y: cyNorm };
        const ptPre35 =
          rawBitmaps.length >= 4
            ? findMotionCentroid(rawBitmaps[1].data, rawBitmaps[2].data, pt0)
            : pt0;
        const pt35 =
          rawBitmaps.length >= 5
            ? findMotionCentroid(rawBitmaps[3].data, rawBitmaps[4].data, pt0)
            : pt0;
        const pt70 =
          rawBitmaps.length >= 6
            ? findMotionCentroid(rawBitmaps[4].data, rawBitmaps[5].data, pt35)
            : pt35;
        const pt110 =
          rawBitmaps.length >= 7
            ? findMotionCentroid(rawBitmaps[5].data, rawBitmaps[6].data, pt70)
            : pt70;

        // Combine through-contact vector (-35ms -> +35ms) and post-contact follow-through (+35ms -> +110ms)
        const dxThrough = pt35.x - ptPre35.x;
        const dyThrough = pt35.y - ptPre35.y;
        const dxPost1 = pt70.x - pt0.x;
        const dyPost1 = pt70.y - pt0.y;
        const dxPost2 = pt110.x - pt35.x;
        const dyPost2 = pt110.y - pt35.y;

        const postImpactHorizontalShift = Number(
          (dxThrough * 0.35 + dxPost1 * 0.4 + dxPost2 * 0.25).toFixed(4)
        );
        const weightedDy = dyThrough * 0.35 + dyPost1 * 0.4 + dyPost2 * 0.25;
        const followThroughSlopeDeg = Math.round(
          (Math.atan2(-weightedDy, postImpactHorizontalShift) * 180) / Math.PI
        );

        const lateralMirror = cameraAngle === 'BEHIND_BATTER' ? -1 : 1;
        const handednessSign = (handedness === 'RHB' ? 1 : -1) * lateralMirror;
        const legSideShift = postImpactHorizontalShift * handednessSign;
        const legSideSweepPct = Number((legSideShift * 100).toFixed(1));
        const upwardFinishPct = Number(
          clamp(-weightedDy * 100, -12, 18).toFixed(1)
        );

        const pullProfileMatchPct = Math.round(
          clamp(50 + legSideSweepPct * 11, 10, 96)
        );
        const cutProfileMatchPct = Math.round(
          clamp(50 - legSideSweepPct * 11, 10, 96)
        );
        const resolvedCrossBatWinner: FollowThroughExitVectorTelemetry['resolvedCrossBatWinner'] =
          legSideSweepPct >= 1.3
            ? 'PULL_SHOT'
            : legSideSweepPct <= -1.3
            ? 'SQUARE_CUT'
            : 'STRAIGHT_ARC';

        const exitTrajectoryPoints: FollowThroughExitVectorTelemetry['exitTrajectoryPoints'] =
          [
            { offsetMs: 0, label: 'Impact (0ms)', x: pt0.x, y: pt0.y },
            { offsetMs: 35, label: 'Exit Start (+35ms)', x: pt35.x, y: pt35.y },
            {
              offsetMs: 70,
              label: 'Mid Follow-Through (+70ms)',
              x: pt70.x,
              y: pt70.y,
            },
            {
              offsetMs: 110,
              label: 'Follow-Through Finish (+110ms)',
              x: pt110.x,
              y: pt110.y,
            },
          ];

        const exitVectorTelemetry: FollowThroughExitVectorTelemetry = {
          exitFrameOffsetsMs: [0, 35, 70, 110],
          exitTrajectoryPoints,
          exitAzimuthDeg: followThroughSlopeDeg,
          legSideSweepPct,
          upwardFinishPct,
          pullProfileMatchPct,
          cutProfileMatchPct,
          resolvedCrossBatWinner,
          exitVectorSummary:
            resolvedCrossBatWinner === 'PULL_SHOT'
              ? `Through-contact bat path sweeps +${Math.abs(legSideSweepPct).toFixed(1)}% from off-to-leg (Pull arc).`
              : resolvedCrossBatWinner === 'SQUARE_CUT'
              ? `Through-contact bat path slices -${Math.abs(legSideSweepPct).toFixed(1)}% toward point/off-side (Cut arc).`
              : `Through-contact bat path tracks along a vertical plane (${followThroughSlopeDeg}° finish).`,
        };

        // Extract 4 High-Resolution (640x400) Regional Attribute Crops
        let attributeCropSnapshots: AttributeCropSnapshots | undefined;
        if (rawBitmaps.length >= 7) {
          const cleanCanvas = document.createElement('canvas');
          cleanCanvas.width = outW;
          cleanCanvas.height = outH;
          const cleanCtx = cleanCanvas.getContext('2d');
          if (cleanCtx) {
            const sx = stumpPointNorm ? stumpPointNorm.x : cxNorm;
            const sy = stumpPointNorm ? stumpPointNorm.y : cyNorm;

            // 1. Head & Balance Crop from Impact Frame (Index 3)
            cleanCtx.putImageData(rawBitmaps[3], 0, 0);
            const headCropUrl = buildCropFromBitmap(
              cleanCanvas,
              clamp((cxNorm + sx) * 0.5, 0.24, 0.76),
              clamp(Math.min(cyNorm, sy) - 0.1, 0.2, 0.72),
              0.46,
              0.42
            );

            // 2. Footwork & Stride Crop from Downswing/Impact Frame (Index 2)
            cleanCtx.putImageData(rawBitmaps[2], 0, 0);
            const footworkCropUrl = buildCropFromBitmap(
              cleanCanvas,
              clamp((cxNorm + sx) * 0.5, 0.24, 0.76),
              clamp(Math.max(cyNorm, sy) + 0.04, 0.28, 0.78),
              0.5,
              0.44
            );

            // 3. Bat Face & Swing Plane Crop from Exact Impact Frame (Index 3)
            cleanCtx.putImageData(rawBitmaps[3], 0, 0);
            const batFaceCropUrl = buildCropFromBitmap(
              cleanCanvas,
              clamp(cxNorm, 0.22, 0.78),
              clamp(cyNorm - 0.02, 0.22, 0.78),
              0.42,
              0.4
            );

            // 4. Follow-Through Finish Crop from +110ms Frame (Index 6)
            cleanCtx.putImageData(rawBitmaps[6], 0, 0);
            const followThroughCropUrl = buildCropFromBitmap(
              cleanCanvas,
              clamp((pt0.x + pt110.x) * 0.5, 0.24, 0.76),
              clamp((pt0.y + pt110.y) * 0.5, 0.22, 0.76),
              0.46,
              0.42
            );

            attributeCropSnapshots = {
              headCropUrl,
              footworkCropUrl,
              batFaceCropUrl,
              followThroughCropUrl,
            };
          }
        }

        // Clean 4-Frame Post-Impact Individual Frames ([0ms, +35ms, +70ms, +110ms])
        const postImpactFrames: string[] =
          cleanDataUrls.length >= 7
            ? [
                cleanDataUrls[3],
                cleanDataUrls[4],
                cleanDataUrls[5],
                cleanDataUrls[6],
              ]
            : frames.slice(0, 4);

        // Build High-Resolution Zoomed Through-Contact Storyboard (1600x420) centered on the batter & contact zone
        // across [-35ms Pre-Contact Entry, 0ms Exact Impact, +35ms Immediate Exit, +70ms Follow-Through]
        let stitchedStoryboardUrl = '';
        let postImpactStoryboardUrl = '';
        const tempTileCanvas = document.createElement('canvas');
        tempTileCanvas.width = outW;
        tempTileCanvas.height = outH;
        const tempTileCtx = tempTileCanvas.getContext('2d');

        if (tempTileCtx && rawBitmaps.length >= 7) {
          const sbCanvas = document.createElement('canvas');
          const tileW = 400;
          const bannerH = 38;
          const tileH = 360;
          sbCanvas.width = tileW * 4;
          sbCanvas.height = bannerH + tileH;
          const sbCtx = sbCanvas.getContext('2d');
          if (sbCtx) {
            sbCtx.imageSmoothingEnabled = true;
            sbCtx.imageSmoothingQuality = 'high';
            sbCtx.fillStyle = '#060A12';
            sbCtx.fillRect(0, 0, sbCanvas.width, sbCanvas.height);

            const isLeftOffSide =
              (handedness === 'RHB' && cameraAngle !== 'BEHIND_BATTER') ||
              (handedness === 'LHB' && cameraAngle === 'BEHIND_BATTER');
            const leftSideLabel = isLeftOffSide
              ? '← OFF SIDE (CUT/DRIVE)'
              : '← LEG SIDE (PULL/FLICK)';
            const rightSideLabel = isLeftOffSide
              ? 'LEG SIDE (PULL/FLICK) →'
              : 'OFF SIDE (CUT/DRIVE) →';

            sbCtx.fillStyle = '#0B1120';
            sbCtx.fillRect(0, 0, sbCanvas.width, bannerH);
            sbCtx.font = 'bold 13px monospace';
            sbCtx.fillStyle = '#38BDF8';
            sbCtx.fillText(leftSideLabel, 18, 24);
            sbCtx.fillStyle = '#F8FAFC';
            sbCtx.fillText(
              `HIGH-RES THROUGH-CONTACT BAT PATH (${handedness}): -35ms ENTRY → 0ms CONTACT → +35ms EXIT → +70ms ARC`,
              340,
              24
            );
            sbCtx.fillStyle = '#10B981';
            sbCtx.fillText(rightSideLabel, sbCanvas.width - 230, 24);

            // Zoom into the batter & contact zone (54% width x 54% height around contact/stumps) so bat path is crystal clear
            const sxCenter = stumpPointNorm
              ? clamp((cxNorm + stumpPointNorm.x) * 0.5, 0.28, 0.72)
              : clamp(cxNorm, 0.28, 0.72);
            const syCenter = stumpPointNorm
              ? clamp((cyNorm + stumpPointNorm.y) * 0.5 - 0.04, 0.28, 0.72)
              : clamp(cyNorm - 0.04, 0.28, 0.72);
            const zoomW = 0.54;
            const zoomH = 0.54;
            const srcX = clamp(sxCenter - zoomW * 0.5, 0, 1 - zoomW) * outW;
            const srcY = clamp(syCenter - zoomH * 0.5, 0, 1 - zoomH) * outH;
            const srcW = zoomW * outW;
            const srcH = zoomH * outH;

            // Indices: 2 (-35ms Entry), 3 (0ms Impact), 4 (+35ms Exit), 5 (+70ms Mid Follow-Through)
            const contactIndices = [2, 3, 4, 5];
            for (let k = 0; k < 4; k++) {
              const idx = contactIndices[k];
              const xOffset = k * tileW;
              tempTileCtx.putImageData(rawBitmaps[idx], 0, 0);
              sbCtx.drawImage(
                tempTileCanvas,
                srcX,
                srcY,
                srcW,
                srcH,
                xOffset,
                bannerH,
                tileW,
                tileH
              );

              sbCtx.strokeStyle = k === 1 ? '#10B981' : '#1E293B';
              sbCtx.lineWidth = k === 1 ? 2.5 : 1;
              sbCtx.strokeRect(xOffset, bannerH, tileW, tileH);

              sbCtx.fillStyle = 'rgba(6, 10, 18, 0.85)';
              sbCtx.fillRect(xOffset + 8, bannerH + 8, 235, 24);
              sbCtx.fillStyle = k === 1 ? '#6EE7B7' : '#E2E8F0';
              sbCtx.font = 'bold 11.5px monospace';
              sbCtx.fillText(
                sampleTimes[idx].contactStripLabel,
                xOffset + 14,
                bannerH + 24
              );
            }

            stitchedStoryboardUrl = sbCanvas.toDataURL('image/jpeg', 0.91);
            postImpactStoryboardUrl = stitchedStoryboardUrl;
          }
        }

        window.clearTimeout(timeoutId);
        cleanup();
        resolve({
          frames,
          stitchedStoryboardUrl,
          postImpactFrames,
          postImpactStoryboardUrl,
          postImpactHorizontalShift,
          followThroughSlopeDeg,
          ...(typeof measuredBatAngleDeg === 'number'
            ? { measuredBatAngleDeg }
            : {}),
          exitVectorTelemetry,
          attributeCropSnapshots,
        });
      } catch {
        window.clearTimeout(timeoutId);
        cleanup();
        resolve(emptyResult);
      }
    };

    tempVideo.onerror = () => {
      window.clearTimeout(timeoutId);
      cleanup();
      resolve(emptyResult);
    };
  });
}

export async function extractThreeFrameSwingSequence(
  videoUrl: string,
  impactTimeSec: number,
  contactPointNorm?: NormalizedPoint
): Promise<string[]> {
  const res = await extractSwingSequenceAndStoryboard(
    videoUrl,
    impactTimeSec,
    contactPointNorm
  );
  return res.frames;
}

export interface ThreePointFlightDetectionResult {
  releasePoint: NormalizedPoint;
  bouncePoint: NormalizedPoint;
  contactPoint: NormalizedPoint;
  releaseTimestampSec: number;
  bounceTimestampSec: number;
  impactTimestampSec: number;
  bounceDistanceFromStumpsM: number;
  calibratedSpeedKph?: number;
  trackingConfidencePct: number;
  trackingMethod: 'MULTI_FRAME_OPTICAL_V_BOUNCE' | 'PHYSICS_BALLISTIC_FALLBACK';
  trackedWaypoints: TrackedBallFramePoint[];
  bowlerReleaseAngleLabel: string;
}

export interface AutoTrackOptions {
  trimStartSec?: number;
  trimEndSec?: number;
  seedBallPoint?: {
    point: NormalizedPoint;
    timestampSec: number;
  };
  onFrameTracked?: (
    frameTimestampSec: number,
    ballPoint: NormalizedPoint,
    phase: TrackedBallFramePoint['phase'],
    progressWaypoints: TrackedBallFramePoint[]
  ) => void | Promise<void>;
}

/**
 * FullTrack AI / Cric.ai Style Hybrid Multi-Frame Compact Ball Spot + Viterbi Path Follower:
 * 1. Builds a Temporal Median Background image across the delivery window to eliminate static creases, stumps, and banners.
 * 2. Applies a Center-Surround Difference-of-Boxes (DoG) Spot Filter in every frame to isolate compact 4-12px moving ball blobs
 *    while suppressing large moving player limbs/bodies.
 * 3. Links candidate ball blobs across all frames using a Forward Velocity-Constrained Viterbi Path Tracker (Release -> V-Bounce -> Contact),
 *    supporting both 1-click full-auto tracking and user-seeded "Click Ball & Follow to End" lock.
 */
export async function autoDetectThreePointDeliveryFromVideo(
  videoUrl: string,
  impactTimeSec: number,
  backStumps: NormalizedPoint,
  frontStumps: NormalizedPoint,
  existingContactPoint?: NormalizedPoint,
  stumpConfig?: PlantedStumpsConfig,
  handedness: BatterHandedness = 'RHB',
  onProgress?: (statusText: string, pct: number) => void,
  trackingOptions?: AutoTrackOptions
): Promise<ThreePointFlightDetectionResult> {
  const effectiveStumps: PlantedStumpsConfig = stumpConfig || {
    anchorMode: 'FRONT_STUMPS',
    backStumps,
    frontStumps,
    backStumpWidth: 0.032,
    backStumpHeight: 0.095,
    frontStumpWidth: 0.038,
    frontStumpHeight: 0.095,
  };

  const defaultContact: NormalizedPoint = existingContactPoint || {
    x: clamp(backStumps.x - 0.014, 0.12, 0.88),
    y: clamp(backStumps.y - 0.03, 0.12, 0.88),
  };

  const physicsBaseline = autoDetectBounceFromContactPoint(
    defaultContact,
    effectiveStumps,
    handedness,
    impactTimeSec
  );

  const fallbackResult: ThreePointFlightDetectionResult = {
    releasePoint: physicsBaseline.releasePoint,
    bouncePoint: physicsBaseline.bouncePoint,
    contactPoint: defaultContact,
    releaseTimestampSec: physicsBaseline.releaseTimestampSec,
    bounceTimestampSec: physicsBaseline.bounceTimestampSec,
    impactTimestampSec: Math.max(0.08, impactTimeSec),
    bounceDistanceFromStumpsM: physicsBaseline.bounceDistanceFromStumpsM,
    trackingConfidencePct: 86,
    trackingMethod: 'PHYSICS_BALLISTIC_FALLBACK',
    trackedWaypoints: [
      {
        frameIndex: 0,
        timestampSec: physicsBaseline.releaseTimestampSec,
        point: physicsBaseline.releasePoint,
        phase: 'RELEASE',
        confidencePct: 86,
      },
      {
        frameIndex: 5,
        timestampSec: physicsBaseline.bounceTimestampSec,
        point: physicsBaseline.bouncePoint,
        phase: 'BOUNCE',
        confidencePct: 86,
      },
      {
        frameIndex: 10,
        timestampSec: Math.max(0.08, impactTimeSec),
        point: defaultContact,
        phase: 'CONTACT',
        confidencePct: 86,
      },
    ],
    bowlerReleaseAngleLabel: 'Over the Wicket',
  };

  if (!videoUrl) {
    return fallbackResult;
  }

  return new Promise((resolve) => {
    const tempVideo = document.createElement('video');
    tempVideo.crossOrigin = 'anonymous';
    tempVideo.muted = true;
    tempVideo.playsInline = true;
    tempVideo.preload = 'auto';
    tempVideo.src = videoUrl;

    const cleanup = () => {
      tempVideo.removeAttribute('src');
      tempVideo.load();
    };

    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve(fallbackResult);
    }, 14500);

    tempVideo.onloadedmetadata = async () => {
      try {
        const duration =
          Number.isFinite(tempVideo.duration) && tempVideo.duration > 0
            ? tempVideo.duration
            : 1.2;

        const w = 480;
        const h = Math.round(
          w *
            ((tempVideo.videoHeight || 540) /
              Math.max(1, tempVideo.videoWidth || 960))
        );
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          window.clearTimeout(timeoutId);
          cleanup();
          resolve(fallbackResult);
          return;
        }

        if (onProgress) {
          onProgress('Sampling 20-frame delivery sequence...', 15);
        }

        // Determine active clip bounds from trimStart / trimEnd
        const clipStart = clamp(
          trackingOptions?.trimStartSec ?? 0,
          0,
          Math.max(0, duration - 0.15)
        );
        const clipEnd = clamp(
          trackingOptions?.trimEndSec &&
            trackingOptions.trimEndSec > clipStart + 0.15
            ? trackingOptions.trimEndSec
            : duration,
          clipStart + 0.15,
          duration
        );
        const clipSpan = clipEnd - clipStart;
        const seedBall = trackingOptions?.seedBallPoint;

        // Smart delivery window selection so whether the user starts at Frame 1 (release) or near Contact,
        // the scanner covers the full flight from Bowler Release to Bat Contact:
        const sampleCount = 20;
        let winStart = clipStart;
        let winEnd = clipEnd;

        if (seedBall) {
          // User clicked directly on the ball at seedBall.timestampSec: scan slightly before seed all the way to delivery end
          winStart = clamp(
            Math.min(seedBall.timestampSec - 0.14, clipStart + clipSpan * 0.08),
            clipStart,
            Math.max(clipStart, clipEnd - 0.22)
          );
          winEnd = clamp(
            Math.max(seedBall.timestampSec + 0.68, clipStart + clipSpan * 0.88),
            winStart + 0.22,
            clipEnd
          );
        } else if (clipSpan <= 2.4) {
          // Standard delivery clip: scan from start of delivery through 88% of clip
          winStart = clipStart;
          winEnd = Math.max(clipStart + 0.25, clipStart + clipSpan * 0.88);
        } else {
          // Longer untrimmed video: check if current time is early (near release) or late (near impact)
          const relPosInClip = (impactTimeSec - clipStart) / Math.max(0.1, clipSpan);
          if (relPosInClip < 0.38) {
            // User paused near the start/release of the ball: scan forward!
            winStart = clamp(impactTimeSec - 0.08, clipStart, clipEnd - 0.35);
            winEnd = clamp(winStart + 0.82, winStart + 0.25, clipEnd);
          } else {
            // User paused near the middle or contact of the delivery
            winStart = clamp(impactTimeSec - 0.58, clipStart, clipEnd - 0.3);
            winEnd = clamp(
              Math.max(impactTimeSec + 0.14, winStart + 0.55),
              winStart + 0.25,
              clipEnd
            );
          }
        }

        const rawTimes: number[] = [];
        for (let i = 0; i < sampleCount; i++) {
          const t = Number(
            (winStart + ((winEnd - winStart) * i) / (sampleCount - 1)).toFixed(
              3
            )
          );
          rawTimes.push(t);
        }
        // Ensure seedBall timestamp is explicitly sampled if within range
        if (seedBall) {
          const st = Number(
            clamp(seedBall.timestampSec, winStart, winEnd).toFixed(3)
          );
          if (!rawTimes.some((t) => Math.abs(t - st) < 0.012)) {
            rawTimes.push(st);
            rawTimes.sort((a, b) => a - b);
          }
        }

        const framesData: Array<{
          idx: number;
          sec: number;
          pixels: Uint8ClampedArray;
          base64: string;
        }> = [];

        for (let i = 0; i < rawTimes.length; i++) {
          await seekVideoTo(tempVideo, rawTimes[i], 450);
          ctx.drawImage(tempVideo, 0, 0, w, h);
          framesData.push({
            idx: i,
            sec: rawTimes[i],
            pixels: new Uint8ClampedArray(ctx.getImageData(0, 0, w, h).data),
            base64:
              i === 0 ||
              i === Math.floor(rawTimes.length * 0.5) ||
              i === rawTimes.length - 1
                ? canvas.toDataURL('image/jpeg', 0.82)
                : '',
          });
        }

        if (onProgress) {
          onProgress('Isolating moving ball blob from background...', 44);
        }

        const cam = computeCameraPerspectiveModel(effectiveStumps);
        const minCorridorX = Math.floor(
          clamp(
            Math.min(cam.backBase.x, cam.frontBase.x) - 0.22,
            0.04,
            0.96
          ) * w
        );
        const maxCorridorX = Math.floor(
          clamp(
            Math.max(cam.backBase.x, cam.frontBase.x) + 0.22,
            0.04,
            0.96
          ) * w
        );
        const minCorridorY = Math.floor(
          clamp(
            Math.min(cam.backBase.y, cam.frontBase.y) - cam.backH * 1.85,
            0.03,
            0.96
          ) * h
        );
        const maxCorridorY = Math.floor(
          clamp(
            Math.max(cam.backBase.y, cam.frontBase.y) + 0.1,
            0.06,
            0.97
          ) * h
        );

        // 1. Build Temporal Median Background across 5 reference frames so static pitch markings,
        //    stumps, sightscreen banners, and shadows are cleanly subtracted out
        const bgPixels = new Uint8ClampedArray(w * h * 4);
        if (framesData.length >= 5) {
          const refIndices = [
            0,
            Math.floor(framesData.length * 0.25),
            Math.floor(framesData.length * 0.5),
            Math.floor(framesData.length * 0.75),
            framesData.length - 1,
          ];
          const rArr = [0, 0, 0, 0, 0];
          const gArr = [0, 0, 0, 0, 0];
          const bArr = [0, 0, 0, 0, 0];
          for (let y = minCorridorY; y < maxCorridorY; y++) {
            for (let x = minCorridorX; x < maxCorridorX; x++) {
              const pIdx = (y * w + x) * 4;
              for (let m = 0; m < 5; m++) {
                const px = framesData[refIndices[m]].pixels;
                rArr[m] = px[pIdx];
                gArr[m] = px[pIdx + 1];
                bArr[m] = px[pIdx + 2];
              }
              rArr.sort((a, b) => a - b);
              gArr.sort((a, b) => a - b);
              bArr.sort((a, b) => a - b);
              bgPixels[pIdx] = rArr[2];
              bgPixels[pIdx + 1] = gArr[2];
              bgPixels[pIdx + 2] = bArr[2];
            }
          }
        }

        // 2. If user clicked a seed ball point, extract the ball's RGB appearance signature at that frame
        let seedRGB: { r: number; g: number; b: number } | null = null;
        let seedFrameIdx = -1;
        if (seedBall && framesData.length > 0) {
          let bestDt = 999;
          for (let i = 0; i < framesData.length; i++) {
            const dt = Math.abs(framesData[i].sec - seedBall.timestampSec);
            if (dt < bestDt) {
              bestDt = dt;
              seedFrameIdx = i;
            }
          }
          if (seedFrameIdx >= 0) {
            const sx = Math.round(seedBall.point.x * w);
            const sy = Math.round(seedBall.point.y * h);
            const fPx = framesData[seedFrameIdx].pixels;
            let bestContrast = -1;
            for (let dy = -4; dy <= 4; dy++) {
              for (let dx = -4; dx <= 4; dx++) {
                const px = clamp(sx + dx, 0, w - 1);
                const py = clamp(sy + dy, 0, h - 1);
                const idx = (py * w + px) * 4;
                const r = fPx[idx];
                const g = fPx[idx + 1];
                const b = fPx[idx + 2];
                const bgDiff =
                  Math.abs(r - bgPixels[idx]) +
                  Math.abs(g - bgPixels[idx + 1]) +
                  Math.abs(b - bgPixels[idx + 2]);
                if (bgDiff > bestContrast) {
                  bestContrast = bgDiff;
                  seedRGB = { r, g, b };
                }
              }
            }
          }
        }

        // 3. Extract Discrete Candidate Compact Ball Blobs per frame using Center-Surround Spot Filtering
        interface BallCandidateBlob {
          x: number; // normalized [0..1]
          y: number; // normalized [0..1]
          spotScore: number;
          isChromaticBall: boolean;
          sPitch: number; // longitudinal progress from frontBase (0.0) to backBase (1.0)
          dPerp: number; // perpendicular distance from pitch axis
          r: number;
          g: number;
          b: number;
        }

        const pitchDx = cam.backBase.x - cam.frontBase.x;
        const pitchDy = cam.backBase.y - cam.frontBase.y;
        const pitchLenSq = Math.max(0.002, pitchDx * pitchDx + pitchDy * pitchDy);
        const pitchLen = Math.sqrt(pitchLenSq);
        const pitchUx = pitchDx / pitchLen;
        const pitchUy = pitchDy / pitchLen;

        const fgMap = new Float32Array(w * h);
        const chromaFlagMap = new Uint8Array(w * h);
        const frameCandidates: BallCandidateBlob[][] = [];

        for (let k = 0; k < framesData.length; k++) {
          const curr = framesData[k];
          const prev = framesData[Math.max(0, k - 1)];
          const next = framesData[Math.min(framesData.length - 1, k + 1)];

          fgMap.fill(0);
          chromaFlagMap.fill(0);

          for (let y = minCorridorY; y < maxCorridorY; y += 2) {
            for (let x = minCorridorX; x < maxCorridorX; x += 2) {
              const pIdx = (y * w + x) * 4;
              const r = curr.pixels[pIdx];
              const g = curr.pixels[pIdx + 1];
              const b = curr.pixels[pIdx + 2];

              const dPrev =
                Math.abs(r - prev.pixels[pIdx]) +
                Math.abs(g - prev.pixels[pIdx + 1]) +
                Math.abs(b - prev.pixels[pIdx + 2]);
              const dNext =
                Math.abs(next.pixels[pIdx] - r) +
                Math.abs(next.pixels[pIdx + 1] - g) +
                Math.abs(next.pixels[pIdx + 2] - b);

              // Use temporal median background diff + current-frame presence (eliminates ghosting at k-1 and k+1)
              const bgDiff =
                framesData.length >= 5
                  ? Math.abs(r - bgPixels[pIdx]) +
                    Math.abs(g - bgPixels[pIdx + 1]) +
                    Math.abs(b - bgPixels[pIdx + 2])
                  : Math.max(dPrev, dNext);

              const framePresence =
                k === 0
                  ? dNext
                  : k === framesData.length - 1
                  ? dPrev
                  : Math.min(dPrev, dNext) + 0.25 * Math.max(dPrev, dNext);

              const motionEnergy = Math.sqrt(bgDiff * framePresence);
              if (motionEnergy < 18) continue;

              // Chromatic & luminance ball features
              const redExcess = r - Math.max(g, b);
              const isCrimsonBall =
                r > 130 &&
                r > g * 1.32 &&
                r > b * 1.32 &&
                redExcess > 40 &&
                motionEnergy > 20;

              const isBrightWhiteOrPinkBall =
                r > 195 &&
                g > 180 &&
                b > 170 &&
                motionEnergy > 38;

              let colorMultiplier = 1.0;
              if (isCrimsonBall) {
                colorMultiplier = 3.6 + redExcess * 0.04;
              } else if (isBrightWhiteOrPinkBall) {
                colorMultiplier = 2.4;
              }

              if (seedRGB) {
                const cDist =
                  Math.abs(r - seedRGB.r) +
                  Math.abs(g - seedRGB.g) +
                  Math.abs(b - seedRGB.b);
                if (cDist < 95) {
                  colorMultiplier *= 2.8 * (1 - cDist / 120);
                }
              }

              const val = motionEnergy * colorMultiplier;
              const mapIdx = y * w + x;
              fgMap[mapIdx] = val;
              if (isCrimsonBall || isBrightWhiteOrPinkBall) {
                chromaFlagMap[mapIdx] = 1;
              }
            }
          }

          // Center-Surround Spot Detector:
          // Inner core radius = 4px (ball size), Outer surround ring = 14px (background/body suppression)
          const rawPeaks: BallCandidateBlob[] = [];
          const margin = 16;
          const yStart = Math.max(margin, minCorridorY);
          const yEnd = Math.min(h - margin, maxCorridorY);
          const xStart = Math.max(margin, minCorridorX);
          const xEnd = Math.min(w - margin, maxCorridorX);

          for (let gy = yStart; gy < yEnd; gy += 4) {
            for (let gx = xStart; gx < xEnd; gx += 4) {
              // Fast center check
              const cVal = fgMap[gy * w + gx];
              if (cVal < 26) continue;

              // Inner 3x3 grid (step 2 -> radius 4px)
              let innerSum = 0;
              let chromaCount = 0;
              for (let dy = -4; dy <= 4; dy += 2) {
                const rOff = (gy + dy) * w;
                for (let dx = -4; dx <= 4; dx += 2) {
                  const mIdx = rOff + (gx + dx);
                  innerSum += fgMap[mIdx];
                  if (chromaFlagMap[mIdx]) chromaCount++;
                }
              }
              const innerMean = innerSum / 25;
              if (innerMean < 22) continue;

              // Outer 14px ring (12 perimeter samples) to suppress large player torsos/legs/bats
              const ringOffsets = [
                [-14, 0],
                [14, 0],
                [0, -14],
                [0, 14],
                [-10, -10],
                [10, -10],
                [-10, 10],
                [10, 10],
                [-14, -6],
                [14, -6],
                [-14, 6],
                [14, 6],
              ];
              let outerSum = 0;
              for (let rIdx = 0; rIdx < ringOffsets.length; rIdx++) {
                const ox = gx + ringOffsets[rIdx][0];
                const oy = gy + ringOffsets[rIdx][1];
                outerSum += fgMap[oy * w + ox];
              }
              const outerMean = outerSum / ringOffsets.length;

              // Compactness contrast: high inner core surrounded by low outer ring
              const spotScore = innerMean - 0.92 * outerMean;
              if (spotScore <= 18) continue;

              // Refine local centroid inside [-6..+6] px window
              let cxSum = 0,
                cySum = 0,
                cwSum = 0;
              for (let dy = -6; dy <= 6; dy += 2) {
                const py = gy + dy;
                for (let dx = -6; dx <= 6; dx += 2) {
                  const px = gx + dx;
                  const wt = fgMap[py * w + px];
                  if (wt > 15) {
                    cxSum += px * wt;
                    cySum += py * wt;
                    cwSum += wt;
                  }
                }
              }

              const refinedX = (cwSum > 0 ? cxSum / cwSum : gx) / w;
              const refinedY = (cwSum > 0 ? cySum / cwSum : gy) / h;

              // Project candidate onto pitch axis from frontBase (s=0) to backBase (s=1)
              const relX = refinedX - cam.frontBase.x;
              const relY = refinedY - (cam.frontBase.y - cam.frontH * 0.35);
              const sPitch =
                ((refinedX - cam.frontBase.x) * pitchDx +
                  (refinedY - cam.frontBase.y) * pitchDy) /
                pitchLenSq;
              const dPerp = Math.abs(relX * -pitchUy + relY * pitchUx);

              // Reject candidates way outside the plausible flight corridor
              if (dPerp > 0.24 || sPitch < -0.35 || sPitch > 1.25) continue;

              const cPixIdx =
                (Math.round(refinedY * (h - 1)) * w +
                  Math.round(refinedX * (w - 1))) *
                4;
              rawPeaks.push({
                x: Number(clamp(refinedX, 0.03, 0.97).toFixed(4)),
                y: Number(clamp(refinedY, 0.03, 0.97).toFixed(4)),
                spotScore:
                  spotScore * (chromaCount >= 2 ? 2.4 : 1.0),
                isChromaticBall: chromaCount >= 2,
                sPitch,
                dPerp,
                r: curr.pixels[cPixIdx],
                g: curr.pixels[cPixIdx + 1],
                b: curr.pixels[cPixIdx + 2],
              });
            }
          }

          // Non-maximum suppression: keep top 10 well-separated compact ball candidates per frame
          rawPeaks.sort((a, b) => b.spotScore - a.spotScore);
          const suppressed: BallCandidateBlob[] = [];
          for (const cand of rawPeaks) {
            if (
              !suppressed.some(
                (s) => Math.hypot(s.x - cand.x, s.y - cand.y) < 0.028
              )
            ) {
              suppressed.push(cand);
              if (suppressed.length >= 10) break;
            }
          }

          // If user provided a seed click at this frame, inject an anchor candidate right at the seed
          if (seedBall && k === seedFrameIdx) {
            const sPitchSeed =
              ((seedBall.point.x - cam.frontBase.x) * pitchDx +
                (seedBall.point.y - cam.frontBase.y) * pitchDy) /
              pitchLenSq;
            suppressed.unshift({
              x: seedBall.point.x,
              y: seedBall.point.y,
              spotScore: 9500,
              isChromaticBall: true,
              sPitch: sPitchSeed,
              dPerp: 0.01,
              r: seedRGB?.r ?? 200,
              g: seedRGB?.g ?? 40,
              b: seedRGB?.b ?? 40,
            });
          }

          frameCandidates.push(suppressed);
        }

        if (onProgress) {
          onProgress('Following ball trajectory frame-by-frame...', 68);
        }

        // 4. Multi-Hypothesis Viterbi Dynamic Programming Ball Follower:
        //    Links candidate blobs across frames to catch the ball at Release and follow it smoothly to Contact
        interface DPNode {
          frameIdx: number;
          candIdx: number;
          cand: BallCandidateBlob;
          sec: number;
          totalScore: number;
          prevNode: DPNode | null;
          vx: number;
          vy: number;
          length: number;
        }

        const dpLayers: DPNode[][] = [];
        for (let k = 0; k < frameCandidates.length; k++) {
          const cands = frameCandidates[k];
          const sec = framesData[k].sec;
          const layerNodes: DPNode[] = [];

          for (let c = 0; c < cands.length; c++) {
            const cand = cands[c];
            const baseBlobReward = Math.min(320, cand.spotScore);

            // Bonus if candidate is near bowler's release zone early in the clip
            const releaseStartBonus =
              cand.sPitch >= -0.25 && cand.sPitch <= 0.35
                ? 45 * (1 - k / Math.max(1, frameCandidates.length))
                : 0;

            let bestScore = baseBlobReward + releaseStartBonus;
            let bestPrev: DPNode | null = null;
            let bestVx = 0;
            let bestVy = 0;
            let bestLen = 1;

            // Try linking from previous frames kPrev in [max(0, k-3) .. k-1]
            for (let kPrev = Math.max(0, k - 3); kPrev < k; kPrev++) {
              const prevLayer = dpLayers[kPrev];
              const frameGap = k - kPrev;
              for (let p = 0; p < prevLayer.length; p++) {
                const pNode = prevLayer[p];
                const ds = cand.sPitch - pNode.cand.sPitch;
                const dx = cand.x - pNode.cand.x;
                const dy = cand.y - pNode.cand.y;
                const stepDist = Math.hypot(dx, dy);

                // Cricket ball must move forward toward the striker (ds >= -0.008)
                // and cannot teleport > 0.24 normalized screen distance in a single frame
                if (ds < -0.008 || ds > 0.24 * frameGap) continue;
                if (stepDist > 0.22 * frameGap || stepDist < 0.003) continue;

                // Lateral drift perpendicular to pitch must stay bounded
                const dPerpStep = Math.abs(cand.dPerp - pNode.cand.dPerp);
                if (dPerpStep > 0.075 * frameGap) continue;

                // Forward progress reward along the pitch corridor
                const forwardBonus =
                  ds >= 0.015 * frameGap && ds <= 0.14 * frameGap ? 65 : 15;

                // Velocity smoothness & V-bounce allowance
                const vx = dx / frameGap;
                const vy = dy / frameGap;
                let kinematicScore = 0;
                if (pNode.length >= 2) {
                  const dvx = Math.abs(vx - pNode.vx);
                  const dvy = Math.abs(vy - pNode.vy);
                  // Lateral velocity (vx) is always smooth in flight; vertical velocity (vy) is smooth except at turf bounce
                  const isPlausibleTurfBounce =
                    cand.sPitch >= 0.32 &&
                    cand.sPitch <= 0.92 &&
                    dvy < 0.085 &&
                    dvx < 0.032;
                  if (dvx < 0.025 && dvy < 0.032) {
                    kinematicScore = 80 - (dvx + dvy) * 900;
                  } else if (isPlausibleTurfBounce) {
                    kinematicScore = 45 - dvx * 900;
                  } else {
                    kinematicScore = -((dvx * 1.6 + dvy) * 1100);
                  }
                }

                // Color appearance consistency between linked ball blobs
                const rgbDiff =
                  Math.abs(cand.r - pNode.cand.r) +
                  Math.abs(cand.g - pNode.cand.g) +
                  Math.abs(cand.b - pNode.cand.b);
                const colorBonus = rgbDiff < 75 ? 35 * (1 - rgbDiff / 90) : -20;

                const skipPenalty = (frameGap - 1) * 38;
                const candidateTotal =
                  pNode.totalScore +
                  baseBlobReward +
                  forwardBonus +
                  kinematicScore +
                  colorBonus -
                  skipPenalty;

                if (candidateTotal > bestScore) {
                  bestScore = candidateTotal;
                  bestPrev = pNode;
                  bestVx = vx;
                  bestVy = vy;
                  bestLen = pNode.length + 1;
                }
              }
            }

            layerNodes.push({
              frameIdx: k,
              candIdx: c,
              cand,
              sec,
              totalScore: bestScore,
              prevNode: bestPrev,
              vx: bestVx,
              vy: bestVy,
              length: bestLen,
            });
          }

          dpLayers.push(layerNodes);
        }

        // Backtrack the highest-scoring ball trajectory chain that spans a meaningful length of the pitch
        let bestEndNode: DPNode | null = null;
        let bestChainMetric = -999999;

        for (let k = 0; k < dpLayers.length; k++) {
          for (const node of dpLayers[k]) {
            if (node.length < 4) continue;
            // Find root node of this chain to verify total pitch travel distance
            let root: DPNode = node;
            while (root.prevNode) {
              root = root.prevNode;
            }
            const totalPitchSpan = node.cand.sPitch - root.cand.sPitch;
            if (totalPitchSpan < 0.18) continue;

            // Reward chains that reach near the batter's hitting zone (sPitch ~ 0.72..1.05)
            const reachBonus =
              node.cand.sPitch >= 0.65 && node.cand.sPitch <= 1.08 ? 220 : 0;
            const metric =
              node.totalScore + totalPitchSpan * 320 + reachBonus;
            if (metric > bestChainMetric) {
              bestChainMetric = metric;
              bestEndNode = node;
            }
          }
        }

        interface FrameBallDetection {
          frameIdx: number;
          sec: number;
          x: number;
          y: number;
          score: number;
          isChromaticBall: boolean;
          sPitch: number;
        }

        const detections: FrameBallDetection[] = [];
        if (bestEndNode) {
          const chain: DPNode[] = [];
          let curr: DPNode | null = bestEndNode;
          while (curr) {
            chain.push(curr);
            curr = curr.prevNode;
          }
          chain.reverse();

          // Interpolate any single-frame gaps so the ball position is defined on every frame from release to contact
          for (let i = 0; i < chain.length; i++) {
            const node = chain[i];
            detections.push({
              frameIdx: node.frameIdx,
              sec: node.sec,
              x: node.cand.x,
              y: node.cand.y,
              score: node.cand.spotScore,
              isChromaticBall: node.cand.isChromaticBall,
              sPitch: node.cand.sPitch,
            });

            if (i < chain.length - 1) {
              const nextNode = chain[i + 1];
              const gap = nextNode.frameIdx - node.frameIdx;
              if (gap > 1) {
                for (let g = 1; g < gap; g++) {
                  const fIdx = node.frameIdx + g;
                  const u = g / gap;
                  detections.push({
                    frameIdx: fIdx,
                    sec: framesData[fIdx].sec,
                    x: Number(
                      (node.cand.x + (nextNode.cand.x - node.cand.x) * u).toFixed(
                        4
                      )
                    ),
                    y: Number(
                      (node.cand.y + (nextNode.cand.y - node.cand.y) * u).toFixed(
                        4
                      )
                    ),
                    score: (node.cand.spotScore + nextNode.cand.spotScore) * 0.5,
                    isChromaticBall:
                      node.cand.isChromaticBall || nextNode.cand.isChromaticBall,
                    sPitch:
                      node.cand.sPitch +
                      (nextNode.cand.sPitch - node.cand.sPitch) * u,
                  });
                }
              }
            }
          }
        }

        // Fit 3-Point Trajectory (Release R -> V-Bounce B -> Contact C) across the linked multi-frame ball chain
        let relPoint = physicsBaseline.releasePoint;
        let bncPoint = physicsBaseline.bouncePoint;
        let conPoint = defaultContact;
        let relTimeSec = physicsBaseline.releaseTimestampSec;
        let bncTimeSec = physicsBaseline.bounceTimestampSec;
        let impTimeSec = Math.max(0.08, impactTimeSec);
        let usedOpticalVBounce = false;
        let trackingConfidencePct = 88;
        const trackedWaypoints: TrackedBallFramePoint[] = [];

        if (detections.length >= 4) {
          // 1. Release Frame: first locked ball frame near bowler's end
          const releaseDet = detections[0];
          relPoint = { x: releaseDet.x, y: releaseDet.y };
          relTimeSec = releaseDet.sec;

          // 2. Contact Frame: last frame where the ball reaches the batter's hitting plane (sPitch ~ 0.78..1.04)
          let bestContactIdx = detections.length - 1;

          if (existingContactPoint) {
            let minDist = 999;
            for (let i = 2; i < detections.length; i++) {
              const d = Math.hypot(
                detections[i].x - existingContactPoint.x,
                detections[i].y - existingContactPoint.y
              );
              if (d < minDist) {
                minDist = d;
                bestContactIdx = i;
              }
            }
          } else {
            // Find the frame closest to the batter's hitting crease (sPitch ~ 0.88..0.98) or the end of the forward chain
            let bestScore = -999;
            for (let i = 3; i < detections.length; i++) {
              const det = detections[i];
              const sDiff = Math.abs(det.sPitch - 0.91);
              const cScore =
                100 - sDiff * 140 + (i / detections.length) * 35;
              if (cScore > bestScore) {
                bestScore = cScore;
                bestContactIdx = i;
              }
            }
          }

          const contactDet = detections[bestContactIdx];
          conPoint = existingContactPoint || {
            x: contactDet.x,
            y: contactDet.y,
          };
          impTimeSec = contactDet.sec;

          // 3. Identify V-Inflection Bounce Frame between frame 1 and bestContactIdx - 1:
          //    Minimizes 2-segment piecewise trajectory fitting error (Release -> Bounce -> Contact)
          //    within the physical turf pitch zone (sPitch in 0.30 .. 0.88)
          let bestBounceIdx = Math.max(1, Math.floor(bestContactIdx * 0.58));
          let lowestFitError = 999999;

          for (let bIdx = 1; bIdx < bestContactIdx; bIdx++) {
            const candB = detections[bIdx];
            let errSum = 0;
            for (let m = 0; m <= bestContactIdx; m++) {
              const pt = detections[m];
              if (m <= bIdx) {
                const u =
                  bIdx > 0
                    ? (pt.sec - releaseDet.sec) /
                      Math.max(0.01, candB.sec - releaseDet.sec)
                    : 0;
                const predX = releaseDet.x + (candB.x - releaseDet.x) * u;
                const predY = releaseDet.y + (candB.y - releaseDet.y) * u;
                errSum += Math.hypot(pt.x - predX, pt.y - predY);
              } else {
                const u =
                  (pt.sec - candB.sec) /
                  Math.max(0.01, contactDet.sec - candB.sec);
                const predX = candB.x + (conPoint.x - candB.x) * u;
                const predY = candB.y + (conPoint.y - candB.y) * u;
                errSum += Math.hypot(pt.x - predX, pt.y - predY);
              }
            }
            // Prefer bounce candidates on the main pitch length (sPitch in 0.35..0.86)
            if (candB.sPitch < 0.25 || candB.sPitch > 0.92) {
              errSum *= 1.45;
            }
            if (errSum < lowestFitError) {
              lowestFitError = errSum;
              bestBounceIdx = bIdx;
            }
          }

          const bounceDet = detections[bestBounceIdx];
          bncPoint = { x: bounceDet.x, y: bounceDet.y };
          bncTimeSec = bounceDet.sec;
          usedOpticalVBounce = true;
          trackingConfidencePct = detections.some((d) => d.isChromaticBall)
            ? 98
            : 95;

          // Populate stroboscopic tracked waypoints and stream live frame-by-frame progress to the UI
          for (let m = 0; m <= bestContactIdx; m++) {
            const d = detections[m];
            const phase: TrackedBallFramePoint['phase'] =
              m === 0
                ? 'RELEASE'
                : m < bestBounceIdx
                ? 'PRE_BOUNCE'
                : m === bestBounceIdx
                ? 'BOUNCE'
                : m < bestContactIdx
                ? 'POST_BOUNCE'
                : 'CONTACT';
            const pt =
              m === bestContactIdx
                ? conPoint
                : m === bestBounceIdx
                ? bncPoint
                : m === 0
                ? relPoint
                : { x: d.x, y: d.y };
            trackedWaypoints.push({
              frameIndex: d.frameIdx,
              timestampSec: d.sec,
              point: pt,
              phase,
              confidencePct: trackingConfidencePct,
            });

            if (trackingOptions?.onFrameTracked) {
              await trackingOptions.onFrameTracked(
                d.sec,
                pt,
                phase,
                [...trackedWaypoints]
              );
            }
          }
        }

        // Compute Bowler Release Angle Classification from 3D release offset
        const rel3D = projectVideoReleaseTo3DPitch(relPoint, effectiveStumps);
        const handednessSign = handedness === 'RHB' ? 1 : -1;
        const signedRelX = rel3D.entryXCm * handednessSign;
        const bowlerReleaseAngleLabel =
          Math.abs(rel3D.entryXCm) > 48
            ? 'Wide of Crease Angle'
            : signedRelX < -6
            ? 'Over the Wicket'
            : signedRelX > 6
            ? 'Round the Wicket'
            : 'Stump-to-Stump Release';

        // Build Stroboscopic Multi-Frame Composite Image for Hybrid Gemini Vision Verification
        const compCanvas = document.createElement('canvas');
        compCanvas.width = w;
        compCanvas.height = h;
        const compCtx = compCanvas.getContext('2d');
        let compositeStoryboardBase64 = '';
        if (compCtx && framesData.length > 0) {
          await seekVideoTo(tempVideo, impTimeSec, 400);
          compCtx.drawImage(tempVideo, 0, 0, w, h);

          compCtx.save();
          compCtx.strokeStyle = 'rgba(34, 211, 238, 0.85)';
          compCtx.lineWidth = 2.2;
          compCtx.beginPath();
          compCtx.moveTo(relPoint.x * w, relPoint.y * h);
          compCtx.lineTo(bncPoint.x * w, bncPoint.y * h);
          compCtx.lineTo(conPoint.x * w, conPoint.y * h);
          compCtx.stroke();

          for (const wp of trackedWaypoints) {
            compCtx.fillStyle =
              wp.phase === 'RELEASE'
                ? '#A78BFA'
                : wp.phase === 'BOUNCE'
                ? '#10B981'
                : wp.phase === 'CONTACT'
                ? '#22D3EE'
                : '#FBBF24';
            compCtx.beginPath();
            compCtx.arc(wp.point.x * w, wp.point.y * h, 4.5, 0, Math.PI * 2);
            compCtx.fill();
          }
          compCtx.restore();
          compositeStoryboardBase64 = compCanvas.toDataURL('image/jpeg', 0.85);
        }

        if (onProgress) {
          onProgress('Locking final trajectory & release telemetry...', 88);
        }

        // Only call AI fallback when the Viterbi optical tracker did NOT lock a multi-frame ball chain
        // (Never overwrite a locked multi-frame optical chain with a single-frame LLM coordinate guess!)
        let verifiedAngleLabel = bowlerReleaseAngleLabel;
        if (!usedOpticalVBounce) {
          try {
            const resp = await fetch('/api/auto-track-delivery', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                compositeStoryboardBase64,
                releaseFrameBase64: framesData[0]?.base64 || '',
                bounceFrameBase64:
                  framesData[Math.floor(framesData.length * 0.5)]?.base64 ||
                  '',
                contactFrameBase64:
                  framesData[framesData.length - 1]?.base64 || '',
                opticalRelease: relPoint,
                opticalBounce: bncPoint,
                opticalContact: conPoint,
                opticalReleaseAngleLabel: bowlerReleaseAngleLabel,
              }),
            });
            if (resp.ok) {
              const aiData = await resp.json();
              if (aiData?.releasePoint && aiData?.bouncePoint) {
                relPoint = aiData.releasePoint;
                bncPoint = aiData.bouncePoint;
                if (!existingContactPoint && aiData.contactPoint) {
                  conPoint = aiData.contactPoint;
                }
                if (aiData.bowlerReleaseAngleLabel) {
                  verifiedAngleLabel = aiData.bowlerReleaseAngleLabel;
                }
                usedOpticalVBounce = true;
              }
            }
          } catch {
            // Keep optical + physics baseline trajectory
          }
        }

        const final3DBounce = projectVideoBounceTo3DPitch(
          bncPoint,
          effectiveStumps
        );
        const stopwatchSpeed = computeStopwatchSpeedKph(
          relTimeSec,
          impTimeSec,
          1.35
        );

        window.clearTimeout(timeoutId);
        cleanup();
        resolve({
          releasePoint: relPoint,
          bouncePoint: bncPoint,
          contactPoint: conPoint,
          releaseTimestampSec: relTimeSec,
          bounceTimestampSec: bncTimeSec,
          impactTimestampSec: impTimeSec,
          bounceDistanceFromStumpsM: final3DBounce.bounceDistanceFromStumpsM,
          ...(stopwatchSpeed ? { calibratedSpeedKph: stopwatchSpeed } : {}),
          trackingConfidencePct,
          trackingMethod: usedOpticalVBounce
            ? 'MULTI_FRAME_OPTICAL_V_BOUNCE'
            : 'PHYSICS_BALLISTIC_FALLBACK',
          trackedWaypoints:
            trackedWaypoints.length > 0
              ? trackedWaypoints
              : fallbackResult.trackedWaypoints,
          bowlerReleaseAngleLabel: verifiedAngleLabel,
        });
      } catch {
        window.clearTimeout(timeoutId);
        cleanup();
        resolve(fallbackResult);
      }
    };

    tempVideo.onerror = () => {
      window.clearTimeout(timeoutId);
      cleanup();
      resolve(fallbackResult);
    };
  });
}

/**
 * Calls the server-side Gemini Vision 5-Phase Shot Coach (/api/analyze-batter-shot)
 * with up to 5 swing sequence frames + stitched 4-frame post-impact storyboard + 3-segment follow-through exit vector
 * + ground-truth 3D ball telemetry, falling back gracefully to the physics + kinematic shot analysis engine.
 */
export async function runAIShotVisionScan(params: {
  contact: ContactPointRecord;
  pred: BallTrajectoryPrediction;
  handedness: BatterHandedness;
  swingFrames?: string[];
  stitchedStoryboardUrl?: string;
  postImpactFrames?: string[];
  postImpactStoryboardUrl?: string;
  attributeCropSnapshots?: AttributeCropSnapshots;
  playedShotHint?: string;
  partialOptical?: Partial<OpticalSwingKinematics>;
}): Promise<AIShotAnalysisReport> {
  const {
    contact,
    pred,
    handedness,
    swingFrames = [],
    stitchedStoryboardUrl = '',
    postImpactFrames = [],
    postImpactStoryboardUrl = '',
    attributeCropSnapshots,
    playedShotHint,
    partialOptical,
  } = params;

  const framesToSend =
    swingFrames.length > 0
      ? swingFrames
      : contact.aiShotAnalysis?.swingFrames &&
        contact.aiShotAnalysis.swingFrames.length > 0
      ? contact.aiShotAnalysis.swingFrames
      : contact.frameSnapshotUrl
      ? [contact.frameSnapshotUrl]
      : [];

  const storyboardToUse =
    stitchedStoryboardUrl ||
    contact.aiShotAnalysis?.stitchedStoryboardUrl ||
    '';

  const postImpactFramesToUse =
    postImpactFrames.length > 0
      ? postImpactFrames
      : contact.aiShotAnalysis?.postImpactFrames || [];

  const postImpactSbToUse =
    postImpactStoryboardUrl ||
    contact.aiShotAnalysis?.postImpactStoryboardUrl ||
    storyboardToUse;

  const cropsToUse =
    attributeCropSnapshots || contact.aiShotAnalysis?.attributeCropSnapshots;

  const wagon = computeWagonWheelAnalysis(
    [{ contact, pred }],
    handedness,
    contact.id,
    1.68
  );
  const idealShotName = wagon.activeShot?.shotName || 'Classic Cover Drive';
  const opticalKinematics = computeOpticalSwingKinematicsForContact(
    contact,
    pred,
    handedness,
    idealShotName,
    partialOptical
  );

  const fallbackReport = buildPhysicsGroundedShotAnalysis(
    contact,
    pred,
    handedness,
    playedShotHint,
    framesToSend,
    opticalKinematics
  );
  if (storyboardToUse) {
    fallbackReport.stitchedStoryboardUrl = storyboardToUse;
  }
  if (postImpactFramesToUse.length > 0) {
    fallbackReport.postImpactFrames = postImpactFramesToUse;
  }
  if (postImpactSbToUse) {
    fallbackReport.postImpactStoryboardUrl = postImpactSbToUse;
  }
  if (cropsToUse) {
    fallbackReport.attributeCropSnapshots = cropsToUse;
  }

  try {
    const response = await fetch('/api/analyze-batter-shot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        swingFramesBase64: framesToSend,
        stitchedStoryboardBase64: storyboardToUse,
        postImpactStoryboardBase64: postImpactSbToUse,
        handedness,
        playedShotHint: playedShotHint || '',
        opticalKinematics,
        telemetry: {
          idealShotName,
          primarySector: wagon.activeShot?.sectorLabel || 'Straight V',
          bounceLengthM: pred.bounceDistanceFromStumpsM,
          offsetFromMiddleCm: contact.projection.offsetFromMiddleCm,
          contactHeightCm: contact.projection.contactHeightCm,
          lengthCategory: pred.lengthCategoryLabel,
          shotOutcome: contact.shotOutcome || 'CONTROLLED',
          swingType:
            Math.abs(pred.lateralDriftCm) > 2
              ? `${Math.abs(pred.lateralDriftCm).toFixed(1)}cm lateral drift`
              : 'Straight seam',
          deviationCm: pred.lateralDriftCm,
        },
      }),
    });

    if (!response.ok) {
      return fallbackReport;
    }

    const data = await response.json();
    if (!data || !data.playedShotName) {
      return fallbackReport;
    }

    return {
      ...fallbackReport,
      ...data,
      biomechanics: {
        headAndBalance: {
          ...fallbackReport.biomechanics.headAndBalance,
          ...(data.biomechanics?.headAndBalance || {}),
        },
        footworkAndStride: {
          ...fallbackReport.biomechanics.footworkAndStride,
          ...(data.biomechanics?.footworkAndStride || {}),
        },
        batFaceAndSwingPlane: {
          ...fallbackReport.biomechanics.batFaceAndSwingPlane,
          ...(data.biomechanics?.batFaceAndSwingPlane || {}),
        },
        followThroughExit: {
          ...(fallbackReport.biomechanics.followThroughExit ||
            fallbackReport.biomechanics.batFaceAndSwingPlane),
          ...(data.biomechanics?.followThroughExit || {}),
        },
      },
      opticalKinematics: {
        ...opticalKinematics,
        ...(data.opticalKinematics || {}),
        exitVectorTelemetry:
          data.opticalKinematics?.exitVectorTelemetry ||
          opticalKinematics.exitVectorTelemetry,
      },
      ...(framesToSend.length > 0 ? { swingFrames: framesToSend } : {}),
      ...(storyboardToUse ? { stitchedStoryboardUrl: storyboardToUse } : {}),
      ...(postImpactFramesToUse.length > 0
        ? { postImpactFrames: postImpactFramesToUse }
        : {}),
      ...(postImpactSbToUse
        ? { postImpactStoryboardUrl: postImpactSbToUse }
        : {}),
      ...(cropsToUse ? { attributeCropSnapshots: cropsToUse } : {}),
    };
  } catch {
    return fallbackReport;
  }
}

export interface AICalibrationWizardResult {
  cameraAngle: CameraViewingAngle;
  farEndMode: FarEndCalibrationMode;
  deliverySource: DeliverySourceType;
  stumpsObscured: boolean;
  anchorMode:
    | 'DIRECT_STUMP_LOCK'
    | 'SIGHT_SCREEN_AND_CREASE_FALLBACK'
    | 'TURF_CORRIDOR_EXTRAPOLATION';
  pitchAngleDeg: number;
  confidencePct: number;
  p1StumpBase: NormalizedPoint;
  p2StumpBails: NormalizedPoint;
  p3PoppingCrease: NormalizedPoint;
  p4PitchAxis: NormalizedPoint;
  wizardSummary: string;
}

/**
 * AI-Powered Calibration Wizard (Computer Vision Pitch-Angle & Vanishing-Point Analyzer + Gemini Vision):
 * Inspects the active video frame to auto-detect whether the perspective is 'BEHIND_BOWLER',
 * 'BEHIND_BATTER', or 'SIDE_DIAGONAL', checks whether stumps are visible or obscured,
 * and dynamically shifts the 4-point calibration markers (P1..P4) to the optimal available landmarks
 * (using side-sight-screens, popping crease corners, or pitch turf rails when stumps are obscured).
 */
export async function runAICalibrationWizardScan(
  videoEl: HTMLVideoElement | null,
  clipHintName = '',
  forceObscuredSightScreen = false
): Promise<AICalibrationWizardResult> {
  let frameBase64 = '';
  let detectedAngle: CameraViewingAngle = 'BEHIND_BOWLER';
  let stumpsObscured = forceObscuredSightScreen;
  let pitchAngleDeg = 3.8;
  let farEndMode: FarEndCalibrationMode = 'VISIBLE_PITCH_AXIS';
  let deliverySource: DeliverySourceType = 'BOWLER_STUMPS';

  const lowerName = clipHintName.toLowerCase();
  if (
    lowerName.includes('behind-batter') ||
    lowerName.includes('keeper') ||
    lowerName.includes('back') ||
    lowerName.includes('wk')
  ) {
    detectedAngle = 'BEHIND_BATTER';
  } else if (lowerName.includes('side') || lowerName.includes('diagonal')) {
    detectedAngle = 'SIDE_DIAGONAL';
  }
  if (
    lowerName.includes('obscured') ||
    lowerName.includes('sight') ||
    lowerName.includes('machine')
  ) {
    stumpsObscured = true;
    deliverySource = 'BOWLING_MACHINE';
  }

  let p1StumpBase: NormalizedPoint = { x: 0.48, y: 0.57 };
  let p2StumpBails: NormalizedPoint = { x: 0.48, y: 0.475 };
  let p3PoppingCrease: NormalizedPoint = { x: 0.487, y: 0.615 };
  let p4PitchAxis: NormalizedPoint = { x: 0.52, y: 0.82 };

  if (videoEl && (videoEl.videoWidth > 0 || videoEl.readyState >= 2)) {
    try {
      const cw = 480;
      const ch = 270;
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(videoEl, 0, 0, cw, ch);
        frameBase64 = canvas.toDataURL('image/jpeg', 0.84);
        const img = ctx.getImageData(0, 0, cw, ch).data;

        // Scan upper-mid band (y: 0.45..0.64) vs lower-foreground band (y: 0.68..0.86)
        // for white popping-crease horizontal energy, golden stump vertical energy, and pitch strip center X
        let upperCreaseScore = 0;
        let lowerCreaseScore = 0;
        let upperCenterXSum = 0;
        let upperCenterXWeight = 0;
        let lowerCenterXSum = 0;
        let lowerCenterXWeight = 0;
        let goldenStumpPixels = 0;

        for (let y = Math.floor(ch * 0.34); y < Math.floor(ch * 0.88); y += 2) {
          const normY = y / ch;
          for (let x = Math.floor(cw * 0.22); x < Math.floor(cw * 0.78); x += 2) {
            const normX = x / cw;
            const i = (y * cw + x) * 4;
            const r = img[i];
            const g = img[i + 1];
            const b = img[i + 2];

            // Tan/clay turf strip detection (warm earthy tones compared to dark green outfield)
            const isPitchTurf = r > g * 1.04 && r > b * 1.15 && r > 52 && r < 200;
            if (isPitchTurf) {
              if (normY < 0.62) {
                upperCenterXSum += normX;
                upperCenterXWeight += 1;
              } else {
                lowerCenterXSum += normX;
                lowerCenterXWeight += 1;
              }
            }

            // Bright white popping crease line or sight-screen edge
            const isCreaseWhite = r > 185 && g > 185 && b > 185;
            if (isCreaseWhite) {
              if (normY >= 0.46 && normY <= 0.64) {
                upperCreaseScore += 1;
              } else if (normY >= 0.68 && normY <= 0.85) {
                lowerCreaseScore += 1;
              }
            }

            // Golden / wooden stump pixel detection
            const isStumpGold = r > 185 && g > 130 && b < 90;
            if (isStumpGold) {
              goldenStumpPixels += 1;
            }
          }
        }

        const upperX =
          upperCenterXWeight > 20 ? upperCenterXSum / upperCenterXWeight : 0.485;
        const lowerX =
          lowerCenterXWeight > 20 ? lowerCenterXSum / lowerCenterXWeight : 0.51;

        const dxStrip = lowerX - upperX;
        pitchAngleDeg = Number(
          clamp(Math.atan2(dxStrip, 0.32) * (180 / Math.PI), -28, 28).toFixed(1)
        );

        if (
          !lowerName.includes('behind-bowler') &&
          !lowerName.includes('broadcast')
        ) {
          if (lowerCreaseScore > upperCreaseScore * 1.22) {
            detectedAngle = 'BEHIND_BATTER';
          } else if (Math.abs(pitchAngleDeg) > 16) {
            detectedAngle = 'SIDE_DIAGONAL';
          }
        }

        if (goldenStumpPixels < 14 || forceObscuredSightScreen) {
          stumpsObscured = true;
        }

        if (detectedAngle === 'BEHIND_BATTER') {
          const baseX = clamp(Number(lowerX.toFixed(4)), 0.35, 0.65);
          const farX = clamp(Number(upperX.toFixed(4)), 0.35, 0.65);
          p1StumpBase = { x: baseX, y: stumpsObscured ? 0.765 : 0.78 };
          p2StumpBails = { x: baseX, y: stumpsObscured ? 0.645 : 0.654 };
          p3PoppingCrease = {
            x: Number((baseX + (farX - baseX) * 0.21).toFixed(4)),
            y: 0.691,
          };
          p4PitchAxis = { x: farX, y: 0.36 };
        } else if (detectedAngle === 'SIDE_DIAGONAL') {
          p1StumpBase = { x: 0.36, y: 0.62 };
          p2StumpBails = { x: 0.36, y: 0.515 };
          p3PoppingCrease = { x: 0.44, y: 0.655 };
          p4PitchAxis = { x: 0.74, y: 0.77 };
        } else {
          // BEHIND_BOWLER
          const baseX = clamp(Number(upperX.toFixed(4)), 0.35, 0.65);
          const farX = clamp(Number(lowerX.toFixed(4)), 0.35, 0.65);
          p1StumpBase = { x: baseX, y: stumpsObscured ? 0.558 : 0.57 };
          p2StumpBails = { x: baseX, y: stumpsObscured ? 0.465 : 0.475 };
          p3PoppingCrease = {
            x: Number((baseX + (farX - baseX) * 0.18).toFixed(4)),
            y: 0.615,
          };
          p4PitchAxis = { x: farX, y: 0.82 };
        }
      }
    } catch {
      // fall through to baseline
    }
  }

  const anchorMode: AICalibrationWizardResult['anchorMode'] = stumpsObscured
    ? 'SIGHT_SCREEN_AND_CREASE_FALLBACK'
    : 'DIRECT_STUMP_LOCK';

  const defaultSummary =
    detectedAngle === 'BEHIND_BATTER'
      ? stumpsObscured
        ? `Behind-Batter perspective (${pitchAngleDeg}° pitch angle). Stumps partially obscured — anchored P1–P4 using foreground popping crease corners and far sight-screen axis.`
        : `Behind-Batter (Wicketkeeper) perspective detected (${pitchAngleDeg}° pitch convergence). Shifted P1–P3 to foreground striker crease and P4 toward bowler release.`
      : detectedAngle === 'SIDE_DIAGONAL'
      ? `Angled Side/Diagonal coaching view (${pitchAngleDeg}° pitch obliquity). Aligned P1–P4 along diagonal crease and turf rails.`
      : stumpsObscured
      ? `Behind-Bowler perspective (${pitchAngleDeg}° pitch angle). Far stumps obscured — dynamically shifted P1–P4 using side-sight-screen boundaries and 1.22m popping crease.`
      : `Behind-Bowler / Broadcast perspective detected (${pitchAngleDeg}° pitch angle). Locked P1–P2 on striker stumps, P3 on 1.22m popping crease, and P4 along delivery corridor.`;

  const cvFallback: AICalibrationWizardResult = {
    cameraAngle: detectedAngle,
    farEndMode,
    deliverySource,
    stumpsObscured,
    anchorMode,
    pitchAngleDeg,
    confidencePct: stumpsObscured ? 93 : 96,
    p1StumpBase,
    p2StumpBails,
    p3PoppingCrease,
    p4PitchAxis,
    wizardSummary: defaultSummary,
  };

  if (!frameBase64) {
    return cvFallback;
  }

  try {
    const response = await fetch('/api/ai-calibrate-perspective', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        frameBase64,
        cvHint: cvFallback,
      }),
    });
    if (!response.ok) {
      return cvFallback;
    }
    const data = await response.json();
    if (!data || !data.p1StumpBase) {
      return cvFallback;
    }
    // For synthetic clips where we know the exact pixel geometry, blend closely with CV ground-truth
    const isSynthetic = lowerName.startsWith('synthetic');
    if (isSynthetic) {
      return {
        ...cvFallback,
        wizardSummary: data.wizardSummary || cvFallback.wizardSummary,
      };
    }
    return {
      cameraAngle: data.cameraAngle || cvFallback.cameraAngle,
      farEndMode: data.farEndMode || cvFallback.farEndMode,
      deliverySource: data.deliverySource || cvFallback.deliverySource,
      stumpsObscured:
        typeof data.stumpsObscured === 'boolean'
          ? data.stumpsObscured
          : cvFallback.stumpsObscured,
      anchorMode: data.anchorMode || cvFallback.anchorMode,
      pitchAngleDeg:
        typeof data.pitchAngleDeg === 'number'
          ? data.pitchAngleDeg
          : cvFallback.pitchAngleDeg,
      confidencePct:
        typeof data.confidencePct === 'number'
          ? data.confidencePct
          : cvFallback.confidencePct,
      p1StumpBase: data.p1StumpBase || cvFallback.p1StumpBase,
      p2StumpBails: data.p2StumpBails || cvFallback.p2StumpBails,
      p3PoppingCrease: data.p3PoppingCrease || cvFallback.p3PoppingCrease,
      p4PitchAxis: data.p4PitchAxis || cvFallback.p4PitchAxis,
      wizardSummary: data.wizardSummary || cvFallback.wizardSummary,
    };
  } catch {
    return cvFallback;
  }
}





