// Only appended by the separate loopback QA server. Nothing enters production.
{
  const original = WorldRenderer.prototype.render;
  let panel, report, world, previous = 0;
  const clipsSeen = new Set(), peersSeen = new Set(), events = [], errors = [];
  window.addEventListener('error', e => errors.push(e.message));
  window.addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
  WorldRenderer.prototype.render = function (...args) {
    const result = original.apply(this, args); world = this;
    if (!panel) {
      panel = document.createElement('aside'); panel.id = 'maruimo-qa';
      panel.style.cssText = 'position:fixed;z-index:3000;right:12px;bottom:12px;background:#fffE;color:#222;padding:10px;max-width:440px;border-radius:10px;font:12px monospace;max-height:42vh;overflow:auto';
      panel.innerHTML = '<strong>まるぃも ローカル検証</strong><div id="qa-controls"></div><pre id="qa-report"></pre>';
      document.body.append(panel); report = panel.querySelector('#qa-report');
      const controls = panel.querySelector('#qa-controls');
      for (const [key, label] of [['clear','平地へ'],['pet','猫のそばへ'],['companion','524のそばへ'],['resource','採集場所へ'],['camp','キャンプへ'],['mammoth','マンモスのそばへ'],['shore','舟のそばへ'],['bridge','橋へ'],['peers','通信3人を追加'],['front','正面を見る'],['behind','後方へ戻す'],['far','遠景を見る'],['near','近くを見る']]) {
        const button = document.createElement('button'); button.textContent = label;
        button.onclick = async () => {
          if (['front','behind'].includes(key)) { world.yaw = key==='front'?2.6:0; world.pitch=.15; }
          else if (['near','far'].includes(key)) world.targetDistance=key==='near'?3:34;
          else {
            const reply = await fetch('/qa/maruimo-fixture', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:world.selfId,kind:key})}).then(r=>r.json());
            events.push(reply);
            if (world.rimoNekoRenderer) world.rimoNekoRenderer.placed=false;
          }
          document.querySelector('#world')?.focus();
        };
        controls.append(button);
      }
    }
    const self = this.players.get(this.selfId), actor = self?.actor;
    if (actor) clipsSeen.add(actor.animation.name);
    for (const other of this.players.values()) if (other.actor) peersSeen.add(other.actor.asset.modelKey);
    if (performance.now()-previous>150) {
      previous=performance.now();
      const p=self?.state;
      report.textContent=JSON.stringify({id:this.selfId,people:this.players.size,model:actor?.asset.modelKey,
        sha256:actor?.asset.sha256,clip:actor?.animation.name,clipsSeen:[...clipsSeen],modelsSeen:[...peersSeen],
        position:p?[p.x,p.z]:null,attackSequence:p?.attackSequence,jumpSequence:p?.jumpSequence,mountId:p?.mountId,boatId:p?.boatId,
        lod:actor?.root.userData.actorDetail?.level,
        gathered:p?.gathered,inventory:p?.inventory,petWeight:actor?.groundPettingPose.weight,
        petGap:actor?.groundPettingPose.weight>.9?actor.groundPettingPose.contact.distanceTo(actor.groundPettingPose.requested):null,
        catFriend:this.state.rimoNeko?.followPlayerId,companionFriend:this.state.companion524?.followPlayerId,
        actors:[...this.players.values()].filter(e=>e.actor).map(e=>({id:e.state.id,key:e.actor.asset.modelKey,clip:e.actor.animation.name})),
        lastFixture:events.at(-1),errors},null,2);
    }
    return result;
  };
}
