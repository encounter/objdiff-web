import clsx from 'clsx';
import styles from './TooltipShared.module.css';

import type { display } from 'objdiff-wasm';
import React, { useMemo } from 'react';
import { Tooltip } from 'react-tooltip';

export type TooltipTriggerProps = {
  'data-tooltip-id': string;
  'data-tooltip-content': string;
};

export type TooltipCallback<T> = (content: T) => display.HoverItem[] | null;

export type TooltipProps<T> = Omit<
  React.ComponentProps<typeof Tooltip>,
  'id' | 'render'
> & {
  callback: TooltipCallback<T>;
};

export function createTooltip<T>(): {
  Tooltip: React.FC<TooltipProps<T>>;
  useTooltip: (content: T) => TooltipTriggerProps;
} {
  const id = generateRandomString(10);
  return {
    Tooltip: ({ callback, className, ...props }) => (
      <Tooltip
        {...props}
        id={id}
        className={clsx(styles.tooltip, className)}
        render={({ content }) => {
          const items = useMemo(() => {
            if (!content) {
              return null;
            }
            const parsedContent = JSON.parse(content) as T;
            return callback(parsedContent);
          }, [callback, content]);
          if (!items || items.length === 0) {
            return null;
          }
          return <TooltipContentMemo items={items} />;
        }}
      />
    ),
    useTooltip: (content: T) => ({
      'data-tooltip-id': id,
      'data-tooltip-content': JSON.stringify(content),
    }),
  };
}

const TooltipContent = ({ items }: { items: display.HoverItem[] }) => {
  const out = [];
  for (const [i, item] of items.entries()) {
    let inner: React.ReactNode;
    switch (item.tag) {
      case 'text': {
        let labelClass: string | null = null;
        let valueClass: string | null = null;
        switch (item.val.color) {
          case 'special':
            labelClass = styles.labelColorSpecial;
            break;
          case 'insert':
            labelClass = styles.labelColorInsert;
            break;
          case 'delete':
            labelClass = styles.labelColorDelete;
            break;
          case 'emphasized':
            valueClass = styles.valueColorEmphasized;
            break;
          default:
            break;
        }
        if (item.val.label) {
          inner = (
            <>
              <span className={clsx(styles.hoverItemLabel, labelClass)}>
                {item.val.label}
                {': '}
              </span>
              <span className={clsx(styles.hoverItemValue, valueClass)}>
                {item.val.value}
              </span>
            </>
          );
        } else {
          inner = (
            <span className={clsx(styles.hoverItemValue, valueClass)}>
              {item.val.value}
            </span>
          );
        }
        break;
      }
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
