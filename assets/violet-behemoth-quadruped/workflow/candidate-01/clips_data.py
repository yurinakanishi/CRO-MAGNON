"""Eight authored humanoid clips at 30 fps, all with in-place root motion.

Angle convention used by blender_rig.world_axis_rotation, in degrees:
  pitch - about world X. A downward-pointing bone swings its tip backward for a
          positive pitch, so a negative pitch swings that limb forward. A
          forward-pointing bone (foot, toe) points its tip down for a positive
          pitch.
  roll  - about world Y. The limb helper flips the sign per side so a positive
          `lower` always moves that arm or leg toward the body.
  yaw   - about world Z. Positive turns toward the character's left.

Walk_Loop and Run_Loop are not hand-dialled angles. Their legs are solved by
planar two-link inverse kinematics from this mesh's own measured thigh and shin
lengths, against a foot path that moves backward at a constant speed through
stance. That keeps the planted foot from sliding inside the cycle and lets
blender_rig lock the body height onto the ground from the real skinned vertices.
"""
import math

SIDES = ('L', 'R')
FPS = 30


def sign(side):
    return 1.0 if side == 'L' else -1.0


def limb(side, lower=0.0, swing=0.0, turn=0.0):
    return dict(roll=lower * sign(side), pitch=swing, yaw=turn * sign(side))


def parts(*items):
    """Build a bone-name keyed dict without a brace literal."""
    return dict(items)


def merge(base, overrides):
    out = dict((k, dict(v)) for k, v in base.items())
    for name, spec in overrides.items():
        out[name] = dict(spec)
    return out


def both_arms(lower, swing, elbow_lower=0.0, elbow_swing=0.0, hand_lower=-1.0):
    out = dict()
    for side in SIDES:
        out['UpperArm.' + side] = limb(side, lower=lower, swing=swing)
        out['LowerArm.' + side] = limb(side, lower=elbow_lower, swing=elbow_swing)
        out['Hand.' + side] = limb(side, lower=hand_lower)
    return out


def both_legs(upper, lower, foot=0.0, toe=0.0):
    out = dict()
    for side in SIDES:
        out['UpperLeg.' + side] = dict(pitch=upper)
        out['LowerLeg.' + side] = dict(pitch=lower)
        out['Foot.' + side] = dict(pitch=foot)
        out['Toe.' + side] = dict(pitch=toe)
    return out


NEUTRAL_ARM_LOWER = 2.5


def neutral_pose():
    pose = dict()
    pose['Hips'] = dict()
    pose['Spine'] = dict(pitch=1.0)
    pose['Chest'] = dict(pitch=0.8)
    pose['Neck'] = dict(pitch=-0.8)
    pose['Head'] = dict()
    for side in SIDES:
        pose['Shoulder.' + side] = limb(side, lower=0.0)
        pose['UpperArm.' + side] = limb(side, lower=NEUTRAL_ARM_LOWER, swing=0.0)
        pose['LowerArm.' + side] = limb(side, lower=-1.0, swing=-2.0)
        pose['Hand.' + side] = limb(side, lower=-1.0)
        pose['UpperLeg.' + side] = dict()
        pose['LowerLeg.' + side] = dict(pitch=1.5)
        pose['Foot.' + side] = dict()
        pose['Toe.' + side] = dict()
    return pose


BASE = neutral_pose()


