"""In-place fantasy octopus motion design, fitted to the measured bone lengths."""
import math
import numpy as np

def smooth(value):
    x=max(0,min(1,value))
    return x*x*(3-2*x)

def fit(path, lengths, target=None):
    """Length-preserving FABRIK, seeded by a designed curve rather than a straight line."""
    q=np.asarray(path,dtype=float).copy()
    start=q[0].copy()
    goal=q[-1].copy() if target is None else np.asarray(target,dtype=float)
    delta=goal-start
    distance=np.linalg.norm(delta)
    reach=sum(lengths)*.998
    if distance>reach: goal=start+delta*reach/distance
    for _ in range(50):
        q[-1]=goal
        for i in range(len(q)-2,-1,-1):
            v=q[i]-q[i+1]
            q[i]=q[i+1]+v/max(np.linalg.norm(v),1e-8)*lengths[i]
        q[0]=start
        for i in range(len(q)-1):
            v=q[i+1]-q[i]
            q[i+1]=q[i]+v/max(np.linalg.norm(v),1e-8)*lengths[i]
        if np.linalg.norm(q[-1]-goal)<.0001: break
    return q

def resample(points, count):
    q=np.asarray(points,dtype=float)
    distances=np.r_[0,np.cumsum(np.linalg.norm(np.diff(q,axis=0),axis=1))]
    x=np.linspace(0,distances[-1],count)
    return np.stack([np.interp(x,distances,q[:,axis]) for axis in range(3)],axis=1)

