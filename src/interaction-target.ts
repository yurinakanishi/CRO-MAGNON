export interface InteractionTarget {
  action: string;
  label: string;
  targetId?: string;
}

/** Shared by ordinary assisted controls and hand controls: a companion to stroke first. */
export function interactionTarget(
  pet: InteractionTarget | null,
  nearby: InteractionTarget | null,
): InteractionTarget | null {
  return pet ?? nearby;
}
