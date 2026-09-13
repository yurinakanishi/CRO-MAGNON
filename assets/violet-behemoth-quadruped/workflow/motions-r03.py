"""Authored motion for the horned quadruped; horizontal world movement stays in AI.

Metres are model units, angles world-axis degrees. The rig bakes the four paw
targets with IK; a lifted tail must never translate the whole animal upward.
"""
import math

TAU = math.tau
LEGS = ('FL', 'FR', 'BL', 'BR')
DURATIONS = {'Alert': .7, 'Attack': 1., 'Charge': 2.4, 'Death': 1.6,
             'Gape': .6, 'Hit': .3, 'Idle_Loop': 3., 'Roar': 1.2,
             'Run_Loop': .6, 'Spit': .9, 'SpitWindup': 1.3,
             'TailSpin': 1.5, 'Tremble': .9, 'Walk_Loop': 1.2}
LOCOMOTION = {'Walk_Loop': {'metresPerSecond': .54, 'cycleSeconds': 1.2, 'dutyFactor': .76},
              'Run_Loop': {'metresPerSecond': 2.28, 'cycleSeconds': .6, 'dutyFactor': .6}}

def smooth(t):
    v = max(0., min(1., t))
    return v*v*(3-2*v)

def bell(t):
    return math.sin(math.pi*max(0., min(1., t)))

def envelope(t):
    return smooth(t/.28)*(1-smooth((t-.68)/.32))

def spin_yaw(t):
    return 360*smooth((t-.33)/.97)

def gait(phase, duty, stride, lift):
    if phase < duty:
        return (0., stride*(phase/duty-.5), 0.)
    u = (phase-duty)/(1-duty)
    return (0., stride*(.5-smooth(u)), lift*bell(u)**2)

