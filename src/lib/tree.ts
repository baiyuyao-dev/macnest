import type { Group } from "@/types";

export interface GroupNode extends Group {
  children: GroupNode[];
}

export function buildGroupTree(groups: Group[]): GroupNode[] {
  const map = new Map<number, GroupNode>();
  const roots: GroupNode[] = [];

  for (const g of groups) {
    map.set(g.id, { ...g, children: [] });
  }

  for (const g of groups) {
    const node = map.get(g.id)!;
    if (g.parent_id != null && map.has(g.parent_id)) {
      map.get(g.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export function flattenGroups(
  nodes: GroupNode[],
  depth = 0
): { id: number; name: string; depth: number }[] {
  const result: { id: number; name: string; depth: number }[] = [];
  for (const n of nodes) {
    result.push({ id: n.id, name: n.name, depth });
    result.push(...flattenGroups(n.children, depth + 1));
  }
  return result;
}

export function collectDescendantIds(node: GroupNode): number[] {
  const ids = [node.id];
  for (const child of node.children) {
    ids.push(...collectDescendantIds(child));
  }
  return ids;
}

export function filterGroupTree(nodes: GroupNode[], query: string): GroupNode[] {
  const q = query.toLowerCase();
  const result: GroupNode[] = [];
  for (const node of nodes) {
    const matchSelf = node.name.toLowerCase().includes(q);
    const filteredChildren = filterGroupTree(node.children, query);
    if (matchSelf || filteredChildren.length > 0) {
      result.push({
        ...node,
        children: matchSelf ? node.children : filteredChildren,
      });
    }
  }
  return result;
}
