import { useEffect, useState } from 'react';

export const getCssVariablePx = (name: string) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(
    name,
  );
  if (!value.endsWith('px')) {
    throw new Error(`Expected ${name} to be in px, got ${value}`);
  }
  return Number.parseInt(value.slice(0, -2), 10);
};

export const CSS_VAR_FONT_SIZE = '--font-size';

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
    return () => {
      observer.disconnect();
    };
  }, []);
  return fontSize;
};
