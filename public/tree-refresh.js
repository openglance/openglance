export function hasTreeChanged(previousTree, nextTree) {
  return JSON.stringify(previousTree) !== JSON.stringify(nextTree);
}

// Update a successful local save without rediscovering every repository file.
export function updateTreeDocumentTitle(nodes, documentPath, title) {
  for (const node of nodes) {
    if (node.type === "directory") {
      if (updateTreeDocumentTitle(node.children, documentPath, title)) return true;
    } else if (node.path === documentPath) {
      const next = String(title ?? "");
      if ((node.title ?? "") === next) return false;
      if (next) node.title = next;
      else delete node.title;
      return true;
    }
  }
  return false;
}
