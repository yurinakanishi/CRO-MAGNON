import { normalizeCharacter } from '/shared/characters.mjs';

const choices=[
  ['cro','クロマニョン人','この谷へやってきた、槍を使う旅人。'],
  ['nea','ネアンデルタール人','森と暮らす、槍を使う隣人。'],
  ['cat','猫耳のクノイチ','素早く斬り込む、刀の使い手。'],
  ['bear','こぐまの魔法使い','小さな両手から、光の魔法を放つ。'],
];

export function characterChoicesMarkup() {
  return `<fieldset class="character-options"><legend>キャラクター</legend><div class="character-choice-grid">${choices.map(([key,name,description])=>`<label class="species-option character-choice"><input type="radio" name="species" value="${key}" required><span class="portrait ${key}"><i></i></span><span><strong>${name}</strong><small>${description}</small></span></label>`).join('')}</div></fieldset><fieldset id="gender-choice" class="gender-options"><legend>人間の姿</legend><label class="species-option"><input type="radio" name="gender" value="female"><span><strong>女性</strong></span></label><label class="species-option"><input type="radio" name="gender" value="male"><span><strong>男性</strong></span></label></fieldset>`;
}

export function bindCharacterSelection(form,profile) {
  const normalized=normalizeCharacter(profile);
  form.querySelector(`input[name="species"][value="${normalized.species}"]`).checked=true;
  form.querySelector(`input[name="gender"][value="${normalized.gender}"]`).checked=true;
  const update=()=>{
    const choice=form.querySelector('input[name="species"]:checked').value,humanoid=choice==='cro'||choice==='nea';
    const gender=form.querySelector('#gender-choice');gender.hidden=!humanoid;gender.disabled=!humanoid;
  };
  for(const input of form.querySelectorAll('input[name="species"]'))input.addEventListener('change',update);
  update();
}
