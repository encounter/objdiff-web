import styles from './TooltipShared.module.css';

import type { display } from 'objdiff-wasm';
import React, { useMemo } from 'react';
import { Tooltip } from 'react-tooltip';

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

export default TooltipShared;