class LegSolver:
    """Planar two-link IK for one leg, in this mesh's own measured proportions.

    `thigh` and `shin` are the rest lengths projected onto the sagittal plane.
    Pitch-only leg rotations keep x fixed, so that projection is exact here.
    """

    def __init__(self, hip, knee, ankle):
        self.thigh = math.hypot(knee[1] - hip[1], hip[2] - knee[2])
        self.shin = math.hypot(ankle[1] - knee[1], knee[2] - ankle[2])
        self.alpha_thigh0 = math.atan2(-(knee[1] - hip[1]), hip[2] - knee[2])
        self.alpha_shin0 = math.atan2(-(ankle[1] - knee[1]), knee[2] - ankle[2])
        self.flex0 = self.alpha_thigh0 - self.alpha_shin0
        self.rest_reach = math.hypot(ankle[1] - hip[1], hip[2] - ankle[2])

    def solve(self, forward, drop, sole=0.0, toe=0.0):
        """forward: ankle offset ahead of the hip. drop: ankle distance below it."""
        a = self.thigh
        b = self.shin
        d = math.hypot(forward, drop)
        d = max(min(d, 0.995 * (a + b)), 0.25 * (a + b))
        beta = math.atan2(forward, drop)
        cos_gamma = max(-1.0, min(1.0, (a * a + d * d - b * b) / (2.0 * a * d)))
        gamma = math.acos(cos_gamma)
        cos_knee = max(-1.0, min(1.0, (a * a + b * b - d * d) / (2.0 * a * b)))
        flex = math.pi - math.acos(cos_knee)
        upper = -math.degrees((beta + gamma) - self.alpha_thigh0)
        lower = math.degrees(flex - self.flex0)
        return dict(upper=upper, lower=lower,
                    foot=sole - (upper + lower),
                    toe=toe - sole)


