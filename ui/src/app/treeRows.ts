/*
  Which rows the Files tree draws (FileTree.tsx): the ones a person can see, and no others. A folder that is shut gives
  its own row and none of what it holds, and the tree draws at most `limit` rows at a time, with a way to ask for more.
  Liner's TreeView drew every row of every folder and hid the shut ones by height, so a folder of 5,000 files (an ads
  folder full of video frames) put 50,000 parts on the page: each style pass read them all, and the panel took a
  third of a second to open and the whole window stuttered while Files was up (2026-11-27).
*/
export type TreeNode = { id: string; label: string; meta?: string; children?: TreeNode[] };
export type TreeRow = { node: TreeNode; level: number; parent: string | null };

/** How many rows the tree draws at a time: more than a tall panel shows, few enough to cost nothing. */
export const TREE_ROWS = 400;

/**
  The rows on screen, top to bottom: each node, and under an open folder what it holds. `rows` stops at `limit`; `more`
  is how many it left out. Rows come in the order they are drawn, so a row that is in has every folder over it in too.
*/
export function treeRows(nodes: TreeNode[], open: ReadonlySet<string>, limit = Infinity): { rows: TreeRow[]; more: number } {
  const rows: TreeRow[] = [];
  let more = 0;
  const walk = (list: TreeNode[], level: number, parent: string | null) => {
    for (const node of list) {
      if (rows.length < limit) rows.push({ node, level, parent });
      else more++;
      if (node.children && open.has(node.id)) walk(node.children, level + 1, node.id);
    }
  };
  walk(nodes, 1, null);
  return { rows, more };
}

/**
  The row that takes the keyboard (tabIndex 0, and where the arrow keys start): the one last focused while it is still
  drawn, else the first. A refresh that took the focused row away, or shut the folder over it, left no row to Tab to
  and keys that did nothing until a click.
*/
export const focusOf = (rows: TreeRow[], focus: string | undefined) => (focus !== undefined && rows.some((r) => r.node.id === focus) ? focus : rows[0]?.node.id);
