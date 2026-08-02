import styles from './PercentBadge.module.css';

import clsx from 'clsx';
import { percentClass } from '../util/util';

/**
 * A match percentage with a small progress bar.
 *
 * The bar makes it possible to compare symbols at a glance without reading
 * every number, which matters in a list of hundreds.
 */
export const PercentBadge = ({
  percent,
  showBar = true,
  size = 'normal',
  decimals = 0,
}: {
  percent: number;
  showBar?: boolean;
  size?: 'normal' | 'large';
  decimals?: number;
}) => {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <span
      className={clsx(
        styles.badge,
        percentClass(percent),
        size === 'large' && styles.large,
      )}
      title={`${percent.toFixed(2)}% matched`}
    >
      <span className={styles.value}>
        {/* Floor so that 99.99% never rounds up to a misleading 100%. */}
        {Math.floor(percent * 10 ** decimals) / 10 ** decimals}%
      </span>
      {showBar && (
        <span className={styles.bar}>
          <span className={styles.fill} style={{ width: `${clamped}%` }} />
        </span>
      )}
    </span>
  );
};

export default PercentBadge;
