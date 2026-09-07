import { BOATING } from '../shared/boats.mjs';

export class BoatRenderer {
  constructor(world){this.world=world;this.boats=new Map();}
  update(time,dt){
    const world=this.world,present=new Set();
    for(const state of world.state.boats||[]){
      present.add(state.id);let entry=this.boats.get(state.id);
      if(!entry){const model=world.worldAssets.create('dugout-canoe');model.name=state.id;model.userData.boatId=state.id;model.position.set(state.x,BOATING.waterY-.28,state.z);model.rotation.y=state.facing;world.scene.add(model);entry={model};this.boats.set(state.id,entry);}
      entry.state=state;const model=entry.model;
      const factor=Math.hypot(model.position.x-state.x,model.position.z-state.z)>6?1:1-Math.exp(-dt*20);
      model.position.x+=(state.x-model.position.x)*factor;model.position.z+=(state.z-model.position.z)*factor;
      model.position.y=BOATING.waterY-.28+Math.sin(time*1.6+state.x*.1)*.012;
      model.rotation.y+=Math.atan2(Math.sin(state.facing-model.rotation.y),Math.cos(state.facing-model.rotation.y))*factor;
      model.visible=Math.hypot(state.x-world.focus.x,state.z-world.focus.z)<125;
      model.updateMatrixWorld(true);
    }
    for(const[id,entry]of this.boats)if(!present.has(id)){world.scene.remove(entry.model);this.boats.delete(id);}
    world.canvas.dataset.boats=String(this.boats.size);
  }
  seat(id,out){const boat=this.boats.get(id);return boat?.model.localToWorld(out.set(0,.67,-1.3));}
  dispose(){for(const entry of this.boats.values())this.world.scene.remove(entry.model);this.boats.clear();}
}
