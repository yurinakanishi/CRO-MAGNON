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
/** Recognition clocks are main-thread monotonic milliseconds. */
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
  strafe: number;
  /** Cumulative drag travel; rendering consumes differences, even across skipped frames. */
  cameraYaw: number;
  cameraPitch: number;
  cameraDragging: boolean;
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
  left: HandSample;
  right: HandSample;
  scale: number;
}
export const MOTION = Object.freeze({
  staleMs: 230,
  edgeHoldMs: 600,
  edgeFadeMs: 300,
  edgeMargin: 0.18,
  calibrationMs: 1400,
  calibrationPositionStability: 0.05,
  freshMs: 45,
  pushEnter: 0.12,
  pushExit: 0.06,
  pushRange: 0.45,
  pullRange: 0.3,
  pushDwellMs: 45,
  pushCalibrationStability: 0.16,
  downEnter: 0.24,
  downExit: 0.14,
  downRange: 0.65,
  rollEnter: 0.2,
  rollExit: 0.12,
  rollRange: 0.65,
});
const length = (a: Offset) => Math.hypot(a.x, a.y);
const diff = (a: Offset, b: Offset): Offset => ({ x: a.x - b.x, y: a.y - b.y });
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const angle = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
function axis(value: number, previous: number, enter: number, exit: number, range: number) {
  const threshold = previous * value > 0 ? exit : enter;
  return Math.abs(value) > threshold
    ? Math.sign(value) * clamp((Math.abs(value) - exit) / (range - exit), 0, 1)
    : 0;
}
export class MotionInputAdapter {
  state: MotionState = 'OFF';
  sessionId = 0;
  movementHand: Hand = 'left';
  reason = '';
  calibrationProgress = 0;
  actionProgress = 0;
  trackingLosses = 0;
  briefInterruptions = 0;
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
  private previous: HandsSample | null = null;
  private lastFrame = -1;
  private lastSample = -Infinity;
  private freshAt: number | null = null;
  private actions = new MotionHandActions();
  private actionSeen = false;
  private jump = new MotionJump();
  private movementSeen = false;
  private pushSamples: number[] = [];
  private rollSamples: number[] = [];
  private downSamples: number[] = [];
  private pushAt: number | null = null;
  private pushDirection = 0;
  private down = 0;
  private eventId = 0;
  private events: MotionActionEvent[] = [];
  private intent: MotionIntent = this.zero();
  private lastMovement: { at: number; nearEdge: boolean } | null = null;
  private edgeHold: { at: number; intent: MotionIntent } | null = null;
  get holdingMovement() {
    return this.edgeHold !== null;
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
  get strafe() {
    return this.state === 'ACTIVE' ? this.intent.strafe : 0;
  }
  get actionPose() {
    return this.actions.pose;
  }
  get cameraDelta() {
    return this.state === 'ACTIVE' ? this.actions.cameraDelta : { x: 0, y: 0 };
  }
  get ownsInput() {
    return this.state !== 'OFF' && this.state !== 'ERROR';
  }
  private zero(): MotionIntent {
    return {
      active: false,
      forward: 0,
      strafe: 0,
      cameraYaw: this.actions?.cameraTravel.x ?? 0,
      cameraPitch: this.actions?.cameraTravel.y ?? 0,
      cameraDragging: false,
      sessionId: this.sessionId,
      sampledAtMainMs: this.lastSample,
    };
  }
  private clearMovement() {
    this.intent = { ...this.intent, forward: 0, strafe: 0 };
    this.movementOffset = null;
    this.movementPush = this.movementRoll = null;
    this.palmRatio = this.fingerRatio = null;
    this.pushSamples = [];
    this.rollSamples = [0];
    this.downSamples = [0];
    this.pushAt = null;
    this.pushDirection = this.down = 0;
    this.lastMovement = null;
    this.edgeHold = null;
  }
  private interrupt() {
    this.clearMovement();
    this.intent = this.zero();
    this.jump.loseTracking();
    this.movementSeen = false;
    this.events = [];
    this.previous = null;
    this.freshAt = null;
    this.actions.loseTracking();
    this.actionSeen = false;
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
  }
  calibrate(hand: Hand = this.movementHand) {
    this.movementHand = hand;
    this.calibration = null;
    this.samples = [];
    this.calibrationProgress = 0;
    this.transition('CALIBRATING', '両手のひらをカメラに向け、指を伸ばして楽に構えてください。');
    this.actions.reset();
    this.jump.reset();
  }
  stop() {
    this.transition('OFF', '');
    this.calibration = null;
    this.samples = [];
  }
  fail(reason: string) {
    this.transition('ERROR', reason);
    this.calibration = null;
    this.samples = [];
  }
  pause(reason = '画面に戻ると、映っている手から自動で操作を続けられます。') {
    if (!this.ownsInput || this.state === 'PAUSED') return;
    this.samples = [];
    this.transition('PAUSED', reason);
  }
  resume() {
    if (!this.calibration) this.calibrate();
    else this.transition('READY', '手を確認しています。その位置から続けられます。');
  }
  private recover(stale: boolean) {
    if (this.state !== 'RECOVERING') {
      if (stale) this.briefInterruptions++;
      else this.trackingLosses++;
    }
    // Keep the worker session and calibration. Slow results must not invalidate
    // the next in-flight result or require a return to a fixed pose.
    this.state = 'RECOVERING';
    this.reason = stale
      ? '認識の更新待ち · 新しい結果で自動復帰します。'
      : '手が映ると、その位置から続けられます。';
    this.interrupt();
  }
  private stableHands(first: HandsSample, current: HandsSample) {
    return (['left', 'right'] as const).every((side) => {
      const a = first[side],
        b = current[side];
      return (
        !!a &&
        !!b &&
        length(diff(a, b)) <= MOTION.calibrationPositionStability &&
        Math.abs(b.palmWidth / a.palmWidth - 1) <= MOTION.pushCalibrationStability &&
        Math.abs(b.palmLength / a.palmLength - 1) <= MOTION.pushCalibrationStability
      );
    });
  }
  private finishCalibration() {
    const midHand = (hand: Hand): HandSample => {
      const samples = this.samples.map((s) => s.value[hand]!);
      const yaw = samples.flatMap((s) => (s.yaw === null ? [] : [s.yaw]));
      return {
        ...samples[Math.floor(samples.length / 2)],
        x: median(samples.map((s) => s.x)),
        y: median(samples.map((s) => s.y)),
        palmWidth: median(samples.map((s) => s.palmWidth)),
        palmLength: median(samples.map((s) => s.palmLength)),
        fingerLength: median(samples.map((s) => s.fingerLength!)),
        waveX: median(samples.map((s) => s.waveX)),
        roll: median(samples.map((s) => s.roll)),
        yaw: yaw.length ? median(yaw) : null,
        open: true,
      };
    };
    const left = midHand('left'),
      right = midHand('right');
    this.calibration = {
      left,
      right,
      scale: clamp((left.palmWidth + right.palmWidth) * 1.5, 0.18, 0.48),
    };
    this.samples = [];
    this.state = 'READY';
    this.freshAt = null;
    this.reason = '調整できました。手を動かして遊べます。';
  }
  private forwardFromPush(raw: number | null, at: number) {
    const sign = raw === null || Math.abs(raw) <= MOTION.pushExit ? 0 : Math.sign(raw);
    if (!sign || sign !== this.pushDirection) {
      this.pushAt = null;
      this.pushDirection = sign;
    }
    const push = this.movementPush ?? 0;
    if (
      !sign ||
      Math.sign(push) !== sign ||
      Math.abs(push) <= (this.intent.forward * sign > 0 ? MOTION.pushExit : MOTION.pushEnter)
    ) {
      this.pushAt = null;
      return 0;
    }
    this.pushAt ??= at;
    if (this.pushSamples.length < 2 || at - this.pushAt < MOTION.pushDwellMs) return 0;
    return axis(
      push,
      this.intent.forward,
      MOTION.pushEnter,
      MOTION.pushExit,
      sign > 0 ? MOTION.pushRange : MOTION.pullRange,
    );
  }
  read(now: number): MotionIntent {
    if (this.state === 'ACTIVE' && now - this.lastSample >= MOTION.staleMs) this.recover(true);
    if (this.state !== 'ACTIVE') return this.zero();
    if (this.edgeHold) {
      const elapsed = now - this.edgeHold.at;
      if (elapsed >= MOTION.edgeHoldMs + MOTION.edgeFadeMs) this.clearMovement();
      else {
        const fade = 1 - clamp((elapsed - MOTION.edgeHoldMs) / MOTION.edgeFadeMs, 0, 1);
        return {
          ...this.intent,
          forward: this.edgeHold.intent.forward * fade,
          strafe: this.edgeHold.intent.strafe * fade,
          sampledAtMainMs: this.lastSample,
        };
      }
    }
    return { ...this.intent };
  }
  consumeActions(now: number): MotionActionEvent[] {
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
    if (
      gap >= MOTION.staleMs &&
      (this.state === 'ACTIVE' || this.state === 'READY' || this.state === 'RECOVERING')
    )
      this.recover(true);
    this.lastFrame = frame.frameId;
    this.lastSample = at;
    if (this.state === 'PAUSED' || this.state === 'STARTING') return true;
    const body = normalizeHands(frame);
    if (!body) {
      if (this.state === 'CALIBRATING') {
        this.samples = [];
        this.calibrationProgress = 0;
        this.reason = '最初だけ、両手のひらと指先を映して構えてください。顔や肩は不要です。';
      } else this.recover(false);
      return true;
    }
    const observed = { ...body };
    if (this.calibration && this.previous && gap < MOTION.staleMs) {
      for (const hand of ['left', 'right'] as const) {
        const a = body[hand],
          b = this.previous[hand];
        if (a && b && length(diff(a, b)) > this.calibration.scale * 0.85) body[hand] = null;
      }
    }
    this.previous = observed;
    if (this.state === 'CALIBRATING') {
      if (
        !body.left?.open ||
        !body.right?.open ||
        body.left.fingerLength === null ||
        body.right.fingerLength === null
      ) {
        this.samples = [];
        this.calibrationProgress = 0;
        this.reason = '両手のひらを正面に向け、手首から指先まで映してください。';
        return true;
      }
      if (
        gap >= MOTION.staleMs ||
        (this.samples[0] && !this.stableHands(this.samples[0].value, body))
      )
        this.samples = [];
      this.samples.push({ at, value: body });
      this.calibrationProgress = clamp((at - this.samples[0].at) / MOTION.calibrationMs, 0, 1);
      this.reason = 'その楽な位置で、両手を少し止めてください。';
      if (this.calibrationProgress >= 1 && this.samples.length >= 10) this.finishCalibration();
      return true;
    }
    if (!this.calibration) return false;
    const actionHand = this.movementHand === 'left' ? 'right' : 'left';
    const movement = body[this.movementHand],
      hand = body[actionHand];
    if (!movement && !hand) {
      this.recover(false);
      return true;
    }
    const offset = (p: HandSample, base: HandSample): Offset => ({
      x: (p.x - base.x) / this.calibration!.scale,
      y: (p.y - base.y) / this.calibration!.scale,
    });
    const base = this.calibration[this.movementHand];
    const move = movement ? offset(movement, base) : null;
    const act = hand ? offset(hand, this.calibration[actionHand]) : null;
    this.actionOffset = act;
    this.actionFingers = hand?.fingers ?? null;
    if (!movement) {
      const last = this.lastMovement;
      if (
        this.state === 'ACTIVE' &&
        !this.edgeHold &&
        last?.nearEdge &&
        at - last.at < MOTION.staleMs &&
        (this.intent.forward || this.intent.strafe)
      )
        this.edgeHold = { at, intent: { ...this.intent } };
      if (!this.edgeHold || at - this.edgeHold.at >= MOTION.edgeHoldMs + MOTION.edgeFadeMs)
        this.clearMovement();
      this.movementOffset = null;
      this.movementRoll = null;
    } else {
      this.edgeHold = null;
      this.lastMovement = {
        at,
        nearEdge: frame.hands![this.movementHand]!.landmarks.some(
          (p) =>
            p.x < MOTION.edgeMargin ||
            p.x > 1 - MOTION.edgeMargin ||
            p.y < MOTION.edgeMargin ||
            p.y > 1 - MOTION.edgeMargin,
        ),
      };
      this.movementOffset = move;
      const push = measurePush(movement, base);
      this.palmRatio = push.palmRatio;
      this.fingerRatio = push.fingerRatio;
      if (push.push === null) {
        this.pushSamples = [];
        this.pushAt = null;
        this.movementPush = null;
      } else {
        this.pushSamples = [...this.pushSamples, push.push].slice(-3);
        this.movementPush = median(this.pushSamples);
      }
      this.rollSamples = [...this.rollSamples, angle(movement.roll, base.roll)].slice(-3);
      this.movementRoll = median(this.rollSamples);
      let forward = this.forwardFromPush(push.push, at);
      this.downSamples = [...this.downSamples, Math.max(0, move!.y)].slice(-3);
      this.down = axis(
        move!.y <= MOTION.downExit ? 0 : median(this.downSamples),
        this.down,
        MOTION.downEnter,
        MOTION.downExit,
        MOTION.downRange,
      );
      // A push often lowers the wrist (as in the supplied recording). Forward wins
      // over lowering, including its short confirmation window; lowering never locks input.
      if ((push.push ?? 0) <= MOTION.pushExit) forward = Math.min(forward, -this.down);
      else forward = Math.max(0, forward);
      const strafe = axis(
        this.movementRoll,
        this.intent.strafe,
        MOTION.rollEnter,
        MOTION.rollExit,
        MOTION.rollRange,
      );
      const magnitude = Math.max(1, Math.hypot(forward, strafe));
      this.intent = {
        active: true,
        forward: forward / magnitude || 0,
        strafe: strafe / magnitude,
        cameraYaw: 0,
        cameraPitch: 0,
        cameraDragging: false,
        sessionId: this.sessionId,
        sampledAtMainMs: at,
      };
    }
    if (hand && !this.actionSeen) {
      this.actions.reacquire(hand, at);
      this.actionSeen = true;
    } else if (!hand) {
      this.events = this.events.filter((e) => e.action === 'jump');
      this.actions.loseTracking();
      this.actionSeen = false;
    }
    if (move && !this.movementSeen) {
      this.jump.reacquire(move.y);
      this.movementSeen = true;
    } else if (!move) {
      this.events = this.events.filter((e) => e.action !== 'jump');
      this.jump.loseTracking();
      this.movementSeen = false;
    }
    this.intent = {
      ...this.intent,
      active: true,
      cameraYaw: 0,
      cameraPitch: 0,
      cameraDragging: false,
      sessionId: this.sessionId,
      sampledAtMainMs: at,
    };
    if (this.state === 'READY' || this.state === 'RECOVERING') {
      this.freshAt ??= at;
      if (at - this.freshAt < MOTION.freshMs) return true;
      this.state = 'ACTIVE';
    }
    this.reason = this.edgeHold
      ? '枠外 · 直前の移動を少し継続して減速します。'
      : '移動の手を上げるとジャンプ。反対の手は開いて視点・銃の形で攻撃・横なでで近接操作。';
    const action = hand ? this.actions.update(hand, at, this.calibration.scale) : null;
    const jumping = !!move && !!movement && this.jump.update(move.y, movement.open, at);
    this.candidate = this.actions.candidate ?? (this.jump.progress > 0 ? 'jump' : null);
    this.actionProgress = this.actions.candidate ? this.actions.progress : this.jump.progress;
    this.intent.cameraYaw = this.actions.cameraTravel.x;
    this.intent.cameraPitch = this.actions.cameraTravel.y;
    this.intent.cameraDragging = this.actions.cameraDragging;
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
    return true;
  }
}
/** Translation is view-relative; each camera stroke is applied exactly once, with a short blend. */
export class MotionNavigation {
  private previousAt: number | null = null;
  private sampleAt = -Infinity;
  private session = -1;
  private cameraPosition = { x: 0, y: 0 };
  private remaining = { x: 0, y: 0 };
  private blendMs = 0;
  reset(now: number) {
    this.previousAt = now;
    this.sampleAt = -Infinity;
    this.session = -1;
    this.cameraPosition = { x: 0, y: 0 };
    this.remaining = { x: 0, y: 0 };
    this.blendMs = 0;
  }
  step(intent: MotionIntent, now: number) {
    const dt = this.previousAt === null ? 0 : clamp(now - this.previousAt, 0, 100);
    this.previousAt = now;
    const fresh =
      now - intent.sampledAtMainMs >= 0 && now - intent.sampledAtMainMs < MOTION.staleMs;
    if (intent.sessionId !== this.session || !intent.active || !intent.cameraDragging || !fresh) {
      this.remaining = { x: 0, y: 0 };
      this.blendMs = 0;
      if (intent.sessionId !== this.session) {
        this.sampleAt = -Infinity;
        this.cameraPosition = { x: intent.cameraYaw, y: intent.cameraPitch };
      }
      this.session = intent.sessionId;
    }
    if (intent.active && intent.cameraDragging && fresh && intent.sampledAtMainMs > this.sampleAt) {
      const dx = intent.cameraYaw - this.cameraPosition.x,
        dy = intent.cameraPitch - this.cameraPosition.y;
      this.remaining.x += dx;
      this.remaining.y += dy;
      if (dx || dy) this.blendMs = 55;
    }
    this.cameraPosition = { x: intent.cameraYaw, y: intent.cameraPitch };
    this.sampleAt = Math.max(this.sampleAt, intent.sampledAtMainMs);
    const blend = this.blendMs > 0 ? Math.min(1, dt / this.blendMs) : 1;
    const cameraDelta = this.remaining.x * blend,
      cameraPitchDelta = this.remaining.y * blend;
    this.remaining.x -= cameraDelta;
    this.remaining.y -= cameraPitchDelta;
    this.blendMs = Math.max(0, this.blendMs - dt);
    const magnitude = Math.max(1, Math.hypot(intent.forward, intent.strafe));
    return {
      sx: intent.active ? intent.strafe / magnitude : 0,
      sy: intent.active ? -intent.forward / magnitude || 0 : 0,
      cameraDelta,
      cameraPitchDelta,
    };
  }
}