def hermite(t, p0, p1, m0, m1):
    t2 = t * t
    t3 = t2 * t
    return ((2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0
            + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1)


def clamp(value, low, high):
    return max(low, min(high, value))


class Gait:
    """Foot path for one locomotion cycle, expressed relative to the hip.

    Lengths arrive as fractions of this mesh's own rest hip-to-ankle reach, so the
    cycle scales with the reconstructed proportions instead of borrowed numbers.
    During stance the foot moves backward at a constant speed, which is what stops
    the planted foot sliding inside the cycle. The ankle angle is driven from the
    world sole angle while the foot is on the ground and from a small relative
    dorsiflexion while it is in the air, then clamped to a human ankle range.
    """

    ANKLE_RANGE = (-26.0, 46.0)

    def __init__(self, reach, duty, half_step, reach_mid, reach_gain, swing_lift,
                 heel_sole, toe_sole, swing_ankle):
        self.reach = reach
        self.duty = duty
        self.half_step = half_step * reach
        self.reach_mid = reach_mid * reach
        self.reach_gain = reach_gain * reach
        self.swing_lift = swing_lift * reach
        self.heel_sole = heel_sole
        self.toe_sole = toe_sole
        self.swing_ankle = swing_ankle

    def stride(self):
        return 2.0 * self.half_step / self.duty

    def forward(self, phase):
        """Ankle offset ahead of the hip; +half_step at contact, -half_step at lift."""
        A = self.half_step
        if phase < self.duty:
            return A - 2.0 * A * (phase / self.duty)
        u = (phase - self.duty) / (1.0 - self.duty)
        m = -2.0 * A * (1.0 - self.duty) / self.duty
        return hermite(u, -A, A, m, m)

    def leg_reach(self, phase):
        ratio = clamp(self.forward(phase) / self.half_step, -1.5, 1.5)
        value = self.reach_mid + self.reach_gain * ratio * ratio
        if phase >= self.duty:
            u = (phase - self.duty) / (1.0 - self.duty)
            value -= self.swing_lift * math.sin(math.pi * u) ** 0.85
        return clamp(value, 0.40 * self.reach, 0.999 * self.reach)

    def target(self, phase):
        """(forward, drop) ankle target, kept inside the leg's own reach."""
        reach = self.leg_reach(phase)
        forward = clamp(self.forward(phase), -0.90 * reach, 0.90 * reach)
        drop = math.sqrt(max(reach * reach - forward * forward, 1e-4))
        return forward, drop

    def stance_sole(self, s):
        if s < 0.20:
            return self.heel_sole * (1.0 - s / 0.20)
        if s > 0.60:
            return self.toe_sole * ((s - 0.60) / 0.40) ** 1.7
        return 0.0

    def foot_pitch(self, phase, upper, lower):
        """Ankle pitch: world sole angle on the ground, relative hang in the air."""
        if phase < self.duty:
            sole = self.stance_sole(phase / self.duty)
            value = sole - (upper + lower)
        else:
            u = (phase - self.duty) / (1.0 - self.duty)
            if u < 0.25:
                weight = 1.0 - u / 0.25
                sole = self.toe_sole * weight
            elif u > 0.78:
                weight = (u - 0.78) / 0.22
                sole = self.heel_sole
            else:
                weight = 0.0
                sole = 0.0
            value = weight * (sole - (upper + lower)) + (1.0 - weight) * self.swing_ankle
        return clamp(value, self.ANKLE_RANGE[0], self.ANKLE_RANGE[1])

    def toe_pitch(self, phase, upper, lower, foot):
        """Only the toe-off part of stance needs the toe pad to stay on the ground."""
        if phase < self.duty and phase / self.duty > 0.60:
            return clamp(-(upper + lower + foot), -32.0, 0.0)
        return 0.0

    def stance_windows(self, frames):
        """Per-side stance flags for every frame of the cycle."""
        out = dict()
        for side, offset in (('L', 0.0), ('R', 0.5)):
            marked = []
            for frame in range(frames + 1):
                phase = (frame / float(frames) + offset) % 1.0
                marked.append(phase < self.duty)
            out[side] = marked
        return out


def walk_gait(reach):
    return Gait(reach, duty=0.58, half_step=0.320, reach_mid=0.992,
                reach_gain=0.006, swing_lift=0.150, heel_sole=-7.0,
                toe_sole=18.0, swing_ankle=-3.0)


def run_gait(reach):
    return Gait(reach, duty=0.34, half_step=0.392, reach_mid=0.941,
                reach_gain=0.049, swing_lift=0.270, heel_sole=1.0,
                toe_sole=26.0, swing_ankle=-6.0)


def locomotion_pose(solvers, gait, phase, arm_swing, elbow_base, elbow_swing,
                    spine, chest, neck, hips_yaw, hips_roll, chest_yaw, head_yaw,
                    arm_lower):
    pose = dict()
    pose['Hips'] = dict(yaw=hips_yaw * math.cos(2.0 * math.pi * phase),
                        roll=-hips_roll * math.sin(2.0 * math.pi * phase))
    pose['Spine'] = dict(pitch=spine)
    pose['Chest'] = dict(pitch=chest, yaw=-chest_yaw * math.cos(2.0 * math.pi * phase))
    pose['Neck'] = dict(pitch=neck)
    pose['Head'] = dict(yaw=head_yaw * math.cos(2.0 * math.pi * phase))
    for side in SIDES:
        leg_phase = (phase + (0.0 if side == 'L' else 0.5)) % 1.0
        forward, drop = gait.target(leg_phase)
        angles = solvers[side].solve(forward, drop)
        foot = gait.foot_pitch(leg_phase, angles['upper'], angles['lower'])
        toe = gait.toe_pitch(leg_phase, angles['upper'], angles['lower'], foot)
        pose['UpperLeg.' + side] = dict(pitch=angles['upper'])
        pose['LowerLeg.' + side] = dict(pitch=angles['lower'])
        pose['Foot.' + side] = dict(pitch=foot)
        pose['Toe.' + side] = dict(pitch=toe)

        arm_phase = (phase + (0.5 if side == 'L' else 0.0)) % 1.0
        swing = -arm_swing * math.cos(2.0 * math.pi * arm_phase)
        bend = elbow_base + elbow_swing * (0.5 + 0.5 * math.cos(2.0 * math.pi * arm_phase))
        pose['Shoulder.' + side] = limb(side, lower=0.0)
        pose['UpperArm.' + side] = limb(side, lower=arm_lower, swing=swing)
        pose['LowerArm.' + side] = limb(side, lower=-1.0, swing=-bend)
        pose['Hand.' + side] = limb(side, lower=-1.0)
    return pose


def walk_clip(solvers, frames=30):
    gait = walk_gait(0.5 * (solvers['L'].rest_reach + solvers['R'].rest_reach))
    poses = []
    for frame in range(frames + 1):
        phase = (frame / float(frames)) % 1.0 if frame < frames else 0.0
        poses.append((frame, locomotion_pose(
            solvers, gait, phase, arm_swing=17.0, elbow_base=11.0,
            elbow_swing=10.0, spine=3.5, chest=1.6, neck=-1.6, hips_yaw=4.5,
            hips_roll=2.2, chest_yaw=4.5, head_yaw=-1.6,
            arm_lower=NEUTRAL_ARM_LOWER)))
    # Every frame of the cycle is keyed, so linear interpolation reproduces the
    # solved gait exactly at 30 fps and cannot overshoot the ground-locked height
    # between frames the way an auto-clamped Bezier handle can.
    return dict(name='Walk_Loop', loop=True, poses=poses, contact='plant',
                gait=gait, interpolation='LINEAR')


def run_clip(solvers, frames=21):
    gait = run_gait(0.5 * (solvers['L'].rest_reach + solvers['R'].rest_reach))
    poses = []
    for frame in range(frames + 1):
        phase = (frame / float(frames)) % 1.0 if frame < frames else 0.0
        poses.append((frame, locomotion_pose(
            solvers, gait, phase, arm_swing=38.0, elbow_base=58.0,
            elbow_swing=18.0, spine=11.0, chest=4.5, neck=-8.0, hips_yaw=7.0,
            hips_roll=3.0, chest_yaw=7.0, head_yaw=-2.0,
            arm_lower=NEUTRAL_ARM_LOWER + 2.0)))
    return dict(name='Run_Loop', loop=True, poses=poses, contact='stance',
                gait=gait, flight_rise=0.032, interpolation='LINEAR')


def idle_clip():
    breathe_in = dict(
        Hips=dict(),
        Spine=dict(pitch=2.2),
        Chest=dict(pitch=1.7),
        Head=dict(yaw=1.8, pitch=0.7))
    breathe_in.update(dict((('UpperArm.' + s),
                            limb(s, lower=NEUTRAL_ARM_LOWER + 0.8, swing=0.7))
                           for s in SIDES))

    shift = dict(
        Hips=dict(yaw=-1.6, roll=-1.1),
        Spine=dict(pitch=1.8, roll=0.7),
        Chest=dict(pitch=1.4, yaw=1.0),
        Neck=dict(pitch=-1.2),
        Head=dict(yaw=-2.4))
    shift.update(parts(
        ('UpperLeg.L', dict(pitch=0.5)),
        ('LowerLeg.L', dict(pitch=1.9)),
        ('Foot.L', dict(pitch=-0.4)),
        ('UpperLeg.R', dict(pitch=-2.6)),
        ('LowerLeg.R', dict(pitch=6.0)),
        ('Foot.R', dict(pitch=2.6)),
        ('Toe.R', dict(pitch=-2.0))))

    settle = dict(
        Hips=dict(yaw=0.9, roll=0.5),
        Spine=dict(pitch=1.6),
        Chest=dict(pitch=1.1, yaw=-0.8),
        Head=dict(yaw=1.3))
    settle.update(parts(
        ('UpperLeg.R', dict(pitch=-0.9)),
        ('LowerLeg.R', dict(pitch=2.4)),
        ('Foot.R', dict(pitch=1.0)),
        ('Toe.R', dict(pitch=-0.8))))

    poses = [
        (0, merge(BASE, dict())),
        (30, merge(BASE, breathe_in)),
        (60, merge(BASE, shift)),
        (90, merge(BASE, settle)),
        (120, merge(BASE, dict())),
    ]
    return dict(name='Idle_Loop', loop=True, poses=poses, contact='plant')


def gather_clip():
    """Bend at the hips and knees, reach down and forward, come back up."""
    settle = dict(Hips=dict(), Spine=dict(pitch=12.0),
                  Chest=dict(pitch=6.0), Neck=dict(pitch=-4.0), Head=dict(pitch=4.0))
    settle.update(both_legs(-10.0, 20.0, -10.0, 0.0))
    settle.update(both_arms(6.0, -14.0, 6.0, -16.0))

    reach = dict(Hips=dict(), Spine=dict(pitch=34.0),
                 Chest=dict(pitch=14.0), Neck=dict(pitch=-8.0), Head=dict(pitch=10.0))
    reach.update(both_legs(-30.0, 62.0, -32.0, 0.0))
    reach.update(both_arms(9.0, -34.0, 10.0, -26.0))

    hold = dict(Hips=dict(), Spine=dict(pitch=38.0),
                Chest=dict(pitch=16.0), Neck=dict(pitch=-9.0), Head=dict(pitch=12.0))
    hold.update(both_legs(-32.0, 68.0, -36.0, 0.0))
    hold.update(both_arms(10.0, -40.0, 12.0, -34.0))

    rise = dict(Hips=dict(), Spine=dict(pitch=16.0),
                Chest=dict(pitch=8.0), Neck=dict(pitch=-5.0), Head=dict(pitch=5.0))
    rise.update(both_legs(-13.0, 27.0, -14.0, 0.0))
    rise.update(both_arms(7.0, -16.0, 7.0, -18.0))

    poses = [
        (0, merge(BASE, dict())),
        (9, merge(BASE, settle)),
        (20, merge(BASE, reach)),
        (26, merge(BASE, hold)),
        (36, merge(BASE, rise)),
        (45, merge(BASE, dict())),
    ]
    return dict(name='Gather', loop=False, poses=poses, contact='plant')


def craft_pose(offset, twist):
    """Both hands held in front of the chest, working with a small cycle."""
    pose = dict(Hips=dict(), Spine=dict(pitch=7.0),
                Chest=dict(pitch=4.0), Neck=dict(pitch=-6.0), Head=dict(pitch=9.0))
    pose.update(both_legs(-3.0, 7.0, -4.0, 0.0))
    for side in SIDES:
        direction = 1.0 if side == 'L' else -1.0
        pose['UpperArm.' + side] = limb(side, lower=16.0,
                                        swing=-40.0 + offset * direction, turn=-6.0)
        pose['LowerArm.' + side] = limb(side, lower=22.0,
                                        swing=-74.0 - offset * direction)
        pose['Hand.' + side] = limb(side, lower=-4.0, turn=twist * direction)
    return pose


def craft_clip():
    poses = [
        (0, merge(BASE, dict())),
        (12, merge(BASE, craft_pose(0.0, 0.0))),
        (22, merge(BASE, craft_pose(7.0, 10.0))),
        (32, merge(BASE, craft_pose(-7.0, -10.0))),
        (42, merge(BASE, craft_pose(5.0, 7.0))),
        (50, merge(BASE, craft_pose(0.0, 0.0))),
        (60, merge(BASE, dict())),
    ]
    return dict(name='Craft', loop=False, poses=poses, contact='plant')


def give_pose(swing, elbow, lean):
    pose = dict(Spine=dict(pitch=lean), Chest=dict(pitch=lean * 0.5),
                Neck=dict(pitch=-2.0), Head=dict(pitch=3.0))
    pose.update(both_arms(13.0, swing, 15.0, elbow, hand_lower=-8.0))
    return pose


def give_clip():
    poses = [
        (0, merge(BASE, dict())),
        (11, merge(BASE, give_pose(-56.0, -22.0, 4.0))),
        (18, merge(BASE, give_pose(-62.0, -16.0, 6.0))),
        (24, merge(BASE, give_pose(-60.0, -19.0, 5.0))),
        (36, merge(BASE, dict())),
    ]
    return dict(name='Give', loop=False, poses=poses, contact='plant')


def eat_body(head_pitch, chest, chest_yaw=5.0, head_yaw=3.0, spine=2.0,
             shoulder=-8.0):
    """Torso and head part of the Eat action; the arm is solved separately."""
    pose = merge(BASE, dict(
        Spine=dict(pitch=spine),
        Chest=dict(pitch=chest, yaw=chest_yaw),
        Neck=dict(pitch=-3.0),
        Head=dict(pitch=head_pitch, yaw=head_yaw)))
    pose['Shoulder.R'] = limb('R', lower=shoulder)
    return pose


#: Wrist attitude held through the Eat reach: a small extension and inward turn so
#: the palm faces the face and the fingers lead the hand toward the mouth.
EAT_HAND = dict(R=limb('R', lower=-6.0, swing=-26.0, turn=-18.0))

#: Fingertip targets relative to the measured mouth, in metres.
#: x is toward the character's right, y is forward (negative), z is up.
EAT_TARGETS = dict(
    reach=(-0.038, -0.052, -0.012),
    bite=(-0.032, -0.040, -0.004),
)

#: Starting guesses (upper lower/swing/turn, forearm swing/lower) that keep the
#: elbow tucked in front of the ribs instead of winging out to the side.
EAT_HINTS = dict(
    reach=(30.0, -22.0, -10.0, -112.0, 8.0),
    bite=(32.0, -20.0, -12.0, -118.0, 8.0),
)

EAT_BODIES = dict(
    reach=dict(head_pitch=7.5, chest=2.6),
    bite=dict(head_pitch=10.0, chest=3.6),
)

#: The neutral right arm in the solver's own parameter order.
NEUTRAL_ARM = (NEUTRAL_ARM_LOWER, 0.0, 0.0, -2.0, -1.0)


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def eat_clip(arm_ik, mouth):
    """Raise the right hand to the measured mouth, take two bites, lower it.

    The two contact poses are not dialled by eye: `arm_ik` solves the arm angles
    that place this mesh's own measured fingertip a fixed clearance in front of its
    own measured mouth landmark, so the action reads as eating from the front and
    the side while the hand stays clear of the face.

    The rise and fall keys are interpolated in the solver's own angle space between
    the neutral arm and the solved contact pose. Aiming an intermediate at a point
    that happens to lie inside the chest would let the solver reach it around the
    ribs, which is exactly the kind of technically-correct, visually-wrong solution
    a target-only clip should not contain. Empty hands: nothing is held.
    """
    mouth = [float(value) for value in mouth]
    contact = dict()
    angles = dict()
    for key in ('reach', 'bite'):
        body = eat_body(**EAT_BODIES[key])
        offset = EAT_TARGETS[key]
        target = (mouth[0] + offset[0], mouth[1] + offset[1], mouth[2] + offset[2])
        arm, theta = arm_ik.solve('R', target, body, EAT_HINTS[key], label='Eat.' + key)
        contact[key] = merge(body, arm)
        angles[key] = theta

    lift = merge(eat_body(head_pitch=3.6, chest=2.2),
                 arm_ik.arm_pose('R', mix(NEUTRAL_ARM, angles['reach'], 0.55),
                                 hand_scale=0.55))
    settle = merge(eat_body(head_pitch=4.0, chest=2.4),
                   arm_ik.arm_pose('R', mix(NEUTRAL_ARM, angles['bite'], 0.42),
                                   hand_scale=0.42))
    poses = [
        (0, merge(BASE, dict())),
        (12, lift),
        (24, contact['reach']),
        (33, contact['bite']),
        (42, settle),
        (54, merge(BASE, dict())),
    ]
    return dict(name='Eat', loop=False, poses=poses, contact='plant',
                solver='measured arm IK to the mouth landmark, angle-space rise and fall')


def wave_pose(upper_lower, elbow_lower, chest_yaw, head_yaw):
    pose = dict(Chest=dict(yaw=chest_yaw, pitch=1.0), Head=dict(yaw=head_yaw))
    pose['Shoulder.R'] = limb('R', lower=-15.0)
    pose['UpperArm.R'] = limb('R', lower=upper_lower, swing=-7.0, turn=-14.0)
    pose['LowerArm.R'] = limb('R', lower=elbow_lower, swing=-8.0)
    pose['Hand.R'] = limb('R', lower=-6.0)
    return pose


def wave_clip():
    poses = [
        (0, merge(BASE, dict())),
        (10, merge(BASE, wave_pose(-70.0, -30.0, -5.0, -7.0))),
        (18, merge(BASE, wave_pose(-70.0, -50.0, -6.0, -8.0))),
        (26, merge(BASE, wave_pose(-70.0, -14.0, -6.0, -8.0))),
        (34, merge(BASE, wave_pose(-70.0, -50.0, -6.0, -8.0))),
        (42, merge(BASE, wave_pose(-70.0, -14.0, -6.0, -8.0))),
        (50, merge(BASE, wave_pose(-28.0, 0.0, -3.0, -4.0))),
        (60, merge(BASE, dict())),
    ]
    return dict(name='Wave', loop=False, poses=poses, contact='plant')


def build_clips(solvers, arm_ik, mouth):
    """Author the eight clips for this mesh.

    `solvers` maps 'L'/'R' to a LegSolver built from this mesh's landmarks,
    `arm_ik` is the measured arm solver evaluated on the real armature, and
    `mouth` is the measured mouth landmark the Eat action aims at.
    """
    return [idle_clip(), walk_clip(solvers), run_clip(solvers), gather_clip(),
            craft_clip(), give_clip(), eat_clip(arm_ik, mouth), wave_clip()]
