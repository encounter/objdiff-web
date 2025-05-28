import styles from './TooltipShared.module.css';

import type { display } from 'objdiff-wasm';
import React, { useCallback, useMemo } from 'react';
import { Tooltip } from 'react-tooltip';

type TooltipProps = {
  'data-tooltip-id': string;
  'data-tooltip-content': string;
};

export type TooltipCallback<T> = (content: T) => display.HoverItem[] | null;

export function createTooltip<T>(): {
  Tooltip: React.FC<{
    callback: TooltipCallback<T>;
  }>;
  useTooltip: (content: T) => TooltipProps;
} {
  const id = generateRandomString(10);
  return {
    Tooltip: ({ callback }) => {
      const callbackMemo = useCallback(
        (content: string) => {
          if (!content) {
            return null;
          }
          const parsedContent = JSON.parse(content) as T;
          return callback(parsedContent);
        },
        [callback],
      );
      return <TooltipShared id={id} callback={callbackMemo} />;
    },
    useTooltip: (content: T) =>
      // useMemo(
      //   () => ({
      //     'data-tooltip-id': id,
      //     'data-tooltip-content': JSON.stringify(content),
      //   }),
      //   [content],
      // ),
      ({
        'data-tooltip-id': id,
        'data-tooltip-content': JSON.stringify(content),
      }),
  };
}

const TooltipShared = ({
  id,
  callback,
}: {
  id: string;
  callback: (content: string) => display.HoverItem[] | null;
}) => {
  return (
    <Tooltip
      id={id}
      place="bottom"
      className={styles.tooltip}
      delayShow={500}
      render={({ content }) => {
        const items = useMemo(() => {
          if (!content) {
            return null;
          }
          return callback(content);
        }, [callback, content]);
        if (!items) {
          return null;
        }
        return <TooltipContentMemo items={items} />;
      }}
    />
  );
};

const TooltipContent = ({ items }: { items: display.HoverItem[] }) => {
  const out = [];
  for (const [i, item] of items.entries()) {
    let inner: React.ReactNode;
    switch (item.tag) {
      case 'text':
        if (item.val.label) {
          inner = (
            <>
              <span className={styles.hoverItemLabel}>
                {item.val.label}
                {': '}
              </span>
              <span className={styles.hoverItemValue}>{item.val.value}</span>
            </>
          );
        } else {
          inner = (
            <span className={styles.hoverItemValue}>{item.val.value}</span>
          );
        }
        break;
      case 'separator':
        inner = <hr className={styles.hoverItemSeparator} />;
        break;
      default:
        console.warn('Unhandled context item', item);
        inner = null;
        break;
    }
    out.push(
      <div key={i} className={styles.hoverItem}>
        {inner}
      </div>,
    );
  }
  return <div>{out}</div>;
};

const TooltipContentMemo = React.memo(TooltipContent);

function generateRandomString(length: number): string {
  const characters =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}
