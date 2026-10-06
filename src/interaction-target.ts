export interface InteractionTarget {
  action: string;
  label: string;
  targetId?: string;
}
export type PreferredPet = 'rimo' | '524' | InteractionTarget;

/** Shared by ordinary assisted controls and hand controls. */
export function interactionTarget(
  pet: PreferredPet | null,
  nearby: InteractionTarget | null,
): InteractionTarget | null {
  if (pet)
    return typeof pet === 'object'
      ? pet
      : {
          action: pet === 'rimo' ? 'petRimo' : 'pet524',
          label: pet === 'rimo' ? 'りもねこを撫でる' : '524を撫でる',
        };
  return nearby;
}