def pose_at(name, t):
    u = t/DURATIONS[name]
    pose = {'Hips': {'loc': (0., 0., -.075)}}
    feet = {k: (0., 0., 0.) for k in LEGS}
    yaw = 0.
    if name == 'Idle_Loop':
        w = TAU*u
        pose['Hips']['loc'] = (.004*math.sin(w), 0., -.075+.008*math.cos(w))
        pose['Chest'] = {'pitch': .6*math.sin(w)}
        pose['Head'] = {'yaw': 1.6*math.sin(w), 'pitch': -.5*math.sin(w)}
        for i in range(7):
            pose[f'Tail{i+1}'] = {'yaw': (1.3+.35*i)*math.sin(w-i*.5), 'pitch': .5*math.sin(w-i*.25)}
    elif name in ('Walk_Loop', 'Run_Loop', 'Charge'):
        run = name != 'Walk_Loop'
        if name == 'Charge':
            # Final game clip is 1.303x faster: 6.91 authored m/s -> 22.5 world m/s.
            strength = .55+.45*smooth(t/.23)
            phase = t/.24 - .22*(1-math.exp(-t/.1))
            duty, stride, lift = .57, .945*strength, .20
            offsets = {'BL': 0., 'BR': .12, 'FL': .5, 'FR': .62}
        else:
            cfg = LOCOMOTION[name]; phase = t/cfg['cycleSeconds']; duty = cfg['dutyFactor']
            stride = cfg['metresPerSecond']*cfg['cycleSeconds']*duty
            lift, strength = (.17 if run else .09), 1.
            offsets = {'BL': 0., 'FL': .25, 'BR': .5, 'FR': .75} if not run else {'BL': 0., 'FR': 0., 'BR': .5, 'FL': .5}
        feet = {k: gait((phase+o)%1, duty, stride, lift) for k, o in offsets.items()}
        w = TAU*phase
        pose['Hips'] = {'loc': (.008*math.sin(w), 0., (-.14 if run else -.095)+.013*math.cos(2*w)),
                        'yaw': (1.3 if run else .7)*math.sin(w-.35), 'roll': .6*math.sin(w)}
        pose['Spine'] = {'pitch': (1.7 if run else .6)*math.sin(2*w)}
        pose['Chest'] = {'yaw': (2.1 if run else .9)*math.sin(w), 'pitch': (2 if run else .6)*math.cos(2*w)}
        pose['Neck'] = {'pitch': 4 if run else 1}
        pose['Head'] = {'pitch': -(1 if run else .6)*math.cos(2*w)}
        # The body leads the wave, then tail root/middle/tip lag successively.
        for i in range(7):
            pose[f'Tail{i+1}'] = {'yaw': ((3.8+.72*i)*strength if run else 1.4+.3*i)*math.sin(w-.7-i*.53),
                                     'pitch': (2 if i == 0 else .3) if run else 0.}
    elif name == 'Roar':
        k = envelope(u); brace = smooth((u-.45)/.35)
        pose['Hips']['loc'] = (0., .075*k, -.075-.12*brace)
        pose['Chest'] = {'pitch': -3*k+4*brace}
        pose['Neck'] = {'pitch': -10*k+9*brace}
        pose['Head'] = {'pitch': -7*k+4*brace}
        pose['Jaw'] = {'pitch': 24*bell(min(1., u/.8))}
        for i in range(7):
            pose[f'Tail{i+1}'] = {'pitch': (7 if i == 0 else .8)*brace,
                                     'yaw': (1.4+.5*i)*math.sin(t*7-i*.55)*k}
        # One short stamping step while the other three paws bear the weight.
        feet['FL'] = (0., -.065*smooth((u-.38)/.4), .09*bell((u-.25)/.36)**2)
    elif name == 'Tremble':
        k = smooth(u/.7)
        pose['Hips'] = {'yaw': -7*k, 'loc': (.015*k, .025*k, -.075-.15*k)}
        pose['Chest'] = {'yaw': -6*k, 'pitch': 3*k}
        pose['Neck'] = {'yaw': 8*k, 'pitch': -2*k}
        for i in range(7):
            pose[f'Tail{i+1}'] = {'pitch': (14 if i == 0 else 1.2)*k,
                                     'yaw': -(4+i*.75)*smooth((u-i*.03)/.7)}
    elif name == 'TailSpin':
        yaw = spin_yaw(t); settle = smooth((t-1.3)/.2)
        pose['Hips'] = {'yaw': yaw-7*(1-smooth(t/.2)), 'loc': (0., 0., -.075-.15*(1-settle))}
        pose['Chest'] = {'yaw': -6*(1-smooth(t/.25)), 'pitch': 3*(1-settle)}
        pose['Neck'] = {'yaw': 8*(1-smooth(t/.25))}
        for k, phase in {'FL': 0., 'BR': 0., 'FR': .5, 'BL': .5}.items():
            p = ((t-.3)/.3+phase)%1
            feet[k] = (0., 0., .10*bell((p-.6)/.4)**2*bell((t-.3)/1.03))
        for i in range(7):
            lag = spin_yaw(t-(i+1)*.026)-spin_yaw(t-i*.026)
            release = max(0., t-1.05-i*.026)
            whip = (2+i*.25)*math.sin(release*18)*math.exp(-release*9) if release else 0.
            coil = -(4+i*.75)*(1-smooth(t/.3))
            pose[f'Tail{i+1}'] = {'yaw': coil+lag+whip,
                                     'pitch': (14 if i == 0 else 1.2)*(1-settle)}
    elif name == 'Gape':
        k = smooth(u/.65)
        pose['Hips']['loc'] = (0., .055*k, -.075-.035*k)
        pose['Neck'] = {'pitch': -7*k}; pose['Head'] = {'pitch': -7*k}
        pose['Jaw'] = {'pitch': 29*k}
    elif name == 'Attack':
        strike = smooth((t-.25)/.25); back = smooth((t-.55)/.45)
        k = 1-back
        pose['Hips']['loc'] = (0., (.055-.13*strike)*k, -.075-.035*k)
        pose['Neck'] = {'pitch': (-7+14*strike)*k}
        pose['Head'] = {'pitch': (-7+12*strike)*k}
        pose['Jaw'] = {'pitch': 29*(1-smooth((t-.32)/.17))}
    elif name in ('SpitWindup', 'Spit'):
        k = smooth(u/.7) if name == 'SpitWindup' else 1-smooth(t/.4)
        recoil = 0. if name == 'SpitWindup' else bell(t/.45)
        pose['Hips']['loc'] = (0., .085*k-.05*recoil, -.075-.04*k)
        pose['Chest'] = {'pitch': -3*k+4*recoil, 'scale': (1+.028*k, 1+.012*k, 1+.025*k)}
        pose['Neck'] = {'pitch': -10*k+10*recoil}
        pose['Head'] = {'pitch': -11*k+10*recoil}
        pose['Jaw'] = {'pitch': 31*k+17*recoil}
        for i in range(7):
            pose[f'Tail{i+1}'] = {'pitch': (2 if i == 0 else .3)*k}
    elif name in ('Alert', 'Hit'):
        k = bell(u)**2
        pose['Hips']['loc'] = (0., (.02 if name == 'Alert' else .055)*k, -.075-.025*k)
        pose['Neck'] = {'pitch': -5*k}; pose['Head'] = {'pitch': -4*k}
        pose['Chest'] = {'roll': (1 if name == 'Alert' else 3)*k}
    elif name == 'Death':
        k = smooth(t/1.1)
        pose['Hips'] = {'roll': 76*k, 'loc': (.08*k, 0., -.075-.24*k)}
        pose['Neck'] = {'pitch': 10*k}; pose['Head'] = {'pitch': 12*k}; pose['Jaw'] = {'pitch': 13*k}
        for side in 'LR':
            pose['UpperArm.'+side] = {'pitch': -20*k}; pose['LowerArm.'+side] = {'pitch': 38*k}
            pose['UpperLeg.'+side] = {'pitch': 26*k}; pose['LowerLeg.'+side] = {'pitch': -36*k}
        feet = None
        for i in range(7): pose[f'Tail{i+1}'] = {'yaw': 4*k*math.exp(-i*.15)}
    return pose, feet, yaw