def motions(marks, chains):
    lower=[np.asarray(points,dtype=float) for points in marks['lowerArms']]
    right=np.asarray(marks['rightArm'],dtype=float)
    lengths={key:np.linalg.norm(np.diff(path,axis=0),axis=1) for key,path in [('ArmR',right)]+[(f'Tentacle{i+1}',path) for i,path in enumerate(lower)]}
    folded=resample(marks['foldedRightArm'],len(right))
    folded=fit(folded,lengths['ArmR'])
    forward=resample(marks['attackRightArm'],len(right))
    forward=fit(forward,lengths['ArmR'])
    left=np.asarray(marks['leftArm'],dtype=float)
    leftIdle=np.asarray(marks['leftIdle'],dtype=float)
    clips={}

    def base(t=0):
        pose={'chains':{'ArmR':folded.copy()},'rotations':{},'offsets':{},'leftHand':leftIdle.copy()}
        for i,path in enumerate(lower): pose['chains'][f'Tentacle{i+1}']=path.copy()
        return pose

    def breath(pose,t,period=3):
        pose['rotations']['Chest']=((1,0,0),.012*math.sin(t*math.tau/period))
        pose['rotations']['Head']=((0,0,1),.024*math.sin(t*math.tau/period))
        return pose

    def idle(t):
        pose=breath(base(),t)
        # Small delayed tip movements; the supporting undersides remain still.
        for i,path in enumerate(lower):
            q=path.copy()
            amount=np.linspace(0,1,len(q))**3
            q[:,0]+=.008*amount*math.sin(t*math.tau/3-i*.7)
            pose['chains'][f'Tentacle{i+1}']=fit(q,lengths[f'Tentacle{i+1}'])
        return pose
    clips['Idle_Loop']=(3,True,idle)

    def gait(t,fast):
        cycle=.3 if fast else .5
        duty=.52 if fast else .68
        # The supporting section travels backwards at the actual game speed.
        # Tentacles are muscular tissue: proximal segments extend while the
        # curled distal contact section translates without changing its shape.
        stride=(2.2 if fast else .8)*cycle*duty
        lift=.085 if fast else .035
        pose=base()
        for i,path in enumerate(lower):
            phase=(t/cycle+i/8)%1
            if phase<duty:
                offset=stride*(phase/duty-.5)
                height=0
            else:
                u=(phase-duty)/(1-duty)
                offset=stride*(.5-smooth(u))
                height=lift*math.sin(math.pi*u)
            q=path.copy()
            influence=np.minimum(1,np.arange(len(q))/2)
            if i==3: influence*=.22  # short curled arm is a secondary stabilizer
            q[:,1]+=offset*influence
            q[:,2]+=height*influence
            q[:,0]+=(.015 if fast else .006)*np.sin(influence*math.pi)*math.sin(t/cycle*math.tau-i*.65)
            pose['chains'][f'Tentacle{i+1}']=q
        pose['rotations']['Spine']=((1,0,0),-.04 if fast else -.015)
        pose['rotations']['Chest']=((0,1,0),(.025 if fast else .012)*math.sin(t/cycle*math.tau))
        q=folded.copy()
        q[:,2]+=.016*np.linspace(0,1,len(q))*math.sin(t/cycle*math.tau-.6)
        pose['chains']['ArmR']=fit(q,lengths['ArmR'])
        return pose
    clips['Walk_Loop']=(.5,True,lambda t:gait(t,False))
    clips['Run_Loop']=(.3,True,lambda t:gait(t,True))

    def attack(t):
        pose=base()
        reach=smooth((t-.15)/.25)*(1-smooth((t-.52)/.48))
        pose['blendRight']=(folded,forward,reach)
        pose['rotations']['Spine']=((1,0,0),-.07*reach)
        pose['rotations']['Head']=((1,0,0),.04*reach)
        return pose
    clips['Attack']=(1,False,attack)

    def gather(t):
        pose=base()
        reach=smooth(t/.25)*(1-smooth((t-1.1)/.3))
        q=forward.copy()
        q[:,2]-=np.linspace(0,1,len(q))*.32
        pose['blendRight']=(folded,fit(q,lengths['ArmR']),reach)
        pose['rotations']['Head']=((1,0,0),.16*reach)
        return pose
    clips['Gather']=(1.4,False,gather)

    def hand_action(t,duration,goal,wave=False):
        pose=base()
        reach=smooth(t/.28)*(1-smooth((t-duration+.3)/.3))
        target=np.asarray(goal,dtype=float).copy()
        if wave: target[0]+=.05*math.sin(t*math.tau*2)
        pose['leftHand']=leftIdle*(1-reach)+target*reach
        pose['rotations']['Head']=((0,0,1),.06*math.sin(math.pi*t/duration))
        return pose
    chest=np.asarray(marks['chest'])
    face=np.asarray(marks['head'])
    clips['Craft']=(1.5,False,lambda t:hand_action(t,1.5,chest+np.array([.08,-.28,-.18])))
    clips['Give']=(1.1,False,lambda t:hand_action(t,1.1,chest+np.array([.18,-.36,-.13])))
    def eat(t):
        pose=hand_action(t,1.5,face+np.array([.12,-.15,-.16]))
        pose['leftTip']=face+np.array([.02,-.22,-.075])
        return pose
    clips['Eat']=(1.5,False,eat)
    clips['Wave']=(1.8,False,lambda t:hand_action(t,1.8,face+np.array([.36,-.02,-.08]),True))

    def tuck(t,mode):
        pose=base()
        phase=math.sin(math.pi*t) if mode=='Jump' else 1
        for i,path in enumerate(lower):
            q=path.copy()
            factor=np.linspace(0,1,len(q))
            # Keep the reconstructed membrane coherent. The arm tips lift
            # gently during a leap; on a saddle they rest around the mantle.
            if mode=='Jump': q[:,2]+=.055*phase*factor
            pose['chains'][f'Tentacle{i+1}']=q
        pose['rotations']['Chest']=((1,0,0),-.045*phase)
        if mode!='Jump': breath(pose,t,2)
        return pose
    clips['Jump']=(1,False,lambda t:tuck(t,'Jump'))
    clips['Ride_Loop']=(2,True,lambda t:tuck(t,'Ride_Loop'))
    clips['Boat_Loop']=(2,True,lambda t:tuck(t,'Boat_Loop'))

    def downed(t):
        pose=base()
        fall=smooth(t/.85)
        pose['rotations']['Spine']=((1,0,0),.32*fall)
        pose['rotations']['Chest']=((1,0,0),.20*fall)
        pose['rotations']['Head']=((1,0,0),.22*fall)
        q=folded.copy()
        q[:,2]-=.08*fall*np.linspace(0,1,len(q))
        pose['chains']['ArmR']=fit(q,lengths['ArmR'])
        return pose
    clips['Downed']=(1.4,False,downed)
    return clips
