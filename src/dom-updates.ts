export function setText(node: Node, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}
