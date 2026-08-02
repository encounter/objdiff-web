import styles from './Sidebar.module.css';

import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_WIDTH = 180;
const DEFAULT_WIDTH = 300;
const STORAGE_KEY = 'sidebarWidth';

const readStoredWidth = (): number => {
  const stored = Number(localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(stored) && stored >= MIN_WIDTH
    ? stored
    : DEFAULT_WIDTH;
};

/**
 * A collapsible, resizable left panel.
 *
 * Used to keep the symbol list and its filter visible while a function diff is
 * open, so navigating between symbols doesn't mean going back a screen first.
 */
export const Sidebar = ({
  title,
  collapsed,
  onToggle,
  children,
  content,
}: {
  title: React.ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  /** The sidebar's own content. */
  children: (width: number) => React.ReactNode;
  /** The main area to the right of the sidebar. */
  content: React.ReactNode;
}) => {
  const [width, setWidth] = useState(readStoredWidth);
  const [dragging, setDragging] = useState(false);
  const layoutRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dragging) {
      return;
    }
    const onMove = (e: MouseEvent) => {
      const left = layoutRef.current?.getBoundingClientRect().left ?? 0;
      const next = Math.max(MIN_WIDTH, e.clientX - left);
      setWidth(next);
    };
    const onUp = () => {
      setDragging(false);
      localStorage.setItem(STORAGE_KEY, String(width));
    };
    // Capture so the drag keeps working over the virtualized list.
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, width]);

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  if (collapsed) {
    return (
      <div className={styles.layout} ref={layoutRef}>
        <div className={styles.collapsedStrip}>
          <button
            type="button"
            title="Show symbols (Ctrl+B)"
            onClick={onToggle}
          >
            <span className="codicon codicon-layout-sidebar-left" />
          </button>
        </div>
        <div className={styles.main}>{content}</div>
      </div>
    );
  }

  return (
    <div className={styles.layout} ref={layoutRef}>
      <div
        className={styles.sidebar}
        style={{ ['--sidebar-width' as string]: `${width}px` }}
      >
        <div className={styles.header}>
          <div className={styles.title}>
            {title}
            <span className={styles.spacer} />
            <button
              type="button"
              title="Hide symbols (Ctrl+B)"
              onClick={onToggle}
            >
              <span className="codicon codicon-chevron-left" />
            </button>
          </div>
        </div>
        <div className={styles.list}>{children(width)}</div>
      </div>
      <button
        type="button"
        aria-label="Resize sidebar"
        className={clsx(styles.resizer, dragging && styles.dragging)}
        onMouseDown={startDrag}
      />
      <div className={styles.main}>{content}</div>
    </div>
  );
};

/** Ctrl+B toggles the sidebar, matching the editor convention. */
export const useSidebarToggle = (): [boolean, () => void] => {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('sidebarCollapsed') === '1',
  );
  const toggle = useCallback(
    () =>
      setCollapsed((v) => {
        localStorage.setItem('sidebarCollapsed', v ? '0' : '1');
        return !v;
      }),
    [],
  );
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);
  return [collapsed, toggle];
};

export default Sidebar;
