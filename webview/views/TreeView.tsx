import clsx from 'clsx';
import type { ListChildComponentProps } from 'react-window';
import styles from './TreeView.module.css';

export type NodeInner<T> = {
  id: string;
  indent: number;
  path: string[];
  data: T;
};

export type BranchNode<T> = NodeInner<T> & {
  type: 'branch';
  collapsed: boolean;
};

export type LeafNode<T> = NodeInner<T> & {
  type: 'leaf';
};

export type Node<B, L> = BranchNode<B> | LeafNode<L>;

export type TreeData<B, L> = {
  leafCount: number;
  nodes: Node<B, L>[];
  highlightedPath: string | null;
  setHighlightedPath: (id: string | null) => void;
};

export type TreeRowProps<B, L> = ListChildComponentProps<TreeData<B, L>> & {
  rowProps?: React.HTMLProps<HTMLDivElement> | null;
  render: (item: Node<B, L>) => React.ReactNode;
  getClasses?: (item: Node<B, L>) => string[];
  onLeafClick?: (item: LeafNode<L>) => void;
  onHover?: (item: Node<B, L>) => void;
  setBranchCollapsed?: (id: string, collapsed: boolean) => void;
};

export function TreeRow<B, L>({
  index,
  style,
  data: { nodes, highlightedPath, setHighlightedPath },
  rowProps,
  render,
  getClasses,
  onLeafClick,
  onHover,
  setBranchCollapsed,
}: TreeRowProps<B, L>) {
  const node = nodes[index];
  const classes = [styles.row];
  if (node.type === 'branch' && node.collapsed) {
    classes.push(styles.collapsed);
  }
  classes.push(...(getClasses?.(node) ?? []));
  const indentItems = [];
  for (let i = 0; i < node.indent; i++) {
    indentItems.push(
      <span
        key={i}
        className={clsx(
          styles.indent,
          node.path[i] === highlightedPath && styles.indentHighlighted,
        )}
      />,
    );
  }
  if (node.type === 'branch') {
    indentItems.push(
      <span
        key="toggle"
        className={clsx(
          styles.toggle,
          'codicon',
          node.collapsed ? 'codicon-chevron-right' : 'codicon-chevron-down',
        )}
      />,
    );
  }
  return (
    <div
      className={clsx(classes)}
      style={style}
      {...rowProps}
      onClick={() => {
        if (node.type === 'leaf') {
          onLeafClick?.(node);
        } else {
          const collapsed = !node.collapsed;
          setBranchCollapsed?.(node.id, collapsed);
          setHighlightedPath(
            collapsed ? node.path[node.path.length - 1] : node.id,
          );
        }
      }}
      onMouseEnter={() => {
        onHover?.(node);
        setHighlightedPath(
          node.type === 'leaf' || node.collapsed
            ? node.path[node.path.length - 1]
            : node.id,
        );
      }}
    >
      {indentItems}
      {render(node)}
    </div>
  );
}

type NodeWithChildren<B, L> = BranchNode<B> & {
  children: (NodeWithChildren<B, L> | LeafNode<L>)[];
};

export type SimpleTreeNodeData = { label: string };
export type SimpleTreeData<L> = TreeData<
  SimpleTreeNodeData,
  L & SimpleTreeNodeData
>;

// Build a simple tree structure by splitting the path of each item
// into components (splitting on '/') and creating a tree node for
// each component.
export function buildSimpleTree<L>(
  items: L[],
  getPath: (item: L) => string,
  collapsed: Record<string, boolean>,
  highlightedPath: string | null,
  setHighlightedPath: (id: string | null) => void,
): SimpleTreeData<L> {
  type SimpleTreeNode = NodeWithChildren<
    SimpleTreeNodeData,
    L & SimpleTreeNodeData
  >;
  const map = new Map<string, SimpleTreeNode>();
  const rootNodes = [];
  for (const item of items) {
    const path = getPath(item);
    const split = path.split('/');
    let parent: SimpleTreeNode | null = null;
    for (let i = 0; i < split.length - 1; i++) {
      const name = split[i];
      const dirPath = split.slice(0, i + 1);
      const key = dirPath.join('/');
      let node = map.get(key);
      if (!node) {
        node = {
          type: 'branch',
          id: key,
          indent: i,
          collapsed: !!collapsed[key],
          children: [],
          path: buildPath(dirPath),
          data: { label: name },
        };
        if (parent) {
          parent.children.push(node);
        } else {
          rootNodes.push(node);
        }
        map.set(key, node);
      }
      parent = node;
    }
    const node: LeafNode<L & SimpleTreeNodeData> = {
      type: 'leaf',
      id: path,
      indent: split.length - 1,
      path: buildPath(split),
      data: {
        ...item,
        label: split[split.length - 1],
      },
    };
    if (parent) {
      parent.children.push(node);
    } else {
      rootNodes.push(node);
    }
  }
  const nodes: SimpleTreeData<L>['nodes'] = [];
  for (const node of rootNodes) {
    pushNodes(node, nodes);
  }
  return {
    leafCount: items.length,
    nodes,
    highlightedPath,
    setHighlightedPath,
  };
}

function pushNodes<B, L>(
  item: NodeWithChildren<B, L> | LeafNode<L>,
  out: Node<B, L>[],
) {
  if (item.type === 'branch') {
    out.push(item);
    if (!item.collapsed) {
      for (const child of item.children) {
        pushNodes(child, out);
      }
    }
  } else if (item.type === 'leaf') {
    out.push(item);
  }
}

function buildPath(split: string[]) {
  const path = [];
  for (let i = 0; i < split.length - 1; i++) {
    path.push(split.slice(0, i + 1).join('/'));
  }
  return path;
}
