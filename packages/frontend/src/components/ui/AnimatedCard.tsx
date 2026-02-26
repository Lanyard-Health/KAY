import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

interface AnimatedCardProps {
  children: ReactNode;
  index?: number;
  className?: string;
  onClick?: () => void;
}

const cardVariants = {
  hidden: { opacity: 0, scale: 0.97, y: 4 },
  visible: (i: number) => ({
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      delay: i * 0.05,
      duration: 0.3,
      ease: [0.25, 0.1, 0.25, 1] as const,
    },
  }),
};

export default function AnimatedCard({
  children,
  index = 0,
  className,
  onClick,
}: AnimatedCardProps) {
  return (
    <motion.div
      custom={index}
      initial="hidden"
      animate="visible"
      variants={cardVariants}
      className={className}
      onClick={onClick}
    >
      {children}
    </motion.div>
  );
}
