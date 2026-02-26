import { motion, AnimatePresence } from 'framer-motion';
import type { ReactNode } from 'react';

interface ContentTransitionProps {
  isLoading: boolean;
  skeleton: ReactNode;
  children: ReactNode;
}

export default function ContentTransition({
  isLoading,
  skeleton,
  children,
}: ContentTransitionProps) {
  return (
    <AnimatePresence mode="wait">
      {isLoading ? (
        <motion.div
          key="skeleton"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {skeleton}
        </motion.div>
      ) : (
        <motion.div
          key="content"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, delay: 0.05 }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
