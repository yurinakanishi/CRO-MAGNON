import {
  normalizeHands,
  measurePush,
  type Hand,
  type HandPair,
  type HandSample,
  type Fingers,
} from './motion-hands.js';
import { MotionHandActions, MotionJump, type MotionAction } from './motion-actions.js';
export type { MotionAction } from './motion-actions.js';
export type { Hand, Point } from './motion-hands.js';
export type MotionState =
  'OFF' | 'STARTING' | 'CALIBRATING' | 'READY' | 'ACTIVE' | 'RECOVERING' | 'PAUSED' | 'ERROR';
export interface MotionFrame {
  sessionId: number;
  frameId: number;
  sampledAtMainMs: number;
  width: number;
  height: number;
  hands: HandPair | null;
}
export interface MotionIntent {
  active: boolean;
  forward: number;
  turn: number;
  sessionId: number;
  sampledAtMainMs: number;
}
export interface MotionActionEvent {
  sessionId: number;
  eventId: number;
  action: MotionAction;
  sampledAtMainMs: number;
  emittedAtMainMs: number;
}
export interface Offset {
  x: number;
  y: number;
}
interface HandsSample {
  left: HandSample | null;
  right: HandSample | null;
}
interface Calibration {
  left: HandSample | null;
  right: HandSample | null;
  scale: number;
}
export const MOTION = Object.freeze({
  staleMs: 230,
  calibrationMs: 1400,
  calibrationPositionStability: 0.04,
  freshMs: 250,
  pushEnter: 0.12,
  pushExit: 0.06,
  pullEnter: 0.18,
  pullExit: 0.14,
  pushRange: 0.45,
  pullRange: 0.3,
  pushDwellMs: 90,
  pushCalibrationStability: 0.12,
  // Natural pushing also moves the palm slightly sideways along the arm's arc.
  turnEnter: 0.55,
  turnExit: 0.35,
  turnRange: 1.3,
  reacquireMs: 120,
  smoothingMs: 65,
  downStop: 0.42,
  edgeMargin: 0.06,
});
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const angle = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
function axis(value: number, previous: number, enter: number, exit: number, range: number) {
  return Math.abs(value) > (previous * value > 0 ? exit : enter)
    ? Math.sign(value) * clamp((Math.abs(value) - exit) / (range - exit), 0, 1)
    : 0;
}
function palmBoundary(hand: HandPair[Hand] | undefined) {
  if (!hand) return 'missing';
  if (
    hand.landmarks.length !== 21 ||
    !Number.isFinite(hand.handednessScore) ||
    hand.handednessScore < 0.55
  )
    return 'invalid';
  const palm = [0, 5, 9, 13, 17].map((i) => hand.landmarks[i]);
  if (!palm.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))) return 'invalid';
  if (palm.some((p) => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return 'clipped';
  return palm.some(
    (p) =>
      p.x <= MOTION.edgeMargin ||
      p.x >= 1 - MOTION.edgeMargin ||
      p.y <= MOTION.edgeMargin ||
      p.y >= 1 - MOTION.edgeMargin,
  )
    ? 'edge'
    : 'center';
}
export class MotionInputAdapter {
  state: MotionState = 'OFF';
  sessionId = 0;
  movementHand: Hand = 'left';
  singleHand = false;
  autoHand = false;
  reason = '';
  calibrationProgress = 0;
  calibrationStage: 'recognize' | 'neutral' = 'recognize';
  actionProgress = 0;
  trackingLosses = 0;
  briefInterruptions = 0;
  edgeHolding = false;
  candidate: MotionAction | null = null;
  movementOffset: Offset | null = null;
  movementPush: number | null = null;
  movementRoll: number | null = null;
  palmRatio: number | null = null;
  fingerRatio: number | null = null;
  actionOffset: Offset | null = null;
  actionFingers: Fingers | null = null;
  calibration: Calibration | null = null;
  private samples: { at: number; value: HandsSample }[] = [];
  private neutralAfter = 0;
  private previous: HandsSample | null = null;
  private lastFrame = -1;
  private lastSample = -Infinity;
  private freshAt: number | null = null;
  private actions = new MotionHandActions();
  private jump = new MotionJump();
  private actionSeen = false;
  private movementArmed = false;
  private movementAtEdge = false;
  private reacquireAt: number | null = null;
  private reacquireSample: { x: number; y: number; push: number } | null = null;
  private pushSamples: number[] = [];
  private turnSamples: number[] = [];
  private pushAt: number | null = null;
  private pushDirection = 0;
  private eventId = 0;
  private events: MotionActionEvent[] = [];
  private intent: MotionIntent = this.zero();
  private smoothed = { forward: 0, turn: 0 };
  private readAt: number | null = null;
  private singleAction = false;
  private singleRestAt: number | null = null;
  private autoCandidate: Hand | null = null;
  get detectedHand(): Hand | null {
    if (!this.singleHand) return null;
    if (!this.autoHand || this.calibration) return this.movementHand;
    return this.calibrationStage === 'neutral' ? this.autoCandidate : null;
  }
  get actionHand(): Hand {
    return this.singleHand ? this.movementHand : this.movementHand === 'left' ? 'right' : 'left';
  }
  get requiredHands(): Hand[] {
    return this.singleHand ? [this.movementHand] : ['left', 'right'];
  }
  get handsLabel() {
    if (this.singleHand && this.autoHand && !this.detectedHand) return '片手';
    return this.singleHand ? (this.movementHand === 'left' ? '左手' : '右手') : '両手';
  }
  get returningFromAction() {
    return this.singleHand && this.singleAction;
  }
  get actionReady() {
    return this.actions.attackReady;
  }
  get actionHint() {
    return this.actions.hint;
  }
  get forward() {
    return this.state === 'ACTIVE' ? this.intent.forward : 0;
  }
  get turn() {
    return this.state === 'ACTIVE' ? this.intent.turn : 0;
  }
  get actionPose() {
    return this.actions.pose;
  }
  get ownsInput() {
    return this.state !== 'OFF' && this.state !== 'ERROR';
  }
  private zero(): MotionIntent {
    return {
      active: false,
      forward: 0,
      turn: 0,
      sessionId: this.sessionId,
      sampledAtMainMs: this.lastSample,
    };
  }
  private clearMovement() {
    this.intent = { ...this.intent, forward: 0, turn: 0 };
    this.movementOffset = null;
    this.movementPush = this.movementRoll = null;
    this.palmRatio = this.fingerRatio = null;
    this.pushSamples = this.turnSamples = [];
    this.pushAt = null;
    this.pushDirection = 0;
    this.movementArmed = false;
    this.movementAtEdge = false;
    this.edgeHolding = false;
    this.reacquireAt = null;
    this.reacquireSample = null;
    this.smoothed = { forward: 0, turn: 0 };
    this.readAt = null;
  }
  private interrupt() {
    this.clearMovement();
    this.singleAction = false;
    this.singleRestAt = null;
    this.intent = this.zero();
    this.jump.loseTracking();
    this.actions.loseTracking();
    this.actionSeen = false;
    this.events = [];
    this.previous = null;
    this.freshAt = null;
    this.candidate = null;
    this.actionProgress = 0;
    this.actionOffset = null;
    this.actionFingers = null;
  }
  private transition(state: MotionState, reason: string) {
    this.sessionId++;
    this.state = state;
    this.reason = reason;
    this.interrupt();
  }
  start() {
    this.briefInterruptions = 0;
    this.transition('STARTING', 'カメラの許可を待っています。');
    this.calibration = null;
    this.autoCandidate = null;
  }
  calibrate(hand: Hand = this.movementHand) {
    this.movementHand = hand;
    this.calibration = null;
    this.autoCandidate = null;
    this.samples = [];
    this.calibrationStage = 'recognize';
    this.calibrationProgress = 0;
    this.transition('CALIBRATING', `まず${this.handsLabel}のひらを見せてください。`);
    this.actions.reset();
    this.jump.reset();
  }
  stop() {
    this.transition('OFF', '');
    this.calibration = null;
    this.autoCandidate = null;
    this.samples = [];
  }
  fail(reason: string) {
    this.transition('ERROR', reason);
    this.calibration = null;
    this.autoCandidate = null;
    this.samples = [];
  }
  pause(reason = '停止位置へ手を戻すと再開します。') {
    if (!this.ownsInput || this.state === 'PAUSED') return;
    this.samples = [];
    this.transition('PAUSED', reason);
  }
  resume() {
    if (!this.calibration) this.calibrate();
    else this.transition('READY', `${this.handsLabel}を停止位置へ戻してください。`);
  }
  private recover(stale: boolean) {
    if (this.state !== 'RECOVERING') {
      if (stale) this.briefInterruptions++;
      else this.trackingLosses++;
    }
    this.state = 'RECOVERING';
    this.reason = '停止中 · 移動する手のひらを映してください。';
    this.interrupt();
  }
  private stableHands(first: HandsSample, current: HandsSample) {
    return this.requiredHands.every((side) => {
      const a = first[side],
        b = current[side];
      return (
        !!a &&
        !!b &&
        Math.hypot(a.x - b.x, a.y - b.y) <= MOTION.calibrationPositionStability &&
        Math.abs(b.palmWidth / a.palmWidth - 1) <= MOTION.pushCalibrationStability &&
        Math.abs(b.palmLength / a.palmLength - 1) <= MOTION.pushCalibrationStability
      );
    });
  }
  private identifyHand(body: HandsSample, raw: HandPair | null) {
    const candidates = (['left', 'right'] as const).filter((side) => {
      const hand = body[side];
      return (
        hand?.open &&
        hand.palmFacing >= 0.7 &&
        hand.fingerLength !== null &&
        (raw?.[side]?.handednessScore ?? 0) >= 0.75
      );
    });
    // Keep the first usable candidate through setup. If both appear together,
    // begin with the larger visible palm, then require the usual stable samples.
    const side =
      this.autoCandidate && candidates.includes(this.autoCandidate)
        ? this.autoCandidate
        : (candidates.sort(
            (a, b) =>
              body[b]!.palmWidth * body[b]!.palmLength - body[a]!.palmWidth * body[a]!.palmLength,
          )[0] ?? null);
    if (side !== this.autoCandidate) {
      this.autoCandidate = side;
      this.samples = [];
      this.calibrationProgress = 0;
      this.calibrationStage = 'recognize';
    }
    if (!side) {
      this.reason = 'どちらか片手のひらを見せてください。';
      return false;
    }
    this.movementHand = side;
    return true;
  }
  private finishCalibration() {
    const mid = (side: Hand): HandSample => {
      const values = this.samples.map((s) => s.value[side]!);
      const result = { ...values[Math.floor(values.length / 2)] };
      for (const key of [
        'x',
        'y',
        'palmWidth',
        'palmLength',
        'waveX',
        'roll',
        'palmFacing',
      ] as const)
        result[key] = median(values.map((s) => s[key]));
      return result;
    };
    const left = this.requiredHands.includes('left') ? mid('left') : null,
      right = this.requiredHands.includes('right') ? mid('right') : null;
    const palms = [left, right].filter((hand): hand is HandSample => hand !== null);
    this.calibration = {
      left,
      right,
      scale: clamp(
        (palms.reduce((sum, hand) => sum + hand.palmWidth, 0) / palms.length) * 3,
        0.18,
        0.48,
      ),
    };
    this.samples = [];
    this.state = 'READY';
    this.interrupt();
    this.reason = '停止位置を登録しました。';
  }
  read(now: number): MotionIntent {
    if (this.state === 'ACTIVE' && now - this.lastSample >= MOTION.staleMs) this.recover(true);
    if (this.state !== 'ACTIVE') return this.zero();
    const dt = this.readAt === null ? 0 : clamp(now - this.readAt, 0, MOTION.staleMs);
    this.readAt = now;
    const alpha = 1 - Math.exp(-dt / MOTION.smoothingMs);
    for (const key of ['forward', 'turn'] as const) {
      const target = this.intent[key];
      // Neutral/lost tracking stops immediately; never coast on stale input.
      if (!target || this.smoothed[key] * target < 0) this.smoothed[key] = 0;
      if (target) this.smoothed[key] += (target - this.smoothed[key]) * alpha;
    }
    return { ...this.intent, ...this.smoothed };
  }
  consumeActions(now: number) {
    this.read(now);
    const result = this.events.filter(
      (e) =>
        this.state === 'ACTIVE' &&
        e.sessionId === this.sessionId &&
        now >= e.emittedAtMainMs &&
        now - e.sampledAtMainMs < MOTION.staleMs,
    );
    this.events = [];
    return result;
  }
  accept(frame: MotionFrame, now: number): boolean {
    if (
      !this.ownsInput ||
      frame.sessionId !== this.sessionId ||
      !Number.isInteger(frame.frameId) ||
      frame.frameId <= this.lastFrame ||
      !Number.isFinite(frame.sampledAtMainMs) ||
      frame.sampledAtMainMs <= this.lastSample ||
      frame.sampledAtMainMs > now ||
      now - frame.sampledAtMainMs >= MOTION.staleMs
    )
      return false;
    const at = frame.sampledAtMainMs,
      gap = at - this.lastSample;
    if (gap >= MOTION.staleMs && ['ACTIVE', 'READY', 'RECOVERING'].includes(this.state))
      this.recover(true);
    this.lastFrame = frame.frameId;
    this.lastSample = at;
    if (this.state === 'PAUSED' || this.state === 'STARTING') return true;
    const boundary = palmBoundary(frame.hands?.[this.movementHand]);
    // Hold the accepted command, never extrapolate clipped joints. Fresh camera
    // results must keep arriving; stale results and every explicit stop clear it.
    const holdMovement =
      this.state === 'ACTIVE' &&
      this.movementArmed &&
      (this.edgeHolding || this.movementAtEdge) &&
      (this.intent.forward !== 0 || this.intent.turn !== 0) &&
      (boundary === 'missing' || boundary === 'clipped') &&
      Number.isFinite(frame.width) &&
      Number.isFinite(frame.height) &&
      frame.width > 0 &&
      frame.height > 0;
    const normalized = normalizeHands(frame);
    if (!normalized && !holdMovement) {
      if (this.state === 'CALIBRATING') {
        this.samples = [];
        this.calibrationProgress = 0;
      } else this.recover(false);
      return true;
    }
    const body = normalized ?? { left: null, right: null };
    const observed = { ...body };
    if (this.calibration && this.previous && gap < MOTION.staleMs)
      for (const side of ['left', 'right'] as const) {
        const a = body[side],
          b = this.previous[side];
        if (a && b && Math.hypot(a.x - b.x, a.y - b.y) > this.calibration.scale * 0.85)
          body[side] = null;
      }
    this.previous = observed;
    if (this.state === 'CALIBRATING') {
      if (this.singleHand && this.autoHand && !this.identifyHand(body, frame.hands)) return true;
      if (
        this.requiredHands.some((side) => {
          const hand = body[side];
          return !hand?.open || hand.palmFacing < 0.7 || hand.fingerLength === null;
        })
      ) {
        this.samples = [];
        this.calibrationProgress = 0;
        this.reason = `${this.handsLabel}のひらと指先を映してください。`;
        return true;
      }
      if (
        gap >= MOTION.staleMs ||
        (this.samples[0] && !this.stableHands(this.samples[0].value, body))
      )
        this.samples = [];
      if (this.calibrationStage === 'neutral' && at < this.neutralAfter) return true;
      this.samples.push({ at, value: body });
      if (this.calibrationStage === 'recognize') {
        if (at - this.samples[0].at >= 300) {
          this.calibrationStage = 'neutral';
          this.samples = [];
          this.neutralAfter = at + 1000;
          this.reason = `${this.handsLabel}を楽な高さに戻し、少し止めてください。`;
        }
      } else {
        this.reason = '楽な位置で停止位置を登録中';
        this.calibrationProgress = clamp((at - this.samples[0].at) / MOTION.calibrationMs, 0, 1);
        if (this.calibrationProgress >= 1 && this.samples.length >= 10) this.finishCalibration();
      }
      return true;
    }
    if (!this.calibration) return false;
    const actionHand = this.actionHand;
    const movement = body[this.movementHand],
      hand = body[actionHand],
      base = this.calibration[this.movementHand],
      actionBase = this.calibration[actionHand];
    if (!base || !actionBase) return false;
    const scale = this.calibration.scale;
    const offset = (p: HandSample, b: HandSample) => ({
      x: (p.x - b.x) / scale,
      y: (p.y - b.y) / scale,
    });
    const move = movement ? offset(movement, base) : null;
    // One hand shares the depth-corrected offset: a straight push must not jump
    // or stroke merely because magnification moved the wrist in the image.
    const act = this.singleHand ? move : hand ? offset(hand, actionBase) : null;
    this.actionOffset = act;
    this.actionFingers = hand?.fingers ?? null;
    const push = measurePush(movement, base);
    // Compensate magnification about the image center so a straight push does not steer.
    if (move && movement && push.push !== null) {
      const ratio = 1 + push.push;
      move.x = ((movement.x - 0.5) / ratio - (base.x - 0.5)) / scale;
      const centerY = frame.height / (2 * frame.width);
      move.y = ((movement.y - centerY) / ratio - (base.y - centerY)) / scale;
    }
    const valid = !!move && push.push !== null && move.y < MOTION.downStop;
    const neutral =
      valid && Math.abs(push.push!) < 0.08 && Math.abs(move!.x) < 0.14 && Math.abs(move!.y) < 0.2;
    const actionDepth = push.push !== null && Math.abs(push.push) < MOTION.pushEnter;
    if (this.singleHand) {
      if (
        hand &&
        act &&
        (hand.pose === 'gun' ||
          (actionDepth &&
            hand.open &&
            hand.fingers.slice(1).filter((finger) => finger === 'extended').length >= 3 &&
            (act.y < -0.22 || act.y > 0.2)))
      )
        this.singleAction = true;
      this.singleRestAt = this.singleAction && neutral ? (this.singleRestAt ?? at) : null;
      if (this.singleRestAt !== null && at - this.singleRestAt >= 120) this.singleAction = false;
    }
    if (this.singleAction) this.clearMovement();
    else if (!valid && holdMovement) this.edgeHolding = true;
    else if (!valid) this.clearMovement();
    else {
      if (this.edgeHolding) {
        // The returning palm replaces old measurements immediately. Keep the
        // running command armed so a continuing gesture has no forced stop.
        this.pushSamples = this.turnSamples = [];
      }
      this.edgeHolding = false;
      this.movementAtEdge = boundary === 'edge';
      this.movementOffset = move;
      this.movementRoll = movement ? angle(movement.roll, base.roll) : null;
      this.palmRatio = push.palmRatio;
      this.fingerRatio = push.fingerRatio;
      this.pushSamples = [...this.pushSamples, push.push!].slice(-3);
      this.turnSamples = [...this.turnSamples, move!.x].slice(-3);
      this.movementPush = median(this.pushSamples);
      if (!this.movementArmed) {
        const sample = { ...move!, push: push.push! };
        const previous = this.reacquireSample;
        const coherent =
          previous &&
          Math.hypot(sample.x - previous.x, sample.y - previous.y) < 0.45 &&
          Math.abs(sample.push - previous.push) < 0.3;
        if (!coherent) this.reacquireAt = at;
        this.reacquireSample = sample;
        // Reconfirm the visible hand instead of latching until an exact old position.
        // After a central tracking loss, one returning frame cannot start movement.
        this.movementArmed =
          this.reacquireAt !== null && at - this.reacquireAt >= MOTION.reacquireMs;
      }
      let forward = 0,
        turn = 0;
      if (this.movementArmed) {
        const exit = push.push! < 0 ? MOTION.pullExit : MOTION.pushExit;
        const sign = Math.abs(push.push!) <= exit ? 0 : Math.sign(push.push!);
        if (sign !== this.pushDirection || !sign) {
          this.pushAt = null;
          this.pushDirection = sign;
        }
        if (sign && Math.sign(this.movementPush) === sign) {
          this.pushAt ??= at;
          if (at - this.pushAt >= MOTION.pushDwellMs)
            forward = axis(
              this.movementPush,
              this.intent.forward,
              sign > 0 ? MOTION.pushEnter : MOTION.pullEnter,
              exit,
              sign > 0 ? MOTION.pushRange : MOTION.pullRange,
            );
        }
        turn = axis(
          median(this.turnSamples),
          this.intent.turn,
          MOTION.turnEnter,
          MOTION.turnExit,
          MOTION.turnRange,
        );
      }
      this.intent = { ...this.intent, forward, turn };
    }
    this.intent = { ...this.intent, active: true, sessionId: this.sessionId, sampledAtMainMs: at };
    if (this.state === 'READY') {
      const handsNeutral =
        neutral &&
        !!hand?.open &&
        !!act &&
        Math.abs(act.x) < 0.25 &&
        Math.abs(act.y) < 0.2 &&
        !this.singleAction;
      this.freshAt = handsNeutral ? (this.freshAt ?? at) : null;
      if (this.freshAt === null || at - this.freshAt < MOTION.freshMs) return true;
      this.state = 'ACTIVE';
      this.movementArmed = true;
    } else if (this.state === 'RECOVERING') {
      if (!this.movementArmed) return true;
      this.state = 'ACTIVE';
    }
    if (hand && act) {
      if (!this.actionSeen) {
        this.actions.reacquire(hand, at);
        this.jump.reacquire(act.y);
        this.actionSeen = true;
      }
      const actionAllowed = !this.singleHand || this.singleAction || actionDepth;
      const action = this.actions.update(hand, at, scale, act, actionAllowed);
      const jumping = this.jump.update(
        act.y,
        hand.open &&
          hand.pose !== 'gun' &&
          hand.fingers.slice(1).filter((finger) => finger === 'extended').length >= 3,
        at,
        actionAllowed,
      );
      this.candidate = this.actions.candidate ?? (this.jump.progress > 0 ? 'jump' : null);
      this.actionProgress = this.actions.candidate ? this.actions.progress : this.jump.progress;
      if (action || jumping)
        this.events = [
          {
            sessionId: this.sessionId,
            eventId: ++this.eventId,
            action: action ?? 'jump',
            sampledAtMainMs: at,
            emittedAtMainMs: now,
          },
        ];
    } else {
      this.events = [];
      this.actions.loseTracking();
      this.jump.loseTracking();
      this.actionSeen = false;
      this.candidate = null;
      this.actionProgress = 0;
    }
    this.reason = this.edgeHolding
      ? '画面外 · 直前の動きを継続'
      : this.movementArmed
        ? '視点は自動 · 左右で曲がる'
        : '移動は停止中 · 手のひらを画面内へ';
    return true;
  }
}
