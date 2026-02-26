import { useEffect, useState } from 'react';
import { useMotionValue, useSpring, useTransform } from 'framer-motion';

interface AnimatedNumberProps {
  value: number;
  /** Format function — receives the animated number, returns display string */
  format?: (n: number) => string;
  className?: string;
  /** Spring duration in seconds (default 0.8) */
  duration?: number;
}

export default function AnimatedNumber({
  value,
  format = (n) => Math.round(n).toLocaleString(),
  className,
  duration = 0.8,
}: AnimatedNumberProps) {
  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, {
    duration: duration * 1000,
    bounce: 0,
  });
  const display = useTransform(spring, (v) => format(v));
  const [displayText, setDisplayText] = useState(format(0));

  useEffect(() => {
    motionValue.set(value);
  }, [value, motionValue]);

  useEffect(() => {
    const unsubscribe = display.on('change', (v) => {
      setDisplayText(v);
    });
    return unsubscribe;
  }, [display]);

  return <span className={className}>{displayText}</span>;
}
