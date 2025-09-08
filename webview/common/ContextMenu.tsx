import type { display } from 'objdiff-wasm';
import styles from './ContextMenu.module.css';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

export type ContextMenuCallback<T> = (
  e: React.MouseEvent<HTMLElement>,
  data: T,
) => void;

export type ContextMenuState<T> = Readonly<{
  visible: boolean;
  clickPosition: { x: number; y: number };
  position: { x: number; y: number };
  target: HTMLElement;
  data: T;
}>;

export type ContextMenuRender<T> = (
  state: ContextMenuState<T>,
  close: () => void,
) => React.ReactNode;

export type ContextMenuProps<T> = React.PropsWithChildren<{
  className?: string;
  render?: ContextMenuRender<T>;
}>;

export function createContextMenu<T>(): {
  ContextMenuProvider: React.FC<ContextMenuProps<T>>;
  useContextMenu: () => ContextMenuCallback<T>;
} {
  const Context = createContext<ContextMenuCallback<T>>((e) => {
    e.preventDefault();
  });
  return {
    ContextMenuProvider: ({
      children,
      className,
      render,
    }: ContextMenuProps<T>) => {
      const elemRef = useRef<HTMLDivElement | null>(null);
      const [state, setState] = useState<ContextMenuState<T> | null>(null);

      const callback = useCallback<ContextMenuCallback<T>>((e, data) => {
        e.preventDefault();
        setState({
          visible: false,
          clickPosition: { x: e.clientX, y: e.clientY },
          position: { x: e.clientX, y: e.clientY },
          target: e.target as HTMLElement,
          data,
        });
      }, []);

      const close = useCallback(() => setState(null), []);

      const closeIfOutside = useCallback(
        (e: Event) => {
          if (elemRef.current && !elemRef.current.contains(e.target as Node)) {
            close();
          }
        },
        [close],
      );

      useEffect(() => {
        const clickOptions = { capture: true };
        const scrollOptions = { capture: true, passive: true };
        const resizeOptions = { passive: true };

        document.addEventListener('click', closeIfOutside, clickOptions);
        document.addEventListener('mousedown', closeIfOutside, clickOptions);
        document.addEventListener('scroll', closeIfOutside, scrollOptions);
        window.addEventListener('resize', close, resizeOptions);

        return () => {
          document.removeEventListener('click', closeIfOutside, clickOptions);
          document.removeEventListener(
            'mousedown',
            closeIfOutside,
            clickOptions,
          );
          document.removeEventListener('scroll', closeIfOutside, {
            capture: true,
          });
          window.removeEventListener('resize', close);
        };
      }, [closeIfOutside, close]);

      // Close context menu if target element is removed
      useEffect(() => {
        if (state?.target?.parentNode) {
          const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
              // biome-ignore lint/complexity/noForEach: NodeList
              mutation.removedNodes.forEach((node) => {
                if (node === state.target) {
                  close();
                }
              });
            }
          });
          observer.observe(state.target.parentNode, {
            childList: true,
          });
          return () => observer.disconnect();
        }
      }, [state?.target, close]);

      // biome-ignore lint/correctness/useExhaustiveDependencies: on purpose
      useEffect(() => {
        const tooltip = elemRef.current;
        if (!state?.clickPosition || !tooltip) {
          return;
        }
        const rect = tooltip.getBoundingClientRect();
        let x = state.clickPosition.x;
        let y = state.target.getBoundingClientRect().bottom;
        if (x < 10) {
          x = 10;
        } else if (x + rect.width > window.innerWidth - 10) {
          x = window.innerWidth - 10 - rect.width;
        }
        if (y + rect.height > window.innerHeight - 10) {
          y = window.innerHeight - 10 - rect.height;
        }
        setState((prev) => ({
          ...prev!,
          position: { x, y },
          visible: true,
        }));
      }, [state?.clickPosition]);

      let tooltip: React.ReactNode = null;
      if (state?.position) {
        const children = render?.(state, close);
        if (children) {
          tooltip = (
            <div
              ref={elemRef}
              className={
                styles.contextMenu + (className ? ` ${className}` : '')
              }
              style={{
                position: 'fixed',
                top: state.position.y,
                left: state.position.x,
                visibility: state.visible ? 'visible' : 'hidden',
              }}
            >
              {children}
            </div>
          );
        }
      }

      return (
        <>
          <Context.Provider value={callback}>{children}</Context.Provider>
          {tooltip}
        </>
      );
    },
    useContextMenu: () => useContext(Context),
  };
}

export function renderContextItems(
  items: display.ContextItem[],
  close: () => void,
): React.ReactNode {
  if (items.length === 0) {
    return null;
  }
  return items.map((item, i) => {
    const key = `${item.tag}-${i}`;
    switch (item.tag) {
      case 'copy':
        return (
          <div
            key={key}
            className={styles.contextMenuItem}
            onClick={() => {
              navigator.clipboard.writeText(item.val.value).then(
                () => close(),
                (e) => console.warn('Failed to copy:', e),
              );
            }}
          >
            <span className={styles.contextMenuItemLabel}>Copy "</span>
            <span className={styles.contextMenuItemValue}>
              {item.val.value}
            </span>
            <span className={styles.contextMenuItemLabel}>
              "{item.val.label ? ` (${item.val.label})` : ''}
            </span>
          </div>
        );
      case 'navigate':
        return (
          <div
            key={key}
            className={styles.contextMenuItem}
            onClick={() => {
              // TODO
            }}
          >
            {item.val.label}
          </div>
        );
      case 'separator':
        return <hr key={key} className={styles.contextMenuSeparator} />;
      default:
        return null;
    }
  });
}
