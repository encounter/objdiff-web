import styles from './util.module.css';

import { useEffect, useState } from 'react';

export const getCssVariablePx = (name: string) => {
  const value = getComputedStyle(document.body).getPropertyValue(name);
  if (!value.endsWith('px')) {
    throw new Error(`Expected ${name} to be in px, got ${value}`);
  }
  return Number.parseInt(value.slice(0, -2), 10);
};

export const CSS_VAR_FONT_SIZE = '--code-font-size';

export const useFontSize = () => {
  const [fontSize, setFontSize] = useState<number>(() =>
    getCssVariablePx(CSS_VAR_FONT_SIZE),
  );
  useEffect(() => {
    const observer = new MutationObserver((_mutations) => {
      setFontSize(getCssVariablePx(CSS_VAR_FONT_SIZE));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['style'],
    });
    return () => {
      observer.disconnect();
    };
  }, []);
  return fontSize;
};

export const percentClass = (percent: number) => {
  if (percent === 100) {
    return styles.percent100;
  }
  if (percent >= 50) {
    return styles.percent50;
  }
  return styles.percent0;
};
