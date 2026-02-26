import { motion, AnimatePresence } from 'framer-motion';
import type { ReactNode } from 'react';

interface AnimatedListItemProps {
  children: ReactNode;
  /** Unique key for AnimatePresence tracking */
  itemKey: string | number;
  /** Stagger index (used for delay calculation) */
  index?: number;
  /** Renders as <tr> for table rows, <div> otherwise */
  as?: 'tr' | 'div';
  className?: string;
  onClick?: () => void;
}

const itemVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.03,
      duration: 0.2,
      ease: [0.25, 0.1, 0.25, 1] as const,
    },
  }),
  exit: { opacity: 0, y: -4, transition: { duration: 0.15 } },
};

export function AnimatedListItem({
  children,
  itemKey,
  index = 0,
  as = 'div',
  className,
  onClick,
}: AnimatedListItemProps) {
  const Component = as === 'tr' ? motion.tr : motion.div;

  return (
    <Component
      key={itemKey}
      layout
      custom={index}
      initial="hidden"
      animate="visible"
      exit="exit"
      variants={itemVariants}
      className={className}
      onClick={onClick}
    >
      {children}
    </Component>
  );
}

interface AnimatedListProps {
  children: ReactNode;
  className?: string;
  /** Renders as <tbody> for tables, <div> otherwise */
  as?: 'tbody' | 'div';
}

export function AnimatedList({
  children,
  className,
  as = 'div',
}: AnimatedListProps) {
  const Component = as === 'tbody' ? 'tbody' : 'div';

  return (
    <Component className={className}>
      <AnimatePresence mode="popLayout">
        {children}
      </AnimatePresence>
    </Component>
  );
}
