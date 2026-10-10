import { characterModel } from './characters.mjs';
import type { CharacterProfile, EquipmentId } from './types.mjs';

/** Ownership stays on tool/spearHead; this single slot is the item in use. */
export function ownsEquipment(
  player: CharacterProfile | null | undefined,
  id: unknown,
): id is EquipmentId {
  if (!player) return false;
  if (id === 'axe') return !!player.tool;
  const native = !!characterModel(player).weapon;
  if (id === 'character') return native;
  if (id === 'spear') return !native;
  return id === 'obsidianSpear' && !native && player.spearHead === 'obsidian';
}

export function equippedItem(player: CharacterProfile): EquipmentId {
  if (ownsEquipment(player, player.equippedItem)) return player.equippedItem!;
  // Old saves retain their weapon and all owned tools, with exactly one active item.
  if (characterModel(player).weapon) return 'character';
  return player.spearHead === 'obsidian' ? 'obsidianSpear' : 'spear';
}

export function equipmentInfo(player: CharacterProfile, id: EquipmentId) {
  if (id === 'axe')
    return { name: '石斧', icon: 'axe', note: '採集用・装備中は木材と石の採集量が2倍' };
  if (id === 'spear') return { name: '木槍', icon: 'spear', note: '攻撃力15' };
  if (id === 'obsidianSpear') return { name: '黒曜石の槍', icon: 'spear', note: '攻撃力30' };
  const weapon = characterModel(player).weapon!;
  return {
    name: {
      katana: '刀',
      magic: '光の魔法',
      unarmed: '大きな手',
      science: '科学パルス',
      tentacle: '触手',
    }[weapon],
    icon: weapon,
    note: 'キャラクターの攻撃',
  };
}
